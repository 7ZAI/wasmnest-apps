use super::{
    meta, Acceptance, AgentOption, EventKind, NodeStatus, OrchestrationStatus, PlanErrorCode,
    ReasonCode, Role,
};

fn wire_values<T: serde::Serialize>(values: &[T]) -> Vec<String> {
    values
        .iter()
        .map(
            |value| match serde_json::to_value(value).expect("enum serializes") {
                serde_json::Value::String(value) => value,
                other => panic!("expected string, got {other}"),
            },
        )
        .collect()
}

fn assert_wire_matches<T: serde::Serialize + Copy>(all: &[T], as_str: impl Fn(T) -> &'static str) {
    for &value in all {
        assert_eq!(
            wire_values(&[value]),
            vec![as_str(value).to_string()],
            "serde and vocabulary diverged"
        );
    }
}

#[test]
fn meta_lists_the_complete_wire_vocabulary() {
    let meta = meta(&[], &[]);

    assert_eq!(
        meta.statuses,
        vec![
            "draft",
            "planning",
            "awaiting-approval",
            "running",
            "pausing",
            "paused",
            "cancelling",
            "cancelled",
            "completed",
            "failed",
            "budget-exhausted",
        ]
    );
    assert_eq!(
        meta.node_statuses,
        vec![
            "pending",
            "ready",
            "dispatching",
            "running",
            "awaiting-input",
            "verifying",
            "succeeded",
            "failed",
            "cancelled",
            "skipped",
            "blocked",
        ]
    );
    assert_eq!(
        meta.roles,
        vec!["planner", "coder", "reviewer", "observer", "custom"]
    );
    assert_eq!(meta.acceptance_types, vec!["none", "command", "verdict"]);
    assert_eq!(
        meta.reason_codes,
        vec![
            "agent-unsupported",
            "agent-not-ready",
            "agent-profile-failed",
            "auto-start-failed",
            "project-not-git",
            "working-tree-dirty",
            "project-trust-required",
            "bridge-offline",
            "run-start-failed",
            "send-failed",
            "dispatch-unknown",
            "status-unknown",
            "task-timeout",
            "agent-interrupted",
            "permission-waiting",
            "scope-violation",
            "acceptance-failed",
            "evidence-missing",
            "plan-invalid",
            "planner-failed",
            "planner-invalid-json",
            "quota-wait",
            "budget-exceeded",
            "deadlock-suspected",
            "approval-required",
            "dependency-failed",
            "node-failed",
            "run-ended",
            "not-retryable",
            "attempts-exhausted",
        ]
    );

    assert_eq!(
        meta.plan_error_codes,
        vec![
            "unsupported-version",
            "invalid-node-count",
            "invalid-max-parallel",
            "invalid-node-key",
            "duplicate-node-key",
            "invalid-max-attempts",
            "invalid-write-scope",
            "invalid-acceptance-command",
            "invalid-acceptance-timeout",
            "command-not-allowed",
            "invalid-acceptance-cwd",
            "readonly-role-write-scope",
            "readonly-role-acceptance",
            "self-dependency",
            "unknown-dependency",
            "dependency-cycle",
            "agent-unsupported",
            "unknown-agent",
            "agent-disabled",
            "planner-invalid-json",
        ]
    );
    assert_eq!(
        meta.event_kinds,
        vec![
            "created",
            "plan_saved",
            "plan_invalid",
            "planned",
            "approved",
            "started",
            "pausing",
            "paused",
            "resumed",
            "cancelling",
            "cancelled",
            "completed",
            "failed",
            "budget_exhausted",
            "node_ready",
            "dispatched",
            "node_running",
            "awaiting_input",
            "verifying",
            "node_succeeded",
            "node_failed",
            "node_cancelled",
            "node_skipped",
            "node_blocked",
            "retried",
            "note",
        ]
    );

    assert_wire_matches(OrchestrationStatus::ALL, OrchestrationStatus::as_str);
    assert_wire_matches(NodeStatus::ALL, NodeStatus::as_str);
    assert_wire_matches(Role::ALL, Role::as_str);
    assert_wire_matches(ReasonCode::ALL, ReasonCode::as_str);
    assert_wire_matches(PlanErrorCode::ALL, PlanErrorCode::as_str);
    assert_wire_matches(EventKind::ALL, EventKind::as_str);

    let acceptance_serde: Vec<String> = [
        Acceptance::None,
        Acceptance::Command {
            command: vec!["true".into()],
            cwd: None,
            timeout_sec: None,
        },
        Acceptance::Verdict { timeout_sec: None },
    ]
    .iter()
    .map(|acceptance| {
        serde_json::to_value(acceptance).expect("acceptance serializes")["type"]
            .as_str()
            .expect("acceptance has a type")
            .to_string()
    })
    .collect();
    assert_eq!(acceptance_serde, meta.acceptance_types);
}

#[test]
fn meta_filters_agents_by_the_bridge_allowlist_and_keeps_readiness() {
    let agents = [
        AgentOption {
            id: "pi".into(),
            display_name: "Pi".into(),
            ready: true,
        },
        AgentOption {
            id: "opencode".into(),
            display_name: "OpenCode".into(),
            ready: false,
        },
        AgentOption {
            id: "claude".into(),
            display_name: "Claude".into(),
            ready: true,
        },
    ];

    assert_eq!(meta(&agents, &[]).agents, agents[..2].to_vec());
}
