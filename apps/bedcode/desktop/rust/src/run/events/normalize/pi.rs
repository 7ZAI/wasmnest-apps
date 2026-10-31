//! pi 原生载荷 → 归一事件
//!
//! 两条通道形状不同，但都是实测/类型声明核对过的：
//! - 桥接：pi 扩展 `ExtensionAPI` 事件（`message_start` / `message_update` /
//!   `message_end` / `tool_execution_*` / `turn_start` / `agent_settled`，
//!   pi 1.4.0 `core/extensions/types.d.ts`）；
//! - 镜像：`~/.pi/agent/sessions/<bucket>/*.jsonl` 的会话记录行（`session` /
//!   `model_change` / `message` / `custom`，本机实采）。
//!
//! pi 的会话是**树**（entry 有 id/parentId）：这里只按到达顺序线性归一，
//! 不重排父子关系（fork/branch 在 spec 范围之外）。

use super::super::model::DraftEvent;
use super::{
    block_text, content_text, display_json, event_time, number_at, rev_of, text, tokens_json,
    Outcome,
};
use serde_json::Value;

pub fn normalize(raw: &Value, now: &str) -> Outcome {
    let ty = text(raw, "type").unwrap_or("");
    match ty {
        "message_start" => message_start(raw, now),
        "message_update" => message_update(raw, now),
        "message_end" => message_end(raw, now),
        "tool_execution_start" => tool_execution_start(raw, now),
        "tool_execution_update" => Outcome::ignored(),
        "tool_execution_end" => tool_execution_end(raw, now),
        "turn_start" | "before_agent_start" => status(raw, "busy", now),
        "turn_end" => Outcome::ignored(),
        // aborted（用户中断）与正常收束都回到 idle：中断的终态由运行自身状态表达
        "agent_settled" | "session_start" | "session_shutdown" => status(raw, "idle", now),
        "session" => session_meta(raw, now),
        "model_change" => model_meta(raw, now),
        "message" => jsonl_message(raw, now),
        "custom" | "thinking_level_change" | "compaction" | "branch_summary" => Outcome::ignored(),
        "" => Outcome::unknown("pi:missing-type"),
        other => Outcome::unknown(format!("pi:{other}")),
    }
}

// ==================== 桥接：扩展事件 ====================

fn message_start(raw: &Value, now: &str) -> Outcome {
    let Some(message) = message_of(raw) else {
        return Outcome::ignored();
    };
    if text(message, "role") != Some("user") {
        // assistant 的正文走 message_update / message_end；toolResult 走 tool_execution_end
        return Outcome::ignored();
    }
    user_message(message, message_key(message), now)
}

fn message_update(raw: &Value, now: &str) -> Outcome {
    let Some(message) = message_of(raw) else {
        return Outcome::ignored();
    };
    if text(message, "role") != Some("assistant") {
        return Outcome::ignored();
    }
    let event = raw.get("assistantMessageEvent").unwrap_or(&Value::Null);
    let event_type = text(event, "type").unwrap_or("");
    match event_type {
        "text_delta" | "text_start" | "text_end" => content_block(
            message,
            number_at(event, &["contentIndex"]),
            "text",
            true,
            now,
        ),
        "thinking_delta" | "thinking_start" | "thinking_end" => content_block(
            message,
            number_at(event, &["contentIndex"]),
            "thinking",
            true,
            now,
        ),
        "error" => Outcome::events(vec![error_event(
            "agent_error",
            text(event, "errorMessage")
                .or_else(|| text(event, "reason"))
                .unwrap_or("agent error"),
            rev_of(message.get("timestamp")),
            event_time(Some(event), now),
        )]),
        _ => Outcome::ignored(),
    }
}

