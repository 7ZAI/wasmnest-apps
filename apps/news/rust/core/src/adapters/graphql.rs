//! 授权源（X / Instagram）的网页接口适配器。
//!
//! 这两个接口是**私有面**：结构随时会变。因此这里不做精确路径映射，而是
//! 「递归找一眼能认出的节点」——结构变了通常表现为找不到节点，于是显性报
//! `parse.unexpected_shape`；凭据失效表现为 `auth.expired`，**绝不**降级成
//! 匿名抓取或返回空列表。

use super::{AdapterError, AuthSecret};
use crate::datetime;
use crate::domain::{error_kind, RawItem};
use crate::ports::FetchRequest;
use crate::urlutil::clean_summary;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) \
Chrome/128.0 Safari/537.36";
/// Instagram 网页接口要求的公开 app id（非用户凭据）。
const IG_APP_ID: &str = "936619743392459";

/// X 请求：必须带凭据。
pub fn build_x_request(url: &str, auth: Option<&AuthSecret>) -> Result<FetchRequest, AdapterError> {
    let auth = require_auth(auth, "x")?;
    if url.trim().is_empty() {
        return Err(AdapterError::invalid("x source requires a graphql url"));
    }
    let mut headers = vec![
        ("Accept".to_string(), "application/json".to_string()),
        (
            "User-Agent".to_string(),
            auth.user_agent.clone().unwrap_or_else(|| UA.to_string()),
        ),
        ("x-twitter-active-user".to_string(), "yes".to_string()),
    ];
    if let Some(cookie) = &auth.cookie {
        headers.push(("Cookie".to_string(), cookie.clone()));
    }
    if let Some(bearer) = &auth.bearer {
        headers.push(("Authorization".to_string(), format!("Bearer {bearer}")));
    }
    if let Some(csrf) = &auth.csrf_token {
        headers.push(("x-csrf-token".to_string(), csrf.clone()));
    }
    Ok(FetchRequest {
        method: "GET".to_string(),
        url: url.trim().to_string(),
        headers,
        body: None,
    })
}

/// Instagram 请求：必须带 sessionid cookie。
pub fn build_ig_request(url: &str, auth: Option<&AuthSecret>) -> Result<FetchRequest, AdapterError> {
    let auth = require_auth(auth, "instagram")?;
    if url.trim().is_empty() {
        return Err(AdapterError::invalid("instagram source requires a graphql url"));
    }
    Ok(FetchRequest {
        method: "GET".to_string(),
        url: url.trim().to_string(),
        headers: vec![
            ("Accept".to_string(), "application/json".to_string()),
            (
                "User-Agent".to_string(),
                auth.user_agent.clone().unwrap_or_else(|| UA.to_string()),
            ),
            ("x-ig-app-id".to_string(), IG_APP_ID.to_string()),
            (
                "Cookie".to_string(),
                auth.cookie.clone().unwrap_or_default(),
            ),
        ],
        body: None,
    })
}

fn require_auth<'a>(
    auth: Option<&'a AuthSecret>,
    label: &str,
) -> Result<&'a AuthSecret, AdapterError> {
    match auth {
        Some(secret) if !secret.is_empty() => Ok(secret),
        _ => Err(AdapterError {
            kind: error_kind::AUTH_EXPIRED,
            detail: format!("{label} source has no credentials; add them in settings"),
        }),
    }
}

/// 解析 X 的 GraphQL 响应。
pub fn parse_x(body: &str, base_url: &str, _now_ms: i64) -> Result<Vec<RawItem>, AdapterError> {
    let value = parse_json(body)?;
    reject_if_auth_error(&value)?;
    let mut items = Vec::new();
    let mut nodes = Vec::new();
    collect(&value, &mut nodes);
    for node in nodes {
        let Some(legacy) = node.get("legacy") else {
            continue;
        };
        let Some(text) = legacy.get("full_text").and_then(|v| v.as_str()) else {
            continue;
        };
        let id = node
            .get("rest_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                legacy
                    .get("id_str")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });
        let Some(id) = id else { continue };
        let handle = node
            .pointer("/core/user_results/result/core/screen_name")
            .and_then(|v| v.as_str())
            .or_else(|| {
                node.pointer("/core/user_results/result/legacy/screen_name")
                    .and_then(|v| v.as_str())
            });
        let url = match handle {
            Some(handle) => format!("https://x.com/{handle}/status/{id}"),
            None => format!("https://x.com/i/status/{id}"),
        };
        let published_at = legacy
            .get("created_at")
            .and_then(|v| v.as_str())
            .and_then(datetime::parse_twitter)
            .filter(|ms| *ms > 0);
        items.push(RawItem {
            title: first_line(text),
            url,
            published_at,
            summary: clean_summary(text),
            author: handle.map(|h| h.to_string()),
            lang: legacy
                .get("lang")
                .and_then(|v| v.as_str())
                .map(|l| l.to_string()),
            source_title: Some("X".to_string()),
        });
    }
    if items.is_empty() {
        return Err(AdapterError::unexpected(format!(
            "x response carried no tweet nodes (endpoint {} may have changed)",
            shorten(base_url)
        )));
    }
    Ok(items)
}

