//! 窗口过滤与排序判据（纯函数，单测主场）。
//!
//! - 今日：`seen_at` 落在 24 小时内；
//! - 实时：`seen_at` 落在 6 小时内；
//! - 圈子：按圈子过滤，窗口同今日；
//! - 收藏：不做时间过滤，只看 `favorite`。
//!
//! 排序先用来源数（跨源报道的条目优先），再用首次抓到时间倒序。来源权重参与
//! 排序要等源与圈子的权重数据落地后接入，这里不假装已经实现。

use crate::domain::{FeedQuery, FeedView, Item};

const HOUR_MS: i64 = 60 * 60 * 1000;

/// 今日视图滚动窗口（小时）。
pub const TODAY_WINDOW_HOURS: i64 = 24;
/// 实时视图滚动窗口（小时）。
pub const REALTIME_WINDOW_HOURS: i64 = 6;

/// 视图对应的窗口小时数；收藏不过期，返回 0。
pub fn window_hours(view: FeedView) -> i64 {
    match view {
        FeedView::Today | FeedView::Circles => TODAY_WINDOW_HOURS,
        FeedView::Realtime => REALTIME_WINDOW_HOURS,
        FeedView::Saved => 0,
    }
}

fn in_window(item: &Item, now_ms: i64, hours: i64) -> bool {
    // 未来时间戳（宿主与源站时钟偏差）按 age ≤ 0 处理：留在窗口内，不静默丢条目
    let age = now_ms.saturating_sub(item.seen_at);
    age < hours.saturating_mul(HOUR_MS)
}

/// 按查询条件过滤并排序，返回新列表（不修改入参）。
pub fn select_items(items: &[Item], query: &FeedQuery, now_ms: i64) -> Vec<Item> {
    let hours = window_hours(query.view);
    let mut picked: Vec<Item> = items
        .iter()
        .filter(|item| match query.view {
            FeedView::Saved => item.favorite,
            FeedView::Circles => {
                query
                    .circle_id
                    .as_deref()
                    .is_none_or(|id| item.circle_id == id)
                    && in_window(item, now_ms, hours)
            }
            FeedView::Today | FeedView::Realtime => in_window(item, now_ms, hours),
        })
        .cloned()
        .collect();

    picked.sort_by(|a, b| {
        b.origin_count
            .cmp(&a.origin_count)
            .then_with(|| b.seen_at.cmp(&a.seen_at))
    });
    picked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, seen_min_ago: i64, circle: &str, origin: u32) -> Item {
        Item {
            id: id.into(),
            title: id.into(),
            summary: String::new(),
            url: format!("https://example.com/{id}"),
            source_id: "s".into(),
            source_name: "Source".into(),
            circle_id: circle.into(),
            circle_name: circle.into(),
            published_at: 1_000,
            seen_at: 60 * 60 * 1000 - seen_min_ago * 60 * 1000,
            read: false,
            favorite: false,
            origin_count: origin,
        }
    }

    fn query(view: FeedView, circle: Option<&str>) -> FeedQuery {
        FeedQuery {
            view,
            circle_id: circle.map(str::to_string),
        }
    }

    #[test]
    fn today_keeps_only_last_24_hours() {
        let items = vec![item("fresh", 60, "ai", 1), item("stale", 25 * 60, "ai", 1)];
        let picked = select_items(&items, &query(FeedView::Today, None), 60 * 60 * 1000);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].id, "fresh");
    }

    #[test]
    fn realtime_keeps_only_last_6_hours() {
        let items = vec![item("now", 30, "ai", 1), item("old", 7 * 60, "ai", 1)];
        let picked = select_items(&items, &query(FeedView::Realtime, None), 60 * 60 * 1000);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].id, "now");
    }

    #[test]
    fn saved_keeps_favorites_regardless_of_age() {
        let mut old = item("saved-old", 90 * 24 * 60, "ai", 1);
        old.favorite = true;
        let items = vec![old, item("recent", 10, "ai", 1)];
        let picked = select_items(&items, &query(FeedView::Saved, None), 60 * 60 * 1000);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].id, "saved-old");
    }

    #[test]
    fn circles_filter_by_circle_id() {
        let items = vec![item("a", 30, "ai", 1), item("b", 30, "dev", 1)];
        let picked = select_items(
            &items,
            &query(FeedView::Circles, Some("dev")),
            60 * 60 * 1000,
        );
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].id, "b");
    }

    #[test]
    fn cross_source_items_rank_before_single_source_at_same_age() {
        let items = vec![item("single", 30, "ai", 1), item("merged", 30, "ai", 3)];
        let picked = select_items(&items, &query(FeedView::Today, None), 60 * 60 * 1000);
        assert_eq!(picked[0].id, "merged");
    }

    #[test]
    fn future_timestamps_are_not_dropped() {
        let mut future = item("future", 0, "ai", 1);
        future.seen_at = 61 * 60 * 1000;
        let picked = select_items(&[future], &query(FeedView::Today, None), 60 * 60 * 1000);
        assert_eq!(picked.len(), 1);
    }
}
