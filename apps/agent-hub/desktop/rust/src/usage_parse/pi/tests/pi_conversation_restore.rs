//! pi 对话还原（2026-10-25）——对照 pi 官方 `docs/session-format.md` v3 与
//! pi TUI `assistant-message` / `tool-execution` 的渲染口径：
//! 思考默认折叠独立呈现、工具调用/结果成对成卡、中断显性化、接缝可见。

use super::*;

use serde_json::{json, Value};

/// assistant content 三段按序独立成事件（pi TUI 同序：思考 → 正文 → 工具）
#[test]
fn pi_assistant_content_restores_thinking_text_toolcall() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "deepseek-v4-flash",
                "content": [
                    { "type": "thinking", "thinking": "先看文件" },
                    { "type": "text", "text": "我来看一下。" },
                    { "type": "toolCall", "id": "call_1", "name": "read",
                      "arguments": { "path": "src/lib.rs" } }
                ],
                "usage": { "input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 0, "reasoning": 2 }
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["thinking", "assistant", "tool"]);
    assert_eq!(s.events[0].text, "先看文件");
    assert_eq!(s.events[1].text, "我来看一下。");
    assert_eq!(s.events[1].model.as_deref(), Some("deepseek-v4-flash"));
    assert!(s.events[1].tokens.is_some());
    // 工具调用独立成卡：名称 + 参数摘要 + 调用 id（与结果配对的键）
    assert_eq!(
        s.events[2].text,
        "tool_use · read · {\"path\":\"src/lib.rs\"}"
    );
    assert_eq!(s.events[2].tool_use_id.as_deref(), Some("call_1"));
    assert!(!s.events[2].error);
}

/// 完整一轮：user → 助手正文+工具调用 → 工具结果；调用卡与结果卡同构成对
#[test]
fn pi_full_turn_restore() {
    let content = format!(
        "{}\n{}\n{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:05.000Z",
            "message": { "role": "user", "content": "修复 bug" }
        })
        .to_string(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "deepseek-v4-flash",
                "content": [
                    { "type": "text", "text": "看一下入口文件。" },
                    { "type": "toolCall", "id": "call_1", "name": "read",
                      "arguments": { "path": "src/main.rs" } }
                ]
            }
        })
        .to_string(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:30.000Z",
            "message": {
                "role": "toolResult",
                "toolName": "read",
                "toolCallId": "call_1",
                "isError": false,
                "content": [{ "type": "text", "text": "42 行" }]
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["user", "assistant", "tool", "tool"]);
    assert_eq!(s.events[0].text, "修复 bug");
    assert_eq!(s.events[1].text, "看一下入口文件。");
    assert_eq!(
        s.events[2].text,
        "tool_use · read · {\"path\":\"src/main.rs\"}"
    );
    // 结果卡与 claude 配对形态同构，前端同一套工具卡切片
    assert_eq!(s.events[3].text, "tool_result · read · 42 行");
    assert_eq!(s.events[3].tool_use_id.as_deref(), Some("call_1"));
}

/// 纯工具轮不再产出空泡（此前渲染出一串「助手 · 模型 · ↑0 ↓0」噪音行）；
/// usage 聚合不受事件入流影响
#[test]
fn pi_tool_call_only_assistant_has_no_empty_bubble() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [
                    { "type": "toolCall", "id": "call_1", "name": "bash",
                      "arguments": { "command": "ls" } }
                ],
                "usage": { "input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0 }
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["tool"]);
    // 聚合照常记账
    assert_eq!(s.tokens.output, 5);
}

/// 纯思考中断轮（实机形态：stopReason=aborted + 空 usage）→ 思考 + 中断提示，
/// 无空助手泡
#[test]
fn pi_thinking_only_aborted_turn() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [{ "type": "thinking", "thinking": "想想怎么做" }],
                "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0 },
                "stopReason": "aborted",
                "errorMessage": "Operation aborted"
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["thinking", "system"]);
    assert_eq!(
        s.events[1].text,
        "stop_reason · aborted · Operation aborted"
    );
}

/// aborted 且有工具调用：不出 stop_reason（失败由工具卡呈现，pi TUI 同语义）
#[test]
fn pi_aborted_with_tool_calls_no_stop_reason() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [
                    { "type": "toolCall", "id": "call_1", "name": "bash", "arguments": {} }
                ],
                "stopReason": "aborted",
                "errorMessage": "Operation aborted"
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["tool"]);
}

