//! 证据平面：写集指纹 diff、宿主执行验收命令、reviewer verdict 裁决。

use std::collections::BTreeMap;

use super::model::{Acceptance, ReasonCode};

/// 单次 git 快照采集（status + 分批 hash-object）的墙钟上限
pub(crate) const GIT_SNAPSHOT_TIMEOUT_SECS: u64 = 30;

/// 工作树脏路径的内容指纹：内容哈希或“已删除”。
///
/// 用指纹而非路径集合，才能在顺序节点二次修改同一路径时仍把改动归属到后者。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum FileFingerprint {
    Content(String),
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub(crate) struct GitSnapshot {
    pub files: BTreeMap<String, FileFingerprint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct CommandResult {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub output_tail: String,
}

pub(crate) trait EvidencePort {
    fn git_status(&self, working_dir: &str, timeout_secs: u64) -> Result<GitSnapshot, String>;
    fn run_command(
        &self,
        working_dir: &str,
        cwd: Option<&str>,
        argv: &[String],
        timeout_secs: u64,
    ) -> Result<CommandResult, String>;
    fn last_assistant_text(&self, run_id: &str) -> Result<Option<String>, String>;
}

pub(crate) struct EvidenceRequest<'a> {
    pub working_dir: &'a str,
    pub pre: &'a GitSnapshot,
    pub write_scope: &'a [String],
    /// 同编排内其他节点的写集并集：并行窗口里由他人持有的路径不算本节点越界。
    /// 只按本节点写集过滤会把并发写者的改动误判成自己的越界（写集不相交的
    /// 并行节点 / 只读 reviewer 必然失败）。
    pub concurrent_write_scopes: &'a [String],
    pub run_id: &'a str,
    pub acceptance: &'a Acceptance,
    pub default_timeout_secs: u64,
    pub task_completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EvidenceReport {
    pub task_completed: bool,
    pub post_snapshot_available: bool,
    pub changed_files: Vec<String>,
    pub scope_violations: Vec<String>,
    /// 采集时存在并发写者：归属仍有歧义，越界结论至少可重试而非永久判死。
    pub concurrent_writers: bool,
    pub acceptance: AcceptanceEvidence,
    /// 采集端口错误（验收命令 / reviewer 文本）：不得把空结果当证据落库。
    pub port_errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AcceptanceEvidence {
    NotRun,
    Command(CommandResult),
    Verdict(Option<ReviewVerdict>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewVerdict {
    Pass,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    Succeeded,
    Failed { reason: ReasonCode, retryable: bool },
}

pub(crate) fn judge(report: &EvidenceReport, acceptance: &Acceptance) -> Verdict {
    if !report.task_completed {
        return Verdict::Failed {
            reason: ReasonCode::AgentInterrupted,
            retryable: true,
        };
    }
    if !report.post_snapshot_available {
        return Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        };
    }
    // 采集端口失败不是「证据缺失」的静态事实，更不能把默认空结果当验收结论：
    // 判可重试，让调用方下一轮重采（M9）。
    if !report.port_errors.is_empty() {
        return Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        };
    }
    if !report.scope_violations.is_empty() {
        return Verdict::Failed {
            reason: ReasonCode::ScopeViolation,
            // 有并发写者时，差集归属可能受他人写入窗口影响：给一次重采机会；
            // 串行节点（无并发写者）的真越界仍然不可重试。
            retryable: report.concurrent_writers,
        };
    }

    match (acceptance, &report.acceptance) {
        (Acceptance::None, _) => Verdict::Succeeded,
        (Acceptance::Command { .. }, AcceptanceEvidence::Command(result))
            if result.exit_code == Some(0) && !result.timed_out =>
        {
            Verdict::Succeeded
        }
        (Acceptance::Command { .. }, AcceptanceEvidence::Command(_)) => Verdict::Failed {
            reason: ReasonCode::AcceptanceFailed,
            retryable: true,
        },
        (Acceptance::Command { .. }, _) => Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        },
        (Acceptance::Verdict { .. }, AcceptanceEvidence::Verdict(Some(ReviewVerdict::Pass))) => {
            Verdict::Succeeded
        }
        (Acceptance::Verdict { .. }, AcceptanceEvidence::Verdict(Some(ReviewVerdict::Fail))) => {
            Verdict::Failed {
                reason: ReasonCode::AcceptanceFailed,
                retryable: true,
            }
        }
        (Acceptance::Verdict { .. }, _) => Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        },
    }
}

