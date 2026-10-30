//! 会话登记存储端口（会话引擎整体下沉 P1）：真源 = 插件私有库
//! （`host-plugin-database`，`storage` 权限）
//!
//! 端口按**行语义**（而非 SQL）暴露：状态机与时间戳策略留在 [`super::ops`]、
//! 缓存与降级留在 [`super::registry`]，可被 native 单测完整覆盖；SQL 与列映射
//! 只存在于 wasm 实现里（与 `config/store.rs` / `auth_records/store.rs` 同模式
//! ——native 链接不引用 wasm 专属 import 符号）。
//!
//! 表结构（插件私有库，无主库 `plugin_<id>_` 前缀约束）：
//! - `runs`：运行一行（`status` / `canonical_renderer` 写 JSON 文本，`Error`
//!   载荷与 wire 形状无损）。表名由容器迁移从 `sessions` 账本式重命名而来
//!   （ADR 0003），并补上项目 / agent 归属列；
//! - `session_annotations`：注解槽 `(session_id, key) → value`（宿主
//!   `annotate` 原语的镜像；运行移除时连带清理）；
//! - `run_events` / `permission_audit`：运行事件账本与权限审计（ADR 0004 的
//!   归一事件落地面）。**本轮只落表**：写入方是桥接与镜像（phase 3），读取方是
//!   对话面；先建表是为了让「改造 runs」只发生一次列变更。
//!
//! **进程域事实对账**（见 [`SessionStore`] 的注释与 [`super::ensure_schema_via_host`]）：
//! PTY 句柄是进程内存，宿主重启后旧句柄必然失效；`runs` 行作为历史保留，激活时
//! 由 [`super::registry::Registry::converge_orphans`] 把非终态运行收敛到 `Error`
//! 并清空 `pty_id`（既不留幽灵「运行中」，也不丢历史）。

use super::model::{SessionRecord, SessionStatus};

/// 运行事件账本单条上限（超出按 seq 淘汰并标「已截断」；用户故事 35）
///
/// 20000 条按「一次工具调用 ≈ 2 条事件」折算约一万次调用，足够覆盖一次长运行；
/// 再大就要考虑分表/冷存，那是另一张票的事。
pub const RUN_EVENT_CAP: usize = 20_000;

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS runs (\
     id TEXT PRIMARY KEY, \
     pty_id TEXT, \
     config_id TEXT NOT NULL, \
     project_id TEXT, \
     agent_id TEXT, \
     agent_session_id TEXT, \
     title TEXT, \
     model TEXT, \
     name TEXT NOT NULL, \
     status TEXT NOT NULL, \
     created_at TEXT NOT NULL, \
     started_at TEXT, \
     stopped_at TEXT, \
     canonical_renderer TEXT, \
     owner TEXT, \
     truncated INTEGER NOT NULL DEFAULT 0, \
     updated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_runs_config_id ON runs(config_id)",
    "CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id)",
    // 反查面：agent 会话 id → 运行（原 `task_session_mapping.claude_sid` 的语义并入本列）
    "CREATE INDEX IF NOT EXISTS idx_runs_agent_session ON runs(agent_session_id)",
    "CREATE TABLE IF NOT EXISTS session_annotations (\
     session_id TEXT NOT NULL, \
     key TEXT NOT NULL, \
     value TEXT NOT NULL, \
     PRIMARY KEY (session_id, key))",
    // 归一事件账本（ADR 0004）：每条运行最近 [`RUN_EVENT_CAP`] 条，(run_id, seq) 唯一
    "CREATE TABLE IF NOT EXISTS run_events (\
     id INTEGER PRIMARY KEY AUTOINCREMENT, \
     run_id TEXT NOT NULL, \
     seq INTEGER NOT NULL, \
     at TEXT NOT NULL, \
     kind TEXT NOT NULL, \
     payload TEXT NOT NULL, \
     source TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_seq ON run_events(run_id, seq)",
    // 权限审计：每次代传的批准/拒绝都留一行（谁在何时批了什么命令）。
    // `command` 存命令原文（不是结构化 input）：审计要能在事后逐字复核
    "CREATE TABLE IF NOT EXISTS permission_audit (\
     id INTEGER PRIMARY KEY AUTOINCREMENT, \
     run_id TEXT NOT NULL, \
     request_id TEXT NOT NULL, \
     tool TEXT NOT NULL, \
     command TEXT NOT NULL, \
     decision TEXT NOT NULL, \
     decided_at TEXT NOT NULL, \
     source TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_permission_audit_run ON permission_audit(run_id)",
];

