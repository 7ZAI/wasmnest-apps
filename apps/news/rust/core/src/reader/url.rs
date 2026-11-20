//! 正文地址白名单与日志脱敏。
//!
//! 只接受 http / https；日志只保留 origin + path，查询串、fragment 与 userinfo 一律丢弃。

/// 地址是否可作为正文抓取目标。
pub fn content_url_allowed(url: &str) -> bool {
    let Some((scheme, rest)) = url.trim().split_once("://") else {
        return false;
    };
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    true
}

/// 日志用地址：origin + path；不含 query、fragment 与 userinfo。
pub fn redact_for_log(url: &str) -> String {
    let trimmed = url.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return "<redacted>".into();
    };
    let scheme = scheme.to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https") {
        return "<redacted>".into();
    }
    let rest = rest.split('#').next().unwrap_or(rest);
    let authority_end = rest.find(|ch| ch == '/' || ch == '?').unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let authority = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    if authority.is_empty() {
        return "<redacted>".into();
    }
    let raw_path = &rest[authority_end..];
    let raw_path = if raw_path.starts_with('/') {
        raw_path
    } else {
        ""
    };
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let path = if path.is_empty() { "/" } else { path };
    format!("{scheme}://{authority}{path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_are_allowed() {
        for allowed in [
            "http://example.com/a",
            "https://example.com/a",
            "https://example.com:8443/a",
            "http://[::1]:8080/a",
        ] {
            assert!(content_url_allowed(allowed), "应允许 {allowed}");
        }
        for rejected in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<p>x</p>",
            "mailto:user@example.com",
            "custom-scheme://example.com",
            "https://user:pass@example.com/a",
            "https:///missing-host",
        ] {
            assert!(!content_url_allowed(rejected), "应拒绝 {rejected}");
        }
    }

    #[test]
    fn redaction_drops_query_fragment_and_userinfo() {
        assert_eq!(
            redact_for_log("https://user:pass@example.com:8443/a/b?token=secret&x=1#frag"),
            "https://example.com:8443/a/b"
        );
        assert_eq!(
            redact_for_log("http://[::1]:8080/news?id=1"),
            "http://[::1]:8080/news"
        );
        assert_eq!(
            redact_for_log("https://example.com"),
            "https://example.com/"
        );
        assert_eq!(
            redact_for_log("https://example.com?token=secret"),
            "https://example.com/"
        );
        assert_eq!(redact_for_log("javascript:alert(1)"), "<redacted>");
        assert_eq!(redact_for_log("not a url"), "<redacted>");
    }
}
