//! 去重判据。
//!
//! 两级，**不要混用**：
//!
//! 1. 跨源：归一化地址相同 → 同一条信息条，追加一条来源归属。条目 id 由归一化
//!    地址派生（[`crate::urlutil::item_id`]），因此「id 命中」就是「同地址」；
//! 2. 同源：地址归一化后不同、但标题指纹相同 → 丢弃新条目（保留首次出现）。
//!
//! v1 不做跨源事件聚类：不同 URL 指向同一事件时保持两条。误合并会静默丢条目，
//! 而重复只是观感问题。

use std::collections::BTreeSet;

/// 同源历史条目（只有指纹参与判断）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingItem {
    pub item_id: String,
    pub title_fingerprint: String,
}

/// 去重决策。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// 新建信息条。
    New,
    /// 已有同地址条目：追加来源归属。
    Merge(String),
    /// 同源已有同指纹条目：丢弃（保留首次出现）。
    SkipDuplicate(String),
}

/// 判定一条候选条目。
///
/// - `item_id` 由归一化地址派生，命中 `existing_ids` 即「同地址」；
/// - `same_source` 只包含**同一源**的历史条目，因此跨源的同标题新闻不会被误吞。
pub fn decide(
    item_id: &str,
    fingerprint: &str,
    existing_ids: &BTreeSet<String>,
    same_source: &[ExistingItem],
) -> Decision {
    if existing_ids.contains(item_id) {
        return Decision::Merge(item_id.to_string());
    }
    if let Some(hit) = same_source
        .iter()
        .find(|e| !e.title_fingerprint.is_empty() && e.title_fingerprint == fingerprint)
    {
        return Decision::SkipDuplicate(hit.item_id.clone());
    }
    Decision::New
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing(id: &str, fp: &str) -> ExistingItem {
        ExistingItem {
            item_id: id.to_string(),
            title_fingerprint: fp.to_string(),
        }
    }

    fn ids(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn same_url_merges_across_sources() {
        let known = ids(&["i1"]);
        assert_eq!(
            decide("i1", "fp-b", &known, &[]),
            Decision::Merge("i1".into())
        );
    }

    #[test]
    fn same_fingerprint_within_source_is_skipped() {
        let source_items = vec![existing("i1", "fp-a")];
        assert_eq!(
            decide("i2", "fp-a", &ids(&[]), &source_items),
            Decision::SkipDuplicate("i1".into())
        );
    }

    #[test]
    fn same_fingerprint_from_another_source_is_not_skipped() {
        // 另一个源的历史条目不在 same_source 范围内 → 新建（不同 URL 的事件保持两条）
        assert_eq!(decide("i2", "fp-a", &ids(&[]), &[]), Decision::New);
    }

    #[test]
    fn different_url_and_fingerprint_creates_new() {
        let known = ids(&["i1"]);
        let source_items = vec![existing("i1", "fp-a")];
        assert_eq!(decide("i2", "fp-b", &known, &source_items), Decision::New);
    }

    #[test]
    fn empty_fingerprint_never_matches() {
        let source_items = vec![existing("i1", "")];
        assert_eq!(decide("i2", "", &ids(&[]), &source_items), Decision::New);
    }
}
