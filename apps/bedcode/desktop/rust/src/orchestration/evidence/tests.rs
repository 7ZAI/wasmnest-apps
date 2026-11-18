use std::cell::RefCell;
use std::collections::BTreeMap;

use super::{
    collect, extract_verdict, judge, AcceptanceEvidence, CommandResult, EvidencePort,
    EvidenceReport, EvidenceRequest, FileFingerprint, GitSnapshot, ReviewVerdict, Verdict,
    GIT_SNAPSHOT_TIMEOUT_SECS,
};
use crate::orchestration::model::{Acceptance, ReasonCode};

#[derive(Default)]
struct FakePort {
    post: GitSnapshot,
    post_error: Option<String>,
    assistant_text: Option<String>,
    assistant_error: Option<String>,
    command_error: Option<String>,
    command_result: CommandResult,
    commands: RefCell<Vec<(Option<String>, Vec<String>, u64)>>,
    snapshot_calls: RefCell<Vec<(String, u64)>>,
}

impl EvidencePort for FakePort {
    fn git_status(&self, working_dir: &str, timeout_secs: u64) -> Result<GitSnapshot, String> {
        self.snapshot_calls
            .borrow_mut()
            .push((working_dir.to_string(), timeout_secs));
        match &self.post_error {
            Some(error) => Err(error.clone()),
            None => Ok(self.post.clone()),
        }
    }

    fn run_command(
        &self,
        _working_dir: &str,
        cwd: Option<&str>,
        argv: &[String],
        timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        self.commands
            .borrow_mut()
            .push((cwd.map(str::to_string), argv.to_vec(), timeout_secs));
        match &self.command_error {
            Some(error) => Err(error.clone()),
            None => Ok(self.command_result.clone()),
        }
    }

    fn last_assistant_text(&self, _run_id: &str) -> Result<Option<String>, String> {
        match &self.assistant_error {
            Some(error) => Err(error.clone()),
            None => Ok(self.assistant_text.clone()),
        }
    }
}

