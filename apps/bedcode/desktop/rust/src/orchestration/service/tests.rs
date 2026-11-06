use std::cell::RefCell;
use std::collections::BTreeMap;

use serde_json::Value;

use super::{
    approve, cancel, create, get, list, pause, recover_all, resume, retry_node, skip_node, start,
    start_planning, tick, update_plan, CreateInput, ProjectInfo, RuntimePort,
};
use crate::agent_pool::model::AgentProfile;
use crate::orchestration::dispatch::{CommandState, DispatchPort, DispatchRequest};
use crate::orchestration::evidence::{CommandResult, EvidencePort, FileFingerprint, GitSnapshot};
use crate::orchestration::model::{
    Acceptance, EventKind, NodeStatus, OrchestrationStatus, Plan, PlanMode, ReasonCode, TaskStatus,
};
use crate::orchestration::recover::RunState;
use crate::orchestration::store::{MemoryStore, OrchStore};

fn t(second: u32) -> String {
    format!("2026-11-05T00:00:{second:02}Z")
}

fn golden_plan() -> Plan {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/orchestration-plan.v2.json"
    )))
    .expect("golden fixture parses")
}

fn single_node_plan(write_scope: &[&str], max_attempts: u8) -> Plan {
    let mut plan = golden_plan();
    plan.nodes.truncate(1);
    plan.nodes[0].depends_on.clear();
    plan.nodes[0].acceptance = Acceptance::None;
    plan.nodes[0].write_scope = write_scope.iter().map(|scope| scope.to_string()).collect();
    plan.nodes[0].max_attempts = max_attempts;
    plan
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

fn test_profiles() -> Vec<AgentProfile> {
    let profile = |id: &str, name: &str, cli: &str, model: Option<&str>, level: Option<&str>, can_orchestrate: bool| {
        AgentProfile {
            id: id.to_string(),
            name: name.to_string(),
            cli: cli.to_string(),
            model: model.map(str::to_string),
            thinking_level: level.map(str::to_string),
            tags: vec!["test".to_string()],
            specialties: vec![name.to_string()],
            description: format!("{name}的职责描述"),
            can_orchestrate,
            enabled: true,
            created_at: "2026-11-05T00:00:00Z".to_string(),
            updated_at: "2026-11-05T00:00:00Z".to_string(),
        }
    };
    vec![
        profile(
            "ap-frontend",
            "前端实现",
            "pi",
            Some("anthropic/claude-sonnet-4.5"),
            Some("high"),
            false,
        ),
        profile("ap-reviewer", "独立评审", "opencode", None, None, false),
        profile("ap-orchestrator", "编排", "pi", None, None, true),
    ]
}

#[derive(Default)]
struct FakeRuntime {
    project: Option<ProjectInfo>,
    is_git: bool,
    snapshot: RefCell<GitSnapshot>,
    task_status: RefCell<Option<TaskStatus>>,
    bridge_ready: RefCell<bool>,
    slots: u8,
    runs: RefCell<Vec<String>>,
    task_rows: RefCell<usize>,
    sent: RefCell<Vec<String>>,
    commands: RefCell<Vec<Vec<String>>>,
    interrupted: RefCell<Vec<String>>,
    closed: RefCell<Vec<String>>,
    /// 模拟 run 已回收 / 宿主重启时的宿主动作失败（H3 回归）
    interrupt_error: RefCell<Option<String>>,
    assistant_text: RefCell<Option<String>>,
    command_result: CommandResult,
    run_state: RefCell<Option<RunState>>,
    profiles: Vec<AgentProfile>,
    control_commands: RefCell<Vec<(String, Option<String>, Option<String>)>>,
    control_state: CommandState,
    control_state_error: RefCell<Option<String>>,
    /// 单节点 task_status 探测失败（M6 回归）
    task_status_error: RefCell<Option<String>>,
}

impl FakeRuntime {
    fn ready() -> Self {
        Self {
            project: Some(ProjectInfo {
                name: "项目".to_string(),
                working_dir: "/repo".to_string(),
            }),
            is_git: true,
            bridge_ready: RefCell::new(true),
            slots: 4,
            command_result: CommandResult {
                exit_code: Some(0),
                timed_out: false,
                output_tail: "ok".to_string(),
            },
            profiles: test_profiles(),
            control_state: CommandState::Done,
            ..Self::default()
        }
    }
}

impl DispatchPort for FakeRuntime {
    fn start_run(&self, _project_id: &str, _agent_id: &str) -> Result<String, String> {
        let mut runs = self.runs.borrow_mut();
        let run_id = format!("run-{}", runs.len() + 1);
        runs.push(run_id.clone());
        Ok(run_id)
    }

    fn create_task_row(
        &self,
        _run_id: &str,
        _prompt: &str,
        _agent_id: &str,
        _source: &str,
    ) -> Result<(), String> {
        *self.task_rows.borrow_mut() += 1;
        Ok(())
    }

    fn bridge_ready(&self, _run_id: &str) -> Result<bool, String> {
        Ok(*self.bridge_ready.borrow())
    }

    fn enqueue_agent_control(
        &self,
        run_id: &str,
        model: Option<&str>,
        thinking_level: Option<&str>,
    ) -> Result<i64, String> {
        let mut commands = self.control_commands.borrow_mut();
        commands.push((
            run_id.to_string(),
            model.map(str::to_string),
            thinking_level.map(str::to_string),
        ));
        Ok(commands.len() as i64)
    }

    fn command_state(
        &self,
        _run_id: &str,
        _command_id: i64,
    ) -> Result<Option<CommandState>, String> {
        if let Some(error) = self.control_state_error.borrow().clone() {
            return Err(error);
        }
        Ok(Some(self.control_state.clone()))
    }

    fn send(&self, _run_id: &str, text: &str) -> Result<i64, String> {
        self.sent.borrow_mut().push(text.to_string());
        Ok(self.sent.borrow().len() as i64)
    }

    fn converge_task(&self, _run_id: &str, _reason: &str) -> Result<(), String> {
        Ok(())
    }

    fn interrupt(&self, run_id: &str) -> Result<(), String> {
        self.interrupted.borrow_mut().push(run_id.to_string());
        match self.interrupt_error.borrow().clone() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn close(&self, run_id: &str) -> Result<(), String> {
        self.closed.borrow_mut().push(run_id.to_string());
        Ok(())
    }
}

impl EvidencePort for FakeRuntime {
    fn git_status(&self, _working_dir: &str, _timeout_secs: u64) -> Result<GitSnapshot, String> {
        Ok(self.snapshot.borrow().clone())
    }

    fn run_command(
        &self,
        _working_dir: &str,
        _cwd: Option<&str>,
        argv: &[String],
        _timeout_secs: u64,
    ) -> Result<CommandResult, String> {
        self.commands.borrow_mut().push(argv.to_vec());
        Ok(self.command_result.clone())
    }

    fn last_assistant_text(&self, _run_id: &str) -> Result<Option<String>, String> {
        Ok(self.assistant_text.borrow().clone())
    }
}

impl RuntimePort for FakeRuntime {
    fn project(&self, _project_id: &str) -> Result<Option<ProjectInfo>, String> {
        Ok(self.project.clone())
    }

    fn is_git_repo(&self, _working_dir: &str) -> Result<bool, String> {
        Ok(self.is_git)
    }

    fn task_status(&self, _run_id: &str) -> Result<Option<TaskStatus>, String> {
        if let Some(error) = self.task_status_error.borrow().clone() {
            return Err(error);
        }
        Ok(*self.task_status.borrow())
    }

    fn run_active(&self, _run_id: &str) -> Result<bool, String> {
        Ok(true)
    }

    fn run_state(&self, _run_id: &str) -> Result<RunState, String> {
        Ok(self.run_state.borrow().unwrap_or(RunState::Running))
    }

    fn agent_ready(&self, _agent_id: &str) -> Result<bool, String> {
        Ok(true)
    }

    fn agent_profiles(&self) -> Result<Vec<AgentProfile>, String> {
        Ok(self.profiles.clone())
    }

    fn pty_slots(&self) -> Result<u8, String> {
        Ok(self.slots)
    }
}

fn create_input(id: &str, plan: Plan, mode: PlanMode) -> CreateInput {
    CreateInput {
        id: id.to_string(),
        project_id: "p1".to_string(),
        title: "编排".to_string(),
        goal: "完成目标".to_string(),
        mode,
        orchestrator_agent_id: Some("ap-orchestrator".to_string()),
        require_approval: true,
        plan: Some(plan),
    }
}

fn node_status(store: &MemoryStore, id: &str, key: &str) -> NodeStatus {
    store
        .get_node(id, key)
        .unwrap()
        .expect("node exists")
        .status
}

fn tick_all(store: &MemoryStore, ports: &FakeRuntime, now: &str) {
    let report = tick(store, ports, now).unwrap();
    assert!(report.errors.is_empty(), "tick errors: {:?}", report.errors);
}

#[test]
fn create_approve_start_tick_closes_the_loop() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = golden_plan();

    let created = create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    assert_eq!(created["status"], "awaiting-approval");

    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["orchestration"]["approved"], false);
    assert_eq!(view["actions"]["orchestration"][0]["kind"], "approve");

    let approved = approve(&store, "o1", &t(1)).unwrap();
    assert_eq!(approved["status"], "awaiting-approval");
    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["orchestration"]["approved"], true);
    assert_eq!(view["actions"]["orchestration"][0]["kind"], "start");

    start(&store, &ports, "o1", &t(2)).unwrap();

    // 1) 派发 n1：第一拍建 run + task 行并入队 profile 控制命令
    tick_all(&store, &ports, &t(3));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);
    assert_eq!(ports.runs.borrow().len(), 1);
    assert_eq!(*ports.task_rows.borrow(), 1);
    assert_eq!(ports.control_commands.borrow().len(), 1);
    assert!(
        ports.sent.borrow().is_empty(),
        "work order must wait for the profile receipt"
    );

    // 2) 控制命令回执 done → 发 work order
    tick_all(&store, &ports, &t(4));
    assert_eq!(ports.sent.borrow().len(), 1);
    assert!(ports.sent.borrow()[0].contains("BEDCODE WORK ORDER"));
    assert!(ports.sent.borrow()[0].contains("node: n1 / attempt: 1"));

    // 3) 回合进行中 → running
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(5));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Running);

    // 4) 回合结束 → verifying（证据在下一 tick 收集）
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(6));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Verifying);

    // 5) 写集内改动 + 验收 exit 0 → succeeded
    *ports.snapshot.borrow_mut() = snapshot(&[("apps/file-transfer/desktop/src/a.rs", "v1")]);
    tick_all(&store, &ports, &t(7));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Succeeded);

    // 6) n2（reviewer，无 profile 控制）派发：依赖已成功
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(8));
    assert_eq!(node_status(&store, "o1", "n2"), NodeStatus::Dispatching);
    assert_eq!(ports.runs.borrow().len(), 2);

    *ports.assistant_text.borrow_mut() = Some("review done.\nVERDICT: PASS".to_string());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(9));
    assert_eq!(node_status(&store, "o1", "n2"), NodeStatus::Verifying);

    // 6) reviewer 的 VERDICT: PASS → succeeded → 编排 completed
    tick_all(&store, &ports, &t(9));
    assert_eq!(node_status(&store, "o1", "n2"), NodeStatus::Succeeded);
    tick_all(&store, &ports, &t(10));

    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["orchestration"]["status"], "completed");
    assert!(view["orchestration"]["endedAt"].is_string());

    let evidence = view["evidence"].as_array().expect("evidence array");
    assert!(evidence.iter().any(|item| item["nodeKey"] == "n2"
        && item["kind"] == "verdict"
        && item["payload"]["verdict"] == "pass"));
    assert!(evidence.iter().any(|item| item["nodeKey"] == "n1"
        && item["kind"] == "command"
        && item["payload"]["exitCode"] == 0));

    let kinds: Vec<String> = store
        .events("o1", 0, 1000)
        .unwrap()
        .into_iter()
        .map(|event| event.kind.as_str().to_string())
        .collect();
    for expected in [
        "created",
        "plan_saved",
        "approved",
        "started",
        "dispatched",
        "node_running",
        "verifying",
        "node_succeeded",
        "completed",
    ] {
        assert!(
            kinds.contains(&expected.to_string()),
            "missing {expected}: {kinds:?}"
        );
    }
}

