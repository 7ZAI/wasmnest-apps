//! 审计（票 07 / spec §5.6、§6 日志红线）
//!
//! 每次工具调用一行：tool / app / command / risk / decision + 参数与结果**摘要**。
//! **不存参数原文与返回值原文**——摘要为 sha256 前 12 位 hex，仅可关联不可还原。
//! 用户可在设置页查看 / 导出 / 清空（导出归 [`crate::export`]，清空为
//! `assistant.audit-clear`）。
//!
//! 写入编排在 `lib.rs::cmd_audit_record`（票 13）：摘要由前端计算后传入，
//! 本模块的 [`digest`] 保留为同口径的 Rust 侧参考实现 / 测试锚点。

use sha2::{Digest, Sha256};

/// 计算摘要（sha256 前 12 位 hex）；空输入也产出稳定摘要。
///
/// 前端 `shared/tools/audit.ts` 的 `auditDigest` 与本文口径一致；两边都锁了
/// 「12 位 hex」用例，改算法须同改。
#[allow(dead_code)]
pub fn digest(data: &str) -> String {
    let mut h = Sha256::new();
    h.update(data.as_bytes());
    let out = h.finalize();
    hex::encode(&out[..6])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stable_and_short() {
        let d = digest("hello");
        assert_eq!(d, digest("hello"));
        assert_eq!(d.len(), 12);
        assert_ne!(d, digest("hello!"));
    }
}