/// 解析 Instagram 的 GraphQL 响应。
pub fn parse_ig(body: &str, base_url: &str, _now_ms: i64) -> Result<Vec<RawItem>, AdapterError> {
    let value = parse_json(body)?;
    reject_if_auth_error(&value)?;
    let mut items = Vec::new();
    let mut nodes = Vec::new();
    collect(&value, &mut nodes);
    for node in nodes {
        let Some(code) = node.get("code").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(taken_at) = node.get("taken_at").and_then(|v| v.as_i64()) else {
            continue;
        };
        if taken_at <= 0 {
            continue;
        }
        let caption = node
            .pointer("/caption/text")
            .and_then(|v| v.as_str())
            .or_else(|| node.pointer("/edge_media_to_caption/edges/0/node/text").and_then(|v| v.as_str()));
        let summary = caption.and_then(clean_summary);
        let title = summary.clone().map(|s| first_line(&s)).unwrap_or_else(|| {
            format!(
                "Instagram post {code} · {}",
                short_date(taken_at * 1000)
            )
        });
        let username = node
            .pointer("/user/username")
            .and_then(|v| v.as_str())
            .or_else(|| node.pointer("/owner/username").and_then(|v| v.as_str()));
        items.push(RawItem {
            title,
            url: format!("https://www.instagram.com/p/{code}/"),
            published_at: Some(taken_at * 1000),
            summary,
            author: username.map(|u| u.to_string()),
            lang: None,
            source_title: Some("Instagram".to_string()),
        });
    }
    if items.is_empty() {
        return Err(AdapterError::unexpected(format!(
            "instagram response carried no media nodes (endpoint {} may have changed)",
            shorten(base_url)
        )));
    }
    Ok(items)
}

fn parse_json(body: &str) -> Result<serde_json::Value, AdapterError> {
    let trimmed = body.trim_start();
    if trimmed.is_empty() {
        return Err(AdapterError::no_feed("response body is empty"));
    }
    if trimmed.starts_with('<') {
        return Err(AdapterError::unexpected(
            "endpoint returned HTML (session expired or login wall)",
        ));
    }
    serde_json::from_str(trimmed).map_err(|e| AdapterError::no_feed(format!("not JSON: {e}")))
}

/// `{"errors":[{"code":32,"message":"Could not authenticate you"}]}` → 凭据失效。
fn reject_if_auth_error(value: &serde_json::Value) -> Result<(), AdapterError> {
    let Some(errors) = value.get("errors").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    if errors.is_empty() {
        return Ok(());
    }
    let message = errors
        .iter()
        .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
        .collect::<Vec<_>>()
        .join("; ");
    // 32 / 215 = 认证失败；其余错误同样说明这次抓取没拿到数据
    let auth = errors.iter().any(|e| {
        matches!(
            e.get("code").and_then(|c| c.as_i64()),
            Some(32) | Some(215) | Some(239)
        )
    });
    if auth {
        Err(AdapterError {
            kind: error_kind::AUTH_EXPIRED,
            detail: if message.is_empty() {
                "credentials rejected by the endpoint".to_string()
            } else {
                message
            },
        })
    } else {
        Err(AdapterError::unexpected(if message.is_empty() {
            "endpoint returned errors".to_string()
        } else {
            message
        }))
    }
}

/// 递归收集所有 JSON 对象（顺序即文档顺序，保证映射可复现）。
fn collect<'a>(value: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
    match value {
        serde_json::Value::Object(map) => {
            out.push(value);
            for child in map.values() {
                collect(child, out);
            }
        }
        serde_json::Value::Array(array) => {
            for child in array {
                collect(child, out);
            }
        }
        _ => {}
    }
}