/// length：即使有正文也出截断提示（截断可能发生在工具调用完成前）
#[test]
fn pi_length_stop_always_flagged() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [{ "type": "text", "text": "写到一半" }],
                "stopReason": "length"
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["assistant", "system"]);
    assert_eq!(s.events[1].text, "stop_reason · length");
}

/// error 中断无 errorMessage：pi TUI 兜底文案 "Unknown error"
#[test]
fn pi_error_stop_fallback() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [],
                "stopReason": "error"
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["system"]);
    assert_eq!(s.events[0].text, "stop_reason · error · Unknown error");
}

/// 正常完成（stop/有工具调用的 toolUse 轮）不出 stop_reason
#[test]
fn pi_normal_stop_no_event() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [{ "type": "text", "text": "完成" }],
                "stopReason": "stop"
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["assistant"]);
}

/// 压缩摘要与分支接缝可见（此前整类条目静默丢失）
#[test]
fn pi_compaction_and_branch_summary_become_system_seams() {
    let content = format!(
        "{}\n{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "compaction",
            "timestamp": "2026-09-07T21:00:00.000Z",
            "summary": "之前讨论了 X 与 Y",
            "firstKeptEntryId": "e1"
        })
        .to_string(),
        json!({
            "type": "branch_summary",
            "timestamp": "2026-09-07T21:05:00.000Z",
            "fromId": "e2",
            "summary": "分支走了弯路"
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["system", "system"]);
    assert_eq!(s.events[0].text, "compaction · 之前讨论了 X 与 Y");
    assert_eq!(s.events[1].text, "branch_summary · 分支走了弯路");
}

/// custom_message：display=true 进对话视图，缺省/false 不进（官方语义）
#[test]
fn pi_custom_message_only_when_display_true() {
    let content = format!(
        "{}\n{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "custom_message",
            "timestamp": "2026-09-07T21:00:00.000Z",
            "customType": "my-ext",
            "content": "注入提示",
            "display": true
        })
        .to_string(),
        json!({
            "type": "custom_message",
            "timestamp": "2026-09-07T21:01:00.000Z",
            "customType": "my-ext",
            "content": "纯上下文注入"
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["system"]);
    assert_eq!(s.events[0].text, "custom_message · my-ext · 注入提示");
}

/// session_info.name（/name 自设名）覆盖首条 user 派生标题，与 pi /resume 同口径
#[test]
fn pi_session_info_name_overrides_title() {
    let content = format!(
        "{}\n{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:05.000Z",
            "message": { "role": "user", "content": "第一条消息" }
        })
        .to_string(),
        json!({
            "type": "session_info",
            "timestamp": "2026-09-07T20:56:00.000Z",
            "name": "重构认证模块"
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    assert_eq!(s.title.as_deref(), Some("重构认证模块"));
}

/// user 内容里的图片块给机器占位（此前静默消失）；纯图片消息仍有行
#[test]
fn pi_user_image_block_placeholder() {
    let content = format!(
        "{}\n{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:05.000Z",
            "message": {
                "role": "user",
                "content": [
                    { "type": "text", "text": "看这张图" },
                    { "type": "image", "source": { "type": "base64", "data": "AAAA" } }
                ]
            }
        })
        .to_string(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:55:05.000Z",
            "message": { "role": "user", "content": { "type": "image", "source": { "data": "BBBB" } } }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    assert_eq!(s.events.len(), 2);
    assert_eq!(s.events[0].text, "看这张图\n[non-text:image]");
    assert_eq!(s.events[1].text, "[non-text:image]");
    assert_eq!(s.events[1].role, "user");
}

/// redacted（只剩加密签名）与空 thinking 块不出事件
#[test]
fn pi_redacted_and_empty_thinking_skipped() {
    let content = format!(
        "{}\n{}\n",
        pi_session_header(),
        json!({
            "type": "message",
            "timestamp": "2026-09-07T20:54:10.000Z",
            "message": {
                "role": "assistant",
                "model": "m",
                "content": [
                    { "type": "thinking", "thinking": "", "thinkingSignature": "enc" },
                    { "type": "thinking", "thinking": "加密内容", "thinkingSignature": "enc", "redacted": true },
                    { "type": "text", "text": "回答" }
                ]
            }
        })
        .to_string()
    );
    let s = parse_pi_session(&content);
    let roles: Vec<&str> = s.events.iter().map(|e| e.role).collect();
    assert_eq!(roles, vec!["assistant"]);
    assert_eq!(s.events[0].text, "回答");
}
