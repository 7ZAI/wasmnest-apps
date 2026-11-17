//! 服务设置与远端密钥的宿主读写
//!
//! 非敏感设置落插件 KV；远端 API Key 只走桌面 secret-store（`auth` 权限），
//! 不进设置 blob、不回传明文、不落日志。

use serde_json::Value;
use wasmnest_plugin_api::host::{HostAuth, HostLog, HostStorage};
use wasmnest_plugin_api::WasmHost;

use wasmnest_speech_core::SpeechSettings;

/// 设置 KV 键
pub const SETTINGS_KEY: &str = "speech.settings";

/// 远端密钥在 secret-store 的键
pub const REMOTE_KEY: &str = "speech.remote.key";

/// 加密密钥存在性（不返回值）
pub fn has_remote_key() -> bool {
    match WasmHost.auth_secret_keys() {
        Ok(keys) => keys.iter().any(|key| key == REMOTE_KEY),
        Err(err) => {
            WasmHost.log_warn(&format!("speech: secret-store unavailable: {err}"));
            false
        }
    }
}

/// 读取远端密钥（不落日志）
pub fn remote_key() -> Option<String> {
    match WasmHost.auth_secret_get(REMOTE_KEY) {
        Ok(value) => value,
        Err(err) => {
            WasmHost.log_warn(&format!("speech: read remote key failed: {err}"));
            None
        }
    }
}

/// 写入 / 删除远端密钥（`None` = 不修改；空串 = 删除）
pub fn apply_remote_key(patch: Option<&str>) -> Result<(), String> {
    match patch {
        None => Ok(()),
        Some("") => WasmHost
            .auth_secret_delete(REMOTE_KEY)
            .map_err(|err| format!("delete remote key: {err}")),
        Some(value) => WasmHost
            .auth_secret_set(REMOTE_KEY, value)
            .map_err(|err| format!("save remote key: {err}")),
    }
}

/// 读取设置（损坏时回落默认并留痕）
pub fn load() -> SpeechSettings {
    match WasmHost.storage_get(SETTINGS_KEY) {
        Ok(Some(value)) => serde_json::from_value::<SpeechSettings>(value).unwrap_or_else(|err| {
            WasmHost.log_warn(&format!("speech: settings unreadable, using defaults: {err}"));
            SpeechSettings::default()
        }),
        Ok(None) => SpeechSettings::default(),
        Err(err) => {
            WasmHost.log_warn(&format!("speech: storage read failed, using defaults: {err}"));
            SpeechSettings::default()
        }
    }
}

/// 保存设置
pub fn save(settings: &SpeechSettings) -> Result<(), String> {
    let value: Value = serde_json::to_value(settings).map_err(|err| format!("serialize settings: {err}"))?;
    WasmHost
        .storage_set(SETTINGS_KEY, &value)
        .map_err(|err| format!("save settings: {err}"))
}

/// 设置视图（不含密钥明文）
pub fn view(settings: &SpeechSettings) -> Value {
    serde_json::json!({
        "settings": settings,
        "hasKey": has_remote_key(),
    })
}