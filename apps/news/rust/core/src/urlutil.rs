//! URL 归一化、标题指纹与条目 id。
//!
//! 三条判据都是纯函数，行为在测试里逐条钉死：跨源合并只看归一化后的地址，
//! 同源去重才看标题指纹——两者混用会造成误合并或静默丢条目。

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

const TRACKING_PREFIXES: [&str; 1] = ["utm_"];
const TRACKING_KEYS: [&str; 3] = ["fbclid", "gclid", "mc_eid"];

/// 把可能是相对写的链接补成绝对地址。
///
/// 只做不做跳转、不解析短链：`//host/path` 补 scheme，`/path` 补 origin，
/// 其余没有 scheme 的返回 `None`（宁可丢弃也不猜）。
pub fn resolve_url(base: &str, link: &str) -> Option<String> {
    let link = link.trim();
    if link.is_empty() {
        return None;
    }
    if let Some(rest) = link.strip_prefix("//") {
        let scheme = base.split("://").next().unwrap_or("https");
        return Some(format!("{scheme}://{rest}"));
    }
    if let Some(scheme_end) = link.find("://") {
        // 已带 scheme
        return Some(link[..scheme_end].to_ascii_lowercase() + &link[scheme_end..]);
    }
    if link.starts_with('/') {
        let (scheme, rest) = base.split_once("://")?;
        let authority = rest.split(['/', '?', '#']).next()?;
        if authority.is_empty() {
            return None;
        }
        return Some(format!("{}://{}{}", scheme.to_ascii_lowercase(), authority, link));
    }
    None
}

/// 归一化：确定性规则，只剔除明确追踪参数。
///
/// - scheme / host 小写；去掉默认端口（http 80 / https 443）；去掉 fragment；
/// - 只剔除 `utm_*` / `fbclid` / `gclid` / `mc_eid`，其余 query 保留原顺序
///   （排序或合并同义键会把不同请求路径压成一条，属误合并）；
/// - 非根路径去掉末尾 `/`；**不去** `www.`（会合并不同站点）；
/// - 只接受 http / https（其它 scheme 不是可抓取的原文地址）。
pub fn normalize_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let (scheme, rest) = raw.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    // fragment 与地址无关
    let rest = rest.split('#').next().unwrap_or(rest);
    let (authority, path_query) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    if authority.is_empty() {
        return None;
    }
    let (path, query) = match path_query.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (path_query, None),
    };

    let authority = normalize_authority(&scheme, authority)?;
    let path = normalize_path(path);
    let query = query.and_then(|q| normalize_query(q));

    let mut out = String::with_capacity(raw.len());
    out.push_str(&scheme);
    out.push_str("://");
    out.push_str(&authority);
    out.push_str(&path);
    if let Some(query) = query {
        out.push('?');
        out.push_str(&query);
    }
    Some(out)
}

/// authority 归一化：host 小写、去默认端口；userinfo 原样保留（含凭据的地址不
/// 参与指纹计算是调用方的责任）。
fn normalize_authority(scheme: &str, authority: &str) -> Option<String> {
    let (userinfo, hostport) = match authority.rsplit_once('@') {
        Some((userinfo, hostport)) => (Some(userinfo), hostport),
        None => (None, authority),
    };
    // IPv6 字面量：[::1]:8080
    let (host, port) = if let Some(rest) = hostport.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        let port = tail.strip_prefix(':').filter(|p| !p.is_empty());
        (format!("[{host}]"), port)
    } else {
        match hostport.rsplit_once(':') {
            Some((host, port)) if !port.is_empty() => (host.to_string(), Some(port)),
            _ => (hostport.to_string(), None),
        }
    };
    if host.is_empty() {
        return None;
    }
    let host = host.to_ascii_lowercase();
    let default_port = match scheme {
        "http" => "80",
        "https" => "443",
        _ => "",
    };
    let port = match port {
        Some(p) if p == default_port => None,
        other => other,
    };
    let mut out = String::new();
    if let Some(userinfo) = userinfo {
        out.push_str(userinfo);
        out.push('@');
    }
    out.push_str(&host);
    if let Some(port) = port {
        out.push(':');
        out.push_str(port);
    }
    Some(out)
}

/// 路径归一化：空 = 根；非根去掉末尾斜杠（保留唯一的 `/` 根路径）。
fn normalize_path(path: &str) -> String {
    if path.is_empty() {
        return "/".to_string();
    }
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

/// query 归一化：按出现顺序保留非追踪参数（key 的**大小写原样**保留）。
fn normalize_query(query: &str) -> Option<String> {
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter(|pair| {
            let key = pair.split('=').next().unwrap_or(pair);
            let lower = key.to_ascii_lowercase();
            !TRACKING_KEYS.contains(&lower.as_str())
                && !TRACKING_PREFIXES.iter().any(|p| lower.starts_with(p))
        })
        .collect();
    if kept.is_empty() {
        None
    } else {
        Some(kept.join("&"))
    }
}

/// 标题指纹：只用于**同源内**比较。
///
/// 归一化步骤：NFKC → 小写 → 只保留字母数字（含中日韩字符）→ 截前 120 字符 →
/// SHA-256 前 16 字节（hex）。空白与标点一律剔除，因此「A 说：B」与
/// 「a 说 B」同指纹；NFKC 让全角字母、兼容字符等写法归一到同一形态。
pub fn title_fingerprint(title: &str) -> String {
    let folded: String = title.nfkc().collect();
    let normalized: String = folded
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(120)
        .collect();
    let digest = Sha256::digest(normalized.as_bytes());
    hex16(&digest[..16])
}

/// 条目 id：由归一化地址派生，因此跨源合并后仍是同一个 id（重启不漂移）。
pub fn item_id(canonical_url: &str) -> String {
    let digest = Sha256::digest(canonical_url.as_bytes());
    hex16(&digest[..16])
}

fn hex16(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// 摘要清洗：去标签、压缩空白、截断到 500 字符。
pub fn clean_summary(raw: &str) -> Option<String> {
    let text = strip_tags(raw);
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.trim();
    if collapsed.is_empty() {
        return None;
    }
    Some(truncate_chars(collapsed, 500))
}

/// 去掉 HTML 标签与常见实体，只留纯文本（详情页只渲染纯文本）。
pub fn strip_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if in_tag => {}
            _ => out.push(ch),
        }
    }
    decode_entities(&out)
}

