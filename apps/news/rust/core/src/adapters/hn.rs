//! Hacker News 公开 API：先取榜单 id 列表，再逐条取详情。
//!
//! 两步式设计的代价是 N+1 次请求，收益是条目可以直接拿到原始链接与时间；
//! 单条详情失败只影响该条，不影响整源（失败原因由调用方逐条记日志）。

use super::AdapterError;
use crate::domain::RawItem;
use crate::ports::FetchRequest;

/// 默认榜单地址。
pub const TOP_STORIES_URL: &str = "https://hacker-news.firebaseio.com/v0/topstories.json";
/// 条目详情前缀。
pub const ITEM_BASE: &str = "https://hacker-news.firebaseio.com/v0/item/";
/// 讨论页前缀（条目没有 url 时用「HN 讨论」当原文地址）。
pub const DISCUSSION_BASE: &str = "https://news.ycombinator.com/item?id=";

/// 榜单请求。
pub fn build_index_request(url: &str, _auth: Option<&super::AuthSecret>) -> FetchRequest {
    let target = if url.trim().is_empty() {
        TOP_STORIES_URL.to_string()
    } else {
        url.trim().to_string()
    };
    FetchRequest {
        method: "GET".to_string(),
        url: target,
        headers: vec![("Accept".to_string(), "application/json".to_string())],
        body: None,
    }
}

/// 单条详情请求。
pub fn detail_request(id: u64) -> FetchRequest {
    FetchRequest {
        method: "GET".to_string(),
        url: format!("{ITEM_BASE}{id}.json"),
        headers: vec![("Accept".to_string(), "application/json".to_string())],
        body: None,
    }
}

/// 解析榜单 id 列表。
pub fn parse_index(body: &str) -> Result<Vec<u64>, AdapterError> {
    let trimmed = body.trim_start();
    if trimmed.is_empty() {
        return Err(AdapterError::no_feed("index response body is empty"));
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| AdapterError::no_feed(format!("index is not JSON: {e}")))?;
    let array = value
        .as_array()
        .ok_or_else(|| AdapterError::unexpected("topstories is not an array (structure changed)"))?;
    let ids: Vec<u64> = array.iter().filter_map(|v| v.as_u64()).collect();
    if ids.is_empty() {
        return Err(AdapterError::unexpected("topstories returned no ids"));
    }
    Ok(ids)
}

/// 解析条目详情（每条一次请求）。
pub fn parse_item_detail(body: &str, _now_ms: i64) -> Result<Vec<RawItem>, AdapterError> {
    let trimmed = body.trim_start();
    if trimmed.is_empty() || trimmed == "null" {
        return Err(AdapterError::no_feed("item detail is empty"));
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| AdapterError::no_feed(format!("item detail is not JSON: {e}")))?;
    let Some(object) = value.as_object() else {
        return Err(AdapterError::unexpected("item detail is not an object"));
    };
    // 评论 / 招聘 / 投票不是「信息条」，静默跳过（不是失败）
    let item_type = object.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if item_type != "story" {
        return Ok(Vec::new());
    }
    if object.get("deleted").and_then(|v| v.as_bool()) == Some(true)
        || object.get("dead").and_then(|v| v.as_bool()) == Some(true)
    {
        return Ok(Vec::new());
    }
    let Some(title) = object.get("title").and_then(|v| v.as_str()) else {
        return Err(AdapterError::unexpected("story has no title"));
    };
    let id = object.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
    let url = object
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|u| u.starts_with("http"))
        .map(|u| u.to_string())
        .unwrap_or_else(|| format!("{DISCUSSION_BASE}{id}"));
    let published_at = object
        .get("time")
        .and_then(|v| v.as_i64())
        .map(|secs| secs * 1000)
        .filter(|ms| *ms > 0);
    let author = object
        .get("by")
        .and_then(|v| v.as_str())
        .map(|a| a.to_string());
    Ok(vec![RawItem {
        title: title.to_string(),
        url,
        published_at,
        summary: object
            .get("text")
            .and_then(|v| v.as_str())
            .and_then(crate::urlutil::clean_summary),
        author,
        lang: None,
        source_title: Some("Hacker News".to_string()),
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_index_ids() {
        let ids = parse_index("[1, 2, 3]").unwrap();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn index_shape_errors_are_classified() {
        assert_eq!(parse_index("not json").unwrap_err().kind(), "parse.no_feed");
        assert_eq!(
            parse_index("{\"a\":1}").unwrap_err().kind(),
            "parse.unexpected_shape"
        );
        assert_eq!(
            parse_index("[]").unwrap_err().kind(),
            "parse.unexpected_shape"
        );
    }

    #[test]
    fn maps_story_with_external_link() {
        let body = r#"{"id":42,"type":"story","title":"Show HN: thing","url":"https://example.com/thing","time":1794315600,"by":"alice"}"#;
        let items = parse_item_detail(body, 1_800_000_000_000).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://example.com/thing");
        assert_eq!(items[0].author.as_deref(), Some("alice"));
        assert_eq!(items[0].published_at, Some(1_794_315_600_000));
    }

    #[test]
    fn story_without_url_falls_back_to_discussion_page() {
        let body = r#"{"id":7,"type":"story","title":"Ask HN: anything","time":1794315600}"#;
        let items = parse_item_detail(body, 1_800_000_000_000).unwrap();
        assert_eq!(items[0].url, "https://news.ycombinator.com/item?id=7");
    }

    #[test]
    fn non_story_and_dead_entries_are_skipped_not_failed() {
        let comment = r#"{"id":1,"type":"comment","text":"hi"}"#;
        assert!(parse_item_detail(comment, 0).unwrap().is_empty());
        let dead = r#"{"id":2,"type":"story","title":"x","dead":true}"#;
        assert!(parse_item_detail(dead, 0).unwrap().is_empty());
        let deleted = r#"{"id":3,"type":"story","title":"x","deleted":true}"#;
        assert!(parse_item_detail(deleted, 0).unwrap().is_empty());
    }

    #[test]
    fn null_detail_is_reported() {
        assert_eq!(
            parse_item_detail("null", 0).unwrap_err().kind(),
            "parse.no_feed"
        );
    }

    #[test]
    fn detail_request_points_at_item_endpoint() {
        assert_eq!(
            detail_request(9).url,
            "https://hacker-news.firebaseio.com/v0/item/9.json"
        );
    }
}
