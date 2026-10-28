//! Node.js 引导的版本与来源真源（纯函数，无宿主调用）
//!
//! 版本号与每个平台产物的 `fileName / sha256 / size` 是**编译期常量**：随应用
//! 版本一起升级，运行时不联网查「最新版本」（少一次网络依赖，也让确认弹窗能
//! 在下载前就展示确定的来源与校验值）。
//!
//! 来源顺序只允许以下三个 origin（均为 https；`http://` 一律拒绝，见
//! [`validate_source`]）。2026-10-22 实测三个 origin 对同一文件返回同一字节数；
//! huaweicloud / tencent 对应路径 404，不列入。

/// 引导版本（= 解压目录名，含 `v` 前缀，与官方产物一致）
pub(crate) const NODE_VERSION: &str = "v24.22.1";

/// 「已有 node 可用」的最低主版本：≥ 该版本直接复用，一个字节都不下
pub(crate) const MIN_NODE_MAJOR: u32 = 22;

/// 产物归档格式（决定解压命令，见 `platform::extract_attempts`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Archive {
    Zip,
    TarGz,
    TarXz,
}

impl Archive {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Archive::Zip => "zip",
            Archive::TarGz => "tar.gz",
            Archive::TarXz => "tar.xz",
        }
    }
}

/// 单个目标平台的产物（下载 / 校验 / 解压的全部静态事实）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Target {
    /// 平台标识（`win-x64` / `linux-arm64` …），同时是官方产物名中间段
    pub platform: &'static str,
    pub file: &'static str,
    pub sha256: &'static str,
    /// 字节数；`0` = 未登记（前端显示「—」，不参与任何判定）
    pub size: u64,
    pub archive: Archive,
}

const WIN_X64: Target = Target {
    platform: "win-x64",
    file: "node-v24.22.1-win-x64.zip",
    sha256: "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5",
    size: 37_748_064,
    archive: Archive::Zip,
};

const WIN_ARM64: Target = Target {
    platform: "win-arm64",
    file: "node-v24.22.1-win-arm64.zip",
    sha256: "a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171",
    size: 0,
    archive: Archive::Zip,
};

const LINUX_X64: Target = Target {
    platform: "linux-x64",
    file: "node-v24.22.1-linux-x64.tar.gz",
    sha256: "eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c",
    size: 58_290_700,
    archive: Archive::TarGz,
};

const LINUX_ARM64: Target = Target {
    platform: "linux-arm64",
    file: "node-v24.22.1-linux-arm64.tar.gz",
    sha256: "33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3",
    size: 0,
    archive: Archive::TarGz,
};

const LINUX_X64_XZ: Target = Target {
    platform: "linux-x64",
    file: "node-v24.22.1-linux-x64.tar.xz",
    sha256: "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6",
    size: 32_026_916,
    archive: Archive::TarXz,
};

const LINUX_ARM64_XZ: Target = Target {
    platform: "linux-arm64",
    file: "node-v24.22.1-linux-arm64.tar.xz",
    sha256: "dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e",
    size: 0,
    archive: Archive::TarXz,
};

/// 产物候选顺序（按优先级）：Linux 首选 `.tar.gz`（gzip 是发行版基线，`xz`
/// 不保证存在），`.tar.xz` 只在 gz 全部来源不可达时作为兜底（体积小 26 MB）；
/// Windows 只有 zip（bsdtar 与 Expand-Archive 都吃 zip，7z 需第三方工具）。
///
/// 架构取值来自运行期探测（Windows `%PROCESSOR_ARCHITECTURE%`、Linux
/// `uname -m`），未知架构一律显性拒绝（`unsupported-platform`）。
pub(crate) fn targets(windows: bool, arch: &str) -> Result<Vec<Target>, String> {
    let arch = arch.trim();
    if windows {
        let primary = match arch.to_ascii_uppercase().as_str() {
            "AMD64" | "X86_64" => WIN_X64,
            "ARM64" => WIN_ARM64,
            other => return Err(format!("unsupported architecture: windows/{other}")),
        };
        Ok(vec![primary])
    } else {
        let primary = match arch.to_ascii_lowercase().as_str() {
            "x86_64" | "amd64" => LINUX_X64,
            "aarch64" | "arm64" => LINUX_ARM64,
            other => return Err(format!("unsupported architecture: linux/{other}")),
        };
        let fallback = match primary.platform {
            "linux-x64" => LINUX_X64_XZ,
            _ => LINUX_ARM64_XZ,
        };
        Ok(vec![primary, fallback])
    }
}

