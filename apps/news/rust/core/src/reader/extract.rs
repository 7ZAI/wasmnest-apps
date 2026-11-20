//! 正文抽取：HTML → 候选容器评分 → 结构化纯文本块。
//!
//! 解析器是拉取式 tokenizer，这里自建一棵最小文档树。抽取只输出纯文本块，
//! 不保留链接、图片、表格或任何内联标签；失败一律返回分类错误，绝不返回空正文。

use crate::domain::{error_kind, BlockKind, ContentBlock};
use crate::reader::policy;
use crate::urlutil;
use htmlparser::{ElementEnd, Token, Tokenizer};

/// 抽取结果；`blocks` 已按上限截断。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedContent {
    pub blocks: Vec<ContentBlock>,
    pub text_length: u32,
    pub bytes: u64,
    pub truncated: bool,
}

/// 抽取失败分类。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtractError {
    Encoding,
    NoContent,
    TooLarge,
    Failed(String),
}

impl ExtractError {
    /// 稳定的错误分类码。
    pub fn code(&self) -> &'static str {
        match self {
            ExtractError::Encoding => error_kind::EXTRACT_ENCODING,
            ExtractError::NoContent => error_kind::EXTRACT_NO_CONTENT,
            ExtractError::TooLarge => error_kind::EXTRACT_TOO_LARGE,
            ExtractError::Failed(_) => error_kind::EXTRACT_FAILED,
        }
    }

    /// 一句原因；不包含正文片段。
    pub fn detail(&self) -> String {
        match self {
            ExtractError::Encoding => "the page contains too many replacement characters".into(),
            ExtractError::NoContent => "no readable article content was found".into(),
            ExtractError::TooLarge => "the page exceeds the readable size limit".into(),
            ExtractError::Failed(reason) => reason.clone(),
        }
    }
}

/// 从 HTML 抽取正文。`item_title` 用于去掉重复的首块标题。
pub fn extract(html: &str, item_title: &str) -> Result<ExtractedContent, ExtractError> {
    if policy::has_encoding_issue(html) {
        return Err(ExtractError::Encoding);
    }
    let document = parse_document(html);
    let candidate = select_candidate(&document).ok_or(ExtractError::NoContent)?;
    let stats = subtree_stats(candidate.node);
    if stats.text_len == 0 {
        return Err(ExtractError::NoContent);
    }
    if stats.score() <= 0 {
        return Err(ExtractError::NoContent);
    }
    if candidate.tier > TIER_MAIN && stats.text_len < policy::MIN_CONTENT_CHARS {
        return Err(ExtractError::NoContent);
    }

    let mut blocks = Vec::new();
    let mut pending = String::new();
    walk_children(candidate.node, &mut blocks, &mut pending);
    flush_pending(&mut blocks, &mut pending);
    let blocks = post_process(blocks, item_title);
    if blocks.is_empty() {
        return Err(ExtractError::NoContent);
    }
    let truncated = policy::truncate_blocks(blocks);
    if truncated.blocks.is_empty() {
        return Err(ExtractError::NoContent);
    }
    let text_length = policy::text_length(&truncated.blocks);
    let bytes = serde_json::to_vec(&truncated.blocks)
        .map_err(|error| ExtractError::Failed(format!("serialize blocks: {error}")))?
        .len() as u64;
    validate_content(&truncated.blocks, text_length, bytes)?;
    Ok(ExtractedContent {
        blocks: truncated.blocks,
        text_length,
        bytes,
        truncated: truncated.truncated,
    })
}

/// 健康度检查：块非空、字符数一致、字节数与序列化结果一致、每块文本非空。
pub fn validate_content(
    blocks: &[ContentBlock],
    text_length: u32,
    bytes: u64,
) -> Result<(), ExtractError> {
    if blocks.is_empty() {
        return Err(ExtractError::NoContent);
    }
    if blocks.iter().any(|block| block.text.is_empty()) {
        return Err(ExtractError::Failed("empty content block".into()));
    }
    let expected_length = policy::text_length(blocks);
    if expected_length != text_length {
        return Err(ExtractError::Failed("text length mismatch".into()));
    }
    let expected_bytes = serde_json::to_vec(blocks)
        .map_err(|error| ExtractError::Failed(format!("serialize blocks: {error}")))?
        .len() as u64;
    if expected_bytes != bytes {
        return Err(ExtractError::Failed("byte length mismatch".into()));
    }
    Ok(())
}

