//! 调度判据：补抓阈值、手动防抖、失败退避。
//!
//! 全部是纯函数，时间由调用方传入——核内不读系统时钟，所以这些判据可以在
//! native 单测里用任意时间点直测。

/// 自动刷新节拍（秒）：桌面注册同名定时器。
pub const REFRESH_INTERVAL_SECS: u64 = 900;
/// 定时器触发的命令名（须在清单 `contributes.commands` 声明）。
pub const TICK_COMMAND: &str = "news.tick";
/// 距上次成功超过这个时长就在激活 / 回前台时补抓。
pub const STALE_AFTER_MS: i64 = 15 * 60 * 1000;
/// 手动刷新的每源防抖窗口。
pub const MANUAL_DEBOUNCE_MS: i64 = 60 * 1000;
/// 退避推进：5 → 15 → 60 分钟，之后维持 60 分钟。
pub const BACKOFF_MINUTES: [i64; 3] = [5, 15, 60];

const MINUTE_MS: i64 = 60 * 1000;

/// 第 `fail_count` 次失败后的退避时长（毫秒）。
///
/// `fail_count = 0` 时不退避（返回 0）。
pub fn backoff_ms(fail_count: u32) -> i64 {
    if fail_count == 0 {
        return 0;
    }
    let idx = (fail_count as usize - 1).min(BACKOFF_MINUTES.len() - 1);
    BACKOFF_MINUTES[idx] * MINUTE_MS
}

/// 失败后的下次重试时刻。
pub fn next_retry_at(fail_count: u32, now_ms: i64) -> Option<i64> {
    if fail_count == 0 {
        None
    } else {
        Some(now_ms + backoff_ms(fail_count))
    }
}

/// 是否仍在退避窗口内（窗口内不发请求）。
pub fn in_backoff(next_retry_at: Option<i64>, now_ms: i64) -> bool {
    matches!(next_retry_at, Some(at) if now_ms < at)
}

/// 自动节拍（含激活补抓）该不该抓这个源。
///
/// 退避中的源只在 `next_retry_at` 到期时重试，**不再叠加** 15 分钟节拍——
/// 否则 5 / 15 分钟两档退避都会被节拍吞掉。
pub fn auto_due(
    last_ok_at: Option<i64>,
    next_retry_at: Option<i64>,
    now_ms: i64,
) -> bool {
    if in_backoff(next_retry_at, now_ms) {
        return false;
    }
    match last_ok_at {
        None => true,
        Some(last) => now_ms - last >= STALE_AFTER_MS,
    }
}

/// 激活 / 回到前台时是否该补抓（只看「距今上次成功是否超过 15 分钟」）。
pub fn stale_due(last_ok_at: Option<i64>, now_ms: i64) -> bool {
    match last_ok_at {
        None => true,
        Some(last) => now_ms - last >= STALE_AFTER_MS,
    }
}

/// 手动刷新是否被 60 秒防抖拦截（按每源上次抓取时刻算）。
pub fn manual_debounced(last_fetch_at: Option<i64>, now_ms: i64) -> bool {
    match last_fetch_at {
        None => false,
        Some(last) => now_ms - last < MANUAL_DEBOUNCE_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_steps_are_five_fifteen_sixty() {
        assert_eq!(backoff_ms(1), 5 * MINUTE_MS);
        assert_eq!(backoff_ms(2), 15 * MINUTE_MS);
        assert_eq!(backoff_ms(3), 60 * MINUTE_MS);
        assert_eq!(backoff_ms(9), 60 * MINUTE_MS, "封顶 60 分钟");
        assert_eq!(backoff_ms(0), 0);
    }

    #[test]
    fn backoff_window_blocks_auto_and_expires() {
        let now = 1_000_000;
        let retry = next_retry_at(1, now).unwrap();
        assert!(in_backoff(Some(retry), now + 1));
        assert!(!in_backoff(Some(retry), retry), "到点即放行");
        assert!(!in_backoff(None, now));
    }

    #[test]
    fn auto_due_follows_backoff_before_interval() {
        let now = 10 * 60 * MINUTE_MS;
        // 退避中：即使距上次成功很久也不抓
        assert!(!auto_due(Some(now - 20 * MINUTE_MS), Some(now + MINUTE_MS), now));
        // 退避到期：立即重试（不等 15 分钟节拍）
        assert!(auto_due(
            Some(now - 20 * MINUTE_MS),
            Some(now - MINUTE_MS),
            now
        ));
        // 未退避且未到 15 分钟：不抓
        assert!(!auto_due(Some(now - 5 * MINUTE_MS), None, now));
        // 未退避且超过 15 分钟：抓
        assert!(auto_due(Some(now - 16 * MINUTE_MS), None, now));
        // 从没成功过：抓
        assert!(auto_due(None, None, now));
    }

    #[test]
    fn stale_due_is_the_bootstrap_threshold() {
        let now = 1_000_000_000;
        assert!(stale_due(None, now));
        assert!(!stale_due(Some(now - 14 * MINUTE_MS), now));
        assert!(stale_due(Some(now - 15 * MINUTE_MS), now));
    }

    #[test]
    fn manual_debounce_blocks_within_sixty_seconds() {
        let now = 1_000_000_000;
        assert!(!manual_debounced(None, now));
        assert!(manual_debounced(Some(now - 59_000), now));
        assert!(!manual_debounced(Some(now - 60_000), now));
    }
}
