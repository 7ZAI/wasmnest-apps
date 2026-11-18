//! 端口 trait：双端差异面与外部能力的唯一落点。
//!
//! 当前只有契约，没有宿主实现：抓取引擎、凭据存储与助手代抓都还没接入。
//! 预留 trait 的目的，是让后续实现只替换端口，不动 [`crate::domain`] 与
//! [`crate::feed`] 的判据。

use std::fmt;

/// 端口错误的稳定形状：`code` 即前端 i18n key，细节不出产生方。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortError {
    code: String,
}

impl PortError {
    /// 用错误码构造。
    pub fn new(code: impl Into<String>) -> Self {
        Self { code: code.into() }
    }

    /// 错误码（前端据此取文案）。
    pub fn code(&self) -> &str {
        &self.code
    }
}

impl fmt::Display for PortError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code)
    }
}

impl std::error::Error for PortError {}

/// 一次出站 HTTP 请求（字符 body；二进制与取消语义由宿主决定）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// 宿主代发的响应。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResponse {
    pub status: u16,
    pub body: String,
}

/// 出网统一入口：只经宿主 HTTP 代理，应用内不开 socket。
pub trait FetchPort {
    /// 发起一次请求；网络 / 授权 / 解析失败一律返回错误码。
    fn fetch(&self, request: FetchRequest) -> Result<FetchResponse, PortError>;
}

/// 助手代抓（反向面）：宿主助手在补出对外 api 之前，实现固定返回
/// `assistant.fetch-unavailable`，调用方必须把错误显性展示。
pub trait AssistantBridge {
    /// 请求助手抓取并返回结构化结果。
    fn request_fetch(&self, url: &str, expected_schema: &str) -> Result<String, PortError>;
}

/// 未接入时的助手实现：不做任何网络动作，只返回稳定错误码。
#[derive(Debug, Clone, Copy, Default)]
pub struct UnavailableAssistant;

impl AssistantBridge for UnavailableAssistant {
    fn request_fetch(&self, _url: &str, _expected_schema: &str) -> Result<String, PortError> {
        Err(PortError::new("assistant.fetch-unavailable"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_assistant_never_pretends_to_fetch() {
        let err = UnavailableAssistant
            .request_fetch("https://example.com", "{}")
            .expect_err("助手代抓未接入时必须显性失败");
        assert_eq!(err.code(), "assistant.fetch-unavailable");
    }
}