// ==================== 最小文档树 ====================

#[derive(Debug, Clone, Default)]
struct Node {
    tag: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<Node>,
}

impl Node {
    fn element(tag: &str) -> Self {
        Self {
            tag: tag.to_ascii_lowercase(),
            ..Self::default()
        }
    }

    fn text_node(text: &str) -> Self {
        Self {
            tag: "#text".into(),
            text: text.to_string(),
            ..Self::default()
        }
    }

    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    fn is_text(&self) -> bool {
        self.tag == "#text"
    }
}

fn parse_document(html: &str) -> Node {
    let mut root = Node::element("#document");
    let mut stack: Vec<Node> = Vec::new();
    let mut pending: Option<Node> = None;

    for token in Tokenizer::from(html) {
        let Ok(token) = token else {
            continue;
        };
        match token {
            Token::ElementStart { local, .. } => {
                let tag = local.as_str().to_ascii_lowercase();
                auto_close(&mut stack, &mut root, &tag);
                pending = Some(Node::element(&tag));
            }
            Token::Attribute { local, value, .. } => {
                if let Some(node) = pending.as_mut() {
                    if let Some(value) = value {
                        node.attrs.push((
                            local.as_str().to_ascii_lowercase(),
                            value.as_str().to_string(),
                        ));
                    }
                }
            }
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => {
                    if let Some(node) = pending.take() {
                        if is_void(&node.tag) {
                            append_node(&mut stack, &mut root, node);
                        } else {
                            stack.push(node);
                        }
                    }
                }
                ElementEnd::Empty => {
                    if let Some(node) = pending.take() {
                        append_node(&mut stack, &mut root, node);
                    }
                }
                ElementEnd::Close(_, local) => {
                    pending = None;
                    close_tag(&mut stack, &mut root, &local.as_str().to_ascii_lowercase());
                }
            },
            Token::Text { text } => {
                push_text(&mut stack, &mut root, text.as_str());
            }
            Token::Cdata { text, .. } => {
                push_text(&mut stack, &mut root, text.as_str());
            }
            _ => {}
        }
    }

    while let Some(node) = stack.pop() {
        append_node(&mut stack, &mut root, node);
    }
    root
}

fn append_node(stack: &mut Vec<Node>, root: &mut Node, node: Node) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        root.children.push(node);
    }
}

fn push_text(stack: &mut Vec<Node>, root: &mut Node, text: &str) {
    if text.is_empty() {
        return;
    }
    let node = Node::text_node(text);
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        root.children.push(node);
    }
}

fn close_tag(stack: &mut Vec<Node>, root: &mut Node, tag: &str) {
    if !stack.iter().any(|node| node.tag == tag) {
        return;
    }
    while let Some(node) = stack.pop() {
        let matched = node.tag == tag;
        if let Some(parent) = stack.last_mut() {
            parent.children.push(node);
        } else {
            root.children.push(node);
        }
        if matched {
            break;
        }
    }
}

/// 处理常见的可选闭合标签，避免拉取式解析把后续内容挂到错误父节点。
fn auto_close(stack: &mut Vec<Node>, root: &mut Node, next_tag: &str) {
    while let Some(top) = stack.last() {
        let should_close = match next_tag {
            "p" => top.tag == "p",
            "li" => top.tag == "li",
            "tr" => top.tag == "tr",
            "td" | "th" => matches!(top.tag.as_str(), "td" | "th"),
            _ => {
                is_block_start(next_tag)
                    && matches!(
                        top.tag.as_str(),
                        "p" | "li" | "dt" | "dd" | "option" | "summary"
                    )
            }
        };
        if !should_close {
            break;
        }
        if let Some(node) = stack.pop() {
            append_node(stack, root, node);
        }
    }
}

fn is_void(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

// ==================== 候选容器 ====================

const TIER_ARTICLE: u8 = 1;
const TIER_MAIN: u8 = 2;
const TIER_ROLE_MAIN: u8 = 3;
const TIER_SEMANTIC: u8 = 4;
const TIER_BODY: u8 = 5;

const SEMANTIC_WORDS: &[&str] = &["article", "content", "post", "entry", "story", "body"];

struct Candidate<'a> {
    node: &'a Node,
    tier: u8,
    stats: SubtreeStats,
}

