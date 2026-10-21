//! Pi 适配器
//!
//! 私有差异：仅 npm 全局安装；配置目录 `~/.pi`（供应商 models.json/auth.json
//! + Usage 会话 `~/.pi/agent/sessions`）；Skills 目录 `~/.pi/agent/skills`；
//! 反向导入读 models.json（providers）+ auth.json（key）。

use super::Agent;
use crate::providers::contract::{
    read_or_default, ProviderSpec, ProviderWriteCtx, TargetWrite, REASON_NO_MODELS,
    REASON_WRITE_FAILED,
};
use crate::providers::jsonc::{ensure_container, parse_jsonc, upsert_entry};
use crate::providers::merge::{merge_pi_entry, merged_model_count, pi_auth_entry};
use crate::providers::paths::{pi_auth_path, pi_models_path};
use crate::providers::{presets_from_pi, PresetDraft};
use crate::usage::contract::{UsageSource, UsageSpec};
use crate::usage_parse::parse_pi_session;
use serde_json::json;
use wasmnest_plugin_api::host::{HostFs, HostLog};
use wasmnest_plugin_api::wasm_host::WasmHost;

pub(super) struct Pi;

// ==================== 使用统计（~/.pi/agent/sessions JSONL） ====================

/// 自定义来源嗅探：前 64 行内顶层 `"type":"message"` → pi 形态
fn sniff(head: &[&str]) -> bool {
    head.iter().any(|l| l.contains("\"type\":\"message\""))
}

/// 使用统计能力：JSONL 会话根 + pi 形态嗅探（先于 claude 判定）
pub(super) static USAGE: UsageSpec = UsageSpec {
    source: UsageSource::Jsonl(".pi/agent/sessions"),
    parse_jsonl: Some(parse_pi_session),
    sniff: Some(sniff),
    sniff_rank: 10,
    sqlite: None,
    active_session: None,
};

// ==================== 供应商目标（pi models.json + auth.json） ====================

/// pi：models.json 写 providers 条目（有 key 时另写 auth.json）
fn provider_write(h: &WasmHost, ctx: &ProviderWriteCtx) -> Result<TargetWrite, (String, String)> {
    let target_name = ctx.target_name;
    let path = pi_models_path(ctx.home);
    let text = read_or_default(h, &path, "models.json")
        .map_err(|e| (REASON_WRITE_FAILED.to_string(), e))?;
    let t = ensure_container(&text, "providers").map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("pi providers container: {e}"),
        )
    })?;
    // 合并既有条目（保留用户模型定义）， pretty 序列化与 pi 既有排版一致
    let existing = parse_jsonc(&t)
        .ok()
        .and_then(|v| v.get("providers").and_then(|p| p.get(target_name)).cloned());
    let entry = merge_pi_entry(
        existing.as_ref(),
        &ctx.preset.name,
        &ctx.preset.base_url,
        &ctx.preset.api_style,
        &ctx.preset.models,
    );
    if merged_model_count(&entry) == 0 {
        // fail-visible：写入会让 pi `/model` 里出现一个 0 模型的供应商
        return Err((
            REASON_NO_MODELS.to_string(),
            format!("preset {target_name} has no models"),
        ));
    }
    let pretty = serde_json::to_string_pretty(&entry).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("serialize pi entry: {e}"),
        )
    })?;
    let t = upsert_entry(&t, Some("providers"), target_name, &pretty).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("pi providers upsert: {e}"),
        )
    })?;
    h.fs_write(&path, &t).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("write models.json failed: {e}"),
        )
    })?;
    let mut files = vec!["models.json".to_string()];
    // key 条目：无 key 时不动 auth.json（保留既有凭据）
    if let Some(k) = ctx.key {
        let auth_path = pi_auth_path(ctx.home);
        let auth_text = read_or_default(h, &auth_path, "auth.json")
            .map_err(|e| (REASON_WRITE_FAILED.to_string(), e))?;
        let auth_entry = serde_json::to_string(&pi_auth_entry(k)).map_err(|e| {
            (
                REASON_WRITE_FAILED.to_string(),
                format!("serialize auth entry: {e}"),
            )
        })?;
        let t = upsert_entry(&auth_text, None, target_name, &auth_entry).map_err(|e| {
            (
                REASON_WRITE_FAILED.to_string(),
                format!("auth.json upsert: {e}"),
            )
        })?;
        h.fs_write(&auth_path, &t).map_err(|e| {
            (
                REASON_WRITE_FAILED.to_string(),
                format!("write auth.json failed: {e}"),
            )
        })?;
        files.push("auth.json".to_string());
    }
    Ok(TargetWrite::Applied(files))
}

/// 从源 CLI 配置直拷 key（pi auth.json 同名条目的 key）
fn provider_source_key(h: &WasmHost, provider: &str, home: &str) -> Result<String, String> {
    let path = pi_auth_path(home);
    let text = h
        .fs_read(&path)
        .map_err(|e| format!("apply: read source config failed: {e}"))?
        .ok_or_else(|| "apply: source config missing (pi)".to_string())?;
    let cfg = parse_jsonc(&text).map_err(|e| format!("apply: source config invalid: {e}"))?;
    cfg.get(provider)
        .and_then(|p| p.get("key"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("apply: no key for pi:{provider}"))
}

/// 反向导入：models.json providers + auth.json key（解析失败只留日志）
fn provider_import(h: &WasmHost, home: &str) -> Vec<PresetDraft> {
    match h.fs_read(&pi_models_path(home)) {
        Ok(Some(text)) => match parse_jsonc(&text) {
            Ok(models) => {
                let auth = h
                    .fs_read(&pi_auth_path(home))
                    .ok()
                    .flatten()
                    .and_then(|t| parse_jsonc(&t).ok())
                    .unwrap_or_else(|| json!({}));
                presets_from_pi(&models, &auth)
            }
            Err(e) => {
                h.log_warn(&format!("import: pi models.json parse failed: {e}"));
                Vec::new()
            }
        },
        Ok(None) => Vec::new(),
        Err(e) => {
            h.log_warn(&format!("import: read pi models.json failed: {e}"));
            Vec::new()
        }
    }
}

/// 供应商目标能力：models.json/auth.json 写入 + 反向导入（导入顺序先于 opencode）
pub(super) static PROVIDER: ProviderSpec = ProviderSpec {
    view_key: None,
    requires_key: true,
    import_rank: 10,
    write: provider_write,
    source_key: Some(provider_source_key),
    view: None,
    import: Some(provider_import),
    auth_paths: None,
};

impl Agent for Pi {
    fn id(&self) -> &'static str {
        "pi"
    }

    fn display_name(&self) -> &'static str {
        "Pi"
    }

    fn npm_package(&self) -> Option<&'static str> {
        Some("@earendil-works/pi-coding-agent")
    }

    fn auth_segments(&self) -> &'static [&'static str] {
        &[".pi"]
    }

    fn skills_seg(&self) -> Option<&'static str> {
        Some(".pi/agent/skills")
    }

    fn provider(&self) -> Option<&'static ProviderSpec> {
        Some(&PROVIDER)
    }

    fn usage(&self) -> Option<&'static UsageSpec> {
        Some(&USAGE)
    }
}
