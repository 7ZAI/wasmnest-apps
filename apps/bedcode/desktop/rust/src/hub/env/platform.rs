//! 双平台命令构造与输出解析（纯函数，双形态可测）
//!
//! **平台判定一律走 `windows: bool` 入参**（照 P0 的教训：wasm32-wasip3 guest
//! 上编译期 `cfg!(windows)` 恒 false，用它选脚本会让 Windows 拿到 POSIX 命令）。
//! 本模块不含任何宿主调用，也不读全局平台状态——命令形态完全由入参决定，
//! 因此在 Linux 宿主机上跑单测就能同时覆盖 Windows / Linux 两套形态。
//!
//! 每条命令都在 `host-process` 内执行：`stdin = null`、无窗口，不得依赖任何
//! 交互（`curl` 必须 `-f`，`wget` 必须非交互，PowerShell 必须 `-NoProfile`）。

/// 一条待执行命令（program + args，与 `host-process` request 同形）
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Cmd {
    pub program: String,
    pub args: Vec<String>,
}

impl Cmd {
    fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.to_string(),
            args: args.iter().map(|a| a.to_string()).collect(),
        }
    }

    fn owned(program: String, args: Vec<String>) -> Self {
        Self { program, args }
    }
}

/// preflight 采集结果（架构 / 可用工具 / 磁盘可用字节）
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Preflight {
    pub arch: String,
    /// 可用工具 id（`curl` / `wget` / `tar` / `certutil` / `powershell` /
    /// `sha256sum` / `shasum` / `openssl`）
    pub tools: Vec<String>,
    /// 磁盘可用字节；0 = 采集不到（不据此拒绝，只记日志）
    pub free_bytes: u64,
}

impl Preflight {
    pub(crate) fn has(&self, tool: &str) -> bool {
        self.tools.iter().any(|t| t == tool)
    }

    /// 下载工具至少一路（Windows：curl / powershell / certutil；Linux：curl / wget）
    pub(crate) fn can_download(&self, windows: bool) -> bool {
        if windows {
            self.has("curl") || self.has("powershell") || self.has("certutil")
        } else {
            self.has("curl") || self.has("wget")
        }
    }

    /// 校验工具至少一路（Windows：certutil / powershell；Linux：sha256sum / shasum / openssl）
    pub(crate) fn can_verify(&self, windows: bool) -> bool {
        if windows {
            self.has("certutil") || self.has("powershell")
        } else {
            self.has("sha256sum") || self.has("shasum") || self.has("openssl")
        }
    }

    /// 解压工具至少一路（Windows：tar / powershell；Linux：tar 必须）
    pub(crate) fn can_extract(&self, windows: bool) -> bool {
        if windows {
            self.has("tar") || self.has("powershell")
        } else {
            self.has("tar")
        }
    }
}

// ==================== preflight ====================

/// preflight 采集脚本（单次进程跑完所有事实，减少异步往返）。
///
/// Windows：`cmd /C` 链式（`&` 串接不因单条失败中断；`2>nul` 抑制未装报错）。
/// Linux：`bash -lc`，`command -v` 命中即输出路径、未命中无输出。
/// 分段标记与解析层（[`parse_preflight`]）逐段对应。
pub(crate) fn preflight_script(windows: bool) -> String {
    if windows {
        concat!(
            "echo == arch == & echo %PROCESSOR_ARCHITECTURE%",
            " & echo == curl == & where curl.exe 2>nul",
            " & echo == tar == & where tar.exe 2>nul",
            " & echo == certutil == & where certutil.exe 2>nul",
            " & echo == powershell == & where powershell.exe 2>nul",
            " & echo == disk_bytes == & powershell -NoProfile -Command \"[math]::Floor((Get-PSDrive -Name ($env:SystemDrive).Substring(0,1)).Free)\" 2>nul",
        )
        .to_string()
    } else {
        concat!(
            "echo '== arch =='\nuname -m 2>/dev/null\n",
            "echo '== curl =='\ncommand -v curl 2>/dev/null\n",
            "echo '== wget =='\ncommand -v wget 2>/dev/null\n",
            "echo '== tar =='\ncommand -v tar 2>/dev/null\n",
            "echo '== sha256sum =='\ncommand -v sha256sum 2>/dev/null\n",
            "echo '== shasum =='\ncommand -v shasum 2>/dev/null\n",
            "echo '== openssl =='\ncommand -v openssl 2>/dev/null\n",
            "echo '== disk_kb =='\ndf -Pk \"$HOME\" 2>/dev/null | tail -n 1\n",
        )
        .to_string()
    }
}

