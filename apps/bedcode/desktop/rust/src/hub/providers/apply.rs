//! 应用到目标 CLI（同步命令，一次可写多个 CLI）
//!
//! key 来源四选一：stored 中心库已存（默认）/ inline 现场输入 / source 内存
//! 直拷（现读源配置，不落存储/日志）/ none 不带 key（pi 的 auth.json 与
//! 既有 apiKey 均保留）。claude 桥接冲突时阻止（force = 用户确认后仅写
//! env 块，桥接文件永不触碰）。真源始终是 CLI 自己的配置文件。
//!
//! # 多目标
//! `targets`（数组，顺序即写入顺序）逐个写，**互不影响**：单目标失败只记在
//! 该目标的结果里，其余目标照写；前端按 `results` 逐目标呈现。兼容旧的单数
//! `target` 入参。目标集合与每个目标的写入/视图/源 key 能力来自适配器注册表
//! （[`crate::hub::agents`] 的 `Agent::provider()`），本模块只做编排。
//!
//! # codex 目标的差异（见 [`crate::hub::agents::codex`]）
//! codex 不吃 key 值也不存模型清单：只写 `env_key = "<变量名>"` +
//! 顶层 `model` / `model_provider`（单值）。因此 codex 目标**不参与 key 四选一**
//! （纯 codex 应用时完全跳过 key 解析），env 变量名走独立的 `codex.envKey` 入参。
//!
//! # 写前自检（fail-visible）
//! pi / opencode 的条目合并后若**一个模型都没有**，拒绝写入并回
//! `reason = "noModels"`——写入等于「供应商配好了」的假象，目标 CLI 里却
//! 看不到任何模型（2026-10-04 实测：InkStone 预设模型列表为空，应用回执
//! `applied: true`，pi `/model` 里 0 个模型）。claude 不受此约束（env 块
//! 只改端点与 token）。

use super::contract::{Preset, ProviderWriteCtx, TargetWrite, REASON_BRIDGE, REASON_WRITE_FAILED};
use super::store::{
    build_state, emit_and_return, ensure_schema, list_presets, preset_key_of, read_stored,
    write_stored,
};
use super::NAME_MAX;
use crate::hub::agents;
use crate::hub::install::now_ms;
use crate::hub::HOME;
use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostFs, HostLog};
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 目标的供应商能力（None = 该 id 不是供应商目标）
fn provider_spec(id: &str) -> Option<&'static super::contract::ProviderSpec> {
    agents::get(id).and_then(|a| a.provider())
}

// ==================== 预设载入与入参校验 ====================

/// 目标条目名合法性（作为 JSON 对象键写入各 CLI 配置）
fn validate_target_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > NAME_MAX {
        return Err("target name empty or too long".to_string());
    }
    Ok(())
}

/// 目标列表：注册表 provider 能力 + 去重保序 + 非空。兼容旧单数 `target`
fn parse_targets(args: &Value) -> Result<Vec<String>, String> {
    let mut raw: Vec<String> = Vec::new();
    if let Some(arr) = args.get("targets").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(s) = v.as_str() {
                raw.push(s.trim().to_string());
            }
        }
    }
    if raw.is_empty() {
        // 旧调用方（单目标）：`target: "pi"`
        if let Some(s) = args.get("target").and_then(|v| v.as_str()) {
            raw.push(s.trim().to_string());
        }
    }
    let mut out: Vec<String> = Vec::new();
    for t in raw {
        if provider_spec(&t).is_none() {
            return Err(format!("unsupported target {t}"));
        }
        if !out.contains(&t) {
            out.push(t);
        }
    }
    if out.is_empty() {
        return Err("no target selected".to_string());
    }
    Ok(out)
}

/// 预设快照（一次应用内的只读视图）
impl Preset {
    fn load(h: &WasmHost, id: i64) -> anyhow::Result<Self> {
        let preset = list_presets(h)?
            .into_iter()
            .find(|p| p.get("id").and_then(|v| v.as_i64()) == Some(id))
            .ok_or_else(|| anyhow::anyhow!("apply: preset {id} not found"))?;
        let models: Vec<String> = preset
            .get("models")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|m| m.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            name: preset
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            base_url: preset
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            api_style: preset
                .get("apiStyle")
                .and_then(|v| v.as_str())
                .unwrap_or("openai")
                .to_string(),
            models,
        })
    }
}

