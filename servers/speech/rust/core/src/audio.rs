//! 音频输入的形状校验与容器处理
//!
//! - 本地推理只接受 16 kHz 单声道 S16LE（裸 PCM 或 PCM WAV）；
//! - 远端供应商接受 WAV / MP3 / M4A / WEBM / OGG 原始字节；裸 PCM 包一层 WAV；
//! - 单次原始字节上限 [`MAX_AUDIO_BYTES`]（base64 膨胀 + 64 MiB wasm 内存余量）。

use base64::Engine as _;
use serde::Deserialize;

use crate::error::{Result, SpeechError};

/// 单次识别原始音频字节上限（8 MiB）
pub const MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;

/// 固定采样率（本地归一目标）
pub const SAMPLE_RATE: u32 = 16_000;

/// 固定声道数（本地归一目标）
pub const CHANNELS: u16 = 1;

/// 直连接收的音频输入
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInput {
    /// 容器：`wav` / `mp3` / `m4a` / `webm` / `ogg` / `pcm`
    #[serde(default = "default_container")]
    pub container: String,
    /// 裸 PCM 必须给；WAV 由头部提供
    pub sample_rate: Option<u32>,
    /// 裸 PCM 必须给；WAV 由头部提供
    pub channels: Option<u16>,
    /// 原始字节（base64）
    #[serde(default)]
    pub data_base64: String,
}

fn default_container() -> String {
    "wav".to_string()
}

impl AudioInput {
    /// 解码并做体积/容器基础校验
    pub fn decode(&self) -> Result<Vec<u8>> {
        let bytes = decode_base64(&self.data_base64)?;
        if bytes.is_empty() {
            return Err(SpeechError::AudioInvalid("audio is empty".to_string()));
        }
        if bytes.len() > MAX_AUDIO_BYTES {
            return Err(SpeechError::AudioTooLarge {
                bytes: bytes.len(),
                limit: MAX_AUDIO_BYTES,
            });
        }
        let container = self.container.trim().to_ascii_lowercase();
        match container.as_str() {
            "wav" | "mp3" | "m4a" | "webm" | "ogg" | "pcm" => Ok(bytes),
            other => Err(SpeechError::AudioInvalid(format!(
                "unsupported audio container: {other}"
            ))),
        }
    }

    /// 归一为本地推理需要的 16 kHz 单声道 S16LE
    pub fn to_local_pcm(&self) -> Result<Vec<u8>> {
        let bytes = self.decode()?;
        let container = self.container.trim().to_ascii_lowercase();
        match container.as_str() {
            "wav" => parse_pcm_wav(&bytes),
            "pcm" => {
                let sample_rate = self.sample_rate.unwrap_or(SAMPLE_RATE);
                let channels = self.channels.unwrap_or(CHANNELS);
                validate_pcm_shape(&bytes, sample_rate, channels)?;
                Ok(bytes)
            }
            _ => Err(SpeechError::AudioUnsupportedLocal(format!(
                "local inference accepts wav or pcm, got {container}"
            ))),
        }
    }

    /// 远端供应商的 (字节, 文件名, MIME)
    pub fn to_remote_body(&self) -> Result<(Vec<u8>, String, &'static str)> {
        let bytes = self.decode()?;
        let container = self.container.trim().to_ascii_lowercase();
        match container.as_str() {
            "wav" => Ok((bytes, "audio.wav".to_string(), "audio/wav")),
            "mp3" => Ok((bytes, "audio.mp3".to_string(), "audio/mpeg")),
            "m4a" => Ok((bytes, "audio.m4a".to_string(), "audio/mp4")),
            "webm" => Ok((bytes, "audio.webm".to_string(), "audio/webm")),
            "ogg" => Ok((bytes, "audio.ogg".to_string(), "audio/ogg")),
            "pcm" => {
                let sample_rate = self.sample_rate.unwrap_or(SAMPLE_RATE);
                let channels = self.channels.unwrap_or(CHANNELS);
                validate_pcm_shape(&bytes, sample_rate, channels)?;
                Ok((
                    wrap_pcm_as_wav(&bytes, sample_rate, channels),
                    "audio.wav".to_string(),
                    "audio/wav",
                ))
            }
            other => Err(SpeechError::AudioInvalid(format!(
                "unsupported audio container: {other}"
            ))),
        }
    }
}

/// 校验裸 PCM 的形状（16 kHz / 单声道 / 偶数长度）
pub fn validate_pcm_shape(bytes: &[u8], sample_rate: u32, channels: u16) -> Result<()> {
    if sample_rate != SAMPLE_RATE {
        return Err(SpeechError::AudioInvalid(format!(
            "pcm sample rate must be {SAMPLE_RATE} Hz, got {sample_rate}"
        )));
    }
    if channels != CHANNELS {
        return Err(SpeechError::AudioInvalid(format!(
            "pcm channels must be {CHANNELS}, got {channels}"
        )));
    }
    if bytes.len() % 2 != 0 {
        return Err(SpeechError::AudioInvalid(
            "pcm byte length must be even for s16le".to_string(),
        ));
    }
    Ok(())
}

