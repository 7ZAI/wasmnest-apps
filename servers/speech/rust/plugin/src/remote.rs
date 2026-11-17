//! 远端供应商（OpenAI 兼容 multipart）请求与响应归一
//!
//! 音频以 multipart 组装后经 `bodyBase64` 交给宿主发出（宿主把 JSON 字段解码为
//! 字节）；这避开了 host-http 只接受字符串 body 的限制，同时不改 WIT。
//! Key 只从 secret-store 读取，不进日志、不进请求记录。

use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostHttp, HostLog};
use wasmnest_plugin_api::WasmHost;

use wasmnest_speech_core::{encode_base64, AudioInput, SpeechError, SpeechSettings};

/// 远端结果
#[derive(Debug, Clone)]
pub struct RemoteOutcome {
    /// 全文
    pub text: String,
    /// 分段（camelCase JSON）
    pub segments: Vec<Value>,
    /// 语种
    pub language: Option<String>,
    /// 耗时
    pub elapsed_ms: u64,
}

/// 执行一次远端识别（同步；v1 不流式）
pub fn transcribe(
    settings: &SpeechSettings,
    audio: &AudioInput,
    language: Option<&str>,
    prompt: Option<&str>,
) -> Result<RemoteOutcome, SpeechError> {
    if !settings.remote.enabled {
        return Err(SpeechError::ProviderNotConfigured(
            "remote channel is disabled".to_string(),
        ));
    }
    let endpoint = settings.remote.endpoint.trim();
    if endpoint.is_empty() {
        return Err(SpeechError::ProviderNotConfigured(
            "remote endpoint is empty".to_string(),
        ));
    }
    let adapter = settings.remote.adapter.trim();
    if !(adapter.starts_with("openai") || adapter == "custom") {
        return Err(SpeechError::ProtocolMismatch(format!(
            "unsupported remote adapter: {adapter}"
        )));
    }
    let key = crate::settings::remote_key().ok_or_else(|| {
        SpeechError::ProviderNotConfigured("remote api key is not set".to_string())
    })?;
    let (bytes, filename, mime) = audio.to_remote_body()?;
    let started = std::time::Instant::now();

    let boundary = format!("----wasmnest-speech-{}", crate::records::now_ms());
    let mut body = Vec::with_capacity(bytes.len() + 512);
    push_field(&mut body, &boundary, "model", settings.remote.model.trim());
    if let Some(language) = language {
        push_field(&mut body, &boundary, "language", language);
    }
    if let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) {
        push_field(&mut body, &boundary, "prompt", prompt);
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let request = json!({
        "method": "POST",
        "url": endpoint,
        "headers": {
            "Authorization": format!("Bearer {key}"),
            "Content-Type": format!("multipart/form-data; boundary={boundary}"),
        },
        "bodyBase64": encode_base64(&body),
    });
    let envelope = WasmHost
        .http_fetch(&request)
        .map_err(|err| SpeechError::Network(format!("remote request failed: {err}")))?
        .ok_or_else(|| SpeechError::Network("remote request returned empty result".to_string()))?;
    let status = envelope
        .get("status")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u16;
    let response_body = envelope
        .get("body")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if !(200..300).contains(&status) {
        let summary = truncate(response_body, 200);
        return Err(match status {
            401 | 403 => SpeechError::AuthFailed(format!("HTTP {status}: {summary}")),
            429 => SpeechError::RateLimited(format!("HTTP {status}: {summary}")),
            408 | 500..=599 => SpeechError::ProviderError(format!("HTTP {status}: {summary}")),
            _ => SpeechError::ProviderError(format!("HTTP {status}: {summary}")),
        });
    }
    let parsed: Value = serde_json::from_str(response_body)
        .map_err(|err| SpeechError::ProtocolMismatch(format!("invalid JSON body: {err}")))?;
    let (text, segments) = parse_transcript(&parsed)?;
    let language = parsed
        .get("language")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| language.map(str::to_string));
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    WasmHost.log_info(&format!(
        "speech remote transcription ok: status={status} bytes={} chars={} elapsed_ms={elapsed_ms}",
        bytes.len(),
        text.chars().count()
    ));
    Ok(RemoteOutcome {
        text,
        segments,
        language,
        elapsed_ms,
    })
}

fn push_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(value.as_bytes());
    body.extend_from_slice(b"\r\n");
}

fn parse_transcript(parsed: &Value) -> Result<(String, Vec<Value>), SpeechError> {
    let segments = parsed
        .get("segments")
        .and_then(|value| value.as_array())
        .map(|segments| {
            segments
                .iter()
                .filter_map(|segment| {
                    let text = segment.get("text")?.as_str()?.trim().to_string();
                    if text.is_empty() {
                        return None;
                    }
                    let start_ms = segment
                        .get("startMs")
                        .and_then(|value| value.as_u64())
                        .or_else(|| {
                            segment
                                .get("start")
                                .and_then(|value| value.as_f64())
                                .map(|seconds| (seconds * 1000.0) as u64)
                        })
                        .unwrap_or(0);
                    let end_ms = segment
                        .get("endMs")
                        .and_then(|value| value.as_u64())
                        .or_else(|| {
                            segment
                                .get("end")
                                .and_then(|value| value.as_f64())
                                .map(|seconds| (seconds * 1000.0) as u64)
                        })
                        .unwrap_or(start_ms);
                    Some(json!({
                        "text": text,
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "isFinal": true,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let text = parsed
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            let joined = segments
                .iter()
                .filter_map(|segment| segment.get("text").and_then(|value| value.as_str()))
                .collect::<Vec<_>>()
                .join(" ");
            (!joined.trim().is_empty()).then_some(joined)
        })
        .ok_or_else(|| {
            SpeechError::ProtocolMismatch("response has neither text nor segments".to_string())
        })?;
    Ok((text, segments))
}

fn truncate(value: &str, max: usize) -> String {
    let mut out: String = value.chars().take(max).collect();
    if value.chars().count() > max {
        out.push('…');
    }
    out
}