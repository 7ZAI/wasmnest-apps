//! 运行期平台探测：双端差异（定时器 / 系统剪贴板）的唯一分支点。
//!
//! 端值来自 WIT `host-platform.platform()`（双端全等原语）。空 / 未知取值 =
//! 显性失败：猜错平台会把桌面定时器请求打到移动宿主上，比起启动失败更难排查。

use wasmnest_plugin_api::host::HostPlatform;

/// 宿主平台。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Platform {
    Desktop,
    Mobile,
}

impl Platform {
    fn from_wire(value: &str) -> Option<Self> {
        match value {
            "desktop" => Some(Platform::Desktop),
            "mobile" => Some(Platform::Mobile),
            _ => None,
        }
    }

    /// 是否有宿主定时器（移动端没有）。
    pub(crate) fn has_timer(self) -> bool {
        matches!(self, Platform::Desktop)
    }

    /// 是否有系统剪贴板后端（移动端没有，前端回退 `navigator.clipboard`）。
    pub(crate) fn has_clipboard(self) -> bool {
        matches!(self, Platform::Desktop)
    }

    /// 平台标识（事件 / 日志用）。
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Platform::Desktop => "desktop",
            Platform::Mobile => "mobile",
        }
    }
}

/// 探测结果的驻留位（激活时写一次；native 单测可重写）。
static DETECTED: std::sync::Mutex<Option<Platform>> = std::sync::Mutex::new(None);

/// 激活期探测并驻留端值（幂等）。
pub(crate) fn detect(h: &impl HostPlatform) -> anyhow::Result<Platform> {
    let mut slot = DETECTED.lock().expect("platform slot lock");
    if let Some(platform) = *slot {
        return Ok(platform);
    }
    let value = h.platform();
    let platform = Platform::from_wire(&value).ok_or_else(|| {
        anyhow::anyhow!(
            "host platform probe returned unsupported value {value:?} \
             (expected \"desktop\" or \"mobile\")"
        )
    })?;
    *slot = Some(platform);
    Ok(platform)
}

/// 当前平台（未探测即用 = 编程错误）。
pub(crate) fn current() -> Platform {
    let value = *DETECTED.lock().expect("platform slot lock");
    value.expect("platform::current() before platform::detect()")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use wasmnest_plugin_api::host::HostError;

    struct ProbeHost {
        value: &'static str,
        calls: Cell<usize>,
    }

    impl HostPlatform for ProbeHost {
        fn platform(&self) -> String {
            self.calls.set(self.calls.get() + 1);
            self.value.to_string()
        }
        fn platform_pick_files(&self) -> Result<Vec<String>, HostError> {
            unimplemented!()
        }
        fn platform_pick_folders(&self) -> Result<Vec<String>, HostError> {
            unimplemented!()
        }
        fn platform_wsl_distros(&self) -> Result<Vec<String>, HostError> {
            unimplemented!()
        }
        fn platform_local_ipv4_addresses(&self) -> Result<Vec<String>, HostError> {
            unimplemented!()
        }
        fn platform_reveal_in_dir(&self, _path: &str) -> Result<(), HostError> {
            unimplemented!()
        }
    }

    #[test]
    fn parses_wire_values_and_rejects_unknown() {
        assert_eq!(Platform::from_wire("desktop"), Some(Platform::Desktop));
        assert_eq!(Platform::from_wire("mobile"), Some(Platform::Mobile));
        assert_eq!(Platform::from_wire("android"), None);
        assert_eq!(Platform::from_wire(""), None);
    }

    #[test]
    fn capability_bits_track_platform() {
        assert!(Platform::Desktop.has_timer());
        assert!(!Platform::Mobile.has_timer());
        assert!(Platform::Desktop.has_clipboard());
        assert!(!Platform::Mobile.has_clipboard());
    }

    #[test]
    fn unknown_probe_value_fails_visible() {
        *DETECTED.lock().unwrap() = None;
        let host = ProbeHost {
            value: "tablet",
            calls: Cell::new(0),
        };
        let err = detect(&host).unwrap_err();
        assert!(err.to_string().contains("unsupported value"));
        assert!(DETECTED.lock().unwrap().is_none());
    }
}
