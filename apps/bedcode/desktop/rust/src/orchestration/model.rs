//! 编排 wire 类型：计划、状态、动作、证据。序列化形状即前后端契约。

use serde::{Deserialize, Serialize};

macro_rules! vocabulary {
    ($ty:ty; $($variant:ident => $wire:literal),+ $(,)?) => {
        impl $ty {
            pub(crate) const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub(crate) fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $wire),+
                }
            }

            #[allow(dead_code)]
            pub(crate) fn from_wire(value: &str) -> Option<Self> {
                Self::ALL
                    .iter()
                    .copied()
                    .find(|variant| variant.as_str() == value)
            }
        }
    };
}

/// 计划契约版本：v2 起节点持 `agentRef` + 派发快照（v1 的裸 CLI `agentId` 已退役）。
pub(crate) const PLAN_VERSION: u32 = 2;
pub(crate) const MAX_NODES: usize = 20;
pub(crate) const MAX_PARALLEL: u8 = 4;
pub(crate) const MAX_ATTEMPTS: u8 = 3;

fn default_max_parallel() -> u8 {
    2
}

fn default_max_attempts() -> u8 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PlanMode {
    Manual,
    Auto,
}

impl PlanMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            PlanMode::Manual => "manual",
            PlanMode::Auto => "auto",
        }
    }

    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "manual" => Some(PlanMode::Manual),
            "auto" => Some(PlanMode::Auto),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Plan {
    pub version: u32,
    pub title: String,
    pub goal: String,
    #[serde(default = "default_max_parallel")]
    pub max_parallel: u8,
    pub nodes: Vec<PlanNode>,
}

/// 派发快照：计划批准 / 节点派发时对池成员的只读拷贝。
///
/// 快照是执行期的**唯一权威**：池成员在批准后被编辑 / 删除，已批准计划仍按
/// 快照执行，不会半路换模型或换 CLI；未批准的旧计划在下一次校验时显性报错。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentSnapshot {
    pub profile_id: String,
    pub name: String,
    pub cli: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub thinking_level: Option<String>,
}

