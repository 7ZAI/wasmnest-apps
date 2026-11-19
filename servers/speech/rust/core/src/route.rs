//! 通道选择：`mode` 覆盖 + `auto` 的可用性预判
//!
//! 关键语义：**本地失败不回退云端**。`auto` 只在请求开始前选一次通道；
//! 选中本地后任何失败都原样上报（静默上传音频是安全红线）。

use crate::error::{Result, SpeechError};
use crate::settings::{Mode, SpeechSettings};

/// 实际执行通道
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// 宿主本地推理
    Local,
    /// 远端供应商
    Remote,
}

impl Channel {
    /// 线协议字符串
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
        }
    }
}

/// 选择通道
///
/// - `mode_override` 只能覆盖 `mode`，不能覆盖 `order`（v1 没有 order）；
/// - `local_available` = 本地启用且至少一个模型已安装；
/// - `remote_configured` = 远端启用、端点非空且 Key 已写；
/// - `auto`：本地可用 → local；否则远端已配置 → remote；否则显性失败。
pub fn choose_channel(
    settings: &SpeechSettings,
    mode_override: Option<Mode>,
    local_available: bool,
    remote_configured: bool,
) -> Result<Channel> {
    let mode = mode_override.unwrap_or(settings.mode);
    match mode {
        Mode::LocalOnly => Ok(Channel::Local),
        Mode::RemoteOnly => Ok(Channel::Remote),
        Mode::Auto => {
            if settings.local.enabled && local_available {
                Ok(Channel::Local)
            } else if settings.remote.enabled && remote_configured {
                Ok(Channel::Remote)
            } else {
                Err(SpeechError::NoChannel(
                    "no speech channel is ready: install a local model or configure a remote provider"
                        .to_string(),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::SpeechSettings;

    fn remote_ready() -> SpeechSettings {
        let mut settings = SpeechSettings::default();
        settings.remote.enabled = true;
        settings.remote.endpoint = "https://api.example.com/v1/audio/transcriptions".to_string();
        settings.remote.model = "whisper-1".to_string();
        settings
    }

    #[test]
    fn auto_prefers_local_when_ready() {
        let settings = remote_ready();
        assert_eq!(
            choose_channel(&settings, None, true, true).unwrap(),
            Channel::Local
        );
    }

    #[test]
    fn auto_uses_remote_when_local_not_ready() {
        let settings = remote_ready();
        assert_eq!(
            choose_channel(&settings, None, false, true).unwrap(),
            Channel::Remote
        );
    }

    #[test]
    fn auto_fails_when_nothing_is_ready() {
        let settings = SpeechSettings::default();
        assert_eq!(
            choose_channel(&settings, None, false, false)
                .unwrap_err()
                .kind(),
            "no-channel"
        );
    }

    #[test]
    fn local_only_selects_local_even_when_unavailable() {
        // 本地不可用时仍选本地：失败在推理入口显性上报，绝不静默改走云端
        let settings = remote_ready();
        assert_eq!(
            choose_channel(&settings, Some(Mode::LocalOnly), false, true).unwrap(),
            Channel::Local
        );
    }

    #[test]
    fn remote_only_ignores_local_availability() {
        let settings = remote_ready();
        assert_eq!(
            choose_channel(&settings, Some(Mode::RemoteOnly), true, false).unwrap(),
            Channel::Remote
        );
    }
}