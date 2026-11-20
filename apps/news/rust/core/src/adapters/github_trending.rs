//! GitHub Trending 榜单页（HTML）。
//!
//! 刻意不引入 HTML 解析器：v1 只服务这一个内置榜单页，且结构稳定到可以用
//! 「切 `<article>` 块 + 取第一个仓库链接」这种可读切分覆盖。页面结构一变就
//! 返回 `parse.unexpected_shape`（界面提示「源结构可能已变更」），**不空返回**。
//!
//! 榜单顺序不参与热度分：条目一律没有发布时间（入库时填抓到时刻），排序仍由
//! 统一公式决定。

use super::AdapterError;
use crate::domain::RawItem;
use crate::ports::FetchRequest;
use crate::urlutil::{clean_summary, strip_tags};

/// 榜单页请求。
pub fn build_request(url: &str, _auth: Option<&super::AuthSecret>) -> FetchRequest {
    let target = if url.trim().is_empty() {
        "https://github.com/trending".to_string()
    } else {
        url.trim().to_string()
    };
    FetchRequest {
        method: "GET".to_string(),
        url: target,
        headers: vec![
            ("Accept".to_string(), "text/html".to_string()),
            (
                "User-Agent".to_string(),
                super::DEFAULT_USER_AGENT.to_string(),
            ),
        ],
        body: None,
    }
}

/// 解析榜单页。
pub fn parse(body: &str, _base_url: &str) -> Result<Vec<RawItem>, AdapterError> {
    if body.trim().is_empty() {
        return Err(AdapterError::no_feed("response body is empty"));
    }
    if !body.contains("<article") {
        return Err(AdapterError::unexpected(
            "trending page carries no article blocks (structure changed or request blocked)",
        ));
    }
    let mut items = Vec::new();
    for block in body.split("<article").skip(1) {
        let block = match block.find("</article>") {
            Some(end) => &block[..end],
            None => block,
        };
        let Some(repo) = extract_repo(block) else {
            continue;
        };
        let summary = extract_description(block);
        items.push(RawItem {
            title: repo.clone(),
            url: format!("https://github.com/{repo}"),
            published_at: None,
            summary,
            author: None,
            lang: None,
            source_title: Some("GitHub Trending".to_string()),
        });
    }
    if items.is_empty() {
        return Err(AdapterError::unexpected(
            "trending article blocks carry no repository links",
        ));
    }
    Ok(items)
}

/// 从一个 `<article>` 块里取 `owner/repo`。
fn extract_repo(block: &str) -> Option<String> {
    let mut rest = block;
    while let Some(idx) = rest.find("href=\"/") {
        let after = &rest[idx + "href=\"/".len()..];
        let end = after.find('"')?;
        let path = &after[..end];
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        if parts.len() == 2 && !path.contains('?') && !path.contains('#') {
            let (owner, repo) = (parts[0], parts[1]);
            if is_slug(owner) && is_slug(repo) {
                return Some(format!("{owner}/{repo}"));
            }
        }
        rest = &after[end..];
    }
    None
}

fn is_slug(part: &str) -> bool {
    !part.is_empty()
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// 取第一个 `<p>` 段落当描述（`Built by` 那行是聚合统计，跳过）。
fn extract_description(block: &str) -> Option<String> {
    let mut rest = block;
    while let Some(idx) = rest.find("<p") {
        let after = &rest[idx..];
        let open_end = after.find('>')?;
        let content = &after[open_end + 1..];
        let close = content.find("</p>")?;
        let raw = &content[..close];
        let text = strip_tags(raw);
        let text = text.trim();
        if !text.is_empty() && !text.starts_with("Built by") {
            return clean_summary(text);
        }
        rest = &content[close + 4..];
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"<!DOCTYPE html>
<html><body>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/octocat/hello-world" class="Link">
      <svg class="octicon"></svg>
      <span>octocat</span> / <strong>hello-world</strong>
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">
    My first repository on GitHub &amp; more
  </p>
  <div class="f6"><span>Built by</span></div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/rust-lang/rust">rust-lang / rust</a>
  </h2>
  <p class="col-9">A language empowering everyone</p>
</article>
</body></html>"#;

    #[test]
    fn maps_repo_rows() {
        let items = parse(FIXTURE, "https://github.com/trending").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "octocat/hello-world");
        assert_eq!(items[0].url, "https://github.com/octocat/hello-world");
        assert_eq!(
            items[0].summary.as_deref(),
            Some("My first repository on GitHub & more")
        );
        assert_eq!(items[1].title, "rust-lang/rust");
        assert_eq!(items[0].published_at, None, "榜单页没有发布时间");
    }

    #[test]
    fn page_without_article_blocks_is_unexpected_shape() {
        let err = parse(
            "<html><body>Sign in</body></html>",
            "https://github.com/trending",
        )
        .unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
        assert!(err.detail().contains("article"));
    }

    #[test]
    fn article_blocks_without_repo_links_are_unexpected_shape() {
        let body = "<article><h2><a href=\"/login?return_to=%2F\">Sign in</a></h2></article>";
        let err = parse(body, "https://github.com/trending").unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn empty_body_is_no_feed() {
        assert_eq!(parse("  ", "").unwrap_err().kind(), "parse.no_feed");
    }

    #[test]
    fn built_by_line_is_never_used_as_summary() {
        let body =
            "<article><a href=\"/a/b\">a/b</a><p>Built by people</p><p>Real summary</p></article>";
        let items = parse(body, "").unwrap();
        assert_eq!(items[0].summary.as_deref(), Some("Real summary"));
    }
}
