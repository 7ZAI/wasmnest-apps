//! opencode 原生事件 → 归一事件
//!
//! 载荷来源（两条通道同形）：
//! - 桥接：opencode 插件事件总线（`{type, properties}`，type 无版本后缀）；
//! - 镜像：`opencode.db` 的 `event` 表行（`{type, data}`，type 带 `.1` 版本后缀）。
//!
//! 已核对（本机 opencode 1.19.1 事件表实采）：`message.part.updated` /
//! `message.updated` / `session.updated` 三种事件与 part 的 text / reasoning /
//! tool / patch 四型。权限事件属 M4，未核对前不猜形状（落未知计数）。

use super::super::model::DraftEvent;
use super::{display_json, event_time, number_at, rev_of, text, text_at, tokens_json, Outcome};
use serde_json::Value;

pub fn normalize(raw: &Value, now: &str) -> Outcome {
    let ty = base_type(text(raw, "type").unwrap_or(""));
    let body = raw
        .get("properties")
        .or_else(|| raw.get("data"))
        .unwrap_or(raw);
    match ty {
        "message.part.updated" => part_updated(body, now),
        "message.updated" => message_updated(body, now),
        "session.updated" => session_updated(body, now),
        "session.created" => status_event(raw, body, "idle", now),
        "session.status" => session_status(raw, body, now),
        "session.idle" => status_event(raw, body, "idle", now),
        "session.error" => session_error(raw, body, now),
        "" => Outcome::unknown("opencode:missing-type"),
        other => Outcome::unknown(format!("opencode:{other}")),
    }
}

/// 去掉镜像事件表的版本后缀（`message.part.updated.1` → `message.part.updated`）
fn base_type(raw: &str) -> &str {
    match raw.rsplit_once('.') {
        Some((head, tail)) if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) => head,
        _ => raw,
    }
}

fn part_updated(body: &Value, now: &str) -> Outcome {
    let Some(part) = body.get("part").filter(|part| part.is_object()) else {
        return Outcome::ignored();
    };
    let part_type = text(part, "type").unwrap_or("");
    let at = event_time(part_time(part, body), now);
    // 版本 = 事件投递时间优先（同一 part 的快照按投递序单调），回退到 part/state 时间
    let rev = rev_of(body.get("time")).max(rev_of(part_time(part, body)));
    match part_type {
        // 桥接给用户消息的 text part 补 role（opencode part 本身不带角色）；
        // 用户正文进 user.message，不能渲染成 assistant 的流式文本
        "text" if text(part, "role") == Some("user") => user_text_part(part, rev, at),
        "text" => streaming_block(part, rev, at, "assistant.text", "text"),
        "reasoning" => {
            let draft = DraftEvent {
                kind: "assistant.thinking",
                payload: serde_json::json!({
                    "text": text(part, "text").unwrap_or(""),
                    "redacted": false,
                }),
                dedupe_key: identity("thinking", part),
                rev,
                at: at.clone(),
            };
            Outcome::events(vec![draft])
        }
        "tool" => tool_part(part, rev, at),
        "patch" => {
            let files: Vec<&str> = part
                .get("files")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            Outcome::events(vec![DraftEvent {
                kind: "patch",
                payload: serde_json::json!({
                    "files": files,
                    // opencode 1.19 的 patch part 只给 hash + files；diff 文本缺省为空，
                    // 界面按「文件列表」渲染，不伪造 diff
                    "diff": text(part, "diff").unwrap_or(""),
                }),
                dedupe_key: identity("patch", part),
                rev,
                at,
            }])
        }
        // step-* / compaction / file / snapshot 等生命周期 part：已知但无归一形态
        "step-start" | "step-finish" | "compaction" | "file" | "snapshot" | "agent" => {
            Outcome::ignored()
        }
        other => Outcome::unknown(format!("opencode:part:{other}")),
    }
}

fn user_text_part(part: &Value, rev: i64, at: String) -> Outcome {
    let value = text(part, "text").unwrap_or("");
    if value.trim().is_empty() {
        return Outcome::ignored();
    }
    let key = text(part, "messageID")
        .or_else(|| text(part, "id"))
        .unwrap_or("anon");
    Outcome::events(vec![DraftEvent {
        kind: "user.message",
        payload: serde_json::json!({ "text": value, "attachments": [] }),
        dedupe_key: format!("user:{key}"),
        rev,
        at,
    }])
}

