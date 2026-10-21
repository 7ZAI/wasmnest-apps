//! Codex CLI 适配器
//!
//! 私有差异：仅 npm 全局安装（无 native / standalone 形态）；配置目录
//! `~/.codex`（供应商 `config.toml` + Usage rollout 会话 `~/.codex/sessions`）；
//! 无 skills 目录约定。

use super::Agent;

pub(super) struct Codex;

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

    fn supports_provider(&self) -> bool {
        true
    }

    fn supports_usage(&self) -> bool {
        true
    }
}
