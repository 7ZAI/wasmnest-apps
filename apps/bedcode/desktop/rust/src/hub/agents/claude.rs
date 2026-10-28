//! Claude Code 适配器
//!
//! 私有差异：官方原生安装器落 `~/.local/bin`（method = native；更新走
//! `claude update`，卸载删 launcher + 版本目录）；Skills 目录
//! `~/.claude/skills`；供应商配置为 `~/.claude/settings.json` 的 env 块
//! （桥接脚本存在时阻止写入，force 后仅写 env）；Usage 为
//! `~/.claude/projects` JSONL。配置/会话目录在共享授权清单里
//! （`.claude.json` / `.claude/projects`），不重复声明。

use super::Agent;
use crate::hub::providers::contract::{
    read_or_default, ProviderSpec, ProviderWriteCtx, TargetWrite, REASON_WRITE_FAILED,
};
use crate::hub::providers::jsonc::{ensure_container, parse_jsonc, upsert_entry};
use crate::hub::providers::merge::{claude_env_entries, claude_env_view};
use crate::hub::providers::paths::{bridge_paths, claude_auth_paths, claude_settings_path};
use crate::hub::usage::contract::{UsageSource, UsageSpec};
use crate::hub::usage_parse::parse_claude_session;
use crate::hub::HOME;
use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostFs, HostLog};
use wasmnest_plugin_api::wasm_host::WasmHost;

pub(super) struct Claude;

// ==================== 使用统计（~/.claude/projects JSONL + 配置权威活跃会话） ====================

/// claude 配置解析（纯函数，可测）：读 `~/.claude.json` 的 `projects` 映射
/// （key=项目绝对路径 → { lastSessionId, lastStartTime }），返回最后启动
/// 时间（epoch 毫秒）最大的项目 → (项目路径, lastSessionId)。
/// 缺键/非数字的条目跳过；无有效条目返回 None。
fn claude_active_from_config(projects: &Value) -> Option<(String, String)> {
    let obj = projects.as_object()?;
    let mut best: Option<(String, String, i64)> = None;
    for (proj, meta) in obj {
        let sid = meta.get("lastSessionId").and_then(|v| v.as_str());
        let ts = meta.get("lastStartTime").and_then(|v| v.as_i64());
        match (sid, ts) {
            (Some(sid), Some(ts)) if best.as_ref().map_or(true, |(_, _, t)| ts > *t) => {
                best = Some((proj.clone(), sid.to_string(), ts));
            }
            _ => {}
        }
    }
    best.map(|(proj, sid, _)| (proj, sid))
}

/// 正在使用的项目会话：claude 优先读 `~/.claude.json` 配置（lastStartTime
/// 最大者为当前项目会话，比文件 mtime 权威；未授权/损坏时跳过并回退最新会话）
fn active_session(h: &WasmHost) -> Option<(String, String)> {
    let home = HOME.get()?;
    let claude_json = format!("{home}/.claude.json");
    match h.fs_read(&claude_json) {
        Ok(Some(content)) => match serde_json::from_str::<Value>(&content) {
            Ok(cfg) => cfg.get("projects").and_then(claude_active_from_config),
            Err(e) => {
                h.log_warn(&format!(
                    "usage: parse {claude_json} failed, fallback to newest session: {e}"
                ));
                None
            }
        },
        // 未授权（fs_auth 拒绝）或文件缺失：回退最新会话，不中断扫描
        Ok(None) | Err(_) => None,
    }
}

/// 自定义来源嗅探：前 64 行内顶层 `"type":"assistant"/"user"` → claude 形态
fn sniff(head: &[&str]) -> bool {
    head.iter()
        .any(|l| l.contains("\"type\":\"assistant\"") || l.contains("\"type\":\"user\""))
}

/// 使用统计能力：JSONL 会话根 + claude 配置权威的活跃会话判定
pub(super) static USAGE: UsageSpec = UsageSpec {
    source: UsageSource::Jsonl(".claude/projects"),
    parse_jsonl: Some(parse_claude_session),
    sniff: Some(sniff),
    sniff_rank: 20,
    sqlite: None,
    active_session: Some(active_session),
};

/// claude native 卸载命令（官方文档，双平台形态）：
/// unix `rm -f ~/.local/bin/claude` + `rm -rf ~/.local/share/claude`；
/// Windows cmd `del`/`rd` 等价（`%USERPROFILE%` 由 cmd 展开）
fn claude_native_uninstall(windows: bool) -> String {
    if windows {
        "del /f \"%USERPROFILE%\\.local\\bin\\claude.exe\" & rd /s /q \"%USERPROFILE%\\.local\\share\\claude\"".to_string()
    } else {
        "rm -f ~/.local/bin/claude\nrm -rf ~/.local/share/claude".to_string()
    }
}

// ==================== 供应商目标（claude settings.json env 块） ====================