// ==================== key 解析 ====================

/// key 四选一解析（与旧语义一致；stored 现读库内明文，明文不进 wire/日志）
/// source 模式直读源 CLI 配置：路径与字段由该 agent 的适配器声明
fn resolve_key(h: &WasmHost, args: &Value, id: i64) -> anyhow::Result<(String, Option<String>)> {
    let key_mode = args
        .get("key")
        .and_then(|v| v.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("none")
        .to_string();
    let key: Option<String> = match key_mode.as_str() {
        "inline" => Some(
            args.get("key")
                .and_then(|k| k.get("value"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("apply: inline key empty"))?
                .to_string(),
        ),
        "stored" => {
            let k = preset_key_of(h, id)?;
            if k.is_empty() {
                return Err(anyhow::anyhow!(
                    "apply: preset has no stored key (save one first)"
                ));
            }
            Some(k)
        }
        "source" => {
            let cli = args
                .get("key")
                .and_then(|k| k.get("cli"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let provider = args
                .get("key")
                .and_then(|k| k.get("provider"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let source = provider_spec(cli)
                .and_then(|s| s.source_key)
                .ok_or_else(|| anyhow::anyhow!("apply: unknown key source cli {cli}"))?;
            let home = HOME
                .get()
                .ok_or_else(|| anyhow::anyhow!("apply: home unavailable"))?;
            Some(source(h, provider, home).map_err(anyhow::Error::msg)?)
        }
        _ => None,
    };
    Ok((key_mode, key))
}

// ==================== 单目标写入 ====================

/// 适配器声明的批量授权路径（一次弹窗；拒绝不阻断，读写失败各自显性）
fn provider_auth_paths(home: &str, id: &str) -> Vec<String> {
    provider_spec(id)
        .and_then(|s| s.auth_paths)
        .map(|f| f(home))
        .unwrap_or_default()
}

fn needs_auth(id: &str) -> bool {
    provider_spec(id).and_then(|s| s.auth_paths).is_some()
}

/// 选中目标 / 源 key CLI 的批量授权（去重后一次 request-auth；无声明者跳过）
fn authorize_provider_groups(h: &WasmHost, ids: &[&str]) -> anyhow::Result<()> {
    let home = HOME
        .get()
        .ok_or_else(|| anyhow::anyhow!("apply: home unavailable"))?;
    let mut paths: Vec<String> = Vec::new();
    for id in ids {
        for path in provider_auth_paths(home, id) {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    if !paths.is_empty() {
        let _ = h.fs_request_auth(&paths).unwrap_or(false);
    }
    Ok(())
}

/// 写单个目标 CLI 的配置文件（配置写入 = 文本级 splice，由适配器实现）
fn write_target(
    h: &WasmHost,
    target: &str,
    preset: &Preset,
    target_name: &str,
    key: Option<&str>,
    force: bool,
    args: &Value,
) -> Result<TargetWrite, (String, String)> {
    let home = HOME.get().ok_or_else(|| {
        (
            REASON_WRITE_FAILED.to_string(),
            "home unavailable".to_string(),
        )
    })?;
    let Some(spec) = provider_spec(target) else {
        return Err((
            REASON_WRITE_FAILED.to_string(),
            format!("apply: unsupported target {target}"),
        ));
    };
    let ctx = ProviderWriteCtx {
        preset,
        target_name,
        key,
        force,
        home,
        args,
    };
    // 统一补 apply: 上下文（适配器只报步骤级原因）
    (spec.write)(h, &ctx).map_err(|(reason, msg)| (reason, format!("apply: {msg}")))
}

// ==================== 命令入口 ====================

/// 应用预设到目标 CLI（同步命令，可多目标）。key 来源四选一：stored 中心库已存
/// （默认）/ inline 现场输入 / source 内存直拷 / none 不带 key（pi 的 auth.json
/// 与既有 apiKey 均保留）。claude 桥接冲突时阻止（force = 用户确认，仅写 env）
///
/// 返回：`{ applied, targets, results[], files[], bridgeConflict, bridges, error }`
/// —— `results` 逐目标给 `ok / files / reason`，一个目标失败不牵连其余目标。
pub(crate) fn apply_provider(h: &WasmHost, args: &Value) -> anyhow::Result<Value> {
    ensure_schema(h)?;
    let id = args
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| anyhow::anyhow!("apply: missing preset id"))?;
    let preset = Preset::load(h, id)?;
    let targets = parse_targets(args).map_err(|e| anyhow::anyhow!("apply: {e}"))?;

    let target_name = args
        .get("targetName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| preset.name.clone());
    validate_target_name(&target_name)
        .map_err(|e| anyhow::anyhow!("apply: invalid target name: {e}"))?;

    let key_source_cli = (args
        .get("key")
        .and_then(|k| k.get("kind"))
        .and_then(|v| v.as_str())
        == Some("source"))
    .then(|| {
        args.get("key")
            .and_then(|k| k.get("cli"))
            .and_then(|v| v.as_str())
    })
    .flatten();
    let auth_ids: Vec<&str> = targets
        .iter()
        .map(|t| t.as_str())
        .chain(key_source_cli)
        .filter(|id| needs_auth(id))
        .collect();
    if !auth_ids.is_empty() {
        authorize_provider_groups(h, &auth_ids)?;
    }
    let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    // codex 不吃 key 值（只写 env_key 变量名）：纯 codex 应用时完全跳过 key 解析，
    // 否则「默认 inline 但未填」会把一次本可成功的 codex 应用判失败
    let key_targets = targets
        .iter()
        .any(|t| provider_spec(t).map(|s| s.requires_key).unwrap_or(false));
    let (key_mode, key) = if key_targets {
        resolve_key(h, args, id)?
    } else {
        ("none".to_string(), None)
    };

    let mut results: Vec<Value> = Vec::new();
    let mut all_files: Vec<String> = Vec::new();
    let mut all_bridges: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for target in &targets {
        match write_target(
            h,
            target,
            &preset,
            &target_name,
            key.as_deref(),
            force,
            args,
        ) {
            Ok(TargetWrite::Applied(files)) => {
                for f in &files {
                    if !all_files.contains(f) {
                        all_files.push(f.clone());
                    }
                }
                results.push(json!({
                    "target": target, "ok": true, "files": files,
                    "reason": Value::Null, "error": Value::Null,
                }));
            }
            Ok(TargetWrite::BridgeConflict(bridges)) => {
                for b in &bridges {
                    if !all_bridges.contains(b) {
                        all_bridges.push(b.clone());
                    }
                }
                results.push(json!({
                    "target": target, "ok": false, "files": Value::Array(Vec::new()),
                    "reason": REASON_BRIDGE, "bridges": bridges, "error": Value::Null,
                }));
                h.log_warn(&format!(
                    "provider apply blocked by claude bridge (preset = {}, target = {})",
                    preset.name, target
                ));
            }
            Err((reason, msg)) => {
                // 失败原文只进日志（票 04 / ADR 0030：界面给友好文案，不携带原文）
                h.log_error(&format!("provider apply failed (target = {target}): {msg}"));
                errors.push(msg.clone());
                results.push(json!({
                    "target": target, "ok": false, "files": Value::Array(Vec::new()),
                    "reason": reason, "error": msg,
                }));
            }
        }
    }

    let applied = errors.is_empty() && all_bridges.is_empty();
    let apply_last = json!({
        "ok": applied,
        "preset": preset.name,
        "targets": targets,
        // 旧字段保留（单目标视图）：首个目标
        "target": targets.first().map_or(Value::Null, |s| json!(s)),
        "results": results,
        "files": all_files,
        "keyMode": key_mode,
        "keyLen": key.as_ref().map(|k| k.chars().count()),
        "error": if applied { Value::Null } else { Value::String(errors.join("; ")) },
        "at": now_ms(h).unwrap_or(0),
    });
    let (import_last, _) = read_stored(h);
    write_stored(h, &import_last, &apply_last);
    // 日志纪律：key 只记长度（spec §6）
    h.log_info(&format!(
        "provider applied (preset = {}, targets = {:?}, ok = {applied}, key_len = {:?})",
        preset.name, targets, apply_last["keyLen"]
    ));
    let state = build_state(h)?;
    let mut result = emit_and_return(h, &state)?;
    result["applied"] = json!(applied);
    result["targets"] = json!(targets);
    result["results"] = json!(results);
    result["files"] = json!(all_files);
    result["bridgeConflict"] = json!(!all_bridges.is_empty());
    result["bridges"] = json!(all_bridges);
    result["error"] = apply_last["error"].clone();
    Ok(result)
}

// ==================== Tests（纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::providers::jsonc::{ensure_container, parse_jsonc, upsert_entry};
    use crate::hub::providers::merge::{merge_pi_entry, merged_model_count, pi_auth_entry};

    /// 目标列表：多目标去重保序 + 注册表 provider 能力；旧单数 `target` 仍可用
    #[test]
    fn parse_targets_accepts_multi_and_legacy_single() {
        assert_eq!(
            parse_targets(&json!({ "targets": ["pi", "opencode", "pi"] })).unwrap(),
            vec!["pi", "opencode"]
        );
        assert_eq!(
            parse_targets(&json!({ "target": "claude" })).unwrap(),
            vec!["claude"]
        );
        // codex 已开放（登记 provider + 设为当前模型）
        assert_eq!(
            parse_targets(&json!({ "targets": ["pi", "codex"] })).unwrap(),
            vec!["pi", "codex"]
        );
        // 空字符串与空白不构成目标
        assert!(parse_targets(&json!({ "targets": ["  "] })).is_err());
        assert!(parse_targets(&json!({})).is_err());
    }

    /// 白名单：注册表外（如拼错的 cli 名）一律拒绝
    #[test]
    fn parse_targets_rejects_unsupported() {
        let err = parse_targets(&json!({ "targets": ["pi", "cdoex"] })).unwrap_err();
        assert!(err.contains("cdoex"), "got: {err}");
        assert!(parse_targets(&json!({ "targets": ["gemini"] })).is_err());
    }

    /// 目标条目名：空 / 超长拒绝
    #[test]
    fn target_name_guard() {
        assert!(validate_target_name("InkStone").is_ok());
        assert!(validate_target_name("").is_err());
        assert!(validate_target_name(&"x".repeat(NAME_MAX + 1)).is_err());
        assert!(validate_target_name(&"x".repeat(NAME_MAX)).is_ok());
    }

    /// 端到端拼装（纯函数链）：pi 目标写入内容包含 key（目标配置的职责），
    /// 而返回给前端的状态载荷不含 key
    #[test]
    fn apply_pipeline_key_placement() {
        let key = "pi-inline-key-0123456789";
        let text = "{\n  \"providers\": {}\n}";
        let t = ensure_container(text, "providers").unwrap();
        let entry = merge_pi_entry(None, "u", "https://u/v1", "openai", &["m1".to_string()]);
        let pretty = serde_json::to_string_pretty(&entry).unwrap();
        let t = upsert_entry(&t, Some("providers"), "sensenova", &pretty).unwrap();
        assert!(parse_jsonc(&t).is_ok());
        assert!(!t.contains(key), "models.json entry itself carries no key");

        let auth_text = "{}";
        let auth_entry = serde_json::to_string(&pi_auth_entry(key)).unwrap();
        let out = upsert_entry(auth_text, None, "sensenova", &auth_entry).unwrap();
        assert!(out.contains(key), "auth.json is the designated key carrier");
        assert!(parse_jsonc(&out).is_ok());
    }

    /// fail-visible 的判定依据（写前自检的纯函数侧）：预设空模型 + 目标无既有
    /// 条目 → 合并结果 0 模型，必须被拒；反之有模型则放行
    #[test]
    fn empty_models_would_produce_model_less_entry() {
        let preset = Preset {
            name: "InkStone".to_string(),
            base_url: "https://b/v1".to_string(),
            api_style: "openai".to_string(),
            models: Vec::new(),
        };
        let fresh = merge_pi_entry(
            None,
            &preset.name,
            &preset.base_url,
            &preset.api_style,
            &preset.models,
        );
        assert_eq!(
            merged_model_count(&fresh),
            0,
            "must be rejected before write"
        );

        let existing =
            parse_jsonc(r#"{ "baseUrl": "https://old/v1", "models": [ { "id": "glm-5.2" } ] }"#)
                .unwrap();
        let merged = merge_pi_entry(
            Some(&existing),
            &preset.name,
            &preset.base_url,
            &preset.api_style,
            &preset.models,
        );
        assert_eq!(
            merged_model_count(&merged),
            1,
            "existing entry keeps its models → apply stays allowed"
        );
    }
}
