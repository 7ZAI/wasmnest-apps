use super::{plan_tick, Decision, NodeFacts, TickSnapshot};
use crate::orchestration::evidence::Verdict;
use crate::orchestration::model::{NodeStatus, OrchestrationStatus, ReasonCode, TaskStatus};

fn node(key: &str, status: NodeStatus, depends_on: &[&str]) -> NodeFacts {
    NodeFacts {
        key: key.into(),
        status,
        attempt: 0,
        depends_on: depends_on.iter().map(|dep| dep.to_string()).collect(),
        write_scope: vec![],
        task_status: None,
        dispatched_at_ms: None,
        bridge_ready: false,
        send_acknowledged: true,
        timeout_secs: 1800,
        evidence: None,
    }
}

#[test]
fn verifying_node_settles_only_with_evidence() {
    let mut verifying = node("n1", NodeStatus::Verifying, &[]);
    assert!(plan_tick(&running(vec![verifying.clone()])).is_empty());

    verifying.evidence = Some(Verdict::Succeeded);
    assert_eq!(
        plan_tick(&running(vec![verifying])),
        vec![Decision::Transition {
            node_key: "n1".into(),
            to: NodeStatus::Succeeded,
            reason: None,
        }]
    );

    let mut violating = node("n1", NodeStatus::Verifying, &[]);
    violating.evidence = Some(Verdict::Failed {
        reason: ReasonCode::ScopeViolation,
        retryable: false,
    });
    assert_eq!(
        plan_tick(&running(vec![violating])),
        vec![
            Decision::Fail {
                node_key: "n1".into(),
                reason: ReasonCode::ScopeViolation,
                retryable: false,
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Pausing,
                reason: Some(ReasonCode::NodeFailed),
            },
        ]
    );
}

#[test]
fn cancelling_propagates_to_active_and_pending_nodes_then_finishes() {
    let mut cancelling = running(vec![
        node("n1", NodeStatus::Running, &[]),
        node("n2", NodeStatus::Dispatching, &[]),
        node("n3", NodeStatus::Pending, &[]),
    ]);
    cancelling.status = OrchestrationStatus::Cancelling;
    assert_eq!(
        plan_tick(&cancelling),
        vec![
            Decision::CancelNode {
                node_key: "n1".into(),
            },
            Decision::CancelNode {
                node_key: "n2".into(),
            },
            Decision::Transition {
                node_key: "n3".into(),
                to: NodeStatus::Cancelled,
                reason: None,
            },
        ]
    );

    let mut converged = running(vec![
        node("n1", NodeStatus::Failed, &[]),
        node("n2", NodeStatus::Pending, &[]),
    ]);
    converged.status = OrchestrationStatus::Cancelling;
    assert_eq!(
        plan_tick(&converged),
        vec![
            Decision::Transition {
                node_key: "n2".into(),
                to: NodeStatus::Cancelled,
                reason: None,
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Cancelled,
                reason: None,
            },
        ]
    );
}

#[test]
fn all_nodes_succeeded_or_skipped_completes_the_orchestration() {
    let snapshot = running(vec![
        node("n1", NodeStatus::Succeeded, &[]),
        node("n2", NodeStatus::Skipped, &["n1"]),
    ]);

    assert_eq!(
        plan_tick(&snapshot),
        vec![Decision::Orchestration {
            to: OrchestrationStatus::Completed,
            reason: None,
        }]
    );
}

#[test]
fn pending_without_ready_or_active_work_is_a_deadlock() {
    let snapshot = running(vec![
        node("n1", NodeStatus::Pending, &["n2"]),
        node("n2", NodeStatus::Blocked, &[]),
    ]);

    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Transition {
                node_key: "n1".into(),
                to: NodeStatus::Blocked,
                reason: Some(ReasonCode::DeadlockSuspected),
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Paused,
                reason: Some(ReasonCode::DeadlockSuspected),
            },
        ]
    );
}

#[test]
fn orchestration_wall_clock_exhaustion_cancels_active_nodes() {
    let mut snapshot = running(vec![node("n1", NodeStatus::Running, &[])]);
    snapshot.started_at_ms = Some(0);
    snapshot.max_wall_secs = 7200;
    snapshot.now_ms = 7_200_001;

    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Orchestration {
                to: OrchestrationStatus::BudgetExhausted,
                reason: Some(ReasonCode::BudgetExceeded),
            },
            Decision::CancelNode {
                node_key: "n1".into(),
            },
        ]
    );
}