#[derive(Debug, Clone, Copy, Default)]
struct SubtreeStats {
    text_len: usize,
    link_text_len: usize,
}

impl SubtreeStats {
    fn link_density(self) -> f64 {
        policy::link_density(self.text_len, self.link_text_len)
    }

    fn score(self) -> i64 {
        let base = self.text_len as i64 - 2 * self.link_text_len as i64;
        if self.link_density() > policy::LINK_DENSITY_LIMIT {
            (base as f64 * 0.2).round() as i64
        } else {
            base
        }
    }
}

fn select_candidate(document: &Node) -> Option<Candidate<'_>> {
    let mut candidates = Vec::new();
    collect_candidates(document, &mut candidates);
    for tier in TIER_ARTICLE..=TIER_SEMANTIC {
        let best = candidates
            .iter()
            .filter(|candidate| candidate.tier == tier)
            .max_by_key(|candidate| candidate.stats.score());
        if let Some(candidate) = best {
            if candidate.stats.text_len > 0 && candidate.stats.score() > 0 {
                return Some(Candidate {
                    node: candidate.node,
                    tier: candidate.tier,
                    stats: candidate.stats,
                });
            }
        }
    }
    let body = candidates
        .iter()
        .filter(|candidate| candidate.tier == TIER_BODY)
        .max_by_key(|candidate| candidate.stats.score());
    body.map(|candidate| Candidate {
        node: candidate.node,
        tier: candidate.tier,
        stats: candidate.stats,
    })
}

fn collect_candidates<'a>(node: &'a Node, out: &mut Vec<Candidate<'a>>) {
    if is_skipped(node) {
        return;
    }
    if let Some(tier) = candidate_tier(node) {
        out.push(Candidate {
            node,
            tier,
            stats: subtree_stats(node),
        });
    }
    for child in &node.children {
        collect_candidates(child, out);
    }
}

fn candidate_tier(node: &Node) -> Option<u8> {
    if node.tag == "article" {
        return Some(TIER_ARTICLE);
    }
    if node.tag == "main" {
        return Some(TIER_MAIN);
    }
    if node
        .attr("role")
        .map(|role| role.eq_ignore_ascii_case("main"))
        .unwrap_or(false)
    {
        return Some(TIER_ROLE_MAIN);
    }
    if has_semantic_word(node) {
        return Some(TIER_SEMANTIC);
    }
    if node.tag == "body" {
        return Some(TIER_BODY);
    }
    None
}

fn has_semantic_word(node: &Node) -> bool {
    ["class", "id"].iter().any(|name| {
        node.attr(name)
            .map(|value| {
                value
                    .split(|ch: char| !ch.is_alphanumeric())
                    .filter(|token| !token.is_empty())
                    .any(|token| {
                        SEMANTIC_WORDS
                            .iter()
                            .any(|word| token.eq_ignore_ascii_case(word))
                    })
            })
            .unwrap_or(false)
    })
}

fn subtree_stats(node: &Node) -> SubtreeStats {
    let mut stats = SubtreeStats::default();
    accumulate_stats(node, false, &mut stats);
    stats
}

fn accumulate_stats(node: &Node, in_link: bool, stats: &mut SubtreeStats) {
    if is_skipped(node) {
        return;
    }
    if node.is_text() {
        let length = node.text.chars().count();
        stats.text_len += length;
        if in_link {
            stats.link_text_len += length;
        }
        return;
    }
    let in_link = in_link || node.tag == "a";
    for child in &node.children {
        accumulate_stats(child, in_link, stats);
    }
}

// ==================== 块序列 ====================

fn walk_children(node: &Node, out: &mut Vec<ContentBlock>, pending: &mut String) {
    for child in &node.children {
        if is_skipped(child) {
            continue;
        }
        if let Some(block) = block_from(child) {
            flush_pending(out, pending);
            out.push(block);
            continue;
        }
        if is_block_container(child) {
            flush_pending(out, pending);
            let mut nested = String::new();
            walk_children(child, out, &mut nested);
            flush_pending(out, &mut nested);
        } else {
            append_text(child, pending);
        }
    }
}

