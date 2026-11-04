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
use crate::hub::agents::{self, Agent};

/// 副本所属管理器（C 口径：Hub 的 npm-global 更新只写自持 prefix，生效副本
/// 由外部管理器持有时不由 Hub 自动更新，只给原地更新命令）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Owner {
    /// 适配器声明的原生安装（如 claude `~/.local/bin`）
    Native,
    /// 适配器声明的 standalone安装（如 opencode `~/.opencode/bin`）
    Standalone,
    /// nvm / fnm 等版本管理器下的 node prefix
    Nvm,
    /// 普通 npm 全局 prefix
    Npm,
    /// pnpm 全局目录（`PNPM_HOME`）
    Pnpm,
    /// Volta
    Volta,
    /// 系统级目录（需提权）
    System,
    /// 认不出来的目录
    Unknown,
}

impl Owner {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Owner::Native => "native",
            Owner::Standalone => "standalone",
            Owner::Nvm => "nvm",
            Owner::Npm => "npm",
            Owner::Pnpm => "pnpm",
            Owner::Volta => "volta",
            Owner::System => "system",
            Owner::Unknown => "unknown",
        }
    }
}

/// 副本归属判定（纯函数）：先按适配器声明的路径特征（native / standalone），
/// 再按 npm 系管理器目录特征。只看**该副本自身路径**，不看 PATH 生效那份的
/// method——两份可能属不同管理器。
pub(crate) fn owner_for_path(agent: &dyn Agent, path: &str, _windows: bool) -> Owner {
    let p = path.to_lowercase();
    for &(needle, method) in agent.path_methods() {
        if p.contains(needle) {
            return match method {
                "native" => Owner::Native,
                "standalone" => Owner::Standalone,
                _ => Owner::Unknown,
            };
        }
    }
    if p.contains("/.local/share/pnpm/") || p.contains("/pnpm/") {
        return Owner::Pnpm;
    }
    if p.contains("/.volta/") {
        return Owner::Volta;
    }
    if is_system_path(&p) {
        return Owner::System;
    }
    if p.contains("/nvm/") || p.contains("/.nvm/") || p.contains("/versions/node/") {
        return Owner::Nvm;
    }
    if p.contains("/.npm-global")
        || p.contains("/npm-global/")
        || p.contains("/node_modules")
        || p.contains("/node-v")
        || p.contains("/roaming/npm/")
        || p.contains("/nodejs/")
        || p.contains("/.local/bin/")
        || p.contains("/.local/")
    {
        return Owner::Npm;
    }
    Owner::Unknown
}

/// 外部副本的原地更新命令（仅供展示/复制，不执行）：无法安全推导时 None
pub(crate) fn external_update_command(
    agent: &dyn Agent,
    owner: Owner,
    path: &str,
    windows: bool,
    use_mirror: bool,
) -> Option<String> {
    match owner {
        Owner::Native => agent
            .install_recipe("native", true, use_mirror)
            .ok()
            .map(|(script, _)| script),
        Owner::Standalone => agent
            .install_recipe("standalone", true, use_mirror)
            .ok()
            .map(|(script, _)| script),
        Owner::Nvm | Owner::Npm => {
            let prefix = npm_prefix_of(path, agent.binary(), windows)?;
            npm_install_with_prefix(agent.npm_package()?, &prefix, windows, use_mirror)
        }
        Owner::Pnpm => Some(pnpm_install_cmd(agent.npm_package()?, use_mirror)),
        Owner::Volta => Some(format!("volta install {}", agent.npm_package()?)),
        Owner::System | Owner::Unknown => None,
    }
}

/// 外部副本的清理命令（仅供展示/复制，不执行）：无法安全推导时 None
pub(crate) fn external_cleanup_command(
    agent: &dyn Agent,
    owner: Owner,
    path: &str,
    windows: bool,
) -> Option<String> {
    match owner {
        Owner::Native | Owner::Standalone => agent.uninstall_recipe(owner.as_str(), windows).ok(),
        Owner::Nvm | Owner::Npm => {
            let prefix = npm_prefix_of(path, agent.binary(), windows)?;
            shell_quote(&prefix, windows).map(|p| {
                format!(
                    "npm uninstall -g --prefix {p} {}",
                    agent.npm_package().unwrap_or("")
                )
            })
        }
        Owner::Pnpm => Some(format!("pnpm remove -g {}", agent.npm_package()?)),
        Owner::Volta => Some(format!("volta uninstall {}", agent.npm_package()?)),
        Owner::System | Owner::Unknown => None,
    }
}

