//! pi JSONL 适配器：聚合 + 事件流
//!
//! 首行 `type=session` 携带 id/cwd；助手 usage 为 camelCase +
//! `usage.cost.total`（逐消息上报累计量，最后一条为准）；无 session 头的
//! 文件以消息行兜底推进（id 缺省由调用方按文件名补足）。
//!
//! # 对话还原口径（2026-10-25，对照 pi 官方 `docs/session-format.md` v3 与
//! pi TUI `assistant-message` / `tool-execution` 渲染）
//!
//! - assistant content 块还原为「思考 → 正文 → 工具」三段（pi TUI 同序）：
//!   `thinking` → 独立思考事件（前端默认折叠、弱化样式，redacted/空块跳过）；
//!   `text` → 助手正文一条（markdown 渲染）；`toolCall` → 独立工具事件
//!   `tool_use · 名称 · 参数摘要`（不再揉进助手正文）。纯工具/纯思考的助手
//!   消息不再产出空泡（正文空不入流）。
//! - `toolResult` 归一为 `tool_result · 名称 · 输出`（与 claude 配对形态同构，
//!   前端同一套工具卡切片）；isError 走 wire error 标志。
//! - 中断显性化（pi TUI 同语义）：`length` 恒出提示、`aborted`/`error` 在无
//!   工具调用时出提示，落 system 事件 `stop_reason · <原因>[ · <errorMessage>]`；
//!   有工具调用的中断轮由工具卡自身呈现失败，不再重复。
//! - 压缩与分支接缝可见：`compaction` / `branch_summary` 的 summary、
//!   `custom_message`（display=true）落 system 事件；`session_info.name`
//!   覆盖会话标题（与 pi `/resume` 同口径）。
//! - user 内容块：text 拼接，非 text 块给 `[non-text:<kind>]` 机器占位
//!   （图片附件不再静默消失；前端按 kind 查 i18n）。
//! - 不进对话的条目照旧跳过：`message/system`（提示词/工具清单回放）、
//!   `context_edit`（官方语义：只改模型上下文，UI/导出/本视图都用原始历史）、
//!   `usage`（pi 隐藏）、`custom`、`label`、`thinking_level_change`。

use super::common::{
    as_i64, extract_text, non_text_placeholder, parse_line, push_event, tool_args_summary,
    tool_result_text, truncate_text,
};
use super::time::parse_iso8601_ms;
use super::types::{NormalizedEvent, ParsedSession, TokenUsage};
use super::{ROLE_ASSISTANT, ROLE_SYSTEM, ROLE_THINKING, ROLE_TOOL, ROLE_USER};
use serde_json::Value;

// ==================== pi 适配器 ====================

/// 工具调用参数摘要上限（与 claude `TOOL_ARGS_CAP` 同口径）
const TOOL_ARGS_CAP: usize = 120;
/// 消息正文 / 思考 / 接缝摘要的截断上限（与 claude 同口径，前端
/// `GUEST_TEXT_CAPS.message` 镜像）
const MESSAGE_TEXT_CAP: usize = 2000;
/// stopReason 事件里 errorMessage 的摘要上限
const STOP_REASON_ERR_CAP: usize = 200;

