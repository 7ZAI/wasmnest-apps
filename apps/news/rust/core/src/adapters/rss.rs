//! RSS 2.0 / Atom / RSS 1.0 解析。
//!
//! 用 `quick-xml` 的拉式读取器自己走一遍标签栈，不依赖订阅流的字段顺序，
//! 也不假设命名空间前缀（`dc:creator` / `content:encoded` 按原始标签名认）。

use super::AdapterError;
use crate::datetime;
use crate::domain::RawItem;
use crate::ports::FetchRequest;
use crate::urlutil::{clean_summary, resolve_url};

/// 常见桌面 UA：部分站点对未知 UA 返回 403，抓取就会变成 `auth.expired`。
const UA: &str = "WasmNestNews/0.1 (+https://github.com/7ZAI/wasmnest-apps)";

/// 订阅流请求。
pub fn build_request(url: &str, auth: Option<&super::AuthSecret>) -> FetchRequest {
    let mut headers = vec![
        (
            "Accept".to_string(),
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8"
                .to_string(),
        ),
        ("User-Agent".to_string(), UA.to_string()),
    ];
    if let Some(auth) = auth {
        if let Some(cookie) = &auth.cookie {
            headers.push(("Cookie".to_string(), cookie.clone()));
        }
        if let Some(bearer) = &auth.bearer {
            headers.push(("Authorization".to_string(), format!("Bearer {bearer}")));
        }
    }
    FetchRequest {
        method: "GET".to_string(),
        url: url.to_string(),
        headers,
        body: None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Field {
    Title,
    Link,
    Summary,
    Content,
    Published,
    Updated,
    Author,
}

#[derive(Default)]
struct Entry {
    title: Option<String>,
    link: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    published: Option<String>,
    updated: Option<String>,
    author: Option<String>,
    /// Atom `<link rel="alternate" href>` 优先于其它 link
    alt_link: Option<String>,
}

impl Entry {
    fn set(&mut self, field: Field, value: &str) {
        let value = value.trim();
        if value.is_empty() {
            return;
        }
        let slot = match field {
            Field::Title => &mut self.title,
            Field::Link => &mut self.link,
            Field::Summary => &mut self.summary,
            Field::Content => &mut self.content,
            Field::Published => &mut self.published,
            Field::Updated => &mut self.updated,
            Field::Author => &mut self.author,
        };
        if slot.is_none() {
            *slot = Some(value.to_string());
        }
    }

    fn into_raw(self, base_url: &str) -> Option<RawItem> {
        let title = self.title?.trim().to_string();
        if title.is_empty() {
            return None;
        }
        let link = self.alt_link.or(self.link)?;
        let url = resolve_url(base_url, &link)?;
        let published_at = self
            .published
            .as_deref()
            .and_then(datetime::parse_any)
            .or_else(|| self.updated.as_deref().and_then(datetime::parse_any));
        let summary = self
            .summary
            .as_deref()
            .and_then(clean_summary)
            .or_else(|| self.content.as_deref().and_then(clean_summary));
        Some(RawItem {
            title: title.clone(),
            url,
            published_at,
            summary,
            author: self.author.map(|a| a.trim().to_string()),
            lang: None,
            source_title: Some(title),
        })
    }
}

/// 解析订阅流。
pub fn parse(body: &str, base_url: &str) -> Result<Vec<RawItem>, AdapterError> {
    let trimmed = body.trim_start_matches('\u{feff}').trim_start();
    if trimmed.is_empty() {
        return Err(AdapterError::no_feed("response body is empty"));
    }
    if !trimmed.starts_with('<') {
        return Err(AdapterError::no_feed(
            "response is not XML (does it require login?)",
        ));
    }

    let mut reader = quick_xml::Reader::from_str(trimmed);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<String> = Vec::new();
    let mut root: Option<String> = None;
    let mut entry: Option<Entry> = None;
    let mut field: Option<Field> = None;
    let mut field_depth = 0usize;
    let mut items: Vec<RawItem> = Vec::new();
    let mut saw_entry = false;

    loop {
        let event = reader
            .read_event()
            .map_err(|e| AdapterError::no_feed(format!("XML parse error: {e}")))?;
        match event {
            quick_xml::events::Event::Start(ref e) => {
                let name = raw_name(e.name().as_ref());
                if root.is_none() {
                    if !matches!(name.as_str(), "rss" | "feed" | "rdf:rdf" | "rdf") {
                        return Err(AdapterError::no_feed(format!(
                            "root element <{name}> is not a feed"
                        )));
                    }
                    root = Some(name.clone());
                }
                stack.push(name.clone());
                if entry.is_none() && (name == "item" || name == "entry") {
                    saw_entry = true;
                    entry = Some(Entry::default());
                } else if entry.is_some() {
                    // 字段内的嵌套子元素（如 <description><p>…</p></description>）
                    // 不换字段，否则标签之间的正文会被截断
                    if field.is_none() {
                        let parent = stack
                            .len()
                            .checked_sub(2)
                            .and_then(|idx| stack.get(idx).cloned())
                            .unwrap_or_default();
                        if let Some(mapped) = field_for(&name, &parent) {
                            field = Some(mapped);
                            field_depth = stack.len();
                        }
                    }
                    if name == "link" {
                        if let Some(href) = attr(e, "href") {
                            let rel = attr(e, "rel").unwrap_or_else(|| "alternate".to_string());
                            if let Some(slot) = entry.as_mut() {
                                if rel == "alternate" || slot.alt_link.is_none() {
                                    slot.alt_link = Some(href);
                                }
                            }
                        }
                    }
                }
            }
            quick_xml::events::Event::Empty(ref e) => {
                let name = raw_name(e.name().as_ref());
                if entry.is_some() && name == "link" {
                    if let Some(href) = attr(e, "href") {
                        let rel = attr(e, "rel").unwrap_or_else(|| "alternate".to_string());
                        if let Some(slot) = entry.as_mut() {
                            if rel == "alternate" || slot.link.is_none() {
                                slot.alt_link = Some(href);
                            }
                        }
                    }
                }
            }
            quick_xml::events::Event::Text(ref t) => {
                if entry.is_some() && field.is_some() {
                    if let Ok(text) = t.unescape() {
                        if let (Some(slot), Some(f)) = (entry.as_mut(), field) {
                            slot.set(f, &text);
                        }
                    }
                }
            }
            quick_xml::events::Event::CData(ref c) => {
                if entry.is_some() && field.is_some() {
                    let text = String::from_utf8_lossy(c.as_ref()).to_string();
                    if let (Some(slot), Some(f)) = (entry.as_mut(), field) {
                        slot.set(f, &text);
                    }
                }
            }
            quick_xml::events::Event::End(ref e) => {
                let name = raw_name(e.name().as_ref());
                if field.is_some() && stack.len() == field_depth {
                    field = None;
                }
                stack.pop();
                if name == "item" || name == "entry" {
                    if let Some(entry) = entry.take() {
                        if let Some(raw) = entry.into_raw(base_url) {
                            items.push(raw);
                        }
                    }
                    field = None;
                }
            }
            quick_xml::events::Event::Eof => break,
            _ => {}
        }
    }

    if root.is_none() {
        return Err(AdapterError::no_feed("no root element"));
    }
    if !saw_entry {
        return Err(AdapterError::unexpected("feed declares no entries"));
    }
    if items.is_empty() {
        return Err(AdapterError::unexpected(
            "entries carry neither a usable title nor a resolvable link",
        ));
    }
    Ok(items)
}

fn raw_name(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_ascii_lowercase()
}

fn field_for(name: &str, parent: &str) -> Option<Field> {
    // 命名空间前缀任意（`dc:creator` / `content:encoded`），按限定名的尾段识别
    let local = name.rsplit(':').next().unwrap_or(name);
    match local {
        "title" => Some(Field::Title),
        "link" => Some(Field::Link),
        "description" | "summary" => Some(Field::Summary),
        "content" | "content:encoded" | "encoded" => Some(Field::Content),
        "pubdate" | "published" | "issued" | "date" => Some(Field::Published),
        "updated" | "modified" => Some(Field::Updated),
        "creator" | "author" => Some(Field::Author),
        // Atom 的 <author><name>作者名</name></author>
        "name" if parent == "author" => Some(Field::Author),
        _ => None,
    }
}

fn attr(e: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    e.attributes().flatten().find_map(|attribute| {
        if raw_name(attribute.key.as_ref()) == name {
            attribute.unescape_value().ok().map(|v| v.to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example World</title>
    <item>
      <title>First &amp; foremost</title>
      <link>https://example.com/a?utm_source=rss</link>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
      <pubDate>Tue, 10 Nov 2026 13:00:00 GMT</pubDate>
      <dc:creator>Alice</dc:creator>
    </item>
    <item>
      <title>Second</title>
      <link>/relative/b</link>
      <content:encoded><![CDATA[Full body text]]></content:encoded>
    </item>
  </channel>
</rss>"#;

    const ATOM: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Channel</title>
  <entry>
    <title>Video one</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
    <published>2026-11-10T13:00:00Z</published>
    <summary>About the video</summary>
    <author><name>Creator</name></author>
  </entry>
  <entry>
    <title>Video two</title>
    <link href="https://www.youtube.com/watch?v=def"/>
    <updated>2026-11-09T13:00:00Z</updated>
  </entry>
</feed>"#;

    #[test]
    fn parses_rss_items_with_summary_author_and_date() {
        let items = parse(RSS, "https://example.com/feed.xml").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "First & foremost");
        assert_eq!(items[0].url, "https://example.com/a?utm_source=rss");
        assert_eq!(items[0].summary.as_deref(), Some("Hello world"));
        assert_eq!(items[0].author.as_deref(), Some("Alice"));
        assert_eq!(
            items[0].published_at,
            crate::datetime::parse_rfc3339("2026-11-10T13:00:00Z")
        );
    }

    #[test]
    fn resolves_relative_links_and_uses_encoded_content_as_fallback() {
        let items = parse(RSS, "https://example.com/feed.xml").unwrap();
        assert_eq!(items[1].url, "https://example.com/relative/b");
        assert_eq!(items[1].summary.as_deref(), Some("Full body text"));
        assert_eq!(items[1].published_at, None, "无发布时间不猜");
    }

    #[test]
    fn parses_atom_entries_with_href_links() {
        let items = parse(ATOM, "https://www.youtube.com/feeds/videos.xml").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].url, "https://www.youtube.com/watch?v=abc");
        assert_eq!(items[0].author.as_deref(), Some("Creator"));
        assert_eq!(items[0].summary.as_deref(), Some("About the video"));
        assert_eq!(items[1].url, "https://www.youtube.com/watch?v=def");
        assert!(
            items[1].published_at.is_some(),
            "<updated> 作为发布时间兜底"
        );
    }

    #[test]
    fn non_xml_is_reported_as_no_feed() {
        let err = parse("<html><body>login</body></html>", "https://e.com").unwrap_err();
        assert_eq!(err.kind(), "parse.no_feed");
        let err = parse("{\"a\":1}", "https://e.com").unwrap_err();
        assert_eq!(err.kind(), "parse.no_feed");
        let err = parse("", "https://e.com").unwrap_err();
        assert_eq!(err.kind(), "parse.no_feed");
    }

    #[test]
    fn feed_without_entries_is_unexpected_shape_not_empty_success() {
        let body = "<rss><channel><title>x</title></channel></rss>";
        let err = parse(body, "https://e.com").unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn request_carries_accept_and_ua() {
        let request = build_request("https://example.com/feed", None);
        assert_eq!(request.method, "GET");
        assert!(request
            .headers
            .iter()
            .any(|(k, v)| k == "User-Agent" && v.contains("WasmNestNews")));
        assert!(request.headers.iter().any(|(k, _)| k == "Accept"));
    }
}