/// 三个允许的来源 origin（顺序即尝试顺序）
pub(crate) const ORIGINS: [&str; 3] = [
    "https://nodejs.org/dist",
    "https://npmmirror.com/mirrors/node",
    "https://registry.npmmirror.com/-/binary/node",
];

/// 某产物的全部来源 URL（顺序固定；调用方按序逐个尝试，每源最多 1 次）
pub(crate) fn source_urls(file: &str) -> Vec<String> {
    ORIGINS
        .iter()
        .map(|origin| format!("{origin}/{NODE_VERSION}/{file}"))
        .collect()
}

/// 来源合法性（安全约束）：只允许 https 且必须落在 [`ORIGINS`] 之一。
///
/// 常量表是自己写的，本函数是**纵深防御**：任何将来从状态里读回 URL 再重放的
/// 路径（重试 / 续跑）都必须先过这道校验，避免被篡改的 storage 把下载指向
/// 任意主机。
///
/// 边界必须是 `origin + "/"`：只比前缀会让 `https://nodejs.org/dist.evil.com/…`
/// 这类「同前缀不同主机」的 URL 蒙混过关（DNS 可控的前缀伪装正是篡改 storage
/// 后最省事的一发）。
pub(crate) fn validate_source(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("non-https source rejected: {url}"));
    }
    if ORIGINS
        .iter()
        .any(|origin| url.starts_with(&format!("{origin}/")))
    {
        Ok(())
    } else {
        Err(format!("source not in allowlist: {url}"))
    }
}

/// 版本主版本号：`v24.22.1` / `24.22.1` → `24`；不可解析 → None
pub(crate) fn node_major(version: &str) -> Option<u32> {
    let v = version.trim();
    let v = v.strip_prefix('v').or_else(|| v.strip_prefix('V')).unwrap_or(v);
    let first = v.split('.').next()?;
    if first.is_empty() || !first.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    first.parse().ok()
}