impl AgentSnapshot {
    /// 是否需要在派发前应用运行内模型 / 思考等级。
    pub(crate) fn has_control(&self) -> bool {
        self.model.is_some() || self.thinking_level.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanNode {
    pub key: String,
    pub title: String,
    pub role: Role,
    /// 池成员 id（不是 CLI；CLI 在派发快照里）
    pub agent_ref: String,
    /// 服务端校验 / 批准时填入；planner 输出不需要带
    #[serde(default)]
    pub agent: Option<AgentSnapshot>,
    pub prompt: String,
    /// 编排 Agent 的选人理由（自动计划必填项的展示面；手动计划可空）
    #[serde(default)]
    pub match_reason: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub write_scope: Vec<String>,
    pub acceptance: Acceptance,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Role {
    Planner,
    Coder,
    Reviewer,
    Observer,
    Custom,
}

vocabulary!(Role;
    Planner => "planner",
    Coder => "coder",
    Reviewer => "reviewer",
    Observer => "observer",
    Custom => "custom",
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Acceptance {
    None,
    Command {
        command: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        timeout_sec: Option<u64>,
    },
    Verdict {
        #[serde(default)]
        timeout_sec: Option<u64>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum OrchestrationStatus {
    Draft,
    Planning,
    AwaitingApproval,
    Running,
    Pausing,
    Paused,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
    BudgetExhausted,
}

vocabulary!(OrchestrationStatus;
    Draft => "draft",
    Planning => "planning",
    AwaitingApproval => "awaiting-approval",
    Running => "running",
    Pausing => "pausing",
    Paused => "paused",
    Cancelling => "cancelling",
    Cancelled => "cancelled",
    Completed => "completed",
    Failed => "failed",
    BudgetExhausted => "budget-exhausted",
);

/// 任务域回合状态（只读观察面，不归编排所有）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskStatus {
    InProgress,
    Asking,
    Retrying,
    Completed,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NodeStatus {
    Pending,
    Ready,
    Dispatching,
    Running,
    AwaitingInput,
    Verifying,
    Succeeded,
    Failed,
    Cancelled,
    Skipped,
    Blocked,
}

vocabulary!(NodeStatus;
    Pending => "pending",
    Ready => "ready",
    Dispatching => "dispatching",
    Running => "running",
    AwaitingInput => "awaiting-input",
    Verifying => "verifying",
    Succeeded => "succeeded",
    Failed => "failed",
    Cancelled => "cancelled",
    Skipped => "skipped",
    Blocked => "blocked",
);

/// fail-visible reason 词表：协议值是 kebab-case，UI 文案按 key 映射。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ReasonCode {
    AgentUnsupported,
    AgentNotReady,
    AgentProfileFailed,
    AutoStartFailed,
    ProjectNotGit,
    WorkingTreeDirty,
    ProjectTrustRequired,
    BridgeOffline,
    RunStartFailed,
    SendFailed,
    DispatchUnknown,
    StatusUnknown,
    TaskTimeout,
    AgentInterrupted,
    PermissionWaiting,
    ScopeViolation,
    AcceptanceFailed,
    EvidenceMissing,
    PlanInvalid,
    PlannerFailed,
    PlannerInvalidJson,
    QuotaWait,
    BudgetExceeded,
    DeadlockSuspected,
    ApprovalRequired,
    DependencyFailed,
    NodeFailed,
    RunEnded,
    NotRetryable,
    AttemptsExhausted,
}

vocabulary!(ReasonCode;
    AgentUnsupported => "agent-unsupported",
    AgentNotReady => "agent-not-ready",
    AgentProfileFailed => "agent-profile-failed",
    AutoStartFailed => "auto-start-failed",
    ProjectNotGit => "project-not-git",
    WorkingTreeDirty => "working-tree-dirty",
    ProjectTrustRequired => "project-trust-required",
    BridgeOffline => "bridge-offline",
    RunStartFailed => "run-start-failed",
    SendFailed => "send-failed",
    DispatchUnknown => "dispatch-unknown",
    StatusUnknown => "status-unknown",
    TaskTimeout => "task-timeout",
    AgentInterrupted => "agent-interrupted",
    PermissionWaiting => "permission-waiting",
    ScopeViolation => "scope-violation",
    AcceptanceFailed => "acceptance-failed",
    EvidenceMissing => "evidence-missing",
    PlanInvalid => "plan-invalid",
    PlannerFailed => "planner-failed",
    PlannerInvalidJson => "planner-invalid-json",
    QuotaWait => "quota-wait",
    BudgetExceeded => "budget-exceeded",
    DeadlockSuspected => "deadlock-suspected",
    ApprovalRequired => "approval-required",
    DependencyFailed => "dependency-failed",
    NodeFailed => "node-failed",
    RunEnded => "run-ended",
    NotRetryable => "not-retryable",
    AttemptsExhausted => "attempts-exhausted",
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PlanErrorCode {
    UnsupportedVersion,
    InvalidNodeCount,
    InvalidMaxParallel,
    InvalidNodeKey,
    DuplicateNodeKey,
    InvalidMaxAttempts,
    InvalidWriteScope,
    InvalidAcceptanceCommand,
    InvalidAcceptanceTimeout,
    CommandNotAllowed,
    InvalidAcceptanceCwd,
    ReadonlyRoleWriteScope,
    ReadonlyRoleAcceptance,
    SelfDependency,
    UnknownDependency,
    DependencyCycle,
    AgentUnsupported,
    UnknownAgent,
    AgentDisabled,
    PlannerInvalidJson,
}

vocabulary!(PlanErrorCode;
    UnsupportedVersion => "unsupported-version",
    InvalidNodeCount => "invalid-node-count",
    InvalidMaxParallel => "invalid-max-parallel",
    InvalidNodeKey => "invalid-node-key",
    DuplicateNodeKey => "duplicate-node-key",
    InvalidMaxAttempts => "invalid-max-attempts",
    InvalidWriteScope => "invalid-write-scope",
    InvalidAcceptanceCommand => "invalid-acceptance-command",
    InvalidAcceptanceTimeout => "invalid-acceptance-timeout",
    CommandNotAllowed => "command-not-allowed",
    InvalidAcceptanceCwd => "invalid-acceptance-cwd",
    ReadonlyRoleWriteScope => "readonly-role-write-scope",
    ReadonlyRoleAcceptance => "readonly-role-acceptance",
    SelfDependency => "self-dependency",
    UnknownDependency => "unknown-dependency",
    DependencyCycle => "dependency-cycle",
    AgentUnsupported => "agent-unsupported",
    UnknownAgent => "unknown-agent",
    AgentDisabled => "agent-disabled",
    PlannerInvalidJson => "planner-invalid-json",
);

/// 编排时间线事件类型（§7.13）；协议值 snake_case，UI 文案按 key 映射。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EventKind {
    Created,
    PlanSaved,
    PlanInvalid,
    Planned,
    Approved,
    Started,
    Pausing,
    Paused,
    Resumed,
    Cancelling,
    Cancelled,
    Completed,
    Failed,
    BudgetExhausted,
    NodeReady,
    Dispatched,
    NodeRunning,
    AwaitingInput,
    Verifying,
    NodeSucceeded,
    NodeFailed,
    NodeCancelled,
    NodeSkipped,
    NodeBlocked,
    Retried,
    Note,
}

vocabulary!(EventKind;
    Created => "created",
    PlanSaved => "plan_saved",
    PlanInvalid => "plan_invalid",
    Planned => "planned",
    Approved => "approved",
    Started => "started",
    Pausing => "pausing",
    Paused => "paused",
    Resumed => "resumed",
    Cancelling => "cancelling",
    Cancelled => "cancelled",
    Completed => "completed",
    Failed => "failed",
    BudgetExhausted => "budget_exhausted",
    NodeReady => "node_ready",
    Dispatched => "dispatched",
    NodeRunning => "node_running",
    AwaitingInput => "awaiting_input",
    Verifying => "verifying",
    NodeSucceeded => "node_succeeded",
    NodeFailed => "node_failed",
    NodeCancelled => "node_cancelled",
    NodeSkipped => "node_skipped",
    NodeBlocked => "node_blocked",
    Retried => "retried",
    Note => "note",
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ActionKind {
    Approve,
    Start,
    Pause,
    Resume,
    Cancel,
    RetryNode,
    SkipNode,
    Replan,
    EditPlan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Action {
    pub kind: ActionKind,
    pub enabled: bool,
    pub reason: Option<ReasonCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanError {
    pub code: String,
    pub node_key: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentOption {
    pub id: String,
    pub display_name: String,
    pub ready: bool,
    /// 有桥接、可被编排派发；无桥接 CLI 仍会出现在清单（建池成员用）。
    pub orchestratable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetaView {
    pub statuses: Vec<String>,
    pub node_statuses: Vec<String>,
    pub roles: Vec<String>,
    pub acceptance_types: Vec<String>,
    pub reason_codes: Vec<String>,
    pub plan_error_codes: Vec<String>,
    pub event_kinds: Vec<String>,
    /// 旧面：CLI 清单（全量已适配 CLI；`orchestratable` 表达桥接能力）
    pub agents: Vec<AgentOption>,
    /// 新面：Agent 池（编排选人的唯一候选集）
    pub agent_profiles: Vec<crate::agent_pool::model::AgentProfileView>,
}

pub(crate) const ACCEPTANCE_TYPES: &[&str] = &["none", "command", "verdict"];

/// 词表唯一源：UI 的状态色 / 图标 / i18n 必须覆盖这里返回的每一项。
pub(crate) fn meta(
    agents: &[AgentOption],
    agent_profiles: &[crate::agent_pool::model::AgentProfileView],
) -> MetaView {
    MetaView {
        statuses: OrchestrationStatus::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        node_statuses: NodeStatus::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        roles: Role::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        acceptance_types: ACCEPTANCE_TYPES
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        reason_codes: ReasonCode::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        plan_error_codes: PlanErrorCode::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        event_kinds: EventKind::ALL
            .iter()
            .map(|value| value.as_str().to_string())
            .collect(),
        // 全量下发：池子允许为所有已安装 CLI 建配置；能否编排由
        // `orchestratable` 逐项表达（过滤在前端/计划校验做，不在清单里隐去）。
        agents: agents.to_vec(),
        agent_profiles: agent_profiles.to_vec(),
    }
}

#[cfg(test)]
mod tests;
