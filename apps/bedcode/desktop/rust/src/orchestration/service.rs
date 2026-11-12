//! 命令与 tick 状态机：事件落到投影、动作投影、派发 / 证据 / 取消的闭环。
//!
//! 本模块只依赖 [`OrchStore`] 与 [`RuntimePort`]；wasm 适配与命令路由在 `mod.rs`。

use std::collections::HashMap;

use serde_json::{json, Value};

use super::actions::{self, ActionFacts, NodeActionFacts};
use super::dispatch::{
    self, CancelOutcome, DispatchError, DispatchOutcome, DispatchPort, DispatchRequest,
};
use super::evidence::{
    self, AcceptanceEvidence, CommandResult, EvidencePort, EvidenceRequest, ReviewVerdict, Verdict,
    GIT_SNAPSHOT_TIMEOUT_SECS,
};
use super::handoff::{compose_work_order, UpstreamResult, WorkOrder};
use super::model::{
    Acceptance, AgentSnapshot, EventKind, NodeStatus, OrchestrationStatus, Plan, PlanError,
    PlanErrorCode, PlanMode, ReasonCode, TaskStatus,
};
use super::plan;
use super::recover::{self, RecoveryDecision, RecoveryNode, RecoverySnapshot, RunState};
use super::sched::{self, Decision, NodeFacts, TickSnapshot};
use super::store::{
    Budget, EventDraft, EvidenceKind, EvidenceRecord, NodeRecord, OrchStore, OrchestrationRecord,
};
use crate::agent_pool::model::AgentProfile;

/// 节点墙钟（§7.4 默认值；计划级覆盖留待后续版本）
pub(crate) const NODE_TIMEOUT_SECS: u64 = 1800;
/// 桥接等待上限（§6.3）
pub(crate) const BRIDGE_TIMEOUT_MS: i64 = 20_000;
/// 默认编排墙钟
pub(crate) const DEFAULT_MAX_WALL_SECS: u64 = 7200;
/// planner 默认回退（无池成员时的显性错误文案；v2 不再默认 pi）
const PLANNER_ORCHESTRATOR_REQUIRED: &str =
    "orchestration requires an orchestrator agent from the pool";
/// planner run 墙钟
const PLANNER_TIMEOUT_SECS: u64 = 1800;
/// planner 原文保留上限
const PLANNER_OUTPUT_MAX_BYTES: usize = 16 * 1024;
/// 事件增量默认 / 上限
const EVENTS_LIMIT: usize = 500;
const EVENTS_MAX_LIMIT: usize = 1000;
/// agent 集成目录：工作树干净检查的排除项（§7.5）
const INTEGRATION_PREFIXES: [&str; 5] = [".pi/", ".opencode/", ".claude/", ".codex/", ".bedcode/"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectInfo {
    pub name: String,
    pub working_dir: String,
}

/// 编排运行时端口：项目 / 运行观察 + 派发 + 证据。
pub(crate) trait RuntimePort: DispatchPort + EvidencePort {
    fn project(&self, project_id: &str) -> Result<Option<ProjectInfo>, String>;
    fn is_git_repo(&self, working_dir: &str) -> Result<bool, String>;
    fn task_status(&self, run_id: &str) -> Result<Option<TaskStatus>, String>;
    fn run_active(&self, run_id: &str) -> Result<bool, String>;
    fn run_state(&self, run_id: &str) -> Result<RunState, String>;
    fn agent_ready(&self, agent_id: &str) -> Result<bool, String>;
    /// Agent 池快照（校验 / planner roster 用；服务端权威，不读前端入参）
    fn agent_profiles(&self) -> Result<Vec<AgentProfile>, String>;
    /// 本插件当前还能接受的新派发数（`ptyQuota - 保留 2 - 活跃 run`）
    fn pty_slots(&self) -> Result<u8, String>;
}

#[derive(Debug, Clone)]
pub(crate) struct CreateInput {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub goal: String,
    pub mode: PlanMode,
    /// 自动模式必填：池里的编排 Agent
    pub orchestrator_agent_id: Option<String>,
    /// 自动计划完成后是否必须人工批准（默认 true）
    pub require_approval: bool,
    pub plan: Option<Plan>,
}

#[derive(Debug, Default)]
pub(crate) struct TickReport {
    pub ticked: usize,
    pub errors: Vec<(String, String)>,
}

fn fail(reason: ReasonCode, detail: impl std::fmt::Display) -> String {
    format!("{}: {}", reason.as_str(), detail)
}

fn receipt(record: &OrchestrationRecord) -> Value {
    json!({
        "id": record.id,
        "status": record.status.as_str(),
        "planError": record.plan_error,
    })
}

fn ms(timestamp: Option<&str>) -> Option<i64> {
    timestamp
        .and_then(crate::config::model::unix_from_rfc3339)
        .map(|seconds| seconds as i64 * 1000)
}

/// tick 的墙钟基准：解析失败必须显性失败，绝不能折成 0（会让所有超时 / 预算
/// 判断与取消宽限静默失效，M16）。
fn now_ms(now: &str) -> Result<i64, String> {
    ms(Some(now)).ok_or_else(|| {
        fail(
            ReasonCode::StatusUnknown,
            format!("invalid orchestration timestamp `{now}`"),
        )
    })
}

fn max_dispatches(plan: &Plan) -> u32 {
    plan.nodes.iter().map(|node| node.max_attempts as u32).sum()
}

fn plan_error_is_empty(record: &OrchestrationRecord) -> bool {
    record.plan_error.as_ref().is_none_or(Vec::is_empty)
}

fn node_id(orchestration_id: &str, node_key: &str) -> String {
    format!("{orchestration_id}:{node_key}")
}

fn nodes_from_plan(orchestration_id: &str, plan: &Plan) -> Vec<NodeRecord> {
    plan.nodes
        .iter()
        .map(|node| NodeRecord {
            id: node_id(orchestration_id, &node.key),
            orchestration_id: orchestration_id.to_string(),
            key: node.key.clone(),
            title: node.title.clone(),
            role: node.role,
            agent_id: node
                .agent
                .as_ref()
                .map(|agent| agent.cli.clone())
                .unwrap_or_default(),
            agent_ref: node.agent_ref.clone(),
            agent_snapshot: node.agent.clone(),
            match_reason: node.match_reason.clone(),
            prompt: node.prompt.clone(),
            depends_on: node.depends_on.clone(),
            // 写集在投影里统一归一口径（校验器只校验归一化结果，不改计划原文）；
            // 少这一步，带尾斜杠的写集会同时破坏租约重叠判断与越界归属。
            write_scope: node
                .write_scope
                .iter()
                .map(|scope| plan::normalize_scope(scope).unwrap_or_else(|_| scope.clone()))
                .collect(),
            acceptance: node.acceptance.clone(),
            status: NodeStatus::Pending,
            attempt: 0,
            max_attempts: node.max_attempts,
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
        })
        .collect()
}

/// 计划落库 + 校验：先按当前池子绑定 `agentRef` → 快照，再做结构校验。
///
/// 绑定失败时仍保存计划（前端要能继续编辑 / 看错误），但节点投影清空——未解析
/// 的计划绝不进入可执行状态。
fn apply_plan(
    store: &impl OrchStore,
    record: &mut OrchestrationRecord,
    plan: Plan,
    mode: PlanMode,
    profiles: &[AgentProfile],
) -> Result<Result<(), Vec<PlanError>>, String> {
    let mut plan = plan;
    let bind_errors = plan::bind_agents(&mut plan, profiles);
    record.max_parallel = plan.max_parallel;
    record.budget.max_dispatches = max_dispatches(&plan);
    let validation = if bind_errors.is_empty() {
        plan::validate(&plan, mode)
    } else {
        Err(bind_errors)
    };
    record.plan = Some(plan.clone());
    match &validation {
        Ok(()) => {
            record.plan_error = None;
            record.status = OrchestrationStatus::AwaitingApproval;
            store.replace_nodes(&record.id, &nodes_from_plan(&record.id, &plan))?;
        }
        Err(errors) => {
            record.plan_error = Some(errors.clone());
            record.status = OrchestrationStatus::Draft;
            store.replace_nodes(&record.id, &[])?;
        }
    }
    Ok(validation)
}

fn append_event(
    store: &impl OrchStore,
    orchestration_id: &str,
    kind: EventKind,
    node_key: Option<&str>,
    attempt: Option<u8>,
    payload: Value,
    now: &str,
) -> Result<i64, String> {
    store.append_event(
        orchestration_id,
        EventDraft {
            kind,
            node_key: node_key.map(str::to_string),
            attempt,
            payload,
            at: now.to_string(),
        },
    )
}

// ==================== 命令 ====================

/// 解析编排 Agent：必须是池里启用的、声明可编排的、桥接可用的成员。
/// 自动模式缺省不可用（不再回退 pi）；手动模式可以不指定。
fn resolve_orchestrator(
    ports: &impl RuntimePort,
    id: Option<&str>,
    required: bool,
) -> Result<Option<AgentProfile>, String> {
    let id = id.map(str::trim).filter(|value| !value.is_empty());
    let Some(id) = id else {
        if required {
            return Err(fail(
                ReasonCode::AgentNotReady,
                PLANNER_ORCHESTRATOR_REQUIRED,
            ));
        }
        return Ok(None);
    };
    let profile = ports
        .agent_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| {
            fail(
                ReasonCode::AgentUnsupported,
                format!("orchestrator `{id}` is not in the agent pool"),
            )
        })?;
    if !profile.enabled {
        return Err(fail(
            ReasonCode::AgentNotReady,
            format!("orchestrator `{}` is disabled", profile.name),
        ));
    }
    if !crate::run::bridge::supports_bridge(&profile.cli) {
        return Err(fail(
            ReasonCode::AgentUnsupported,
            format!(
                "orchestrator `{}` uses `{}`, which has no bridge",
                profile.name, profile.cli
            ),
        ));
    }
    if !ports.agent_ready(&profile.cli)? {
        return Err(fail(
            ReasonCode::AgentNotReady,
            format!("agent CLI `{}` is not installed", profile.cli),
        ));
    }
    Ok(Some(profile))
}

