use super::{recover, RecoveryDecision, RecoveryNode, RecoverySnapshot, RunState};
use crate::orchestration::model::{NodeStatus, ReasonCode};

fn node(key: &str, status: NodeStatus, run_state: RunState) -> RecoveryNode {
    RecoveryNode {
        key: key.into(),
        status,
        run_state,
        bridge_online: false,
        send_acknowledged: false,
    }
}

fn snapshot(nodes: Vec<RecoveryNode>) -> RecoverySnapshot {
    RecoverySnapshot { nodes }
}

#[test]
fn dispatching_without_send_receipt_fails_and_pauses() {
    let snapshot = snapshot(vec![node("n1", NodeStatus::Dispatching, RunState::Running)]);

    assert_eq!(
        recover(&snapshot),
        vec![
            RecoveryDecision::MarkFailed {
                node_key: "n1".into(),
                reason: ReasonCode::DispatchUnknown,
                retryable: true,
            },
            RecoveryDecision::Pause {
                reason: ReasonCode::DispatchUnknown,
            },
        ]
    );
}

#[test]
fn recovery_never_redispatches_and_pauses_on_bridge_loss() {
    let mut offline = node("n1", NodeStatus::Running, RunState::Running);
    offline.send_acknowledged = true;
    let mut online = node("n2", NodeStatus::Running, RunState::Running);
    online.bridge_online = true;
    online.send_acknowledged = true;

    assert_eq!(
        recover(&snapshot(vec![offline, online])),
        vec![
            RecoveryDecision::KeepRunning,
            RecoveryDecision::KeepRunning,
            RecoveryDecision::Pause {
                reason: ReasonCode::BridgeOffline,
            },
        ]
    );
}

#[test]
fn recovery_fails_nodes_whose_run_ended_or_state_is_unknown() {
    let ended = node("n1", NodeStatus::Running, RunState::Ended);
    let unknown = node("n2", NodeStatus::AwaitingInput, RunState::NotStarted);

    assert_eq!(
        recover(&snapshot(vec![ended, unknown])),
        vec![
            RecoveryDecision::MarkFailed {
                node_key: "n1".into(),
                reason: ReasonCode::RunEnded,
                retryable: true,
            },
            RecoveryDecision::MarkFailed {
                node_key: "n2".into(),
                reason: ReasonCode::StatusUnknown,
                retryable: true,
            },
            RecoveryDecision::Pause {
                reason: ReasonCode::RunEnded,
            },
        ]
    );
}