fn block_from(node: &Node) -> Option<ContentBlock> {
    let kind = match node.tag.as_str() {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            let level = match node.tag.as_str() {
                "h1" => 1,
                "h2" => 2,
                _ => 3,
            };
            let text = text_of(node);
            if text.is_empty() {
                return None;
            }
            return Some(ContentBlock {
                kind: BlockKind::Heading,
                level: Some(level),
                text,
            });
        }
        "p" | "figcaption" | "summary" => BlockKind::Paragraph,
        "li" => BlockKind::ListItem,
        "blockquote" => BlockKind::Quote,
        "pre" | "code" => BlockKind::Code,
        _ => return None,
    };
    let text = if kind == BlockKind::Code {
        code_text_of(node)
    } else {
        text_of(node)
    };
    if text.is_empty() {
        return None;
    }
    Some(ContentBlock {
        kind,
        level: None,
        text,
    })
}

fn flush_pending(out: &mut Vec<ContentBlock>, pending: &mut String) {
    let text = normalize_text(pending);
    pending.clear();
    if !text.is_empty() {
        out.push(ContentBlock {
            kind: BlockKind::Paragraph,
            level: None,
            text,
        });
    }
}

fn text_of(node: &Node) -> String {
    let mut raw = String::new();
    append_text(node, &mut raw);
    normalize_text(&raw)
}

fn code_text_of(node: &Node) -> String {
    let mut raw = String::new();
    append_code_text(node, &mut raw);
    normalize_code_text(&raw)
}

fn append_text(node: &Node, out: &mut String) {
    if is_skipped(node) {
        return;
    }
    if node.is_text() {
        out.push_str(&node.text);
        return;
    }
    if node.tag == "br" {
        out.push(' ');
        return;
    }
    for child in &node.children {
        append_text(child, out);
    }
}

fn append_code_text(node: &Node, out: &mut String) {
    if is_skipped(node) {
        return;
    }
    if node.is_text() {
        out.push_str(&node.text);
        return;
    }
    if node.tag == "br" {
        out.push('\n');
        return;
    }
    if matches!(node.tag.as_str(), "p" | "div" | "li" | "tr") {
        out.push('\n');
    }
    for child in &node.children {
        append_code_text(child, out);
    }
}