pub(crate) fn collect(port: &impl EvidencePort, request: &EvidenceRequest<'_>) -> EvidenceReport {
    let post = match port.git_status(request.working_dir, GIT_SNAPSHOT_TIMEOUT_SECS) {
        Ok(post) => post,
        Err(detail) => {
            return EvidenceReport {
                task_completed: request.task_completed,
                post_snapshot_available: false,
                changed_files: vec![],
                scope_violations: vec![],
                concurrent_writers: !request.concurrent_write_scopes.is_empty(),
                acceptance: AcceptanceEvidence::NotRun,
                port_errors: vec![format!("git status failed: {detail}")],
            }
        }
    };

    let changed_files = changed_paths(request.pre, &post);
    let scope_violations = changed_files
        .iter()
        .filter(|path| {
            !path_in_scope(request.write_scope, path)
                && !path_in_scope(request.concurrent_write_scopes, path)
        })
        .cloned()
        .collect();

    // 端口错误必须显性上报：默认 CommandResult（exitCode=None）被 UI 渲染成
    // "signal"、空 verdict 被当成「没写结论」，两者都会把故障固化成裁决（M9）。
    let mut port_errors = Vec::new();
    let acceptance = match request.acceptance {
        Acceptance::None => AcceptanceEvidence::NotRun,
        Acceptance::Command {
            command,
            cwd,
            timeout_sec,
        } => {
            let timeout = timeout_sec.unwrap_or(request.default_timeout_secs);
            match port.run_command(request.working_dir, cwd.as_deref(), command, timeout) {
                Ok(result) => AcceptanceEvidence::Command(result),
                Err(detail) => {
                    port_errors.push(format!("acceptance command failed: {detail}"));
                    AcceptanceEvidence::NotRun
                }
            }
        }
        Acceptance::Verdict { .. } => match port.last_assistant_text(request.run_id) {
            Ok(text) => AcceptanceEvidence::Verdict(text.as_deref().and_then(extract_verdict)),
            Err(detail) => {
                port_errors.push(format!("reviewer text failed: {detail}"));
                AcceptanceEvidence::NotRun
            }
        },
    };

    EvidenceReport {
        task_completed: request.task_completed,
        post_snapshot_available: true,
        changed_files,
        scope_violations,
        concurrent_writers: !request.concurrent_write_scopes.is_empty(),
        acceptance,
        port_errors,
    }
}

/// 键并集逐路径比较指纹：任一指纹不同即该 attempt 的改动。
fn changed_paths(pre: &GitSnapshot, post: &GitSnapshot) -> Vec<String> {
    let mut changed: Vec<String> = post
        .files
        .iter()
        .filter(|(path, fingerprint)| pre.files.get(*path) != Some(*fingerprint))
        .map(|(path, _)| (*path).clone())
        .collect();
    changed.extend(
        pre.files
            .keys()
            .filter(|path| !post.files.contains_key(*path))
            .cloned(),
    );
    changed.sort();
    changed.dedup();
    changed
}

fn path_in_scope(scope: &[String], path: &str) -> bool {
    scope
        .iter()
        .any(|prefix| prefix == "." || path == prefix || is_prefix_of(prefix, path))
}

fn is_prefix_of(prefix: &str, path: &str) -> bool {
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// verdict 必须独占一行（允许 markdown 强调符与尾随标点），只取最后一条。
/// 正文里复述「VERDICT: PASS|FAIL」约定不再被当成结论（M10）；一次回复里
/// 同时出现 PASS / FAIL 时沿用最保守的 fail 优先。
pub(crate) fn extract_verdict(text: &str) -> Option<ReviewVerdict> {
    let mut found: Option<ReviewVerdict> = None;
    for line in text.lines() {
        let bare = line
            .trim()
            // 先剥尾随标点，再剥 markdown 强调符：`**VERDICT: PASS**.`
            .trim_end_matches(|c: char| c == '.' || c == '!' || c == '。')
            .trim()
            .trim_matches(|c: char| c == '*' || c == '_' || c == '`')
            .trim();
        let verdict = match bare {
            "VERDICT: PASS" => Some(ReviewVerdict::Pass),
            "VERDICT: FAIL" => Some(ReviewVerdict::Fail),
            _ => None,
        };
        if let Some(verdict) = verdict {
            if found != Some(ReviewVerdict::Fail) {
                found = Some(verdict);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests;