/// 未安装 / 找不到工具的报错行识别（双平台文案）：命中即「该工具不可用」
fn is_missing_tool_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("not found")
        || lower.contains("not recognized")
        || lower.contains("could not find")
        || lower.contains("info:")
        || line.contains("未找到")
        || line.contains("不是内部或外部命令")
        || line.contains("无法找到")
}

/// preflight 输出解析：分段取首个有效行；工具段只要有非报错行即视为可用
pub(crate) fn parse_preflight(output: &str) -> Preflight {
    let mut out = Preflight::default();
    let mut section = "";
    for raw in output.lines() {
        let line = raw.trim();
        if let Some(name) = section_marker(line) {
            section = name;
            continue;
        }
        if line.is_empty() {
            continue;
        }
        match section {
            "arch" => {
                if out.arch.is_empty() {
                    out.arch = line.to_string();
                }
            }
            "disk_bytes" => {
                if out.free_bytes == 0 {
                    out.free_bytes = first_u64(line).unwrap_or(0);
                }
            }
            "disk_kb" => {
                // `df -Pk` 行：Filesystem 1024-blocks Used Available Capacity Mounted
                if out.free_bytes == 0 {
                    if let Some(kb) = line.split_whitespace().nth(3).and_then(parse_u64) {
                        out.free_bytes = kb.saturating_mul(1024);
                    }
                }
            }
            "" => {}
            tool => {
                if !is_missing_tool_line(line) && !out.tools.iter().any(|t| t == tool) {
                    out.tools.push(tool.to_string());
                }
            }
        }
    }
    out
}

/// `== xxx ==` 段标记识别（返回段名）
fn section_marker(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("== ")?.strip_suffix(" ==")?;
    let name = rest.trim();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn parse_u64(s: &str) -> Option<u64> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// 行内首个整数（PowerShell 输出可能带换行之外的空白/引号）
fn first_u64(s: &str) -> Option<u64> {
    s.split_whitespace().find_map(parse_u64)
}

// ==================== 下载 ====================

/// 下载尝试链（按顺序逐个尝试，每源内每形态至多 1 次）。
///
/// 只保留 preflight 证明可用的工具；全部不可用 → 空列表（调用方报
/// `unsupported-platform`，不尝试静默跳过）。
pub(crate) fn download_attempts(
    windows: bool,
    pre: &Preflight,
    url: &str,
    dest: &str,
) -> Vec<Cmd> {
    let mut out = Vec::new();
    if windows {
        if pre.has("curl") {
            out.push(Cmd::new(
                "curl.exe",
                &[
                    "-fL",
                    "--retry",
                    "3",
                    "--retry-delay",
                    "2",
                    "--connect-timeout",
                    "10",
                    "-o",
                    dest,
                    url,
                ],
            ));
        }
        if pre.has("powershell") {
            out.push(Cmd::owned(
                "powershell".to_string(),
                vec![
                    "-NoProfile".into(),
                    "-ExecutionPolicy".into(),
                    "Bypass".into(),
                    "-Command".into(),
                    format!(
                        "Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
                        url, dest
                    ),
                ],
            ));
        }
        if pre.has("certutil") {
            out.push(Cmd::new(
                "certutil.exe",
                &["-urlcache", "-split", "-f", url, dest],
            ));
        }
    } else {
        if pre.has("curl") {
            out.push(Cmd::new(
                "curl",
                &[
                    "-fL",
                    "--retry",
                    "3",
                    "--retry-delay",
                    "2",
                    "--connect-timeout",
                    "10",
                    "-o",
                    dest,
                    url,
                ],
            ));
        }
        if pre.has("wget") {
            out.push(Cmd::new(
                "wget",
                &["-q", "--tries=3", "-O", dest, url],
            ));
        }
    }
    out
}

// ==================== 校验 ====================

/// 校验尝试链（每个尝试的输出都交给 [`parse_sha256`] 统一解析）
pub(crate) fn verify_attempts(windows: bool, pre: &Preflight, file: &str) -> Vec<Cmd> {
    let mut out = Vec::new();
    if windows {
        if pre.has("certutil") {
            out.push(Cmd::new("certutil.exe", &["-hashfile", file, "SHA256"]));
        }
        if pre.has("powershell") {
            out.push(Cmd::owned(
                "powershell".to_string(),
                vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    format!("(Get-FileHash -Algorithm SHA256 -LiteralPath '{}').Hash", file),
                ],
            ));
        }
    } else {
        if pre.has("sha256sum") {
            out.push(Cmd::new("sha256sum", &[file]));
        }
        if pre.has("shasum") {
            out.push(Cmd::new("shasum", &["-a", "256", file]));
        }
        if pre.has("openssl") {
            out.push(Cmd::new("openssl", &["dgst", "-sha256", file]));
        }
    }
    out
}

