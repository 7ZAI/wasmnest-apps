//! 服务设置：通道模式 / 本地模型与语种 / 远端供应商
//!
//! 设置只存非敏感字段；远端 API Key 由插件走宿主 secret-store，绝不进本结构。

use serde::{Deserialize, Serialize};

use crate::error::{Result, SpeechError};

/// 通道模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// 只用本地宿主推理
    LocalOnly,
    /// 只用远端供应商
    RemoteOnly,
    /// 本地可用则本地，否则远端；本地失败不回退云端
    Auto,
}

impl Default for Mode {
    fn default() -> Self {
        Self::Auto
    }
}

impl Mode {
    /// 线协议字符串
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalOnly => "local-only",
            Self::RemoteOnly => "remote-only",
            Self::Auto => "auto",
        }
    }
}

/// 本地通道设置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettings {
    /// 是否启用
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 宿主 catalog 的模型 id
    #[serde(default = "default_model_id")]
    pub model_id: String,
    /// `auto` / `zh` / `en`
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_true() -> bool {
    true
}

fn default_model_id() -> String {
    "small".to_string()
}

fn default_language() -> String {
    "auto".to_string()
}

impl Default for LocalSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            model_id: default_model_id(),
            language: default_language(),
        }
    }
}

/// 远端供应商设置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSettings {
    /// 是否启用
    #[serde(default)]
    pub enabled: bool,
    /// OpenAI 兼容的 `/v1/audio/transcriptions` 端点
    #[serde(default)]
    pub endpoint: String,
    /// 适配器（v1 只实现 `openai-compatible`；`custom` 同形）
    #[serde(default = "default_adapter")]
    pub adapter: String,
    /// 模型名（供应商侧）
    #[serde(default = "default_remote_model")]
    pub model: String,
}

fn default_adapter() -> String {
    "openai-compatible".to_string()
}

fn default_remote_model() -> String {
    "whisper-1".to_string()
}

impl Default for RemoteSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: String::new(),
            adapter: default_adapter(),
            model: default_remote_model(),
        }
    }
}

/// 完整设置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSettings {
    /// 通道模式
    #[serde(default)]
    pub mode: Mode,
    /// 本地通道
    #[serde(default)]
    pub local: LocalSettings,
    /// 远端通道
    #[serde(default)]
    pub remote: RemoteSettings,
}

impl Default for SpeechSettings {
    fn default() -> Self {
        Self {
            mode: Mode::default(),
            local: LocalSettings::default(),
            remote: RemoteSettings::default(),
        }
    }
}

/// 本地设置补丁（字段缺省 = 不修改）
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPatch {
    pub enabled: Option<bool>,
    pub model_id: Option<String>,
    pub language: Option<String>,
}

/// 远端设置补丁（字段缺省 = 不修改）
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePatch {
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    pub adapter: Option<String>,
    pub model: Option<String>,
}

/// 设置补丁（含一次性的 API Key 写入；Key 不落设置 blob）
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub mode: Option<Mode>,
    pub local: Option<LocalPatch>,
    pub remote: Option<RemotePatch>,
    /// 缺省 = 不改 Key；空串 = 删除；非空 = 覆盖
    pub api_key: Option<String>,
}

impl SettingsPatch {
    /// 合并到现有设置并校验
    pub fn apply(&self, base: &SpeechSettings) -> Result<SpeechSettings> {
        let mut next = base.clone();
        if let Some(mode) = self.mode {
            next.mode = mode;
        }
        if let Some(local) = &self.local {
            if let Some(enabled) = local.enabled {
                next.local.enabled = enabled;
            }
            if let Some(model_id) = &local.model_id {
                next.local.model_id = model_id.trim().to_string();
            }
            if let Some(language) = &local.language {
                next.local.language = normalize_language(language)?;
            }
        }
        if let Some(remote) = &self.remote {
            if let Some(enabled) = remote.enabled {
                next.remote.enabled = enabled;
            }
            if let Some(endpoint) = &remote.endpoint {
                next.remote.endpoint = endpoint.trim().to_string();
            }
            if let Some(adapter) = &remote.adapter {
                next.remote.adapter = adapter.trim().to_string();
            }
            if let Some(model) = &remote.model {
                next.remote.model = model.trim().to_string();
            }
        }
        validate(&next)?;
        Ok(next)
    }

