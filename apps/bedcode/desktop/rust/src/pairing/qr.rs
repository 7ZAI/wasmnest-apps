//! QR token 策略（终端会话中心 pairing 域 · 票 04）
//!
//! 语义从宿主 `src-tauri/src/utils/auth/qr_token.rs` 平移（行为等价约束）：
//!
//! - 128-bit 随机 token（16 字节 → 32 hex 字符），TTL 可配置
//! - 过期判定：`elapsed >= ttl`（**大于等于**即过期；与配对码的 `>` 语义不同）
//! - 一次性语义：verify 成功即**清除**（宿主消费时 `*guard = None`；没有 `used`
//!   标记——已消费的 token 不存在，重复使用报「无活跃 token」）
//! - verify 失败分支：无活跃 token / 过期（顺带清除）/ 不匹配 → 各自报错
//! - `get_active`：过滤过期，返回 `(token, ttl, remaining)`；
//!   remaining = `ttl - elapsed`（`saturating_sub`）
//!
//! 差异留档：宿主状态管理用 `tokio::sync::Mutex`（async），插件为同步
//! `std::sync::Mutex`（wasip3 插件无 async 运行时，命令面同步分派）——
//! 单次使用语义（并发 verify 恰一个成功）在互斥锁下天然成立，行为等价。
//! 时间用 unix 秒快照 + 注入 `*_at(now)`（宿主 Instant 亚秒；秒级截断在
//! TTL 边界处决策一致：`elapsed == ttl` 双方均判过期）。

use crate::lock::lock_or_recover;
use crate::pairing::jwt::now_secs;
use std::sync::Mutex;

/// QR Token 随机字节数（128-bit = 32 hex 字符）— 与宿主 `QR_TOKEN_BYTES=16` 对齐
pub const QR_TOKEN_BYTES: usize = 16;

/// 128-bit 随机 hex token（一次性，TTL 可配置）
#[derive(Clone)]
pub struct QrToken {
    pub token: String,
    /// 创建时间（unix 秒）
    pub created_at_secs: u64,
    pub ttl_secs: u64,
}

/// 手写 `Debug`：token 是 128-bit bearer 凭据，不得出现在 `{:?}` / `assert_eq!`
/// 失败信息 / 宿主日志里（AGENTS §4.1「凭据禁止进日志」）
impl std::fmt::Debug for QrToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QrToken")
            .field("token_len", &self.token.len())
            .field("created_at_secs", &self.created_at_secs)
            .field("ttl_secs", &self.ttl_secs)
            .finish()
    }
}

impl QrToken {
    /// 生成新 token（注入创建时间，测试用）
    ///
    /// 熵不可用 → 显性错误（**不 expect**：生产路径的 expect 在 wasm 里是整插件
    /// trap，单次生成失败应让调用方拿到错误并提示重试）
    pub fn new_at(ttl_secs: u64, now_secs: u64) -> Result<Self, String> {
        let mut random_bytes = [0u8; QR_TOKEN_BYTES];
        getrandom::fill(&mut random_bytes)
            .map_err(|e| format!("entropy unavailable for QR token: {e}"))?;
        Ok(Self {
            token: hex::encode(random_bytes),
            created_at_secs: now_secs,
            ttl_secs,
        })
    }

    /// 生成新 token（默认取当前时间）
    pub fn new(ttl_secs: u64) -> Result<Self, String> {
        Self::new_at(ttl_secs, now_secs())
    }

    /// 是否过期：`elapsed >= ttl`（宿主 `is_expired` 的 `>=` 语义）
    pub fn is_expired_at(&self, now_secs: u64) -> bool {
        now_secs.saturating_sub(self.created_at_secs) >= self.ttl_secs
    }

    /// 剩余有效秒（`ttl - elapsed`，saturating 钳制）— 对齐宿主 `get_active`
    pub fn remaining_secs_at(&self, now_secs: u64) -> u64 {
        self.ttl_secs
            .saturating_sub(now_secs.saturating_sub(self.created_at_secs))
    }
}

