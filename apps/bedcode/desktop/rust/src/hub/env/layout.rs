//! 引导产物目录布局（纯函数，双平台可测）
//!
//! 全部落在插件自有数据目录内（`~/.wasmnest/bedcode/hub/`，两端同构）：
//!
//! ```text
//! cache/<fileName>           下载缓存（校验通过后保留，供重装）
//! runtime/node/<version>/    解压产物（node / npm / node_modules/npm）
//! runtime/node/.tmp-<seq>/   解压临时目录（失败 / 取消即删）
//! npm-global/                npm 全局 prefix（Windows 用；升级 node 不丢已装 CLI）
//! ```
//!
//! **npm 全局落点与 node 分离**：node 升级 = 换 `runtime/node/<version>` 目录 +
//! 改 PATH 条目，`npm-global` 目录永不随版本变，已装 CLI 不受升级影响。
//! Linux 的 npm prefix 用 `$HOME/.local`（全局 CLI 直接落 `~/.local/bin`，
//! 无需额外 PATH 操作），故 `npm-global` 只在 Windows 使用。
//!
//! 路径一律以 `/` 拼接（与 detect 的路径规范化同口径）：Windows 的 `cmd` /
//! `tar.exe` / `move` 都接受正斜杠；`node.exe` 这种「目录 + 文件名」的拼接
//! 由调用方显式用 `\\`（见 `platform::node_probe_cmd`）。

/// 一次引导使用到的目录集合
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Layout {
    pub windows: bool,
    /// 插件数据目录（`~/.wasmnest/bedcode/hub`）
    pub data_dir: String,
    /// 用户主目录（Linux npm prefix 用）
    pub home: String,
}

impl Layout {
    pub(crate) fn new(windows: bool, data_dir: &str, home: &str) -> Self {
        Self {
            windows,
            data_dir: data_dir.trim_end_matches('/').to_string(),
            home: home.trim_end_matches('/').to_string(),
        }
    }

    pub(crate) fn cache_dir(&self) -> String {
        format!("{}/cache", self.data_dir)
    }

    pub(crate) fn runtime_root(&self) -> String {
        format!("{}/runtime/node", self.data_dir)
    }

    /// 版本目录名即版本号（含 `v` 前缀）：`runtime/node/v24.22.1`
    pub(crate) fn node_dir(&self, version: &str) -> String {
        format!("{}/{}", self.runtime_root(), version)
    }

    /// node 可执行文件所在目录：Windows 是版本目录本身，Linux 是 `bin/`。
    /// PATH 登记（`host-app.register-path`）与脚本 env 前缀都用它。
    pub(crate) fn bin_dir(&self, version: &str) -> String {
        if self.windows {
            self.node_dir(version)
        } else {
            format!("{}/bin", self.node_dir(version))
        }
    }

    /// npm 全局 prefix：Windows 用插件自持目录；Linux 用 `~/.local`
    pub(crate) fn npm_prefix(&self) -> String {
        if self.windows {
            self.npm_global()
        } else {
            format!("{}/.local", self.home)
        }
    }

    pub(crate) fn npm_global(&self) -> String {
        format!("{}/npm-global", self.data_dir)
    }

    pub(crate) fn tmp_dir(&self, seq: u32) -> String {
        format!("{}/.tmp-{}", self.runtime_root(), seq)
    }

    pub(crate) fn cache_file(&self, file: &str) -> String {
        format!("{}/{}", self.cache_dir(), file)
    }

    /// 下载中间文件：`.part` 后缀（校验通过后才 rename 成正式缓存文件）
    pub(crate) fn part_file(&self, file: &str) -> String {
        format!("{}.part", self.cache_file(file))
    }

    /// 进程输出落盘目录：宿主第一方免审（`~/.wasmnest/bedcode/hub/runs`），
    /// 回灌读取不会弹目录授权框
    pub(crate) fn runs_dir(&self) -> String {
        format!("{}/runs", self.data_dir)
    }

    /// 展示 / 写入系统面时的路径形态：Windows 转反斜杠。
    ///
    /// 本模块内部一律 `/` 拼接（与 detect 的路径规范化同口径），但写进
    /// **用户 PATH**（`host-app.register-path`）与 `npm_config_prefix` 的字符串
    /// 会被别的程序直接消费，反斜杠是 Windows 的唯一无歧义形态。
    pub(crate) fn native(&self, path: &str) -> String {
        if self.windows {
            path.replace('/', "\\")
        } else {
            path.to_string()
        }
    }