pub(crate) fn create(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    input: CreateInput,
    now: &str,
) -> Result<Value, String> {
    let title = input.title.trim();
    let goal = input.goal.trim();
    if title.is_empty() {
        return Err(fail(ReasonCode::PlanInvalid, "title must not be empty"));
    }
    if goal.is_empty() {
        return Err(fail(ReasonCode::PlanInvalid, "goal must not be empty"));
    }
    if ports.project(&input.project_id)?.is_none() {
        return Err(fail(
            ReasonCode::RunStartFailed,
            format!("project `{}` does not exist", input.project_id),
        ));
    }
    let orchestrator = resolve_orchestrator(
        ports,
        input.orchestrator_agent_id.as_deref(),
        input.mode == PlanMode::Auto,
    )?;

    let mut record = OrchestrationRecord {
        id: input.id,
        project_id: input.project_id,
        title: title.to_string(),
        goal: goal.to_string(),
        mode: input.mode,
        require_approval: input.require_approval,
        orchestrator_agent_id: orchestrator.as_ref().map(|profile| profile.id.clone()),
        status: OrchestrationStatus::Draft,
        plan: None,
        plan_rev: 1,
        plan_error: None,
        planner_output: None,
        max_parallel: 2,
        budget: Budget {
            max_wall_seconds: DEFAULT_MAX_WALL_SECS,
            max_dispatches: 0,
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
        created_at: now.to_string(),
        updated_at: now.to_string(),
        started_at: None,
        ended_at: None,
    };
    store.put(&record)?;
    append_event(
        store,
        &record.id,
        EventKind::Created,
        None,
        None,
        json!({}),
        now,
    )?;

    if let Some(plan) = input.plan {
        let mode = record.mode;
        let profiles = ports.agent_profiles()?;
        let validation = apply_plan(store, &mut record, plan, mode, &profiles)?;
        record.updated_at = now.to_string();
        store.put(&record)?;
        match validation {
            Ok(()) => append_event(
                store,
                &record.id,
                EventKind::PlanSaved,
                None,
                None,
                json!({ "planRev": record.plan_rev }),
                now,
            )?,
            Err(errors) => append_event(
                store,
                &record.id,
                EventKind::PlanInvalid,
                None,
                None,
                json!({ "planRev": record.plan_rev, "errors": errors }),
                now,
            )?,
        };
    }
    Ok(receipt(&record))
}

/// 自动计划：启动 planner run（Draft / AwaitingApproval → Planning）。
///
/// 计划产出由 tick 消费：task status completed → 取最后一条 assistant.text →
/// 解析 + 校验 → `awaiting_approval`（合法）或 `draft + plan_error`（不合法）。
/// 本命令只负责起 run / 建任务行 / 记录 planner 状态，不等待模型输出。
pub(crate) fn start_planning(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
    agent_profile_id: Option<&str>,
    now: &str,
) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if record.mode != PlanMode::Auto {
        return Err(fail(
            ReasonCode::PlanInvalid,
            "orchestration is manual; auto planning is not available",
        ));
    }
    if !matches!(
        record.status,
        OrchestrationStatus::Draft
            | OrchestrationStatus::AwaitingApproval
            | OrchestrationStatus::Paused
    ) {
        return Err(fail(
            ReasonCode::PlanInvalid,
            format!("orchestration is {}", record.status.as_str()),
        ));
    }
    if let Some(profile_id) = agent_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        record.orchestrator_agent_id = Some(profile_id.to_string());
    }
    let orchestrator = resolve_orchestrator(ports, record.orchestrator_agent_id.as_deref(), true)?
        .ok_or_else(|| fail(ReasonCode::AgentNotReady, PLANNER_ORCHESTRATOR_REQUIRED))?;
    let agent = orchestrator.cli.clone();
    if ports.project(&record.project_id)?.is_none() {
        return Err(fail(ReasonCode::RunStartFailed, "project does not exist"));
    }
    let profiles = ports.agent_profiles()?;

    let run_id = ports
        .start_run(&record.project_id, &agent)
        .map_err(|error| fail(ReasonCode::RunStartFailed, error))?;
    let prompt = planner_prompt(&record, &profiles);
    if let Err(error) = ports.create_task_row(&run_id, &prompt, &agent, "orchestration-planner") {
        let _ = ports.close(&run_id);
        return Err(fail(ReasonCode::StatusUnknown, error));
    }

    record.status = OrchestrationStatus::Planning;
    record.plan_rev += 1;
    record.approved_at = None;
    record.approved_plan_rev = None;
    record.plan_error = None;
    record.planner_output = None;
    record.failure_reason = None;
    record.planner_run_id = Some(run_id.clone());
    record.planner_agent_id = Some(agent.clone());
    record.planner_agent = Some(orchestrator.snapshot());
    record.planner_command_id = None;
    record.planner_control_command_id = None;
    record.planner_dispatched_at = Some(now.to_string());
    record.planner_task_row_created = true;
    record.updated_at = now.to_string();
    store.put(&record)?;
    append_event(
        store,
        &record.id,
        EventKind::Note,
        None,
        None,
        json!({
            "status": "planning",
            "agentId": agent,
            "agentRef": record.orchestrator_agent_id,
            "runId": run_id,
        }),
        now,
    )?;
    Ok(receipt(&record))
}

pub(crate) fn update_plan(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
    plan: &Plan,
    now: &str,
) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if !matches!(
        record.status,
        OrchestrationStatus::Draft | OrchestrationStatus::AwaitingApproval
    ) {
        return Err(fail(
            ReasonCode::PlanInvalid,
            "plan can only be edited in draft / awaiting-approval",
        ));
    }
    record.plan_rev += 1;
    record.approved_at = None;
    record.approved_plan_rev = None;
    let mode = record.mode;
    let profiles = ports.agent_profiles()?;
    let validation = apply_plan(store, &mut record, plan.clone(), mode, &profiles)?;
    record.updated_at = now.to_string();
    store.put(&record)?;
    match validation {
        Ok(()) => append_event(
            store,
            &record.id,
            EventKind::PlanSaved,
            None,
            None,
            json!({ "planRev": record.plan_rev }),
            now,
        )?,
        Err(errors) => append_event(
            store,
            &record.id,
            EventKind::PlanInvalid,
            None,
            None,
            json!({ "planRev": record.plan_rev, "errors": errors }),
            now,
        )?,
    };
    Ok(receipt(&record))
}

pub(crate) fn approve(store: &impl OrchStore, id: &str, now: &str) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if record.status != OrchestrationStatus::AwaitingApproval {
        return Err(fail(
            ReasonCode::ApprovalRequired,
            format!(
                "orchestration is {}; plan must be awaiting approval",
                record.status.as_str()
            ),
        ));
    }
    let plan = record
        .plan
        .clone()
        .ok_or_else(|| fail(ReasonCode::PlanInvalid, "plan is missing"))?;
    if !plan_error_is_empty(&record) {
        return Err(fail(ReasonCode::PlanInvalid, "plan has validation errors"));
    }
    plan::validate(&plan, record.mode).map_err(|errors| {
        fail(
            ReasonCode::PlanInvalid,
            format!("plan validation failed: {} error(s)", errors.len()),
        )
    })?;
    if record.approved() {
        return Ok(receipt(&record));
    }
    record.approved_at = Some(now.to_string());
    record.approved_plan_rev = Some(record.plan_rev);
    record.updated_at = now.to_string();
    store.put(&record)?;
    append_event(
        store,
        &record.id,
        EventKind::Approved,
        None,
        None,
        json!({ "planRev": record.plan_rev }),
        now,
    )?;
    Ok(receipt(&record))
}

pub(crate) fn start(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
    now: &str,
) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if record.status != OrchestrationStatus::AwaitingApproval {
        return Err(fail(
            ReasonCode::PlanInvalid,
            format!("orchestration is {}", record.status.as_str()),
        ));
    }
    let plan = record
        .plan
        .clone()
        .ok_or_else(|| fail(ReasonCode::PlanInvalid, "plan is missing"))?;
    if !record.approved() {
        return Err(fail(
            ReasonCode::ApprovalRequired,
            "plan revision is not approved",
        ));
    }
    plan::validate(&plan, record.mode).map_err(|errors| {
        fail(
            ReasonCode::PlanInvalid,
            format!("plan validation failed: {} error(s)", errors.len()),
        )
    })?;
    begin_execution(store, ports, &mut record, &plan, now)?;
    Ok(receipt(&record))
}

/// 把已批准计划推进到 Running（工程 / git / CLI 就绪检查 + Started 事件）。
///
/// 自动批准路径也复用这里：检查失败时调用方可以退回 AwaitingApproval，
/// 让用户修好工作树后手动开始，而不是把计划丢掉。
fn begin_execution(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &mut OrchestrationRecord,
    plan: &Plan,
    now: &str,
) -> Result<(), String> {
    let project = ports
        .project(&record.project_id)?
        .ok_or_else(|| fail(ReasonCode::RunStartFailed, "project does not exist"))?;
    if !ports.is_git_repo(&project.working_dir)? {
        return Err(fail(
            ReasonCode::ProjectNotGit,
            format!("`{}` is not a git repository", project.working_dir),
        ));
    }
    let snapshot = ports
        .git_status(&project.working_dir, GIT_SNAPSHOT_TIMEOUT_SECS)
        .map_err(|error| fail(ReasonCode::WorkingTreeDirty, error))?;
    let dirty: Vec<String> = snapshot
        .files
        .keys()
        .filter(|path| !is_integration_path(path))
        .cloned()
        .collect();
    if !dirty.is_empty() {
        return Err(fail(
            ReasonCode::WorkingTreeDirty,
            format!("working tree is dirty: {}", dirty.join(", ")),
        ));
    }

    let mut checked: Vec<String> = Vec::new();
    for node in &plan.nodes {
        let agent = node.agent.as_ref().ok_or_else(|| {
            fail(
                ReasonCode::PlanInvalid,
                format!("node `{}` has no resolved agent snapshot", node.key),
            )
        })?;
        if checked.contains(&agent.cli) {
            continue;
        }
        if !ports.agent_ready(&agent.cli)? {
            return Err(fail(
                ReasonCode::AgentNotReady,
                format!("agent `{}` is not ready", agent.cli),
            ));
        }
        checked.push(agent.cli.clone());
    }

    record.status = OrchestrationStatus::Running;
    record.started_at = Some(now.to_string());
    record.ended_at = None;
    record.failure_reason = None;
    record.budget.max_dispatches = max_dispatches(plan);
    record.updated_at = now.to_string();
    store.put(record)?;
    append_event(
        store,
        &record.id,
        EventKind::Started,
        None,
        None,
        json!({ "planRev": record.plan_rev }),
        now,
    )?;
    Ok(())
}