/// claude：只改 settings.json 的 env 块；桥接文件在用时阻止（force 后仅写 env）
fn provider_write(h: &WasmHost, ctx: &ProviderWriteCtx) -> Result<TargetWrite, (String, String)> {
    let bridges = bridge_paths(ctx.home);
    let found: Vec<String> = bridges
        .iter()
        .filter(|p| h.fs_exists(p).unwrap_or(false))
        .map(|p| p.rsplit('/').next().unwrap_or(p).to_string())
        .collect();
    if !found.is_empty() && !ctx.force {
        // 桥接冲突：阻止写入（桥接文件永不触碰），由用户确认后再写 env
        h.log_warn("apply: claude bridge detected; write blocked");
        return Ok(TargetWrite::BridgeConflict(found));
    }
    let path = claude_settings_path(ctx.home);
    let text = read_or_default(h, &path, "settings.json")
        .map_err(|e| (REASON_WRITE_FAILED.to_string(), e))?;
    let mut t = ensure_container(&text, "env").map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("claude env container: {e}"),
        )
    })?;
    for (k, v) in claude_env_entries(
        &ctx.preset.base_url,
        ctx.key,
        ctx.preset.models.first().map(|s| s.as_str()),
    ) {
        t = upsert_entry(&t, Some("env"), k, &v.to_string()).map_err(|e| {
            (
                REASON_WRITE_FAILED.to_string(),
                format!("claude env upsert {k}: {e}"),
            )
        })?;
    }
    h.fs_write(&path, &t).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("write settings.json failed: {e}"),
        )
    })?;
    Ok(TargetWrite::Applied(vec!["settings.json".to_string()]))
}

/// 从源 CLI 配置直拷 key（读 settings.json 的 env.ANTHROPIC_AUTH_TOKEN）
fn provider_source_key(h: &WasmHost, provider: &str, home: &str) -> Result<String, String> {
    let path = claude_settings_path(home);
    let text = h
        .fs_read(&path)
        .map_err(|e| format!("apply: read source config failed: {e}"))?
        .ok_or_else(|| "apply: source config missing (claude)".to_string())?;
    let cfg = parse_jsonc(&text).map_err(|e| format!("apply: source config invalid: {e}"))?;
    cfg.get("env")
        .and_then(|e| e.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("apply: no key for claude:{provider}"))
}

/// claude 只读视图（env 掩码 + 桥接文件存在性，读时现查）
fn provider_view(h: &WasmHost, home: &str) -> Value {
    let env = h
        .fs_read(&claude_settings_path(home))
        .ok()
        .flatten()
        .map(|t| {
            parse_jsonc(&t)
                .map(|v| claude_env_view(&v))
                .unwrap_or(json!({}))
        })
        .unwrap_or_else(|| json!({}));
    let bridges = bridge_paths(home);
    json!({
        "env": env,
        "bridge": {
            "providerConfigSh": h.fs_exists(&bridges[0]).unwrap_or(false),
            "anthropicBridgeMjs": h.fs_exists(&bridges[1]).unwrap_or(false),
        },
    })
}

/// 供应商目标能力：settings.json env 块 + 桥接冲突守卫 + 只读视图
pub(super) static PROVIDER: ProviderSpec = ProviderSpec {
    view_key: Some("claude"),
    requires_key: true,
    import_rank: 0,
    write: provider_write,
    source_key: Some(provider_source_key),
    view: Some(provider_view),
    import: None,
    auth_paths: Some(claude_auth_paths),
};

impl Agent for Claude {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn npm_package(&self) -> Option<&'static str> {
        Some("@anthropic-ai/claude-code")
    }

    fn path_methods(&self) -> &'static [(&'static str, &'static str)] {
        &[("/.local/bin/", "native")]
    }

    fn skills_seg(&self) -> Option<&'static str> {
        Some(".claude/skills")
    }

    fn provider(&self) -> Option<&'static ProviderSpec> {
        Some(&PROVIDER)
    }

    fn usage(&self) -> Option<&'static UsageSpec> {
        Some(&USAGE)
    }

    /// native → `claude update`（双平台同命令，镜像无关）；npm-global → npm
    /// 包安装；其余安装方式拒绝（v1 无对应 recipe）
    fn install_recipe(
        &self,
        method: &str,
        installed: bool,
        use_mirror: bool,
    ) -> Result<(String, &'static str), String> {
        match method {
            "native" => Ok(("claude update".to_string(), "update")),
            "npm-global" => super::npm_install_recipe(self, installed, use_mirror),
            other => Err(format!("unsupported claude install method: {other}")),
        }
    }

    /// native → 官方文档卸载命令；其余走公共 npm-global 白名单
    fn uninstall_recipe(&self, method: &str, windows: bool) -> Result<String, String> {
        if method == "native" {
            return Ok(claude_native_uninstall(windows));
        }
        super::npm_uninstall_recipe(self, method)
    }
}

// ==================== Tests（配置权威活跃会话） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// claude 配置解析：取 lastStartTime 最大项目；缺键/非数字条目跳过
    #[test]
    fn claude_active_picks_latest_project() {
        let projects = serde_json::json!({
            "/home/u/old": { "lastSessionId": "s-1", "lastStartTime": 1000 },
            "/home/u/new": { "lastSessionId": "s-2", "lastStartTime": 3000 },
            // 缺 lastStartTime / lastSessionId 的条目跳过，不中断
            "/home/u/broken-a": { "lastSessionId": "s-3" },
            "/home/u/broken-b": { "lastStartTime": 5000 },
        });
        let got = claude_active_from_config(&projects);
        assert_eq!(got, Some(("/home/u/new".to_string(), "s-2".to_string())));
        // 空/非对象输入 → None
        assert_eq!(claude_active_from_config(&serde_json::json!([])), None);
        assert_eq!(claude_active_from_config(&serde_json::json!({})), None);
    }
}
