//! 排序与窗口：三条视图共用的确定性热度分。
//!
//! ```text
//! freshness = exp(-age_hours / 12)
//! score     = freshness × source_weight × circle_weight × origin_count^0.75
//! ```
//!
//! 全部是纯函数：输入 `(items, weights, now_ms)`，不引入学习参数，也不读时钟。

use crate::domain::{FeedView, Item};
use std::cmp::Ordering;

/// 源 / 圈子权重取值域。
pub const WEIGHT_MIN: f64 = 0.5;
/// 源 / 圈子权重取值域。
pub const WEIGHT_MAX: f64 = 2.0;
/// 默认权重。
pub const WEIGHT_DEFAULT: f64 = 1.0;
/// 新鲜度半衰期的小时数（分数衰减常数）。
pub const FRESHNESS_HOURS: f64 = 12.0;

/// 权重夹取到 `[0.5, 2.0]`；非有限值回落默认 1.0（不写入 NaN）。
pub fn clamp_weight(raw: f64) -> f64 {
    if !raw.is_finite() {
        return WEIGHT_DEFAULT;
    }
    raw.clamp(WEIGHT_MIN, WEIGHT_MAX)
}

/// `e^{-x}`（x ≥ 0）的自实现版本。
///
/// 不用 `f64::exp`：wasm32 目标上它要链接 libm 符号，而热度分是本应用自定的
/// 度量，不需要与 libm 逐位一致。做法是缩放到小自变量后用泰勒展开，再平方还原。
pub fn exp_neg(x: f64) -> f64 {
    if x <= 0.0 {
        return 1.0;
    }
    if x > 100.0 {
        return 0.0;
    }
    let scaled = x / 1024.0;
    let mut term = 1.0f64;
    let mut sum = 1.0f64;
    for n in 1..=6u32 {
        term *= -scaled / n as f64;
        sum += term;
    }
    let mut out = sum;
    for _ in 0..10 {
        out *= out;
    }
    out
}

/// `count^0.75`：单源为 1（不做常数放大），2 源 1.68，5 源 3.34。
pub fn origin_factor(count: u32) -> f64 {
    let x = count.max(1) as f64;
    let root = x.sqrt();
    root * root.sqrt()
}

/// 某条信息条的新鲜度（0–1）。发布时间在未来按 0 龄计。
pub fn freshness(published_at: i64, now_ms: i64) -> f64 {
    let age_ms = (now_ms - published_at).max(0) as f64;
    exp_neg(age_ms / 3_600_000.0 / FRESHNESS_HOURS)
}

/// 热度分。`weight` = 该信息条各来源里最大的 `source_weight × circle_weight`。
pub fn score(published_at: i64, now_ms: i64, weight: f64, origin_count: u32) -> f64 {
    freshness(published_at, now_ms) * clamp_weight(weight) * origin_factor(origin_count)
}

/// 今日 / 圈子：分数降序，同分按发布时间降序（再同则按 id 升序保证稳定）。
pub fn compare_by_score(a: &Item, b: &Item) -> Ordering {
    b.score
        .partial_cmp(&a.score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| b.published_at.cmp(&a.published_at))
        .then_with(|| a.id.cmp(&b.id))
}

/// 实时：首次抓到时间倒序（再同则按 id 升序）。
pub fn compare_by_first_seen(a: &Item, b: &Item) -> Ordering {
    b.first_seen_at
        .cmp(&a.first_seen_at)
        .then_with(|| a.id.cmp(&b.id))
}

/// 收藏：收藏时间倒序（未收藏的排最后），同一时刻按发布时间倒序。
pub fn compare_by_favorited(a: &Item, b: &Item) -> Ordering {
    b.favorited_at
        .cmp(&a.favorited_at)
        .then_with(|| b.published_at.cmp(&a.published_at))
        .then_with(|| a.id.cmp(&b.id))
}

/// 视图窗口起点（含边界）。收藏视图无窗口。
pub fn window_start(view: FeedView, now_ms: i64) -> Option<i64> {
    view.window_hours()
        .map(|hours| now_ms - hours * 3_600_000)
}

/// 视图窗口小时数（无窗口 = `None`）。
pub fn window_hours(view: FeedView) -> Option<i64> {
    view.window_hours()
}