#[test]
fn start_requires_approval_and_a_clean_working_tree() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();

    let error = start(&store, &ports, "o1", &t(1)).unwrap_err();
    assert!(error.starts_with("approval-required:"), "{error}");

    approve(&store, "o1", &t(2)).unwrap();
    *ports.snapshot.borrow_mut() = snapshot(&[("src/leftover.rs", "dirty")]);
    let error = start(&store, &ports, "o1", &t(3)).unwrap_err();
    assert!(error.starts_with("working-tree-dirty:"), "{error}");

    // agent 集成目录不算脏
    *ports.snapshot.borrow_mut() = snapshot(&[(".pi/extensions/bridge.ts", "generated")]);
    start(&store, &ports, "o1", &t(4)).unwrap();
}

#[test]
fn update_plan_bumps_revision_and_invalidates_approval() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    assert!(store.get("o1").unwrap().unwrap().approved());

    update_plan(&store, &ports, "o1", &golden_plan(), &t(2)).unwrap();
    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.plan_rev, 2);
    assert!(!record.approved());
    let error = start(&store, &ports, "o1", &t(3)).unwrap_err();
    assert!(error.starts_with("approval-required:"), "{error}");

    let mut invalid = golden_plan();
    invalid.nodes[0].depends_on = vec!["n2".into()];
    invalid.nodes[1].depends_on = vec!["n1".into()];
    let receipt = update_plan(&store, &ports, "o1", &invalid, &t(4)).unwrap();
    assert_eq!(receipt["status"], "draft");
    assert!(receipt["planError"].is_array());
}

