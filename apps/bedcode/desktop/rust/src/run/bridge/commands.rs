//! 桥接命令队列（ADR 0004 的下行通道）
//!
//! 前端 / 后端把「发给 agent 的动作」写成一行命令，agent 进程里的桥接扩展轮询
//! 取走、执行、回执。命令是**异步且在途可重投**的：
//! - `pending` → 扩展 claim 成 `claimed`（同一行只交付一次）；
//! - 扩展崩溃 / 回执丢失 → `claimed_at` 超过回收窗口后再次可领（至少一次语义，
//!   由命令本身幂等性兜底）；
//! - `done` / `failed` 是终态，ack 幂等（重复回执不报错）。
//!
//! 端口按行语义暴露，SQL 只在 wasm 实现里；native 单测跑内存实现。

use serde_json::Value;

/// 已领取的命令（扩展侧只需要 id / kind / payload）
#[derive(Debug, Clone, PartialEq)]
pub struct StoredCommand {
    pub id: i64,
    pub kind: String,
    pub payload: Value,
}

/// 命令存储端口（入队 / 领取 / 回执）
pub trait CommandStore {
    /// 入队，返回命令 id
    fn enqueue(&self, run_id: &str, kind: &str, payload: &Value, at: &str) -> Result<i64, String>;
    /// 领取可执行命令（pending，或 claimed 超过回收窗口），并标记为 claimed
    fn claim_ready(
        &self,
        run_id: &str,
        now: &str,
        stale_before: &str,
    ) -> Result<Vec<StoredCommand>, String>;
    /// 回执：`ok` → done，否则 failed；返回是否命中可终态的命令
    fn finish(
        &self,
        run_id: &str,
        id: i64,
        ok: bool,
        error: Option<&str>,
        now: &str,
    ) -> Result<bool, String>;
}

/// 一次最多领取的命令数（轮询频率 500ms，20 条足够；防止一条坏命令拖住队列）
pub const CLAIM_LIMIT: usize = 20;

/// `send` 命令的 kind（payload：`{text}`）
pub const COMMAND_SEND: &str = "send";