fn snapshot(entries: &[(&str, &str)]) -> GitSnapshot {
    GitSnapshot {
        files: entries
            .iter()
            .map(|(path, content)| {
                (
                    path.to_string(),
                    if *content == "<deleted>" {
                        FileFingerprint::Deleted
                    } else {
                        FileFingerprint::Content(content.to_string())
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
    }
}

fn report(acceptance: AcceptanceEvidence) -> EvidenceReport {
    EvidenceReport {
        task_completed: true,
        post_snapshot_available: true,
        concurrent_writers: false,
        changed_files: vec![],
        scope_violations: vec![],
        acceptance,
        port_errors: vec![],
    }
}

#[test]
fn judge_requires_write_set_evidence() {
    assert_eq!(
        judge(&report(AcceptanceEvidence::NotRun), &Acceptance::None),
        Verdict::Succeeded
    );

    let mut violation = report(AcceptanceEvidence::NotRun);
    violation.scope_violations = vec!["secret.txt".into()];
    assert_eq!(
        judge(&violation, &Acceptance::None),
        Verdict::Failed {
            reason: ReasonCode::ScopeViolation,
            retryable: false,
        }
    );

    let mut missing_snapshot = report(AcceptanceEvidence::NotRun);
    missing_snapshot.post_snapshot_available = false;
    assert_eq!(
        judge(&missing_snapshot, &Acceptance::None),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );
}

#[test]
fn acceptance_command_must_exit_zero_without_timeout() {
    let acceptance = Acceptance::Command {
        command: vec!["pnpm".into(), "run".into(), "test:run".into()],
        cwd: None,
        timeout_sec: None,
    };
    let command = |exit_code: Option<i32>, timed_out: bool| {
        report(AcceptanceEvidence::Command(CommandResult {
            exit_code,
            timed_out,
            output_tail: String::new(),
        }))
    };

    assert_eq!(
        judge(&command(Some(0), false), &acceptance),
        Verdict::Succeeded
    );
    assert_eq!(
        judge(&command(Some(1), false), &acceptance),
        Verdict::Failed {
            reason: ReasonCode::AcceptanceFailed,
            retryable: true,
        }
    );
    assert_eq!(
        judge(&command(Some(0), true), &acceptance),
        Verdict::Failed {
            reason: ReasonCode::AcceptanceFailed,
            retryable: true,
        }
    );
    assert_eq!(
        judge(&report(AcceptanceEvidence::NotRun), &acceptance),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );
}

#[test]
fn verdict_pass_gates_reviewer_node() {
    let acceptance = Acceptance::Verdict { timeout_sec: None };

    assert_eq!(
        judge(
            &report(AcceptanceEvidence::Verdict(Some(ReviewVerdict::Pass))),
            &acceptance
        ),
        Verdict::Succeeded
    );
    assert_eq!(
        judge(
            &report(AcceptanceEvidence::Verdict(Some(ReviewVerdict::Fail))),
            &acceptance
        ),
        Verdict::Failed {
            reason: ReasonCode::AcceptanceFailed,
            retryable: true,
        }
    );
    assert_eq!(
        judge(&report(AcceptanceEvidence::Verdict(None)), &acceptance),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );
}

#[test]
fn collect_runs_acceptance_command_and_reads_verdict_from_the_ledger() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v1")]),
        command_result: CommandResult {
            exit_code: Some(0),
            timed_out: false,
            output_tail: "ok".into(),
        },
        ..FakePort::default()
    };
    let pre = snapshot(&[]);
    let scope = vec!["src".to_string()];
    let command = Acceptance::Command {
        command: vec!["pnpm".into(), "run".into(), "test:run".into()],
        cwd: Some("apps/x".into()),
        timeout_sec: Some(120),
    };
    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &scope,
            concurrent_write_scopes: &[],
            run_id: "run-1",
            acceptance: &command,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(
        report.acceptance,
        AcceptanceEvidence::Command(CommandResult {
            exit_code: Some(0),
            timed_out: false,
            output_tail: "ok".into(),
        })
    );
    assert_eq!(
        port.commands.borrow().as_slice(),
        &[(
            Some("apps/x".to_string()),
            vec![
                "pnpm".to_string(),
                "run".to_string(),
                "test:run".to_string()
            ],
            120,
        )]
    );

    let reviewer = FakePort {
        assistant_text: Some("looks good.\nVERDICT: PASS".into()),
        ..FakePort::default()
    };
    let verdict = Acceptance::Verdict { timeout_sec: None };
    let report = collect(
        &reviewer,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &[],
            concurrent_write_scopes: &[],
            run_id: "run-2",
            acceptance: &verdict,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(
        report.acceptance,
        AcceptanceEvidence::Verdict(Some(ReviewVerdict::Pass))
    );
    assert!(reviewer.commands.borrow().is_empty());
}

#[test]
fn extract_verdict_requires_a_standalone_line_and_prefers_fail_on_ambiguity() {
    assert_eq!(extract_verdict("VERDICT: PASS"), Some(ReviewVerdict::Pass));
    assert_eq!(extract_verdict("VERDICT: FAIL"), Some(ReviewVerdict::Fail));
    assert_eq!(
        extract_verdict("review done.\n**VERDICT: PASS**."),
        Some(ReviewVerdict::Pass)
    );
    assert_eq!(extract_verdict("looks good"), None);
    // M10：复述格式 / 引用 prompt 不能再被当成结论。
    assert_eq!(
        extract_verdict("输出格式：VERDICT: PASS 或 VERDICT: FAIL"),
        None
    );
    assert_eq!(
        extract_verdict("The reviewer must print VERDICT: PASS when done."),
        None
    );
    assert_eq!(
        extract_verdict("VERDICT: PASS\nVERDICT: FAIL"),
        Some(ReviewVerdict::Fail)
    );
    assert_eq!(
        extract_verdict("VERDICT: FAIL\nVERDICT: PASS"),
        Some(ReviewVerdict::Fail)
    );
}

/// M9：端口失败不得伪装成「命令返回 exitCode=None」或「reviewer 没写结论」。
#[test]
fn acceptance_port_failures_are_fail_visible_and_retryable() {
    let pre = snapshot(&[]);
    let command = Acceptance::Command {
        command: vec!["pnpm".into(), "run".into(), "test:run".into()],
        cwd: None,
        timeout_sec: None,
    };
    let failing_command = FakePort {
        command_error: Some("spawn failed".into()),
        ..FakePort::default()
    };
    let report = collect(
        &failing_command,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &[],
            concurrent_write_scopes: &[],
            run_id: "run-1",
            acceptance: &command,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(report.acceptance, AcceptanceEvidence::NotRun);
    assert!(report.port_errors[0].contains("spawn failed"));
    assert_eq!(
        judge(&report, &command),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );

    let verdict = Acceptance::Verdict { timeout_sec: None };
    let failing_text = FakePort {
        assistant_error: Some("transcript unavailable".into()),
        ..FakePort::default()
    };
    let report = collect(
        &failing_text,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &[],
            concurrent_write_scopes: &[],
            run_id: "run-1",
            acceptance: &verdict,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(report.acceptance, AcceptanceEvidence::NotRun);
    assert!(report.port_errors[0].contains("transcript unavailable"));
    assert_eq!(
        judge(&report, &verdict),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );
}

#[test]
fn collect_attributes_new_files_and_flags_scope_violations() {
    let port = FakePort {
        post: snapshot(&[
            ("old.txt", "same"),
            ("src/a.rs", "v1"),
            ("secret.txt", "v1"),
        ]),
        ..FakePort::default()
    };
    let pre = snapshot(&[("old.txt", "same")]);
    let scope = vec!["src".to_string()];

    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &scope,
            concurrent_write_scopes: &[],
            run_id: "run-1",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );

    assert_eq!(
        report.changed_files,
        vec!["secret.txt".to_string(), "src/a.rs".to_string()]
    );
    assert_eq!(report.scope_violations, vec!["secret.txt".to_string()]);
    assert_eq!(report.acceptance, AcceptanceEvidence::NotRun);
    assert_eq!(
        port.snapshot_calls.borrow().as_slice(),
        &[("/repo".to_string(), GIT_SNAPSHOT_TIMEOUT_SECS)]
    );
}

#[test]
fn sequential_edits_of_the_same_path_are_attributed_by_content_fingerprint() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v2")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[("src/a.rs", "v1")]);
    let scope = vec!["src".to_string()];

    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &scope,
            concurrent_write_scopes: &[],
            run_id: "run-2",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );

    assert_eq!(report.changed_files, vec!["src/a.rs".to_string()]);
    assert!(report.scope_violations.is_empty());
}

#[test]
fn unchanged_fingerprints_and_clean_paths_are_not_attributed() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v1")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[("src/a.rs", "v1"), ("src/gone.rs", "v1")]);

    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &["src".to_string()],
            concurrent_write_scopes: &[],
            run_id: "run-3",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );

    assert_eq!(report.changed_files, vec!["src/gone.rs".to_string()]);
}