fn streaming_block(part: &Value, rev: i64, at: String, kind: &'static str, field: &str) -> Outcome {
    let text_value = text(part, field).unwrap_or("");
    let draft = DraftEvent {
        kind,
        payload: serde_json::json!({
            "text": text_value,
            "streaming": part.get("time").and_then(|time| time.get("end")).is_none(),
            "messageId": text(part, "messageID"),
        }),
        dedupe_key: identity(
            if kind == "assistant.text" {
                "text"
            } else {
                "thinking"
            },
            part,
        ),
        rev,
        at,
    };
    Outcome::events(vec![draft])
}

fn tool_part(part: &Value, rev: i64, at: String) -> Outcome {
    let Some(state) = part.get("state").filter(|state| state.is_object()) else {
        return Outcome::ignored();
    };
    let call_id = text(part, "callID")
        .or_else(|| text(state, "callID"))
        .unwrap_or("");
    if call_id.is_empty() {
        return Outcome::unknown("opencode:tool:missing-call-id");
    }
    let status = text(state, "status").unwrap_or("");
    match status {
        "pending" | "running" => Outcome::events(vec![DraftEvent {
            kind: "tool.call",
            payload: serde_json::json!({
                "callId": call_id,
                "name": text(part, "tool").unwrap_or(""),
                "args": state.get("input").cloned().unwrap_or(serde_json::json!({})),
                "status": status,
            }),
            dedupe_key: format!("tool:{call_id}"),
            rev,
            at,
        }]),
        "completed" | "error" => {
            let output = state
                .get("output")
                .or_else(|| state.get("metadata").and_then(|meta| meta.get("output")));
            let error = state.get("error").filter(|value| !value.is_null());
            let exit_code = state
                .get("metadata")
                .and_then(|meta| meta.get("exit"))
                .and_then(Value::as_i64)
                .or_else(|| number_at(state, &["exitCode"]));
            Outcome::events(vec![DraftEvent {
                kind: "tool.result",
                payload: serde_json::json!({
                    "callId": call_id,
                    "output": display_json(output),
                    "error": error.map(|value| display_json(Some(value))),
                    "exitCode": exit_code,
                }),
                dedupe_key: format!("tool-result:{call_id}"),
                rev,
                at,
            }])
        }
        other => Outcome::unknown(format!("opencode:tool-status:{other}")),
    }
}

fn message_updated(body: &Value, now: &str) -> Outcome {
    let Some(info) = body.get("info").filter(|info| info.is_object()) else {
        return Outcome::ignored();
    };
    if text(info, "role") != Some("user") {
        // assistant 的消息级信息由 part 事件与 session.updated 覆盖，避免半截 meta 覆盖完整 meta
        return Outcome::ignored();
    }
    let text_content = body
        .get("parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter(|part| text(part, "type") == Some("text"))
                .filter_map(|part| text(part, "text"))
                .collect::<String>()
        })
        .unwrap_or_default();
    if text_content.is_empty() {
        // 只有消息壳没有正文：桥接/镜像应先补 parts（真实正文在 part 表），
        // 空的用户气泡比不显示更糟
        return Outcome::ignored();
    }
    let message_id = text(info, "id").unwrap_or("");
    let key = if message_id.is_empty() {
        // 缺 id 的畸形消息：取正文前缀当身份（重投同一载荷仍能去重）
        format!(
            "opencode:user:{}",
            text_content.chars().take(32).collect::<String>()
        )
    } else {
        message_id.to_string()
    };
    Outcome::events(vec![DraftEvent {
        kind: "user.message",
        payload: serde_json::json!({
            "text": text_content,
            "attachments": [],
        }),
        dedupe_key: format!("user:{key}"),
        rev: rev_of(info.get("time").and_then(|time| time.get("created"))),
        at: event_time(info.get("time").and_then(|time| time.get("created")), now),
    }])
}

