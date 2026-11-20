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
use crate::orchestration::store::{EvidenceKind, EvidenceRecord, MemoryStore, OrchStore};

fn t(second: u32) -> String {
    format!("2026-11-05T00:00:{second:02}Z")
}

/// 分钟级时间戳：验证超时 / 长墙钟用例用
fn tm(minute: u32, second: u32) -> String {
    format!("2026-11-05T00:{minute:02}:{second:02}Z")
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
    let profile =
        |id: &str, name: &str, cli: &str, model: Option<&str>, level: Option<&str>| AgentProfile {
            id: id.to_string(),
            name: name.to_string(),
            cli: cli.to_string(),
            model: model.map(str::to_string),
            thinking_level: level.map(str::to_string),
            tags: vec!["test".to_string()],
            specialties: vec![name.to_string()],
            description: format!("{name}的职责描述"),
            enabled: true,
            created_at: "2026-11-05T00:00:00Z".to_string(),
            updated_at: "2026-11-05T00:00:00Z".to_string(),
        };
    vec![
        profile(
            "ap-frontend",
            "前端实现",
            "pi",
            Some("anthropic/claude-sonnet-4.5"),
            Some("high"),
        ),
        profile("ap-reviewer", "独立评审", "opencode", None, None),
        profile("ap-orchestrator", "编排", "pi", None, None),
    ]
}

#[test]
fn planner_roster_skips_profiles_without_a_bridge() {
    let mut profiles = test_profiles();
    let mut claude = profiles[0].clone();
    claude.id = "ap-claude".to_string();
    claude.name = "Claude".to_string();
    claude.cli = "claude".to_string();
    claude.model = None;
    profiles.push(claude);

    let roster = super::planner_roster(&profiles);
    let agents = roster["agents"].as_array().expect("agents array");
    assert_eq!(agents.len(), 3, "无桥接成员不进 planner roster");
    assert!(agents.iter().all(|agent| agent["cli"] != "claude"));
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
    /// git 快照端口持续失败（证据采集降级回归）
    git_status_error: RefCell<Option<String>>,
    /// PTY 余量探测失败（不得跳过整编排的收敛）
    pty_slots_error: RefCell<Option<String>>,
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
        // 真实宿主里 task 行建成即 InProgress（prompt 是否发出由 send 回执区分）
        *self.task_status.borrow_mut() = Some(TaskStatus::InProgress);
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
        if let Some(error) = self.git_status_error.borrow().clone() {
            return Err(error);
        }
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
        if let Some(error) = self.pty_slots_error.borrow().clone() {
            return Err(error);
        }
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
    // 列表徽章与详情同源：批准标志必须随列表下发，否则批准后行徽章仍「待批准」
    assert_eq!(item["approved"], false);
    approve(&store, "o1", &t(1)).unwrap();
    let listed = list(&store, &ports, Some("p1")).unwrap();
    assert_eq!(listed["orchestrations"][0]["approved"], true);
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
        record
            .planner_agent
            .as_ref()
            .map(|agent| agent.profile_id.as_str()),
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
    assert_eq!(
        ports.sent.borrow().len(),
        1,
        "prompt must be sent after the bridge is ready"
    );
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
    assert!(
        ports.closed.borrow().contains(&run_id),
        "planner run 必须被 close"
    );
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
        events.iter().any(|event| event.kind == EventKind::Note
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
    assert!(
        record.approved(),
        "auto approval must pin the current plan rev"
    );
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

/// 走到 Verifying 的前置拍：create→approve→start→派发→Running→Completed。
fn drive_to_verifying(store: &MemoryStore, ports: &FakeRuntime, plan: Plan) {
    create(
        store,
        ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(store, "o1", &t(1)).unwrap();
    start(store, ports, "o1", &t(2)).unwrap();
    tick_all(store, ports, &t(3));
    tick_all(store, ports, &t(4));
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(store, ports, &t(5));
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(store, ports, &t(6));
    assert_eq!(node_status(store, "o1", "n1"), NodeStatus::Verifying);
}

fn command_acceptance_plan() -> Plan {
    let mut plan = single_node_plan(&["src"], 2);
    plan.nodes[0].acceptance = Acceptance::Command {
        command: vec!["pnpm".into(), "run".into(), "test:run".into()],
        cwd: None,
        timeout_sec: None,
    };
    plan
}

#[test]
fn retry_clears_a_still_active_run_before_redispatch() {
    let store = MemoryStore::default();
    let mut ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, command_acceptance_plan());

    // 验收失败 → Failed（run 收敛可能失败，旧 run 仍视为存活）
    ports.command_result.exit_code = Some(1);
    tick_all(&store, &ports, &t(7));
    tick_all(&store, &ports, &t(8));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Failed);
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Paused
    );

    retry_node(&store, &ports, "o1", "n1", &t(9)).unwrap();
    assert!(
        store
            .get_node("o1", "n1")
            .unwrap()
            .unwrap()
            .run_id
            .is_none(),
        "旧 run 已收敛，重试必须换新 run，不能复用已关闭的 run"
    );

    ports.command_result.exit_code = Some(0);
    resume(&store, "o1", &t(10)).unwrap();
    tick_all(&store, &ports, &t(11));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);
    assert_eq!(ports.runs.borrow().len(), 2, "重试必须启动新 run");
}

