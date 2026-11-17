//! 互调请求解析：`transcribe-submit` 的公开形状
//!
//! ```jsonc
//! {
//!   "audio": { "container": "wav", "sampleRate": 16000, "channels": 1, "dataBase64": "..." },
//!   "language": "auto",                    // auto | zh | en
//!   "preference": { "mode": "auto" },      // 只能覆盖 mode
//!   "contextPrompt": null,
//!   "callerTag": "bedcode"                 // 排障用，不参与路由
//! }
//! ```

use serde::Deserialize;
use serde_json::Value;

use crate::audio::AudioInput;
use crate::error::{Result, SpeechError};
use crate::settings::Mode;

/// 解析后的识别请求
#[derive(Debug, Clone)]
pub struct TranscribeInput {
    /// 音频输入
    pub audio: AudioInput,
    /// 语种（None = 用设置 / auto）
    pub language: Option<String>,
    /// 覆盖设置里的 mode
    pub mode_override: Option<Mode>,
    /// 透传给支持的后端
    pub prompt: Option<String>,
    /// 调用方自报标签（仅排障）
    pub caller_tag: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRequest {
    audio: AudioInput,
    language: Option<String>,
    preference: Option<Preference>,
    context_prompt: Option<String>,
    caller_tag: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preference {
    mode: Option<Mode>,
}

/// 解析并校验请求
pub fn parse_request(value: &Value) -> Result<TranscribeInput> {
    let raw: RawRequest = serde_json::from_value(value.clone())
        .map_err(|err| SpeechError::AudioInvalid(format!("invalid request: {err}")))?;
    let language = match raw.language {
        None => None,
        Some(language) => normalize_language(&language)?,
    };
    Ok(TranscribeInput {
        audio: raw.audio,
        language,
        mode_override: raw.preference.and_then(|preference| preference.mode),
        prompt: raw.context_prompt.filter(|value| !value.trim().is_empty()),
        caller_tag: raw.caller_tag.filter(|value| !value.trim().is_empty()),
    })
}

fn normalize_language(language: &str) -> Result<Option<String>> {
    let language = language.trim().to_ascii_lowercase();
    if language.is_empty() || language == "auto" {
        return Ok(None);
    }
    if !(2..=3).contains(&language.len()) || !language.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(SpeechError::InvalidSettings(format!(
            "language must be auto or a 2-3 letter ISO code, got {language:?}"
        )));
    }
    Ok(Some(language))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_request() -> Value {
        json!({
            "audio": {
                "container": "pcm",
                "sampleRate": 16000,
                "channels": 1,
                "dataBase64": "AAAAAA=="
            }
        })
    }

    #[test]
    fn parses_minimal_request() {
        let input = parse_request(&valid_request()).unwrap();
        assert_eq!(input.audio.container, "pcm");
        assert_eq!(input.language, None);
        assert_eq!(input.mode_override, None);
    }

    #[test]
    fn parses_language_and_mode_override() {
        let mut value = valid_request();
        value["language"] = json!("zh");
        value["preference"] = json!({ "mode": "local-only" });
        let input = parse_request(&value).unwrap();
        assert_eq!(input.language.as_deref(), Some("zh"));
        assert_eq!(input.mode_override, Some(Mode::LocalOnly));
    }

    #[test]
    fn auto_language_becomes_none() {
        let mut value = valid_request();
        value["language"] = json!("auto");
        assert_eq!(parse_request(&value).unwrap().language, None);
    }

    #[test]
    fn invalid_language_is_rejected() {
        let mut value = valid_request();
        value["language"] = json!("zhongwen");
        assert_eq!(
            parse_request(&value).unwrap_err().kind(),
            "invalid-settings"
        );
    }

    #[test]
    fn missing_audio_is_rejected() {
        assert!(parse_request(&json!({})).is_err());
    }
}