#[test]
fn dispatch_budget_exhaustion_stops_scheduling() {
    let mut snapshot = running(vec![node("n1", NodeStatus::Pending, &[])]);
    snapshot.dispatches_used = 2;
    snapshot.max_dispatches = 2;

    assert_eq!(
        plan_tick(&snapshot),
        vec![Decision::Orchestration {
            to: OrchestrationStatus::BudgetExhausted,
            reason: Some(ReasonCode::BudgetExceeded),
        }]
    );
}

#[test]
fn bridge_wait_times_out_after_twenty_seconds() {
    let mut dispatching = node("n1", NodeStatus::Dispatching, &[]);
    dispatching.dispatched_at_ms = Some(0);

    let mut snapshot = running(vec![dispatching]);
    snapshot.now_ms = 20_001;
    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Fail {
                node_key: "n1".into(),
                reason: ReasonCode::BridgeOffline,
                retryable: true,
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Pausing,
                reason: Some(ReasonCode::NodeFailed),
            },
        ]
    );
}

#[test]
fn running_node_times_out_after_its_wall_clock_budget() {
    let mut running_node = node("n1", NodeStatus::Running, &[]);
    running_node.dispatched_at_ms = Some(0);
    running_node.bridge_ready = true;
    running_node.timeout_secs = 1800;

    let mut before = running(vec![running_node.clone()]);
    before.now_ms = 1_800_000;
    assert!(plan_tick(&before).is_empty());

    let mut after = running(vec![running_node]);
    after.now_ms = 1_800_001;
    assert_eq!(
        plan_tick(&after),
        vec![
            Decision::Fail {
                node_key: "n1".into(),
                reason: ReasonCode::TaskTimeout,
                retryable: true,
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Pausing,
                reason: Some(ReasonCode::NodeFailed),
            },
        ]
    );
}

#[test]
fn write_leases_block_overlapping_writers_but_not_readers() {
    let mut writer = node("w1", NodeStatus::Running, &[]);
    writer.write_scope = vec!["src".into()];
    let mut overlapping = node("w2", NodeStatus::Pending, &[]);
    overlapping.write_scope = vec!["src/lib".into()];
    let mut disjoint = node("w3", NodeStatus::Pending, &[]);
    disjoint.write_scope = vec!["lib".into()];
    let reader = node("r1", NodeStatus::Pending, &[]);

    let mut snapshot = running(vec![writer, overlapping, disjoint, reader]);
    snapshot.max_parallel = 4;

    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Transition {
                node_key: "w2".into(),
                to: NodeStatus::Ready,
                reason: None,
            },
            Decision::Dispatch {
                node_key: "w3".into(),
                attempt: 1,
            },
            Decision::Dispatch {
                node_key: "r1".into(),
                attempt: 1,
            },
        ]
    );
}

#[test]
fn task_completion_moves_active_node_to_verifying() {
    for status in [
        NodeStatus::Dispatching,
        NodeStatus::Running,
        NodeStatus::AwaitingInput,
    ] {
        let mut active = node("n1", status, &[]);
        active.task_status = Some(TaskStatus::Completed);
        assert_eq!(
            plan_tick(&running(vec![active])),
            vec![Decision::Transition {
                node_key: "n1".into(),
                to: NodeStatus::Verifying,
                reason: None,
            }]
        );
    }
}

#[test]
fn asking_waits_for_human_and_interruption_fails_the_node() {
    let mut asking = node("n1", NodeStatus::Running, &[]);
    asking.task_status = Some(TaskStatus::Asking);
    assert_eq!(
        plan_tick(&running(vec![asking])),
        vec![Decision::Transition {
            node_key: "n1".into(),
            to: NodeStatus::AwaitingInput,
            reason: None,
        }]
    );

    let mut interrupted = node("n1", NodeStatus::Running, &[]);
    interrupted.task_status = Some(TaskStatus::Interrupted);
    assert_eq!(
        plan_tick(&running(vec![interrupted])),
        vec![
            Decision::Fail {
                node_key: "n1".into(),
                reason: ReasonCode::AgentInterrupted,
                retryable: true,
            },
            Decision::Orchestration {
                to: OrchestrationStatus::Pausing,
                reason: Some(ReasonCode::NodeFailed),
            },
        ]
    );
}

#[test]
fn task_progress_moves_dispatching_node_to_running() {
    for task_status in [TaskStatus::InProgress, TaskStatus::Retrying] {
        let mut dispatching = node("n1", NodeStatus::Dispatching, &[]);
        dispatching.task_status = Some(task_status);
        assert_eq!(
            plan_tick(&running(vec![dispatching])),
            vec![Decision::Transition {
                node_key: "n1".into(),
                to: NodeStatus::Running,
                reason: None,
            }]
        );
    }
}