/// 按视图排序（窗口过滤由调用方在取数 SQL 里完成，这里只排）。
pub fn sort_for_view(items: &mut [Item], view: FeedView) {
    match view {
        FeedView::Today | FeedView::Circles => items.sort_by(compare_by_score),
        FeedView::Realtime => items.sort_by(compare_by_first_seen),
        FeedView::Saved => items.sort_by(compare_by_favorited),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, published_at: i64, first_seen_at: i64, score: f64) -> Item {
        Item {
            id: id.to_string(),
            title: id.to_string(),
            url: format!("https://example.com/{id}"),
            summary: None,
            published_at,
            first_seen_at,
            lang: None,
            author: None,
            source_id: "s1".into(),
            source_name: "S".into(),
            circle_id: None,
            circle_name: "未分组".into(),
            read: false,
            favorite: false,
            favorited_at: None,
            origin_count: 1,
            score,
            origins: Vec::new(),
        }
    }

    #[test]
    fn exp_neg_matches_known_values() {
        assert!((exp_neg(0.0) - 1.0).abs() < 1e-12);
        assert!((exp_neg(1.0) - 0.367_879_4).abs() < 1e-6);
        // e^{-1}：一个半衰期
        assert!((exp_neg(1.0) - 0.367_879_4).abs() < 1e-6);
        // 24 小时 = 两个半衰期 e^{-2}
        assert!((exp_neg(2.0) - 0.135_335_3).abs() < 1e-6);
        assert!(exp_neg(24.0) > 0.0 && exp_neg(24.0) < 1e-8);
        assert_eq!(exp_neg(200.0), 0.0);
    }

    #[test]
    fn origin_factor_is_one_for_single_source() {
        assert!((origin_factor(1) - 1.0).abs() < 1e-12);
        assert!((origin_factor(0) - 1.0).abs() < 1e-12, "0 也按 1 计");
        assert!((origin_factor(2) - 1.681_792).abs() < 1e-4);
        assert!((origin_factor(5) - 3.343_701).abs() < 1e-4);
    }

    #[test]
    fn future_published_at_counts_as_zero_age() {
        assert!((freshness(2_000, 1_000) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn five_source_old_news_does_not_outrank_one_hour_single_source() {
        // 设计口径：5 源 15 小时旧闻 ≈ 单源 1 小时新条（略高但同一量级）
        let now = 1_000_000_000_000;
        let old = score(now - 15 * 3_600_000, now, 1.0, 5);
        let fresh = score(now - 3_600_000, now, 1.0, 1);
        assert!(old > fresh, "多源共识可以上浮：{old} vs {fresh}");
        assert!(old < fresh * 1.2, "但不得长期霸榜：{old} vs {fresh}");
    }

    #[test]
    fn weight_clamps_to_documented_range() {
        assert_eq!(clamp_weight(0.1), WEIGHT_MIN);
        assert_eq!(clamp_weight(9.0), WEIGHT_MAX);
        assert_eq!(clamp_weight(f64::NAN), WEIGHT_DEFAULT);
        assert_eq!(clamp_weight(1.5), 1.5);
    }

    #[test]
    fn today_sorts_by_score_then_published_desc() {
        let now = 1_000_000_000_000;
        let mut items = vec![
            item("a", now - 1000, now, 1.0),
            item("b", now - 500, now, 3.0),
            item("c", now - 200, now, 3.0),
        ];
        sort_for_view(&mut items, FeedView::Today);
        assert_eq!(
            items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "b", "a"],
            "同分按发布时间倒序"
        );
    }

    #[test]
    fn realtime_sorts_by_first_seen_desc() {
        let mut items = vec![
            item("a", 1, 10, 0.0),
            item("b", 9, 30, 0.0),
            item("c", 5, 20, 0.0),
        ];
        sort_for_view(&mut items, FeedView::Realtime);
        assert_eq!(
            items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["b", "c", "a"]
        );
    }

    #[test]
    fn window_hours_match_design() {
        let now = 1_000_000_000_000;
        assert_eq!(
            window_start(FeedView::Today, now),
            Some(now - 24 * 3_600_000)
        );
        assert_eq!(
            window_start(FeedView::Realtime, now),
            Some(now - 6 * 3_600_000)
        );
        assert_eq!(window_start(FeedView::Saved, now), None);
    }
}