/// QR token 管理器 — 语义同宿主 `QrTokenManager`
///
/// 宿主为 async（tokio Mutex）；插件为同步 Mutex（wasip3 命令面同步分派），
/// 单次使用语义等价（互斥 + 消费即清除）。
#[derive(Debug, Default)]
pub struct QrTokenManager {
    current_token: Mutex<Option<QrToken>>,
}

impl QrTokenManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 生成新的 QR token，替换旧的 — 语义同宿主 `generate`
    pub fn generate(&self, ttl_secs: u64) -> Result<String, String> {
        let token = QrToken::new(ttl_secs)?;
        let token_str = token.token.clone();
        *lock_or_recover(&self.current_token) = Some(token);
        Ok(token_str)
    }

    /// 验证 token：存在、未过期、匹配 → 消费清除
    /// 失败分支（宿主各报错文案）：无活跃 / 过期（顺带清除）/ 不匹配
    pub fn verify(&self, input: &str) -> Result<(), QrVerifyError> {
        let mut guard = lock_or_recover(&self.current_token);
        let now = now_secs();
        match guard.as_mut() {
            None => Err(QrVerifyError::NoActiveToken),
            Some(token) => {
                if token.is_expired_at(now) {
                    // 过期 token 顺带清除（宿主语义）
                    *guard = None;
                    Err(QrVerifyError::Expired)
                } else if token.token != input {
                    Err(QrVerifyError::Mismatch)
                } else {
                    // 消费 token：清除而非标记 used（宿主语义：前端需收到事件后重新生成）
                    *guard = None;
                    Ok(())
                }
            }
        }
    }

    /// 获取当前活跃 token 信息（排除已过期）→ `(token, ttl, remaining)`
    pub fn get_active(&self) -> Option<(String, u64, u64)> {
        let guard = lock_or_recover(&self.current_token);
        let now = now_secs();
        guard.as_ref().and_then(|token| {
            if token.is_expired_at(now) {
                None
            } else {
                Some((
                    token.token.clone(),
                    token.ttl_secs,
                    token.remaining_secs_at(now),
                ))
            }
        })
    }

    /// 清除当前 token — 语义同宿主 `clear`。命令面未暴露（宿主配对流程不
    /// 主动清除 QR token，靠 TTL/消费语义）；保留为语义完整 API（后续票）
    #[allow(dead_code)]
    pub fn clear(&self) {
        *lock_or_recover(&self.current_token) = None;
    }
}

/// QR verify 失败类别（宿主各分支对应 `AppError::Auth("...")` 文案）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QrVerifyError {
    /// 无活跃 token
    NoActiveToken,
    /// token 已过期
    Expired,
    /// token 不匹配（含「已被消费」：消费即清除，重复使用落到无活跃分支）
    Mismatch,
}