#[test]
fn scope_violation_fails_the_node_and_is_not_retryable() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 2);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    tick_all(&store, &ports, &t(3));
    *ports.snapshot.borrow_mut() = snapshot(&[("secret.txt", "leak")]);
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(4)); // → verifying
    tick_all(&store, &ports, &t(5)); // 证据 → scope-violation
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Failed);
    let node = store.get_node("o1", "n1").unwrap().unwrap();
    assert_eq!(node.failure_reason, Some(ReasonCode::ScopeViolation));
    assert!(!node.retryable);

    tick_all(&store, &ports, &t(6)); // pausing → paused
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Paused
    );
    let error = retry_node(&store, &ports, "o1", "n1", &t(7)).unwrap_err();
    assert!(error.starts_with("not-retryable:"), "{error}");
}

#[test]
fn cancel_propagates_to_active_nodes_after_the_grace_window() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 1);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();
    tick_all(&store, &ports, &t(3));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);

    cancel(&store, &ports, "o1", &t(4)).unwrap();
    tick_all(&store, &ports, &t(5)); // 第一轮 Ctrl-C
    assert_eq!(ports.interrupted.borrow().len(), 1);

    tick_all(&store, &ports, &t(6)); // 宽限期内
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);

    tick_all(&store, &ports, &t(20)); // 超过 10s 宽限 → 强停
    assert_eq!(ports.closed.borrow().len(), 1);
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Cancelled);
    tick_all(&store, &ports, &t(21));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Cancelled
    );
}

