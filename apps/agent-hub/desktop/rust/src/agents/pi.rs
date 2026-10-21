//! Pi 适配器
//!
//! 私有差异：仅 npm 全局安装；配置目录 `~/.pi`（供应商 models.json/auth.json
//! + Usage 会话 `~/.pi/agent/sessions`）；Skills 目录 `~/.pi/agent/skills`。

use super::Agent;

pub(super) struct Pi;

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

    fn supports_provider(&self) -> bool {
        true
    }

    fn supports_usage(&self) -> bool {
        true
    }
}
