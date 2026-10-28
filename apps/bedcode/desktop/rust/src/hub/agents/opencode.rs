//! OpenCode 适配器
//!
//! 私有差异：官方安装脚本落 `~/.opencode/bin`（method = standalone）——
//! 更新走内置 `opencode upgrade`（官方自动探测安装方式；curl 安装重跑官方
//! 脚本、npm/pnpm 走包管理器，不依赖 node、镜像无关），未安装时拒绝；
//! 卸载走 `opencode uninstall --force`；standalone 的最新版本以 GitHub
//! Releases 为权威（官方 upgrade 同源），失败回落 npm registry。
//! 供应商配置为 `~/.config/opencode/opencode.json` 的 provider 条目；
//! 反向导入读同一文件。无 skills 目录约定。

use super::{Agent, LatestSource};
use crate::hub::providers::contract::{
    read_or_default, ProviderSpec, ProviderWriteCtx, TargetWrite, REASON_NO_MODELS,
    REASON_WRITE_FAILED,
};
use crate::hub::providers::jsonc::{ensure_container, parse_jsonc, upsert_entry};
use crate::hub::providers::merge::{merge_opencode_entry, merged_model_count};
use crate::hub::providers::paths::opencode_cfg_path;
use crate::hub::providers::{presets_from_opencode, PresetDraft};
use crate::hub::usage::contract::{SqliteUsage, UsageSource, UsageSpec};
use wasmnest_plugin_api::host::{HostFs, HostLog};
use wasmnest_plugin_api::wasm_host::WasmHost;

/// curl/standalone 安装的二进制真源（官方 `opencode upgrade` 对 curl 安装
/// 同样查该仓库的 latest release）
pub(super) const GITHUB_REPO: &str = "anomalyco/opencode";

pub(super) struct Opencode;

// ==================== 使用统计（SQLite 库 + 取数引擎） ====================

/// 使用统计能力：opencode 的 SQLite 库不进文件枚举，由取数引擎同步/现查
pub(super) static USAGE: UsageSpec = UsageSpec {
    source: UsageSource::Sqlite(crate::hub::usage_sqlite::DB_REL),
    parse_jsonl: None,
    sniff: None,
    sniff_rank: 0,
    sqlite: Some(SqliteUsage {
        collect: crate::hub::usage_sqlite::collect_sessions,
        events: crate::hub::usage_sqlite::session_events,
    }),
    active_session: None,
};

// ==================== 供应商目标（opencode.json provider 条目） ====================

/// opencode：opencode.json 写 provider 条目（options.apiKey 内联）
fn provider_write(h: &WasmHost, ctx: &ProviderWriteCtx) -> Result<TargetWrite, (String, String)> {
    let target_name = ctx.target_name;
    let path = opencode_cfg_path(ctx.home);
    let text = read_or_default(h, &path, "opencode.json")
        .map_err(|e| (REASON_WRITE_FAILED.to_string(), e))?;
    let t = ensure_container(&text, "provider").map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("opencode provider container: {e}"),
        )
    })?;
    let existing = parse_jsonc(&t)
        .ok()
        .and_then(|v| v.get("provider").and_then(|p| p.get(target_name)).cloned());
    let entry = merge_opencode_entry(
        existing.as_ref(),
        &ctx.preset.name,
        &ctx.preset.base_url,
        &ctx.preset.api_style,
        &ctx.preset.models,
        ctx.key,
    );
    if merged_model_count(&entry) == 0 {
        return Err((
            REASON_NO_MODELS.to_string(),
            format!("preset {target_name} has no models"),
        ));
    }
    let pretty = serde_json::to_string_pretty(&entry).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("serialize opencode entry: {e}"),
        )
    })?;
    let t = upsert_entry(&t, Some("provider"), target_name, &pretty).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("opencode provider upsert: {e}"),
        )
    })?;
    h.fs_write(&path, &t).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("write opencode.json failed: {e}"),
        )
    })?;
    Ok(TargetWrite::Applied(vec!["opencode.json".to_string()]))
}

