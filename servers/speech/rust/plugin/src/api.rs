//! 服务对外互调 API（`plugin.json.api`）+ 内部命令复用
//!
//! 互调与页面命令共用同一批内部函数，避免两套语义漂移；`#[plugin_api]` 在编译期
//! 比对 manifest 的 api 声明。

use serde_json::{json, Value};
use wasmnest_plugin_api::host::HostBus;
use wasmnest_plugin_api::plugin_api;

use wasmnest_speech_core::{
    choose_channel, parse_request, Channel, SettingsPatch, SpeechError, SpeechSettings,
};

use crate::host;
use crate::jobs;
use crate::records;
use crate::remote;
use crate::settings as service_settings;
use crate::SpeechPlugin;

fn err(err: SpeechError) -> String {
    format!("{}: {}", err.kind(), err)
}

/// 读取设置（密钥只回 hasKey）
pub fn settings_get() -> Result<Value, String> {
    let settings = service_settings::load();
    Ok(service_settings::view(&settings))
}

/// 合并设置补丁并写入（可选写入/清除远端 Key）
pub fn settings_set(patch: Value) -> Result<Value, String> {
    let patch: SettingsPatch = serde_json::from_value(patch)
        .map_err(|err| format!("invalid-settings: {err}"))?;
    let base = service_settings::load();
    let next = patch.apply(&base).map_err(err)?;
    service_settings::apply_remote_key(patch.api_key())
        .map_err(|message| format!("auth-failed: {message}"))?;
    service_settings::save(&next)?;
    Ok(service_settings::view(&next))
}

/// 模型清单
pub fn models_list() -> Result<Value, String> {
    Ok(json!({ "models": host::models_list()? }))
}

/// 下载模型并回当前状态
pub fn models_download(model_id: &str) -> Result<Value, String> {
    host::model_download(model_id)?;
    host::model_status(model_id)
}

/// 删除模型
pub fn models_remove(model_id: &str) -> Result<Value, String> {
    let removed = host::model_remove(model_id)?;
    Ok(json!({ "modelId": model_id, "removed": removed }))
}

/// 通道可用性（不发真实请求，避免页面打开就触网）
pub fn channels_probe() -> Result<Value, String> {
    let settings = service_settings::load();
    let local_ready = settings.local.enabled
        && host::is_model_installed(&settings.local.model_id).unwrap_or(false);
    let remote_ready = settings.remote.enabled
        && !settings.remote.endpoint.trim().is_empty()
        && service_settings::has_remote_key();
    Ok(json!({
        "channels": [
            {
                "channel": "local",
                "available": local_ready,
                "reason": if local_ready { Value::Null } else {
                    Value::String(if settings.local.enabled {
                        format!("model not installed: {}", settings.local.model_id)
                    } else {
                        "local channel disabled".to_string()
                    })
                },
            },
            {
                "channel": "remote",
                "available": remote_ready,
                "reason": if remote_ready { Value::Null } else {
                    Value::String("remote provider disabled or missing endpoint/key".to_string())
                },
            },
        ],
    }))
}

/// 记录列表
pub fn records_list(limit: Option<Value>) -> Vec<Value> {
    let limit = limit
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.get("limit").and_then(|inner| inner.as_u64()))
        })
        .unwrap_or(50)
        .min(records::MAX_RECORDS as u64) as usize;
    records::list(limit)
}

/// 提交识别任务
pub fn submit(request: Value) -> Result<Value, String> {
    let input = parse_request(&request).map_err(err)?;
    let settings = service_settings::load();
    let local_ready = settings.local.enabled
        && host::is_model_installed(&settings.local.model_id).unwrap_or(false);
    let remote_ready = settings.remote.enabled
        && !settings.remote.endpoint.trim().is_empty()
        && service_settings::has_remote_key();
    let channel = choose_channel(&settings, input.mode_override, local_ready, remote_ready)
        .map_err(err)?;
    let language = input.language.clone().or_else(|| {
        let language = settings.local.language.clone();
        (language != "auto").then_some(language)
    });

    match channel {
        Channel::Local => submit_local(&settings, &input, language),
        Channel::Remote => submit_remote(&settings, &input, language),
    }
}

