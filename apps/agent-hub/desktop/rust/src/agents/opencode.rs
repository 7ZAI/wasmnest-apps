//! OpenCode 适配器
//!
//! 私有差异：官方安装脚本落 `~/.opencode/bin`（method = standalone）——
//! 更新走内置 `opencode upgrade`（官方自动探测安装方式；curl 安装重跑官方
//! 脚本、npm/pnpm 走包管理器，不依赖 node、镜像无关），未安装时拒绝；
//! 卸载走 `opencode uninstall --force`；standalone 的最新版本以 GitHub
//! Releases 为权威（官方 upgrade 同源），失败回落 npm registry。
//! 无 skills 目录约定。

use super::{Agent, LatestSource};

/// curl/standalone 安装的二进制真源（官方 `opencode upgrade` 对 curl 安装
/// 同样查该仓库的 latest release）
pub(super) const GITHUB_REPO: &str = "anomalyco/opencode";

pub(super) struct Opencode;

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

    fn supports_provider(&self) -> bool {
        true
    }

    fn supports_usage(&self) -> bool {
        true
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
