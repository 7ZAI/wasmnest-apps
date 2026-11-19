//! AI 摘要（默认关闭）：请求构造、响应解析与长度约束。
//!
//! 只做两件事：为单条信息条生成一句话中文摘要、为今日前 N 条批量生成。
//! 不做自动批量摘要、不做打分、不做聚类——关闭时**不存在任何 AI 请求**。
//!
//! 密钥只出现在请求头里；错误信息与日志只允许出现长度。

use crate::domain::error_kind;
use crate::ports::FetchRequest;

/// 摘要字符上限（超出按句子边界截断）。
pub const SUMMARY_MAX_CHARS: usize = 200;
/// 批量摘要一次最多处理多少条。
pub const BATCH_LIMIT: usize = 20;

/// 摘要失败分类。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiError {
    kind: &'static str,
    detail: String,
}

impl AiError {
    /// 鉴权失败（401 / 403）。
    pub fn auth(detail: impl Into<String>) -> Self {
        Self {
            kind: error_kind::AI_AUTH,
            detail: detail.into(),
        }
    }

    /// 其它失败（网络 / 结构 / 空内容）。
    pub fn failed(detail: impl Into<String>) -> Self {
        Self {
            kind: error_kind::AI_FAILED,
            detail: detail.into(),
        }
    }

    /// 分类码。
    pub fn kind(&self) -> &'static str {
        self.kind
    }

    /// 原因（不含密钥）。
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

/// 端点是否已经是完整的对话补全地址。
pub fn endpoints_ok(base_url: &str) -> bool {
    let url = base_url.trim();
    let rest = match url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    {
        Some(rest) => rest,
        None => return false,
    };
    // 至少要有 host；`/chat/completions` 由 chat_completions_url 补齐
    !rest.split('/').next().unwrap_or("").is_empty()
}

/// 把用户填的 base url 归一成 `/v1/chat/completions`。
pub fn chat_completions_url(base_url: &str) -> String {
    let url = base_url.trim().trim_end_matches('/');
    if url.ends_with("/chat/completions") {
        return url.to_string();
    }
    if url.ends_with("/v1") {
        return format!("{url}/chat/completions");
    }
    format!("{url}/v1/chat/completions")
}

/// 构造一次对话补全请求（OpenAI 兼容）。
pub fn build_request(
    base_url: &str,
    api_key: &str,
    model: &str,
    title: &str,
    body: &str,
) -> FetchRequest {
    let system = "你是新闻编辑。用一句简体中文概括这条新闻的核心事实，不超过 60 字，\
不要臆测未提供的细节，不要输出引号或前缀。";
    let user = format!(
        "标题：{title}\n摘要：{body}\n\n请只输出一句话摘要。",
        title = title.trim(),
        body = body.trim()
    );
    let payload = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "temperature": 0.2,
        "max_tokens": 160,
    });
    FetchRequest {
        method: "POST".to_string(),
        url: chat_completions_url(base_url),
        headers: vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            (
                "Authorization".to_string(),
                format!("Bearer {}", api_key.trim()),
            ),
        ],
        body: Some(payload.to_string()),
    }
}

/// 解析对话补全响应，取出第一段内容。
pub fn parse_response(status: u16, body: &str) -> Result<String, AiError> {
    if status == 401 || status == 403 {
        return Err(AiError::auth(format!(
            "endpoint rejected the api key (http {status})"
        )));
    }
    if !(200..300).contains(&status) {
        return Err(AiError::failed(format!("endpoint returned http {status}")));
    }
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| AiError::failed(format!("response is not JSON: {e}")))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err(AiError::failed("endpoint returned an empty summary"));
    }
    Ok(fit_sentence(content, SUMMARY_MAX_CHARS))
}

/// 按句子边界截断：超长时回退到最后一个句末标点，找不到才硬截。
pub fn fit_sentence(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let head: String = text.chars().take(max_chars).collect();
    let cut = head
        .char_indices()
        .filter(|(_, c)| matches!(c, '。' | '！' | '？' | '.' | '!' | '?'))
        .map(|(idx, c)| idx + c.len_utf8())
        .filter(|end| *end > max_chars / 2)
        .last();
    match cut {
        Some(end) => head[..end].to_string(),
        None => head,
    }
}

/// 批量摘要的目标上限。
pub fn batch_cap(requested: Option<u32>) -> usize {
    let requested = requested.unwrap_or(BATCH_LIMIT as u32) as usize;
    requested.clamp(1, BATCH_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_normalization_appends_chat_completions_once() {
        assert_eq!(
            chat_completions_url("https://api.openai.com"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.openai.com/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert!(endpoints_ok("https://api.openai.com"));
        assert!(!endpoints_ok("api.openai.com"));
    }

    #[test]
    fn request_never_puts_key_in_body() {
        let request = build_request(
            "https://api.openai.com",
            "sk-secret-value",
            "gpt-4o-mini",
            "T",
            "B",
        );
        assert_eq!(request.method, "POST");
        assert!(request
            .headers
            .iter()
            .any(|(k, v)| k == "Authorization" && v == "Bearer sk-secret-value"));
        assert!(!request.body.as_deref().unwrap_or("").contains("sk-secret-value"));
    }

    #[test]
    fn parses_content_and_reports_empty_as_failure() {
        let body = r#"{"choices":[{"message":{"content":"一句话摘要。"}}]}"#;
        assert_eq!(parse_response(200, body).unwrap(), "一句话摘要。");
        let empty = r#"{"choices":[{"message":{"content":"   "}}]}"#;
        assert_eq!(
            parse_response(200, empty).unwrap_err().kind(),
            "ai.failed"
        );
    }

    #[test]
    fn auth_failure_is_its_own_kind() {
        assert_eq!(parse_response(401, "{}").unwrap_err().kind(), "ai.auth");
        assert_eq!(parse_response(403, "{}").unwrap_err().kind(), "ai.auth");
        assert_eq!(parse_response(500, "{}").unwrap_err().kind(), "ai.failed");
    }

    #[test]
    fn long_summary_is_cut_at_sentence_boundary() {
        let long = format!("{}。{}。", "甲".repeat(150), "乙".repeat(100));
        let fitted = fit_sentence(&long, SUMMARY_MAX_CHARS);
        assert!(fitted.chars().count() <= SUMMARY_MAX_CHARS);
        assert!(fitted.ends_with('。'), "按句子边界截断：{fitted}");
    }

    #[test]
    fn short_summary_is_untouched() {
        assert_eq!(fit_sentence("短摘要。", 200), "短摘要。");
    }

    #[test]
    fn batch_cap_respects_hard_limit() {
        assert_eq!(batch_cap(None), 20);
        assert_eq!(batch_cap(Some(5)), 5);
        assert_eq!(batch_cap(Some(500)), 20);
        assert_eq!(batch_cap(Some(0)), 1);
    }
}
