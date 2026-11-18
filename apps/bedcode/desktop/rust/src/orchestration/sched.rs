//! 调度决策：快照进、决策出；不碰存储、PTY 或桥接。

use std::collections::HashMap;

use super::evidence::Verdict;
use super::model::{NodeStatus, OrchestrationStatus, ReasonCode, TaskStatus};
use super::plan::scopes_overlap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeFacts {
    pub key: String,
    pub status: NodeStatus,
    pub attempt: u8,
    pub depends_on: Vec<String>,
    pub write_scope: Vec<String>,
    pub task_status: Option<TaskStatus>,
    pub dispatched_at_ms: Option<i64>,
    pub bridge_ready: bool,
    /// work order 的 send 已回执（节点 command_id 已落库）。
    /// 建 task 行时任务域即 `InProgress`，但它**不代表 prompt 已发出**；
    /// 只有拿到回执才允许离开 Dispatching。
    pub send_acknowledged: bool,
    pub timeout_secs: u64,
    pub evidence: Option<Verdict>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TickSnapshot {
    pub status: OrchestrationStatus,
    pub now_ms: i64,
    pub max_parallel: u8,
    pub pty_slots: u8,
    pub started_at_ms: Option<i64>,
    pub max_wall_secs: u64,
    pub dispatches_used: u32,
    pub max_dispatches: u32,
    pub nodes: Vec<NodeFacts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Decision {
    Dispatch {
        node_key: String,
        attempt: u8,
    },
    Transition {
        node_key: String,
        to: NodeStatus,
        reason: Option<ReasonCode>,
    },
    Fail {
        node_key: String,
        reason: ReasonCode,
        retryable: bool,
    },
    Orchestration {
        to: OrchestrationStatus,
        reason: Option<ReasonCode>,
    },
    CancelNode {
        node_key: String,
    },
}

fn is_failed_like(status: NodeStatus) -> bool {
    matches!(
        status,
        NodeStatus::Failed | NodeStatus::Cancelled | NodeStatus::Skipped
    )
}

fn is_active(status: NodeStatus) -> bool {
    matches!(
        status,
        NodeStatus::Dispatching
            | NodeStatus::Running
            | NodeStatus::AwaitingInput
            | NodeStatus::Verifying
    )
}

pub(crate) fn plan_tick(snapshot: &TickSnapshot) -> Vec<Decision> {
    let statuses: HashMap<&str, NodeStatus> = snapshot
        .nodes
        .iter()
        .map(|node| (node.key.as_str(), node.status))
        .collect();
    let mut decisions = Vec::new();

    if snapshot.status == OrchestrationStatus::Cancelling {
        let mut any_active = false;
        for node in &snapshot.nodes {
            if is_active(node.status) {
                any_active = true;
                decisions.push(Decision::CancelNode {
                    node_key: node.key.clone(),
                });
            } else if !matches!(
                node.status,
                NodeStatus::Succeeded
                    | NodeStatus::Failed
                    | NodeStatus::Cancelled
                    | NodeStatus::Skipped
            ) {
                decisions.push(Decision::Transition {
                    node_key: node.key.clone(),
                    to: NodeStatus::Cancelled,
                    reason: None,
                });
            }
        }
        if !any_active {
            decisions.push(Decision::Orchestration {
                to: OrchestrationStatus::Cancelled,
                reason: None,
            });
        }
        return decisions;
    }

    for node in &snapshot.nodes {
        use NodeStatus as N;
        use TaskStatus as T;

        if node.status == N::Verifying {
            match &node.evidence {
                Some(Verdict::Succeeded) => {
                    decisions.push(Decision::Transition {
                        node_key: node.key.clone(),
                        to: N::Succeeded,
                        reason: None,
                    });
                    continue;
                }
                Some(Verdict::Failed { reason, retryable }) => {
                    decisions.push(Decision::Fail {
                        node_key: node.key.clone(),
                        reason: *reason,
                        retryable: *retryable,
                    });
                    continue;
                }
                None => {}
            }
        }

        if let Some(started) = node.dispatched_at_ms {
            let elapsed = snapshot.now_ms - started;
            if node.status == N::Dispatching && !node.bridge_ready && elapsed > 20_000 {
                decisions.push(Decision::Fail {
                    node_key: node.key.clone(),
                    reason: ReasonCode::BridgeOffline,
                    retryable: true,
                });
                continue;
            }
            if matches!(node.status, N::Running | N::AwaitingInput)
                && elapsed > (node.timeout_secs as i64) * 1000
            {
                decisions.push(Decision::Fail {
                    node_key: node.key.clone(),
                    reason: ReasonCode::TaskTimeout,
                    retryable: true,
                });
                continue;
            }
        }

        // task 行在 run 启动、桥接探测之前就建成 `InProgress`；若此时让
        // Dispatching → Running，节点会离开补发窗口、bridge 超时也不再覆盖，
        // CLI 启动慢于 1 tick 时 prompt 永远发不出去（C2）。
        let awaiting_send = node.status == N::Dispatching && !node.send_acknowledged;
        let observed = if awaiting_send {
            None
        } else {
            match (node.status, node.task_status) {
                (N::Dispatching, Some(T::InProgress | T::Retrying)) => Some(Decision::Transition {
                    node_key: node.key.clone(),
                    to: N::Running,
                    reason: None,
                }),
                (N::Dispatching | N::Running | N::AwaitingInput, Some(T::Completed)) => {
                    Some(Decision::Transition {
                        node_key: node.key.clone(),
                        to: N::Verifying,
                        reason: None,
                    })
                }
                (N::Running | N::AwaitingInput, Some(T::Asking)) => Some(Decision::Transition {
                    node_key: node.key.clone(),
                    to: N::AwaitingInput,
                    reason: None,
                }),
                (N::Dispatching | N::Running | N::AwaitingInput, Some(T::Interrupted)) => {
                    Some(Decision::Fail {
                        node_key: node.key.clone(),
                        reason: ReasonCode::AgentInterrupted,
                        retryable: true,
                    })
                }
                _ => None,
            }
        };
        if let Some(decision) = observed {
            decisions.push(decision);
        }
    }

    for node in &snapshot.nodes {
        if node.status != NodeStatus::Pending {
            continue;
        }
        if node.depends_on.iter().any(|dep| {
            statuses
                .get(dep.as_str())
                .is_some_and(|status| is_failed_like(*status))
        }) {
            decisions.push(Decision::Transition {
                node_key: node.key.clone(),
                to: NodeStatus::Blocked,
                reason: Some(ReasonCode::DependencyFailed),
            });
        }
    }

    if snapshot.status == OrchestrationStatus::Pausing
        && !snapshot.nodes.iter().any(|node| is_active(node.status))
    {
        decisions.push(Decision::Orchestration {
            to: OrchestrationStatus::Paused,
            reason: None,
        });
        return decisions;
    }

    // 只对「本轮新失败」暂停：已有 failed 节点在显式 resume 后应允许独立分支继续收敛，
    // 否则 resume 会立刻被再次暂停，变成永远无效的按钮。
    let node_failed = decisions
        .iter()
        .any(|decision| matches!(decision, Decision::Fail { .. }));
    if snapshot.status == OrchestrationStatus::Running && node_failed {
        decisions.push(Decision::Orchestration {
            to: OrchestrationStatus::Pausing,
            reason: Some(ReasonCode::NodeFailed),
        });
    }

    if decisions
        .iter()
        .any(|decision| matches!(decision, Decision::Orchestration { .. }))
    {
        return decisions;
    }
    if snapshot.status != OrchestrationStatus::Running {
        return decisions;
    }

    if let Some(started) = snapshot.started_at_ms {
        if snapshot.now_ms - started > (snapshot.max_wall_secs as i64) * 1000 {
            decisions.push(Decision::Orchestration {
                to: OrchestrationStatus::BudgetExhausted,
                reason: Some(ReasonCode::BudgetExceeded),
            });
            for node in &snapshot.nodes {
                if is_active(node.status) {
                    decisions.push(Decision::CancelNode {
                        node_key: node.key.clone(),
                    });
                }
            }
            return decisions;
        }
    }

    let wants_more_dispatches = snapshot
        .nodes
        .iter()
        .any(|node| matches!(node.status, NodeStatus::Pending | NodeStatus::Ready));
    if wants_more_dispatches && snapshot.dispatches_used >= snapshot.max_dispatches {
        decisions.push(Decision::Orchestration {
            to: OrchestrationStatus::BudgetExhausted,
            reason: Some(ReasonCode::BudgetExceeded),
        });
        for node in &snapshot.nodes {
            if is_active(node.status) {
                decisions.push(Decision::CancelNode {
                    node_key: node.key.clone(),
                });
            }
        }
        return decisions;
    }

    let active = snapshot
        .nodes
        .iter()
        .filter(|node| is_active(node.status))
        .count();
    let mut available = (snapshot.max_parallel as usize)
        .saturating_sub(active)
        .min(snapshot.pty_slots as usize);
    let mut leased: Vec<Vec<String>> = snapshot
        .nodes
        .iter()
        .filter(|node| is_active(node.status) && !node.write_scope.is_empty())
        .map(|node| node.write_scope.clone())
        .collect();

    for node in &snapshot.nodes {
        if !matches!(node.status, NodeStatus::Pending | NodeStatus::Ready) {
            continue;
        }
        let deps_succeeded = node.depends_on.iter().all(|dep| {
            statuses
                .get(dep.as_str())
                .is_some_and(|status| *status == NodeStatus::Succeeded)
        });
        if !deps_succeeded {
            continue;
        }
        let lease_blocked = !node.write_scope.is_empty()
            && leased
                .iter()
                .any(|scope| scopes_overlap(scope, &node.write_scope));
        if available == 0 || lease_blocked {
            if node.status == NodeStatus::Pending {
                decisions.push(Decision::Transition {
                    node_key: node.key.clone(),
                    to: NodeStatus::Ready,
                    reason: None,
                });
            }
            continue;
        }
        if !node.write_scope.is_empty() {
            leased.push(node.write_scope.clone());
        }
        decisions.push(Decision::Dispatch {
            node_key: node.key.clone(),
            attempt: node.attempt + 1,
        });
        available -= 1;
    }

    if !snapshot.nodes.is_empty()
        && snapshot
            .nodes
            .iter()
            .all(|node| matches!(node.status, NodeStatus::Succeeded | NodeStatus::Skipped))
    {
        decisions.push(Decision::Orchestration {
            to: OrchestrationStatus::Completed,
            reason: None,
        });
        return decisions;
    }

    let has_ready = snapshot
        .nodes
        .iter()
        .any(|node| node.status == NodeStatus::Ready)
        || decisions.iter().any(|decision| {
            matches!(
                decision,
                Decision::Transition {
                    to: NodeStatus::Ready,
                    ..
                }
            )
        });
    let has_active_work = snapshot.nodes.iter().any(|node| is_active(node.status))
        || decisions
            .iter()
            .any(|decision| matches!(decision, Decision::Dispatch { .. }));
    if !has_ready && !has_active_work {
        let stalled: Vec<String> = snapshot
            .nodes
            .iter()
            .filter(|node| node.status == NodeStatus::Pending)
            .map(|node| node.key.clone())
            .collect();
        let has_blocked = snapshot
            .nodes
            .iter()
            .any(|node| node.status == NodeStatus::Blocked);
        if !stalled.is_empty() {
            for node_key in stalled {
                decisions.push(Decision::Transition {
                    node_key,
                    to: NodeStatus::Blocked,
                    reason: Some(ReasonCode::DeadlockSuspected),
                });
            }
            decisions.push(Decision::Orchestration {
                to: OrchestrationStatus::Paused,
                reason: Some(ReasonCode::DeadlockSuspected),
            });
        } else if has_blocked {
            // skip 后的终局（Skipped + Blocked）既不是 Completed 也没有 Pending /
            // 活跃节点：不收敛就会永远停在 Running，1Hz 空转（H1）。
            decisions.push(Decision::Orchestration {
                to: OrchestrationStatus::Paused,
                reason: Some(ReasonCode::DependencyFailed),
            });
        } else if snapshot
            .nodes
            .iter()
            .any(|node| node.status == NodeStatus::Failed)
        {
            // 失败节点已处理/独立分支都已收敛、又没有可派发工作时，resume 不应把编排
            // 留在「running 但永远无事可做」——重新落回 paused，等人 retry / skip / cancel。
            decisions.push(Decision::Orchestration {
                to: OrchestrationStatus::Paused,
                reason: Some(ReasonCode::NodeFailed),
            });
        }
    }

    decisions
}

#[cfg(test)]
mod tests;
