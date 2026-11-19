//! YouTube 频道视频源：本质是 Atom，只做地址归一化。
//!
//! 用户可能贴频道页（`youtube.com/channel/UC…`）而不是 feeds 地址；`@handle`
//! 需要联网换 channel id，v1 不做（显性报错并提示填 channel id）。

use crate::ports::FetchRequest;

/// 把用户填的地址归一化成 feeds 地址。
pub fn normalize_channel_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    if url.is_empty() {
        return None;
    }
    if url.contains("/feeds/videos.xml") {
        return Some(url.to_string());
    }
    if let Some(idx) = url.find("/channel/") {
        let rest = &url[idx + "/channel/".len()..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.is_empty() {
            return None;
        }
        return Some(format!(
            "https://www.youtube.com/feeds/videos.xml?channel_id={id}"
        ));
    }
    None
}

/// 视频源请求（Atom，无需额外头）。
pub fn build_request(url: &str, auth: Option<&super::AuthSecret>) -> FetchRequest {
    let normalized = normalize_channel_url(url).unwrap_or_else(|| url.trim().to_string());
    super::rss::build_request(&normalized, auth)
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_page_becomes_feed_url() {
        assert_eq!(
            normalize_channel_url("https://www.youtube.com/channel/UCabc123").as_deref(),
            Some("https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123")
        );
    }

    #[test]
    fn feed_url_is_kept_as_is() {
        let raw = "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123";
        assert_eq!(normalize_channel_url(raw).as_deref(), Some(raw));
    }

    #[test]
    fn handle_urls_are_rejected_explicitly() {
        assert!(normalize_channel_url("https://www.youtube.com/@example").is_none());
    }

    #[test]
    fn empty_url_is_rejected() {
        assert!(normalize_channel_url("   ").is_none());
    }
}