#[test]
fn pause_resume_and_skip_are_projected_into_actions() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 1);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();
    tick_all(&store, &ports, &t(3));

    let view = get(&store, &ports, "o1").unwrap();
    let kinds: Vec<&str> = view["actions"]["orchestration"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|action| action["kind"].as_str())
        .collect();
    assert!(kinds.contains(&"pause"));
    assert!(kinds.contains(&"cancel"));

    pause(&store, "o1", &t(4)).unwrap();
    tick_all(&store, &ports, &t(5)); // 等 n1 收敛（仍在 running）
    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["orchestration"]["status"], "pausing");

    // 手动把节点收敛成 succeeded 后，pausing → paused
    let mut node = store.get_node("o1", "n1").unwrap().unwrap();
    node.status = NodeStatus::Succeeded;
    store.put_node(&node).unwrap();
    tick_all(&store, &ports, &t(6));
    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["orchestration"]["status"], "paused");

    let resumed = resume(&store, "o1", &t(7)).unwrap();
    assert_eq!(resumed["status"], "running");
}

#[test]
fn skip_node_marks_it_skipped_and_releases_the_lease() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 1);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    // 依赖未满足的 pending 节点可跳过
    let receipt = skip_node(&store, "o1", "n1", &t(3)).unwrap();
    assert_eq!(receipt["status"], "running");
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Skipped);
    tick_all(&store, &ports, &t(4));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Completed
    );
}

#[test]
fn list_returns_progress_and_participants() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    let listed = list(&store, &ports, Some("p1")).unwrap();
    let item = &listed["orchestrations"][0];
    assert_eq!(item["projectName"], "项目");
    assert_eq!(item["nodeCount"], 2);
    assert_eq!(item["agents"], serde_json::json!(["pi", "opencode"]));
}

