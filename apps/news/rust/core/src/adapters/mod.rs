//! 源适配器：按 `kind` 分派，用户只能选种类 + 填地址。
//!
//! 每个适配器只暴露两件事——**怎么请求**（[`build_step`]）与**怎么解析**
//! （[`parse`]）；没有任何用户可注入的脚本、正则或选择器。解析失败一律返回
//! 带分类的错误（`parse.no_feed` / `parse.unexpected_shape`），**不返回空列表
//! 冒充成功**。
//!
//! HTML 榜单页（GitHub Trending）走字符串切分而不是引入 HTML 解析器：依赖
//! 引入前必须在 wasm 目标下验证，而榜单页只有一种内置结构，切分足够且产物更小。
//! 结构变化时返回 `parse.unexpected_shape`，界面显性提示，不静默留空。

mod github_trending;
mod graphql;
mod hn;
mod reddit;
mod rss;
mod youtube;

use crate::domain::{error_kind, RawItem, SourceKind};
use crate::ports::FetchRequest;
use serde::{Deserialize, Serialize};

/// 授权源的用户凭据（`credentials.secret_json` 的形状）。
///
/// 只在适配器构造请求头时使用；**不得进日志、不得进错误消息、不得进导出文件**。
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSecret {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookie: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bearer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csrf_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
}

impl AuthSecret {
    /// 掩码文案：末四位 + 长度，用于界面与日志。
    pub fn masked(&self) -> String {
        let raw = match (&self.cookie, &self.bearer) {
            (Some(cookie), _) => cookie.as_str(),
            (None, Some(bearer)) => bearer.as_str(),
            _ => "",
        };
        mask_secret(raw)
    }

    /// 是否至少有一项可用的身份态。
    pub fn is_empty(&self) -> bool {
        self.cookie.is_none() && self.bearer.is_none()
    }
}

/// 密钥掩码：末四位（长度不足四位则全 `*`）+ 长度。
pub fn mask_secret(raw: &str) -> String {
    let len = raw.chars().count();
    if len == 0 {
        return String::new();
    }
    if len <= 4 {
        return "*".repeat(len);
    }
    let tail: String = raw.chars().skip(len - 4).collect();
    format!("···{tail} ({len})")
}

/// 适配器错误：分类码 + 一句原因（原因不含凭据）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterError {
    kind: &'static str,
    detail: String,
}

impl AdapterError {
    /// 响应不是可识别的订阅流。
    pub fn no_feed(detail: impl Into<String>) -> Self {
        Self {
            kind: error_kind::PARSE_NO_FEED,
            detail: detail.into(),
        }
    }

    /// 源结构变化。
    pub fn unexpected(detail: impl Into<String>) -> Self {
        Self {
            kind: error_kind::PARSE_UNEXPECTED_SHAPE,
            detail: detail.into(),
        }
    }

    /// 地址 / 参数非法。
    pub fn invalid(detail: impl Into<String>) -> Self {
        Self {
            kind: error_kind::INVALID_ARGUMENT,
            detail: detail.into(),
        }
    }

    /// 分类码。
    pub fn kind(&self) -> &'static str {
        self.kind
    }

    /// 原因。
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

/// 一个源的抓取计划。
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// 一次请求，响应直接解析成条目。
    Single(FetchRequest),
    /// 先取索引（id 列表），再按上限逐条取详情：单条失败不拖垮整源。
    Index {
        request: FetchRequest,
        max_children: usize,
    },
}

/// HN 单次刷新最多取多少条详情（榜单前 30 条足以覆盖「此刻」）。
pub const HN_MAX_CHILDREN: usize = 30;

