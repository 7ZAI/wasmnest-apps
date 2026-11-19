//! 服务错误分类：稳定 kind + 可读消息
//!
//! `kind` 进入前端 i18n key 与互调错误串；消息面向排障，不回显音频内容。

/// 服务结果
pub type Result<T> = std::result::Result<T, SpeechError>;

/// 服务错误
#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    /// 音频过大
    #[error("audio too large: {bytes} bytes exceeds limit {limit}")]
    AudioTooLarge {
        /// 实际字节
        bytes: usize,
        /// 上限
        limit: usize,
    },
    /// 音频格式不合法
    #[error("invalid audio: {0}")]
    AudioInvalid(String),
    /// 本地通道不支持的容器
    #[error("local channel does not support this audio: {0}")]
    AudioUnsupportedLocal(String),
    /// 没有可用通道
    #[error("no channel available: {0}")]
    NoChannel(String),
    /// 设置非法
    #[error("invalid settings: {0}")]
    InvalidSettings(String),
    /// 远端供应商未配置（端点 / Key / 模型缺项）
    #[error("remote provider not configured: {0}")]
    ProviderNotConfigured(String),
    /// 鉴权失败
    #[error("provider auth failed: {0}")]
    AuthFailed(String),
    /// 限流
    #[error("provider rate limited: {0}")]
    RateLimited(String),
    /// 供应商内部错误
    #[error("provider error: {0}")]
    ProviderError(String),
    /// 响应协议不兼容
    #[error("provider protocol mismatch: {0}")]
    ProtocolMismatch(String),
    /// 网络失败
    #[error("network error: {0}")]
    Network(String),
    /// 内部错误
    #[error("internal error: {0}")]
    Internal(String),
}

impl SpeechError {
    /// 稳定分类（前端 i18n / 互调错误串）
    pub fn kind(&self) -> &'static str {
        match self {
            Self::AudioTooLarge { .. } => "audio-too-large",
            Self::AudioInvalid(_) => "audio-invalid",
            Self::AudioUnsupportedLocal(_) => "audio-unsupported-local",
            Self::NoChannel(_) => "no-channel",
            Self::InvalidSettings(_) => "invalid-settings",
            Self::ProviderNotConfigured(_) => "provider-not-configured",
            Self::AuthFailed(_) => "auth-failed",
            Self::RateLimited(_) => "rate-limited",
            Self::ProviderError(_) => "provider-error",
            Self::ProtocolMismatch(_) => "protocol-mismatch",
            Self::Network(_) => "network",
            Self::Internal(_) => "internal",
        }
    }
}

impl From<serde_json::Error> for SpeechError {
    fn from(value: serde_json::Error) -> Self {
        Self::Internal(format!("json: {value}"))
    }
}