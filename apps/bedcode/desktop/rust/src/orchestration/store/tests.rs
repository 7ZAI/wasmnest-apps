use super::{
    Budget, EventDraft, EvidenceKind, EvidenceRecord, MemoryStore, NodeRecord, OrchStore,
    OrchestrationRecord,
};
use crate::orchestration::model::{
    Acceptance, EventKind, NodeStatus, OrchestrationStatus, Plan, PlanMode, Role,
};

fn orchestration(id: &str) -> OrchestrationRecord {
    OrchestrationRecord {
        id: id.to_string(),
        project_id: "p1".to_string(),
        title: "编排".to_string(),
        goal: "目标".to_string(),
        mode: PlanMode::Manual,
        require_approval: true,
        orchestrator_agent_id: None,
        status: OrchestrationStatus::AwaitingApproval,
        plan: Some(plan()),
        plan_rev: 1,
        plan_error: None,
        planner_output: None,
        max_parallel: 2,
        budget: Budget {
            max_wall_seconds: 7200,
            max_dispatches: 3,
        },
        planner_run_id: None,
        planner_agent_id: None,
        planner_agent: None,
        planner_command_id: None,
        planner_control_command_id: None,
        planner_dispatched_at: None,
        planner_task_row_created: false,
        approved_at: None,
        approved_plan_rev: None,
        failure_reason: None,
        created_at: "2026-11-05T00:00:00Z".to_string(),
        updated_at: "2026-11-05T00:00:00Z".to_string(),
        started_at: None,
        ended_at: None,
    }
}

fn plan() -> Plan {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/orchestration-plan.v2.json"
    )))
    .expect("golden fixture parses")
}

fn node(orchestration_id: &str, key: &str) -> NodeRecord {
    NodeRecord {
        id: format!("{orchestration_id}:{key}"),
        orchestration_id: orchestration_id.to_string(),
        key: key.to_string(),
        title: key.to_string(),
        role: Role::Coder,
        agent_id: "pi".to_string(),
        agent_ref: "ap-frontend".to_string(),
        agent_snapshot: None,
        match_reason: "test".to_string(),
        prompt: "do it".to_string(),
        depends_on: vec![],
        write_scope: vec!["src".to_string()],
        acceptance: Acceptance::None,
        status: NodeStatus::Pending,
        attempt: 0,
        max_attempts: 2,
        run_id: None,
        command_id: None,
        control_command_id: None,
        lease: None,
        pre_snapshot: None,
        task_row_created: false,
        retryable: true,
        failure_reason: None,
        dispatched_at: None,
        verifying_started_at: None,
        cancel_requested_at: None,
        started_at: None,
        ended_at: None,
    }
}

#[test]
fn orchestration_and_nodes_roundtrip_through_the_store() {
    let store = MemoryStore::default();
    store.ensure_schema().unwrap();
    store.put(&orchestration("o1")).unwrap();
    store.put(&orchestration("o2")).unwrap();
    store.put_node(&node("o1", "n1")).unwrap();
    store.put_node(&node("o1", "n2")).unwrap();

    let loaded = store.get("o1").unwrap().expect("orchestration exists");
    assert_eq!(loaded.plan.as_ref().unwrap().nodes.len(), 2);
    assert_eq!(loaded.budget.max_dispatches, 3);
    assert!(!loaded.approved(), "未批准时 approved() 必须为 false");

    let mut approved = loaded.clone();
    approved.approved_plan_rev = Some(approved.plan_rev);
    store.put(&approved).unwrap();
    assert!(store.get("o1").unwrap().unwrap().approved());

    let nodes = store.nodes("o1").unwrap();
    assert_eq!(
        nodes
            .iter()
            .map(|node| node.key.as_str())
            .collect::<Vec<_>>(),
        vec!["n1", "n2"]
    );

    assert_eq!(store.list(None).unwrap().len(), 2);
    assert_eq!(store.list(Some("p1")).unwrap().len(), 2);
    assert!(store.list(Some("other")).unwrap().is_empty());
}