/// 首行当标题（长推文按换行切）。
fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    let line = if line.is_empty() { text.trim() } else { line };
    crate::urlutil::truncate_chars(line, 140)
}

fn shorten(url: &str) -> String {
    let host = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url);
    host.to_string()
}

fn short_date(ms: i64) -> String {
    // 只用于标题兜底，精度到天即可；用整数运算避免引入日期库
    let days = ms / 86_400_000;
    format!("day {days}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const X_FIXTURE: &str = r#"{
      "data": {
        "search_by_raw_query": {
          "search_timeline": {
            "timeline": {
              "instructions": [
                {"entries": [
                  {"content": {"itemContent": {"tweet_results": {"result": {
                     "rest_id": "111",
                     "core": {"user_results": {"result": {"core": {"screen_name": "reporter"}}}},
                     "legacy": {
                       "full_text": "Breaking: something happened\nmore text",
                       "created_at": "Wed Nov 18 12:00:00 +0000 2026",
                       "lang": "en"
                     }
                  }}}}}
                ]}
              ]
            }
          }
        }
      }
    }"#;

    const IG_FIXTURE: &str = r#"{
      "data": {
        "xdt_api__v1__feed__user_timeline_graphql_connection": {
          "edges": [
            {"node": {
              "code": "Cabc123",
              "taken_at": 1794315600,
              "caption": {"text": "A photo caption"},
              "user": {"username": "photographer"}
            }}
          ]
        }
      }
    }"#;

    fn auth() -> AuthSecret {
        AuthSecret {
            cookie: Some("auth_token=secret".into()),
            bearer: Some("bearer-token".into()),
            csrf_token: Some("csrf".into()),
            user_agent: None,
        }
    }

    #[test]
    fn maps_x_tweet_nodes() {
        let items = parse_x(X_FIXTURE, "https://x.com/i/api/graphql/x", 1_800_000_000_000).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://x.com/reporter/status/111");
        assert_eq!(items[0].title, "Breaking: something happened");
        assert_eq!(items[0].author.as_deref(), Some("reporter"));
        assert!(items[0].published_at.is_some());
        assert_eq!(items[0].summary.as_deref(), Some("Breaking: something happened more text"));
    }

    #[test]
    fn maps_instagram_media_nodes() {
        let items = parse_ig(IG_FIXTURE, "https://www.instagram.com/api/graphql", 0).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://www.instagram.com/p/Cabc123/");
        assert_eq!(items[0].summary.as_deref(), Some("A photo caption"));
        assert_eq!(items[0].published_at, Some(1_794_315_600_000));
    }

    #[test]
    fn missing_credentials_are_auth_expired_and_never_anonymous() {
        let err = build_x_request("https://x.com/graphql", None).unwrap_err();
        assert_eq!(err.kind(), "auth.expired");
        let err = build_ig_request("https://instagram.com/graphql", Some(&AuthSecret::default()))
            .unwrap_err();
        assert_eq!(err.kind(), "auth.expired");
    }

    #[test]
    fn endpoint_errors_are_classified_as_auth_expired() {
        let body = r#"{"errors":[{"code":32,"message":"Could not authenticate you."}]}"#;
        let err = parse_x(body, "https://x.com/graphql", 0).unwrap_err();
        assert_eq!(err.kind(), "auth.expired");
        assert!(err.detail().contains("authenticate"));
    }

    #[test]
    fn structure_change_is_unexpected_shape() {
        let err = parse_x(r#"{"data":{}}"#, "https://x.com/graphql", 0).unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
        let err = parse_ig(r#"{"data":{}}"#, "https://instagram.com/graphql", 0).unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn login_wall_html_is_unexpected_shape() {
        let err = parse_x("<html>login</html>", "https://x.com/graphql", 0).unwrap_err();
        assert_eq!(err.kind(), "parse.unexpected_shape");
    }

    #[test]
    fn requests_carry_credentials_as_headers() {
        let request = build_x_request("https://x.com/i/api/graphql/abc", Some(&auth())).unwrap();
        assert!(request
            .headers
            .iter()
            .any(|(k, v)| k == "Cookie" && v == "auth_token=secret"));
        assert!(request
            .headers
            .iter()
            .any(|(k, v)| k == "Authorization" && v == "Bearer bearer-token"));
        let ig = build_ig_request("https://www.instagram.com/api/graphql", Some(&auth())).unwrap();
        assert!(ig.headers.iter().any(|(k, _)| k == "x-ig-app-id"));
    }
}