fn message_end(raw: &Value, now: &str) -> Outcome {
    let Some(message) = message_of(raw) else {
        return Outcome::ignored();
    };
    match text(message, "role") {
        Some("assistant") => {
            let mut drafts = Vec::new();
            // message_end 是终态快照：版本 +1 压过同一条消息的流式更新，重放更新不回退
            let rev = rev_of(message.get("timestamp")) + 1;
            if let Some(blocks) = message.get("content").and_then(Value::as_array) {
                for (index, block) in blocks.iter().enumerate() {
                    match text(block, "type") {
                        Some("text") => {
                            if let Some(text_value) = text(block, "text") {
                                drafts.push(block_event(
                                    "assistant.text",
                                    text_value.to_string(),
                                    false,
                                    message_key(message),
                                    Some(message.get("timestamp").cloned().unwrap_or(Value::Null)),
                                    format!("text:{}:{}", message_key(message), index),
                                    rev,
                                    now,
                                ));
                            }
                        }
                        Some("thinking") => {
                            if let Some(text_value) = text(block, "thinking") {
                                drafts.push(block_event(
                                    "assistant.thinking",
                                    text_value.to_string(),
                                    false,
                                    message_key(message),
                                    Some(message.get("timestamp").cloned().unwrap_or(Value::Null)),
                                    format!("thinking:{}:{}", message_key(message), index),
                                    rev,
                                    now,
                                ));
                            }
                        }
                        _ => {}
                    }
                }
            }
            if let Some(usage) = message.get("usage") {
                drafts.push(usage_meta(usage, message, rev, now));
            }
            if text(message, "stopReason") == Some("error") {
                drafts.push(error_event(
                    "agent_error",
                    text(message, "errorMessage").unwrap_or("agent error"),
                    rev,
                    event_time(message.get("timestamp"), now),
                ));
            }
            Outcome::events(drafts)
        }
        Some("user") => user_message(message, message_key(message), now),
        Some("toolResult") => tool_result(Ok(message), now),
        _ => Outcome::ignored(),
    }
}

fn tool_execution_start(raw: &Value, now: &str) -> Outcome {
    let call_id = text(raw, "toolCallId").unwrap_or("");
    if call_id.is_empty() {
        return Outcome::unknown("pi:tool_execution_start:missing-call-id");
    }
    Outcome::events(vec![DraftEvent {
        kind: "tool.call",
        payload: serde_json::json!({
            "callId": call_id,
            "name": text(raw, "toolName").unwrap_or(""),
            "args": raw.get("args").cloned().unwrap_or(serde_json::json!({})),
            "status": "running",
        }),
        dedupe_key: format!("tool:{call_id}"),
        rev: rev_of(raw.get("timestamp")),
        at: event_time(raw.get("timestamp"), now),
    }])
}

fn tool_execution_end(raw: &Value, now: &str) -> Outcome {
    tool_result(Err(raw), now)
}

/// 工具结果：桥接事件（`Err(raw)`）与消息形态（`Ok(message)`）共用
fn tool_result(source: Result<&Value, &Value>, now: &str) -> Outcome {
    let (call_id, output, is_error, rev, at) = match source {
        Err(raw) => (
            text(raw, "toolCallId").unwrap_or("").to_string(),
            display_json(raw.get("result")),
            raw.get("isError").and_then(Value::as_bool).unwrap_or(false),
            rev_of(raw.get("timestamp")),
            event_time(raw.get("timestamp"), now),
        ),
        Ok(message) => (
            text(message, "toolCallId").unwrap_or("").to_string(),
            content_text(message.get("content")),
            message
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            rev_of(message.get("timestamp")),
            event_time(message.get("timestamp"), now),
        ),
    };
    if call_id.is_empty() {
        return Outcome::unknown("pi:tool-result:missing-call-id");
    }
    Outcome::events(vec![DraftEvent {
        kind: "tool.result",
        payload: serde_json::json!({
            "callId": call_id,
            "output": output,
            "error": if is_error { Some(output.clone()) } else { None },
            "exitCode": null,
        }),
        dedupe_key: format!("tool-result:{call_id}"),
        rev,
        at,
    }])
}