/// 解压后官方归档的顶层目录名（`node-v24.22.1-win-x64` / `node-v24.22.1-linux-x64`）。
/// 只按平台名拼：状态里回读的产物表拿不到 `Target` 的静态生命周期。
pub(crate) fn top_dir_for(platform: &str) -> String {
    format!("node-{NODE_VERSION}-{platform}")
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 四目标架构映射：Windows 大小写不敏感（`AMD64` / `arm64`），
    /// Linux 认 `x86_64` / `aarch64` / `arm64`；未知架构显性失败
    #[test]
    fn target_mapping_both_platforms() {
        assert_eq!(targets(true, "AMD64").unwrap()[0].platform, "win-x64");
        assert_eq!(targets(true, "arm64").unwrap()[0].platform, "win-arm64");
        assert_eq!(targets(false, "x86_64").unwrap()[0].platform, "linux-x64");
        assert_eq!(
            targets(false, "aarch64").unwrap()[0].platform,
            "linux-arm64"
        );
        assert_eq!(targets(false, "arm64").unwrap()[0].platform, "linux-arm64");

        assert!(targets(true, "x86").is_err());
        assert!(targets(false, "riscv64").is_err());
        assert!(targets(true, "").is_err());
    }

    /// Linux 候选顺序：gz 首选、xz 兜底；Windows 只有 zip 一档
    #[test]
    fn target_fallback_order() {
        let linux = targets(false, "x86_64").unwrap();
        assert_eq!(linux.len(), 2);
        assert_eq!(linux[0].archive, Archive::TarGz);
        assert_eq!(linux[1].archive, Archive::TarXz);
        // 兜底产物与首选同平台、不同文件名
        assert_eq!(linux[0].platform, linux[1].platform);
        assert_ne!(linux[0].file, linux[1].file);

        let win = targets(true, "AMD64").unwrap();
        assert_eq!(win.len(), 1, "Windows 不应有 xz 兜底（7z 需第三方工具）");
    }

    /// 来源顺序固定为三个 origin，且全部 https + 版本号在路径中间段
    #[test]
    fn source_urls_order_and_shape() {
        let urls = source_urls("node-v24.22.1-linux-x64.tar.gz");
        assert_eq!(urls.len(), 3);
        assert_eq!(
            urls[0],
            "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz"
        );
        assert_eq!(
            urls[1],
            "https://npmmirror.com/mirrors/node/v24.22.1/node-v24.22.1-linux-x64.tar.gz"
        );
        assert_eq!(
            urls[2],
            "https://registry.npmmirror.com/-/binary/node/v24.22.1/node-v24.22.1-linux-x64.tar.gz"
        );
        assert!(urls.iter().all(|u| u.starts_with("https://")));
    }

    /// 来源 allowlist：http / 非白名单 host / 前缀伪装全部拒绝
    #[test]
    fn source_allowlist_rejects_others() {
        assert!(validate_source(&source_urls("x.zip")[0]).is_ok());
        assert!(validate_source("http://nodejs.org/dist/v24.22.1/x.zip").is_err());
        assert!(validate_source("https://evil.example.com/x.zip").is_err());
        // 只做前缀匹配，不做子串匹配：路径里的 origin 字样不算数
        assert!(validate_source("https://evil.example.com/https://nodejs.org/dist").is_err());
        // 同前缀不同主机：`origin` 之后必须是 `/`，否则就是伪装主机名
        assert!(validate_source("https://nodejs.org/dist.evil.com/v24.22.1/x.zip").is_err());
        assert!(validate_source("https://npmmirror.com.evil.com/x.zip").is_err());
        // 恰好等于 origin（无路径段）同样拒绝：没有产物名就不是合法下载
        assert!(validate_source("https://nodejs.org/dist").is_err());
    }

    /// 产物表给出的每条来源都必须过校验（拼接与判据同源，防漂移）
    #[test]
    fn every_generated_source_passes_allowlist() {
        for file in ["node-v24.22.1-win-x64.zip", "node-v24.22.1-linux-x64.tar.gz"] {
            for url in source_urls(file) {
                assert!(validate_source(&url).is_ok(), "被自己的判据拒了: {url}");
            }
        }
    }

    /// 版本主版本号解析：带 v / 不带 v / 不可解析
    #[test]
    fn node_major_parses() {
        assert_eq!(node_major("v24.22.1"), Some(24));
        assert_eq!(node_major("22.1.0"), Some(22));
        assert_eq!(node_major(" V18.0.0 "), Some(18));
        assert_eq!(node_major("node"), None);
        assert_eq!(node_major(""), None);
        assert_eq!(node_major("v"), None);
    }

    /// 解压顶层目录名与官方归档一致（`place` 步骤据此定位）；
    /// 兜底产物（xz）与主产物同顶层目录名（同一版本同一平台）
    #[test]
    fn extracted_top_dir_shape() {
        assert_eq!(top_dir_for(WIN_X64.platform), "node-v24.22.1-win-x64");
        assert_eq!(
            top_dir_for(LINUX_ARM64_XZ.platform),
            "node-v24.22.1-linux-arm64"
        );
        assert_eq!(
            top_dir_for(LINUX_X64.platform),
            top_dir_for(LINUX_X64_XZ.platform)
        );
    }
}