    /// 本布局的全部路径是否可安全进 shell 脚本：拒绝 `"`（逃出引号）与 `%`
    /// （cmd 命令行上下文无法转义）与控制字符。家目录含这些字符属极端情况，
    /// 命中即 fail-visible 报 `unsupported-platform`，不做静默降级。
    pub(crate) fn script_paths_safe(&self) -> bool {
        let candidates = [
            self.cache_dir(),
            self.runtime_root(),
            self.npm_global(),
            self.runs_dir(),
        ];
        candidates.iter().all(|p| {
            !p.contains('"')
                && !p.contains('%')
                && !p.chars().any(|c| c.is_control())
                && !p.contains('\'')
        })
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    fn linux() -> Layout {
        Layout::new(false, "/home/u/.wasmnest/bedcode/hub", "/home/u")
    }

    fn windows() -> Layout {
        Layout::new(true, "C:/Users/u/.wasmnest/bedcode/hub", "C:/Users/u")
    }

    /// Linux 布局：版本目录 / bin 目录 / 临时目录 / npm prefix（`~/.local`）
    #[test]
    fn linux_layout_paths() {
        let l = linux();
        assert_eq!(
            l.node_dir("v24.22.1"),
            "/home/u/.wasmnest/bedcode/hub/runtime/node/v24.22.1"
        );
        assert_eq!(l.bin_dir("v24.22.1"), format!("{}/bin", l.node_dir("v24.22.1")));
        assert_eq!(l.npm_prefix(), "/home/u/.local");
        assert_eq!(l.tmp_dir(7), format!("{}/.tmp-7", l.runtime_root()));
        assert_eq!(l.runs_dir(), "/home/u/.wasmnest/bedcode/hub/runs");
        assert_eq!(
            l.part_file("node-v24.22.1-linux-x64.tar.gz"),
            "/home/u/.wasmnest/bedcode/hub/cache/node-v24.22.1-linux-x64.tar.gz.part"
        );
    }

    /// Windows 布局：bin 目录 = 版本目录本身；npm prefix = 插件自持 npm-global
    #[test]
    fn windows_layout_paths() {
        let l = windows();
        assert_eq!(l.bin_dir("v24.22.1"), l.node_dir("v24.22.1"));
        assert_eq!(
            l.npm_prefix(),
            "C:/Users/u/.wasmnest/bedcode/hub/npm-global"
        );
        assert_eq!(l.cache_file("x.zip"), "C:/Users/u/.wasmnest/bedcode/hub/cache/x.zip");
    }

    /// 尾斜杠归一：数据目录以 `/` 结尾时不产生双斜杠
    #[test]
    fn trailing_slash_normalized() {
        let l = Layout::new(false, "/home/u/.wasmnest/bedcode/hub/", "/home/u/");
        assert_eq!(l.runs_dir(), "/home/u/.wasmnest/bedcode/hub/runs");
        assert_eq!(l.npm_prefix(), "/home/u/.local");
    }

    /// 原生路径形态：Windows 反斜杠（写 PATH / npm prefix 用），Linux 原样
    #[test]
    fn native_path_form() {
        let w = windows();
        assert_eq!(
            w.native(&w.node_dir("v24.22.1")),
            "C:\\Users\\u\\.wasmnest\\bedcode\\hub\\runtime\\node\\v24.22.1"
        );
        let l = linux();
        assert_eq!(l.native(&l.bin_dir("v24.22.1")), l.bin_dir("v24.22.1"));
    }

    /// 脚本安全闸门：引号 / 百分号 / 控制字符 / 单引号命中的布局拒绝
    #[test]
    fn script_safety_gate() {
        assert!(linux().script_paths_safe());
        assert!(windows().script_paths_safe());
        assert!(!Layout::new(false, "/home/a'b/.wasmnest/bedcode/hub", "/home/a'b").script_paths_safe());
        assert!(!Layout::new(true, "C:/Users/100%/.wasmnest/bedcode/hub", "C:/Users/100%").script_paths_safe());
        assert!(!Layout::new(false, "/home/a\"b/.wasmnest/bedcode/hub", "/home/a\"b").script_paths_safe());
    }
}