fn status(raw: &Value, state: &str, now: &str) -> Outcome {
    // 扩展事件有的没有 timestamp（agent_settled / session_* / tool_execution_*）：
    // 桥接给每条入站载荷补顶层 `time`，这里按 timestamp → time 回退
    let time = raw.get("timestamp").or_else(|| raw.get("time"));
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

// ==================== 镜像：JSONL 会话记录 ====================

fn session_meta(raw: &Value, now: &str) -> Outcome {
    let id = text(raw, "id").unwrap_or("");
    if id.is_empty() {
        return Outcome::ignored();
    }
    Outcome::events(vec![DraftEvent {
        kind: "session.meta",
        payload: serde_json::json!({
            "agentSessionId": id,
            "title": text(raw, "title"),
            "model": null,
            "tokens": Value::Null,
        }),
        dedupe_key: "meta:session".to_string(),
        rev: rev_of(raw.get("timestamp")),
        at: event_time(raw.get("timestamp"), now),
    }])
}

fn model_meta(raw: &Value, now: &str) -> Outcome {
    let model = text(raw, "modelId").unwrap_or("");
    if model.is_empty() {
        return Outcome::ignored();
    }
    Outcome::events(vec![DraftEvent {
        kind: "session.meta",
        payload: serde_json::json!({ "model": model }),
        dedupe_key: "meta:model".to_string(),
        rev: rev_of(raw.get("timestamp")),
        at: event_time(raw.get("timestamp"), now),
    }])
}

fn jsonl_message(raw: &Value, now: &str) -> Outcome {
    let Some(message) = message_of(raw) else {
        return Outcome::ignored();
    };
    let entry_id = text(raw, "id").unwrap_or("");
    let key = if entry_id.is_empty() {
        message_key(message)
    } else {
        entry_id.to_string()
    };
    match text(message, "role") {
        Some("user") => user_message(message, key, now),
        Some("assistant") => {
            let mut drafts = Vec::new();
            if let Some(blocks) = message.get("content").and_then(Value::as_array) {
                for (index, block) in blocks.iter().enumerate() {
                    match text(block, "type") {
                        Some("text") => {
                            if let Some(text_value) = text(block, "text") {
                                drafts.push(block_event(
                                    "assistant.text",
                                    text_value.to_string(),
                                    false,
                                    key.clone(),
                                    raw.get("timestamp").cloned(),
                                    format!("text:{key}:{index}"),
                                    rev_of(message.get("timestamp")),
                                    now,
                                ));
                            }
                        }
                        Some("thinking") => {
                            if let Some(text_value) = text(block, "thinking") {
                                drafts.push(block_event(
                                    "assistant.thinking",
                                    text_value.to_string(),
                                    false,
                                    key.clone(),
                                    raw.get("timestamp").cloned(),
                                    format!("thinking:{key}:{index}"),
                                    rev_of(message.get("timestamp")),
                                    now,
                                ));
                            }
                        }
                        Some("toolCall") => {
                            let call_id = text(block, "id").unwrap_or("");
                            if call_id.is_empty() {
                                continue;
                            }
                            drafts.push(DraftEvent {
                                kind: "tool.call",
                                payload: serde_json::json!({
                                    "callId": call_id,
                                    "name": text(block, "name").unwrap_or(""),
                                    "args": block.get("arguments").cloned().unwrap_or(serde_json::json!({})),
                                    "status": "pending",
                                }),
                                dedupe_key: format!("tool:{call_id}"),
                                rev: rev_of(message.get("timestamp")),
                                at: event_time(raw.get("timestamp"), now),
                            });
                        }
                        _ => {}
                    }
                }
            }
            if let Some(usage) = message.get("usage") {
                drafts.push(usage_meta(
                    usage,
                    message,
                    rev_of(message.get("timestamp")),
                    now,
                ));
            }
            if text(message, "stopReason") == Some("error") {
                drafts.push(error_event(
                    "agent_error",
                    text(message, "errorMessage").unwrap_or("agent error"),
                    rev_of(message.get("timestamp")),
                    event_time(raw.get("timestamp"), now),
                ));
            }
            Outcome::events(drafts)
        }
        Some("toolResult") => tool_result(Ok(message), now),
        _ => Outcome::ignored(),
    }
}

// ==================== 共用 ====================

fn message_of(raw: &Value) -> Option<&Value> {
    raw.get("message").filter(|message| message.is_object())
}

/// 扩展事件没有 entry id：用消息开始时间（毫秒）当稳定键；
/// JSONL 消息用 entry id（调用方已处理）。
fn message_key(message: &Value) -> String {
    message
        .get("timestamp")
        .and_then(Value::as_i64)
        .map(|ms| format!("msg-{ms}"))
        .unwrap_or_else(|| "msg-anon".to_string())
}

fn user_message(message: &Value, key: String, now: &str) -> Outcome {
    let text_value = content_text(message.get("content"));
    if text_value.is_empty() {
        return Outcome::ignored();
    }
    Outcome::events(vec![DraftEvent {
        kind: "user.message",
        payload: serde_json::json!({
            "text": text_value,
            "attachments": [],
        }),
        dedupe_key: format!("user:{key}"),
        rev: rev_of(message.get("timestamp")),
        at: event_time(message.get("timestamp"), now),
    }])
}

/// 流式更新里的单个内容块（message_update 携带累积快照，取 contentIndex 对应的块）
fn content_block(
    message: &Value,
    content_index: Option<i64>,
    block_type: &str,
    streaming: bool,
    now: &str,
) -> Outcome {
    let Some(blocks) = message.get("content").and_then(Value::as_array) else {
        return Outcome::ignored();
    };
    let index = content_index
        .and_then(|value| usize::try_from(value).ok())
        .or_else(|| {
            blocks
                .iter()
                .position(|block| text(block, "type") == Some(block_type))
        });
    let Some(index) = index else {
        return Outcome::ignored();
    };
    let Some(block) = blocks.get(index) else {
        return Outcome::ignored();
    };
    if text(block, "type") != Some(block_type) {
        return Outcome::ignored();
    }
    let Some(text_value) = block_text(block) else {
        return Outcome::ignored();
    };
    let key = message_key(message);
    let (kind, prefix) = if block_type == "text" {
        ("assistant.text", "text")
    } else {
        ("assistant.thinking", "thinking")
    };
    Outcome::events(vec![block_event(
        kind,
        text_value.to_string(),
        streaming,
        key.clone(),
        message.get("timestamp").cloned(),
        format!("{prefix}:{key}:{index}"),
        rev_of(message.get("timestamp")),
        now,
    )])
}

fn block_event(
    kind: &'static str,
    text_value: String,
    streaming: bool,
    message_id: String,
    timestamp: Option<Value>,
    dedupe_key: String,
    rev: i64,
    now: &str,
) -> DraftEvent {
    let payload = if kind == "assistant.thinking" {
        serde_json::json!({ "text": text_value, "redacted": false })
    } else {
        serde_json::json!({
            "text": text_value,
            "streaming": streaming,
            "messageId": message_id,
        })
    };
    DraftEvent {
        kind,
        payload,
        dedupe_key,
        rev,
        at: event_time(timestamp.as_ref(), now),
    }
}

fn usage_meta(usage: &Value, message: &Value, rev: i64, now: &str) -> DraftEvent {
    DraftEvent {
        kind: "session.meta",
        payload: serde_json::json!({
            "model": text(message, "model"),
            "tokens": tokens_json(
                number_at(usage, &["input"]),
                number_at(usage, &["output"]),
                number_at(usage, &["reasoning"]),
                number_at(usage, &["cacheRead"]),
                number_at(usage, &["cacheWrite"]),
                number_at(usage, &["totalTokens"]),
            ),
        }),
        dedupe_key: "meta:usage".to_string(),
        rev,
        at: event_time(message.get("timestamp"), now),
    }
}

fn error_event(code: &str, message: &str, rev: i64, at: String) -> DraftEvent {
    // 同一秒内同码的多条错误不得因身份碰撞被吞：带上正文前缀区分
    let tail: String = message.chars().take(64).collect();
    DraftEvent {
        kind: "error",
        payload: serde_json::json!({ "code": code, "message": message }),
        dedupe_key: format!("error:{at}:{code}:{tail}"),
        rev,
        at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jsonl_session_entry_becomes_agent_session_meta() {
        let raw = json!({"type": "session", "id": "01a18bff", "timestamp": "2026-10-30T08:49:29.949Z", "cwd": "/tmp"});
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts.len(), 1);
        assert_eq!(outcome.drafts[0].kind, "session.meta");
        assert_eq!(outcome.drafts[0].payload["agentSessionId"], "01a18bff");
        assert_eq!(
            outcome.drafts[0].dedupe_key, "meta:session",
            "会话身份只有一个槽，重复到达原地更新"
        );
    }

    #[test]
    fn assistant_message_end_emits_text_and_usage() {
        let raw = json!({
            "type": "message_end",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "done"}],
                "timestamp": 1792100000000i64,
                "model": "deepseek-v4.1-flash",
                "usage": {"input": 10, "output": 20, "reasoning": 3, "cacheRead": 4, "cacheWrite": 0, "totalTokens": 37},
                "stopReason": "stop"
            }
        });
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        let kinds: Vec<_> = outcome.drafts.iter().map(|d| d.kind).collect();
        assert_eq!(kinds, vec!["assistant.text", "session.meta"]);
        assert_eq!(outcome.drafts[0].payload["streaming"], false);
        assert_eq!(outcome.drafts[0].dedupe_key, "text:msg-1792100000000:0");
        assert_eq!(outcome.drafts[1].payload["tokens"]["total"], 37);
    }

    #[test]
    fn text_delta_uses_cumulative_snapshot_and_same_identity() {
        let message = json!({
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "hello"}],
            "timestamp": 1792100000000i64
        });
        let raw = json!({
            "type": "message_update",
            "message": message,
            "assistantMessageEvent": {"type": "text_delta", "contentIndex": 1, "delta": "lo"}
        });
        let outcome = normalize(&raw, "2026-10-30T00:00:00Z");
        assert_eq!(outcome.drafts[0].kind, "assistant.text");
        assert_eq!(outcome.drafts[0].payload["text"], "hello");
        assert_eq!(outcome.drafts[0].payload["streaming"], true);
        assert_eq!(outcome.drafts[0].dedupe_key, "text:msg-1792100000000:1");
    }

    #[test]
    fn session_start_and_before_agent_start_map_to_status() {
        let start = normalize(
            &json!({"type": "session_start", "reason": "startup", "time": 1792100000001i64}),
            "2026-10-30T00:00:00Z",
        );
        assert_eq!(start.drafts[0].kind, "status");
        assert_eq!(start.drafts[0].payload["state"], "idle");
        assert_eq!(start.drafts[0].dedupe_key, "status:1792100000001");

        let busy = normalize(
            &json!({"type": "before_agent_start", "time": 1792100000002i64}),
            "2026-10-30T00:00:00Z",
        );
        assert_eq!(busy.drafts[0].kind, "status");
        assert_eq!(busy.drafts[0].payload["state"], "busy");
    }

    #[test]
    fn agent_settled_maps_to_idle_state() {
        let outcome = normalize(
            &json!({"type": "agent_settled", "aborted": false}),
            "2026-10-30T00:00:00Z",
        );
        assert_eq!(outcome.drafts[0].kind, "status");
        assert_eq!(outcome.drafts[0].payload["state"], "idle");
        assert_eq!(outcome.drafts[0].at, "2026-10-30T00:00:00Z");
    }
}