/// 常见实体解码（订阅流里就这几种；未知实体原样保留）。
pub fn decode_entities(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(idx) = rest.find('&') {
        out.push_str(&rest[..idx]);
        let tail = &rest[idx..];
        let Some(semi) = tail.find(';') else {
            out.push_str(tail);
            return out;
        };
        let entity = &tail[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|dec| dec.parse::<u32>().ok())
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// 按字符（不是字节）截断，避免切坏多字节字符。
pub fn truncate_chars(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    raw.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_lowercases_scheme_and_host() {
        assert_eq!(
            normalize_url("HTTPS://Example.COM/Path").as_deref(),
            Some("https://example.com/Path")
        );
    }

    #[test]
    fn normalize_drops_default_port_and_fragment() {
        assert_eq!(
            normalize_url("https://example.com:443/a#section").as_deref(),
            Some("https://example.com/a")
        );
        assert_eq!(
            normalize_url("http://example.com:80/a").as_deref(),
            Some("http://example.com/a")
        );
        assert_eq!(
            normalize_url("https://example.com:8443/a").as_deref(),
            Some("https://example.com:8443/a")
        );
    }

    #[test]
    fn normalize_trims_trailing_slash_but_keeps_root() {
        assert_eq!(
            normalize_url("https://example.com/a/b/").as_deref(),
            Some("https://example.com/a/b")
        );
        assert_eq!(
            normalize_url("https://example.com/").as_deref(),
            Some("https://example.com/")
        );
        assert_eq!(
            normalize_url("https://example.com").as_deref(),
            Some("https://example.com/")
        );
    }

    #[test]
    fn normalize_strips_only_known_tracking_params() {
        assert_eq!(
            normalize_url("https://e.com/a?utm_source=x&id=7&fbclid=y&gclid=z&mc_eid=w").as_deref(),
            Some("https://e.com/a?id=7")
        );
        // 其余 query 原顺序保留，不排序、不合并同义键
        assert_eq!(
            normalize_url("https://e.com/a?b=2&a=1&a=3").as_deref(),
            Some("https://e.com/a?b=2&a=1&a=3")
        );
        // 全是追踪参数时不留裸 '?'
        assert_eq!(
            normalize_url("https://e.com/a?utm_medium=x").as_deref(),
            Some("https://e.com/a")
        );
    }

    #[test]
    fn normalize_keeps_www_and_rejects_non_http() {
        assert_eq!(
            normalize_url("https://www.example.com/a").as_deref(),
            Some("https://www.example.com/a")
        );
        assert_eq!(normalize_url("ftp://example.com/a"), None);
        assert_eq!(normalize_url("/relative"), None);
        assert_eq!(normalize_url(""), None);
    }

    #[test]
    fn resolve_url_handles_relative_forms() {
        assert_eq!(
            resolve_url("https://example.com/feed.xml", "/post/1").as_deref(),
            Some("https://example.com/post/1")
        );
        assert_eq!(
            resolve_url("https://example.com/feed.xml", "//cdn.example.com/x").as_deref(),
            Some("https://cdn.example.com/x")
        );
        assert_eq!(resolve_url("https://example.com/feed.xml", "post/1"), None);
    }

    #[test]
    fn fingerprint_ignores_case_whitespace_and_punctuation() {
        assert_eq!(
            title_fingerprint("Hello, World!"),
            title_fingerprint("hello   world")
        );
        assert_ne!(
            title_fingerprint("Hello World"),
            title_fingerprint("Hello Worlds")
        );
    }

    #[test]
    fn fingerprint_folds_compatibility_forms() {
        // NFKC：全角字母 / 数字与半角写法必须同指纹，否则同源转发会重复入库。
        assert_eq!(
            title_fingerprint("ＡＢＣ １２３"),
            title_fingerprint("ABC 123")
        );
        assert_eq!(
            title_fingerprint("㍿ Ｎｅｗｓ"),
            title_fingerprint("株式会社 News")
        );
    }

    #[test]
    fn fingerprint_of_cjk_titles_is_stable() {
        // 中文标题只去标点，不做分词
        assert_eq!(
            title_fingerprint("中国：AI 芯片新进展"),
            title_fingerprint("中国AI芯片新进展")
        );
    }

    #[test]
    fn item_id_is_derived_from_canonical_url() {
        let a = item_id("https://example.com/a");
        assert_eq!(a, item_id("https://example.com/a"));
        assert_eq!(a.len(), 32);
        assert_ne!(a, item_id("https://example.com/b"));
    }

    #[test]
    fn strip_tags_and_entities() {
        assert_eq!(strip_tags("<p>Tom &amp; Jerry</p>"), " Tom & Jerry ");
        assert_eq!(strip_tags("a&#39;b"), "a'b");
        assert_eq!(clean_summary("  <b>hi</b>\n\n  there  ").as_deref(), Some("hi there"));
        assert_eq!(clean_summary("<p></p>"), None);
    }

    #[test]
    fn truncate_keeps_chars_intact() {
        assert_eq!(truncate_chars("中文标题", 2), "中文");
        assert_eq!(truncate_chars("ab", 5), "ab");
    }
}