/// 从二进制路径反推 npm prefix：unix `<prefix>/bin/<bin>`；Windows 为同级目录
fn npm_prefix_of(path: &str, bin: &str, windows: bool) -> Option<String> {
    if windows {
        let (prefix, file) = path.rsplit_once('/')?;
        let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
        if !stem.eq_ignore_ascii_case(bin) {
            return None;
        }
        Some(prefix.to_string())
    } else {
        path.strip_suffix(&format!("/bin/{bin}"))
            .map(str::to_string)
    }
}

/// `npm install -g --prefix <prefix>`（镜像开关追加 `--registry`）
fn npm_install_with_prefix(
    pkg: &str,
    prefix: &str,
    windows: bool,
    use_mirror: bool,
) -> Option<String> {
    let quoted = shell_quote(prefix, windows)?;
    let mirror = if use_mirror {
        format!(" --registry={NPMMIRROR}")
    } else {
        String::new()
    };
    Some(format!("npm install -g --prefix {quoted} {pkg}{mirror}"))
}

/// pnpm 全局安装（镜像开关追加 `--registry`）
fn pnpm_install_cmd(pkg: &str, use_mirror: bool) -> String {
    if use_mirror {
        format!("pnpm add -g {pkg} --registry={NPMMIRROR}")
    } else {
        format!("pnpm add -g {pkg}")
    }
}

/// 路径能否安全进展示命令：引号与 `%`（cmd 无法转义）与控制字符一律拒绝
fn shell_quote(p: &str, windows: bool) -> Option<String> {
    if p.contains('\'') || p.contains('"') || p.contains('%') || p.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(if windows {
        format!("\"{}\"", p.replace('/', "\\"))
    } else {
        format!("'{p}'")
    })
}

