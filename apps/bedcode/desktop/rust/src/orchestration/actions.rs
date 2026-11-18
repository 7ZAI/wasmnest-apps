//! 动作投影：`view.actions` 是状态机唯一对外投影，前端不自行推导。

use super::model::{Action, ActionKind, NodeStatus, OrchestrationStatus, PlanMode, ReasonCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeActionFacts {
    pub key: String,
    pub status: NodeStatus,
    pub attempt: u8,
    pub max_attempts: u8,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActionFacts {
    pub status: OrchestrationStatus,
    pub mode: PlanMode,
    pub approved: bool,
    pub plan_present: bool,
    pub nodes: Vec<NodeActionFacts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeActions {
    pub node_key: String,
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfferedActions {
    pub orchestration: Vec<Action>,
    pub nodes: Vec<NodeActions>,
}

fn action(kind: ActionKind, enabled: bool, reason: Option<ReasonCode>) -> Action {
    Action {
        kind,
        enabled,
        reason,
    }
}

pub(crate) fn allowed(facts: &ActionFacts) -> OfferedActions {
    let mut orchestration = Vec::new();
    match facts.status {
        OrchestrationStatus::Draft => {
            if facts.plan_present {
                orchestration.push(action(ActionKind::EditPlan, true, None));
            }
            if facts.mode == PlanMode::Auto {
                orchestration.push(action(ActionKind::Replan, true, None));
            }
            // Planning / Draft 也必须有退出路径：否则 planner run 卡住时用户只能
            // 等超时（M1）。Cancel 会由 service 关闭 planner run 再收敛。
            orchestration.push(action(ActionKind::Cancel, true, None));
        }
        OrchestrationStatus::Planning => {
            orchestration.push(action(ActionKind::Cancel, true, None));
        }
        OrchestrationStatus::AwaitingApproval => {
            if facts.approved {
                orchestration.push(action(ActionKind::Start, true, None));
            } else {
                orchestration.push(action(ActionKind::Approve, true, None));
                orchestration.push(action(
                    ActionKind::Start,
                    false,
                    Some(ReasonCode::ApprovalRequired),
                ));
                if facts.plan_present {
                    orchestration.push(action(ActionKind::EditPlan, true, None));
                }
            }
            if facts.mode == PlanMode::Auto {
                orchestration.push(action(ActionKind::Replan, true, None));
            }
        }
        OrchestrationStatus::Running => {
            orchestration.push(action(ActionKind::Pause, true, None));
            orchestration.push(action(ActionKind::Cancel, true, None));
        }
        OrchestrationStatus::Pausing => {
            orchestration.push(action(ActionKind::Cancel, true, None));
        }
        OrchestrationStatus::Paused => {
            orchestration.push(action(ActionKind::Resume, true, None));
            orchestration.push(action(ActionKind::Cancel, true, None));
            if facts.mode == PlanMode::Auto {
                orchestration.push(action(ActionKind::Replan, true, None));
            }
        }
        _ => {}
    }

    let mut nodes = Vec::new();
    for node in &facts.nodes {
        let mut actions = Vec::new();
        if node.status == NodeStatus::Failed && facts.status == OrchestrationStatus::Paused {
            let retry = if !node.retryable {
                action(ActionKind::RetryNode, false, Some(ReasonCode::NotRetryable))
            } else if node.attempt >= node.max_attempts {
                action(
                    ActionKind::RetryNode,
                    false,
                    Some(ReasonCode::AttemptsExhausted),
                )
            } else {
                action(ActionKind::RetryNode, true, None)
            };
            actions.push(retry);
        }
        if matches!(
            node.status,
            NodeStatus::Pending | NodeStatus::Ready | NodeStatus::Failed | NodeStatus::Blocked
        ) && matches!(
            facts.status,
            OrchestrationStatus::Running
                | OrchestrationStatus::Pausing
                | OrchestrationStatus::Paused
        ) {
            actions.push(action(ActionKind::SkipNode, true, None));
        }
        if !actions.is_empty() {
            nodes.push(NodeActions {
                node_key: node.key.clone(),
                actions,
            });
        }
    }

    OfferedActions {
        orchestration,
        nodes,
    }
}

#[cfg(test)]
mod tests;