#[test]
fn auto_mode_rejects_non_whitelisted_commands_at_plan_save() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let mut plan = golden_plan();
    plan.nodes[0].acceptance = Acceptance::Command {
        command: vec!["rm".into(), "-rf".into(), "/".into()],
        cwd: None,
        timeout_sec: None,
    };
    let receipt = create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Auto),
        &t(0),
    )
    .unwrap();
    assert_eq!(receipt["status"], "draft");
    assert!(receipt["planError"].is_array());
}

#[test]
fn missing_project_is_rejected() {
    let store = MemoryStore::default();
    let mut ports = FakeRuntime::ready();
    ports.project = None;
    let error = create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap_err();
    assert!(error.starts_with("run-start-failed:"), "{error}");
}

// 让 `Value` 的断言错误信息可读（json! 比较失败时打印实际值）
#[allow(dead_code)]
fn debug(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

#[test]
fn auto_planning_produces_a_plan_and_waits_for_approval() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let created = create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: true,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    assert_eq!(created["status"], "draft");

    let started = start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    assert_eq!(started["status"], "planning");
    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.planner_agent_id.as_deref(), Some("pi"));
    assert_eq!(
        record.planner_agent.as_ref().map(|agent| agent.profile_id.as_str()),
        Some("ap-orchestrator")
    );
    assert_eq!(record.plan_rev, 2);
    assert_eq!(ports.runs.borrow().len(), 1);
    assert_eq!(*ports.task_rows.borrow(), 1);

    tick_all(&store, &ports, &t(2));
    assert!(ports.sent.borrow()[0].contains("BEDCODE ORCHESTRATION SKILL v1"));

    let json = serde_json::to_string(&golden_plan()).unwrap();
    *ports.assistant_text.borrow_mut() = Some(format!("```json\n{json}\n```"));
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::AwaitingApproval);
    assert_eq!(record.plan.as_ref().unwrap().nodes.len(), 2);
    assert!(!record.approved());
    assert!(record.plan_error.is_none());
    assert!(record.planner_output.is_none());
    assert_eq!(store.nodes("o1").unwrap().len(), 2);

    let view = get(&store, &ports, "o1").unwrap();
    assert_eq!(view["actions"]["orchestration"][0]["kind"], "approve");
}

#[test]
fn invalid_planner_output_falls_back_to_draft_with_the_raw_text() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: true,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));

    *ports.assistant_text.borrow_mut() = Some("not a plan".to_string());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::Draft);
    assert_eq!(record.failure_reason, Some(ReasonCode::PlannerInvalidJson));
    assert_eq!(
        record.plan_error.as_ref().unwrap()[0].code,
        "planner-invalid-json"
    );
    assert_eq!(record.planner_output.as_deref(), Some("not a plan"));
    assert!(record.plan.is_none());
}

#[test]
fn planner_plan_failing_validation_keeps_the_parsed_plan_for_editing() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: true,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));

    let mut invalid = golden_plan();
    invalid.nodes[0].write_scope = vec!["../escape".into()];
    *ports.assistant_text.borrow_mut() = Some(serde_json::to_string(&invalid).unwrap());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::Draft);
    assert!(record.plan.is_some(), "解析成功的计划保留供人工修改");
    assert!(record
        .plan_error
        .as_ref()
        .unwrap()
        .iter()
        .any(|error| error.code == "invalid-write-scope"));
}

#[test]
fn manual_orchestrations_reject_auto_planning() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    let error = start_planning(&store, &ports, "o1", None, &t(1)).unwrap_err();
    assert!(error.starts_with("plan-invalid:"), "{error}");
}

#[test]
fn recovery_marks_ended_runs_failed_and_pauses_without_resending() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 1);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    let mut node = store.get_node("o1", "n1").unwrap().unwrap();
    node.status = NodeStatus::Running;
    node.attempt = 1;
    node.run_id = Some("run-1".to_string());
    node.command_id = Some(7);
    store.put_node(&node).unwrap();
    *ports.run_state.borrow_mut() = Some(RunState::Ended);

    let report = recover_all(&store, &ports, &t(3)).unwrap();
    assert_eq!(report.checked, 1);
    assert_eq!(report.failed_nodes, 1);
    assert_eq!(report.paused, 1);

    let node = store.get_node("o1", "n1").unwrap().unwrap();
    assert_eq!(node.status, NodeStatus::Failed);
    assert_eq!(node.failure_reason, Some(ReasonCode::RunEnded));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Paused
    );
    assert!(
        ports.sent.borrow().is_empty(),
        "恢复只对账，不得重发 prompt"
    );
}