/// pi JSONL 适配器：聚合 + 事件流
///
/// 首行 `type=session` 携带 id/cwd；助手 usage 为 camelCase +
/// `usage.cost.total`；无 session 头的文件以消息行兜底推进（id 缺省
/// 由调用方按文件名补足）。
pub(crate) fn parse_pi_session(content: &str) -> ParsedSession {
    let mut session = ParsedSession::default();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Some(v) = parse_line(line) else {
            session.skipped_lines += 1;
            continue;
        };
        let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let ts = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_iso8601_ms);
        if let Some(t) = ts {
            session.started_at = Some(session.started_at.map_or(t, |cur| cur.min(t)));
            session.ended_at = Some(session.ended_at.map_or(t, |cur| cur.max(t)));
        }

        match kind {
            "session" => {
                session.cli_session_id = v
                    .get("id")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                session.project = v.get("cwd").and_then(|c| c.as_str()).map(|s| s.to_string());
            }
            "message" => {
                let msg = v.get("message").cloned().unwrap_or(Value::Null);
                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
                match role {
                    "assistant" => {
                        parse_pi_assistant(&mut session, &msg, ts);
                    }
                    "user" => {
                        if let Some(text) =
                            user_display_text(msg.get("content").unwrap_or(&Value::Null))
                        {
                            if session.title.is_none() {
                                session.title = Some(truncate_text(&text, 120));
                            }
                            push_event(
                                &mut session,
                                NormalizedEvent {
                                    ts,
                                    role: ROLE_USER,
                                    // A7 对称补齐：user 正文与 assistant 同口径截断
                                    text: truncate_text(&text, MESSAGE_TEXT_CAP),
                                    model: None,
                                    tokens: None,
                                    error: false,
                                    tool_use_id: None,
                                },
                            );
                        }
                    }
                    "toolResult" => {
                        let tool = msg
                            .get("toolName")
                            .and_then(|n| n.as_str())
                            .unwrap_or("tool");
                        // A4 ③：非 text 块（图片/二进制）给占位而非静默丢弃
                        let text = tool_result_text(msg.get("content").unwrap_or(&Value::Null));
                        let err = msg
                            .get("isError")
                            .and_then(|e| e.as_bool())
                            .unwrap_or(false);
                        let tid = msg
                            .get("toolCallId")
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();
                        push_event(
                            &mut session,
                            NormalizedEvent {
                                ts,
                                role: ROLE_TOOL,
                                // 与 claude 配对形态同构（`tool_result · 名称 · 输出`）：
                                // 前端同一套工具卡切片，调用卡与结果卡成对出现
                                text: format!(
                                    "tool_result · {tool} · {}",
                                    truncate_text(&text, 1000)
                                ),
                                model: None,
                                tokens: None,
                                error: err,
                                tool_use_id: (!tid.is_empty()).then_some(tid),
                            },
                        );
                    }
                    // system（提示词 / 工具清单回放）不进对话视图
                    _ => {}
                }
            }
            "model_change" => {
                let text = v
                    .get("modelId")
                    .and_then(|m| m.as_str())
                    .map(|m| format!("model_change · {m}"))
                    .unwrap_or_else(|| "model_change".to_string());
                push_event(
                    &mut session,
                    NormalizedEvent {
                        ts,
                        role: ROLE_SYSTEM,
                        text,
                        model: None,
                        tokens: None,
                        error: false,
                        tool_use_id: None,
                    },
                );
            }
            "compaction" => {
                if let Some(summary) = nonempty(v.get("summary")) {
                    push_event(
                        &mut session,
                        NormalizedEvent {
                            ts,
                            role: ROLE_SYSTEM,
                            text: format!(
                                "compaction · {}",
                                truncate_text(&summary, MESSAGE_TEXT_CAP)
                            ),
                            model: None,
                            tokens: None,
                            error: false,
                            tool_use_id: None,
                        },
                    );
                }
            }
            "branch_summary" => {
                if let Some(summary) = nonempty(v.get("summary")) {
                    push_event(
                        &mut session,
                        NormalizedEvent {
                            ts,
                            role: ROLE_SYSTEM,
                            text: format!(
                                "branch_summary · {}",
                                truncate_text(&summary, MESSAGE_TEXT_CAP)
                            ),
                            model: None,
                            tokens: None,
                            error: false,
                            tool_use_id: None,
                        },
                    );
                }
            }
            "custom_message" => {
                // display=true 才进 TUI（官方语义），false/缺省是纯上下文注入
                let display = v.get("display").and_then(|d| d.as_bool()).unwrap_or(false);
                if display {
                    if let Some(text) = user_display_text(v.get("content").unwrap_or(&Value::Null))
                    {
                        let ctype = v
                            .get("customType")
                            .and_then(|c| c.as_str())
                            .unwrap_or("extension");
                        push_event(
                            &mut session,
                            NormalizedEvent {
                                ts,
                                role: ROLE_SYSTEM,
                                text: format!(
                                    "custom_message · {ctype} · {}",
                                    truncate_text(&text, MESSAGE_TEXT_CAP)
                                ),
                                model: None,
                                tokens: None,
                                error: false,
                                tool_use_id: None,
                            },
                        );
                    }
                }
            }
            "session_info" => {
                // 用户自设会话名（/name）：与 pi /resume 同口径，覆盖首条 user 标题
                if let Some(name) = nonempty(v.get("name")) {
                    session.title = Some(truncate_text(&name, 120));
                }
            }
            // custom / usage / label / thinking_level_change / context_edit 等
            // 元数据行不进事件流（usage 参与统计但 pi 官方即隐藏，本层不记）
            _ => {}
        }
    }

    session
}