fn session_updated(body: &Value, now: &str) -> Outcome {
    let Some(info) = body.get("info").filter(|info| info.is_object()) else {
        return Outcome::ignored();
    };
    let tokens = info.get("tokens");
    let tokens = tokens_json(
        tokens.and_then(|t| t.get("input")).and_then(Value::as_i64),
        tokens.and_then(|t| t.get("output")).and_then(Value::as_i64),
        tokens
            .and_then(|t| t.get("reasoning"))
            .and_then(Value::as_i64),
        tokens
            .and_then(|t| t.get("cache"))
            .and_then(|cache| cache.get("read"))
            .and_then(Value::as_i64),
        tokens
            .and_then(|t| t.get("cache"))
            .and_then(|cache| cache.get("write"))
            .and_then(Value::as_i64),
        tokens.and_then(|t| t.get("total")).and_then(Value::as_i64),
    );
    let agent_session = text(info, "id")
        .or_else(|| text(body, "sessionID"))
        .unwrap_or("");
    let model = text_at(info, &["model", "id"]).or_else(|| text(info, "modelID"));
    Outcome::events(vec![DraftEvent {
        kind: "session.meta",
        payload: serde_json::json!({
            "agentSessionId": agent_session,
            "title": text(info, "title"),
            "model": model,
            "tokens": tokens,
        }),
        dedupe_key: "meta:session".to_string(),
        rev: rev_of(
            info.get("time")
                .and_then(|time| time.get("updated"))
                .or_else(|| info.get("time").and_then(|time| time.get("created"))),
        ),
        at: event_time(
            info.get("time")
                .and_then(|time| time.get("updated"))
                .or_else(|| info.get("time").and_then(|time| time.get("created"))),
            now,
        ),
    }])
}

/// 无状态载荷的状态事件（session.created / 旧版 session.idle）→ 固定状态
fn status_event(raw: &Value, body: &Value, state: &str, now: &str) -> Outcome {
    let time = raw.get("time").or_else(|| body.get("time"));
    let rev = rev_of(time);
    let at = event_time(time, now);
    Outcome::events(vec![DraftEvent {
        kind: "status",
        payload: serde_json::json!({ "state": state }),
        dedupe_key: super::status_key(rev, &at),
        rev,
        at,
    }])
}

fn session_status(raw: &Value, body: &Value, now: &str) -> Outcome {
    let state = match text_at(body, &["status", "type"]) {
        Some("idle") => "idle",
        Some("busy") => "busy",
        Some("retry") => "retrying",
        Some("error") => "error",
        _ => return Outcome::ignored(),
    };
    let time = raw.get("time").or_else(|| body.get("time"));
    let rev = rev_of(time);
    let at = event_time(time, now);
    Outcome::events(vec![DraftEvent {
        kind: "status",
        payload: serde_json::json!({ "state": state }),
        dedupe_key: super::status_key(rev, &at),
        rev,
        at,
    }])
}

fn session_error(raw: &Value, body: &Value, now: &str) -> Outcome {
    let error = body
        .get("error")
        .filter(|value| value.is_object())
        .unwrap_or(body);
    let name = text(error, "name").unwrap_or("session_error");
    let time = raw.get("time").or_else(|| body.get("time"));
    let rev = rev_of(time);
    let at = event_time(time, now);
    // 用户中断不是错误条：opencode 用 MessageAbortedError 表达 Esc/Ctrl+C
    if name == "MessageAbortedError" {
        return Outcome::events(vec![DraftEvent {
            kind: "status",
            payload: serde_json::json!({ "state": "idle" }),
            dedupe_key: super::status_key(rev, &at),
            rev,
            at,
        }]);
    }
    let message = text_at(error, &["data", "message"])
        .or_else(|| text(error, "message"))
        .unwrap_or(name);
    let tail: String = message.chars().take(64).collect();
    Outcome::events(vec![DraftEvent {
        kind: "error",
        payload: serde_json::json!({ "code": name, "message": message }),
        dedupe_key: format!("error:{at}:{name}:{tail}"),
        rev,
        at,
    }])
}

fn part_time<'a>(part: &'a Value, body: &'a Value) -> Option<&'a Value> {
    part.get("time")
        .and_then(|time| time.get("end"))
        .or_else(|| part.get("time").and_then(|time| time.get("start")))
        .or_else(|| {
            part.get("state")
                .and_then(|state| state.get("time"))
                .and_then(|time| time.get("end"))
                .or_else(|| {
                    part.get("state")
                        .and_then(|state| state.get("time"))
                        .and_then(|time| time.get("start"))
                })
        })
        .or_else(|| body.get("time"))
}

