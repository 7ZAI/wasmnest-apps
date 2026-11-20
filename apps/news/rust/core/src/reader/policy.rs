//! 阅读缓存、容量、截断与质量判据的纯函数。
//!
//! 所有时间都由调用方传入，函数不读系统时钟、不碰端口，便于 native 单测覆盖边界。

use crate::domain::ContentBlock;

/// 非归档正文的有效期。
pub const CACHE_TTL_MS: i64 = 7 * 86_400_000;

/// 失败记录的复用窗口；窗口内重复阅读不再出网。
pub const FAILURE_TTL_MS: i64 = 10 * 60_000;

/// 单篇正文的 UTF-8 字节上限，超出按字符边界截断。
pub const MAX_CONTENT_BYTES: usize = 256 * 1024;

/// 单篇正文的块数上限。
pub const MAX_BLOCKS: usize = 2000;

/// 本机正文总量的软上限；超过后先淘汰最旧的非归档正文。
pub const STORAGE_SOFT_LIMIT_BYTES: u64 = 128 * 1024 * 1024;

/// 非 `article` / `main` 容器被视为正文所需的最小字符数。
pub const MIN_CONTENT_CHARS: usize = 80;

/// 替换字符 U+FFFD 的占比阈值，超过即判为编码异常。
pub const REPLACEMENT_CHAR_RATIO: f64 = 0.01;

/// 相邻短段落合并阈值；低于该长度且相邻的段落会合并。
pub const MERGE_PARA_CHARS: usize = 40;

/// 链接密度超过该值时视为导航噪声。
pub const LINK_DENSITY_LIMIT: f64 = 0.5;

/// 归档正文永久有效；非归档按成功抓取时间计算 7 天。
pub fn cache_is_fresh(archived: bool, fetched_at: i64, now_ms: i64) -> bool {
    archived || now_ms.saturating_sub(fetched_at) < CACHE_TTL_MS
}

/// 失败记录在 10 分钟内可直接复用。
pub fn failure_is_fresh(last_attempt_at: i64, now_ms: i64) -> bool {
    now_ms.saturating_sub(last_attempt_at) < FAILURE_TTL_MS
}

/// 链接文字占比。
pub fn link_density(text_len: usize, link_text_len: usize) -> f64 {
    if text_len == 0 {
        0.0
    } else {
        link_text_len as f64 / text_len as f64
    }
}

/// 覆盖写入后的总量：现有总量减去被替换行，再加上新正文。
pub fn projected_total(current: u64, replaced: u64, incoming: u64) -> u64 {
    current.saturating_sub(replaced).saturating_add(incoming)
}

/// 链接密度是否高到应降权。
pub fn is_link_heavy(text_len: usize, link_text_len: usize) -> bool {
    link_density(text_len, link_text_len) > LINK_DENSITY_LIMIT
}

/// U+FFFD 在全部字符中的占比；空文本记为 0。
pub fn replacement_ratio(text: &str) -> f64 {
    let total = text.chars().count();
    if total == 0 {
        return 0.0;
    }
    let replacements = text.chars().filter(|ch| *ch == '\u{FFFD}').count();
    replacements as f64 / total as f64
}

/// 编码是否应判为不可解析。
pub fn has_encoding_issue(text: &str) -> bool {
    replacement_ratio(text) > REPLACEMENT_CHAR_RATIO
}

/// 块序列的字符总数（Unicode scalar values）。
pub fn text_length(blocks: &[ContentBlock]) -> u32 {
    blocks
        .iter()
        .map(|block| block.text.chars().count())
        .sum::<usize>()
        .min(u32::MAX as usize) as u32
}

/// 块序列文本的 UTF-8 字节数（不含 JSON 结构开销）。
pub fn text_bytes(blocks: &[ContentBlock]) -> usize {
    blocks.iter().map(|block| block.text.len()).sum()
}

/// 截断结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TruncatedBlocks {
    pub blocks: Vec<ContentBlock>,
    pub truncated: bool,
}