pub(crate) fn pause(store: &impl OrchStore, id: &str, now: &str) -> Result<Value, String> {
    let mut record = load(store, id)?;
    match record.status {
        OrchestrationStatus::Running => {
            record.status = OrchestrationStatus::Pausing;
            record.updated_at = now.to_string();
            store.put(&record)?;
            append_event(
                store,
                &record.id,
                EventKind::Pausing,
                None,
                None,
                json!({}),
                now,
            )?;
        }
        OrchestrationStatus::Pausing | OrchestrationStatus::Paused => {}
        other => {
            return Err(fail(
                ReasonCode::PlanInvalid,
                format!("cannot pause orchestration in status {}", other.as_str()),
            ))
        }
    }
    Ok(receipt(&record))
}

pub(crate) fn resume(store: &impl OrchStore, id: &str, now: &str) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if record.status != OrchestrationStatus::Paused {
        return Err(fail(
            ReasonCode::PlanInvalid,
            format!(
                "orchestration is {}; only paused can resume",
                record.status.as_str()
            ),
        ));
    }
    record.status = OrchestrationStatus::Running;
    record.failure_reason = None;
    record.updated_at = now.to_string();
    store.put(&record)?;
    append_event(
        store,
        &record.id,
        EventKind::Resumed,
        None,
        None,
        json!({}),
        now,
    )?;
    Ok(receipt(&record))
}

pub(crate) fn cancel(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
    now: &str,
) -> Result<Value, String> {
    let mut record = load(store, id)?;
    if is_terminal(record.status) {
        return Ok(receipt(&record));
    }
    // Planning 的 planner run 不归 tick 收敛（tick_one 只对 Planning 跑
    // tick_planner）；取消时必须在这里收敛任务行并关闭 CLI 会话，否则它一直
    // 占着 PTY 槽直到用户重启宿主（M1）。
    if record.status == OrchestrationStatus::Planning {
        if let Some(run_id) = record.planner_run_id.clone() {
            let _ = ports.converge_task(&run_id, "orchestration-cancelled");
        }
        close_planner_run(ports, &mut record);
    }
    record.status = OrchestrationStatus::Cancelling;
    record.updated_at = now.to_string();
    store.put(&record)?;
    append_event(
        store,
        &record.id,
        EventKind::Cancelling,
        None,
        None,
        json!({}),
        now,
    )?;
    Ok(receipt(&record))
}

pub(crate) fn retry_node(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
    node_key: &str,
    now: &str,
) -> Result<Value, String> {
    let record = load(store, id)?;
    if record.status != OrchestrationStatus::Paused {
        return Err(fail(
            ReasonCode::NodeFailed,
            "orchestration must be paused before retrying a node",
        ));
    }
    let mut node = store.get_node(id, node_key)?.ok_or_else(|| {
        fail(
            ReasonCode::StatusUnknown,
            format!("node `{node_key}` not found"),
        )
    })?;
    if node.status != NodeStatus::Failed {
        return Err(fail(
            ReasonCode::NodeFailed,
            format!("node `{node_key}` is not failed"),
        ));
    }
    if !node.retryable {
        return Err(fail(
            ReasonCode::NotRetryable,
            format!("node `{node_key}` failure is not retryable"),
        ));
    }
    if node.attempt >= node.max_attempts {
        return Err(fail(
            ReasonCode::AttemptsExhausted,
            format!(
                "node `{node_key}` exhausted {} attempt(s)",
                node.max_attempts
            ),
        ));
    }
    if let Some(run_id) = node.run_id.clone() {
        if ports.run_active(&run_id)? {
            // 正常路径下 fail_node 已收敛旧 run；这里兜底，避免「旧进程还在写、
            // 新 attempt 又派发」的并发窗口（H4）。
            let _ = ports.converge_task(&run_id, "node-retry");
            let _ = ports.interrupt(&run_id);
            let _ = ports.close(&run_id);
        } else {
            node.run_id = None;
        }
    }
    // 每次重试都重新入队 profile 命令：保留上一次已 Failed 的 control id
    // 会让重试反复命中同一条失败命令（M3）。
    node.control_command_id = None;
    node.status = NodeStatus::Ready;
    node.failure_reason = None;
    node.retryable = true;
    node.command_id = None;
    node.task_row_created = false;
    node.pre_snapshot = None;
    node.lease = None;
    node.dispatched_at = None;
    node.verifying_started_at = None;
    node.cancel_requested_at = None;
    node.started_at = None;
    node.ended_at = None;
    store.put_node(&node)?;
    append_event(
        store,
        &record.id,
        EventKind::Retried,
        Some(&node.key),
        Some(node.attempt + 1),
        json!({ "nextAttempt": node.attempt + 1 }),
        now,
    )?;

    // 上游失败时被 Blocked 的下游要恢复可派发：否则 retry 成功也救不活它们，
    // 编排只剩「Succeeded + Blocked」永远不收敛（H1）。
    for mut blocked in store.nodes(id)?.into_iter().filter(|candidate| {
        candidate.status == NodeStatus::Blocked
            && candidate.failure_reason == Some(ReasonCode::DependencyFailed)
            && candidate.depends_on.iter().any(|dep| dep == node_key)
    }) {
        blocked.status = NodeStatus::Pending;
        blocked.failure_reason = None;
        blocked.ended_at = None;
        store.put_node(&blocked)?;
        append_event(
            store,
            &record.id,
            EventKind::NodeReady,
            Some(&blocked.key),
            Some(blocked.attempt),
            json!({ "reason": "dependency-retried", "upstream": node_key }),
            now,
        )?;
    }
    Ok(receipt(&record))
}

pub(crate) fn skip_node(
    store: &impl OrchStore,
    id: &str,
    node_key: &str,
    now: &str,
) -> Result<Value, String> {
    let record = load(store, id)?;
    if !matches!(
        record.status,
        OrchestrationStatus::Running | OrchestrationStatus::Pausing | OrchestrationStatus::Paused
    ) {
        return Err(fail(
            ReasonCode::PlanInvalid,
            format!("cannot skip nodes while {}", record.status.as_str()),
        ));
    }
    let mut nodes = store.nodes(id)?;
    let target = nodes
        .iter()
        .find(|candidate| candidate.key == node_key)
        .ok_or_else(|| {
            fail(
                ReasonCode::StatusUnknown,
                format!("node `{node_key}` not found"),
            )
        })?;
    if !matches!(
        target.status,
        NodeStatus::Pending | NodeStatus::Ready | NodeStatus::Failed | NodeStatus::Blocked
    ) {
        return Err(fail(
            ReasonCode::NodeFailed,
            format!("node `{node_key}` is {}", target.status.as_str()),
        ));
    }

    // 依赖被 skip 节点的整条下游链已经没有可独立执行的输入，一并 Skipped：
    // 只把下游留在 Blocked（吸收态）会让编排永远停在 Running、1Hz 空转（H1）。
    let mut skipped_keys: Vec<String> = vec![node_key.to_string()];
    loop {
        let before = skipped_keys.len();
        for candidate in &nodes {
            if skipped_keys.contains(&candidate.key) {
                continue;
            }
            if candidate
                .depends_on
                .iter()
                .any(|dep| skipped_keys.contains(dep))
            {
                skipped_keys.push(candidate.key.clone());
            }
        }
        if skipped_keys.len() == before {
            break;
        }
    }

    for candidate in nodes.iter_mut() {
        let is_target = candidate.key == node_key;
        if !skipped_keys.contains(&candidate.key) {
            continue;
        }
        // 已经跑出结果的下游（Succeeded / Failed / Cancelled）保留事实，不抹历史。
        if !is_target
            && !matches!(
                candidate.status,
                NodeStatus::Pending | NodeStatus::Ready | NodeStatus::Blocked
            )
        {
            continue;
        }
        candidate.status = NodeStatus::Skipped;
        candidate.ended_at = Some(now.to_string());
        candidate.lease = None;
        candidate.failure_reason = None;
        store.put_node(candidate)?;
        append_event(
            store,
            &record.id,
            EventKind::NodeSkipped,
            Some(&candidate.key),
            Some(candidate.attempt),
            json!({
                "reason": if is_target { "user-skip" } else { "upstream-skipped" },
                "upstream": node_key,
            }),
            now,
        )?;
    }
    Ok(receipt(&record))
}

// ==================== 查询 ====================

fn load(store: &impl OrchStore, id: &str) -> Result<OrchestrationRecord, String> {
    store
        .get(id)?
        .ok_or_else(|| format!("orchestration-not-found: `{id}`"))
}

fn project_name(ports: &impl RuntimePort, project_id: &str) -> String {
    ports
        .project(project_id)
        .ok()
        .flatten()
        .map(|project| project.name)
        .unwrap_or_default()
}