/// 从校验命令输出里取 SHA256：第一个「恰好 64 位十六进制」的 token，转小写。
///
/// 覆盖三种形态：
/// - `certutil -hashfile`：`SHA256 hash of x:\r\n<hex>\r\nCertUtil: ...`（首行是
///   `SHA256 hash of ...`，不是 64 位 hex，自然跳过）
/// - `sha256sum` / `shasum`：`<hex>  <file>`
/// - `openssl dgst -sha256`：`SHA2-256(file)= <hex>`
/// - `Get-FileHash`：只有一行 `<HEX>`
pub(crate) fn parse_sha256(output: &str) -> Option<String> {
    for token in output.split(|c: char| c.is_whitespace() || c == '=' || c == '"' || c == '\'') {
        let token = token.trim();
        if token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(token.to_ascii_lowercase());
        }
    }
    None
}

// ==================== 解压 ====================

/// 解压尝试链（归档格式决定首选；Windows zip 用 bsdtar，兜底 Expand-Archive）
pub(crate) fn extract_attempts(
    windows: bool,
    pre: &Preflight,
    archive: super::sources::Archive,
    file: &str,
    tmp: &str,
) -> Vec<Cmd> {
    use super::sources::Archive;
    let mut out = Vec::new();
    if windows {
        if pre.has("tar") {
            out.push(Cmd::new("tar.exe", &["-xf", file, "-C", tmp]));
        }
        if pre.has("powershell") {
            out.push(Cmd::owned(
                "powershell".to_string(),
                vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    format!(
                        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                        file, tmp
                    ),
                ],
            ));
        }
    } else {
        // gzip / xz 都走 tar；xz 只在 gz 产物不可达时才会被选到
        let flag = match archive {
            Archive::TarXz => "-xJf",
            _ => "-xzf",
        };
        if pre.has("tar") {
            out.push(Cmd::new("tar", &[flag, file, "-C", tmp]));
        }
    }
    out
}

// ==================== 落位 / 清理 / 探测 ====================

/// 目录创建脚本（`runtime/node` / `cache` / `npm-global` 先建好，后续 move 才有父目录）
pub(crate) fn mkdir_script(windows: bool, dirs: &[String]) -> String {
    if windows {
        dirs.iter()
            .map(|d| format!("if not exist \"{}\" mkdir \"{}\"", d, d))
            .collect::<Vec<_>>()
            .join(" & ")
    } else {
        let list = dirs
            .iter()
            .map(|d| crate::hub::util::sh_quote(d))
            .collect::<Vec<_>>()
            .join(" ");
        format!("mkdir -p {list}")
    }
}

/// 清理脚本（临时目录 / `.part` 文件；尽力而为，失败不影响主流程）。
///
/// Windows 用 `rd`（目录）+ `del`（文件）两条都发，`2>nul` 吞掉不适用的那条；
/// unix `rm -rf` 对两者通吃。
pub(crate) fn cleanup_script(windows: bool, paths: &[String]) -> String {
    if windows {
        paths
            .iter()
            .map(|p| format!("if exist \"{p}\" (rd /S /Q \"{p}\" 2>nul) & del /F /Q \"{p}\" 2>nul"))
            .collect::<Vec<_>>()
            .join(" & ")
    } else {
        let list = paths
            .iter()
            .map(|p| crate::hub::util::sh_quote(p))
            .collect::<Vec<_>>()
            .join(" ");
        format!("rm -rf {list}")
    }
}

/// 单文件重命名脚本（`.part` → 正式缓存文件）；成功即视为下载完成
pub(crate) fn rename_script(windows: bool, src: &str, dst: &str) -> String {
    if windows {
        format!("move /Y \"{src}\" \"{dst}\"")
    } else {
        format!(
            "mv -f {} {}",
            crate::hub::util::sh_quote(src),
            crate::hub::util::sh_quote(dst)
        )
    }
}