#[test]
fn deleted_paths_are_attributed_and_scope_checked() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "<deleted>")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[("src/a.rs", "v1")]);

    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &["docs".to_string()],
            concurrent_write_scopes: &[],
            run_id: "run-4",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );

    assert_eq!(report.changed_files, vec!["src/a.rs".to_string()]);
    assert_eq!(report.scope_violations, vec!["src/a.rs".to_string()]);
}

#[test]
fn snapshot_failure_is_evidence_missing_without_path_fallback() {
    let port = FakePort {
        post_error: Some("git status timed out".into()),
        ..FakePort::default()
    };
    let pre = snapshot(&[("src/a.rs", "v1")]);

    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &["src".to_string()],
            concurrent_write_scopes: &[],
            run_id: "run-5",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );

    assert!(!report.post_snapshot_available);
    assert!(report.changed_files.is_empty());
    assert_eq!(
        judge(&report, &Acceptance::None),
        Verdict::Failed {
            reason: ReasonCode::EvidenceMissing,
            retryable: true,
        }
    );
}

#[test]
fn concurrent_writers_paths_are_not_attributed_as_this_nodes_violations() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v1"), ("docs/b.md", "v1")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[]);
    let scope = vec!["src".to_string()];
    let concurrent = vec!["docs".to_string()];
    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &scope,
            concurrent_write_scopes: &concurrent,
            run_id: "run-1",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(
        report.changed_files,
        vec!["docs/b.md".to_string(), "src/a.rs".to_string()]
    );
    assert!(
        report.scope_violations.is_empty(),
        "{:?}",
        report.scope_violations
    );
    assert!(report.concurrent_writers);
    assert_eq!(judge(&report, &Acceptance::None), Verdict::Succeeded);
}

#[test]
fn readonly_reviewer_ignores_changes_owned_by_other_nodes() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v1"), ("docs/b.md", "v1")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[]);
    let concurrent = vec!["src".to_string(), "docs".to_string()];
    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &[],
            concurrent_write_scopes: &concurrent,
            run_id: "run-2",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert!(
        report.scope_violations.is_empty(),
        "{:?}",
        report.scope_violations
    );
    assert_eq!(judge(&report, &Acceptance::None), Verdict::Succeeded);
}

#[test]
fn true_out_of_scope_write_still_fails_but_is_retryable_with_concurrent_writers() {
    let port = FakePort {
        post: snapshot(&[("src/a.rs", "v1"), ("secret.txt", "v1")]),
        ..FakePort::default()
    };
    let pre = snapshot(&[]);
    let scope = vec!["src".to_string()];
    let concurrent = vec!["docs".to_string()];
    let report = collect(
        &port,
        &EvidenceRequest {
            working_dir: "/repo",
            pre: &pre,
            write_scope: &scope,
            concurrent_write_scopes: &concurrent,
            run_id: "run-3",
            acceptance: &Acceptance::None,
            default_timeout_secs: 900,
            task_completed: true,
        },
    );
    assert_eq!(report.scope_violations, vec!["secret.txt".to_string()]);
    assert_eq!(
        judge(&report, &Acceptance::None),
        Verdict::Failed {
            reason: ReasonCode::ScopeViolation,
            retryable: true,
        }
    );
}