pub(crate) fn list(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    project_id: Option<&str>,
) -> Result<Value, String> {
    let records = store.list(project_id)?;
    let mut items = Vec::with_capacity(records.len());
    for record in &records {
        let nodes = store.nodes(&record.id)?;
        let count = |status: NodeStatus| nodes.iter().filter(|node| node.status == status).count();
        let running = nodes
            .iter()
            .filter(|node| {
                matches!(
                    node.status,
                    NodeStatus::Dispatching
                        | NodeStatus::Running
                        | NodeStatus::AwaitingInput
                        | NodeStatus::Verifying
                )
            })
            .count();
        let mut agents: Vec<String> = Vec::new();
        for node in &nodes {
            if !agents.contains(&node.agent_id) {
                agents.push(node.agent_id.clone());
            }
        }
        items.push(json!({
            "id": record.id,
            "projectId": record.project_id,
            "projectName": project_name(ports, &record.project_id),
            "title": record.title,
            "mode": record.mode.as_str(),
            "status": record.status.as_str(),
            "nodeCount": nodes.len(),
            "succeededCount": count(NodeStatus::Succeeded),
            "failedCount": count(NodeStatus::Failed),
            "runningCount": running,
            "agents": agents,
            "updatedAt": record.updated_at,
            "startedAt": record.started_at,
            "endedAt": record.ended_at,
        }));
    }
    Ok(json!({ "orchestrations": items }))
}

fn node_view(node: &NodeRecord) -> Value {
    json!({
        "key": node.key,
        "title": node.title,
        "role": node.role.as_str(),
        "agentId": node.agent_id,
        "agentRef": node.agent_ref,
        "agent": node.agent_snapshot,
        "matchReason": node.match_reason,
        "status": node.status.as_str(),
        "attempt": node.attempt,
        "maxAttempts": node.max_attempts,
        "dependsOn": node.depends_on,
        "writeScope": node.write_scope,
        "acceptance": node.acceptance,
        "runId": node.run_id,
        "retryable": node.retryable,
        "failureReason": node.failure_reason.map(|reason| reason.as_str()),
        "dispatchedAt": node.dispatched_at,
        "startedAt": node.started_at,
        "endedAt": node.ended_at,
    })
}

pub(crate) fn get(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    id: &str,
) -> Result<Value, String> {
    let record = load(store, id)?;
    let nodes = store.nodes(id)?;
    let evidence = store.evidence(id)?;
    let action_facts = ActionFacts {
        status: record.status,
        mode: record.mode,
        approved: record.approved(),
        plan_present: record.plan.is_some(),
        nodes: nodes
            .iter()
            .map(|node| NodeActionFacts {
                key: node.key.clone(),
                status: node.status,
                attempt: node.attempt,
                max_attempts: node.max_attempts,
                retryable: node.retryable,
            })
            .collect(),
    };
    let offered = actions::allowed(&action_facts);
    let node_actions: Vec<Value> = offered
        .nodes
        .iter()
        .map(|entry| json!({ "nodeKey": entry.node_key, "actions": entry.actions }))
        .collect();
    let evidence: Vec<Value> = evidence
        .iter()
        .map(|evidence| {
            json!({
                "nodeKey": evidence.node_key,
                "attempt": evidence.attempt,
                "kind": evidence.kind.as_str(),
                "payload": evidence.payload,
                "at": evidence.at,
            })
        })
        .collect();
    Ok(json!({
        "orchestration": {
            "id": record.id,
            "projectId": record.project_id,
            "projectName": project_name(ports, &record.project_id),
            "title": record.title,
            "goal": record.goal,
            "mode": record.mode.as_str(),
            "requireApproval": record.require_approval,
            "orchestratorAgentId": record.orchestrator_agent_id,
            "status": record.status.as_str(),
            "planRev": record.plan_rev,
            "approved": record.approved(),
            "maxParallel": record.max_parallel,
            "budget": record.budget,
            "plannerRunId": record.planner_run_id,
            "plannerAgent": record.planner_agent,
            "planError": record.plan_error,
            "plannerOutput": record.planner_output,
            "failureReason": record.failure_reason.map(|reason| reason.as_str()),
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
            "startedAt": record.started_at,
            "endedAt": record.ended_at,
        },
        "plan": record.plan,
        "nodes": nodes.iter().map(node_view).collect::<Vec<_>>(),
        "actions": {
            "orchestration": offered.orchestration,
            "nodes": node_actions,
        },
        "evidence": evidence,
        "eventSeq": store.last_event_seq(id)?,
    }))
}

pub(crate) fn events(
    store: &impl OrchStore,
    id: &str,
    after_seq: i64,
    limit: Option<usize>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(EVENTS_LIMIT).min(EVENTS_MAX_LIMIT);
    let events = store.events(id, after_seq, limit)?;
    let next_seq = events.last().map(|event| event.seq).unwrap_or(after_seq);
    Ok(json!({
        "events": events.iter().map(|event| json!({
            "seq": event.seq,
            "kind": event.kind.as_str(),
            "nodeKey": event.node_key,
            "attempt": event.attempt,
            "payload": event.payload,
            "at": event.at,
        })).collect::<Vec<_>>(),
        "nextSeq": next_seq,
    }))
}

// ==================== tick ====================

pub(crate) fn tick(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    now: &str,
) -> Result<TickReport, String> {
    let mut report = TickReport::default();
    let records = store.list(None)?;
    for record in records {
        if !matches!(
            record.status,
            OrchestrationStatus::Planning
                | OrchestrationStatus::Running
                | OrchestrationStatus::Pausing
                | OrchestrationStatus::Cancelling
        ) {
            continue;
        }
        report.ticked += 1;
        let id = record.id.clone();
        // 每编排重算全局 PTY 余量：同一轮 tick 里前一个编排刚启动的 run
        // 必须计入后一个编排的可用槽位，否则总派发会突破 ptyQuota。
        // 探测失败只影响本编排：记错误并把余量当 0（不派发），不丢掉整轮 tick。
        let pty_slots = match ports.pty_slots() {
            Ok(slots) => slots,
            Err(error) => {
                report.errors.push((id, error));
                continue;
            }
        };
        if let Err(error) = tick_one(store, ports, record, now, pty_slots) {
            report.errors.push((id, error));
        }
    }
    Ok(report)
}

fn tick_one(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    mut record: OrchestrationRecord,
    now: &str,
    pty_slots: u8,
) -> Result<(), String> {
    if record.status == OrchestrationStatus::Planning {
        return tick_planner(store, ports, &mut record, now);
    }

    let mut nodes = store.nodes(&record.id)?;

    // 1. 断线恢复：已建 run/task 行但还没发出的派发，本轮继续尝试 send。
    //    取消中的编排不再发送（让它走取消收敛），避免取消与派发互相打架。
    if record.status != OrchestrationStatus::Cancelling {
        for node in nodes.iter_mut() {
            if node.status == NodeStatus::Dispatching && node.command_id.is_none() {
                resume_dispatch(store, ports, &record, node, now)?;
            }
        }
    }

    // 2. verifying：证据收集一次并落库，之后从证据重建裁决。
    //    取消中不跑验收命令（节点即将被取消，跑命令只会拖慢收敛）。
    if record.status != OrchestrationStatus::Cancelling {
        // 差集是「本节点 pre 快照 vs 全树 post 快照」：并行节点写入的路径必然
        // 落进这个差集。把同编排其他节点的写集一并交给证据平面，否则写集
        // 不相交的并行节点、只读 reviewer 会被永久判 ScopeViolation（C1）。
        // 历史节点也在内：其改动已在本节点 pre 快照里，不会出现在差集中。
        let peer_scopes: Vec<(String, Vec<String>)> = nodes
            .iter()
            .map(|node| (node.key.clone(), node.write_scope.clone()))
            .collect();
        for node in nodes.iter_mut() {
            if node.status == NodeStatus::Verifying {
                let concurrent: Vec<String> = peer_scopes
                    .iter()
                    .filter(|(key, _)| key != &node.key)
                    .flat_map(|(_, scopes)| scopes.iter().cloned())
                    .collect();
                ensure_evidence(store, ports, &record, node, &concurrent, now)?;
            }
        }
    }

    let (snapshot, probe_errors) = build_snapshot(store, &record, &nodes, ports, now, pty_slots)?;
    let mut decisions = sched::plan_tick(&snapshot);
    // 单节点探测失败：落一条可见 note，只把该节点降级为 StatusUnknown（可重试），
    // 同轮其它节点照常决策（M6）。同一节点的两个探测失败只处理一次。
    let mut degraded: Vec<String> = Vec::new();
    for (node_key, detail) in probe_errors {
        if degraded.contains(&node_key) {
            continue;
        }
        degraded.push(node_key.clone());
        append_event(
            store,
            &record.id,
            EventKind::Note,
            Some(&node_key),
            None,
            json!({ "reason": ReasonCode::StatusUnknown.as_str(), "detail": detail }),
            now,
        )?;
        if decisions.iter().any(
            |decision| matches!(decision, Decision::Fail { node_key: key, .. } if key == &node_key),
        ) {
            continue;
        }
        decisions.push(Decision::Fail {
            node_key,
            reason: ReasonCode::StatusUnknown,
            retryable: true,
        });
    }
    if decisions.is_empty() {
        return Ok(());
    }

    let mut index: HashMap<String, usize> = HashMap::new();
    for (position, node) in nodes.iter().enumerate() {
        index.insert(node.key.clone(), position);
    }
    // 快照与决策之间键漂移（新增节点键 / 存储行变化）不应让 wasm tick trap。
    let position_of = |node_key: &str| -> Result<usize, String> {
        index.get(node_key).copied().ok_or_else(|| {
            fail(
                ReasonCode::StatusUnknown,
                format!("node `{node_key}` is missing from the tick snapshot"),
            )
        })
    };
    let mut touched = false;

    for decision in decisions {
        match decision {
            Decision::Dispatch { node_key, attempt } => {
                touched = true;
                let position = position_of(&node_key)?;
                dispatch_node(store, ports, &record, &mut nodes[position], attempt, now)?;
            }
            Decision::Transition {
                node_key,
                to,
                reason,
            } => {
                touched = true;
                let position = position_of(&node_key)?;
                let node = &mut nodes[position];
                apply_node_transition(store, &record.id, node, to, reason, now)?;
            }
            Decision::Fail {
                node_key,
                reason,
                retryable,
            } => {
                touched = true;
                let position = position_of(&node_key)?;
                let node = &mut nodes[position];
                fail_node(store, ports, &record.id, node, reason, retryable, now)?;
            }
            Decision::Orchestration { to, reason } => {
                apply_orchestration_transition(store, &mut record, to, reason, now)?;
                touched = true;
            }
            Decision::CancelNode { node_key } => {
                touched = true;
                let position = position_of(&node_key)?;
                let node = &mut nodes[position];
                cancel_node(store, ports, &record, node, now)?;
            }
        }
    }

    if touched {
        record.updated_at = now.to_string();
        store.put(&record)?;
    }
    Ok(())
}

