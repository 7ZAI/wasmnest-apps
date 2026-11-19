//! 宿主原语的窄包装：host-stt / host-audio
//!
//! 直接调用平台 SDK 生成的 WIT import（组件绑定）；这里只做 JSON 形状归一与
//! 错误串转写，不引入第二套能力抽象。

use serde_json::{json, Value};

use wasmnest_plugin_api::wasm::wasmnest::audio::host_audio;
use wasmnest_plugin_api::wasm::wasmnest::stt::host_stt;

/// 模型清单（WIT 记录 → camelCase JSON）
pub fn models_list() -> Result<Vec<Value>, String> {
    let models = host_stt::models_list()?;
    Ok(models
        .into_iter()
        .map(|model| {
            json!({
                "id": model.id,
                "name": model.name,
                "description": model.description,
                "languages": model.languages,
                "sizeBytes": model.size_bytes,
                "installed": model.installed,
                "downloading": model.downloading,
                "recommended": model.recommended,
            })
        })
        .collect())
}

/// 是否至少有一个模型已安装
pub fn has_installed_model() -> Result<bool, String> {
    Ok(host_stt::models_list()?
        .into_iter()
        .any(|model| model.installed))
}

/// 模型是否已安装
pub fn is_model_installed(model_id: &str) -> Result<bool, String> {
    Ok(host_stt::models_list()?
        .into_iter()
        .any(|model| model.id == model_id && model.installed))
}

/// 下载模型，返回模型 id
pub fn model_download(model_id: &str) -> Result<String, String> {
    host_stt::model_download(model_id)
}

/// 删除模型
pub fn model_remove(model_id: &str) -> Result<bool, String> {
    host_stt::model_remove(model_id)
}

/// 模型下载状态（WIT 记录 → camelCase JSON）
pub fn model_status(model_id: &str) -> Result<Value, String> {
    let status = host_stt::model_status(model_id)?;
    Ok(json!({
        "modelId": status.model_id,
        "state": status.state,
        "downloadedBytes": status.downloaded_bytes,
        "totalBytes": status.total_bytes,
        "message": status.message,
    }))
}

/// 打开本地识别会话
pub fn open_session(options: &Value) -> Result<String, String> {
    host_stt::open_session(&options.to_string())
}

/// 追加 PCM
pub fn append(session_id: &str, pcm: &[u8]) -> Result<u64, String> {
    host_stt::append(session_id, pcm)
}

/// 提交任务
pub fn finalize(session_id: &str) -> Result<String, String> {
    host_stt::finalize(session_id)
}

/// 放弃会话
pub fn abort_session(session_id: &str) -> Result<bool, String> {
    host_stt::abort_session(session_id)
}

/// 任务状态 JSON
pub fn job_status(job_id: &str) -> Result<Value, String> {
    let raw = host_stt::job_status(job_id)?;
    serde_json::from_str(&raw).map_err(|err| format!("job-status decode: {err}"))
}

/// 任务结果 JSON
pub fn job_result(job_id: &str) -> Result<Value, String> {
    let raw = host_stt::job_result(job_id)?;
    serde_json::from_str(&raw).map_err(|err| format!("job-result decode: {err}"))
}

/// 取消任务
pub fn job_cancel(job_id: &str) -> Result<bool, String> {
    host_stt::job_cancel(job_id)
}

/// 打开一条 16 kHz 单声道采集流
pub fn audio_open() -> Result<String, String> {
    let config = json!({
        "targetSampleRate": 16_000,
        "targetChannels": 1,
    });
    host_audio::open(&config.to_string())
}

/// 开始采集
pub fn audio_start(stream_id: &str) -> Result<(), String> {
    host_audio::start(stream_id)
}

/// 停止采集
pub fn audio_stop(stream_id: &str) -> Result<(), String> {
    host_audio::stop(stream_id)
}

/// 关闭采集流
pub fn audio_close(stream_id: &str) -> Result<(), String> {
    host_audio::close(stream_id)
}

/// 拉取采集帧：`(pcm, next_offset, truncated)`
pub fn audio_fetch(stream_id: &str, from_offset: u64, max_bytes: u32) -> Result<(Vec<u8>, u64, bool), String> {
    let result = host_audio::ring_fetch(stream_id, from_offset, max_bytes)?;
    Ok((result.data, result.next_offset, result.truncated))
}

/// 电平快照 JSON（无完整窗口 → null）
pub fn audio_level(stream_id: &str) -> Result<Value, String> {
    let level = host_audio::level(stream_id)?;
    Ok(match level {
        Some(level) => json!({
            "rms": level.rms,
            "peak": level.peak,
            "windowSamples": level.window_samples,
        }),
        None => Value::Null,
    })
}