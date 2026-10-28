//! 引导状态机与失败码（纯函数）
//!
//! ```text
//! idle → preflight → downloading → verifying → extracting → registering → reprobing → done
//!                                        ↘ failed(phase, code, detail)
//! 任意阶段 → cancelled
//! ```
//!
//! 进度只有阶段粒度：`host-process` 只在进程结束时回调，拿不到流式进度，
//! **不做假百分比**——前端按 `phase` 显示「下载中 / 校验中 / 解压中」。
//!
//! 失败码是 wire 字符串（前端 i18n 映射到文案），`detail` 保留原始命令输出
//! 尾部（截断到 4 KB），用于「详情」展开与排障。

use serde_json::{json, Value};

/// 引导阶段（wire 字符串与前端 `BootstrapPhase` 一致）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Idle,
    Preflight,
    Downloading,
    Verifying,
    Extracting,
    Registering,
    Reprobing,
    Done,
    Failed,
    Cancelled,
}

impl Phase {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Preflight => "preflight",
            Phase::Downloading => "downloading",
            Phase::Verifying => "verifying",
            Phase::Extracting => "extracting",
            Phase::Registering => "registering",
            Phase::Reprobing => "reprobing",
            Phase::Done => "done",
            Phase::Failed => "failed",
            Phase::Cancelled => "cancelled",
        }
    }

}

/// 失败码（wire 字符串；前端 i18n 映射，禁止在 Rust 侧写死用户文案）。
///
/// `busy` / `already-ready` 不在此列：它们不是「失败」，分别以业务码
/// （`hub.boot.error.busy`）与状态字段（`alreadyReady`）表达。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Code {
    UnsupportedPlatform,
    InsufficientSpace,
    DownloadFailed,
    VerifyFailed,
    ExtractFailed,
    RegisterPathFailed,
    ReprobeFailed,
    Cancelled,
}

impl Code {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Code::UnsupportedPlatform => "unsupported-platform",
            Code::InsufficientSpace => "insufficient-space",
            Code::DownloadFailed => "download-failed",
            Code::VerifyFailed => "verify-failed",
            Code::ExtractFailed => "extract-failed",
            Code::RegisterPathFailed => "register-path-failed",
            Code::ReprobeFailed => "reprobe-failed",
            Code::Cancelled => "cancelled",
        }
    }
}

/// 一次失败的完整描述（阶段 + 码 + 原始输出尾部）
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Failure {
    pub phase: Phase,
    pub code: Code,
    pub detail: String,
}

impl Failure {
    pub(crate) fn new(phase: Phase, code: Code, detail: impl Into<String>) -> Self {
        Self {
            phase,
            code,
            detail: detail_tail(&detail.into()),
        }
    }

    /// wire 形状：`{ phase, code, detail }`
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "phase": self.phase.as_str(),
            "code": self.code.as_str(),
            "detail": self.detail,
        })
    }
}

/// `detail` 截断上限（4 KB）：只保留尾部——命令行报错的关键信息在最后几行
pub(crate) const DETAIL_TAIL_BYTES: usize = 4 * 1024;

/// 取字符串尾部 4 KB（char boundary 安全）
pub(crate) fn detail_tail(s: &str) -> String {
    if s.len() <= DETAIL_TAIL_BYTES {
        return s.to_string();
    }
    let mut start = s.len() - DETAIL_TAIL_BYTES;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    s[start..].to_string()
}

/// 下载推进计划：一次尝试失败后往哪走
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Plan {
    /// 同一目标产物内换下一个尝试（同源的下一个工具 / 下一个来源）
    Retry { source: usize, attempt: usize },
    /// 主产物全部来源失败 → 换兜底产物（Linux `.tar.xz`）重来
    Fallback,
    /// 全部打光
    Exhausted,
}

