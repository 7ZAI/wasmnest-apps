//! 安装/卸载命令 recipe 白名单（纯函数，双平台可测）
//!
//! 白名单 = 注册表（[`crate::hub::agents`]）：cli 名必须是注册项，method/installed
//! 来自探测状态而非前端传参。具体命令由适配器声明，公共默认覆盖 npm-global
//! （读包名）：
//! - claude native → `claude update`（镜像无关）；claude npm-global → npm 包安装
//! - opencode standalone（已装）→ `opencode upgrade`（官方内置更新命令，自动
//!   探测安装方式：curl 安装重跑官方脚本、pnpm/npm 走包管理器）；其余 → npm
//!   包安装
//! - 卸载：npm-global → `npm uninstall -g <pkg>`；claude native → 官方文档
//!   卸载命令（rm launcher + 版本目录）；opencode standalone →
//!   `opencode uninstall --force`（官方命令，非交互跳过确认）

use super::registry::NPMMIRROR;
use crate::hub::agents;

/// npm 安装命令（mirror 开关追加 `--registry`；包名来自适配器注册表）。
/// 公共默认 recipe 与适配器的 npm 回落分支共用
pub(crate) fn npm_install_cmd(pkg: &str, use_mirror: bool) -> String {
    if use_mirror {
        format!("npm install -g {pkg} --registry={NPMMIRROR}")
    } else {
        format!("npm install -g {pkg}")
    }
}

/// 卸载命令构造（纯函数，双平台可测）
///
/// 仅接受注册表内的 cli 名；method 来自探测状态而非前端传参。
/// 未知 cli / 未知 method 一律拒绝（v1 提示手动卸载）
pub(crate) fn build_uninstall_script(
    cli: &str,
    method: &str,
    windows: bool,
) -> Result<String, String> {
    let agent = agents::get(cli).ok_or_else(|| format!("no uninstall recipe for cli: {cli}"))?;
    agent.uninstall_recipe(method, windows)
}

/// 安装/更新命令构造（纯函数，双平台可测）
///
/// 仅接受注册表内的 cli 名；method/installed 来自探测状态而非前端传参。
/// 返回 `(脚本, action)`；action 供 UI 展示（install/update）
pub(crate) fn build_install_script(
    cli: &str,
    method: &str,
    installed: bool,
    use_mirror: bool,
) -> Result<(String, &'static str), String> {
    let agent = agents::get(cli).ok_or_else(|| format!("no install recipe for cli: {cli}"))?;
    agent.install_recipe(method, installed, use_mirror)
}