#[test]
fn recovery_keeps_live_runs_running() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let plan = single_node_plan(&["src"], 1);
    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    let mut node = store.get_node("o1", "n1").unwrap().unwrap();
    node.status = NodeStatus::Running;
    node.attempt = 1;
    node.run_id = Some("run-1".to_string());
    node.command_id = Some(7);
    store.put_node(&node).unwrap();
    *ports.run_state.borrow_mut() = Some(RunState::Running);

    let report = recover_all(&store, &ports, &t(3)).unwrap();
    assert_eq!(report.failed_nodes, 0);
    assert_eq!(report.paused, 0);
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Running
    );
    assert_eq!(
        store.get_node("o1", "n1").unwrap().unwrap().status,
        NodeStatus::Running
    );
}

#[test]
fn recovery_fails_planning_when_the_planner_run_ended() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: true,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    *ports.run_state.borrow_mut() = Some(RunState::Ended);

    let report = recover_all(&store, &ports, &t(2)).unwrap();
    assert_eq!(report.checked, 1);
    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::Draft);
    assert_eq!(record.failure_reason, Some(ReasonCode::PlannerFailed));
}

#[test]
fn slow_bridge_still_sends_the_work_order_on_a_later_tick() {
    let store = MemoryStore::default();
    let ports = FakeRuntime {
        bridge_ready: RefCell::new(false),
        ..FakeRuntime::ready()
    };
    create(
        &store,
        &ports,
        create_input("o1", single_node_plan(&["src"], 1), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    tick_all(&store, &ports, &t(3));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);
    assert!(ports.sent.borrow().is_empty());

    // 真实环境里 task 行在 send 之前就是 InProgress（C2 的触发条件）
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(4));
    assert_eq!(
        node_status(&store, "o1", "n1"),
        NodeStatus::Dispatching,
        "unsent node must stay in the resend window"
    );

    *ports.bridge_ready.borrow_mut() = true;
    tick_all(&store, &ports, &t(6)); // agent-control 入队
    tick_all(&store, &ports, &t(7)); // 回执 done → send
    assert_eq!(ports.sent.borrow().len(), 1, "prompt must be sent after the bridge is ready");
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Running);
}

#[test]
fn skipping_a_root_node_skips_its_downstream_chain_and_completes() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    skip_node(&store, "o1", "n1", &t(3)).unwrap();
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Skipped);
    assert_eq!(node_status(&store, "o1", "n2"), NodeStatus::Skipped);
    tick_all(&store, &ports, &t(4));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Completed
    );
}

#[test]
fn retrying_a_failed_node_unblocks_its_dependents() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", golden_plan(), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    let mut failed = store.get_node("o1", "n1").unwrap().unwrap();
    failed.status = NodeStatus::Failed;
    failed.retryable = true;
    failed.failure_reason = Some(ReasonCode::NodeFailed);
    store.put_node(&failed).unwrap();
    let mut blocked = store.get_node("o1", "n2").unwrap().unwrap();
    blocked.status = NodeStatus::Blocked;
    blocked.failure_reason = Some(ReasonCode::DependencyFailed);
    store.put_node(&blocked).unwrap();
    let mut record = store.get("o1").unwrap().unwrap();
    record.status = OrchestrationStatus::Paused;
    store.put(&record).unwrap();

    retry_node(&store, &ports, "o1", "n1", &t(3)).unwrap();
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Ready);
    assert_eq!(
        node_status(&store, "o1", "n2"),
        NodeStatus::Pending,
        "dependency-failed blockers must be released by retry"
    );
}

#[test]
fn failed_node_converges_a_live_run_before_releasing_the_lease() {
    let store = MemoryStore::default();
    let ports = FakeRuntime {
        bridge_ready: RefCell::new(false),
        ..FakeRuntime::ready()
    };
    create(
        &store,
        &ports,
        create_input("o1", single_node_plan(&["src"], 1), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    tick_all(&store, &ports, &t(3));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);
    tick_all(&store, &ports, &t(30)); // 27s > 20s bridge 上限 → fail
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Failed);
    assert!(ports.interrupted.borrow().contains(&"run-1".to_string()));
    assert!(ports.closed.borrow().contains(&"run-1".to_string()));
    assert!(store.get_node("o1", "n1").unwrap().unwrap().lease.is_none());
}