    /// API Key 写入意图（由插件处理；本结构不持久化 Key）
    pub fn api_key(&self) -> Option<&str> {
        self.api_key.as_deref()
    }
}

/// 校验设置
pub fn validate(settings: &SpeechSettings) -> Result<()> {
    if settings.local.enabled && settings.local.model_id.trim().is_empty() {
        return Err(SpeechError::InvalidSettings(
            "local model id must not be empty when local channel is enabled".to_string(),
        ));
    }
    normalize_language(&settings.local.language)?;
    if settings.remote.enabled {
        let endpoint = settings.remote.endpoint.trim();
        if endpoint.is_empty() {
            return Err(SpeechError::InvalidSettings(
                "remote endpoint must not be empty when remote channel is enabled".to_string(),
            ));
        }
        if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
            return Err(SpeechError::InvalidSettings(
                "remote endpoint must be an http(s) URL".to_string(),
            ));
        }
        if settings.remote.model.trim().is_empty() {
            return Err(SpeechError::InvalidSettings(
                "remote model must not be empty".to_string(),
            ));
        }
        if settings.remote.adapter.trim().is_empty() {
            return Err(SpeechError::InvalidSettings(
                "remote adapter must not be empty".to_string(),
            ));
        }
    }
    Ok(())
}

fn normalize_language(language: &str) -> Result<String> {
    let language = language.trim().to_ascii_lowercase();
    if language.is_empty() || language == "auto" {
        return Ok("auto".to_string());
    }
    if !(2..=3).contains(&language.len()) || !language.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(SpeechError::InvalidSettings(format!(
            "language must be auto or a 2-3 letter ISO code, got {language:?}"
        )));
    }
    Ok(language)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_local_first_but_remote_disabled() {
        let settings = SpeechSettings::default();
        assert_eq!(settings.mode, Mode::Auto);
        assert!(settings.local.enabled);
        assert_eq!(settings.local.model_id, "small");
        assert_eq!(settings.local.language, "auto");
        assert!(!settings.remote.enabled);
    }

    #[test]
    fn patch_merges_without_touching_other_fields() {
        let base = SpeechSettings::default();
        let patch: SettingsPatch = serde_json::from_value(json!({
            "remote": { "enabled": false, "endpoint": "https://api.example.com/v1/audio/transcriptions", "model": "whisper-1" }
        }))
        .unwrap();
        let next = patch.apply(&base).unwrap();
        assert_eq!(next.local, base.local);
        assert_eq!(next.remote.endpoint, "https://api.example.com/v1/audio/transcriptions");
        assert!(!next.remote.enabled);
    }

    #[test]
    fn enabling_remote_without_endpoint_is_rejected() {
        let base = SpeechSettings::default();
        let patch: SettingsPatch = serde_json::from_value(json!({
            "remote": { "enabled": true }
        }))
        .unwrap();
        assert_eq!(patch.apply(&base).unwrap_err().kind(), "invalid-settings");
    }

    #[test]
    fn invalid_language_is_rejected() {
        let base = SpeechSettings::default();
        let patch: SettingsPatch = serde_json::from_value(json!({
            "local": { "language": "中文" }
        }))
        .unwrap();
        assert_eq!(patch.apply(&base).unwrap_err().kind(), "invalid-settings");
    }

    #[test]
    fn api_key_is_a_write_intent_not_a_setting() {
        let patch: SettingsPatch = serde_json::from_value(json!({ "apiKey": "sk-123" })).unwrap();
        assert_eq!(patch.api_key(), Some("sk-123"));
        let serialized = serde_json::to_value(SpeechSettings::default()).unwrap();
        assert!(serialized.get("apiKey").is_none());
    }
}