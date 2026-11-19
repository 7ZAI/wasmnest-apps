//! Speech 服务插件（WASM，wasm32-wasip3）
//!
//! 给平台内其他应用提供「音频字节 → 文本」的识别服务：
//! - 本地：宿主 `host-stt`（whisper.cpp）异步任务；
//! - 远端：OpenAI 兼容 multipart（经 `host-http` 的 `bodyBase64`）；
//! - 互调面在 [`api`]，页面命令在 [`commands`]；
//! - 诊断录音在 [`capture`]，只允许服务自己的 UI 触发。

mod api;
mod capture;
mod commands;
mod host;
mod jobs;
mod records;
mod remote;
mod settings;

use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{BusMessage, WasmHost, WasmPlugin};

use wasmnest_plugin_api::host::HostLog;

/// 服务插件
pub struct SpeechPlugin;

impl WasmPlugin for SpeechPlugin {
    const ID: &'static str = "com.wasmnest.speech";

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../../desktop/plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        // 互调 api 面：订阅本 trait 声明的全部请求 topic。失败即激活失败——
        // 订不到就是「调用方永远等不到回执」的静默断裂。
        api::SpeechApiDispatcher::register()?;
        let settings = settings::load();
        let has_model = host::has_installed_model().unwrap_or(false);
        WasmHost.log_info(&format!(
            "speech activated: mode={} local_model={} local_installed={} remote_enabled={} remote_key={}",
            settings.mode.as_str(),
            settings.local.model_id,
            has_model,
            settings.remote.enabled,
            settings::has_remote_key()
        ));
        Ok(())
    }

    fn deactivate() -> anyhow::Result<()> {
        let _ = capture::abort();
        WasmHost.log_info("speech deactivated");
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        commands::dispatch(name, args)
    }

    fn on_message(msg: &BusMessage) -> anyhow::Result<()> {
        api::SpeechApiDispatcher::dispatch::<Self>(msg)?;
        Ok(())
    }
}

wasmnest_plugin_api::wasm_entry!(SpeechPlugin);