/// 按块数与总字节上限截断；截断点落在字符边界，不产生 U+FFFD。
pub fn truncate_blocks(blocks: Vec<ContentBlock>) -> TruncatedBlocks {
    let mut output = Vec::new();
    let mut used = 0usize;
    for mut block in blocks {
        if output.len() >= MAX_BLOCKS {
            return TruncatedBlocks {
                blocks: output,
                truncated: true,
            };
        }
        let block_bytes = block.text.len();
        if used + block_bytes <= MAX_CONTENT_BYTES {
            used += block_bytes;
            output.push(block);
            continue;
        }
        let remaining = MAX_CONTENT_BYTES.saturating_sub(used);
        let cut = floor_char_boundary(&block.text, remaining);
        if cut > 0 {
            block.text.truncate(cut);
            output.push(block);
        }
        return TruncatedBlocks {
            blocks: output,
            truncated: true,
        };
    }
    TruncatedBlocks {
        blocks: output,
        truncated: false,
    }
}

fn floor_char_boundary(text: &str, max_bytes: usize) -> usize {
    if max_bytes >= text.len() {
        return text.len();
    }
    let mut cut = max_bytes;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::BlockKind;

    fn paragraph(text: &str) -> ContentBlock {
        ContentBlock {
            kind: BlockKind::Paragraph,
            level: None,
            text: text.to_string(),
        }
    }

    #[test]
    fn cache_ttl_is_inclusive_at_seven_days() {
        let fetched = 1_700_000_000_000;
        assert!(cache_is_fresh(false, fetched, fetched + CACHE_TTL_MS - 1));
        assert!(!cache_is_fresh(false, fetched, fetched + CACHE_TTL_MS));
        assert!(cache_is_fresh(true, fetched, fetched + CACHE_TTL_MS * 100));
    }

    #[test]
    fn failure_ttl_is_inclusive_at_ten_minutes() {
        let attempted = 1_700_000_000_000;
        assert!(failure_is_fresh(attempted, attempted + FAILURE_TTL_MS - 1));
        assert!(!failure_is_fresh(attempted, attempted + FAILURE_TTL_MS));
    }

    #[test]
    fn projected_total_accounts_for_replaced_content() {
        assert_eq!(projected_total(100, 40, 30), 90);
        assert_eq!(projected_total(0, 10, 30), 30);
    }

    #[test]
    fn link_density_flags_navigation() {
        assert!(is_link_heavy(20, 15));
        assert!(!is_link_heavy(20, 5));
        assert_eq!(link_density(0, 0), 0.0);
    }

    #[test]
    fn encoding_ratio_uses_replacement_chars() {
        assert!(has_encoding_issue("\u{FFFD}\u{FFFD}abc"));
        assert!(!has_encoding_issue("正常的正文内容"));
        assert_eq!(replacement_ratio(""), 0.0);
    }

    #[test]
    fn truncation_stays_on_char_boundary() {
        let text = "中".repeat(MAX_CONTENT_BYTES);
        let result = truncate_blocks(vec![paragraph(&text)]);
        assert!(result.truncated);
        let kept = result.blocks.first().expect("one block is kept");
        assert!(kept.text.len() <= MAX_CONTENT_BYTES);
        assert!(kept.text.is_char_boundary(kept.text.len()));
        assert!(!kept.text.contains('\u{FFFD}'));
    }

    #[test]
    fn block_count_limit_is_enforced() {
        let blocks = (0..MAX_BLOCKS + 10)
            .map(|index| paragraph(&format!("block {index}")))
            .collect();
        let result = truncate_blocks(blocks);
        assert_eq!(result.blocks.len(), MAX_BLOCKS);
        assert!(result.truncated);
    }

    #[test]
    fn text_length_counts_scalar_values() {
        assert_eq!(text_length(&[paragraph("a中😀")]), 3);
        assert_eq!(text_bytes(&[paragraph("a中😀")]), 1 + 3 + 4);
    }
}