impl QrVerifyError {
    /// 与宿主错误文案一致（前端提示经此透出；明文 token 不落日志）
    pub fn message(&self) -> &'static str {
        match self {
            QrVerifyError::NoActiveToken => "No active QR token",
            QrVerifyError::Expired => "QR token expired",
            QrVerifyError::Mismatch => "Invalid QR token",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_32_hex_chars() {
        let token = QrToken::new(300).expect("entropy available in tests");
        assert_eq!(token.token.len(), 32);
        assert!(token.token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// 凭据红线：`{:?}` 只暴露长度，不得带出 token 明文
    #[test]
    fn debug_never_exposes_token_material() {
        let token = QrToken::new(300).expect("token");
        let raw = token.token.clone();
        let debug = format!("{token:?}");
        assert!(debug.contains("token_len"), "{debug}");
        assert!(
            !debug.contains(&raw),
            "QrToken 的 Debug 不得包含 token 明文（凭据不进日志）: {debug}"
        );
        let manager = QrTokenManager::new();
        manager.generate(300).expect("generate");
        let manager_debug = format!("{manager:?}");
        assert!(!manager_debug.contains(&raw));
    }

    /// TTL 边界：`elapsed == ttl` 视为过期（宿主 `>=` 语义；与配对码 `>` 不同）
    #[test]
    fn ttl_boundary_elapsed_equals_ttl_is_expired() {
        let token = QrToken::new_at(1, 1000).expect("token");
        assert!(
            token.is_expired_at(1001),
            "elapsed == ttl 应视为过期（>= 语义）"
        );
    }

    #[test]
    fn not_expired_before_ttl() {
        let token = QrToken::new_at(300, 1000).expect("token");
        assert!(!token.is_expired_at(1299));
        assert_eq!(token.remaining_secs_at(1299), 1);
        assert_eq!(token.remaining_secs_at(1300), 0);
    }

    #[test]
    fn generate_and_verify_single_use() {
        let manager = QrTokenManager::new();
        let token = manager.generate(300).expect("generate");
        assert_eq!(token.len(), 32);
        assert_eq!(manager.verify(&token), Ok(()));
        // 验证后 token 被消费：get_active 返回 None，重复使用失败
        assert_eq!(manager.get_active(), None);
        assert_eq!(manager.verify(&token), Err(QrVerifyError::NoActiveToken));
    }

    #[test]
    fn verify_rejects_mismatch() {
        let manager = QrTokenManager::new();
        manager.generate(300).expect("generate");
        assert_eq!(
            manager.verify("invalid_token_32_chars_here!!!"),
            Err(QrVerifyError::Mismatch)
        );
        // 不匹配不消费：正确 token 仍可用
        let token = manager.get_active().expect("active token").0;
        assert_eq!(manager.verify(&token), Ok(()));
    }

    #[test]
    fn verify_rejects_expired_and_clears() {
        let manager = QrTokenManager::new();
        let token = manager.generate(0).expect("generate"); // TTL=0 立即过期
        assert_eq!(manager.verify(&token), Err(QrVerifyError::Expired));
        assert_eq!(manager.get_active(), None, "过期 token 被顺带清除");
    }

    #[test]
    fn get_active_filters_expired() {
        let manager = QrTokenManager::new();
        manager.generate(0).expect("generate");
        assert_eq!(manager.get_active(), None, "过期 token 不应出现在活跃列表");
    }

    #[test]
    fn get_active_returns_remaining() {
        let manager = QrTokenManager::new();
        manager.generate(300).expect("generate");
        let active = manager.get_active().expect("active token");
        assert_eq!(active.0.len(), 32);
        assert_eq!(active.1, 300);
        assert!(active.2 <= 300, "剩余秒数应 ≤ TTL");
    }

    #[test]
    fn clear_removes_token() {
        let manager = QrTokenManager::new();
        manager.generate(300).expect("generate");
        manager.clear();
        assert_eq!(manager.get_active(), None);
        assert_eq!(manager.verify("x"), Err(QrVerifyError::NoActiveToken));
    }

    /// 并发单次使用（对照宿主 qr_token.rs `test_qr_token_concurrent_single_use`）：
    /// 两个并发 verify 只允许一个成功。宿主为 tokio Mutex（async），插件为
    /// std Mutex（wasip3 同步分派）——互斥 + 消费即清除保证恰一成功
    #[test]
    fn concurrent_verify_allows_exactly_one_success() {
        use std::sync::Arc;
        let manager = Arc::new(QrTokenManager::new());
        let token = manager.generate(300).expect("generate");
        let m1 = Arc::clone(&manager);
        let t1 = token.clone();
        let h1 = std::thread::spawn(move || m1.verify(&t1).is_ok());
        let m2 = Arc::clone(&manager);
        let t2 = token.clone();
        let h2 = std::thread::spawn(move || m2.verify(&t2).is_ok());
        let ok_count = [h1.join().unwrap(), h2.join().unwrap()]
            .iter()
            .filter(|&&b| b)
            .count();
        assert_eq!(ok_count, 1, "并发 verify 必须恰好一个成功（单次使用语义）");
    }

    /// 错误文案与宿主 `AppError::Auth` 消息一致（前端/对照锚点）
    ///
    /// 没有「already used」：消费即清除，重复使用只会落到「无活跃 token」
    #[test]
    fn error_messages_match_host() {
        assert_eq!(QrVerifyError::NoActiveToken.message(), "No active QR token");
        assert_eq!(QrVerifyError::Expired.message(), "QR token expired");
        assert_eq!(QrVerifyError::Mismatch.message(), "Invalid QR token");
    }
}