#[test]
fn dispatching_without_send_ack_never_leaves_dispatching() {
    // task 行在 run 启动即 InProgress，但 prompt 还没发出。若据此进 Running，
    // 节点会离开补发窗口，bridge 超时也不再覆盖它（C2）。
    for task_status in [
        TaskStatus::InProgress,
        TaskStatus::Completed,
        TaskStatus::Interrupted,
    ] {
        let mut dispatching = node("n1", NodeStatus::Dispatching, &[]);
        dispatching.send_acknowledged = false;
        dispatching.task_status = Some(task_status);
        dispatching.dispatched_at_ms = Some(0);
        let mut snapshot = running(vec![dispatching]);
        snapshot.now_ms = 1_000;
        assert!(
            plan_tick(&snapshot).is_empty(),
            "task_status={task_status:?} must not advance an unsent node"
        );
    }
}

#[test]
fn skipped_root_with_blocked_dependents_settles_to_paused() {
    // Completed 判据只认 Succeeded|Skipped，Blocked 是吸收态：
    // 没有这条兜底，skip 根节点后编排会永远停在 Running（H1）。
    let snapshot = running(vec![
        node("n1", NodeStatus::Skipped, &[]),
        node("n2", NodeStatus::Blocked, &["n1"]),
    ]);
    assert_eq!(
        plan_tick(&snapshot),
        vec![Decision::Orchestration {
            to: OrchestrationStatus::Paused,
            reason: Some(ReasonCode::DependencyFailed),
        }]
    );
}

fn running(nodes: Vec<NodeFacts>) -> TickSnapshot {
    TickSnapshot {
        status: OrchestrationStatus::Running,
        now_ms: 0,
        max_parallel: 2,
        pty_slots: 8,
        started_at_ms: None,
        max_wall_secs: 7200,
        dispatches_used: 0,
        max_dispatches: 40,
        nodes,
    }
}

#[test]
fn existing_failure_blocks_dependents_but_does_not_repause_after_resume() {
    // 显式 resume 后：已有 failed 节点不再次触发暂停（否则 resume 永远无效），
    // 但它的下游必须 blocked；独立分支照常派发。
    let snapshot = running(vec![
        node("n1", NodeStatus::Failed, &[]),
        node("n2", NodeStatus::Pending, &["n1"]),
        node("n3", NodeStatus::Pending, &[]),
    ]);

    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Transition {
                node_key: "n2".into(),
                to: NodeStatus::Blocked,
                reason: Some(ReasonCode::DependencyFailed),
            },
            Decision::Dispatch {
                node_key: "n3".into(),
                attempt: 1,
            },
        ]
    );
}

#[test]
fn pausing_converges_to_paused_when_no_nodes_are_active() {
    let mut paused = running(vec![
        node("n1", NodeStatus::Failed, &[]),
        node("n2", NodeStatus::Blocked, &["n1"]),
    ]);
    paused.status = OrchestrationStatus::Pausing;
    assert_eq!(
        plan_tick(&paused),
        vec![Decision::Orchestration {
            to: OrchestrationStatus::Paused,
            reason: None,
        }]
    );

    let mut still_running = running(vec![node("n1", NodeStatus::Running, &[])]);
    still_running.status = OrchestrationStatus::Pausing;
    assert!(plan_tick(&still_running).is_empty());
}

#[test]
fn ready_nodes_dispatch_in_declaration_order_and_dependencies_gate() {
    let snapshot = running(vec![
        node("n1", NodeStatus::Pending, &[]),
        node("n2", NodeStatus::Pending, &["n1"]),
        node("n3", NodeStatus::Pending, &[]),
    ]);

    assert_eq!(
        plan_tick(&snapshot),
        vec![
            Decision::Dispatch {
                node_key: "n1".into(),
                attempt: 1,
            },
            Decision::Dispatch {
                node_key: "n3".into(),
                attempt: 1,
            },
        ]
    );
}

#[test]
fn resume_with_only_failed_nodes_settles_back_to_paused() {
    let snapshot = running(vec![node("n1", NodeStatus::Failed, &[])]);
    assert_eq!(
        plan_tick(&snapshot),
        vec![Decision::Orchestration {
            to: OrchestrationStatus::Paused,
            reason: Some(ReasonCode::NodeFailed),
        }]
    );
}