/// assistant 消息 → 事件（思考 → 正文 → 工具调用，pi TUI 同序）
///
/// usage 聚合与 cost 记账先于事件产出（与事件是否入流无关）；正文为空的
/// 助手消息不再产出空泡（纯工具 / 纯思考 / 中断轮），中断信息由
/// [`push_stop_reason`] 按 pi TUI 语义补一条 system 事件。
fn parse_pi_assistant(session: &mut ParsedSession, msg: &Value, ts: Option<i64>) {
    let model = msg
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    let usage_val = msg.get("usage");
    let has_usage = usage_val.map(|u| u.is_object()).unwrap_or(false);
    let usage = TokenUsage {
        input: as_i64(usage_val.and_then(|u| u.get("input"))),
        output: as_i64(usage_val.and_then(|u| u.get("output"))),
        cache_read: as_i64(usage_val.and_then(|u| u.get("cacheRead"))),
        cache_write: as_i64(usage_val.and_then(|u| u.get("cacheWrite"))),
        reasoning: as_i64(usage_val.and_then(|u| u.get("reasoning"))),
    };
    if has_usage {
        session.record_assistant_usage(&model, &usage);
    }
    if let Some(cost) = usage_val
        .and_then(|u| u.get("cost"))
        .and_then(|c| c.get("total"))
        .and_then(|c| c.as_f64())
    {
        // 同会话多模型时取累计（cost 逐消息上报累计量）
        session.cost_total = Some(cost);
    }

    let blocks = msg.get("content").and_then(|c| c.as_array());

    // ① thinking 块 → 独立思考事件（redacted 只剩加密签名无可见文本，跳过）
    if let Some(blocks) = blocks {
        for b in blocks {
            if b.get("type").and_then(|t| t.as_str()) != Some("thinking") {
                continue;
            }
            if b.get("redacted").and_then(|r| r.as_bool()).unwrap_or(false) {
                continue;
            }
            let Some(thinking) = b.get("thinking").and_then(|t| t.as_str()) else {
                continue;
            };
            let thinking = thinking.trim();
            if thinking.is_empty() {
                continue;
            }
            push_event(
                session,
                NormalizedEvent {
                    ts,
                    role: ROLE_THINKING,
                    text: truncate_text(thinking, MESSAGE_TEXT_CAP),
                    model: None,
                    tokens: None,
                    error: false,
                    tool_use_id: None,
                },
            );
        }
    }

    // ② text 块 → 助手正文一条（markdown 渲染；空正文不入流）
    let mut text = String::new();
    if let Some(blocks) = blocks {
        for b in blocks {
            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(t);
                }
            }
        }
    }
    let text = text.trim().to_string();
    if !text.is_empty() {
        push_event(
            session,
            NormalizedEvent {
                ts,
                role: ROLE_ASSISTANT,
                text: truncate_text(&text, MESSAGE_TEXT_CAP),
                model: Some(model),
                tokens: has_usage.then_some(usage),
                error: false,
                tool_use_id: None,
            },
        );
    }

    // ③ toolCall 块 → 独立工具事件（调用卡；结果由后续 toolResult 出结果卡）
    let mut has_tool_calls = false;
    if let Some(blocks) = blocks {
        for b in blocks {
            if b.get("type").and_then(|t| t.as_str()) != Some("toolCall") {
                continue;
            }
            has_tool_calls = true;
            let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("?");
            let args = tool_args_summary(b.get("arguments"), TOOL_ARGS_CAP);
            let tid = b.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let text = if args.is_empty() {
                format!("tool_use · {name}")
            } else {
                format!("tool_use · {name} · {args}")
            };
            push_event(
                session,
                NormalizedEvent {
                    ts,
                    role: ROLE_TOOL,
                    text,
                    model: None,
                    tokens: None,
                    error: false,
                    tool_use_id: (!tid.is_empty()).then_some(tid.to_string()),
                },
            );
        }
    }

    push_stop_reason(session, msg, ts, has_tool_calls);
}

