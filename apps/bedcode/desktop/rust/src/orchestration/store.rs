//! 编排私有库：四张表的端口与投影读写。
//!
//! 端口按**记录语义**暴露，SQL 只存在于 wasm 实现里（与 `project/store.rs` 同模式：
//! native 链接不引用 wasm 专属 import 符号）。native 测试用 [`MemoryStore`]。
//!
//! 事件表是 append-only 审计真源；编排 / 节点行是同一份事实的查询投影。
//! 派发幂等由 `(orchestration_id, node_key, attempt)` 的 partial unique index 兜底。

use serde::{Deserialize, Serialize};

use super::model::{
    Acceptance, AgentSnapshot, EventKind, NodeStatus, OrchestrationStatus, Plan, PlanError,
    PlanMode, ReasonCode, Role,
};

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub(crate) const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS orchestrations (\
     id TEXT PRIMARY KEY, \
     project_id TEXT NOT NULL, \
     title TEXT NOT NULL, \
     goal TEXT NOT NULL, \
     mode TEXT NOT NULL, \
     require_approval INTEGER NOT NULL DEFAULT 1, \
     orchestrator_agent_id TEXT, \
     status TEXT NOT NULL, \
     plan_json TEXT, \
     plan_rev INTEGER NOT NULL, \
     plan_error_json TEXT, \
     planner_output TEXT, \
     max_parallel INTEGER NOT NULL, \
     budget_json TEXT NOT NULL, \
     planner_run_id TEXT, \
     planner_agent_id TEXT, \
     planner_agent_json TEXT, \
     planner_command_id INTEGER, \
     planner_control_command_id INTEGER, \
     planner_dispatched_at TEXT, \
     planner_task_row_created INTEGER NOT NULL DEFAULT 0, \
     approved_at TEXT, \
     approved_plan_rev INTEGER, \
     failure_reason TEXT, \
     created_at TEXT NOT NULL, \
     updated_at TEXT NOT NULL, \
     started_at TEXT, \
     ended_at TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_orchestrations_updated ON orchestrations(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_orchestrations_project ON orchestrations(project_id)",
    "CREATE TABLE IF NOT EXISTS orchestration_nodes (\
     id TEXT PRIMARY KEY, \
     orchestration_id TEXT NOT NULL, \
     node_key TEXT NOT NULL, \
     title TEXT NOT NULL, \
     role TEXT NOT NULL, \
     agent_id TEXT NOT NULL, \
     agent_ref TEXT NOT NULL DEFAULT '', \
     agent_snapshot_json TEXT, \
     match_reason TEXT NOT NULL DEFAULT '', \
     prompt TEXT NOT NULL, \
     deps_json TEXT NOT NULL, \
     write_scope_json TEXT NOT NULL, \
     acceptance_json TEXT NOT NULL, \
     status TEXT NOT NULL, \
     attempt INTEGER NOT NULL, \
     max_attempts INTEGER NOT NULL, \
     run_id TEXT, \
     command_id INTEGER, \
     control_command_id INTEGER, \
     lease_json TEXT, \
     pre_snapshot_json TEXT, \
     task_row_created INTEGER NOT NULL DEFAULT 0, \
     retryable INTEGER NOT NULL DEFAULT 1, \
     failure_reason TEXT, \
     dispatched_at TEXT, \
     verifying_started_at TEXT, \
     cancel_requested_at TEXT, \
     started_at TEXT, \
     ended_at TEXT, \
     UNIQUE(orchestration_id, node_key))",
    "CREATE INDEX IF NOT EXISTS idx_orchestration_nodes_orch ON orchestration_nodes(orchestration_id)",
    "CREATE TABLE IF NOT EXISTS orchestration_events (\
     id INTEGER PRIMARY KEY AUTOINCREMENT, \
     orchestration_id TEXT NOT NULL, \
     seq INTEGER NOT NULL, \
     kind TEXT NOT NULL, \
     node_key TEXT, \
     attempt INTEGER, \
     payload_json TEXT NOT NULL, \
     at TEXT NOT NULL, \
     UNIQUE(orchestration_id, seq))",
    // 派发幂等硬闸：同一 (node, attempt) 只允许一条 dispatched 事件
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestration_dispatched \
     ON orchestration_events(orchestration_id, node_key, attempt) \
     WHERE kind = 'dispatched'",
    "CREATE TABLE IF NOT EXISTS orchestration_evidence (\
     id TEXT PRIMARY KEY, \
     orchestration_id TEXT NOT NULL, \
     node_key TEXT NOT NULL, \
     attempt INTEGER NOT NULL, \
     kind TEXT NOT NULL, \
     payload_json TEXT NOT NULL, \
     at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_orchestration_evidence_orch \
     ON orchestration_evidence(orchestration_id, node_key, attempt)",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Budget {
    pub max_wall_seconds: u64,
    pub max_dispatches: u32,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            max_wall_seconds: 7200,
            max_dispatches: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OrchestrationRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub goal: String,
    pub mode: PlanMode,
    /// 自动计划完成后是否需要人工批准（false = 校验通过即自动开始）
    pub require_approval: bool,
    /// 编排 Agent（池成员 id；自动计划必填）
    pub orchestrator_agent_id: Option<String>,
    pub status: OrchestrationStatus,
    pub plan: Option<Plan>,
    pub plan_rev: i64,
    pub plan_error: Option<Vec<PlanError>>,
    pub planner_output: Option<String>,
    pub max_parallel: u8,
    pub budget: Budget,
    pub planner_run_id: Option<String>,
    pub planner_agent_id: Option<String>,
    pub planner_agent: Option<AgentSnapshot>,
    pub planner_command_id: Option<i64>,
    pub planner_control_command_id: Option<i64>,
    pub planner_dispatched_at: Option<String>,
    pub planner_task_row_created: bool,
    pub approved_at: Option<String>,
    pub approved_plan_rev: Option<i64>,
    pub failure_reason: Option<ReasonCode>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

impl OrchestrationRecord {
    /// 批准只对“当前计划版本”有效：改计划 = 改 rev = 失效。
    pub(crate) fn approved(&self) -> bool {
        self.plan.is_some() && self.approved_plan_rev == Some(self.plan_rev)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NodeRecord {
    pub id: String,
    pub orchestration_id: String,
    pub key: String,
    pub title: String,
    pub role: Role,
    /// 执行载体 CLI（派发快照 cli 的投影；start_run / task 行仍按它）
    pub agent_id: String,
    /// 池成员 id
    pub agent_ref: String,
    /// 派发快照（批准 / 校验时钉住；不再回读池子）
    pub agent_snapshot: Option<AgentSnapshot>,
    pub match_reason: String,
    pub prompt: String,
    pub depends_on: Vec<String>,
    pub write_scope: Vec<String>,
    pub acceptance: Acceptance,
    pub status: NodeStatus,
    pub attempt: u8,
    pub max_attempts: u8,
    pub run_id: Option<String>,
    pub command_id: Option<i64>,
    /// 派发前应用模型 / 思考等级的命令 id（等待回执后才发 work order）
    pub control_command_id: Option<i64>,
    pub lease: Option<Vec<String>>,
    pub pre_snapshot: Option<super::evidence::GitSnapshot>,
    pub task_row_created: bool,
    pub retryable: bool,
    pub failure_reason: Option<ReasonCode>,
    pub dispatched_at: Option<String>,
    pub verifying_started_at: Option<String>,
    pub cancel_requested_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum EvidenceKind {
    Diff,
    Command,
    Verdict,
    Note,
}

impl EvidenceKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            EvidenceKind::Diff => "diff",
            EvidenceKind::Command => "command",
            EvidenceKind::Verdict => "verdict",
            EvidenceKind::Note => "note",
        }
    }

    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "diff" => Some(EvidenceKind::Diff),
            "command" => Some(EvidenceKind::Command),
            "verdict" => Some(EvidenceKind::Verdict),
            "note" => Some(EvidenceKind::Note),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EventRecord {
    pub seq: i64,
    pub kind: EventKind,
    pub node_key: Option<String>,
    pub attempt: Option<u8>,
    pub payload: serde_json::Value,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EventDraft {
    pub kind: EventKind,
    pub node_key: Option<String>,
    pub attempt: Option<u8>,
    pub payload: serde_json::Value,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EvidenceRecord {
    pub id: String,
    pub orchestration_id: String,
    pub node_key: String,
    pub attempt: u8,
    pub kind: EvidenceKind,
    pub payload: serde_json::Value,
    pub at: String,
}

/// 编排私有库端口（真源读写；排序 / 视图派生归 service 与前端）
pub(crate) trait OrchStore {
    fn ensure_schema(&self) -> Result<(), String>;
    fn list(&self, project_id: Option<&str>) -> Result<Vec<OrchestrationRecord>, String>;
    fn get(&self, id: &str) -> Result<Option<OrchestrationRecord>, String>;
    fn put(&self, record: &OrchestrationRecord) -> Result<(), String>;
    fn nodes(&self, orchestration_id: &str) -> Result<Vec<NodeRecord>, String>;
    fn get_node(
        &self,
        orchestration_id: &str,
        node_key: &str,
    ) -> Result<Option<NodeRecord>, String>;
    fn put_node(&self, node: &NodeRecord) -> Result<(), String>;
    /// 整组替换节点（计划改写时使用；调用方保证只发生在无活跃节点的状态）
    fn replace_nodes(&self, orchestration_id: &str, nodes: &[NodeRecord]) -> Result<(), String>;
    fn append_event(&self, orchestration_id: &str, event: EventDraft) -> Result<i64, String>;
    /// 派发占位：同一 `(node, attempt)` 只成功一次；`None` = 已被占用（幂等重放）
    fn claim_dispatch(
        &self,
        orchestration_id: &str,
        node_key: &str,
        attempt: u8,
        payload: serde_json::Value,
        at: &str,
    ) -> Result<Option<i64>, String>;
    fn events(
        &self,
        orchestration_id: &str,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<EventRecord>, String>;
    fn append_evidence(&self, evidence: &EvidenceRecord) -> Result<(), String>;
    fn evidence(&self, orchestration_id: &str) -> Result<Vec<EvidenceRecord>, String>;
    fn last_event_seq(&self, orchestration_id: &str) -> Result<i64, String>;
}

// ==================== native：内存实现（测试 / 纯逻辑闭环） ====================

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub(crate) struct MemoryStore {
    state: std::sync::Mutex<MemoryState>,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct MemoryState {
    orchestrations: std::collections::BTreeMap<String, OrchestrationRecord>,
    nodes: std::collections::BTreeMap<String, Vec<NodeRecord>>,
    events: std::collections::BTreeMap<String, Vec<EventRecord>>,
    evidence: Vec<EvidenceRecord>,
}

#[cfg(not(target_arch = "wasm32"))]
impl MemoryStore {
    fn with_state<T>(
        &self,
        f: impl FnOnce(&mut MemoryState) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|e| format!("memory store lock poisoned: {e}"))?;
        f(&mut state)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl OrchStore for MemoryStore {
    fn ensure_schema(&self) -> Result<(), String> {
        Ok(())
    }

    fn list(&self, project_id: Option<&str>) -> Result<Vec<OrchestrationRecord>, String> {
        self.with_state(|state| {
            Ok(state
                .orchestrations
                .values()
                .filter(|record| project_id.is_none_or(|id| record.project_id == id))
                .cloned()
                .collect())
        })
    }

    fn get(&self, id: &str) -> Result<Option<OrchestrationRecord>, String> {
        self.with_state(|state| Ok(state.orchestrations.get(id).cloned()))
    }

    fn put(&self, record: &OrchestrationRecord) -> Result<(), String> {
        self.with_state(|state| {
            state
                .orchestrations
                .insert(record.id.clone(), record.clone());
            Ok(())
        })
    }

    fn nodes(&self, orchestration_id: &str) -> Result<Vec<NodeRecord>, String> {
        self.with_state(|state| {
            Ok(state
                .nodes
                .get(orchestration_id)
                .cloned()
                .unwrap_or_default())
        })
    }

    fn get_node(
        &self,
        orchestration_id: &str,
        node_key: &str,
    ) -> Result<Option<NodeRecord>, String> {
        self.with_state(|state| {
            Ok(state
                .nodes
                .get(orchestration_id)
                .and_then(|nodes| nodes.iter().find(|node| node.key == node_key).cloned()))
        })
    }

    fn put_node(&self, node: &NodeRecord) -> Result<(), String> {
        self.with_state(|state| {
            let nodes = state
                .nodes
                .entry(node.orchestration_id.clone())
                .or_default();
            match nodes.iter_mut().find(|existing| existing.key == node.key) {
                Some(existing) => *existing = node.clone(),
                None => nodes.push(node.clone()),
            }
            Ok(())
        })
    }

    fn replace_nodes(&self, orchestration_id: &str, nodes: &[NodeRecord]) -> Result<(), String> {
        self.with_state(|state| {
            state
                .nodes
                .insert(orchestration_id.to_string(), nodes.to_vec());
            Ok(())
        })
    }

    fn append_event(&self, orchestration_id: &str, event: EventDraft) -> Result<i64, String> {
        self.with_state(|state| {
            let list = state
                .events
                .entry(orchestration_id.to_string())
                .or_default();
            let seq = list.last().map(|event| event.seq).unwrap_or(0) + 1;
            list.push(EventRecord {
                seq,
                kind: event.kind,
                node_key: event.node_key,
                attempt: event.attempt,
                payload: event.payload,
                at: event.at,
            });
            Ok(seq)
        })
    }

    fn claim_dispatch(
        &self,
        orchestration_id: &str,
        node_key: &str,
        attempt: u8,
        payload: serde_json::Value,
        at: &str,
    ) -> Result<Option<i64>, String> {
        self.with_state(|state| {
            let list = state
                .events
                .entry(orchestration_id.to_string())
                .or_default();
            let occupied = list.iter().any(|event| {
                event.kind == EventKind::Dispatched
                    && event.node_key.as_deref() == Some(node_key)
                    && event.attempt == Some(attempt)
            });
            if occupied {
                return Ok(None);
            }
            let seq = list.last().map(|event| event.seq).unwrap_or(0) + 1;
            list.push(EventRecord {
                seq,
                kind: EventKind::Dispatched,
                node_key: Some(node_key.to_string()),
                attempt: Some(attempt),
                payload,
                at: at.to_string(),
            });
            Ok(Some(seq))
        })
    }

    fn events(
        &self,
        orchestration_id: &str,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<EventRecord>, String> {
        self.with_state(|state| {
            Ok(state
                .events
                .get(orchestration_id)
                .map(|events| {
                    events
                        .iter()
                        .filter(|event| event.seq > after_seq)
                        .take(limit)
                        .cloned()
                        .collect()
                })
                .unwrap_or_default())
        })
    }

    fn append_evidence(&self, evidence: &EvidenceRecord) -> Result<(), String> {
        self.with_state(|state| {
            state.evidence.push(evidence.clone());
            Ok(())
        })
    }

    fn evidence(&self, orchestration_id: &str) -> Result<Vec<EvidenceRecord>, String> {
        self.with_state(|state| {
            Ok(state
                .evidence
                .iter()
                .filter(|evidence| evidence.orchestration_id == orchestration_id)
                .cloned()
                .collect())
        })
    }

    fn last_event_seq(&self, orchestration_id: &str) -> Result<i64, String> {
        self.with_state(|state| {
            Ok(state
                .events
                .get(orchestration_id)
                .and_then(|events| events.last())
                .map(|event| event.seq)
                .unwrap_or(0))
        })
    }
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use serde::de::DeserializeOwned;
    use wasmnest_plugin_api::host::{HostLog, HostPluginDatabase};
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    /// 老库补列清单：初始建表之后新增的列（`CREATE TABLE IF NOT EXISTS`
    /// 对既有表不生效，缺列会让 upsert 在 prepare 期直接失败）
    const ORCHESTRATION_COLUMN_MIGRATIONS: &[(&str, &str)] = &[
        (
            "plan_json",
            "ALTER TABLE orchestrations ADD COLUMN plan_json TEXT",
        ),
        (
            "plan_error_json",
            "ALTER TABLE orchestrations ADD COLUMN plan_error_json TEXT",
        ),
        (
            "planner_output",
            "ALTER TABLE orchestrations ADD COLUMN planner_output TEXT",
        ),
        (
            "planner_run_id",
            "ALTER TABLE orchestrations ADD COLUMN planner_run_id TEXT",
        ),
        (
            "planner_agent_id",
            "ALTER TABLE orchestrations ADD COLUMN planner_agent_id TEXT",
        ),
        (
            "require_approval",
            "ALTER TABLE orchestrations ADD COLUMN require_approval \
             INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "orchestrator_agent_id",
            "ALTER TABLE orchestrations ADD COLUMN orchestrator_agent_id TEXT",
        ),
        (
            "planner_agent_json",
            "ALTER TABLE orchestrations ADD COLUMN planner_agent_json TEXT",
        ),
        (
            "planner_control_command_id",
            "ALTER TABLE orchestrations ADD COLUMN planner_control_command_id INTEGER",
        ),
        (
            "planner_command_id",
            "ALTER TABLE orchestrations ADD COLUMN planner_command_id INTEGER",
        ),
        (
            "planner_dispatched_at",
            "ALTER TABLE orchestrations ADD COLUMN planner_dispatched_at TEXT",
        ),
        (
            "planner_task_row_created",
            "ALTER TABLE orchestrations ADD COLUMN planner_task_row_created \
             INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "approved_at",
            "ALTER TABLE orchestrations ADD COLUMN approved_at TEXT",
        ),
        (
            "approved_plan_rev",
            "ALTER TABLE orchestrations ADD COLUMN approved_plan_rev INTEGER",
        ),
        (
            "failure_reason",
            "ALTER TABLE orchestrations ADD COLUMN failure_reason TEXT",
        ),
        (
            "started_at",
            "ALTER TABLE orchestrations ADD COLUMN started_at TEXT",
        ),
        (
            "ended_at",
            "ALTER TABLE orchestrations ADD COLUMN ended_at TEXT",
        ),
    ];

    const NODE_COLUMN_MIGRATIONS: &[(&str, &str)] = &[
        (
            "run_id",
            "ALTER TABLE orchestration_nodes ADD COLUMN run_id TEXT",
        ),
        (
            "command_id",
            "ALTER TABLE orchestration_nodes ADD COLUMN command_id INTEGER",
        ),
        (
            "agent_ref",
            "ALTER TABLE orchestration_nodes ADD COLUMN agent_ref TEXT NOT NULL DEFAULT ''",
        ),
        (
            "agent_snapshot_json",
            "ALTER TABLE orchestration_nodes ADD COLUMN agent_snapshot_json TEXT",
        ),
        (
            "match_reason",
            "ALTER TABLE orchestration_nodes ADD COLUMN match_reason TEXT NOT NULL DEFAULT ''",
        ),
        (
            "control_command_id",
            "ALTER TABLE orchestration_nodes ADD COLUMN control_command_id INTEGER",
        ),
        (
            "lease_json",
            "ALTER TABLE orchestration_nodes ADD COLUMN lease_json TEXT",
        ),
        (
            "pre_snapshot_json",
            "ALTER TABLE orchestration_nodes ADD COLUMN pre_snapshot_json TEXT",
        ),
        (
            "task_row_created",
            "ALTER TABLE orchestration_nodes ADD COLUMN task_row_created \
             INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "retryable",
            "ALTER TABLE orchestration_nodes ADD COLUMN retryable \
             INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "failure_reason",
            "ALTER TABLE orchestration_nodes ADD COLUMN failure_reason TEXT",
        ),
        (
            "dispatched_at",
            "ALTER TABLE orchestration_nodes ADD COLUMN dispatched_at TEXT",
        ),
        (
            "verifying_started_at",
            "ALTER TABLE orchestration_nodes ADD COLUMN verifying_started_at TEXT",
        ),
        (
            "cancel_requested_at",
            "ALTER TABLE orchestration_nodes ADD COLUMN cancel_requested_at TEXT",
        ),
        (
            "started_at",
            "ALTER TABLE orchestration_nodes ADD COLUMN started_at TEXT",
        ),
        (
            "ended_at",
            "ALTER TABLE orchestration_nodes ADD COLUMN ended_at TEXT",
        ),
    ];

    /// 表列名（`PRAGMA table_info`；老库补列前的现状快照）
    fn table_columns(host: &WasmHost, table: &str) -> Result<Vec<String>, String> {
        let rows = host
            .plugin_db_query(&format!("PRAGMA table_info({table})"))
            .map_err(|e| format!("{table} pragma failed: {}", e.message))?
            .unwrap_or_else(|| serde_json::json!([]));
        Ok(rows
            .as_array()
            .map(|array| {
                array
                    .iter()
                    .filter_map(|row| {
                        row.get("name")
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// 老库补列（只补 nullable / 带默认值列；主键与非空无默认列属于建表初始集）
    fn ensure_columns(
        host: &WasmHost,
        table: &str,
        migrations: &[(&str, &str)],
    ) -> Result<(), String> {
        let existing = table_columns(host, table)?;
        for (column, ddl) in migrations {
            if existing.iter().any(|name| name == column) {
                continue;
            }
            host.plugin_db_execute(ddl)
                .map_err(|e| format!("{table} {column} add failed: {}", e.message))?;
            host.log_warn(&format!(
                "{table}: added {column} column (legacy schema repaired at activate)"
            ));
        }
        Ok(())
    }

    fn required_str(row: &serde_json::Value, key: &str) -> Result<String, String> {
        row.get(key)
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("orchestration row missing column '{key}': {row}"))
    }

    fn optional_str(row: &serde_json::Value, key: &str) -> Option<String> {
        row.get(key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn required_i64(row: &serde_json::Value, key: &str) -> Result<i64, String> {
        row.get(key)
            .and_then(|value| value.as_i64())
            .ok_or_else(|| format!("orchestration row missing integer column '{key}': {row}"))
    }

    fn optional_i64(row: &serde_json::Value, key: &str) -> Option<i64> {
        row.get(key).and_then(|value| value.as_i64())
    }

    fn required_u8(row: &serde_json::Value, key: &str) -> Result<u8, String> {
        let value = required_i64(row, key)?;
        u8::try_from(value)
            .map_err(|_| format!("orchestration column '{key}' is out of u8 range: {value}"))
    }

    fn optional_u8(row: &serde_json::Value, key: &str) -> Result<Option<u8>, String> {
        optional_i64(row, key)
            .map(|value| {
                u8::try_from(value).map_err(|_| {
                    format!("orchestration column '{key}' is out of u8 range: {value}")
                })
            })
            .transpose()
    }

    fn required_bool(row: &serde_json::Value, key: &str) -> Result<bool, String> {
        match required_i64(row, key)? {
            0 => Ok(false),
            1 => Ok(true),
            other => Err(format!(
                "orchestration column '{key}' is not a boolean (0/1): {other}"
            )),
        }
    }

    fn json_column<T: DeserializeOwned>(
        row: &serde_json::Value,
        key: &str,
    ) -> Result<Option<T>, String> {
        match optional_str(row, key) {
            Some(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|e| format!("orchestration column '{key}' is not valid JSON: {e}")),
            None => Ok(None),
        }
    }

    fn required_json<T: DeserializeOwned>(row: &serde_json::Value, key: &str) -> Result<T, String> {
        json_column::<T>(row, key)?
            .ok_or_else(|| format!("orchestration row missing JSON column '{key}': {row}"))
    }

    fn enum_column<T>(
        row: &serde_json::Value,
        key: &str,
        parse: impl Fn(&str) -> Option<T>,
    ) -> Result<T, String> {
        let raw = required_str(row, key)?;
        parse(&raw).ok_or_else(|| format!("orchestration column '{key}' has unknown value '{raw}'"))
    }

    fn optional_enum<T>(
        row: &serde_json::Value,
        key: &str,
        parse: impl Fn(&str) -> Option<T>,
    ) -> Result<Option<T>, String> {
        match optional_str(row, key) {
            Some(raw) => parse(&raw)
                .map(Some)
                .ok_or_else(|| format!("orchestration column '{key}' has unknown value '{raw}'")),
            None => Ok(None),
        }
    }

    fn parse_rows(value: Option<serde_json::Value>) -> Result<Vec<serde_json::Value>, String> {
        let value = value.unwrap_or_else(|| serde_json::json!([]));
        value
            .as_array()
            .cloned()
            .ok_or_else(|| format!("plugin db query did not return an array: {value}"))
    }

    fn row_to_orchestration(row: &serde_json::Value) -> Result<OrchestrationRecord, String> {
        Ok(OrchestrationRecord {
            id: required_str(row, "id")?,
            project_id: required_str(row, "project_id")?,
            title: required_str(row, "title")?,
            goal: required_str(row, "goal")?,
            mode: enum_column(row, "mode", PlanMode::from_wire)?,
            require_approval: required_bool(row, "require_approval")?,
            orchestrator_agent_id: optional_str(row, "orchestrator_agent_id"),
            status: enum_column(row, "status", OrchestrationStatus::from_wire)?,
            plan: json_column(row, "plan_json")?,
            plan_rev: required_i64(row, "plan_rev")?,
            plan_error: json_column(row, "plan_error_json")?,
            planner_output: optional_str(row, "planner_output"),
            max_parallel: required_u8(row, "max_parallel")?,
            budget: required_json(row, "budget_json")?,
            planner_run_id: optional_str(row, "planner_run_id"),
            planner_agent_id: optional_str(row, "planner_agent_id"),
            planner_agent: json_column(row, "planner_agent_json")?,
            planner_command_id: optional_i64(row, "planner_command_id"),
            planner_control_command_id: optional_i64(row, "planner_control_command_id"),
            planner_dispatched_at: optional_str(row, "planner_dispatched_at"),
            planner_task_row_created: required_bool(row, "planner_task_row_created")?,
            approved_at: optional_str(row, "approved_at"),
            approved_plan_rev: optional_i64(row, "approved_plan_rev"),
            failure_reason: optional_enum(row, "failure_reason", ReasonCode::from_wire)?,
            created_at: required_str(row, "created_at")?,
            updated_at: required_str(row, "updated_at")?,
            started_at: optional_str(row, "started_at"),
            ended_at: optional_str(row, "ended_at"),
        })
    }

    fn row_to_node(row: &serde_json::Value) -> Result<NodeRecord, String> {
        Ok(NodeRecord {
            id: required_str(row, "id")?,
            orchestration_id: required_str(row, "orchestration_id")?,
            key: required_str(row, "node_key")?,
            title: required_str(row, "title")?,
            role: enum_column(row, "role", Role::from_wire)?,
            agent_id: required_str(row, "agent_id")?,
            agent_ref: optional_str(row, "agent_ref").unwrap_or_default(),
            agent_snapshot: json_column(row, "agent_snapshot_json")?,
            match_reason: optional_str(row, "match_reason").unwrap_or_default(),
            prompt: required_str(row, "prompt")?,
            depends_on: required_json(row, "deps_json")?,
            write_scope: required_json(row, "write_scope_json")?,
            acceptance: required_json(row, "acceptance_json")?,
            status: enum_column(row, "status", NodeStatus::from_wire)?,
            attempt: required_u8(row, "attempt")?,
            max_attempts: required_u8(row, "max_attempts")?,
            run_id: optional_str(row, "run_id"),
            command_id: optional_i64(row, "command_id"),
            control_command_id: optional_i64(row, "control_command_id"),
            lease: json_column(row, "lease_json")?,
            pre_snapshot: json_column(row, "pre_snapshot_json")?,
            task_row_created: required_bool(row, "task_row_created")?,
            retryable: required_bool(row, "retryable")?,
            failure_reason: optional_enum(row, "failure_reason", ReasonCode::from_wire)?,
            dispatched_at: optional_str(row, "dispatched_at"),
            verifying_started_at: optional_str(row, "verifying_started_at"),
            cancel_requested_at: optional_str(row, "cancel_requested_at"),
            started_at: optional_str(row, "started_at"),
            ended_at: optional_str(row, "ended_at"),
        })
    }

    fn row_to_event(row: &serde_json::Value) -> Result<EventRecord, String> {
        Ok(EventRecord {
            seq: required_i64(row, "seq")?,
            kind: enum_column(row, "kind", EventKind::from_wire)?,
            node_key: optional_str(row, "node_key"),
            attempt: optional_u8(row, "attempt")?,
            payload: required_json(row, "payload_json")?,
            at: required_str(row, "at")?,
        })
    }

    fn row_to_evidence(row: &serde_json::Value) -> Result<EvidenceRecord, String> {
        Ok(EvidenceRecord {
            id: required_str(row, "id")?,
            orchestration_id: required_str(row, "orchestration_id")?,
            node_key: required_str(row, "node_key")?,
            attempt: required_u8(row, "attempt")?,
            kind: enum_column(row, "kind", EvidenceKind::from_wire)?,
            payload: required_json(row, "payload_json")?,
            at: required_str(row, "at")?,
        })
    }

    fn json_text<T: serde::Serialize>(value: &T) -> Result<String, String> {
        serde_json::to_string(value)
            .map_err(|e| format!("serialize orchestration JSON failed: {e}"))
    }

    fn insert_node(host: &WasmHost, node: &NodeRecord) -> Result<(), String> {
        host.plugin_db_execute_params(
            "INSERT INTO orchestration_nodes \
             (id, orchestration_id, node_key, title, role, agent_id, agent_ref, \
              agent_snapshot_json, match_reason, prompt, deps_json, write_scope_json, \
              acceptance_json, status, attempt, max_attempts, run_id, command_id, \
              control_command_id, lease_json, pre_snapshot_json, task_row_created, retryable, \
              failure_reason, dispatched_at, verifying_started_at, cancel_requested_at, \
              started_at, ended_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
                     ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29) \
             ON CONFLICT(id) DO UPDATE SET \
              title = excluded.title, role = excluded.role, agent_id = excluded.agent_id, \
              agent_ref = excluded.agent_ref, \
              agent_snapshot_json = excluded.agent_snapshot_json, \
              match_reason = excluded.match_reason, \
              prompt = excluded.prompt, deps_json = excluded.deps_json, \
              write_scope_json = excluded.write_scope_json, \
              acceptance_json = excluded.acceptance_json, status = excluded.status, \
              attempt = excluded.attempt, max_attempts = excluded.max_attempts, \
              run_id = excluded.run_id, command_id = excluded.command_id, \
              control_command_id = excluded.control_command_id, \
              lease_json = excluded.lease_json, \
              pre_snapshot_json = excluded.pre_snapshot_json, \
              task_row_created = excluded.task_row_created, \
              retryable = excluded.retryable, \
              failure_reason = excluded.failure_reason, dispatched_at = excluded.dispatched_at, \
              verifying_started_at = excluded.verifying_started_at, \
              cancel_requested_at = excluded.cancel_requested_at, \
              started_at = excluded.started_at, ended_at = excluded.ended_at",
            &sql_params![
                node.id,
                node.orchestration_id,
                node.key,
                node.title,
                node.role.as_str(),
                node.agent_id,
                node.agent_ref,
                node.agent_snapshot.as_ref().map(json_text).transpose()?,
                node.match_reason,
                node.prompt,
                json_text(&node.depends_on)?,
                json_text(&node.write_scope)?,
                json_text(&node.acceptance)?,
                node.status.as_str(),
                node.attempt as i64,
                node.max_attempts as i64,
                node.run_id,
                node.command_id,
                node.control_command_id,
                node.lease.as_ref().map(json_text).transpose()?,
                node.pre_snapshot.as_ref().map(json_text).transpose()?,
                node.task_row_created as i64,
                node.retryable as i64,
                node.failure_reason.map(|reason| reason.as_str()),
                node.dispatched_at,
                node.verifying_started_at,
                node.cancel_requested_at,
                node.started_at,
                node.ended_at,
            ],
        )
        .map_err(|e| format!("insert orchestration node failed: {}", e.message))?;
        Ok(())
    }

    impl OrchStore for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            for statement in SCHEMA {
                self.plugin_db_execute(statement)
                    .map_err(|e| format!("orchestration schema init failed: {}", e.message))?;
            }
            ensure_columns(self, "orchestrations", ORCHESTRATION_COLUMN_MIGRATIONS)?;
            ensure_columns(self, "orchestration_nodes", NODE_COLUMN_MIGRATIONS)?;
            Ok(())
        }

        fn list(&self, project_id: Option<&str>) -> Result<Vec<OrchestrationRecord>, String> {
            let rows = match project_id {
                Some(project_id) => self.plugin_db_query_params(
                    "SELECT * FROM orchestrations WHERE project_id = ?1",
                    &sql_params![project_id],
                ),
                None => self.plugin_db_query("SELECT * FROM orchestrations"),
            }
            .map_err(|e| format!("query orchestrations failed: {}", e.message))?;
            parse_rows(rows)?.iter().map(row_to_orchestration).collect()
        }

        fn get(&self, id: &str) -> Result<Option<OrchestrationRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM orchestrations WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("query orchestration failed: {}", e.message))?;
            parse_rows(rows)?
                .first()
                .map(row_to_orchestration)
                .transpose()
        }

        fn put(&self, record: &OrchestrationRecord) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT INTO orchestrations \
                 (id, project_id, title, goal, mode, require_approval, \
                  orchestrator_agent_id, status, plan_json, plan_rev, plan_error_json, \
                  planner_output, max_parallel, budget_json, planner_run_id, planner_agent_id, \
                  planner_agent_json, planner_command_id, planner_control_command_id, \
                  planner_dispatched_at, planner_task_row_created, approved_at, \
                  approved_plan_rev, failure_reason, created_at, updated_at, started_at, \
                  ended_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
                         ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28) \
                 ON CONFLICT(id) DO UPDATE SET \
                  project_id = excluded.project_id, title = excluded.title, \
                  goal = excluded.goal, mode = excluded.mode, \
                  require_approval = excluded.require_approval, \
                  orchestrator_agent_id = excluded.orchestrator_agent_id, \
                  status = excluded.status, \
                  plan_json = excluded.plan_json, plan_rev = excluded.plan_rev, \
                  plan_error_json = excluded.plan_error_json, \
                  planner_output = excluded.planner_output, \
                  max_parallel = excluded.max_parallel, budget_json = excluded.budget_json, \
                  planner_run_id = excluded.planner_run_id, \
                  planner_agent_id = excluded.planner_agent_id, \
                  planner_agent_json = excluded.planner_agent_json, \
                  planner_command_id = excluded.planner_command_id, \
                  planner_control_command_id = excluded.planner_control_command_id, \
                  planner_dispatched_at = excluded.planner_dispatched_at, \
                  planner_task_row_created = excluded.planner_task_row_created, \
                  approved_at = excluded.approved_at, \
                  approved_plan_rev = excluded.approved_plan_rev, \
                  failure_reason = excluded.failure_reason, updated_at = excluded.updated_at, \
                  started_at = excluded.started_at, ended_at = excluded.ended_at",
                &sql_params![
                    record.id,
                    record.project_id,
                    record.title,
                    record.goal,
                    record.mode.as_str(),
                    record.require_approval as i64,
                    record.orchestrator_agent_id,
                    record.status.as_str(),
                    record.plan.as_ref().map(json_text).transpose()?,
                    record.plan_rev,
                    record.plan_error.as_ref().map(json_text).transpose()?,
                    record.planner_output,
                    record.max_parallel as i64,
                    json_text(&record.budget)?,
                    record.planner_run_id,
                    record.planner_agent_id,
                    record.planner_agent.as_ref().map(json_text).transpose()?,
                    record.planner_command_id,
                    record.planner_control_command_id,
                    record.planner_dispatched_at,
                    record.planner_task_row_created as i64,
                    record.approved_at,
                    record.approved_plan_rev,
                    record.failure_reason.map(|reason| reason.as_str()),
                    record.created_at,
                    record.updated_at,
                    record.started_at,
                    record.ended_at,
                ],
            )
            .map_err(|e| format!("upsert orchestration failed: {}", e.message))?;
            Ok(())
        }

        fn nodes(&self, orchestration_id: &str) -> Result<Vec<NodeRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM orchestration_nodes WHERE orchestration_id = ?1 \
                     ORDER BY rowid ASC",
                    &sql_params![orchestration_id],
                )
                .map_err(|e| format!("query orchestration nodes failed: {}", e.message))?;
            parse_rows(rows)?.iter().map(row_to_node).collect()
        }

        fn get_node(
            &self,
            orchestration_id: &str,
            node_key: &str,
        ) -> Result<Option<NodeRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM orchestration_nodes \
                     WHERE orchestration_id = ?1 AND node_key = ?2",
                    &sql_params![orchestration_id, node_key],
                )
                .map_err(|e| format!("query orchestration node failed: {}", e.message))?;
            parse_rows(rows)?.first().map(row_to_node).transpose()
        }

        fn put_node(&self, node: &NodeRecord) -> Result<(), String> {
            insert_node(self, node)
        }

        fn replace_nodes(
            &self,
            orchestration_id: &str,
            nodes: &[NodeRecord],
        ) -> Result<(), String> {
            self.plugin_db_execute_params(
                "DELETE FROM orchestration_nodes WHERE orchestration_id = ?1",
                &sql_params![orchestration_id],
            )
            .map_err(|e| format!("delete orchestration nodes failed: {}", e.message))?;
            for node in nodes {
                insert_node(self, node)?;
            }
            Ok(())
        }

        fn append_event(&self, orchestration_id: &str, event: EventDraft) -> Result<i64, String> {
            let seq = next_event_seq(self, orchestration_id)?;
            self.plugin_db_execute_params(
                "INSERT INTO orchestration_events \
                 (orchestration_id, seq, kind, node_key, attempt, payload_json, at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                &sql_params![
                    orchestration_id,
                    seq,
                    event.kind.as_str(),
                    event.node_key,
                    event.attempt.map(|attempt| attempt as i64),
                    json_text(&event.payload)?,
                    event.at,
                ],
            )
            .map_err(|e| format!("append orchestration event failed: {}", e.message))?;
            Ok(seq)
        }

        fn claim_dispatch(
            &self,
            orchestration_id: &str,
            node_key: &str,
            attempt: u8,
            payload: serde_json::Value,
            at: &str,
        ) -> Result<Option<i64>, String> {
            let seq = next_event_seq(self, orchestration_id)?;
            let result = self.plugin_db_execute_params(
                "INSERT INTO orchestration_events \
                 (orchestration_id, seq, kind, node_key, attempt, payload_json, at) \
                 SELECT ?1, ?2, 'dispatched', ?3, ?4, ?5, ?6 \
                 WHERE NOT EXISTS ( \
                   SELECT 1 FROM orchestration_events \
                   WHERE orchestration_id = ?1 AND kind = 'dispatched' \
                     AND node_key = ?3 AND attempt = ?4)",
                &sql_params![
                    orchestration_id,
                    seq,
                    node_key,
                    attempt as i64,
                    json_text(&payload)?,
                    at,
                ],
            );
            match result {
                Ok(affected) if affected > 0 => Ok(Some(seq)),
                Ok(_) => Ok(None),
                Err(error) => {
                    // 唯一索引兜底：并发/重放撞上约束时按“已占用”处理
                    let occupied = self
                        .plugin_db_query_params(
                            "SELECT seq FROM orchestration_events \
                             WHERE orchestration_id = ?1 AND kind = 'dispatched' \
                               AND node_key = ?2 AND attempt = ?3",
                            &sql_params![orchestration_id, node_key, attempt as i64],
                        )
                        .ok()
                        .flatten()
                        .and_then(|value| value.as_array().map(|rows| !rows.is_empty()))
                        .unwrap_or(false);
                    if occupied {
                        Ok(None)
                    } else {
                        Err(format!(
                            "claim orchestration dispatch failed: {}",
                            error.message
                        ))
                    }
                }
            }
        }

        fn events(
            &self,
            orchestration_id: &str,
            after_seq: i64,
            limit: usize,
        ) -> Result<Vec<EventRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM orchestration_events \
                     WHERE orchestration_id = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3",
                    &sql_params![orchestration_id, after_seq, limit as i64],
                )
                .map_err(|e| format!("query orchestration events failed: {}", e.message))?;
            parse_rows(rows)?.iter().map(row_to_event).collect()
        }

        fn append_evidence(&self, evidence: &EvidenceRecord) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT INTO orchestration_evidence \
                 (id, orchestration_id, node_key, attempt, kind, payload_json, at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                &sql_params![
                    evidence.id,
                    evidence.orchestration_id,
                    evidence.node_key,
                    evidence.attempt as i64,
                    evidence.kind.as_str(),
                    json_text(&evidence.payload)?,
                    evidence.at,
                ],
            )
            .map_err(|e| format!("append orchestration evidence failed: {}", e.message))?;
            Ok(())
        }

        fn evidence(&self, orchestration_id: &str) -> Result<Vec<EvidenceRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM orchestration_evidence WHERE orchestration_id = ?1 \
                     ORDER BY rowid ASC",
                    &sql_params![orchestration_id],
                )
                .map_err(|e| format!("query orchestration evidence failed: {}", e.message))?;
            parse_rows(rows)?.iter().map(row_to_evidence).collect()
        }

        fn last_event_seq(&self, orchestration_id: &str) -> Result<i64, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT COALESCE(MAX(seq), 0) AS seq FROM orchestration_events \
                     WHERE orchestration_id = ?1",
                    &sql_params![orchestration_id],
                )
                .map_err(|e| format!("query orchestration event seq failed: {}", e.message))?;
            parse_rows(rows)?
                .first()
                .and_then(|row| row.get("seq").and_then(|value| value.as_i64()))
                .ok_or_else(|| "orchestration event seq query returned no row".to_string())
        }
    }

    fn next_event_seq(host: &WasmHost, orchestration_id: &str) -> Result<i64, String> {
        let rows = host
            .plugin_db_query_params(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM orchestration_events \
                 WHERE orchestration_id = ?1",
                &sql_params![orchestration_id],
            )
            .map_err(|e| format!("query orchestration event seq failed: {}", e.message))?;
        parse_rows(rows)?
            .first()
            .and_then(|row| row.get("seq").and_then(|value| value.as_i64()))
            .ok_or_else(|| "orchestration event seq query returned no row".to_string())
    }
}

#[cfg(test)]
mod tests;
