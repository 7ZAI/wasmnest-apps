//! 互斥锁中毒（poison）的统一口径 —— wasm 单线程插件
//!
//! 中毒只可能来自「持锁期间 panic」。在 wasm 里 panic 已经 trap 掉整个插件实例，
//! 而 `.expect("...lock")` 会把「一次回调失败」升级成同一结局、且丢掉错误路径
//! （调用方拿不到 Err 只能整实例崩）。进程级静态表的每条目互相独立（连接 / 水位 /
//! QR 当前 token），恢复后继续用不会产生跨条目不变量，因此**统一恢复**：
//! `into_inner()` 取回守卫。
//!
//! 反例（同目录的既有口径，勿回退）：`pairing/qr.rs` 的 `generate` 明确拒绝在
//! 生产路径 `expect` 熵 / 锁失败——单次失败应返回 `Err` 给调用方，而不是 trap。

/// 取锁；中毒时恢复内部值（见模块头）
#[allow(dead_code)]
pub(crate) fn lock_or_recover<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
