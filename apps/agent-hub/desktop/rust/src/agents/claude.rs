//! Claude Code 适配器
//!
//! 私有差异：官方原生安装器落 `~/.local/bin`（method = native；更新走
//! `claude update`，卸载删 launcher + 版本目录）；Skills 目录
//! `~/.claude/skills`；供应商配置为 `~/.claude/settings.json` + 桥接脚本；
//! Usage 为 `~/.claude/projects` JSONL。配置/会话目录在共享授权清单里
//! （`.claude.json` / `.claude/projects`），不重复声明。

use super::Agent;

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

    fn supports_provider(&self) -> bool {
        true
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
