//! Speech 服务的纯逻辑核
//!
//! 这里不碰宿主、不碰 wasm、不依赖 SDK：音频形状校验、设置合并、通道路由、
//! 错误分类全部是可单测的纯函数。wasm 插件只做编排与宿主调用。

pub mod audio;
pub mod error;
pub mod request;
pub mod route;
pub mod settings;

pub use audio::{
    decode_base64, encode_base64, wrap_pcm_as_wav, AudioInput, MAX_AUDIO_BYTES,
};
pub use error::{Result, SpeechError};
pub use request::{parse_request, TranscribeInput};
pub use route::{choose_channel, Channel};
pub use settings::{Mode, RemoteSettings, LocalSettings, SettingsPatch, SpeechSettings};