/// 解压产物落位脚本：把归档顶层目录整体移到 `runtime/node/<ver>`。
///
/// 目标已存在且可执行（`node.exe` / `bin/node` 在）→ 直接复用（重试/重装幂等），
/// 不覆盖已生效的运行时（升级由 P4 的「换目录 + 摘旧 PATH」负责，不走这里）。
/// 目标存在但**不完整**（上次中断留下的半截目录）→ 先删掉再 move：
/// 否则 `mv` / `move` 会把源目录塞进目标目录里面，变成嵌套两层。
pub(crate) fn place_script(windows: bool, tmp: &str, top: &str, dst: &str) -> String {
    if windows {
        format!(
            "if exist \"{dst}\\node.exe\" (echo == reuse ==) else (rd /S /Q \"{dst}\" 2>nul & move /Y \"{tmp}\\{top}\" \"{dst}\")"
        )
    } else {
        format!(
            "if [ -x {probe} ]; then echo '== reuse =='; else rm -rf {dst}; mv {src} {dst}; fi",
            probe = crate::hub::util::sh_quote(&format!("{dst}/bin/node")),
            dst = crate::hub::util::sh_quote(dst),
            src = crate::hub::util::sh_quote(&format!("{tmp}/{top}")),
        )
    }
}

/// 「文件是否已存在」检测脚本（缓存命中判定；`== hit ==` 即命中）。
///
/// 用 shell 而不是 `host-fs`：`~/.wasmnest/bedcode/hub/cache` 不在宿主第一方免审
/// 清单里，走 `fs_exists` 会弹目录授权框——引导流程不该为了「看一眼缓存」弹框。
pub(crate) fn file_exists_script(windows: bool, path: &str) -> String {
    if windows {
        format!("if exist \"{path}\" (echo == hit ==)")
    } else {
        format!("if [ -f {p} ]; then echo '== hit =='; fi", p = crate::hub::util::sh_quote(path))
    }
}

/// 缓存命中标记（[`file_exists_script`] 的输出判据）
pub(crate) const FILE_EXISTS_MARK: &str = "== hit ==";

/// 目录条目列举脚本（只列名字，一行一个）。
///
/// 用于 `runtime/node` 下的版本目录清点（移除环境 / 升级清理旧版本）与
/// `cache` 下的旧产物清理：`~/.wasmnest/bedcode/hub` 不在宿主第一方免审清单里，
/// 走 `host-fs` 的 `fs_read_dir` 会弹目录授权框，故一律经 shell。
pub(crate) fn list_dir_script(windows: bool, dir: &str) -> String {
    if windows {
        format!("dir /b /ad \"{dir}\" 2>nul & dir /b /a-d \"{dir}\" 2>nul")
    } else {
        format!("ls -1 {dir} 2>/dev/null", dir = crate::hub::util::sh_quote(dir))
    }
}

/// 列举输出解析：一行一个名字（去 `\r`、去空白、丢空行）
pub(crate) fn parse_dir_names(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim().trim_end_matches('\r').trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect()
}

/// 版本目录名判据：`v` + 数字开头（`v24.22.1` …）。
///
/// 只删认得的名字：`runtime/node` 下若混入用户自建目录，不得被移除流程误删。
pub(crate) fn is_version_dir_name(name: &str) -> bool {
    let rest = match name.strip_prefix('v').or_else(|| name.strip_prefix('V')) {
        Some(r) => r,
        None => return false,
    };
    rest.chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit())
}