fn normalize_text(raw: &str) -> String {
    urlutil::decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_code_text(raw: &str) -> String {
    urlutil::decode_entities(raw)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

// ==================== 后处理 ====================

fn post_process(blocks: Vec<ContentBlock>, item_title: &str) -> Vec<ContentBlock> {
    let mut kept: Vec<ContentBlock> = blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .filter(|block| !is_pure_url(&block.text))
        .filter(|block| !is_navigation_label(&block.text))
        .collect();

    let mut merged: Vec<ContentBlock> = Vec::with_capacity(kept.len());
    for block in kept.drain(..) {
        let can_merge = merged
            .last()
            .map(|previous: &ContentBlock| {
                previous.kind == BlockKind::Paragraph
                    && block.kind == BlockKind::Paragraph
                    && previous.text.chars().count() < policy::MERGE_PARA_CHARS
                    && block.text.chars().count() < policy::MERGE_PARA_CHARS
            })
            .unwrap_or(false);
        if can_merge {
            let previous = merged.last_mut().expect("checked above");
            previous.text.push(' ');
            previous.text.push_str(&block.text);
        } else {
            merged.push(block);
        }
    }

    let title = normalize_text(item_title).to_lowercase();
    if !title.is_empty() {
        let duplicate = merged.first().map(|block| {
            matches!(block.kind, BlockKind::Heading | BlockKind::Paragraph)
                && urlutil::title_fingerprint(&block.text) == urlutil::title_fingerprint(&title)
        });
        if duplicate.unwrap_or(false) {
            merged.remove(0);
        }
    }
    merged
}

fn is_pure_url(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.contains(char::is_whitespace) {
        return false;
    }
    trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("www.")
}

fn is_navigation_label(text: &str) -> bool {
    let lowered = text.trim().to_lowercase();
    matches!(
        lowered.as_str(),
        "home"
            | "menu"
            | "login"
            | "sign in"
            | "sign up"
            | "subscribe"
            | "share"
            | "next"
            | "previous"
            | "首页"
            | "登录"
            | "注册"
            | "订阅"
            | "分享"
            | "上一页"
            | "下一页"
            | "更多"
    )
}

// ==================== 结构判断 ====================

fn is_skipped(node: &Node) -> bool {
    if node.is_text() {
        return false;
    }
    matches!(
        node.tag.as_str(),
        "script"
            | "style"
            | "nav"
            | "header"
            | "footer"
            | "aside"
            | "form"
            | "iframe"
            | "svg"
            | "noscript"
            | "head"
            | "title"
            | "meta"
            | "link"
            | "base"
            | "img"
            | "table"
            | "thead"
            | "tbody"
            | "tr"
            | "td"
            | "th"
    )
}

fn is_block_container(node: &Node) -> bool {
    matches!(
        node.tag.as_str(),
        "div"
            | "section"
            | "article"
            | "main"
            | "body"
            | "html"
            | "#document"
            | "ul"
            | "ol"
            | "dl"
            | "figure"
            | "details"
    )
}

fn is_block_start(tag: &str) -> bool {
    matches!(
        tag,
        "address"
            | "article"
            | "aside"
            | "blockquote"
            | "details"
            | "dialog"
            | "div"
            | "dl"
            | "fieldset"
            | "figcaption"
            | "figure"
            | "footer"
            | "form"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "hr"
            | "main"
            | "menu"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "table"
            | "ul"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const X01_BLOG: &str = r#"<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav><article><h1>Deep Dive</h1><p>First paragraph with enough words to be kept as real article content for the reader.</p><h2>Section</h2><p>Second paragraph with more detail and a <a href="https://example.com">useful link</a>.</p></article><aside><p>Related stories you should read</p></aside><footer><p>Copyright 2026 Example</p></footer></body></html>"#;
    const X02_NEWS: &str = r#"<html><body><main><section><h1>World News</h1><p>The main story body starts here with several words so that the extractor keeps it.</p><p>Another section paragraph continues the report with useful details.</p></section><section><p>Background paragraph for the same report.</p></section></main></body></html>"#;
    const X03_LIST: &str = r#"<html><body><ul><li><a href="/a">Alpha headline about the economy today</a></li><li><a href="/b">Beta headline about the election today</a></li><li><a href="/c">Gamma headline about the weather today</a></li><li><a href="/d">Delta headline about sports today</a></li></ul></body></html>"#;
    const X04_SHORT: &str = r#"<html><body><div><p>Short notice.</p></div></body></html>"#;
    const X05_NESTED: &str = r#"<html><body><div><div><div><div><p>Nested paragraph with enough characters to pass the minimum content threshold for body fallback.</p><p>Second nested paragraph also has enough characters to be included in the result.</p></div></div></div></div></body></html>"#;
    const X06_MIXED: &str = r#"<html><body><article><blockquote>Quoted sentence.</blockquote><pre>let x = 1;
let y = 2;</pre><ul><li>First item</li><li>Second item</li></ul><p>Closing paragraph.</p></article></body></html>"#;
    const X07_ENTITIES: &str = r#"<html><body><article><p>Tom &amp; Jerry &#39;quote&#39; 全角标点！</p></article></body></html>"#;
    const X08_DUP_TITLE: &str = r#"<html><body><article><h1>Same Title</h1><p>Body paragraph that should remain after the duplicate heading is removed.</p></article></body></html>"#;
    const X11_BAD_ENCODING: &str = "\u{FFFD}\u{FFFD}\u{FFFD}abc";
    const X12_EMPTY: &str = r#"<html><body><script>var x = 1;</script></body></html>"#;
    const X13_SEMANTIC: &str = r#"<html><body><div class="entry-content"><p>Semantic class content with enough words to be selected as the article body, including a longer sentence that clears the minimum content threshold.</p></div></body></html>"#;
    const X14_TABLE_IMAGE: &str = r#"<html><body><article><p>Paragraph before table.</p><table><tr><td>cell text</td></tr></table><p>Paragraph after image <img src="https://example.com/a.png">.</p></article></body></html>"#;

    fn blocks_text(content: &ExtractedContent) -> String {
        content
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn x01_blog_uses_article_and_drops_sidebar() {
        let content = extract(X01_BLOG, "Deep Dive").expect("blog extracts");
        let text = blocks_text(&content);
        assert!(text.contains("First paragraph"));
        assert!(text.contains("Second paragraph"));
        assert!(!text.contains("Related stories"));
        assert!(!text.contains("Copyright"));
        assert!(!text.contains("Home"));
    }

    #[test]
    fn x02_news_keeps_dom_order() {
        let content = extract(X02_NEWS, "World News").expect("news extracts");
        let text = blocks_text(&content);
        let first = text.find("main story").expect("first paragraph");
        let second = text.find("Another section").expect("second paragraph");
        assert!(first < second);
    }

    #[test]
    fn x03_link_list_is_rejected() {
        assert_eq!(extract(X03_LIST, "Headlines"), Err(ExtractError::NoContent));
    }

    #[test]
    fn x04_short_notice_is_rejected() {
        assert_eq!(extract(X04_SHORT, "Notice"), Err(ExtractError::NoContent));
    }

    #[test]
    fn x05_nested_div_falls_back_to_body() {
        let content = extract(X05_NESTED, "Nested").expect("nested content extracts");
        assert!(blocks_text(&content).contains("Nested paragraph"));
    }

    #[test]
    fn x06_quote_code_and_list_blocks() {
        let content = extract(X06_MIXED, "Mixed").expect("mixed content extracts");
        assert!(content
            .blocks
            .iter()
            .any(|block| block.kind == BlockKind::Quote));
        assert!(content
            .blocks
            .iter()
            .any(|block| block.kind == BlockKind::Code && block.text.contains("let x = 1;")));
        assert_eq!(
            content
                .blocks
                .iter()
                .filter(|block| block.kind == BlockKind::ListItem)
                .count(),
            2
        );
    }

    #[test]
    fn x07_entities_are_decoded() {
        let content = extract(X07_ENTITIES, "Entities").expect("entities extract");
        let text = blocks_text(&content);
        assert!(text.contains("Tom & Jerry 'quote' 全角标点！"));
    }

    #[test]
    fn x08_duplicate_title_is_removed() {
        let content = extract(X08_DUP_TITLE, "Same Title").expect("duplicate title extracts");
        assert_eq!(
            blocks_text(&content).matches("Same Title").count(),
            0,
            "标题块应被去掉"
        );
    }

    #[test]
    fn x09_long_content_is_truncated_on_char_boundary() {
        let mut html = String::from("<html><body><article><p>");
        html.push_str(&"中".repeat(policy::MAX_CONTENT_BYTES));
        html.push_str("</p></article></body></html>");
        let content = extract(&html, "Long").expect("long content extracts");
        assert!(content.truncated);
        assert!(content.text_length as usize <= policy::MAX_CONTENT_BYTES);
        assert!(!blocks_text(&content).contains('\u{FFFD}'));
    }

    #[test]
    fn x10_block_limit_is_enforced() {
        let mut html = String::from("<html><body><article>");
        for index in 0..policy::MAX_BLOCKS + 20 {
            html.push_str(&format!(
                "<p>Paragraph {index} with enough characters to stay in the output.</p>"
            ));
        }
        html.push_str("</article></body></html>");
        let content = extract(&html, "Many").expect("many blocks extract");
        assert!(content.truncated);
        assert_eq!(content.blocks.len(), policy::MAX_BLOCKS);
    }

    #[test]
    fn x11_replacement_chars_are_encoding_failure() {
        assert_eq!(
            extract(X11_BAD_ENCODING, "Bad"),
            Err(ExtractError::Encoding)
        );
    }

    #[test]
    fn x12_empty_body_never_returns_empty_ready() {
        assert_eq!(extract(X12_EMPTY, "Empty"), Err(ExtractError::NoContent));
    }

    #[test]
    fn x13_semantic_class_is_a_candidate() {
        let content = extract(X13_SEMANTIC, "Semantic").expect("semantic content extracts");
        assert!(blocks_text(&content).contains("Semantic class content"));
    }

    #[test]
    fn x14_tables_and_images_are_not_emitted() {
        let content = extract(X14_TABLE_IMAGE, "Media").expect("media content extracts");
        let text = blocks_text(&content);
        assert!(text.contains("Paragraph before table"));
        assert!(!text.contains("cell text"));
        assert!(!text.contains("a.png"));
    }

    #[test]
    fn health_check_rejects_inconsistent_stats() {
        let blocks = vec![ContentBlock {
            kind: BlockKind::Paragraph,
            level: None,
            text: "valid".into(),
        }];
        assert!(matches!(
            validate_content(&blocks, 99, 1),
            Err(ExtractError::Failed(_))
        ));
        assert!(matches!(
            validate_content(&blocks, 5, 99),
            Err(ExtractError::Failed(_))
        ));
        let bytes = serde_json::to_vec(&blocks).expect("blocks serialize").len() as u64;
        assert!(validate_content(&blocks, 5, bytes).is_ok());
    }
}
