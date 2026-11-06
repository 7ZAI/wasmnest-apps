//! 崩溃恢复对账：只产 KeepRunning / MarkFailed / Pause，绝不重新派发。

use super::model::{NodeStatus, ReasonCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunState {
    NotStarted,
    Running,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecoveryNode {
    pub key: String,
    pub status: NodeStatus,
    pub run_state: RunState,
    pub bridge_online: bool,
    pub send_acknowledged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecoverySnapshot {
    pub nodes: Vec<RecoveryNode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RecoveryDecision {
    KeepRunning,
    MarkFailed {
        node_key: String,
        reason: ReasonCode,
        retryable: bool,
    },
    Pause {
        reason: ReasonCode,
    },
}

pub(crate) fn recover(snapshot: &RecoverySnapshot) -> Vec<RecoveryDecision> {
    let mut decisions = Vec::new();
    let mut pause_reason = None;

    for node in &snapshot.nodes {
        let failure = match (node.status, node.run_state) {
            (NodeStatus::Dispatching, _) if !node.send_acknowledged => {
                Some((ReasonCode::DispatchUnknown, true))
            }
            // `Verifying` 阶段 run 已结束是正常路径（agent 交出结果后才收证），
            // 不能按 run 终态判死；重启后应留在 Verifying 继续从证据重建裁决。
            (NodeStatus::Dispatching, RunState::Ended)
            | (NodeStatus::Running, RunState::Ended)
            | (NodeStatus::AwaitingInput, RunState::Ended) => Some((ReasonCode::RunEnded, true)),
            (NodeStatus::Dispatching, RunState::NotStarted)
            | (NodeStatus::Running, RunState::NotStarted)
            | (NodeStatus::AwaitingInput, RunState::NotStarted) => {
                Some((ReasonCode::StatusUnknown, true))
            }
            _ => None,
        };

        if let Some((reason, retryable)) = failure {
            decisions.push(RecoveryDecision::MarkFailed {
                node_key: node.key.clone(),
                reason,
                retryable,
            });
            pause_reason.get_or_insert(reason);
            continue;
        }

        let observed = matches!(
            node.status,
            NodeStatus::Dispatching
                | NodeStatus::Running
                | NodeStatus::AwaitingInput
                | NodeStatus::Verifying
        );
        if !observed {
            continue;
        }

        decisions.push(RecoveryDecision::KeepRunning);
        if !node.bridge_online {
            pause_reason.get_or_insert(ReasonCode::BridgeOffline);
        }
    }

    if let Some(reason) = pause_reason {
        decisions.push(RecoveryDecision::Pause { reason });
    }
    decisions
}

#[cfg(test)]
mod tests;
