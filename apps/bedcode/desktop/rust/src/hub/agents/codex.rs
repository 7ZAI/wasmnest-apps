//! Codex CLI 适配器
//!
//! 私有差异：仅 npm 全局安装（无 native / standalone 形态）；配置目录
//! `~/.codex`（供应商 `config.toml` + Usage rollout 会话 `~/.codex/sessions`）；
//! 无 skills 目录约定。
//!
//! 供应商语义降级：codex 没有模型清单，只登记 `[model_providers.<n>]` 并把
//! 顶层 `model` / `model_provider` 指向预设首个模型；凭据只写环境变量名
//! （`env_key`），**不参与 key 四选一**（`requires_key = false`）。

use super::Agent;
use crate::hub::providers::codex;
use crate::hub::providers::contract::{
    read_or_default_raw, ProviderSpec, ProviderWriteCtx, TargetWrite, REASON_WRITE_FAILED,
};
use crate::hub::providers::paths::codex_config_path;
use crate::hub::usage::contract::{UsageSource, UsageSpec};
use crate::hub::usage_parse::parse_codex_session;
use wasmnest_plugin_api::host::HostFs;
use wasmnest_plugin_api::wasm_host::WasmHost;

pub(super) struct Codex;

// ==================== 使用统计（~/.codex/sessions JSONL rollout） ====================

/// 使用统计能力：codex 官方 rollout 会话（`~/.codex/sessions/YYYY/MM/DD/*.jsonl`），
/// 无自定义来源嗅探、无 SQLite 源、无配置权威活跃会话
pub(super) static USAGE: UsageSpec = UsageSpec {
    source: UsageSource::Jsonl(".codex/sessions"),
    parse_jsonl: Some(parse_codex_session),
    sniff: None,
    sniff_rank: 0,
    sqlite: None,
    active_session: None,
};

// ==================== 供应商目标（config.toml TOML 文本级 splice） ====================

/// codex：登记 `[model_providers.<name>]` + 把顶层 `model` / `model_provider`
/// 指向它（codex 无模型清单，只能指向单个模型 = 预设首个模型）。
///
/// 破坏性：会切走用户当前的 `model` / `model_provider`（codex 没有「只登记不切换」
/// 的形态）。面板在写入前展示「当前 → 将切换为」由用户确认。
fn provider_write(h: &WasmHost, ctx: &ProviderWriteCtx) -> Result<TargetWrite, (String, String)> {
    // codex 私有入参：环境变量名（不落 key 值，由用户 shell 环境提供）
    let env_key = ctx
        .args
        .get("codex")
        .and_then(|c| c.get("envKey"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    // 计划（三道守卫在纯函数侧，写入方只负责文本与 fs）
    let plan = codex::plan_apply(
        ctx.target_name,
        &ctx.preset.name,
        &ctx.preset.base_url,
        &ctx.preset.api_style,
        &ctx.preset.models,
        env_key,
    )
    .map_err(|(reason, msg)| (reason.to_string(), msg))?;

    let path = codex_config_path(ctx.home);
    let text = read_or_default_raw(h, &path, "config.toml")
        .map_err(|e| (REASON_WRITE_FAILED.to_string(), e))?;
    let entries = plan.entries();
    let entry_refs: Vec<(&str, &str)> = entries.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let mut next = codex::upsert_table(&text, &plan.table, &entry_refs);
    next = codex::set_top_level(&next, "model", &codex::toml_quote(&plan.model));
    next = codex::set_top_level(
        &next,
        "model_provider",
        &codex::toml_quote(&plan.target_name),
    );
    h.fs_write(&path, &next).map_err(|e| {
        (
            REASON_WRITE_FAILED.to_string(),
            format!("write config.toml failed: {e}"),
        )
    })?;
    Ok(TargetWrite::Applied(vec!["config.toml".to_string()]))
}

/// 供应商目标能力：config.toml 写入 + 只读视图（无 key 解析、无反向导入；
/// 配置目录随 activate 批量授权，不在此另申请）
pub(super) static PROVIDER: ProviderSpec = ProviderSpec {
    view_key: Some("codex"),
    requires_key: false,
    import_rank: 0,
    write: provider_write,
    source_key: None,
    view: Some(codex::codex_view),
    import: None,
    auth_paths: None,
};

impl Agent for Codex {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex CLI"
    }

    fn npm_package(&self) -> Option<&'static str> {
        Some("@openai/codex")
    }

    fn auth_segments(&self) -> &'static [&'static str] {
        &[".codex"]
    }

    fn provider(&self) -> Option<&'static ProviderSpec> {
        Some(&PROVIDER)
    }

    fn usage(&self) -> Option<&'static UsageSpec> {
        Some(&USAGE)
    }
}