/// 落位后自检：直接跑解压出来的 node，确认产物可用（失败 = `extract-failed`）
pub(crate) fn node_probe_cmd(windows: bool, node_dir: &str) -> Cmd {
    if windows {
        Cmd::owned(format!("{node_dir}\\node.exe"), vec!["--version".into()])
    } else {
        Cmd::owned(format!("{node_dir}/bin/node"), vec!["--version".into()])
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::super::sources::Archive;
    use super::*;

    fn pre(tools: &[&str]) -> Preflight {
        Preflight {
            arch: "x86_64".to_string(),
            tools: tools.iter().map(|t| t.to_string()).collect(),
            free_bytes: 1_000_000_000,
        }
    }

    /// preflight 双形态：Windows 只有 cmd 片段，Linux 只有 POSIX 片段
    #[test]
    fn preflight_script_forms() {
        let win = preflight_script(true);
        assert!(win.contains("%PROCESSOR_ARCHITECTURE%"));
        assert!(win.contains("where curl.exe"));
        assert!(win.contains("where powershell.exe"));
        assert!(win.contains("== disk_bytes =="));
        assert!(!win.contains("uname -m"));
        assert!(!win.contains("command -v"));

        let unix = preflight_script(false);
        assert!(unix.contains("uname -m"));
        assert!(unix.contains("command -v sha256sum"));
        assert!(unix.contains("== disk_kb =="));
        assert!(!unix.contains("%PROCESSOR_ARCHITECTURE%"));
        assert!(!unix.contains("where "));
    }

    /// Windows preflight 解析：`where` 命中行 → 工具可用；`INFO: Could not find`
    /// 不算可用；PowerShell 磁盘字节原样解析
    #[test]
    fn parse_preflight_windows() {
        let out = "== arch ==\r\nAMD64\r\n== curl ==\r\nC:\\Windows\\System32\\curl.exe\r\n== tar ==\r\nC:\\Windows\\System32\\tar.exe\r\n== certutil ==\r\nC:\\Windows\\System32\\certutil.exe\r\n== powershell ==\r\nINFO: Could not find files for the given pattern(s).\r\n== disk_bytes ==\r\n123456789\r\n";
        let p = parse_preflight(out);
        assert_eq!(p.arch, "AMD64");
        assert!(p.has("curl"));
        assert!(p.has("tar"));
        assert!(p.has("certutil"));
        assert!(!p.has("powershell"), "INFO 行不是可用证据");
        assert_eq!(p.free_bytes, 123_456_789);
        assert!(p.can_download(true));
        assert!(p.can_verify(true));
        assert!(p.can_extract(true));
    }

    /// Linux preflight 解析：`command -v` 未命中无输出 → 工具不可用；
    /// `df -Pk` 第 4 列（1024 块）换算成字节
    #[test]
    fn parse_preflight_unix() {
        let out = "== arch ==\naarch64\n== curl ==\n/usr/bin/curl\n== wget ==\n== tar ==\n/usr/bin/tar\n== sha256sum ==\n/usr/bin/sha256sum\n== shasum ==\n== openssl ==\n/usr/bin/openssl\n== disk_kb ==\n/dev/sda1 123456 1000 100000 1% /\n";
        let p = parse_preflight(out);
        assert_eq!(p.arch, "aarch64");
        assert!(p.has("curl"));
        assert!(!p.has("wget"));
        assert!(p.can_download(false));
        assert!(p.can_verify(false));
        assert!(p.can_extract(false));
        assert_eq!(p.free_bytes, 100_000 * 1024);
    }

    /// 工具全缺 → 三条能力判定全部 false（调用方据此报 unsupported-platform）
    #[test]
    fn parse_preflight_empty_means_incapable() {
        let p = parse_preflight("== arch ==\nAMD64\n");
        assert!(!p.can_download(true));
        assert!(!p.can_verify(true));
        assert!(!p.can_extract(true));
        assert_eq!(p.free_bytes, 0, "采集不到磁盘空间不构成拒绝理由");
    }

    /// 下载命令链：只保留可用工具，顺序为 curl → powershell → certutil（Windows）
    #[test]
    fn download_chain_windows() {
        let cmds = download_attempts(
            true,
            &pre(&["curl", "powershell", "certutil"]),
            "https://nodejs.org/dist/v24.22.1/x.zip",
            "C:/cfg/cache/x.part",
        );
        assert_eq!(cmds.len(), 3);
        assert_eq!(cmds[0].program, "curl.exe");
        assert!(cmds[0].args.contains(&"-fL".to_string()));
        assert!(cmds[0].args.contains(&"C:/cfg/cache/x.part".to_string()));
        assert_eq!(cmds[1].program, "powershell");
        assert!(cmds[1].args.iter().any(|a| a.contains("Invoke-WebRequest")));
        assert_eq!(cmds[2].program, "certutil.exe");

        // 只有 certutil 时只剩最后一路
        let only_cert = download_attempts(true, &pre(&["certutil"]), "https://x/y.zip", "f");
        assert_eq!(only_cert.len(), 1);
        assert_eq!(only_cert[0].program, "certutil.exe");
    }

    /// 下载命令链 Linux：curl → wget；无工具 → 空（不静默跳过）
    #[test]
    fn download_chain_unix() {
        let cmds = download_attempts(
            false,
            &pre(&["curl", "wget"]),
            "https://nodejs.org/dist/v24.22.1/x.tar.gz",
            "/h/.wasmnest/bedcode/hub/cache/x.part",
        );
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0].program, "curl");
        assert_eq!(cmds[1].program, "wget");
        assert!(cmds[1].args.contains(&"--tries=3".to_string()));

        assert!(download_attempts(false, &pre(&[]), "https://x/y", "f").is_empty());
    }

    /// 校验命令链：Windows certutil → powershell；Linux sha256sum → shasum → openssl
    #[test]
    fn verify_chain_both_platforms() {
        let win = verify_attempts(true, &pre(&["certutil", "powershell"]), "C:/c/x.zip");
        assert_eq!(win.len(), 2);
        assert_eq!(win[0].program, "certutil.exe");
        assert_eq!(win[0].args, vec!["-hashfile", "C:/c/x.zip", "SHA256"]);
        assert!(win[1].args.iter().any(|a| a.contains("Get-FileHash")));

        let unix = verify_attempts(false, &pre(&["sha256sum", "shasum", "openssl"]), "/c/x.tar.gz");
        assert_eq!(unix.len(), 3);
        assert_eq!(unix[0].program, "sha256sum");
        assert_eq!(unix[1].args, vec!["-a", "256", "/c/x.tar.gz"]);
        assert_eq!(unix[2].args, vec!["dgst", "-sha256", "/c/x.tar.gz"]);
    }

    /// 三种校验输出解析（certutil 多行 / sha256sum / Get-FileHash 大写 / openssl）
    #[test]
    fn parse_sha256_forms() {
        let hex = "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5";

        let certutil = format!(
            "SHA256 hash of C:\\c\\x.zip:\r\n{}\r\nCertUtil: -hashfile command completed successfully.\r\n",
            hex
        );
        assert_eq!(parse_sha256(&certutil).as_deref(), Some(hex));

        assert_eq!(
            parse_sha256(&format!("{hex}  /c/x.tar.gz\n")).as_deref(),
            Some(hex)
        );
        assert_eq!(
            parse_sha256(&format!("SHA2-256(/c/x.tar.gz)= {hex}\n")).as_deref(),
            Some(hex)
        );
        // Get-FileHash 输出大写
        assert_eq!(
            parse_sha256(&hex.to_uppercase()).as_deref(),
            Some(hex)
        );

        assert_eq!(parse_sha256("CertUtil: -hashfile command FAILED"), None);
        assert_eq!(parse_sha256(""), None);
    }

    /// 解压命令链：zip 双形态（tar → Expand-Archive）；Linux xz 用 -xJf，gz 用 -xzf
    #[test]
    fn extract_chain_both_platforms() {
        let win = extract_attempts(
            true,
            &pre(&["tar", "powershell"]),
            Archive::Zip,
            "C:/c/x.zip",
            "C:/c/tmp",
        );
        assert_eq!(win.len(), 2);
        assert_eq!(win[0].program, "tar.exe");
        assert_eq!(win[0].args, vec!["-xf", "C:/c/x.zip", "-C", "C:/c/tmp"]);
        assert!(win[1].args.iter().any(|a| a.contains("Expand-Archive")));

        let gz = extract_attempts(false, &pre(&["tar"]), Archive::TarGz, "/c/x.gz", "/c/tmp");
        assert_eq!(gz[0].args[0], "-xzf");
        let xz = extract_attempts(false, &pre(&["tar"]), Archive::TarXz, "/c/x.xz", "/c/tmp");
        assert_eq!(xz[0].args[0], "-xJf");

        // Linux 无 tar → 空（解压不可能，调用方 fail-visible）
        assert!(extract_attempts(false, &pre(&["curl"]), Archive::TarGz, "a", "b").is_empty());
    }

    /// 清理脚本双形态：Windows 目录/文件两条命令都发；Linux `rm -rf` 通吃
    #[test]
    fn cleanup_script_forms() {
        let win = cleanup_script(true, &["C:/c/tmp".to_string()]);
        assert!(win.contains("rd /S /Q"));
        assert!(win.contains("del /F /Q"));

        let unix = cleanup_script(false, &["/c/tmp".to_string(), "/c/x.part".to_string()]);
        assert!(unix.starts_with("rm -rf"));
        assert!(unix.contains("'/c/tmp'"));
        assert!(unix.contains("'/c/x.part'"));
    }

    /// 落位脚本：目标已存在 → 复用（不覆盖已生效运行时）；否则整目录 move；
    /// 目标存在但不完整时先删（防止 move 变成嵌套目录）
    #[test]
    fn place_script_forms() {
        let win = place_script(true, "C:/c/tmp", "node-v24.22.1-win-x64", "C:/r/v24.22.1");
        assert!(win.contains("if exist \"C:/r/v24.22.1\\node.exe\""));
        assert!(win.contains("rd /S /Q \"C:/r/v24.22.1\""));
        assert!(win.contains("move /Y \"C:/c/tmp\\node-v24.22.1-win-x64\""));

        let unix = place_script(false, "/c/tmp", "node-v24.22.1-linux-x64", "/r/v24.22.1");
        assert!(unix.contains("[ -x '/r/v24.22.1/bin/node' ]"));
        assert!(unix.contains("rm -rf '/r/v24.22.1'"));
        assert!(unix.contains("mv '/c/tmp/node-v24.22.1-linux-x64' '/r/v24.22.1'"));
    }

    /// 缓存命中检测：双平台形态 + 命中标记
    #[test]
    fn file_exists_script_forms() {
        let win = file_exists_script(true, "C:/c/x.zip");
        assert!(win.contains("if exist \"C:/c/x.zip\""));
        assert!(win.contains(FILE_EXISTS_MARK));

        let unix = file_exists_script(false, "/c/x.tar.gz");
        assert!(unix.contains("if [ -f '/c/x.tar.gz' ]"));
        assert!(unix.contains(FILE_EXISTS_MARK));
    }

    /// 落位后自检命令：Windows 直指 node.exe，Linux 走 bin/node
    #[test]
    fn node_probe_cmd_forms() {
        let win = node_probe_cmd(true, "C:/r/v24.22.1");
        assert_eq!(win.program, "C:/r/v24.22.1\\node.exe");
        assert_eq!(win.args, vec!["--version"]);

        let unix = node_probe_cmd(false, "/r/v24.22.1");
        assert_eq!(unix.program, "/r/v24.22.1/bin/node");
    }

    /// mkdir 脚本：Windows `if not exist` 保护，Linux `mkdir -p` + 单引号转义
    #[test]
    fn mkdir_script_forms() {
        let win = mkdir_script(true, &["C:/r".to_string()]);
        assert!(win.contains("if not exist \"C:/r\" mkdir \"C:/r\""));
        let unix = mkdir_script(false, &["/r".to_string()]);
        assert!(unix.contains("mkdir -p '/r'"));
    }

    /// 目录列举脚本双形态：Windows 目录+文件两段（cache 是文件、runtime 是目录），
    /// Linux 单条 `ls -1` + 单引号转义
    #[test]
    fn list_dir_script_forms() {
        let win = list_dir_script(true, "C:/r/runtime/node");
        assert!(win.contains("dir /b /ad \"C:/r/runtime/node\""));
        assert!(win.contains("dir /b /a-d \"C:/r/runtime/node\""));
        assert!(!win.contains("ls -1"));

        let unix = list_dir_script(false, "/r/runtime/node");
        assert_eq!(unix, "ls -1 '/r/runtime/node' 2>/dev/null");
    }

    /// 列举输出解析：CRLF / 空行 / 首尾空白都不进结果
    #[test]
    fn parse_dir_names_trims_noise() {
        assert_eq!(
            parse_dir_names("v24.22.1\r\n\r\n  v22.0.0  \r\n"),
            vec!["v24.22.1".to_string(), "v22.0.0".to_string()]
        );
        assert_eq!(
            parse_dir_names("node-v24.22.1-linux-x64.tar.gz.part\n"),
            vec!["node-v24.22.1-linux-x64.tar.gz.part".to_string()]
        );
        assert!(parse_dir_names("").is_empty());
    }

    /// 版本目录判据：只认 `v<数字>`；用户自建目录 / 临时目录 / 缓存文件都不算
    #[test]
    fn version_dir_name_gate() {
        assert!(is_version_dir_name("v24.22.1"));
        assert!(is_version_dir_name("V22"));
        assert!(!is_version_dir_name("node"));
        assert!(!is_version_dir_name(".tmp-3"));
        assert!(!is_version_dir_name("v"));
        assert!(!is_version_dir_name("vNext"));
        assert!(!is_version_dir_name("node-v24.22.1-linux-x64.tar.gz"));
    }
}