/// 中断显性化（pi TUI `assistant-message` 同语义）：
/// - `length`：恒出提示（截断可能发生在工具调用之前，文本不完整）；
/// - `aborted` / `error`：仅无工具调用时出提示（有工具调用由工具卡呈现失败）；
/// - errorMessage 进事件文本（pi 自身的状态串，与工具输出同权呈现）；
///   aborted 无 errorMessage 时用 pi 的兜底文案 "Operation aborted"，
///   error 无 errorMessage 时用 "Unknown error"。
fn push_stop_reason(
    session: &mut ParsedSession,
    msg: &Value,
    ts: Option<i64>,
    has_tool_calls: bool,
) {
    let stop = msg.get("stopReason").and_then(|s| s.as_str()).unwrap_or("");
    let show = match stop {
        "length" => true,
        "aborted" | "error" => !has_tool_calls,
        _ => false,
    };
    if !show {
        return;
    }
    let err = msg
        .get("errorMessage")
        .and_then(|e| e.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let fallback = match stop {
        "aborted" => Some("Operation aborted"),
        "error" => Some("Unknown error"),
        _ => None,
    };
    let mut text = format!("stop_reason · {stop}");
    match err.or(fallback) {
        Some(e) if stop != "length" => {
            text.push_str(&format!(" · {}", truncate_text(e, STOP_REASON_ERR_CAP)));
        }
        _ => {}
    }
    push_event(
        session,
        NormalizedEvent {
            ts,
            role: ROLE_SYSTEM,
            text,
            model: None,
            tokens: None,
            error: false,
            tool_use_id: None,
        },
    );
}

/// 字符串字段取非空裁剪值
fn nonempty(v: Option<&Value>) -> Option<String> {
    v.and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// pi user / custom_message 内容 → 展示文本
///
/// string 直取；数组块拼接 text，非 text 块（图片附件等）给
/// `[non-text:<kind>]` 机器占位（前端本地化）——不再静默消失；单对象形态
/// 走与数组同一套判定。
fn user_display_text(content: &Value) -> Option<String> {
    match content {
        Value::String(s) => {
            let s = s.trim();
            (!s.is_empty()).then(|| s.to_string())
        }
        Value::Array(blocks) => {
            let mut parts: Vec<String> = Vec::new();
            for b in blocks {
                match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                            if !t.trim().is_empty() {
                                parts.push(t.trim().to_string());
                            }
                        }
                    }
                    Some(other) => parts.push(non_text_placeholder(other)),
                    // 未知形状块：不制造占位（原始 JSONL 页签可查）
                    None => {}
                }
            }
            let t = parts.join("\n").trim().to_string();
            (!t.is_empty()).then_some(t)
        }
        Value::Object(_) => extract_text(content).or_else(|| {
            content
                .get("type")
                .and_then(|t| t.as_str())
                .map(non_text_placeholder)
        }),
        _ => None,
    }
}

// ==================== Tests（纯函数单测） ====================

// 用例按功能拆至 `pi/tests/`（本内联模块的子模块路径由 rustc
// 自动解析到该目录；模块树 `usage_parse::pi::tests::<文件>` 与内联形态等价，私有项可见性不受影响）。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::usage_parse::MAX_EVENTS;
    use serde_json::{json, Value};
    // 跨分组共享的测试脚手架（子模块经 `use super::*` 可见）

    fn pi_session_header() -> String {
        json!({
            "type": "session",
            "version": 3,
            "id": "pi-sess-1",
            "timestamp": "2026-09-07T20:54:02.063Z",
            "cwd": "/home/binblink"
        })
        .to_string()
    }
    fn pi_assistant_line(model: &str, usage: Value, cost_total: f64, ts: &str) -> String {
        let mut usage_obj = usage;
        usage_obj["cost"] = json!({ "total": cost_total });
        json!({
            "type": "message",
            "id": "entry-1",
            "timestamp": ts,
            "message": {
                "role": "assistant",
                "model": model,
                "provider": "sensenova",
                "content": [{ "type": "text", "text": "回答" }],
                "usage": usage_obj
            }
        })
        .to_string()
    }
    mod pi_conversation_restore;
    mod pi_header_and_camel_case;
    mod pi_truncated_last_line;
}