#[test]
fn retry_releases_the_whole_blocked_downstream_chain() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    let mut plan = single_node_plan(&["src"], 2);
    let mut n2 = plan.nodes[0].clone();
    n2.key = "n2".to_string();
    n2.depends_on = vec!["n1".to_string()];
    n2.write_scope = vec!["src2".to_string()];
    let mut n3 = plan.nodes[0].clone();
    n3.key = "n3".to_string();
    n3.depends_on = vec!["n2".to_string()];
    n3.write_scope = vec!["src3".to_string()];
    plan.nodes.push(n2);
    plan.nodes.push(n3);

    create(
        &store,
        &ports,
        create_input("o1", plan, PlanMode::Manual),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();

    for (key, status) in [
        ("n1", NodeStatus::Failed),
        ("n2", NodeStatus::Blocked),
        ("n3", NodeStatus::Blocked),
    ] {
        let mut node = store.get_node("o1", key).unwrap().unwrap();
        node.status = status;
        node.retryable = true;
        node.failure_reason = Some(if key == "n1" {
            ReasonCode::NodeFailed
        } else {
            ReasonCode::DependencyFailed
        });
        store.put_node(&node).unwrap();
    }
    let mut record = store.get("o1").unwrap().unwrap();
    record.status = OrchestrationStatus::Paused;
    store.put(&record).unwrap();

    retry_node(&store, &ports, "o1", "n1", &t(3)).unwrap();
    assert_eq!(node_status(&store, "o1", "n2"), NodeStatus::Pending);
    assert_eq!(
        node_status(&store, "o1", "n3"),
        NodeStatus::Pending,
        "孙节点也要解除 Blocked，否则 retry 成功后编排仍不收敛"
    );
}

#[test]
fn evidence_port_failure_degrades_per_node_without_freezing_the_tick() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, command_acceptance_plan());

    *ports.git_status_error.borrow_mut() = Some("working dir vanished".to_string());
    tick_all(&store, &ports, &t(7));
    assert_eq!(
        node_status(&store, "o1", "n1"),
        NodeStatus::Verifying,
        "瞬时端口失败不判死节点，下一 tick 重采"
    );
    let events = store.events("o1", 0, 1000).unwrap();
    assert!(
        events.iter().any(|event| event.kind == EventKind::Note
            && event.node_key.as_deref() == Some("n1")
            && event.payload["reason"] == "evidence-missing"),
        "证据采集失败必须落可见 note"
    );
}

#[test]
fn verifying_times_out_when_evidence_ports_stay_down() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, command_acceptance_plan());

    *ports.git_status_error.borrow_mut() = Some("working dir vanished".to_string());
    tick_all(&store, &ports, &t(7));
    tick_all(&store, &ports, &tm(12, 0));
    let node = store.get_node("o1", "n1").unwrap().unwrap();
    assert_eq!(node.status, NodeStatus::Failed);
    assert_eq!(node.failure_reason, Some(ReasonCode::EvidenceMissing));
    assert!(node.retryable, "端口故障判可重试，不能永久判死");
}

#[test]
fn budget_exhaustion_converges_live_runs_to_cancelled() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
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
    tick_all(&store, &ports, &t(4));
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(5));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Running);

    let mut record = store.get("o1").unwrap().unwrap();
    record.budget.max_wall_seconds = 1;
    store.put(&record).unwrap();

    tick_all(&store, &ports, &t(6));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::BudgetExhausted
    );
    assert!(ports.interrupted.borrow().contains(&"run-1".to_string()));

    tick_all(&store, &ports, &t(17));
    assert_eq!(
        node_status(&store, "o1", "n1"),
        NodeStatus::Cancelled,
        "预算耗尽后活跃 run 仍须走完 interrupt→宽限→close"
    );
    assert!(ports.closed.borrow().contains(&"run-1".to_string()));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::BudgetExhausted
    );
}

#[test]
fn pty_probe_failure_does_not_skip_cancelling_convergence() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, single_node_plan(&["src"], 1));

    *ports.pty_slots_error.borrow_mut() = Some("pty probe down".to_string());
    cancel(&store, &ports, "o1", &t(7)).unwrap();
    let report = tick(&store, &ports, &t(8)).unwrap();
    assert!(!report.errors.is_empty(), "探测失败要显性记录");
    let report = tick(&store, &ports, &t(19)).unwrap();
    assert!(!report.errors.is_empty());
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Cancelled);
    // 节点落定后的下一拍编排才收敛终态（探测仍失败，错误继续显性记录）
    let report = tick(&store, &ports, &t(20)).unwrap();
    assert!(!report.errors.is_empty());
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Cancelled
    );
}

