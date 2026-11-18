//! 时间解析：把订阅流里常见的两种时间串换算成 Unix 毫秒。
//!
//! 只做两件事，不引入日期库：
//!
//! - RFC 3339 / ISO 8601（Atom、JSON 接口）：`2026-11-10T13:00:00Z`、
//!   `2026-11-10T13:00:00+08:00`、带小数秒；
//! - RFC 822 / 1123（RSS 2.0）：`Tue, 10 Nov 2026 13:00:00 GMT`。
//!
//! 解析失败一律返回 `None`，由调用方决定「无发布时间」的语义（入库时以抓到时刻
//! 填充），不做「猜一个当前时间」的兜底。

/// 公历日期 → 距 1970-01-01 的天数（Howard Hinnant 的 civil_from_days 逆运算）。
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (month as i64 + 9) % 12; // 3 月为 0
    let doy = (153 * mp + 2) / 5 + day as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// 年月日时分秒（+ 时区偏移分钟）→ Unix 毫秒。
fn to_unix_ms(
    year: i64,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    offset_minutes: i32,
) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let secs = days * 86_400
        + hour as i64 * 3_600
        + minute as i64 * 60
        + second as i64
        - offset_minutes as i64 * 60;
    Some(secs * 1_000)
}

fn parse_u32(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

fn parse_i64(s: &str) -> Option<i64> {
    let (neg, digits) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let value: i64 = digits.parse().ok()?;
    Some(if neg { -value } else { value })
}

/// 时区后缀（`Z` / `+08:00` / `+0800` / `GMT` / `UTC` / `EST` 等）→ 分钟偏移。
///
/// 只认数字偏移与几个明确的零偏移名；三名缩写（EST / PST）语义含夏令时，
/// 不做猜测——返回 `None`，让日期整体解析失败。
fn parse_offset(raw: &str) -> Option<i32> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    match s {
        "Z" | "z" | "GMT" | "UTC" | "UT" => return Some(0),
        _ => {}
    }
    let sign = match s.as_bytes()[0] {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let body = &s[1..];
    let digits: String = body.chars().filter(|c| *c != ':').collect();
    if digits.len() != 4 {
        return None;
    }
    let hours = parse_u32(&digits[..2])? as i32;
    let minutes = parse_u32(&digits[2..])? as i32;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(sign * (hours * 60 + minutes))
}

/// RFC 3339 / ISO 8601 → Unix 毫秒。
pub fn parse_rfc3339(raw: &str) -> Option<i64> {
    let s = raw.trim();
    // 日期与时间之间允许 'T' / 't' / 空格
    let sep = s.find(['T', 't', ' '])?;
    let (date, rest) = s.split_at(sep);
    let rest = &rest[1..];

    let mut dparts = date.split('-');
    let year = parse_i64(dparts.next()?)?;
    let month = parse_u32(dparts.next()?)?;
    let day = parse_u32(dparts.next()?)?;
    if dparts.next().is_some() {
        return None;
    }

    // 时间部分：HH:MM[:SS[.frac]] + 时区
    let tz_start = rest
        .find(['Z', 'z', '+', '-'])
        .unwrap_or(rest.len());
    let (time, tz) = rest.split_at(tz_start);
    let time = time.trim_end_matches('.');
    let mut tparts = time.split(':');
    let hour = parse_u32(tparts.next()?)?;
    let minute = parse_u32(tparts.next()?)?;
    let second = match tparts.next() {
        Some(sec) => {
            // 小数秒直接丢弃（毫秒级精度对新闻排序没有意义）
            let sec = sec.split('.').next().unwrap_or(sec);
            parse_u32(sec)?
        }
        None => 0,
    };
    if tparts.next().is_some() {
        return None;
    }
    let offset = if tz.is_empty() {
        // 没有时区：按 UTC 处理（订阅流里罕见，猜本地时区更糟）
        0
    } else {
        parse_offset(tz)?
    };
    to_unix_ms(year, month, day, hour, minute, second, offset)
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn month_from_name(name: &str) -> Option<u32> {
    let lower = name.trim().to_ascii_lowercase();
    MONTHS
        .iter()
        .position(|m| *m == lower)
        .map(|i| i as u32 + 1)
}

/// RFC 822 / 1123 → Unix 毫秒（RSS 2.0 的 `pubDate`）。
///
/// 兼容：可选的星期前缀、`GMT` / `UT` / `Z` / `±HHMM` / `±HH:MM` 时区、
/// 秒可缺省。
pub fn parse_rfc822(raw: &str) -> Option<i64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // 去掉星期前缀（`Tue,` / `Tuesday,`）
    let s = match s.find(',') {
        Some(idx) if idx <= 10 => s[idx + 1..].trim(),
        _ => s,
    };
    let mut parts = s.split_whitespace();
    let day = parse_u32(parts.next()?)?;
    let month = month_from_name(parts.next()?)?;
    let year_raw = parts.next()?;
    let year = if year_raw.len() == 2 {
        // RFC 822 两位年份：50–99 → 19xx，00–49 → 20xx
        let two = parse_i64(year_raw)?;
        if two >= 50 {
            1900 + two
        } else {
            2000 + two
        }
    } else {
        parse_i64(year_raw)?
    };
    let time = parts.next()?;
    let mut tparts = time.split(':');
    let hour = parse_u32(tparts.next()?)?;
    let minute = parse_u32(tparts.next()?)?;
    let second = match tparts.next() {
        Some(sec) => parse_u32(sec)?,
        None => 0,
    };
    let offset = match parts.next() {
        Some(tz) => parse_offset(tz)?,
        // 无时区后缀：RFC 822 缺省即本地时间，语义不可知；按 UTC 处理并在
        // 文档里点明（源不写时区时差几小时，不影响 24 小时窗口的可用性）
        None => 0,
    };
    to_unix_ms(year, month, day, hour, minute, second, offset)
}

/// 两种格式都试一遍（订阅流里常见混用）。
pub fn parse_any(raw: &str) -> Option<i64> {
    parse_rfc3339(raw).or_else(|| parse_rfc822(raw))
}

/// X / Twitter 旧式时间串：`Wed Nov 18 12:00:00 +0000 2026`
/// （月在前、年在后，与 RFC 822 的顺序不同）。
pub fn parse_twitter(raw: &str) -> Option<i64> {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let month = month_from_name(parts[1])?;
    let day = parse_u32(parts[2])?;
    let mut tparts = parts[3].split(':');
    let hour = parse_u32(tparts.next()?)?;
    let minute = parse_u32(tparts.next()?)?;
    let second = match tparts.next() {
        Some(sec) => parse_u32(sec)?,
        None => 0,
    };
    let offset = parse_offset(parts[4])?;
    let year = parse_i64(parts[5])?;
    to_unix_ms(year, month, day, hour, minute, second, offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_utc() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339("2026-11-10T13:00:00Z"),
            Some(1_794_315_600_000)
        );
    }

    #[test]
    fn rfc3339_with_offset_and_fraction() {
        // +08:00 的 21:00 = UTC 13:00
        assert_eq!(
            parse_rfc3339("2026-11-10T21:00:00+08:00"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
        assert_eq!(
            parse_rfc3339("2026-11-10T13:00:00.123Z"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
        assert_eq!(
            parse_rfc3339("2026-11-10 13:00:00Z"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
    }

    #[test]
    fn rfc822_gmt() {
        assert_eq!(
            parse_rfc822("Tue, 10 Nov 2026 13:00:00 GMT"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
        // 无秒
        assert_eq!(
            parse_rfc822("10 Nov 2026 13:00 GMT"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
        // 数字偏移
        assert_eq!(
            parse_rfc822("Tue, 10 Nov 2026 21:00:00 +0800"),
            parse_rfc3339("2026-11-10T13:00:00Z")
        );
    }

    #[test]
    fn rejects_unparseable_instead_of_guessing() {
        assert_eq!(parse_any(""), None);
        assert_eq!(parse_any("yesterday"), None);
        // 三名时区缩写含夏令时语义，不做猜测
        assert_eq!(parse_any("Tue, 10 Nov 2026 13:00:00 EST"), None);
        assert_eq!(parse_any("2026-13-10T13:00:00Z"), None);
    }

    #[test]
    fn leap_day_round_trips() {
        // 2024-02-29 合法；2026 无 2/29
        assert!(parse_rfc3339("2024-02-29T00:00:00Z").is_some());
        let day = parse_rfc3339("2024-03-01T00:00:00Z").unwrap()
            - parse_rfc3339("2024-02-29T00:00:00Z").unwrap();
        assert_eq!(day, 86_400_000);
    }
}