// ==================== Tests（纯函数单测，双平台形态覆盖） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// recipe 白名单：npm 类 CLI 双平台同命令；镜像追加 --registry
    #[test]
    fn build_script_npm_clis() {
        let (script, action) =
            build_install_script("pi", "npm-global", false, false).expect("pi recipe");
        assert_eq!(script, "npm install -g @earendil-works/pi-coding-agent");
        assert_eq!(action, "install");

        let (script, action) =
            build_install_script("codex", "npm-global", true, false).expect("codex recipe");
        assert_eq!(script, "npm install -g @openai/codex");
        assert_eq!(action, "update");

        let (script, _) =
            build_install_script("pi", "npm-global", false, true).expect("pi mirror recipe");
        assert_eq!(
            script,
            "npm install -g @earendil-works/pi-coding-agent --registry=https://registry.npmmirror.com"
        );

        let (script, _) =
            build_install_script("opencode", "npm-global", true, false).expect("opencode recipe");
        assert_eq!(script, "npm install -g opencode-ai");
    }

    /// claude 分派：native → `claude update`（双平台同命令）；npm-global → npm 包；
    /// unknown method 拒绝
    #[test]
    fn build_script_claude() {
        let (script, action) =
            build_install_script("claude", "native", true, true).expect("native recipe");
        assert_eq!(script, "claude update");
        assert_eq!(action, "update");
        // 镜像对 claude update 无意义：命令不受 use_mirror 影响
        let (script, _) = build_install_script("claude", "native", true, false).expect("native");
        assert_eq!(script, "claude update");

        let (script, _) =
            build_install_script("claude", "npm-global", true, false).expect("npm recipe");
        assert_eq!(script, "npm install -g @anthropic-ai/claude-code");

        assert!(build_install_script("claude", "unknown", true, false).is_err());
    }

    /// opencode standalone 已装：更新走官方内置命令 `opencode upgrade`（自动
    /// 探测安装方式：curl 安装重跑官方脚本、npm/pnpm 走包管理器）；镜像开关
    /// 对 standalone 更新无意义（命令不受 use_mirror 影响）
    #[test]
    fn build_script_opencode_standalone_update() {
        let (script, action) =
            build_install_script("opencode", "standalone", true, false).expect("standalone");
        assert_eq!(script, "opencode upgrade");
        assert_eq!(action, "update");

        let (script, _) =
            build_install_script("opencode", "standalone", true, true).expect("standalone");
        assert_eq!(script, "opencode upgrade");
    }

    /// opencode standalone 未装（防御分支，实际不可达）：拒绝自动安装——
    /// upgrade 只更新不安装，安装仍走官方脚本手动
    #[test]
    fn build_script_opencode_standalone_not_installed_rejected() {
        let err = build_install_script("opencode", "standalone", false, false).unwrap_err();
        assert!(err.contains("official script"), "got: {err}");
    }

    /// 白名单外 cli 名拒绝（无用户自由输入拼接面）
    #[test]
    fn build_script_unknown_cli_rejected() {
        assert!(build_install_script("rm -rf /", "npm-global", false, false).is_err());
        assert!(build_install_script("", "npm-global", false, false).is_err());
    }

    // ==================== 卸载 recipe（票据：概览卸载） ====================

    /// npm-global 卸载：四家 CLI 均 `npm uninstall -g <pkg>`（包名来自注册表），
    /// 镜像无关（本地完成）
    #[test]
    fn build_uninstall_npm_global() {
        for agent in crate::hub::agents::all() {
            let pkg = agent.npm_package().expect("builtin npm package");
            let script = build_uninstall_script(agent.id(), "npm-global", false)
                .expect("npm uninstall recipe");
            assert_eq!(
                script,
                format!("npm uninstall -g {pkg}"),
                "cli: {}",
                agent.id()
            );
        }
    }

    /// claude native 卸载：unix 移除 launcher + 版本目录；Windows cmd 等价形态
    #[test]
    fn build_uninstall_claude_native() {
        let unix = build_uninstall_script("claude", "native", false).expect("unix recipe");
        assert!(unix.contains("rm -f ~/.local/bin/claude"));
        assert!(unix.contains("rm -rf ~/.local/share/claude"));

        let win = build_uninstall_script("claude", "native", true).expect("win recipe");
        assert!(win.contains("claude.exe"));
        assert!(win.contains("rd /s /q"));
    }

    /// opencode standalone 卸载：官方 `opencode uninstall --force`（非交互跳过确认）
    #[test]
    fn build_uninstall_opencode_standalone() {
        let script =
            build_uninstall_script("opencode", "standalone", false).expect("standalone recipe");
        assert_eq!(script, "opencode uninstall --force");
    }

    /// 未知安装方式（unknown）拒绝自动卸载（v1 提示手动）
    #[test]
    fn build_uninstall_unknown_method_rejected() {
        let err = build_uninstall_script("pi", "unknown", false).unwrap_err();
        assert!(err.contains("unsupported uninstall method"), "got: {err}");
    }

    /// 白名单外 cli 名拒绝（无用户自由输入拼接面）
    #[test]
    fn build_uninstall_unknown_cli_rejected() {
        assert!(build_uninstall_script("rm -rf /", "npm-global", false).is_err());
        assert!(build_uninstall_script("", "npm-global", false).is_err());
        assert!(build_uninstall_script("gemini", "native", true).is_err());
    }
}