pub fn enqueue<S: CommandStore>(
    store: &S,
    run_id: &str,
    kind: &str,
    payload: &Value,
    now: &str,
) -> Result<i64, String> {
    if kind.trim().is_empty() {
        return Err("command kind required".to_string());
    }
    store.enqueue(run_id, kind, payload, now)
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    fn parse_command(row: &serde_json::Value) -> Result<StoredCommand, String> {
        let id = row
            .get("id")
            .and_then(|value| value.as_i64())
            .ok_or_else(|| format!("run_commands row missing id: {row}"))?;
        let kind = row
            .get("kind")
            .and_then(|value| value.as_str())
            .ok_or_else(|| format!("run_commands row missing kind: {row}"))?
            .to_string();
        let payload_raw = row
            .get("payload")
            .and_then(|value| value.as_str())
            .ok_or_else(|| format!("run_commands row missing payload: {row}"))?;
        let payload = serde_json::from_str(payload_raw)
            .map_err(|e| format!("run_commands payload is not JSON: {e}"))?;
        Ok(StoredCommand { id, kind, payload })
    }

    impl CommandStore for WasmHost {
        fn enqueue(
            &self,
            run_id: &str,
            kind: &str,
            payload: &Value,
            at: &str,
        ) -> Result<i64, String> {
            let payload = serde_json::to_string(payload)
                .map_err(|e| format!("command payload serialize failed: {e}"))?;
            self.plugin_db_execute_params(
                "INSERT INTO run_commands (run_id, kind, payload, status, created_at) \
                 VALUES (?1, ?2, ?3, 'pending', ?4)",
                &sql_params![run_id, kind, payload, at],
            )
            .map_err(|e| format!("run_commands insert failed: {}", e.message))?;
            let rows = self
                .plugin_db_query("SELECT last_insert_rowid() AS id")
                .map_err(|e| format!("run_commands id query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            rows.as_array()
                .and_then(|array| array.first())
                .and_then(|row| row.get("id"))
                .and_then(|value| value.as_i64())
                .ok_or_else(|| "run_commands id query returned no row".to_string())
        }

        fn claim_ready(
            &self,
            run_id: &str,
            now: &str,
            stale_before: &str,
        ) -> Result<Vec<StoredCommand>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT id, kind, payload FROM run_commands \
                     WHERE run_id = ?1 AND (status = 'pending' OR \
                       (status = 'claimed' AND (claimed_at IS NULL OR claimed_at < ?2))) \
                     ORDER BY id LIMIT ?3",
                    &sql_params![run_id, stale_before, CLAIM_LIMIT as i64],
                )
                .map_err(|e| format!("run_commands claim query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            let mut claimed = Vec::new();
            for row in rows.as_array().cloned().unwrap_or_default() {
                let command = parse_command(&row)?;
                let affected = self
                    .plugin_db_execute_params(
                        "UPDATE run_commands SET status = 'claimed', claimed_at = ?1 \
                         WHERE id = ?2 AND run_id = ?3 AND status IN ('pending', 'claimed')",
                        &sql_params![now, command.id, run_id],
                    )
                    .map_err(|e| format!("run_commands claim update failed: {}", e.message))?;
                if affected > 0 {
                    claimed.push(command);
                }
            }
            Ok(claimed)
        }

        fn finish(
            &self,
            run_id: &str,
            id: i64,
            ok: bool,
            error: Option<&str>,
            now: &str,
        ) -> Result<bool, String> {
            let status = if ok { "done" } else { "failed" };
            let affected = self
                .plugin_db_execute_params(
                    "UPDATE run_commands SET status = ?1, finished_at = ?2, error = ?3 \
                     WHERE id = ?4 AND run_id = ?5 AND status IN ('pending', 'claimed')",
                    &sql_params![status, now, error, id, run_id],
                )
                .map_err(|e| format!("run_commands ack failed: {}", e.message))?;
            Ok(affected > 0)
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Debug, Clone)]
    struct MockRow {
        id: i64,
        run_id: String,
        kind: String,
        payload: Value,
        status: String,
        claimed_at: Option<String>,
    }

    /// 内存实现：行语义与私有库对齐（至少一次领取 + 幂等回执）
    #[derive(Default)]
    pub struct MockCommandStore {
        rows: RefCell<Vec<MockRow>>,
        next_id: RefCell<i64>,
    }

    impl MockCommandStore {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn statuses(&self) -> Vec<String> {
            self.rows
                .borrow()
                .iter()
                .map(|row| row.status.clone())
                .collect()
        }
    }

    impl CommandStore for MockCommandStore {
        fn enqueue(
            &self,
            run_id: &str,
            kind: &str,
            payload: &Value,
            _at: &str,
        ) -> Result<i64, String> {
            let mut next = self.next_id.borrow_mut();
            *next += 1;
            self.rows.borrow_mut().push(MockRow {
                id: *next,
                run_id: run_id.to_string(),
                kind: kind.to_string(),
                payload: payload.clone(),
                status: "pending".to_string(),
                claimed_at: None,
            });
            Ok(*next)
        }

        fn claim_ready(
            &self,
            run_id: &str,
            now: &str,
            stale_before: &str,
        ) -> Result<Vec<StoredCommand>, String> {
            let mut rows = self.rows.borrow_mut();
            let mut out = Vec::new();
            for row in rows.iter_mut().filter(|row| row.run_id == run_id) {
                let ready = row.status == "pending"
                    || (row.status == "claimed"
                        && row
                            .claimed_at
                            .as_deref()
                            .map(|claimed| claimed < stale_before)
                            .unwrap_or(true));
                if !ready {
                    continue;
                }
                row.status = "claimed".to_string();
                row.claimed_at = Some(now.to_string());
                out.push(StoredCommand {
                    id: row.id,
                    kind: row.kind.clone(),
                    payload: row.payload.clone(),
                });
                if out.len() >= CLAIM_LIMIT {
                    break;
                }
            }
            Ok(out)
        }

        fn finish(
            &self,
            run_id: &str,
            id: i64,
            ok: bool,
            _error: Option<&str>,
            _now: &str,
        ) -> Result<bool, String> {
            let mut rows = self.rows.borrow_mut();
            let Some(row) = rows
                .iter_mut()
                .find(|row| row.id == id && row.run_id == run_id)
            else {
                return Ok(false);
            };
            if row.status != "pending" && row.status != "claimed" {
                return Ok(false);
            }
            row.status = if ok { "done" } else { "failed" }.to_string();
            Ok(true)
        }
    }

    fn now() -> &'static str {
        "2026-10-30T12:00:00Z"
    }

    #[test]
    fn enqueue_then_claim_delivers_once() {
        let store = MockCommandStore::new();
        let id = enqueue(
            &store,
            "run-1",
            COMMAND_SEND,
            &serde_json::json!({"text":"hi"}),
            now(),
        )
        .expect("enqueue");
        let first = store
            .claim_ready("run-1", now(), "2026-10-30T11:59:00Z")
            .expect("claim");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, id);
        assert_eq!(first[0].kind, "send");
        assert_eq!(first[0].payload["text"], "hi");
        let second = store
            .claim_ready("run-1", now(), "2026-10-30T11:59:00Z")
            .expect("claim again");
        assert!(second.is_empty(), "同一行不得二次交付");
        assert_eq!(store.statuses(), vec!["claimed"]);
    }

    #[test]
    fn stale_claim_is_reclaimed_after_the_window() {
        let store = MockCommandStore::new();
        enqueue(
            &store,
            "run-1",
            COMMAND_SEND,
            &serde_json::json!({"text":"hi"}),
            now(),
        )
        .unwrap();
        store
            .claim_ready("run-1", "2026-10-30T12:00:00Z", "2026-10-30T11:59:45Z")
            .unwrap();
        // 早于 stale_before 的领取可重投（扩展崩溃后的至少一次语义）
        let reclaimed = store
            .claim_ready("run-1", "2026-10-30T12:00:40Z", "2026-10-30T12:00:30Z")
            .expect("reclaim");
        assert_eq!(reclaimed.len(), 1);
        assert_eq!(store.statuses(), vec!["claimed"], "重投仍是 claimed");
    }

    #[test]
    fn ack_is_terminal_and_idempotent() {
        let store = MockCommandStore::new();
        let id = enqueue(&store, "run-1", COMMAND_SEND, &serde_json::json!({}), now()).unwrap();
        store
            .claim_ready("run-1", now(), "2026-10-30T11:59:00Z")
            .unwrap();
        assert!(store.finish("run-1", id, true, None, now()).unwrap());
        assert!(!store
            .finish("run-1", id, false, Some("late"), now())
            .unwrap());
        assert_eq!(store.statuses(), vec!["done"]);
        assert!(!store.finish("run-1", 999, true, None, now()).unwrap());
    }

    #[test]
    fn failed_ack_marks_failed_and_other_run_is_isolated() {
        let store = MockCommandStore::new();
        let id = enqueue(&store, "run-1", COMMAND_SEND, &serde_json::json!({}), now()).unwrap();
        store
            .claim_ready("run-1", now(), "2026-10-30T11:59:00Z")
            .unwrap();
        assert!(
            !store.finish("run-2", id, true, None, now()).unwrap(),
            "跨运行不得回执"
        );
        assert!(store
            .finish("run-1", id, false, Some("boom"), now())
            .unwrap());
        assert_eq!(store.statuses(), vec!["failed"]);
    }
}