/// 从源 CLI 配置直拷 key（opencode.json provider.<名>.options.apiKey）
fn provider_source_key(h: &WasmHost, provider: &str, home: &str) -> Result<String, String> {
    let path = opencode_cfg_path(home);
    let text = h
        .fs_read(&path)
        .map_err(|e| format!("apply: read source config failed: {e}"))?
        .ok_or_else(|| "apply: source config missing (opencode)".to_string())?;
    let cfg = parse_jsonc(&text).map_err(|e| format!("apply: source config invalid: {e}"))?;
    cfg.get("provider")
        .and_then(|p| p.get(provider))
        .and_then(|p| p.get("options"))
        .and_then(|o| o.get("apiKey"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("apply: no key for opencode:{provider}"))
}

/// 反向导入：opencode.json provider.* → 预设草稿（解析失败只留日志）
fn provider_import(h: &WasmHost, home: &str) -> Vec<PresetDraft> {
    match h.fs_read(&opencode_cfg_path(home)) {
        Ok(Some(text)) => match parse_jsonc(&text) {
            Ok(cfg) => presets_from_opencode(&cfg),
            Err(e) => {
                h.log_warn(&format!("import: opencode.json parse failed: {e}"));
                Vec::new()
            }
        },
        Ok(None) => Vec::new(),
        Err(e) => {
            h.log_warn(&format!("import: read opencode.json failed: {e}"));
            Vec::new()
        }
    }
}

/// 供应商目标能力：opencode.json 写入 + 反向导入（导入顺序在 pi 之后）
pub(super) static PROVIDER: ProviderSpec = ProviderSpec {
    view_key: None,
    requires_key: true,
    import_rank: 20,
    write: provider_write,
    source_key: Some(provider_source_key),
    view: None,
    import: Some(provider_import),
    auth_paths: None,
};

impl Agent for Opencode {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn display_name(&self) -> &'static str {
        "OpenCode"
    }

    fn npm_package(&self) -> Option<&'static str> {
        Some("opencode-ai")
    }

    fn path_methods(&self) -> &'static [(&'static str, &'static str)] {
        &[("/.opencode/bin/", "standalone")]
    }

    fn auth_segments(&self) -> &'static [&'static str] {
        &[".config/opencode", ".local/share/opencode"]
    }

    fn provider(&self) -> Option<&'static ProviderSpec> {
        Some(&PROVIDER)
    }

    fn usage(&self) -> Option<&'static UsageSpec> {
        Some(&USAGE)
    }

    fn install_recipe(
        &self,
        method: &str,
        installed: bool,
        use_mirror: bool,
    ) -> Result<(String, &'static str), String> {
        if method == "standalone" {
            if !installed {
                // 防御分支：standalone 归类来自 PATH 首命中 `~/.opencode/bin` 且
                // 版本可读，实际不会走到；upgrade 只更新不安装，仍走官方脚本手动
                return Err(
                    "opencode standalone not installed: install via official script (manual)"
                        .to_string(),
                );
            }
            return Ok(("opencode upgrade".to_string(), "update"));
        }
        super::npm_install_recipe(self, installed, use_mirror)
    }

    fn uninstall_recipe(&self, method: &str, _windows: bool) -> Result<String, String> {
        if method == "standalone" {
            return Ok("opencode uninstall --force".to_string());
        }
        super::npm_uninstall_recipe(self, method)
    }

    /// standalone 自更新不依赖 node（curl 安装的二进制直接换版本）
    fn install_requires_node(&self, method: &str) -> bool {
        method != "standalone"
    }

    fn latest_source(&self, method: Option<&str>) -> Option<LatestSource> {
        if method == Some("standalone") {
            return Some(LatestSource::GitHub(GITHUB_REPO));
        }
        self.npm_package().map(LatestSource::Npm)
    }
}