/// 从 WAV 中提取 16 kHz 单声道 S16LE PCM（只接受 PCM / 16-bit）
pub fn parse_pcm_wav(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(SpeechError::AudioInvalid("not a RIFF/WAVE file".to_string()));
    }
    let mut fmt: Option<(u32, u16, u16)> = None;
    let mut data: Option<&[u8]> = None;
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let body_start = offset + 8;
        let body_end = body_start
            .checked_add(size)
            .ok_or_else(|| SpeechError::AudioInvalid("wav chunk size overflow".to_string()))?;
        if body_end > bytes.len() {
            return Err(SpeechError::AudioInvalid(
                "wav chunk exceeds file length".to_string(),
            ));
        }
        match id {
            b"fmt " => {
                if size < 16 {
                    return Err(SpeechError::AudioInvalid("wav fmt chunk too short".to_string()));
                }
                let format = u16::from_le_bytes([bytes[body_start], bytes[body_start + 1]]);
                let channels = u16::from_le_bytes([bytes[body_start + 2], bytes[body_start + 3]]);
                let sample_rate = u32::from_le_bytes([
                    bytes[body_start + 4],
                    bytes[body_start + 5],
                    bytes[body_start + 6],
                    bytes[body_start + 7],
                ]);
                let bits = u16::from_le_bytes([bytes[body_start + 14], bytes[body_start + 15]]);
                if format != 1 || bits != 16 {
                    return Err(SpeechError::AudioInvalid(
                        "wav must be 16-bit PCM".to_string(),
                    ));
                }
                validate_pcm_shape(&[0, 0], sample_rate, channels)?;
                fmt = Some((sample_rate, channels, bits));
            }
            b"data" => data = Some(&bytes[body_start..body_end]),
            _ => {}
        }
        // chunks 按偶数字节对齐
        offset = body_end + (size & 1);
    }
    if fmt.is_none() {
        return Err(SpeechError::AudioInvalid("wav missing fmt chunk".to_string()));
    }
    let data = data.ok_or_else(|| SpeechError::AudioInvalid("wav missing data chunk".to_string()))?;
    let mut out = data.to_vec();
    out.truncate(out.len() - (out.len() % 2));
    Ok(out)
}

/// 把裸 PCM 包成 16-bit WAV（44 字节头）
pub fn wrap_pcm_as_wav(pcm: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
    let bits = 16u16;
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * u32::from(block_align);
    let data_len = pcm.len() as u32;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// 解码 base64（标准字母表）
pub fn decode_base64(value: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|err| SpeechError::AudioInvalid(format!("invalid base64 audio: {err}")))
}

/// 编码 base64（标准字母表）
pub fn encode_base64(value: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(pcm: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
        wrap_pcm_as_wav(pcm, sample_rate, channels)
    }

    #[test]
    fn wav_round_trip() {
        let pcm = vec![0u8; 3200];
        let bytes = wav(&pcm, 16_000, 1);
        assert_eq!(parse_pcm_wav(&bytes).unwrap(), pcm);
    }

    #[test]
    fn rejects_non_pcm_wav() {
        let mut bytes = wav(&[0u8; 32], 16_000, 1);
        // fmt format = 3 (IEEE float)
        bytes[20] = 3;
        assert!(parse_pcm_wav(&bytes).is_err());
    }

    #[test]
    fn rejects_wrong_rate() {
        let bytes = wav(&[0u8; 32], 48_000, 1);
        assert!(parse_pcm_wav(&bytes).is_err());
    }

    #[test]
    fn pcm_input_validates_shape() {
        let input = AudioInput {
            container: "pcm".to_string(),
            sample_rate: Some(16_000),
            channels: Some(1),
            data_base64: encode_base64(&[0u8; 64]),
        };
        assert_eq!(input.to_local_pcm().unwrap().len(), 64);
        let bad = AudioInput {
            container: "pcm".to_string(),
            sample_rate: Some(48_000),
            channels: Some(1),
            data_base64: encode_base64(&[0u8; 64]),
        };
        assert!(bad.to_local_pcm().is_err());
    }

    #[test]
    fn oversized_audio_is_rejected() {
        let input = AudioInput {
            container: "pcm".to_string(),
            sample_rate: Some(16_000),
            channels: Some(1),
            data_base64: encode_base64(&vec![0u8; MAX_AUDIO_BYTES + 2]),
        };
        let err = input.decode().unwrap_err();
        assert_eq!(err.kind(), "audio-too-large");
    }

    #[test]
    fn local_rejects_mp3() {
        let input = AudioInput {
            container: "mp3".to_string(),
            sample_rate: None,
            channels: None,
            data_base64: encode_base64(b"ID3"),
        };
        assert_eq!(input.to_local_pcm().unwrap_err().kind(), "audio-unsupported-local");
    }

    #[test]
    fn remote_wraps_pcm() {
        let input = AudioInput {
            container: "pcm".to_string(),
            sample_rate: Some(16_000),
            channels: Some(1),
            data_base64: encode_base64(&[0u8; 64]),
        };
        let (bytes, name, mime) = input.to_remote_body().unwrap();
        assert_eq!(name, "audio.wav");
        assert_eq!(mime, "audio/wav");
        assert_eq!(&bytes[0..4], b"RIFF");
    }
}