/// 会话登记存储端口（真源读写；排序与解读归调用方）
pub trait SessionStore {
    /// 建表（幂等）
    fn ensure_schema(&self) -> Result<(), String>;
    /// 全表（按 `created_at, id` 稳定序——宿主 `HashMap` 迭代序不确定，本域给稳定序）
    fn all(&self) -> Result<Vec<SessionRecord>, String>;
    fn get(&self, id: &str) -> Result<Option<SessionRecord>, String>;
    /// 按 id 覆盖写（`INSERT OR REPLACE`）
    fn put(&self, record: &SessionRecord) -> Result<(), String>;
    /// 删除运行行，返回是否命中（未知 id 幂等 false）
    fn remove(&self, id: &str) -> Result<bool, String>;
    /// 删除某项目下的全部运行，返回删除行数（项目移除的级联面）
    fn remove_by_project(&self, project_id: &str) -> Result<usize, String>;
    /// 某运行的注解槽（按 key 稳定序）
    fn all_annotations(&self, session_id: &str) -> Result<Vec<(String, String)>, String>;
    /// 写单个注解键（覆盖同键）
    fn put_annotation(&self, session_id: &str, key: &str, value: &str) -> Result<(), String>;
    /// 清某运行的注解槽（运行移除时连带清理）
    fn clear_annotations(&self, session_id: &str) -> Result<(), String>;
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    /// 行（snake_case 列名，宿主 `query_to_json` 输出）→ 模型
    fn row_to_record(row: &serde_json::Value) -> Result<SessionRecord, String> {
        let required = |key: &str| -> Result<String, String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("session row missing column '{}': {}", key, row))
        };
        let status_text = required("status")?;
        let status: SessionStatus = serde_json::from_str(&status_text).map_err(|e| {
            format!(
                "session row has invalid status JSON ({}): {}",
                status_text, e
            )
        })?;
        // JSON 文本列：空串 / NULL 视为缺失（不静默降级为「无归属」以外的语义）
        let canonical_renderer = match row.get("canonical_renderer").and_then(|v| v.as_str()) {
            Some(raw) if !raw.trim().is_empty() => {
                Some(serde_json::from_str(raw).map_err(|e| {
                    format!(
                        "session row has invalid canonicalRenderer JSON ({}): {}",
                        raw, e
                    )
                })?)
            }
            _ => None,
        };
        let optional = |key: &str| -> Option<String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        };
        Ok(SessionRecord {
            id: required("id")?,
            pty_id: optional("pty_id"),
            config_id: required("config_id")?,
            project_id: optional("project_id"),
            agent_id: optional("agent_id"),
            agent_session_id: optional("agent_session_id"),
            title: optional("title"),
            model: optional("model"),
            name: required("name")?,
            status,
            created_at: required("created_at")?,
            started_at: row
                .get("started_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            stopped_at: row
                .get("stopped_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            canonical_renderer,
            owner: row
                .get("owner")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            truncated: row.get("truncated").and_then(|v| v.as_i64()).unwrap_or(0) != 0,
            updated_at: required("updated_at")?,
        })
    }

    /// JSON 数组（查询结果）→ 模型列表
    fn rows_to_records(rows: Option<serde_json::Value>) -> Result<Vec<SessionRecord>, String> {
        let rows = rows.unwrap_or_else(|| serde_json::json!([]));
        let array = rows
            .as_array()
            .ok_or_else(|| format!("plugin db query did not return an array: {}", rows))?
            .clone();
        array.iter().map(row_to_record).collect()
    }

    /// `status` / `canonical_renderer` → 写库文本
    fn status_text(status: &SessionStatus) -> Result<String, String> {
        serde_json::to_string(status).map_err(|e| format!("status serialize failed: {}", e))
    }

    fn canonical_text(
        canonical: &Option<crate::actions::RendererSource>,
    ) -> Result<Option<String>, String> {
        match canonical {
            None => Ok(None),
            Some(source) => serde_json::to_string(source)
                .map(Some)
                .map_err(|e| format!("canonicalRenderer serialize failed: {}", e)),
        }
    }

    impl SessionStore for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            for stmt in SCHEMA {
                self.plugin_db_execute(stmt)
                    .map_err(|e| format!("plugin db execute failed: {}", e.message))?;
            }
            Ok(())
        }

        fn all(&self) -> Result<Vec<SessionRecord>, String> {
            self.plugin_db_query("SELECT * FROM runs ORDER BY created_at, id")
                .map_err(|e| format!("plugin db query failed: {}", e.message))
                .and_then(rows_to_records)
        }

        fn get(&self, id: &str) -> Result<Option<SessionRecord>, String> {
            let rows = self
                .plugin_db_query_params("SELECT * FROM runs WHERE id = ?1", &sql_params![id])
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            Ok(rows_to_records(rows)?.into_iter().next())
        }

        fn put(&self, record: &SessionRecord) -> Result<(), String> {
            let status = status_text(&record.status)?;
            let canonical = canonical_text(&record.canonical_renderer)?;
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO runs \
                 (id, pty_id, config_id, project_id, agent_id, agent_session_id, title, model, \
                  name, status, created_at, started_at, stopped_at, canonical_renderer, owner, \
                  truncated, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                &sql_params![
                    record.id,
                    record.pty_id,
                    record.config_id,
                    record.project_id,
                    record.agent_id,
                    record.agent_session_id,
                    record.title,
                    record.model,
                    record.name,
                    status,
                    record.created_at,
                    record.started_at,
                    record.stopped_at,
                    canonical,
                    record.owner,
                    record.truncated as i64,
                    record.updated_at
                ],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn remove(&self, id: &str) -> Result<bool, String> {
            // 账本随行清理：事件 / 权限审计按运行 id 键控，留着就是无主行
            // （两张表由本域 `ensure_schema` 建出，命令面执行时必然存在）
            for table in ["run_events", "permission_audit"] {
                self.plugin_db_execute_params(
                    &format!("DELETE FROM {} WHERE run_id = ?1", table),
                    &sql_params![id],
                )
                .map_err(|e| format!("plugin db delete failed ({}): {}", table, e.message))?;
            }
            let affected = self
                .plugin_db_execute_params("DELETE FROM runs WHERE id = ?1", &sql_params![id])
                .map_err(|e| format!("plugin db delete failed: {}", e.message))?;
            Ok(affected > 0)
        }

        fn remove_by_project(&self, project_id: &str) -> Result<usize, String> {
            // 注解槽先清（按运行 id 逐条删；项目下的运行数量级是「几十条」，
            // 一条 DELETE ... IN (SELECT ...) 即可，但注解表的主键是 (session_id, key)，
            // 用子查询删除更省一次往返）
            self.plugin_db_execute_params(
                "DELETE FROM session_annotations WHERE session_id IN \
                 (SELECT id FROM runs WHERE project_id = ?1)",
                &sql_params![project_id],
            )
            .map_err(|e| format!("plugin db delete failed: {}", e.message))?;
            for table in ["run_events", "permission_audit"] {
                self.plugin_db_execute_params(
                    &format!(
                        "DELETE FROM {} WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?1)",
                        table
                    ),
                    &sql_params![project_id],
                )
                .map_err(|e| format!("plugin db delete failed ({}): {}", table, e.message))?;
            }
            let affected = self
                .plugin_db_execute_params(
                    "DELETE FROM runs WHERE project_id = ?1",
                    &sql_params![project_id],
                )
                .map_err(|e| format!("plugin db delete failed: {}", e.message))?;
            Ok(affected.max(0) as usize)
        }

        fn all_annotations(&self, session_id: &str) -> Result<Vec<(String, String)>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT key, value FROM session_annotations WHERE session_id = ?1 ORDER BY key",
                    &sql_params![session_id],
                )
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            let rows = rows.unwrap_or_else(|| serde_json::json!([]));
            let array = rows
                .as_array()
                .ok_or_else(|| format!("plugin db query did not return an array: {}", rows))?;
            let mut out = Vec::with_capacity(array.len());
            for row in array {
                let key = row
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("annotation row missing column 'key': {}", row))?;
                let value = row
                    .get("value")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("annotation row missing column 'value': {}", row))?;
                out.push((key.to_string(), value.to_string()));
            }
            Ok(out)
        }

        fn put_annotation(&self, session_id: &str, key: &str, value: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO session_annotations (session_id, key, value) VALUES (?1, ?2, ?3)",
                &sql_params![session_id, key, value],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn clear_annotations(&self, session_id: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "DELETE FROM session_annotations WHERE session_id = ?1",
                &sql_params![session_id],
            )
            .map_err(|e| format!("plugin db delete failed: {}", e.message))?;
            Ok(())
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::actions::RendererSource;
    use std::sync::Mutex;

    /// 内存实现（native 单测注入）：行语义与私有库对齐
    #[derive(Default)]
    pub struct MockSessionStore {
        rows: Mutex<Vec<SessionRecord>>,
        annotations: Mutex<Vec<(String, String, String)>>,
    }

    impl MockSessionStore {
        pub fn new(rows: Vec<SessionRecord>) -> Self {
            Self {
                rows: Mutex::new(rows),
                annotations: Mutex::new(Vec::new()),
            }
        }

        pub fn record(id: &str, status: SessionStatus) -> SessionRecord {
            SessionRecord {
                id: id.to_string(),
                pty_id: None,
                config_id: "c1".to_string(),
                project_id: Some("p1".to_string()),
                agent_id: Some("pi".to_string()),
                agent_session_id: None,
                title: None,
                model: None,
                name: format!("会话-{id}"),
                status,
                created_at: "2026-09-23T09:00:00Z".to_string(),
                started_at: None,
                stopped_at: None,
                canonical_renderer: Some(RendererSource::Desktop),
                owner: Some("com.wasmnest.bedcode".to_string()),
                truncated: false,
                updated_at: "2026-09-23T09:00:00Z".to_string(),
            }
        }
    }

    impl SessionStore for MockSessionStore {
        fn ensure_schema(&self) -> Result<(), String> {
            Ok(())
        }

        fn all(&self) -> Result<Vec<SessionRecord>, String> {
            Ok(self.rows.lock().unwrap().clone())
        }

        fn get(&self, id: &str) -> Result<Option<SessionRecord>, String> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .find(|r| r.id == id)
                .cloned())
        }

        fn put(&self, record: &SessionRecord) -> Result<(), String> {
            let mut rows = self.rows.lock().unwrap();
            match rows.iter_mut().find(|r| r.id == record.id) {
                Some(slot) => *slot = record.clone(),
                None => rows.push(record.clone()),
            }
            Ok(())
        }

        fn remove(&self, id: &str) -> Result<bool, String> {
            let mut rows = self.rows.lock().unwrap();
            let before = rows.len();
            rows.retain(|r| r.id != id);
            Ok(rows.len() != before)
        }

        fn remove_by_project(&self, project_id: &str) -> Result<usize, String> {
            let mut rows = self.rows.lock().unwrap();
            let doomed: Vec<String> = rows
                .iter()
                .filter(|r| r.project_id.as_deref() == Some(project_id))
                .map(|r| r.id.clone())
                .collect();
            rows.retain(|r| r.project_id.as_deref() != Some(project_id));
            drop(rows);
            self.annotations
                .lock()
                .unwrap()
                .retain(|(sid, _, _)| !doomed.contains(sid));
            Ok(doomed.len())
        }

        fn all_annotations(&self, session_id: &str) -> Result<Vec<(String, String)>, String> {
            let mut rows: Vec<(String, String)> = self
                .annotations
                .lock()
                .unwrap()
                .iter()
                .filter(|(sid, _, _)| sid == session_id)
                .map(|(_, k, v)| (k.clone(), v.clone()))
                .collect();
            rows.sort();
            Ok(rows)
        }

        fn put_annotation(&self, session_id: &str, key: &str, value: &str) -> Result<(), String> {
            let mut rows = self.annotations.lock().unwrap();
            match rows
                .iter_mut()
                .find(|(sid, k, _)| sid == session_id && k == key)
            {
                Some(slot) => slot.2 = value.to_string(),
                None => rows.push((session_id.to_string(), key.to_string(), value.to_string())),
            }
            Ok(())
        }

        fn clear_annotations(&self, session_id: &str) -> Result<(), String> {
            self.annotations
                .lock()
                .unwrap()
                .retain(|(sid, _, _)| sid != session_id);
            Ok(())
        }
    }

    /// 建表清单必须覆盖本域全部表（含账本两表）：`schema::prefixed_table_names` 是
    /// 对账面，DDL 是执行面，两侧漂移的后果是「清单说有此表、运行时 no such table」
    #[test]
    fn schema_creates_every_run_domain_table() {
        let ddl = SCHEMA.join("\n");
        for table in [
            "runs",
            "session_annotations",
            "run_events",
            "permission_audit",
        ] {
            assert!(
                ddl.contains(&format!("CREATE TABLE IF NOT EXISTS {}", table)),
                "建表清单缺 {}: {ddl}",
                table
            );
        }
        // 账本表的关键列与索引形状（读方按这些名字取数）
        for column in ["run_id", "seq", "kind", "payload", "source"] {
            assert!(ddl.contains(column), "run_events 缺列 {column}");
        }
        assert!(
            ddl.contains("idx_run_events_seq ON run_events(run_id, seq)"),
            "事件账本的 (run_id, seq) 唯一索引是本域的不变量"
        );
        assert_eq!(RUN_EVENT_CAP, 20_000, "上限取值是 spec 决定，改动需同步 README 与 ADR");
    }

    /// 内存实现的行语义（put 覆盖 / remove 命中 / 按项目级联删除 / 注解覆盖）——
    /// 它是策略单测的依赖底座，先自证
    #[test]
    fn mock_store_roundtrip() {
        let store = MockSessionStore::new(vec![]);
        store.ensure_schema().expect("schema");
        store
            .put(&MockSessionStore::record("s1", SessionStatus::Running))
            .expect("put");
        assert_eq!(store.all().unwrap().len(), 1);

        let mut updated = MockSessionStore::record("s1", SessionStatus::Stopped);
        updated.name = "改名后".to_string();
        store.put(&updated).expect("put update");
        assert_eq!(store.all().unwrap().len(), 1, "同 id 覆盖不新增行");
        assert_eq!(store.get("s1").unwrap().unwrap().name, "改名后");
        assert_eq!(
            store.get("s1").unwrap().unwrap().status,
            SessionStatus::Stopped
        );

        assert!(store.remove("s1").unwrap());
        assert!(!store.remove("s1").unwrap(), "未知 id 幂等 false");

        store.put_annotation("s1", "taskStatus", "asking").unwrap();
        store.put_annotation("s1", "taskStatus", "idle").unwrap();
        store.put_annotation("s1", "taskReason", "等待").unwrap();
        assert_eq!(
            store.all_annotations("s1").unwrap(),
            vec![
                ("taskReason".to_string(), "等待".to_string()),
                ("taskStatus".to_string(), "idle".to_string()),
            ],
            "同键覆盖 + 按 key 稳定序"
        );
        store.clear_annotations("s1").unwrap();
        assert!(store.all_annotations("s1").unwrap().is_empty());

        // 项目级联：同项目的运行与注解一并删除，跨项目的不动
        let mut same_project = MockSessionStore::record("s2", SessionStatus::Stopped);
        same_project.project_id = Some("p-cascade".to_string());
        let mut other_project = MockSessionStore::record("s3", SessionStatus::Running);
        other_project.project_id = Some("p-other".to_string());
        store.put(&same_project).unwrap();
        store.put(&other_project).unwrap();
        store.put_annotation("s2", "k", "v").unwrap();
        assert_eq!(store.remove_by_project("p-cascade").unwrap(), 1);
        assert!(store.get("s2").unwrap().is_none(), "同项目运行已删");
        assert!(
            store.all_annotations("s2").unwrap().is_empty(),
            "注解一并清空"
        );
        assert!(store.get("s3").unwrap().is_some(), "跨项目运行不受牵连");
    }
}
