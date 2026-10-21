//! Claude Code 适配器
//!
//! 私有差异：官方原生安装器落 `~/.local/bin`（method = native；更新走
//! `claude update`，卸载删 launcher + 版本目录）；Skills 目录
//! `~/.claude/skills`；供应商配置为 `~/.claude/settings.json` 的 env 块
//! （桥接脚本存在时阻止写入，force 后仅写 env）；Usage 为
//! `~/.claude/projects` JSONL。配置/会话目录在共享授权清单里
//! （`.claude.json` / `.claude/projects`），不重复声明。

use super::Agent;
use crate::providers::contract::{
    read_or_default, ProviderSpec, ProviderWriteCtx, TargetWrite, REASON_WRITE_FAILED,
};
use crate::providers::jsonc::{ensure_container, parse_jsonc, upsert_entry};
use crate::providers::merge::{claude_env_entries, claude_env_view};
use crate::providers::paths::{bridge_paths, claude_auth_paths, claude_settings_path};
use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostFs, HostLog};
use wasmnest_plugin_api::wasm_host::WasmHost;

pub(super) struct Claude;

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

    fn supports_usage(&self) -> bool {
        true
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