/// 推进计算（纯函数，独立可测）：
/// 先在同一来源内换工具形态，再换来源，最后才换产物格式。
pub(crate) fn next_plan(
    sources: usize,
    attempts: usize,
    source: usize,
    attempt: usize,
    used_fallback: bool,
    has_fallback: bool,
) -> Plan {
    if attempts == 0 || sources == 0 {
        return Plan::Exhausted;
    }
    if attempt + 1 < attempts {
        return Plan::Retry {
            source,
            attempt: attempt + 1,
        };
    }
    if source + 1 < sources {
        return Plan::Retry {
            source: source + 1,
            attempt: 0,
        };
    }
    if has_fallback && !used_fallback {
        Plan::Fallback
    } else {
        Plan::Exhausted
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 阶段 wire 字符串（前端 `BootstrapPhase` 的唯一定义）
    #[test]
    fn phase_wire_strings() {
        assert_eq!(Phase::Idle.as_str(), "idle");
        assert_eq!(Phase::Preflight.as_str(), "preflight");
        assert_eq!(Phase::Downloading.as_str(), "downloading");
        assert_eq!(Phase::Verifying.as_str(), "verifying");
        assert_eq!(Phase::Extracting.as_str(), "extracting");
        assert_eq!(Phase::Registering.as_str(), "registering");
        assert_eq!(Phase::Reprobing.as_str(), "reprobing");
        assert_eq!(Phase::Done.as_str(), "done");
        assert_eq!(Phase::Failed.as_str(), "failed");
        assert_eq!(Phase::Cancelled.as_str(), "cancelled");
    }

    /// 失败码 wire 字符串（前端 i18n key 映射的唯一定义）
    #[test]
    fn code_wire_strings() {
        assert_eq!(Code::UnsupportedPlatform.as_str(), "unsupported-platform");
        assert_eq!(Code::InsufficientSpace.as_str(), "insufficient-space");
        assert_eq!(Code::DownloadFailed.as_str(), "download-failed");
        assert_eq!(Code::VerifyFailed.as_str(), "verify-failed");
        assert_eq!(Code::ExtractFailed.as_str(), "extract-failed");
        assert_eq!(Code::RegisterPathFailed.as_str(), "register-path-failed");
        assert_eq!(Code::ReprobeFailed.as_str(), "reprobe-failed");
        assert_eq!(Code::Cancelled.as_str(), "cancelled");
    }

    /// detail 截断：小串原样；超限取尾部且 char boundary 安全（多字节不切断）
    #[test]
    fn detail_tail_is_char_safe() {
        assert_eq!(detail_tail("boom"), "boom");
        let big = "错".repeat(DETAIL_TAIL_BYTES); // 3 bytes/char
        let tail = detail_tail(&big);
        assert!(tail.len() <= DETAIL_TAIL_BYTES + 3);
        assert!(tail.chars().all(|c| c == '错'));
        assert_eq!(tail, big[big.len() - tail.len()..]);
    }

    /// 失败 JSON 形状（前端按 phase/code 映射文案）
    #[test]
    fn failure_json_shape() {
        let f = Failure::new(Phase::Verifying, Code::VerifyFailed, "hash mismatch");
        let v = f.to_json();
        assert_eq!(v["phase"], json!("verifying"));
        assert_eq!(v["code"], json!("verify-failed"));
        assert_eq!(v["detail"], json!("hash mismatch"));
    }

    /// 推进顺序：同源换工具 → 换来源 → 换产物格式 → 耗尽
    #[test]
    fn plan_advances_in_order() {
        // 3 源 × 2 工具，主产物
        assert_eq!(
            next_plan(3, 2, 0, 0, false, true),
            Plan::Retry {
                source: 0,
                attempt: 1
            }
        );
        assert_eq!(
            next_plan(3, 2, 0, 1, false, true),
            Plan::Retry {
                source: 1,
                attempt: 0
            }
        );
        assert_eq!(
            next_plan(3, 2, 2, 0, false, true),
            Plan::Retry {
                source: 2,
                attempt: 1
            }
        );
        // 主产物三源打光 → 换 xz 兜底
        assert_eq!(next_plan(3, 2, 2, 1, false, true), Plan::Fallback);
        // 兜底也打光 → 耗尽
        assert_eq!(next_plan(3, 2, 2, 1, true, true), Plan::Exhausted);
        // 无兜底（Windows）：主产物打完即耗尽
        assert_eq!(next_plan(3, 2, 2, 1, false, false), Plan::Exhausted);
        // 无可用工具（attempts = 0）直接耗尽
        assert_eq!(next_plan(3, 0, 0, 0, false, true), Plan::Exhausted);
    }
}