/// 系统级目录：写它们需要提权，不给「复制即执行」的命令
fn is_system_path(p: &str) -> bool {
    p.starts_with("/usr/")
        || p.starts_with("/opt/")
        || p.starts_with("/nix/")
        || p.starts_with("/snap/")
        || p.contains("/program files/")
        || p.contains("/program files (x86)/")
}

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

    // ==================== 外部副本归属与命令（C 口径） ====================

    fn agent(id: &str) -> &'static dyn Agent {
        agents::get(id).unwrap_or_else(|| panic!("agent not registered: {id}"))
    }

    /// 归属判定：适配器声明优先；nvm / pnpm / volta / 系统 / 未知
    #[test]
    fn owner_for_path_matrix() {
        let pi = agent("pi");
        assert_eq!(
            owner_for_path(
                pi,
                "/home/u/.config/nvm/versions/node/v24.20.0/bin/pi",
                false
            ),
            Owner::Nvm
        );
        assert_eq!(
            owner_for_path(pi, "/home/u/.local/bin/pi", false),
            Owner::Npm
        );
        assert_eq!(
            owner_for_path(pi, "/home/u/.local/share/pnpm/bin/pi", false),
            Owner::Pnpm
        );
        assert_eq!(
            owner_for_path(pi, "/home/u/.volta/bin/pi", false),
            Owner::Volta
        );
        assert_eq!(
            owner_for_path(pi, "/usr/local/bin/pi", false),
            Owner::System
        );
        assert_eq!(owner_for_path(pi, "/home/u/bin/pi", false), Owner::Unknown);
        assert_eq!(
            owner_for_path(pi, "C:/Users/u/AppData/Roaming/npm/pi.cmd", true),
            Owner::Npm
        );
        assert_eq!(
            owner_for_path(pi, "C:/Users/u/AppData/Roaming/nvm/v24.20.0/pi.cmd", true),
            Owner::Nvm
        );
        // 适配器声明优先：claude native / opencode standalone
        assert_eq!(
            owner_for_path(agent("claude"), "/home/u/.local/bin/claude", false),
            Owner::Native
        );
        assert_eq!(
            owner_for_path(agent("opencode"), "/home/u/.opencode/bin/opencode", false),
            Owner::Standalone
        );
    }

    /// 外部副本原地更新命令：nvm/npm → `npm --prefix`；pnpm/volta 各自命令；
    /// 系统/未知不给命令；native/standalone 用适配器 recipe
    #[test]
    fn external_update_commands() {
        let pi = agent("pi");
        assert_eq!(
            external_update_command(
                pi,
                Owner::Nvm,
                "/home/u/.config/nvm/versions/node/v24.20.0/bin/pi",
                false,
                false
            ),
            Some(
                "npm install -g --prefix '/home/u/.config/nvm/versions/node/v24.20.0' @earendil-works/pi-coding-agent"
                    .to_string()
            )
        );
        assert_eq!(
            external_update_command(
                pi,
                Owner::Pnpm,
                "/home/u/.local/share/pnpm/bin/pi",
                false,
                true
            ),
            Some(
                "pnpm add -g @earendil-works/pi-coding-agent --registry=https://registry.npmmirror.com"
                    .to_string()
            )
        );
        assert_eq!(
            external_update_command(pi, Owner::Volta, "/home/u/.volta/bin/pi", false, false),
            Some("volta install @earendil-works/pi-coding-agent".to_string())
        );
        assert_eq!(
            external_update_command(pi, Owner::System, "/usr/bin/pi", false, false),
            None
        );
        assert_eq!(
            external_update_command(pi, Owner::Unknown, "/home/u/bin/pi", false, false),
            None
        );
        // Windows：前缀转反斜杠 + 双引号
        assert_eq!(
            external_update_command(
                pi,
                Owner::Nvm,
                "C:/Users/u/AppData/Roaming/nvm/v24.20.0/pi.cmd",
                true,
                false
            ),
            Some(
                "npm install -g --prefix \"C:\\Users\\u\\AppData\\Roaming\\nvm\\v24.20.0\" @earendil-works/pi-coding-agent"
                    .to_string()
            )
        );
        assert_eq!(
            external_update_command(
                agent("claude"),
                Owner::Native,
                "/home/u/.local/bin/claude",
                false,
                false
            ),
            Some("claude update".to_string())
        );
    }

    /// 外部副本清理命令：与更新同源归属；native/standalone 用适配器卸载 recipe
    #[test]
    fn external_cleanup_commands() {
        let pi = agent("pi");
        assert_eq!(
            external_cleanup_command(
                pi,
                Owner::Nvm,
                "/home/u/.config/nvm/versions/node/v24.20.0/bin/pi",
                false
            ),
            Some(
                "npm uninstall -g --prefix '/home/u/.config/nvm/versions/node/v24.20.0' @earendil-works/pi-coding-agent"
                    .to_string()
            )
        );
        assert_eq!(
            external_cleanup_command(pi, Owner::Pnpm, "/home/u/.local/share/pnpm/bin/pi", false),
            Some("pnpm remove -g @earendil-works/pi-coding-agent".to_string())
        );
        assert_eq!(
            external_cleanup_command(pi, Owner::Volta, "/home/u/.volta/bin/pi", false),
            Some("volta uninstall @earendil-works/pi-coding-agent".to_string())
        );
        assert_eq!(
            external_cleanup_command(pi, Owner::System, "/usr/bin/pi", false),
            None
        );
        assert_eq!(
            external_cleanup_command(
                agent("claude"),
                Owner::Native,
                "/home/u/.local/bin/claude",
                false
            )
            .as_deref()
            .is_some_and(|c| c.contains("rm -f")),
            true
        );
        assert_eq!(
            external_cleanup_command(
                agent("opencode"),
                Owner::Standalone,
                "/home/u/.opencode/bin/opencode",
                false
            ),
            Some("opencode uninstall --force".to_string())
        );
    }
}