/// 构造抓取计划。`auth` 只对需要身份态的种类生效。
pub fn build_step(
    kind: SourceKind,
    url: &str,
    auth: Option<&AuthSecret>,
) -> Result<Step, AdapterError> {
    if url.trim().is_empty() {
        return Err(AdapterError::invalid("source url is empty"));
    }
    match kind {
        SourceKind::Rss => Ok(Step::Single(rss::build_request(url, auth))),
        SourceKind::YoutubeRss => Ok(Step::Single(youtube::build_request(url, auth))),
        SourceKind::Reddit => Ok(Step::Single(reddit::build_request(url, auth))),
        SourceKind::GithubTrending => Ok(Step::Single(github_trending::build_request(url, auth))),
        SourceKind::HtmlList => Err(AdapterError::invalid(
            "html-list is reserved for built-in sources and cannot be configured",
        )),
        SourceKind::Hn => Ok(Step::Index {
            request: hn::build_index_request(url, auth),
            max_children: HN_MAX_CHILDREN,
        }),
        SourceKind::XGraphql => Ok(Step::Single(graphql::build_x_request(url, auth)?)),
        SourceKind::IgGraphql => Ok(Step::Single(graphql::build_ig_request(url, auth)?)),
    }
}

/// 解析响应体。`base_url` 用于把相对链接补成绝对地址。
pub fn parse(
    kind: SourceKind,
    body: &str,
    base_url: &str,
    now_ms: i64,
) -> Result<Vec<RawItem>, AdapterError> {
    match kind {
        SourceKind::Rss | SourceKind::YoutubeRss => rss::parse(body, base_url),
        SourceKind::Reddit => reddit::parse(body, base_url, now_ms),
        SourceKind::GithubTrending => github_trending::parse(body, base_url),
        SourceKind::Hn => hn::parse_item_detail(body, now_ms),
        SourceKind::XGraphql => graphql::parse_x(body, base_url, now_ms),
        SourceKind::IgGraphql => graphql::parse_ig(body, base_url, now_ms),
        SourceKind::HtmlList => Err(AdapterError::invalid(
            "html-list is reserved for built-in sources",
        )),
    }
}

/// HN 索引响应 → 条目 id 列表。
pub fn parse_hn_index(body: &str) -> Result<Vec<u64>, AdapterError> {
    hn::parse_index(body)
}

/// HN 条目详情请求。
pub fn hn_detail_request(id: u64) -> FetchRequest {
    hn::detail_request(id)
}

/// 把用户填的地址归一成该种类实际请求的地址（保存时落库的就是它）。
pub fn canonical_source_url(kind: SourceKind, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    match kind {
        SourceKind::YoutubeRss => youtube::normalize_channel_url(trimmed),
        SourceKind::Reddit => reddit::normalize_url(trimmed),
        SourceKind::Rss | SourceKind::Hn | SourceKind::GithubTrending => Some(trimmed.to_string()),
        SourceKind::HtmlList | SourceKind::XGraphql | SourceKind::IgGraphql => {
            Some(trimmed.to_string())
        }
    }
}

/// YouTube 频道页地址 → 视频源地址（表单即时提示用）。
pub fn youtube_feed_url(raw: &str) -> Option<String> {
    youtube::normalize_channel_url(raw)
}

/// 内置源的默认地址是否属于该 kind（表单校验用）。
pub fn url_matches_kind(kind: SourceKind, url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    match kind {
        SourceKind::Hn => lower.contains("hacker-news.firebaseio.com"),
        SourceKind::Reddit => lower.contains("reddit.com"),
        SourceKind::GithubTrending => lower.contains("github.com/trending"),
        SourceKind::YoutubeRss => lower.contains("youtube.com"),
        SourceKind::Rss | SourceKind::HtmlList | SourceKind::XGraphql | SourceKind::IgGraphql => {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_list_is_not_user_configurable() {
        let err = build_step(SourceKind::HtmlList, "https://example.com", None).unwrap_err();
        assert_eq!(err.kind(), error_kind::INVALID_ARGUMENT);
    }

    #[test]
    fn empty_url_is_rejected() {
        let err = build_step(SourceKind::Rss, "  ", None).unwrap_err();
        assert!(err.detail().contains("empty"));
    }

    #[test]
    fn mask_never_reveals_more_than_tail() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("abc"), "***");
        assert_eq!(mask_secret("abcdefgh"), "···efgh (8)");
    }

    #[test]
    fn auth_secret_masks_cookie_preferentially() {
        let auth = AuthSecret {
            cookie: Some("session=abcdef123456".into()),
            ..Default::default()
        };
        let masked = auth.masked();
        assert!(masked.ends_with("3456 (20)"), "{masked}");
        assert!(!masked.contains("abcdef"));
        assert!(!auth.is_empty());
    }
}
