//! Minimal `getrandom` 0.2 API stub（Nest 助手 wasm 构建专用）。
//!
//! **为什么需要它**：`argon2` / `chacha20poly1305` / `sha2`（RustCrypto 栈）经
//! `crypto-common → rand_core → getrandom` 传递依赖拉入 getrandom。真实
//! getrandom 0.2 在 `wasm32-unknown-unknown`（移动端目标）需要 `js` 特性，
//! 该特性经 wasm-bindgen 注入导入，会破坏移动端 `componentize` 的 world 解码。
//!
//! **为什么 stub 安全**：Nest 助手的 Rust 侧**从不真正调用 getrandom**——
//! 保险库的 salt / nonce 一律由前端 `crypto.getRandomValues` 生成后传入
//! （spec §5.8），Argon2 派生、AEAD、摘要都不消耗随机数。rand_core 只是把
//! getrandom 作为编译期依赖拉进来。本 stub 仅提供 rand_core 0.6 引用到的最小
//! API 面（`getrandom` 函数 + `Error` 的 `From<u32>` / `code()` / 常量 /
//! Display / Debug），保证编译通过；若意外被调用则显式报错（fail-visible，
//! 不静默返回伪随机数）。
//!
//! 通过父 crate 的 `[patch.crates-io]` 生效，仅本应用依赖图内替换。

use core::fmt;
use core::mem::MaybeUninit;
use core::num::NonZeroU32;

/// getrandom 错误（与真实 getrandom 0.2 的 `Error` 形状对齐）。
pub struct Error(NonZeroU32);

impl Error {
    /// 内部错误码起始值（与真实 getrandom 一致）。
    pub const INTERNAL_START: u32 = 1 << 31;
    /// 自定义错误码起始值（与真实 getrandom 一致）。
    pub const CUSTOM_START: u32 = (1 << 31) + (1 << 30);

    /// 错误码（与真实 getrandom 一致，返回 NonZeroU32）。
    pub const fn code(self) -> NonZeroU32 {
        self.0
    }

    /// 由错误码构造（rand_core 的 Debug / Display 路径使用）。
    fn from_code(code: u32) -> Self {
        // code 为 0 时归一到 1，保证 NonZeroU32 合法。
        let nz = NonZeroU32::new(code).unwrap_or_else(|| NonZeroU32::new(1).unwrap());
        Error(nz)
    }
}

impl From<u32> for Error {
    fn from(code: u32) -> Self {
        Error::from_code(code)
    }
}

impl From<NonZeroU32> for Error {
    fn from(code: NonZeroU32) -> Self {
        Error(code)
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "getrandom stub error (code {})", self.0.get())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "getrandom stub error (code {})", self.0.get())
    }
}

impl std::error::Error for Error {}

/// 填充随机字节。Nest 助手不调用此函数；stub 显式报错（fail-visible）。
pub fn getrandom(_dest: &mut [u8]) -> Result<(), Error> {
    Err(Error::from_code(1))
}

/// `getrandom_uninit` 变体（保持 API 面完整，同样不调用）。
pub fn getrandom_uninit(_dest: &mut [MaybeUninit<u8>]) -> Result<&mut [u8], Error> {
    Err(Error::from_code(1))
}
