use super::{allowed, ActionFacts, NodeActionFacts, NodeActions, OfferedActions};
use crate::orchestration::model::{
    Action, ActionKind, NodeStatus, OrchestrationStatus, PlanMode, ReasonCode,
};

fn action(kind: ActionKind, enabled: bool, reason: Option<ReasonCode>) -> Action {
    Action {
        kind,
        enabled,
        reason,
    }
}

fn facts(status: OrchestrationStatus, approved: bool) -> ActionFacts {
    ActionFacts {
        status,
        mode: PlanMode::Manual,
        approved,
        plan_present: true,
        nodes: vec![],
    }
}

fn node(key: &str, status: NodeStatus) -> NodeActionFacts {
    NodeActionFacts {
        key: key.into(),
        status,
        attempt: 1,
        max_attempts: 2,
        retryable: true,
    }
}

#[test]
fn awaiting_approval_gates_start_on_approval() {
    assert_eq!(
        allowed(&facts(OrchestrationStatus::AwaitingApproval, false)),
        OfferedActions {
            orchestration: vec![
                action(ActionKind::Approve, true, None),
                action(ActionKind::Start, false, Some(ReasonCode::ApprovalRequired)),
                action(ActionKind::EditPlan, true, None),
            ],
            nodes: vec![],
        }
    );

    assert_eq!(
        allowed(&facts(OrchestrationStatus::AwaitingApproval, true)).orchestration,
        vec![action(ActionKind::Start, true, None)]
    );
}

#[test]
fn running_and_paused_expose_control_actions() {
    assert_eq!(
        allowed(&facts(OrchestrationStatus::Running, true)).orchestration,
        vec![
            action(ActionKind::Pause, true, None),
            action(ActionKind::Cancel, true, None),
        ]
    );
    assert_eq!(
        allowed(&facts(OrchestrationStatus::Paused, true)).orchestration,
        vec![
            action(ActionKind::Resume, true, None),
            action(ActionKind::Cancel, true, None),
        ]
    );
}

#[test]
fn node_retry_is_bounded_and_respects_retryability() {
    let mut paused = facts(OrchestrationStatus::Paused, true);
    paused.nodes = vec![
        node("ok", NodeStatus::Failed),
        node("exhausted", NodeStatus::Failed),
        node("violating", NodeStatus::Failed),
    ];
    paused.nodes[1].attempt = 2;
    paused.nodes[2].retryable = false;

    assert_eq!(
        allowed(&paused).nodes,
        vec![
            NodeActions {
                node_key: "ok".into(),
                actions: vec![
                    action(ActionKind::RetryNode, true, None),
                    action(ActionKind::SkipNode, true, None),
                ],
            },
            NodeActions {
                node_key: "exhausted".into(),
                actions: vec![
                    action(
                        ActionKind::RetryNode,
                        false,
                        Some(ReasonCode::AttemptsExhausted)
                    ),
                    action(ActionKind::SkipNode, true, None),
                ],
            },
            NodeActions {
                node_key: "violating".into(),
                actions: vec![
                    action(ActionKind::RetryNode, false, Some(ReasonCode::NotRetryable)),
                    action(ActionKind::SkipNode, true, None),
                ],
            },
        ]
    );
}

#[test]
fn terminal_states_offer_no_actions() {
    for status in [
        OrchestrationStatus::Completed,
        OrchestrationStatus::Cancelled,
        OrchestrationStatus::Failed,
        OrchestrationStatus::BudgetExhausted,
    ] {
        assert_eq!(
            allowed(&facts(status, true)),
            OfferedActions {
                orchestration: vec![],
                nodes: vec![],
            },
            "status {status:?}"
        );
    }
}

/// `Cancelling` 是**非终态**（tick 仍需收敛节点与 run），只是不再提供新动作。
/// 把它混进终态列表会掩盖 H3 的收敛路径。
#[test]
fn cancelling_is_non_terminal_but_offers_no_new_actions() {
    assert_eq!(
        allowed(&facts(OrchestrationStatus::Cancelling, true)),
        OfferedActions {
            orchestration: vec![],
            nodes: vec![],
        }
    );
}

#[test]
fn planning_and_draft_expose_cancel_so_a_stuck_planner_can_be_stopped() {
    assert_eq!(
        allowed(&facts(OrchestrationStatus::Planning, true)).orchestration,
        vec![action(ActionKind::Cancel, true, None)]
    );
    let draft = allowed(&facts(OrchestrationStatus::Draft, true)).orchestration;
    assert!(draft.contains(&action(ActionKind::Cancel, true, None)));
}