#[test]
fn cancel_still_converges_when_the_run_cannot_be_interrupted() {
    let store = MemoryStore::default();
    let ports = FakeRuntime {
        interrupt_error: RefCell::new(Some("run already gone".to_string())),
        ..FakeRuntime::ready()
    };
    create(
        &store,
        &ports,
        create_input("o1", single_node_plan(&["src"], 1), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    tick_all(&store, &ports, &t(3));
    cancel(&store, &ports, "o1", &t(4)).unwrap();
    tick_all(&store, &ports, &t(5)); // interrupt 失败：落 note + 记录时间，不上抛
    tick_all(&store, &ports, &t(20)); // 宽限结束 → close
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Cancelled);
    tick_all(&store, &ports, &t(21));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Cancelled
    );
}

/// M1：Planning 的 planner run 不归 tick 收敛，取消时必须在这里关闭。
#[test]
fn cancelling_planning_closes_the_planner_run() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "规划中".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: true,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));
    let before = store.get("o1").unwrap().unwrap();
    assert_eq!(before.status, OrchestrationStatus::Planning);
    let run_id = before.planner_run_id.clone().expect("planner run started");

    cancel(&store, &ports, "o1", &t(3)).unwrap();
    assert!(ports.closed.borrow().contains(&run_id), "planner run 必须被 close");
    let after = store.get("o1").unwrap().unwrap();
    assert_eq!(after.status, OrchestrationStatus::Cancelling);
    assert!(after.planner_command_id.is_none());
    tick_all(&store, &ports, &t(4));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Cancelled
    );
}

/// M6：单节点探测失败只让该节点降级，不丢掉整轮 tick。
#[test]
fn single_node_probe_error_is_node_level_not_a_tick_failure() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", single_node_plan(&[], 1), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();
    tick_all(&store, &ports, &t(3));

    *ports.task_status_error.borrow_mut() = Some("ipc broken".to_string());
    tick_all(&store, &ports, &t(4)); // 不再整轮上抛（tick_all 断言 errors 为空）
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Failed);
    let events = store.events("o1", 0, 100).unwrap();
    assert!(
        events
            .iter()
            .any(|event| event.kind == EventKind::Note
                && event.payload.to_string().contains("ipc broken")),
        "探测错误要落可见 note"
    );
}

/// M16：非法时间源不得静默折成 0 让全部超时判断失效。
#[test]
fn invalid_tick_timestamp_is_fail_visible() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", single_node_plan(&[], 1), PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    let report = tick(&store, &ports, "not-rfc3339").unwrap();
    assert!(!report.errors.is_empty());
    assert!(
        report.errors[0].1.contains("status-unknown"),
        "{:?}",
        report.errors
    );
}

#[test]
fn auto_plan_without_approval_approves_and_starts_immediately() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: false,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));

    *ports.assistant_text.borrow_mut() = Some(serde_json::to_string(&golden_plan()).unwrap());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::Running);
    assert!(record.approved(), "auto approval must pin the current plan rev");
    assert_eq!(record.approved_plan_rev, Some(record.plan_rev));
    assert!(record.started_at.is_some());
    assert!(record.plan.is_some());
    assert_eq!(store.nodes("o1").unwrap().len(), 2);

    let events = store.events("o1", 0, 100).unwrap();
    assert!(events.iter().any(|event| event.kind == EventKind::Approved));
    assert!(events.iter().any(|event| event.kind == EventKind::Started));
}

#[test]
fn auto_plan_without_approval_falls_back_to_awaiting_approval_on_start_checks() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    *ports.snapshot.borrow_mut() = snapshot(&[("src/lib.rs", "dirty")]);

    create(
        &store,
        &ports,
        CreateInput {
            id: "o1".to_string(),
            project_id: "p1".to_string(),
            title: "自动编排".to_string(),
            goal: "目标".to_string(),
            mode: PlanMode::Auto,
            orchestrator_agent_id: Some("ap-orchestrator".to_string()),
            require_approval: false,
            plan: None,
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));

    *ports.assistant_text.borrow_mut() = Some(serde_json::to_string(&golden_plan()).unwrap());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(
        record.status,
        OrchestrationStatus::AwaitingApproval,
        "a failed start check must not discard the plan"
    );
    assert!(record.approved());
    assert_eq!(record.failure_reason, Some(ReasonCode::WorkingTreeDirty));
    assert!(record.plan.is_some());
    assert!(record.started_at.is_none());
}
