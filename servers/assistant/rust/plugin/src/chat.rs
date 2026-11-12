//! 对话流式命令（票 08 / spec §3.2、§5.2）
//!
//! `assistant.chat-stream`：前端构建好 provider 请求（OpenAI 兼容方言在
//! `shared/providers/`，本模块不持有方言知识），本命令只做两件事：
//!
//! 1. **校验**：`method` / `url` / `stream: true` / `streamEvent` 齐备，且
//!    `streamEvent` 与命令声明的 `streamId` **精确匹配**（`assistant:stream:<id>`）——
//!    事件通道名与前端监听名不一致会静默丢消息，必须在触网前判死。
//! 2. **透传**：`WasmHost.http_fetch` raw 流式（`sseFormat` 缺省 = raw 模式），
//!    宿主立即返回 `{ streamId, streamEvent }`，逐 chunk 经事件通道推送
//!    （`{ chunk, done }` / `{ error, done }`），SSE 语义由前端解析。
//!
//! 失败语义（spec §2.4）：缺字段 / 不匹配 / 宿主拒绝 → 点名缺什么，不静默。

use serde_json::Value;

use wasmnest_plugin_api::host::HostHttp;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::WasmHost;

/// 流事件通道前缀（前端监听 `assistant:stream:<streamId>`）
pub const STREAM_EVENT_PREFIX: &str = "assistant:stream:";

/// 由 streamId 派生期望的事件通道名
pub fn stream_event_for(stream_id: &str) -> String {
    format!("{STREAM_EVENT_PREFIX}{stream_id}")
}

/// 校验流式请求（纯函数，native 单测可覆盖，不触网）
///
/// 返回校验通过的事件通道名；失败点名缺什么 / 哪里不匹配。
pub fn validate_chat_stream_request(stream_id: &str, request: &Value) -> Result<String, String> {
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if method.is_empty() {
        return Err("chat-stream: 请求缺 method".to_string());
    }
    let url = request.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return Err("chat-stream: 请求缺 url".to_string());
    }
    if request.get("stream").and_then(|v| v.as_bool()) != Some(true) {
        return Err("chat-stream: 请求缺 stream: true".to_string());
    }
    let stream_event = request
        .get("streamEvent")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if stream_event.is_empty() {
        return Err("chat-stream: 请求缺 streamEvent".to_string());
    }
    let expected = stream_event_for(stream_id);
    if stream_event != expected {
        return Err(format!(
            "chat-stream: streamEvent 与 streamId 不匹配: {stream_event} vs {expected}"
        ));
    }
    Ok(stream_event.to_string())
}

/// `assistant.chat-stream` 命令实现（wasm）
///
/// 入参：`{ streamId, request }`；返回宿主受理结果 `{ streamId, streamEvent }`。
#[cfg(target_arch = "wasm32")]
pub fn chat_stream(args: &Value) -> Result<Value, String> {
    let stream_id = args
        .get("streamId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "chat-stream: 缺参数 streamId".to_string())?;
    let request = args
        .get("request")
        .ok_or_else(|| "chat-stream: 缺参数 request".to_string())?
        .clone();

    validate_chat_stream_request(stream_id, &request)?;

    // 透传宿主：流式受理结果（逐 chunk 由事件通道推送，本命令不等待流结束）
    let host = WasmHost;
    let result = host
        .http_fetch(&request)
        .map_err(|e| format!("chat-stream: http_fetch 失败: {e}"))?
        .ok_or_else(|| "chat-stream: http_fetch 返回空结果".to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn valid_request_passes_and_echoes_event_name() {
        let req = json!({
            "method": "POST",
            "url": "https://api.example.com/v1/chat/completions",
            "stream": true,
            "streamEvent": "assistant:stream:s1",
        });
        let ev = validate_chat_stream_request("s1", &req).expect("合法请求须通过");
        assert_eq!(ev, "assistant:stream:s1");
    }

    #[test]
    fn missing_fields_are_named() {
        // 缺 method
        let no_method = json!({ "url": "u", "stream": true, "streamEvent": "e" });
        assert!(validate_chat_stream_request("s1", &no_method)
            .unwrap_err()
            .contains("method"));
        // 缺 url
        let no_url = json!({ "method": "POST", "stream": true, "streamEvent": "e" });
        assert!(validate_chat_stream_request("s1", &no_url)
            .unwrap_err()
            .contains("url"));
        // 缺 stream
        let no_stream = json!({ "method": "POST", "url": "u", "streamEvent": "e" });
        assert!(validate_chat_stream_request("s1", &no_stream)
            .unwrap_err()
            .contains("stream"));
        // 缺 streamEvent
        let no_event = json!({ "method": "POST", "url": "u", "stream": true });
        assert!(validate_chat_stream_request("s1", &no_event)
            .unwrap_err()
            .contains("streamEvent"));
    }

    #[test]
    fn stream_event_must_match_stream_id_exactly() {
        let req = json!({
            "method": "POST",
            "url": "https://api.example.com/v1/chat",
            "stream": true,
            "streamEvent": "assistant:stream:other",
        });
        let err = validate_chat_stream_request("s1", &req).unwrap_err();
        assert!(err.contains("不匹配"), "got: {err}");
        // 后缀相似但不相等同样拒绝（精确匹配，防 `s1` / `xs1` 误放行）
        let req2 = json!({
            "method": "POST",
            "url": "https://api.example.com/v1/chat",
            "stream": true,
            "streamEvent": "assistant:stream:xs1",
        });
        assert!(validate_chat_stream_request("s1", &req2).is_err());
    }
}