fn submit_local(
    settings: &SpeechSettings,
    input: &wasmnest_speech_core::TranscribeInput,
    language: Option<String>,
) -> Result<Value, String> {
    let pcm = input.audio.to_local_pcm().map_err(err)?;
    if !host::is_model_installed(&settings.local.model_id).unwrap_or(false) {
        return Err(format!(
            "model-not-installed: {}",
            settings.local.model_id
        ));
    }
    let session = host::open_session(&json!({
        "modelId": settings.local.model_id,
        "language": language.clone().unwrap_or_else(|| "auto".to_string()),
        "prompt": input.prompt,
    }))
    .map_err(|message| format!("local-session: {message}"))?;
    for chunk in pcm.chunks(256 * 1024) {
        if let Err(message) = host::append(&session, chunk) {
            let _ = host::abort_session(&session);
            return Err(format!("local-append: {message}"));
        }
    }
    let host_job = match host::finalize(&session) {
        Ok(job) => job,
        Err(message) => {
            let _ = host::abort_session(&session);
            return Err(format!("local-finalize: {message}"));
        }
    };
    let job = jobs::insert_local(
        host_job,
        settings.local.model_id.clone(),
        language.clone(),
        pcm.len() as u64,
        input.caller_tag.clone(),
    );
    Ok(json!({
        "jobId": job,
        "channel": "local",
        "state": "running",
        "modelId": settings.local.model_id,
        "language": language,
    }))
}

fn submit_remote(
    settings: &SpeechSettings,
    input: &wasmnest_speech_core::TranscribeInput,
    language: Option<String>,
) -> Result<Value, String> {
    let audio_bytes = input.audio.decode().map(|bytes| bytes.len() as u64).map_err(err)?;
    match remote::transcribe(
        settings,
        &input.audio,
        language.as_deref(),
        input.prompt.as_deref(),
    ) {
        Ok(outcome) => {
            let job = jobs::insert_remote(
                "completed",
                settings.remote.model.clone(),
                outcome.language,
                outcome.text,
                outcome.segments,
                None,
                outcome.elapsed_ms,
                audio_bytes,
                input.caller_tag.clone(),
            );
            jobs::status(&job)
        }
        Err(error) => {
            let job = jobs::insert_remote(
                "failed",
                settings.remote.model.clone(),
                language,
                String::new(),
                Vec::new(),
                Some((error.kind().to_string(), error.to_string())),
                0,
                audio_bytes,
                input.caller_tag.clone(),
            );
            jobs::status(&job)
        }
    }
}

/// 查询任务（本地任务会同步 host-stt 状态）
pub fn result(job_id: &str) -> Result<Value, String> {
    jobs::status(job_id)
}

/// 取消任务
pub fn cancel(job_id: &str) -> Result<Value, String> {
    jobs::cancel(job_id)
}

/// 对外互调契约（callee 侧声明；`#[plugin_api]` 编译期比对 manifest）
#[plugin_api(manifest = "../../desktop/plugin.json")]
pub trait SpeechApi {
    /// 提交识别任务
    #[api("transcribe-submit")]
    fn transcribe_submit(request: Value) -> Result<Value, String>;

    /// 查询任务
    #[api("transcribe-result")]
    fn transcribe_result(job_id: String) -> Result<Value, String>;

    /// 取消任务
    #[api("transcribe-cancel")]
    fn transcribe_cancel(job_id: String) -> Result<Value, String>;

    /// 读取设置
    #[api("settings-get")]
    fn settings_get() -> Result<Value, String>;

    /// 写入设置
    #[api("settings-set")]
    fn settings_set(patch: Value) -> Result<Value, String>;

    /// 模型清单
    #[api("models-list")]
    fn models_list() -> Result<Value, String>;

    /// 下载模型
    #[api("models-download")]
    fn models_download(model_id: String) -> Result<Value, String>;

    /// 删除模型
    #[api("models-remove")]
    fn models_remove(model_id: String) -> Result<Value, String>;

    /// 通道探测
    #[api("channels-probe")]
    fn channels_probe() -> Result<Value, String>;

    /// 记录列表
    #[api("records-list")]
    fn records_list(limit: Value) -> Result<Value, String>;
}

impl SpeechApi for SpeechPlugin {
    fn transcribe_submit(request: Value) -> Result<Value, String> {
        submit(request)
    }

    fn transcribe_result(job_id: String) -> Result<Value, String> {
        result(&job_id)
    }

    fn transcribe_cancel(job_id: String) -> Result<Value, String> {
        cancel(&job_id)
    }

    fn settings_get() -> Result<Value, String> {
        settings_get()
    }

    fn settings_set(patch: Value) -> Result<Value, String> {
        settings_set(patch)
    }

    fn models_list() -> Result<Value, String> {
        models_list()
    }

    fn models_download(model_id: String) -> Result<Value, String> {
        models_download(&model_id)
    }

    fn models_remove(model_id: String) -> Result<Value, String> {
        models_remove(&model_id)
    }

    fn channels_probe() -> Result<Value, String> {
        channels_probe()
    }

    fn records_list(limit: Value) -> Result<Value, String> {
        Ok(Value::Array(records_list(Some(limit))))
    }
}