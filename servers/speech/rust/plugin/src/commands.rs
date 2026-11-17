//! 页面命令面（`invoke_command` 分派）
//!
//! 与互调 API 共用内部函数；命令名进 `plugin.json.contributes.commands`。

use anyhow::anyhow;
use serde_json::Value;

use crate::api;
use crate::capture;
use crate::host;
use crate::settings as service_settings;

/// 分派页面命令
pub fn dispatch(name: &str, args: Value) -> anyhow::Result<Value> {
    match name {
        "speech.settings-get" => api::settings_get().map_err(anyhow::Error::msg),
        "speech.settings-set" => api::settings_set(args).map_err(anyhow::Error::msg),
        "speech.models-list" => api::models_list().map_err(anyhow::Error::msg),
        "speech.model-download" => {
            let model_id = arg_str(&args, "modelId")?;
            api::models_download(model_id).map_err(anyhow::Error::msg)
        }
        "speech.model-status" => {
            let model_id = arg_str(&args, "modelId")?;
            host::model_status(model_id).map_err(anyhow::Error::msg)
        }
        "speech.model-remove" => {
            let model_id = arg_str(&args, "modelId")?;
            api::models_remove(model_id).map_err(anyhow::Error::msg)
        }
        "speech.records-list" => {
            let limit = args.get("limit").cloned();
            Ok(Value::Array(api::records_list(limit)))
        }
        "speech.channels-probe" => api::channels_probe().map_err(anyhow::Error::msg),
        "speech.job-result" => {
            let job_id = arg_str(&args, "jobId")?;
            api::result(job_id).map_err(anyhow::Error::msg)
        }
        "speech.job-cancel" => {
            let job_id = arg_str(&args, "jobId")?;
            api::cancel(job_id).map_err(anyhow::Error::msg)
        }
        "speech.test-submit" => api::submit(args).map_err(anyhow::Error::msg),
        "speech.capture-start" => {
            let settings = service_settings::load();
            capture::start(&settings).map_err(anyhow::Error::msg)
        }
        "speech.capture-pull" => capture::pull().map_err(anyhow::Error::msg),
        "speech.capture-stop" => capture::stop().map_err(anyhow::Error::msg),
        "speech.capture-abort" => capture::abort()
            .map(Value::Bool)
            .map_err(anyhow::Error::msg),
        other => Err(anyhow!("unknown command: {other}")),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    args.get(key)
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("missing string argument: {key}"))
}