#[test]
fn recovery_with_live_runs_lands_in_pausing_not_paused() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, single_node_plan(&["src"], 1));
    // 回到 Running：run 存活但桥接离线
    let mut node = store.get_node("o1", "n1").unwrap().unwrap();
    node.status = NodeStatus::Running;
    store.put_node(&node).unwrap();
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    *ports.bridge_ready.borrow_mut() = false;

    recover_all(&store, &ports, &t(7)).unwrap();
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Pausing,
        "还有活跃 run 时必须经 Pausing 让 tick 收敛，不能直接 Paused 撒手"
    );

    *ports.bridge_ready.borrow_mut() = true;
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(8));
    tick_all(&store, &ports, &t(9));
    tick_all(&store, &ports, &t(10));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Succeeded);
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Paused
    );
}

#[test]
fn invalid_planner_json_keeps_the_previous_plan_and_nodes() {
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
            plan: Some(single_node_plan(&["src"], 1)),
        },
        &t(0),
    )
    .unwrap();
    start_planning(&store, &ports, "o1", None, &t(1)).unwrap();
    tick_all(&store, &ports, &t(2));

    *ports.assistant_text.borrow_mut() = Some("totally not a plan".to_string());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(3));

    let record = store.get("o1").unwrap().unwrap();
    assert_eq!(record.status, OrchestrationStatus::Draft);
    assert!(
        record.plan.is_some(),
        "重规划输出非法 JSON 不得摧毁上一版可用计划"
    );
    assert_eq!(store.nodes("o1").unwrap().len(), 1);
}

#[test]
fn replan_resets_evidence_and_dispatch_markers_for_reused_keys() {
    let store = MemoryStore::default();
    let mut ports = FakeRuntime::ready();
    create(
        &store,
        &ports,
        create_input("o1", command_acceptance_plan(), PlanMode::Auto),
        &t(0),
    )
    .unwrap();
    approve(&store, "o1", &t(1)).unwrap();
    start(&store, &ports, "o1", &t(2)).unwrap();
    tick_all(&store, &ports, &t(3));
    tick_all(&store, &ports, &t(4));
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(5));
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(6));
    ports.command_result.exit_code = Some(1);
    tick_all(&store, &ports, &t(7));
    tick_all(&store, &ports, &t(8));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::Paused
    );
    assert!(!store.evidence("o1").unwrap().is_empty());

    // Paused 重规划：新计划复用节点键 n1
    start_planning(&store, &ports, "o1", None, &t(9)).unwrap();
    tick_all(&store, &ports, &t(10));
    *ports.assistant_text.borrow_mut() =
        Some(serde_json::to_string(&command_acceptance_plan()).unwrap());
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(11));
    assert_eq!(
        store.get("o1").unwrap().unwrap().status,
        OrchestrationStatus::AwaitingApproval
    );
    assert!(
        store.evidence("o1").unwrap().is_empty(),
        "旧 attempt 证据不得污染新计划"
    );
    assert!(
        !store
            .events("o1", 0, 1000)
            .unwrap()
            .iter()
            .any(|event| event.kind == EventKind::Dispatched),
        "旧派发占位必须清除，否则新 attempt 撞幂等闸"
    );

    // 新计划执行：派发占位可重新认领，证据按新 attempt 重采
    ports.command_result.exit_code = Some(0);
    approve(&store, "o1", &t(12)).unwrap();
    start(&store, &ports, "o1", &t(13)).unwrap();
    tick_all(&store, &ports, &t(14));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Dispatching);
    assert_eq!(
        ports.runs.borrow().len(),
        3,
        "节点 run + planner run + 重试新 run"
    );
    tick_all(&store, &ports, &t(15));
    *ports.task_status.borrow_mut() = Some(TaskStatus::InProgress);
    tick_all(&store, &ports, &t(16));
    *ports.task_status.borrow_mut() = Some(TaskStatus::Completed);
    tick_all(&store, &ports, &t(17));
    tick_all(&store, &ports, &t(18));
    assert_eq!(node_status(&store, "o1", "n1"), NodeStatus::Succeeded);
    assert!(!ports.commands.borrow().is_empty(), "验收命令必须真实重跑");
}

#[test]
fn partial_evidence_is_recollected_instead_of_judged_as_missing() {
    let store = MemoryStore::default();
    let ports = FakeRuntime::ready();
    drive_to_verifying(&store, &ports, command_acceptance_plan());

    // 模拟半套写：diff 已落库、acceptance 写入失败
    store
        .append_evidence(&EvidenceRecord {
            id: "o1:n1:1:diff".to_string(),
            orchestration_id: "o1".to_string(),
            node_key: "n1".to_string(),
            attempt: 1,
            kind: EvidenceKind::Diff,
            payload: serde_json::json!({
                "files": [], "scopeViolations": [], "concurrentWriters": false
            }),
            at: t(6),
        })
        .unwrap();

    tick_all(&store, &ports, &t(7));
    assert_eq!(
        node_status(&store, "o1", "n1"),
        NodeStatus::Succeeded,
        "半套证据必须重采补齐，不能按 NotRun 判证据缺失"
    );
    assert_eq!(ports.commands.borrow().len(), 1);
}