/// 身份回退：part.id → messageID → 类型占位（缺 id 时同一消息的多条快照会合并）
fn identity(prefix: &str, part: &Value) -> String {
    let id = text(part, "id")
        .filter(|id| !id.is_empty())
        .or_else(|| text(part, "messageID"))
        .unwrap_or("anon");
    format!("{prefix}:{id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn version_suffix_is_stripped_from_mirror_event_types() {
        assert_eq!(base_type("message.part.updated.1"), "message.part.updated");
        assert_eq!(base_type("session.updated.1"), "session.updated");
        assert_eq!(base_type("message.updated"), "message.updated");
        assert_eq!(base_type("session.updated.abc"), "session.updated.abc");
    }

    #[test]
    fn empty_user_message_without_parts_is_not_rendered() {
        let raw = json!({
            "type": "message.updated",
            "properties": {"info": {"id": "msg1", "role": "user", "time": {"created": 1792101970375i64}}}
        });
        assert_eq!(normalize(&raw, "2026-10-30T00:00:00Z"), Outcome::ignored());
    }

    #[test]
    fn tool_running_payload_keeps_identity_by_call_id() {
        let raw = json!({
            "type": "message.part.updated",
            "properties": {
                "time": 1792104393457i64,
                "part": {
                    "id": "prt1", "messageID": "msg1", "type": "tool",
                    "callID": "call-1", "tool": "bash",
                    "state": {"status": "running", "input": {"command": "ls"}, "time": {"start": 1}}
                }
            }
        });
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts.len(), 1);
        let draft = &outcome.drafts[0];
        assert_eq!(draft.kind, "tool.call");
        assert_eq!(draft.dedupe_key, "tool:call-1");
        assert_eq!(draft.payload["status"], "running");
        assert_eq!(draft.payload["args"]["command"], "ls");
    }

    #[test]
    fn tool_error_becomes_result_with_error_text() {
        let raw = json!({
            "type": "message.part.updated",
            "properties": {
                "part": {
                    "id": "prt1", "type": "tool", "callID": "call-1", "tool": "bash",
                    "state": {"status": "error", "error": "boom", "input": {}}
                }
            }
        });
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "tool.result");
        assert_eq!(outcome.drafts[0].payload["error"], "boom");
    }

    #[test]
    fn user_text_part_becomes_user_message() {
        let raw = json!({
            "type": "message.part.updated",
            "time": 1792101970400i64,
            "properties": {
                "part": {
                    "id": "prt-u1", "messageID": "msg-u1", "type": "text",
                    "role": "user", "text": "继续"
                }
            }
        });
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "user.message");
        assert_eq!(outcome.drafts[0].payload["text"], "继续");
        assert_eq!(outcome.drafts[0].dedupe_key, "user:msg-u1");
    }

    #[test]
    fn session_status_and_error_map_to_conversation_kinds() {
        let busy = json!({
            "type": "session.status",
            "time": 1792104393457i64,
            "properties": {"sessionID": "ses1", "status": {"type": "busy"}}
        });
        let outcome = normalize(&busy, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "status");
        assert_eq!(outcome.drafts[0].payload["state"], "busy");
        assert_eq!(outcome.drafts[0].dedupe_key, "status:1792104393457");

        let failed = json!({
            "type": "session.error",
            "time": 1792104393458i64,
            "properties": {"sessionID": "ses1", "error": {"name": "ProviderAuthError", "data": {"message": "bad key"}}}
        });
        let outcome = normalize(&failed, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "error");
        assert_eq!(outcome.drafts[0].payload["code"], "ProviderAuthError");
        assert_eq!(outcome.drafts[0].payload["message"], "bad key");

        let aborted = json!({
            "type": "session.error",
            "time": 1792104393459i64,
            "properties": {"sessionID": "ses1", "error": {"name": "MessageAbortedError"}}
        });
        let outcome = normalize(&aborted, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "status", "用户中断不渲染成错误条");
        assert_eq!(outcome.drafts[0].payload["state"], "idle");
    }

    #[test]
    fn content_text_joins_only_text_blocks() {
        let content = json!([
            {"type": "text", "text": "a"},
            {"type": "image", "data": "..."},
            {"type": "text", "text": "b"}
        ]);
        assert_eq!(super::super::content_text(Some(&content)), "ab");
        assert_eq!(super::super::content_text(Some(&json!("raw"))), "raw");
    }
}
