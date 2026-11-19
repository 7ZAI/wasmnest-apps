//! 服务页内诊断录音：host-audio 采集 → host-stt 会话
//!
//! 只有服务自己的 UI 能开麦（互调 API 不暴露远程触发）；录音状态住 wasm 内存，
//! 停用 / 关闭时显式回收。

use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::WasmHost;

use wasmnest_speech_core::{SpeechError, SpeechSettings};

use crate::host;
use crate::jobs;

const FETCH_CHUNK: u32 = 64 * 1024;
const DRAIN_ROUNDS: usize = 256;

#[derive(Debug, Clone)]
struct CaptureState {
    stream_id: String,
    session_id: String,
    offset: u64,
    bytes: u64,
    model_id: String,
    language: String,
}

static CAPTURE: OnceLock<Mutex<Option<CaptureState>>> = OnceLock::new();

fn capture() -> &'static Mutex<Option<CaptureState>> {
    CAPTURE.get_or_init(|| Mutex::new(None))
}

fn lock() -> std::sync::MutexGuard<'static, Option<CaptureState>> {
    capture().lock().unwrap_or_else(|err| err.into_inner())
}

/// 开始诊断录音
pub fn start(settings: &SpeechSettings) -> Result<Value, String> {
    if !settings.local.enabled {
        return Err(format!(
            "{}: local channel is disabled",
            SpeechError::NoChannel("local channel is disabled".to_string()).kind()
        ));
    }
    if !host::is_model_installed(&settings.local.model_id)? {
        return Err("model-not-installed: 请先在模型页下载所选模型".to_string());
    }
    if lock().is_some() {
        return Err("capture-already-running: 已有录音在进行".to_string());
    }

    let stream_id = host::audio_open()?;
    if let Err(err) = host::audio_start(&stream_id) {
        let _ = host::audio_close(&stream_id);
        return Err(err);
    }
    let session = host::open_session(&json!({
        "modelId": settings.local.model_id,
        "language": settings.local.language,
    }));
    let session_id = match session {
        Ok(session_id) => session_id,
        Err(err) => {
            let _ = host::audio_stop(&stream_id);
            let _ = host::audio_close(&stream_id);
            return Err(err);
        }
    };
    *lock() = Some(CaptureState {
        stream_id: stream_id.clone(),
        session_id,
        offset: 0,
        bytes: 0,
        model_id: settings.local.model_id.clone(),
        language: settings.local.language.clone(),
    });
    WasmHost.log_info("speech capture started (diagnostic)");
    Ok(json!({
        "streamId": stream_id,
        "modelId": settings.local.model_id,
        "language": settings.local.language,
    }))
}

/// 拉取并追加一段 PCM，返回进度与电平
pub fn pull() -> Result<Value, String> {
    let snapshot = lock()
        .clone()
        .ok_or_else(|| "capture-not-running: 没有正在进行的录音".to_string())?;
    let (pcm, next_offset, truncated) = host::audio_fetch(&snapshot.stream_id, snapshot.offset, FETCH_CHUNK)?;
    let mut accepted = snapshot.bytes;
    let mut offset = next_offset;
    if !pcm.is_empty() {
        accepted = host::append(&snapshot.session_id, &pcm)?;
        offset = next_offset;
        if truncated {
            WasmHost.log_warn("speech capture ring truncated: audio lost before this pull");
        }
        if let Some(state) = lock().as_mut() {
            state.offset = offset;
            state.bytes = accepted;
        }
    }
    let level = host::audio_level(&snapshot.stream_id).unwrap_or(Value::Null);
    Ok(json!({
        "offset": offset,
        "bytes": accepted,
        "level": level,
        "truncated": truncated,
    }))
}

/// 停止录音、排空帧环并提交本地识别任务
pub fn stop() -> Result<Value, String> {
    let state = lock()
        .take()
        .ok_or_else(|| "capture-not-running: 没有正在进行的录音".to_string())?;
    let mut offset = state.offset;
    let mut accepted = state.bytes;
    for _ in 0..DRAIN_ROUNDS {
        let (pcm, next_offset, truncated) = host::audio_fetch(&state.stream_id, offset, FETCH_CHUNK)?;
        if pcm.is_empty() {
            break;
        }
        accepted = host::append(&state.session_id, &pcm)?;
        offset = next_offset;
        if truncated {
            WasmHost.log_warn("speech capture ring truncated while draining");
            break;
        }
    }
    let _ = host::audio_stop(&state.stream_id);
    let _ = host::audio_close(&state.stream_id);
    let host_job = host::finalize(&state.session_id).map_err(|err| {
        let _ = host::abort_session(&state.session_id);
        err
    })?;
    let job = jobs::insert_local(
        host_job,
        state.model_id.clone(),
        Some(state.language.clone()).filter(|language| language != "auto"),
        accepted,
        None,
    );
    WasmHost.log_info(&format!("speech capture stopped: job={job} bytes={accepted}"));
    Ok(json!({
        "jobId": job,
        "channel": "local",
        "state": "running",
        "modelId": state.model_id,
        "audioBytes": accepted,
    }))
}

/// 放弃录音（不创建任务）
pub fn abort() -> Result<bool, String> {
    let Some(state) = lock().take() else {
        return Ok(false);
    };
    let _ = host::abort_session(&state.session_id);
    let _ = host::audio_stop(&state.stream_id);
    let _ = host::audio_close(&state.stream_id);
    WasmHost.log_info("speech capture aborted");
    Ok(true)
}