#[test]
fn approval_is_invalidated_by_a_new_plan_revision() {
    let store = MemoryStore::default();
    let mut record = orchestration("o1");
    record.approved_plan_rev = Some(record.plan_rev);
    store.put(&record).unwrap();
    assert!(store.get("o1").unwrap().unwrap().approved());

    record.plan_rev += 1;
    record.approved_at = None;
    store.put(&record).unwrap();
    assert!(!store.get("o1").unwrap().unwrap().approved());
}

#[test]
fn dispatch_claim_is_unique_per_attempt() {
    let store = MemoryStore::default();
    let first = store
        .claim_dispatch(
            "o1",
            "n1",
            1,
            serde_json::json!({"runId": "r1"}),
            "2026-11-05T00:00:01Z",
        )
        .unwrap();
    assert_eq!(first, Some(1));

    let replay = store
        .claim_dispatch(
            "o1",
            "n1",
            1,
            serde_json::json!({"runId": "r1"}),
            "2026-11-05T00:00:02Z",
        )
        .unwrap();
    assert_eq!(replay, None, "重复 tick 不得重复占位");

    let retry = store
        .claim_dispatch(
            "o1",
            "n1",
            2,
            serde_json::json!({"runId": "r2"}),
            "2026-11-05T00:00:03Z",
        )
        .unwrap();
    assert_eq!(retry, Some(2), "新 attempt 必须可以重新占位");

    let events = store.events("o1", 0, 100).unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == EventKind::Dispatched)
            .count(),
        2
    );
}

#[test]
fn events_are_sequential_and_cursor_filtered() {
    let store = MemoryStore::default();
    let seq = store
        .append_event(
            "o1",
            EventDraft {
                kind: EventKind::Created,
                node_key: None,
                attempt: None,
                payload: serde_json::json!({}),
                at: "2026-11-05T00:00:00Z".to_string(),
            },
        )
        .unwrap();
    assert_eq!(seq, 1);
    let seq = store
        .append_event(
            "o1",
            EventDraft {
                kind: EventKind::PlanSaved,
                node_key: None,
                attempt: None,
                payload: serde_json::json!({"planRev": 1}),
                at: "2026-11-05T00:00:01Z".to_string(),
            },
        )
        .unwrap();
    assert_eq!(seq, 2);

    assert_eq!(store.events("o1", 0, 100).unwrap().len(), 2);
    let tail = store.events("o1", 1, 100).unwrap();
    assert_eq!(tail.len(), 1);
    assert_eq!(tail[0].seq, 2);
    assert_eq!(tail[0].kind, EventKind::PlanSaved);
}

#[test]
fn replace_nodes_swaps_the_plan_projection() {
    let store = MemoryStore::default();
    store.put_node(&node("o1", "old")).unwrap();
    let mut replacement = node("o1", "new");
    replacement.status = NodeStatus::Ready;
    store.replace_nodes("o1", &[replacement]).unwrap();

    let nodes = store.nodes("o1").unwrap();
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].key, "new");
    assert_eq!(nodes[0].status, NodeStatus::Ready);
}

#[test]
fn evidence_roundtrips_per_attempt() {
    let store = MemoryStore::default();
    store
        .append_evidence(&EvidenceRecord {
            id: "e1".to_string(),
            orchestration_id: "o1".to_string(),
            node_key: "n1".to_string(),
            attempt: 1,
            kind: EvidenceKind::Command,
            payload: serde_json::json!({"exitCode": 0, "timedOut": false, "outputTail": "ok"}),
            at: "2026-11-05T00:00:00Z".to_string(),
        })
        .unwrap();

    let evidence = store.evidence("o1").unwrap();
    assert_eq!(evidence.len(), 1);
    assert_eq!(evidence[0].kind, EvidenceKind::Command);
    assert_eq!(evidence[0].attempt, 1);
}
