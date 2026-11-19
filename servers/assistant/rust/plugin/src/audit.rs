//! 审计（票 07 / spec §5.6、§6 日志红线）
//!
//! 每次工具调用一行：tool / app / command / risk / decision + 参数与结果**摘要**。
//! **不存参数原文与返回值原文**——摘要为 sha256 前 12 位 hex，仅可关联不可还原。
//! 用户可在设置页查看 / 导出 / 清空（导出 / 清空归 [`crate::export`]）。

use sha2::{Digest, Sha256};

use crate::store::AuditEntry;

/// 计算摘要（sha256 前 12 位 hex）；空输入也产出稳定摘要
///
/// 审计写入归工具运行时（票 13）；票 07 阶段仅审计查询落地，写入函数预留。
#[allow(dead_code)]
pub fn digest(data: &str) -> String {
    let mut h = Sha256::new();
    h.update(data.as_bytes());
    let out = h.finalize();
    hex::encode(&out[..6])
}

/// 构造审计条目（id 由调用方给或生成；ts 由前端传入，wasm 不取系统时钟）
///
/// 审计写入归工具运行时（票 13）；票 07 阶段预留。
#[allow(dead_code)]
pub fn make_entry(
    id: &str,
    ts: &str,
    tool_id: &str,
    app_id: Option<&str>,
    command: &str,
    risk: &str,
    decision: &str,
    args_digest: Option<&str>,
    result_digest: Option<&str>,
) -> AuditEntry {
    AuditEntry {
        id: id.to_string(),
        ts: ts.to_string(),
        tool_id: tool_id.to_string(),
        app_id: app_id.map(str::to_string),
        command: command.to_string(),
        risk: risk.to_string(),
        decision: decision.to_string(),
        args_digest: args_digest.map(str::to_string),
        result_digest: result_digest.map(str::to_string),
        user_visible: true,
    }
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