fn is_terminal(status: OrchestrationStatus) -> bool {
    matches!(
        status,
        OrchestrationStatus::Cancelled
            | OrchestrationStatus::Completed
            | OrchestrationStatus::Failed
            | OrchestrationStatus::BudgetExhausted
    )
}

fn is_integration_path(path: &str) -> bool {
    INTEGRATION_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

/// 返回（调度快照，单节点探测错误）。探测错误不再 `?` 上抛：一个节点的 IPC
/// 失败不能丢掉整轮 tick，也不能让编排每秒报错却不前进（M6）。
fn build_snapshot(
    store: &impl OrchStore,
    record: &OrchestrationRecord,
    nodes: &[NodeRecord],
    ports: &impl RuntimePort,
    now: &str,
    pty_slots: u8,
) -> Result<(TickSnapshot, Vec<(String, String)>), String> {
    let now_ms = now_ms(now)?;
    let mut facts = Vec::with_capacity(nodes.len());
    let mut probe_errors = Vec::new();
    for node in nodes {
        let active = matches!(
            node.status,
            NodeStatus::Dispatching
                | NodeStatus::Running
                | NodeStatus::AwaitingInput
                | NodeStatus::Verifying
        );
        let active_run = node.run_id.as_deref().filter(|_| active);
        let task_status = match active_run {
            Some(run_id) => match ports.task_status(run_id) {
                Ok(status) => status,
                Err(detail) => {
                    probe_errors.push((node.key.clone(), format!("task_status: {detail}")));
                    None
                }
            },
            None => None,
        };
        let bridge_ready = match active_run {
            Some(run_id) => match ports.bridge_ready(run_id) {
                Ok(ready) => ready,
                Err(detail) => {
                    probe_errors.push((node.key.clone(), format!("bridge_ready: {detail}")));
                    false
                }
            },
            None => false,
        };
        let evidence = if node.status == NodeStatus::Verifying {
            let evidence = evidence_for_attempt(store, record, node)?;
            verdict_from_evidence(node, &evidence)
        } else {
            None
        };
        facts.push(NodeFacts {
            key: node.key.clone(),
            status: node.status,
            attempt: node.attempt,
            depends_on: node.depends_on.clone(),
            write_scope: node.write_scope.clone(),
            task_status,
            dispatched_at_ms: ms(node.dispatched_at.as_deref()),
            bridge_ready,
            // 任务行在派发时即 InProgress，但 prompt 可能还没发出：只有拿到
            // send 回执（command_id 落库）才允许离开 Dispatching。
            send_acknowledged: node.command_id.is_some(),
            timeout_secs: NODE_TIMEOUT_SECS,
            evidence,
        });
    }
    Ok((
        TickSnapshot {
            status: record.status,
            now_ms,
            max_parallel: record.max_parallel,
            pty_slots,
            started_at_ms: ms(record.started_at.as_deref()),
            max_wall_secs: record.budget.max_wall_seconds,
            dispatches_used: nodes.iter().map(|node| node.attempt as u32).sum(),
            max_dispatches: record.budget.max_dispatches,
            nodes: facts,
        },
        probe_errors,
    ))
}

fn evidence_for_attempt(
    store: &impl OrchStore,
    record: &OrchestrationRecord,
    node: &NodeRecord,
) -> Result<Vec<EvidenceRecord>, String> {
    Ok(store
        .evidence(&record.id)?
        .into_iter()
        .filter(|evidence| evidence.node_key == node.key && evidence.attempt == node.attempt)
        .collect())
}

fn payload_string_array(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// 从已落库的证据重建裁决（live tick 与重启 replay 共用同一解释）。
fn verdict_from_evidence(node: &NodeRecord, evidence: &[EvidenceRecord]) -> Option<Verdict> {
    let diff = evidence
        .iter()
        .find(|evidence| evidence.kind == EvidenceKind::Diff);
    let report = evidence::EvidenceReport {
        task_completed: true,
        post_snapshot_available: diff.is_some(),
        // 端口错误从不落库（M9），所以从证据重建的 report 里该集合恒为空。
        port_errors: vec![],
        changed_files: diff
            .map(|diff| payload_string_array(&diff.payload, "files"))
            .unwrap_or_default(),
        scope_violations: diff
            .map(|diff| payload_string_array(&diff.payload, "scopeViolations"))
            .unwrap_or_default(),
        concurrent_writers: diff
            .and_then(|diff| diff.payload.get("concurrentWriters"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        acceptance: match &node.acceptance {
            Acceptance::None => AcceptanceEvidence::NotRun,
            Acceptance::Command { .. } => evidence
                .iter()
                .find(|evidence| evidence.kind == EvidenceKind::Command)
                .map(|evidence| {
                    AcceptanceEvidence::Command(CommandResult {
                        exit_code: evidence
                            .payload
                            .get("exitCode")
                            .and_then(Value::as_i64)
                            .map(|code| code as i32),
                        timed_out: evidence
                            .payload
                            .get("timedOut")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        output_tail: evidence
                            .payload
                            .get("outputTail")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .unwrap_or(AcceptanceEvidence::NotRun),
            Acceptance::Verdict { .. } => evidence
                .iter()
                .find(|evidence| evidence.kind == EvidenceKind::Verdict)
                .map(|evidence| {
                    AcceptanceEvidence::Verdict(
                        match evidence.payload.get("verdict").and_then(Value::as_str) {
                            Some("pass") => Some(ReviewVerdict::Pass),
                            Some("fail") => Some(ReviewVerdict::Fail),
                            _ => None,
                        },
                    )
                })
                .unwrap_or(AcceptanceEvidence::NotRun),
        },
    };
    Some(evidence::judge(&report, &node.acceptance))
}

fn append_evidence(
    store: &impl OrchStore,
    record: &OrchestrationRecord,
    node: &NodeRecord,
    suffix: &str,
    kind: EvidenceKind,
    payload: Value,
    now: &str,
) -> Result<(), String> {
    store.append_evidence(&EvidenceRecord {
        id: format!("{}:{}:{}:{}", record.id, node.key, node.attempt, suffix),
        orchestration_id: record.id.clone(),
        node_key: node.key.clone(),
        attempt: node.attempt,
        kind,
        payload,
        at: now.to_string(),
    })
}

fn ensure_evidence(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &OrchestrationRecord,
    node: &mut NodeRecord,
    // 同编排其他节点的写集并集（由 tick 一次性算好；含已完成的并行节点，
    // 因为它们可能在本节点窗口内先写完再收敛）。
    concurrent_write_scopes: &[String],
    now: &str,
) -> Result<(), String> {
    if !evidence_for_attempt(store, record, node)?.is_empty() {
        return Ok(());
    }
    let Some(pre) = node.pre_snapshot.as_ref() else {
        return append_evidence(
            store,
            record,
            node,
            "note",
            EvidenceKind::Note,
            json!({ "reason": ReasonCode::EvidenceMissing.as_str(), "detail": "missing pre-dispatch snapshot" }),
            now,
        );
    };
    let project = ports
        .project(&record.project_id)?
        .ok_or_else(|| fail(ReasonCode::RunStartFailed, "project does not exist"))?;
    let report = evidence::collect(
        ports,
        &EvidenceRequest {
            working_dir: &project.working_dir,
            pre,
            write_scope: &node.write_scope,
            concurrent_write_scopes,
            run_id: node.run_id.as_deref().unwrap_or_default(),
            acceptance: &node.acceptance,
            default_timeout_secs: 300,
            task_completed: true,
        },
    );
    // 端口故障不落任何证据：哪怕一条 Note 也会被「已有证据即不重采」判据
    // 固化成永久失败。本轮显性报错，下一 tick 重采（M9）。
    if !report.port_errors.is_empty() {
        return Err(fail(
            ReasonCode::EvidenceMissing,
            format!("evidence ports failed: {}", report.port_errors.join("; ")),
        ));
    }
    if report.post_snapshot_available {
        append_evidence(
            store,
            record,
            node,
            "diff",
            EvidenceKind::Diff,
            json!({
                "files": report.changed_files,
                "scopeViolations": report.scope_violations,
                "concurrentWriters": report.concurrent_writers,
            }),
            now,
        )?;
    }
    match &report.acceptance {
        AcceptanceEvidence::Command(result) => append_evidence(
            store,
            record,
            node,
            "acceptance",
            EvidenceKind::Command,
            json!({
                "exitCode": result.exit_code,
                "timedOut": result.timed_out,
                "outputTail": result.output_tail,
            }),
            now,
        )?,
        AcceptanceEvidence::Verdict(verdict) => append_evidence(
            store,
            record,
            node,
            "acceptance",
            EvidenceKind::Verdict,
            json!({
                "verdict": verdict.map(|verdict| match verdict {
                    ReviewVerdict::Pass => "pass",
                    ReviewVerdict::Fail => "fail",
                }),
            }),
            now,
        )?,
        AcceptanceEvidence::NotRun => {}
    }
    Ok(())
}

fn summarize_acceptance(acceptance: &Acceptance, evidence: &[EvidenceRecord]) -> String {
    match acceptance {
        Acceptance::None => "write-set diff only".to_string(),
        Acceptance::Command { .. } => evidence
            .iter()
            .find(|evidence| evidence.kind == EvidenceKind::Command)
            .map(|evidence| {
                let code = evidence
                    .payload
                    .get("exitCode")
                    .and_then(Value::as_i64)
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "signal".to_string());
                format!("exit {code}")
            })
            .unwrap_or_else(|| "command evidence missing".to_string()),
        Acceptance::Verdict { .. } => evidence
            .iter()
            .find(|evidence| evidence.kind == EvidenceKind::Verdict)
            .and_then(|evidence| evidence.payload.get("verdict").and_then(Value::as_str))
            .map(|verdict| format!("VERDICT: {}", verdict.to_uppercase()))
            .unwrap_or_else(|| "verdict evidence missing".to_string()),
    }
}

fn build_work_order(
    store: &impl OrchStore,
    record: &OrchestrationRecord,
    node: &NodeRecord,
) -> Result<String, String> {
    let mut upstream = Vec::new();
    for dependency in &node.depends_on {
        let Some(dep_node) = store.get_node(&record.id, dependency)? else {
            continue;
        };
        if dep_node.status != NodeStatus::Succeeded {
            continue;
        }
        let evidence = evidence_for_attempt(store, record, &dep_node)?;
        let changed_files = evidence
            .iter()
            .find(|evidence| evidence.kind == EvidenceKind::Diff)
            .map(|evidence| payload_string_array(&evidence.payload, "files"))
            .unwrap_or_default();
        let acceptance = summarize_acceptance(&dep_node.acceptance, &evidence);
        upstream.push(UpstreamResult {
            node_key: dep_node.key.clone(),
            attempt: dep_node.attempt,
            status: dep_node.status,
            changed_files,
            acceptance: acceptance.clone(),
            summary: acceptance,
        });
    }
    Ok(compose_work_order(&WorkOrder {
        orchestration_id: &record.id,
        node_key: &node.key,
        attempt: node.attempt,
        role: node.role,
        goal: &record.goal,
        task: &node.prompt,
        write_scope: &node.write_scope,
        acceptance: &node.acceptance,
        upstream: &upstream,
    }))
}

fn dispatch_error_reason(error: &DispatchError) -> ReasonCode {
    match error {
        DispatchError::RunStartFailed { .. } => ReasonCode::RunStartFailed,
        DispatchError::TaskRowFailed { .. } => ReasonCode::StatusUnknown,
        DispatchError::BridgeTimeout { .. } | DispatchError::BridgeProbeFailed { .. } => {
            ReasonCode::BridgeOffline
        }
        DispatchError::ProfileApplyFailed { .. }
        | DispatchError::ProfileTimeout { .. }
        | DispatchError::ProfileCommandMissing { .. } => ReasonCode::AgentProfileFailed,
        DispatchError::SendFailed { .. } => ReasonCode::SendFailed,
    }
}

fn dispatch_error_detail(error: &DispatchError) -> String {
    match error {
        DispatchError::RunStartFailed { detail } => detail.clone(),
        DispatchError::TaskRowFailed { detail, .. } => detail.clone(),
        DispatchError::BridgeTimeout { run_id } => format!("bridge offline for run {run_id}"),
        DispatchError::BridgeProbeFailed { detail, .. } => detail.clone(),
        DispatchError::ProfileApplyFailed { detail, .. } => detail.clone(),
        DispatchError::ProfileTimeout { run_id } => {
            format!("agent profile was not applied for run {run_id}")
        }
        DispatchError::ProfileCommandMissing { run_id, command_id } => {
            format!("agent profile command {command_id} disappeared for run {run_id}")
        }
        DispatchError::SendFailed { detail, .. } => detail.clone(),
    }
}

fn dispatch_node(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &OrchestrationRecord,
    node: &mut NodeRecord,
    attempt: u8,
    now: &str,
) -> Result<(), String> {
    if !matches!(node.status, NodeStatus::Pending | NodeStatus::Ready) {
        return Ok(());
    }
    let project = match ports.project(&record.project_id)? {
        Some(project) => project,
        None => {
            return fail_node(
                store,
                ports,
                &record.id,
                node,
                ReasonCode::RunStartFailed,
                false,
                now,
            )
        }
    };
    if node.pre_snapshot.is_none() {
        match ports.git_status(&project.working_dir, GIT_SNAPSHOT_TIMEOUT_SECS) {
            Ok(snapshot) => node.pre_snapshot = Some(snapshot),
            Err(error) => {
                append_evidence(
                    store,
                    record,
                    node,
                    "note",
                    EvidenceKind::Note,
                    json!({ "reason": ReasonCode::EvidenceMissing.as_str(), "detail": error }),
                    now,
                )?;
                return fail_node(
                    store,
                    ports,
                    &record.id,
                    node,
                    ReasonCode::EvidenceMissing,
                    true,
                    now,
                );
            }
        }
    }

    node.status = NodeStatus::Dispatching;
    node.attempt = attempt;
    node.dispatched_at = Some(now.to_string());
    node.lease = if node.write_scope.is_empty() {
        None
    } else {
        Some(node.write_scope.clone())
    };
    node.task_row_created = false;
    node.command_id = None;
    node.failure_reason = None;
    node.retryable = true;
    node.verifying_started_at = None;
    node.cancel_requested_at = None;
    node.started_at = None;
    node.ended_at = None;
    store.put_node(node)?;

    let work_order = build_work_order(store, record, node)?;
    let claimed = store.claim_dispatch(
        &record.id,
        &node.key,
        attempt,
        json!({ "attempt": attempt, "runId": node.run_id }),
        now,
    )?;
    if claimed.is_none() {
        return Ok(());
    }

    if node.run_id.is_none() {
        node.control_command_id = None;
    }
    let request = DispatchRequest {
        project_id: &record.project_id,
        agent_id: &node.agent_id,
        profile: node.agent_snapshot.as_ref(),
        control_command_id: node.control_command_id,
        work_order: &work_order,
        run_id: node.run_id.as_deref(),
        task_row_created: node.task_row_created,
        command_id: node.command_id,
        dispatched_at_ms: ms(node.dispatched_at.as_deref()),
        now_ms: now_ms(now)?,
        bridge_timeout_ms: BRIDGE_TIMEOUT_MS,
    };
    match dispatch::dispatch(ports, &request) {
        Ok(DispatchOutcome::WaitingForBridge { run_id }) => {
            node.run_id = Some(run_id);
            node.task_row_created = true;
            store.put_node(node)?;
        }
        Ok(DispatchOutcome::WaitingForProfile { run_id, command_id }) => {
            node.run_id = Some(run_id);
            node.task_row_created = true;
            node.control_command_id = Some(command_id);
            store.put_node(node)?;
        }
        Ok(DispatchOutcome::Sent { run_id, command_id })
        | Ok(DispatchOutcome::AlreadySent { run_id, command_id }) => {
            node.run_id = Some(run_id);
            node.command_id = Some(command_id);
            node.task_row_created = true;
            store.put_node(node)?;
        }
        Err(error) => {
            fail_node(
                store,
                ports,
                &record.id,
                node,
                dispatch_error_reason(&error),
                true,
                now,
            )?;
        }
    }
    Ok(())
}

fn resume_dispatch(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &OrchestrationRecord,
    node: &mut NodeRecord,
    now: &str,
) -> Result<(), String> {
    if node.command_id.is_some() {
        return Ok(());
    }
    let work_order = build_work_order(store, record, node)?;
    let request = DispatchRequest {
        project_id: &record.project_id,
        agent_id: &node.agent_id,
        profile: node.agent_snapshot.as_ref(),
        control_command_id: node.control_command_id,
        work_order: &work_order,
        run_id: node.run_id.as_deref(),
        task_row_created: node.task_row_created,
        command_id: None,
        dispatched_at_ms: ms(node.dispatched_at.as_deref()),
        now_ms: now_ms(now)?,
        bridge_timeout_ms: BRIDGE_TIMEOUT_MS,
    };
    match dispatch::dispatch(ports, &request) {
        Ok(DispatchOutcome::WaitingForBridge { run_id }) => {
            node.run_id = Some(run_id);
            node.task_row_created = true;
            store.put_node(node)?;
        }
        Ok(DispatchOutcome::WaitingForProfile { run_id, command_id }) => {
            node.run_id = Some(run_id);
            node.task_row_created = true;
            node.control_command_id = Some(command_id);
            store.put_node(node)?;
        }
        Ok(DispatchOutcome::Sent { run_id, command_id })
        | Ok(DispatchOutcome::AlreadySent { run_id, command_id }) => {
            node.run_id = Some(run_id);
            node.command_id = Some(command_id);
            node.task_row_created = true;
            store.put_node(node)?;
        }
        Err(error) => {
            fail_node(
                store,
                ports,
                &record.id,
                node,
                dispatch_error_reason(&error),
                true,
                now,
            )?;
        }
    }
    Ok(())
}

fn apply_node_transition(
    store: &impl OrchStore,
    orchestration_id: &str,
    node: &mut NodeRecord,
    to: NodeStatus,
    reason: Option<ReasonCode>,
    now: &str,
) -> Result<(), String> {
    node.status = to;
    if to == NodeStatus::Running && node.started_at.is_none() {
        node.started_at = Some(now.to_string());
    }
    if to == NodeStatus::Verifying {
        node.verifying_started_at = Some(now.to_string());
    }
    if matches!(
        to,
        NodeStatus::Succeeded | NodeStatus::Cancelled | NodeStatus::Skipped
    ) {
        node.ended_at = Some(now.to_string());
        node.lease = None;
        node.failure_reason = None;
    }
    if to == NodeStatus::Blocked {
        node.failure_reason = reason;
    }
    let kind = match to {
        NodeStatus::Ready => EventKind::NodeReady,
        NodeStatus::Running => EventKind::NodeRunning,
        NodeStatus::AwaitingInput => EventKind::AwaitingInput,
        NodeStatus::Verifying => EventKind::Verifying,
        NodeStatus::Succeeded => EventKind::NodeSucceeded,
        NodeStatus::Cancelled => EventKind::NodeCancelled,
        NodeStatus::Skipped => EventKind::NodeSkipped,
        NodeStatus::Blocked => EventKind::NodeBlocked,
        NodeStatus::Pending | NodeStatus::Dispatching | NodeStatus::Failed => EventKind::Note,
    };
    store.put_node(node)?;
    append_event(
        store,
        orchestration_id,
        kind,
        Some(&node.key),
        Some(node.attempt),
        json!({
            "attempt": node.attempt,
            "reason": reason.map(|reason| reason.as_str()),
        }),
        now,
    )?;
    Ok(())
}

/// 节点失败前收敛仍存活的 run。
///
/// `fail_node` 会释放租约；若旧进程还在写，resume 后重叠写集的节点就能与它
/// 并发——恰好是租约要防的场景（H4）。收敛失败不阻塞状态机，但逐条落事件。
fn converge_failed_run(ports: &impl RuntimePort, node: &NodeRecord) -> Vec<String> {
    let Some(run_id) = node.run_id.as_deref() else {
        return Vec::new();
    };
    let mut warnings = Vec::new();
    let active = match ports.run_active(run_id) {
        Ok(active) => active,
        Err(error) => {
            warnings.push(format!("run-active probe failed: {error}"));
            true
        }
    };
    if !active {
        return warnings;
    }
    for (action, result) in [
        ("converge_task", ports.converge_task(run_id, "node-failed")),
        ("interrupt", ports.interrupt(run_id)),
        ("close", ports.close(run_id)),
    ] {
        if let Err(error) = result {
            warnings.push(format!("{action}: {error}"));
        }
    }
    warnings
}

fn fail_node(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    orchestration_id: &str,
    node: &mut NodeRecord,
    reason: ReasonCode,
    retryable: bool,
    now: &str,
) -> Result<(), String> {
    let converge_warnings = converge_failed_run(ports, node);
    node.status = NodeStatus::Failed;
    node.retryable = retryable;
    node.failure_reason = Some(reason);
    node.ended_at = Some(now.to_string());
    node.lease = None;
    store.put_node(node)?;
    append_event(
        store,
        orchestration_id,
        EventKind::NodeFailed,
        Some(&node.key),
        Some(node.attempt),
        json!({
            "attempt": node.attempt,
            "reason": reason.as_str(),
            "retryable": retryable,
            "runConvergeWarnings": converge_warnings,
        }),
        now,
    )?;
    Ok(())
}

fn apply_orchestration_transition(
    store: &impl OrchStore,
    record: &mut OrchestrationRecord,
    to: OrchestrationStatus,
    reason: Option<ReasonCode>,
    now: &str,
) -> Result<(), String> {
    record.status = to;
    record.updated_at = now.to_string();
    if let Some(reason) = reason {
        record.failure_reason = Some(reason);
    }
    if is_terminal(to) {
        record.ended_at = Some(now.to_string());
    }
    let kind = match to {
        OrchestrationStatus::Running => EventKind::Resumed,
        OrchestrationStatus::Pausing => EventKind::Pausing,
        OrchestrationStatus::Paused => EventKind::Paused,
        OrchestrationStatus::Cancelling => EventKind::Cancelling,
        OrchestrationStatus::Cancelled => EventKind::Cancelled,
        OrchestrationStatus::Completed => EventKind::Completed,
        OrchestrationStatus::Failed => EventKind::Failed,
        OrchestrationStatus::BudgetExhausted => EventKind::BudgetExhausted,
        OrchestrationStatus::Draft
        | OrchestrationStatus::Planning
        | OrchestrationStatus::AwaitingApproval => EventKind::Note,
    };
    store.put(record)?;
    append_event(
        store,
        &record.id,
        kind,
        None,
        None,
        json!({ "reason": reason.map(|reason| reason.as_str()) }),
        now,
    )?;
    Ok(())
}

fn cancel_node(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &OrchestrationRecord,
    node: &mut NodeRecord,
    now: &str,
) -> Result<(), String> {
    let Some(run_id) = node.run_id.clone() else {
        node.status = NodeStatus::Cancelled;
        node.ended_at = Some(now.to_string());
        node.lease = None;
        store.put_node(node)?;
        append_event(
            store,
            &record.id,
            EventKind::NodeCancelled,
            Some(&node.key),
            Some(node.attempt),
            json!({ "attempt": node.attempt, "reason": "no-run" }),
            now,
        )?;
        return Ok(());
    };
    let now_ms = now_ms(now)?;
    // `cancel` 不再把宿主动作失败上抛：run 已回收 / 无 PTY / 宿主重启是常态，
    // 每个 tick 都报错会让编排永久停在 Cancelling（H3）。失败落事件但继续收敛。
    let outcome = dispatch::cancel(
        ports,
        &run_id,
        ms(node.cancel_requested_at.as_deref()),
        now_ms,
    );
    match outcome {
        CancelOutcome::Interrupted => {
            node.cancel_requested_at = Some(now.to_string());
            store.put_node(node)?;
        }
        CancelOutcome::Degraded {
            action,
            detail,
            closed: false,
        } => {
            // 中断失败也要写下时间，否则下一 tick 又会重走 interrupt，永远
            // 升级不到 close；宽限期内照常收敛。
            node.cancel_requested_at = Some(now.to_string());
            store.put_node(node)?;
            append_event(
                store,
                &record.id,
                EventKind::Note,
                Some(&node.key),
                Some(node.attempt),
                json!({
                    "reason": "cancel-degraded",
                    "action": action,
                    "detail": detail,
                }),
                now,
            )?;
        }
        CancelOutcome::WaitingForGrace => {}
        CancelOutcome::Closed => mark_cancelled(store, &record.id, node, "closed", None, now)?,
        CancelOutcome::Degraded {
            action,
            detail,
            closed: true,
        } => {
            // close 失败通常意味着 run 早已被回收：视为已收敛，但把失败写进
            // 节点事件，不静默当成功。
            mark_cancelled(store, &record.id, node, action, Some(&detail), now)?
        }
    }
    Ok(())
}

fn mark_cancelled(
    store: &impl OrchStore,
    orchestration_id: &str,
    node: &mut NodeRecord,
    reason: &str,
    detail: Option<&str>,
    now: &str,
) -> Result<(), String> {
    node.status = NodeStatus::Cancelled;
    node.ended_at = Some(now.to_string());
    node.lease = None;
    store.put_node(node)?;
    append_event(
        store,
        orchestration_id,
        EventKind::NodeCancelled,
        Some(&node.key),
        Some(node.attempt),
        json!({ "attempt": node.attempt, "reason": reason, "detail": detail }),
        now,
    )?;
    Ok(())
}

// ==================== 激活期恢复对账 ====================

pub(crate) struct RecoveryReport {
    pub checked: usize,
    pub failed_nodes: usize,
    pub paused: usize,
    pub errors: Vec<(String, String)>,
}

/// 插件激活时扫描非终态编排：只对账、不重发（设计不变量 10）。
///
/// - `Dispatching` 且 send 回执未知 → `dispatch-unknown`；
/// - run 已终态 → `run-ended`；run 不存在 → `status-unknown`；
/// - 失败节点落 `failed`，编排落 `paused`；`cancelling` 交给 tick 继续取消，不在此处理。
pub(crate) fn recover_all(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    now: &str,
) -> Result<RecoveryReport, String> {
    let mut report = RecoveryReport {
        checked: 0,
        failed_nodes: 0,
        paused: 0,
        errors: Vec::new(),
    };
    for record in store.list(None)? {
        if record.status == OrchestrationStatus::Planning {
            report.checked += 1;
            let id = record.id.clone();
            let mut record = record;
            // 单个 planner 探测失败不能中断整次对账：记错误并继续其它编排（M7/L7）。
            let planner_ended = match record.planner_run_id.as_deref() {
                Some(run_id) => match ports.run_state(run_id) {
                    Ok(state) => !matches!(state, RunState::Running),
                    Err(error) => {
                        report.errors.push((
                            id.clone(),
                            format!("planner run `{run_id}` state probe failed: {error}"),
                        ));
                        continue;
                    }
                },
                None => true,
            };
            if planner_ended {
                if let Err(error) = planner_fail(
                    store,
                    ports,
                    &mut record,
                    ReasonCode::PlannerFailed,
                    "planner run ended while the plugin was inactive",
                    now,
                ) {
                    report.errors.push((id, error));
                }
            }
            continue;
        }
        if !matches!(
            record.status,
            OrchestrationStatus::Running | OrchestrationStatus::Pausing
        ) {
            continue;
        }
        report.checked += 1;
        let id = record.id.clone();
        match recover_one(store, ports, record, now) {
            Ok((failed, paused)) => {
                report.failed_nodes += failed;
                report.paused += usize::from(paused);
            }
            Err(error) => report.errors.push((id, error)),
        }
    }
    Ok(report)
}

fn recover_one(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    mut record: OrchestrationRecord,
    now: &str,
) -> Result<(usize, bool), String> {
    let nodes = store.nodes(&record.id)?;
    let mut recovery_nodes = Vec::with_capacity(nodes.len());
    for node in &nodes {
        let (run_state, bridge_online) = match node.run_id.as_deref() {
            Some(run_id) => (
                ports
                    .run_state(run_id)
                    .map_err(|error| format!("node `{}` run_state failed: {error}", node.key))?,
                // 探测错误不能伪装成「桥接离线」并触发 Pause（M7）。
                ports
                    .bridge_ready(run_id)
                    .map_err(|error| format!("node `{}` bridge_ready failed: {error}", node.key))?,
            ),
            None => (RunState::NotStarted, false),
        };
        recovery_nodes.push(RecoveryNode {
            key: node.key.clone(),
            status: node.status,
            run_state,
            bridge_online,
            send_acknowledged: node.command_id.is_some(),
        });
    }

    let decisions = recover::recover(&RecoverySnapshot {
        nodes: recovery_nodes,
    });
    let mut failed = 0;
    let mut pause_reason = None;
    for decision in decisions {
        match decision {
            RecoveryDecision::KeepRunning => {}
            RecoveryDecision::MarkFailed {
                node_key,
                reason,
                retryable,
            } => {
                if let Some(mut node) = store.get_node(&record.id, &node_key)? {
                    fail_node(store, ports, &record.id, &mut node, reason, retryable, now)?;
                    failed += 1;
                }
            }
            RecoveryDecision::Pause { reason } => {
                pause_reason = Some(reason);
            }
        }
    }

    if let Some(reason) = pause_reason {
        record.status = OrchestrationStatus::Paused;
        record.failure_reason = Some(reason);
        record.updated_at = now.to_string();
        store.put(&record)?;
        append_event(
            store,
            &record.id,
            EventKind::Paused,
            None,
            None,
            json!({ "reason": reason.as_str(), "source": "recovery" }),
            now,
        )?;
        return Ok((failed, true));
    }

    Ok((failed, false))
}

// ==================== 自动计划（planner run） ====================

/// 专用编排 skill：静态契约住 `skill/orchestration-planner.md`（可单独评审 / 演进），
/// 动态 roster 与任务在调用时拼在后面。skill 是「让 AI 编排」的唯一指令真源，
/// Rust 里不再复制一份 JSON schema。
const PLANNER_SKILL: &str = include_str!("skill/orchestration-planner.md");

fn planner_roster(profiles: &[AgentProfile]) -> Value {
    let agents: Vec<Value> = profiles
        .iter()
        .filter(|profile| profile.enabled && crate::run::bridge::supports_bridge(&profile.cli))
        .map(|profile| {
            json!({
                "id": profile.id,
                "name": profile.name,
                "cli": profile.cli,
                "model": profile.model,
                "thinkingLevel": profile.thinking_level,
                "tags": profile.tags,
                "specialties": profile.specialties,
                "description": profile.description,
            })
        })
        .collect();
    json!({ "agents": agents })
}

fn planner_prompt(record: &OrchestrationRecord, profiles: &[AgentProfile]) -> String {
    let roster = serde_json::to_string_pretty(&planner_roster(profiles))
        .unwrap_or_else(|_| "{\"agents\":[]}".to_string());
    format!(
        "[BEDCODE ORCHESTRATION SKILL v1]\n\
         {PLANNER_SKILL}\n\n\
         [ROSTER]\n{roster}\n\n\
         [TASK]\n\
         title: {}\n\
         goal: {}\n",
        record.title, record.goal
    )
}

fn truncate_planner_output(text: &str) -> String {
    if text.len() <= PLANNER_OUTPUT_MAX_BYTES {
        return text.to_string();
    }
    let mut end = PLANNER_OUTPUT_MAX_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…[truncated]", &text[..end])
}

/// 从模型输出提取计划 JSON：剥代码围栏 → 首个 `{` 到最后一个 `}`。
fn extract_plan(text: &str) -> Option<Plan> {
    let trimmed = text.trim();
    let unfenced = if trimmed.starts_with("```") {
        let body = trimmed
            .split_once('\n')
            .map(|(_, body)| body)
            .unwrap_or(trimmed);
        body.rsplit_once("```")
            .map(|(body, _)| body)
            .unwrap_or(body)
            .trim()
    } else {
        trimmed
    };
    let start = unfenced.find('{')?;
    let end = unfenced.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&unfenced[start..=end]).ok()
}

fn close_planner_run(ports: &impl RuntimePort, record: &mut OrchestrationRecord) {
    if let Some(run_id) = record.planner_run_id.clone() {
        let _ = ports.close(&run_id);
    }
    record.planner_command_id = None;
    record.planner_control_command_id = None;
    record.planner_dispatched_at = None;
}

fn planner_fail(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &mut OrchestrationRecord,
    reason: ReasonCode,
    detail: &str,
    now: &str,
) -> Result<(), String> {
    record.status = OrchestrationStatus::Draft;
    record.failure_reason = Some(reason);
    record.updated_at = now.to_string();
    close_planner_run(ports, record);
    store.put(record)?;
    append_event(
        store,
        &record.id,
        EventKind::Note,
        None,
        None,
        json!({ "status": "draft", "reason": reason.as_str(), "detail": detail }),
        now,
    )?;
    Ok(())
}

fn finish_planner_output(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &mut OrchestrationRecord,
    text: &str,
    now: &str,
) -> Result<(), String> {
    let Some(mut plan) = extract_plan(text) else {
        record.plan = None;
        store.replace_nodes(&record.id, &[])?;
        record.plan_error = Some(vec![PlanError {
            code: PlanErrorCode::PlannerInvalidJson.as_str().to_string(),
            node_key: None,
            message: "planner output is not a valid plan JSON object".to_string(),
        }]);
        record.planner_output = Some(truncate_planner_output(text));
        return planner_fail(
            store,
            ports,
            record,
            ReasonCode::PlannerInvalidJson,
            "planner output is not a valid plan JSON object",
            now,
        );
    };

    let profiles = ports.agent_profiles()?;
    let bind_errors = plan::bind_agents(&mut plan, &profiles);
    let validation = if bind_errors.is_empty() {
        plan::validate(&plan, PlanMode::Auto)
    } else {
        Err(bind_errors)
    };
    match validation {
        Ok(()) => {
            record.plan = Some(plan.clone());
            store.replace_nodes(&record.id, &nodes_from_plan(&record.id, &plan))?;
            record.status = OrchestrationStatus::AwaitingApproval;
            record.plan_error = None;
            record.planner_output = None;
            record.failure_reason = None;
            record.max_parallel = plan.max_parallel;
            record.budget.max_dispatches = max_dispatches(&plan);
            record.updated_at = now.to_string();
            close_planner_run(ports, record);
            store.put(record)?;
            append_event(
                store,
                &record.id,
                EventKind::PlanSaved,
                None,
                None,
                json!({ "planRev": record.plan_rev, "source": "planner" }),
                now,
            )?;
            if record.require_approval {
                return Ok(());
            }
            // 参数化的人工确认：关闭时校验通过即自动批准并尝试开始；开始检查
            //（工作树脏 / CLI 未装）失败则退回 awaiting-approval，计划不丢。
            record.approved_at = Some(now.to_string());
            record.approved_plan_rev = Some(record.plan_rev);
            record.updated_at = now.to_string();
            store.put(record)?;
            append_event(
                store,
                &record.id,
                EventKind::Approved,
                None,
                None,
                json!({ "planRev": record.plan_rev, "source": "auto" }),
                now,
            )?;
            match begin_execution(store, ports, record, &plan, now) {
                Ok(()) => Ok(()),
                Err(error) => {
                    let reason = error
                        .split(':')
                        .next()
                        .and_then(ReasonCode::from_wire)
                        .unwrap_or(ReasonCode::AutoStartFailed);
                    record.status = OrchestrationStatus::AwaitingApproval;
                    record.failure_reason = Some(reason);
                    record.updated_at = now.to_string();
                    store.put(record)?;
                    append_event(
                        store,
                        &record.id,
                        EventKind::Note,
                        None,
                        None,
                        json!({
                            "status": "awaiting-approval",
                            "reason": reason.as_str(),
                            "detail": error,
                            "source": "auto-start",
                        }),
                        now,
                    )?;
                    Ok(())
                }
            }
        }
        Err(errors) => {
            record.plan = Some(plan);
            store.replace_nodes(&record.id, &[])?;
            record.status = OrchestrationStatus::Draft;
            record.plan_error = Some(errors);
            record.planner_output = Some(truncate_planner_output(text));
            record.updated_at = now.to_string();
            close_planner_run(ports, record);
            store.put(record)?;
            append_event(
                store,
                &record.id,
                EventKind::PlanInvalid,
                None,
                None,
                json!({ "planRev": record.plan_rev, "source": "planner" }),
                now,
            )?;
            Ok(())
        }
    }
}

fn tick_planner(
    store: &impl OrchStore,
    ports: &impl RuntimePort,
    record: &mut OrchestrationRecord,
    now: &str,
) -> Result<(), String> {
    let Some(run_id) = record.planner_run_id.clone() else {
        return planner_fail(
            store,
            ports,
            record,
            ReasonCode::PlannerFailed,
            "planner run id is missing",
            now,
        );
    };

    if record.planner_command_id.is_none() {
        let profiles = ports.agent_profiles()?;
        let work_order = planner_prompt(record, &profiles);
        let agent = record
            .planner_agent_id
            .as_deref()
            .ok_or_else(|| fail(ReasonCode::PlannerFailed, "planner CLI is missing"))?;
        let request = DispatchRequest {
            project_id: &record.project_id,
            agent_id: agent,
            profile: record.planner_agent.as_ref(),
            control_command_id: record.planner_control_command_id,
            work_order: &work_order,
            run_id: Some(&run_id),
            task_row_created: record.planner_task_row_created,
            command_id: None,
            dispatched_at_ms: ms(record.planner_dispatched_at.as_deref()),
            now_ms: now_ms(now)?,
            bridge_timeout_ms: BRIDGE_TIMEOUT_MS,
        };
        return match dispatch::dispatch(ports, &request) {
            Ok(DispatchOutcome::WaitingForBridge { .. }) => Ok(()),
            Ok(DispatchOutcome::WaitingForProfile { command_id, .. }) => {
                record.planner_control_command_id = Some(command_id);
                record.updated_at = now.to_string();
                store.put(record)?;
                Ok(())
            }
            Ok(DispatchOutcome::Sent { command_id, .. })
            | Ok(DispatchOutcome::AlreadySent { command_id, .. }) => {
                record.planner_command_id = Some(command_id);
                record.updated_at = now.to_string();
                store.put(record)?;
                Ok(())
            }
            Err(error) => planner_fail(
                store,
                ports,
                record,
                dispatch_error_reason(&error),
                &dispatch_error_detail(&error),
                now,
            ),
        };
    }

    match ports.task_status(&run_id)? {
        Some(TaskStatus::Completed) => {
            let text = ports.last_assistant_text(&run_id)?.unwrap_or_default();
            finish_planner_output(store, ports, record, &text, now)
        }
        Some(TaskStatus::Interrupted) => planner_fail(
            store,
            ports,
            record,
            ReasonCode::AgentInterrupted,
            "planner run was interrupted",
            now,
        ),
        _ => {
            let current = now_ms(now)?;
            if let Some(dispatched) = ms(record.planner_dispatched_at.as_deref()) {
                if current - dispatched > (PLANNER_TIMEOUT_SECS as i64) * 1000 {
                    return planner_fail(
                        store,
                        ports,
                        record,
                        ReasonCode::TaskTimeout,
                        "planner run exceeded its wall clock",
                        now,
                    );
                }
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
