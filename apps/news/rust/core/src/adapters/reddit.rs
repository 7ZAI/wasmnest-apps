//! Reddit 公开 JSON 接口（`/r/<sub>/hot.json`）。
//!
//! 限流（429）由调用方按 HTTP 状态归类；本模块只负责「地址归一到 .json」+
//! 「JSON 结构映射」。结构不符（例如被反爬页替换）返回 `parse.unexpected_shape`。

use super::AdapterError;
use crate::domain::RawItem;
use crate::ports::FetchRequest;
use crate::urlutil::clean_summary;

/// Reddit 要求明确 UA，缺省 UA 会被直接 429。
const UA: &str = "WasmNestNews/0.1 (+https://github.com/7ZAI/wasmnest-apps)";

/// 把 `r/worldnews` 之类的简写补成 `https://www.reddit.com/r/worldnews/hot.json`。
pub fn normalize_url(raw: &str) -> Option<String> {
    let url = raw.trim().trim_end_matches('/');
    if url.is_empty() {
        return None;
    }
    if url.starts_with("r/") {
        return Some(normalize_listing(&format!("https://www.reddit.com/{url}")));
    }
    if url.contains("reddit.com") {
        return Some(normalize_listing(url));
    }
    None
}

/// 列表地址补 `.json`（已带 `.json` 不动）。
fn normalize_listing(url: &str) -> String {
    let (head, query) = match url.split_once('?') {
        Some((head, query)) => (head, Some(query)),
        None => (url, None),
    };
    let head = if head.ends_with(".json") {
        head.to_string()
    } else {
        format!("{head}.json")
    };
    match query {
        Some(query) => format!("{head}?{query}"),
        None => head,
    }
}

/// 列表请求。
pub fn build_request(url: &str, auth: Option<&super::AuthSecret>) -> FetchRequest {
    let target = normalize_url(url).unwrap_or_else(|| url.trim().to_string());
    let mut headers = vec![
        ("Accept".to_string(), "application/json".to_string()),
        ("User-Agent".to_string(), UA.to_string()),
    ];
    if let Some(auth) = auth {
        if let Some(cookie) = &auth.cookie {
            headers.push(("Cookie".to_string(), cookie.clone()));
        }
    }
    FetchRequest {
        method: "GET".to_string(),
        url: target,
        headers,
        body: None,
    }
}

/// 解析列表响应。
pub fn parse(body: &str, base_url: &str, _now_ms: i64) -> Result<Vec<RawItem>, AdapterError> {
    let trimmed = body.trim_start();
    if trimmed.is_empty() {
        return Err(AdapterError::no_feed("response body is empty"));
    }
    if trimmed.starts_with('<') {
        return Err(AdapterError::unexpected(
            "reddit returned an HTML page instead of JSON (blocked or rate limited)",
        ));
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| AdapterError::no_feed(format!("response is not JSON: {e}")))?;
    let children = value
        .pointer("/data/children")
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            AdapterError::unexpected("reddit payload has no data.children array (structure changed)")
        })?;
    if children.is_empty() {
        return Err(AdapterError::unexpected("reddit listing returned no children"));
    }

    let origin = origin_of(base_url);
    let mut items = Vec::new();
    for child in children {
        let data = match child.get("data") {
            Some(d) => d,
            None => continue,
        };
        let Some(title) = data.get("title").and_then(|t| t.as_str()) else {
            continue;
        };
        let Some(url) = link_of(data, &origin) else {
            continue;
        };
        let published_at = data
            .get("created_utc")
            .and_then(|v| v.as_f64())
            .map(|secs| (secs * 1000.0) as i64)
            .or_else(|| {
                // 少数客户端返回毫秒
                data.get("created_utc")
                    .and_then(|v| v.as_i64())
                    .map(|v| if v > 10_000_000_000 { v } else { v * 1000 })
            })
            // 0 / 负数一律视为「源没给时间」，由入库时以抓到时刻填充
            .filter(|ms| *ms > 0);
        let summary = data
            .get("selftext")
            .and_then(|v| v.as_str())
            .and_then(clean_summary);
        let author = data
            .get("author")
            .and_then(|v| v.as_str())
            .map(|a| a.to_string());
        let subreddit = data.get("subreddit").and_then(|v| v.as_str());
        items.push(RawItem {
            title: title.to_string(),
            url,
            published_at,
            summary,
            author,
            lang: None,
            source_title: subreddit.map(|s| format!("r/{s}")),
        });
    }
    if items.is_empty() {
        return Err(AdapterError::unexpected(
            "reddit children carry neither a title nor a link",
        ));
    }
    Ok(items)
}

/// 取帖子链接：外链帖用 `url`，自帖用 `permalink`。
fn link_of(data: &serde_json::Value, origin: &str) -> Option<String> {
    let url = data.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.starts_with("http") {
        return Some(url.to_string());
    }
    let permalink = data.get("permalink").and_then(|v| v.as_str())?;
    if permalink.starts_with('/') {
        Some(format!("{origin}{permalink}"))
    } else {
        Some(permalink.to_string())
    }
}

fn origin_of(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let authority = rest.split('/').next().unwrap_or("www.reddit.com");
            format!("{scheme}://{authority}")
        }
        None => "https://www.reddit.com".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "kind": "Listing",
      "data": {
        "children": [
          {"kind":"t3","data":{
            "title":"World news one",
            "url":"https://example.com/news/1",
            "created_utc": 1794315600.0,
            "selftext": "",
            "author":"alice",
            "subreddit":"worldnews",
            "permalink":"/r/worldnews/comments/1/x/"
          }},
          {"kind":"t3","data":{
            "title":"Self post",
            "url":"https://www.reddit.com/r/worldnews/comments/2/y/",
            "permalink":"/r/worldnews/comments/2/y/",
            "created_utc": 1794315600,
            "selftext":"Some body text",
            "author":"bob",
            "subreddit":"worldnews"
          }}
        ]
      }
    }"#;

    #[test]
    fn maps_listing_to_items() {
        let items = parse(FIXTURE, "https://www.reddit.com/r/worldnews/hot.json", 0).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].url, "https://example.com/news/1");
        assert_eq!(items[0].source_title.as_deref(), Some("r/worldnews"));
        assert_eq!(
            items[0].published_at,
            Some(1_794_315_600_000),
            "created_utc 秒转毫秒"
        );
        assert_eq!(items[1].summary.as_deref(), Some("Some body text"));
    }

    #[test]
    fn short_url_forms_are_normalized() {
        assert_eq!(
            normalize_url("r/worldnews").as_deref(),
            Some("https://www.reddit.com/r/worldnews.json")
        );
        assert_eq!(
            normalize_url("https://www.reddit.com/r/worldnews/hot.json").as_deref(),
            Some("https://www.reddit.com/r/worldnews/hot.json")
        );
    }

    #[test]
    fn html_block_page_is_unexpected_shape() {
        let err = parse("<html>blocked</html>", "https://www.reddit.com", 0).unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn missing_children_is_unexpected_shape() {
        let err = parse("{\"kind\":\"Listing\"}", "https://www.reddit.com", 0).unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn empty_listing_is_unexpected_shape_not_silent_success() {
        let err = parse(
            "{\"data\":{\"children\":[]}}",
            "https://www.reddit.com",
            0,
        )
        .unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn request_carries_user_agent() {
        let request = build_request("r/worldnews", None);
        assert_eq!(request.url, "https://www.reddit.com/r/worldnews.json");
        assert!(request
            .headers
            .iter()
            .any(|(k, v)| k == "User-Agent" && v.contains("WasmNestNews")));
    }
}
