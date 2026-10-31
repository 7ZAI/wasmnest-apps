//! 运行事件账本存储端口（ADR 0004）
//!
//! 端口按**行语义**暴露（与 `session::store` 同范式）：seq 分配与去重比较留在
//! [`super::ingest`]，SQL 与列映射只存在于 wasm 实现里，native 单测用内存实现
//! 跑同一套入口逻辑。
//!
//! **id 是写入序号，seq 是逻辑位置**：同身份事件原地更新时保留 seq、换新 id，
//! 读取面的增量游标因此能看见「老位置的新内容」；按 seq 排序则是对话面的稳定
//! 渲染顺序。
//!
//! 表结构由 `session::store::SCHEMA` 拥有（run_events 与 runs 同域）；本模块
//! 只读写。上限淘汰（20000 条）与 `runs.truncated` 标记也在本端口实现。

use super::model::{DraftEvent, EventSource, StoredEvent};

pub trait EventStore {
    /// 按运行内稳定身份取既有事件（无则 None）
    fn get_by_dedupe(&self, run_id: &str, dedupe_key: &str) -> Result<Option<StoredEvent>, String>;
    /// 下一逻辑位置（`COALESCE(MAX(seq), 0) + 1`）
    fn next_seq(&self, run_id: &str) -> Result<i64, String>;
    /// 插入新事件（占用 seq）
    fn insert(
        &self,
        run_id: &str,
        seq: i64,
        draft: &DraftEvent,
        source: EventSource,
    ) -> Result<(), String>;
    /// 原地更新：删除旧行后以同一 seq 重新插入（新 id = 新的写入序号）
    fn replace(
        &self,
        run_id: &str,
        id: i64,
        seq: i64,
        draft: &DraftEvent,
        source: EventSource,
    ) -> Result<(), String>;
    /// 只保留最近 `keep` 条（按 seq），返回淘汰条数
    fn prune(&self, run_id: &str, keep: usize) -> Result<usize, String>;
    /// 置 `runs.truncated = 1`
    fn mark_truncated(&self, run_id: &str) -> Result<(), String>;
    /// 增量读取：`after_id` 之后写入/更新的行，按写入 id 升序（游标 = 本批最大
    /// id，分页单调；渲染顺序由读取方按 seq 合并）；无 `after_id` 时取最近
    /// `limit` 条（按 seq 升序返回）
    fn list(
        &self,
        run_id: &str,
        after_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<StoredEvent>, String>;
    /// 运行的截断标记（runs 表；行不存在 = false）
    fn run_truncated(&self, run_id: &str) -> Result<bool, String>;
}

// ==================== wasm：插件私有库实现 ====================

/// 尾部快照（省略 `afterId`）：内层取最近 `limit` 行（按 seq 倒序），外层按 seq
/// 正序回。**外层列清单必须含 `rev`**（`row_to_event` 对它硬取，漏列 = 读取整体
/// 失败；issue #25 H1 的病灶就是外层漏了）。
pub(crate) const LIST_TAIL_SQL: &str = "SELECT id, run_id, seq, rev, at, kind, payload, source, dedupe_key FROM \
     (SELECT id, run_id, seq, rev, at, kind, payload, source, dedupe_key FROM run_events \
      WHERE run_id = ?1 ORDER BY seq DESC LIMIT ?2) ORDER BY seq";

/// 增量读取（`id > afterId`）：**按写入 id 排序分页**（游标 = 本批最大写入 id）。
/// 若按 seq 排序，第一批里被原地更新的行（新 id）会把游标顶过中段未交付行的 id，
/// 那些行此后永远读不到（issue #25 H2）；重交付与乱序交给前端按 seq 合并
/// （`mergeEvents` 同 seq 就地替换），渲染顺序本就不由这条 SQL 决定。
pub(crate) const LIST_INCREMENTAL_SQL: &str = "SELECT id, run_id, seq, rev, at, kind, payload, source, dedupe_key FROM run_events \
     WHERE run_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3";

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    fn row_to_event(row: &serde_json::Value) -> Result<StoredEvent, String> {
        let int = |key: &str| -> Result<i64, String> {
            row.get(key)
                .and_then(|value| value.as_i64())
                .ok_or_else(|| format!("run_events row missing integer column '{key}': {row}"))
        };
        let string = |key: &str| -> Result<String, String> {
            row.get(key)
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("run_events row missing string column '{key}': {row}"))
        };
        let payload_raw = string("payload")?;
        let payload = serde_json::from_str(&payload_raw)
            .map_err(|e| format!("run_events payload is not JSON: {e} (raw: {payload_raw})"))?;
        Ok(StoredEvent {
            id: int("id")?,
            run_id: string("run_id")?,
            seq: int("seq")?,
            rev: int("rev")?,
            at: string("at")?,
            kind: string("kind")?,
            payload,
            source: string("source")?,
            dedupe_key: string("dedupe_key")?,
        })
    }

    fn rows_to_events(rows: Option<serde_json::Value>) -> Result<Vec<StoredEvent>, String> {
        let rows = rows.unwrap_or_else(|| serde_json::json!([]));
        let array = rows
            .as_array()
            .ok_or_else(|| format!("run_events query did not return an array: {rows}"))?;
        array.iter().map(row_to_event).collect()
    }

    fn payload_text(payload: &serde_json::Value) -> Result<String, String> {
        serde_json::to_string(payload)
            .map_err(|e| format!("run event payload serialize failed: {e}"))
    }

    impl EventStore for WasmHost {
        fn get_by_dedupe(
            &self,
            run_id: &str,
            dedupe_key: &str,
        ) -> Result<Option<StoredEvent>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT id, run_id, seq, rev, at, kind, payload, source, dedupe_key FROM run_events \
                     WHERE run_id = ?1 AND dedupe_key = ?2 ORDER BY id DESC LIMIT 1",
                    &sql_params![run_id, dedupe_key],
                )
                .map_err(|e| format!("run_events lookup failed: {}", e.message))?;
            Ok(rows_to_events(rows)?.into_iter().next())
        }

        fn next_seq(&self, run_id: &str) -> Result<i64, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT COALESCE(MAX(seq), 0) AS next FROM run_events WHERE run_id = ?1",
                    &sql_params![run_id],
                )
                .map_err(|e| format!("run_events seq query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            let next = rows
                .as_array()
                .and_then(|array| array.first())
                .and_then(|row| row.get("next"))
                .and_then(|value| value.as_i64())
                .ok_or_else(|| format!("run_events seq query returned no row: {rows}"))?;
            Ok(next + 1)
        }

        fn insert(
            &self,
            run_id: &str,
            seq: i64,
            draft: &DraftEvent,
            source: EventSource,
        ) -> Result<(), String> {
            let payload = payload_text(&draft.payload)?;
            self.plugin_db_execute_params(
                "INSERT INTO run_events (run_id, seq, rev, at, kind, payload, source, dedupe_key) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                &sql_params![
                    run_id,
                    seq,
                    draft.rev,
                    draft.at,
                    draft.kind,
                    payload,
                    source.as_str(),
                    draft.dedupe_key
                ],
            )
            .map_err(|e| format!("run_events insert failed: {}", e.message))?;
            Ok(())
        }

        fn replace(
            &self,
            run_id: &str,
            id: i64,
            seq: i64,
            draft: &DraftEvent,
            source: EventSource,
        ) -> Result<(), String> {
            // delete + insert（而不是 UPDATE）：读取面的增量游标是 id，原地更新必须
            // 产生新的写入序号，否则轮询方永远看不到这次内容变化
            self.plugin_db_execute_params("DELETE FROM run_events WHERE id = ?1", &sql_params![id])
                .map_err(|e| format!("run_events replace delete failed: {}", e.message))?;
            self.insert(run_id, seq, draft, source)
        }

        fn prune(&self, run_id: &str, keep: usize) -> Result<usize, String> {
            let keep = keep.max(1);
            let total_rows = self
                .plugin_db_query_params(
                    "SELECT COUNT(*) AS n FROM run_events WHERE run_id = ?1",
                    &sql_params![run_id],
                )
                .map_err(|e| format!("run_events count failed: {}", e.message))?;
            let total = total_rows
                .and_then(|rows| rows.as_array().and_then(|array| array.first()).cloned())
                .and_then(|row| row.get("n").and_then(|value| value.as_i64()))
                .ok_or_else(|| "run_events count query returned no row".to_string())?;
            if total <= keep as i64 {
                return Ok(0);
            }
            let cutoff_rows = self
                .plugin_db_query_params(
                    "SELECT seq FROM run_events WHERE run_id = ?1 ORDER BY seq DESC LIMIT 1 OFFSET ?2",
                    &sql_params![run_id, (keep - 1) as i64],
                )
                .map_err(|e| format!("run_events cutoff query failed: {}", e.message))?;
            let cutoff = cutoff_rows
                .and_then(|rows| rows.as_array().and_then(|array| array.first()).cloned())
                .and_then(|row| row.get("seq").and_then(|value| value.as_i64()));
            let Some(cutoff) = cutoff else {
                return Ok(0);
            };
            let deleted = self
                .plugin_db_execute_params(
                    "DELETE FROM run_events WHERE run_id = ?1 AND seq < ?2",
                    &sql_params![run_id, cutoff],
                )
                .map_err(|e| format!("run_events prune failed: {}", e.message))?;
            Ok(deleted.max(0) as usize)
        }

        fn mark_truncated(&self, run_id: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "UPDATE runs SET truncated = 1 WHERE id = ?1",
                &sql_params![run_id],
            )
            .map_err(|e| format!("runs.truncated update failed: {}", e.message))?;
            Ok(())
        }

        fn list(
            &self,
            run_id: &str,
            after_id: Option<i64>,
            limit: usize,
        ) -> Result<Vec<StoredEvent>, String> {
            let limit = limit.max(1) as i64;
            let rows = match after_id {
                Some(after) => self.plugin_db_query_params(LIST_INCREMENTAL_SQL, &sql_params![run_id, after, limit]),
                None => self.plugin_db_query_params(LIST_TAIL_SQL, &sql_params![run_id, limit]),
            }
            .map_err(|e| format!("run_events read failed: {}", e.message))?;
            rows_to_events(rows)
        }

        fn run_truncated(&self, run_id: &str) -> Result<bool, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT truncated FROM runs WHERE id = ?1",
                    &sql_params![run_id],
                )
                .map_err(|e| format!("runs.truncated read failed: {}", e.message))?;
            Ok(rows
                .and_then(|rows| rows.as_array().and_then(|array| array.first()).cloned())
                .and_then(|row| row.get("truncated").and_then(|value| value.as_i64()))
                .unwrap_or(0)
                != 0)
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeSet;

    /// 内存实现（native 单测注入）：行语义与私有库对齐
    #[derive(Default)]
    pub struct MockEventStore {
        rows: RefCell<Vec<StoredEvent>>,
        next_id: Cell<i64>,
        truncated: RefCell<BTreeSet<String>>,
    }

    impl MockEventStore {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn events(&self) -> Vec<StoredEvent> {
            let mut rows = self.rows.borrow().clone();
            rows.sort_by_key(|event| (event.seq, event.id));
            rows
        }

        pub fn len(&self) -> usize {
            self.rows.borrow().len()
        }
    }

    impl EventStore for MockEventStore {
        fn get_by_dedupe(
            &self,
            run_id: &str,
            dedupe_key: &str,
        ) -> Result<Option<StoredEvent>, String> {
            let rows = self.rows.borrow();
            let mut found: Vec<&StoredEvent> = rows
                .iter()
                .filter(|event| event.dedupe_key == dedupe_key && event.run_id == run_id)
                .collect();
            found.sort_by_key(|event| event.id);
            Ok(found.last().map(|event| (*event).clone()))
        }

        fn next_seq(&self, run_id: &str) -> Result<i64, String> {
            Ok(self
                .rows
                .borrow()
                .iter()
                .filter(|event| event.run_id == run_id)
                .map(|event| event.seq)
                .max()
                .unwrap_or(0)
                + 1)
        }

        fn insert(
            &self,
            run_id: &str,
            seq: i64,
            draft: &DraftEvent,
            source: EventSource,
        ) -> Result<(), String> {
            let id = self.next_id.get() + 1;
            self.next_id.set(id);
            self.rows.borrow_mut().push(StoredEvent {
                id,
                run_id: run_id.to_string(),
                seq,
                rev: draft.rev,
                at: draft.at.clone(),
                kind: draft.kind.to_string(),
                payload: draft.payload.clone(),
                source: source.as_str().to_string(),
                dedupe_key: draft.dedupe_key.clone(),
            });
            Ok(())
        }

        fn replace(
            &self,
            run_id: &str,
            id: i64,
            seq: i64,
            draft: &DraftEvent,
            source: EventSource,
        ) -> Result<(), String> {
            let mut rows = self.rows.borrow_mut();
            let Some(index) = rows.iter().position(|event| event.id == id) else {
                return Err(format!("replace: no event with id {id}"));
            };
            rows.remove(index);
            drop(rows);
            self.insert(run_id, seq, draft, source)
        }

        fn prune(&self, run_id: &str, keep: usize) -> Result<usize, String> {
            let keep = keep.max(1);
            let mut rows = self.rows.borrow_mut();
            let mut mine: Vec<i64> = rows
                .iter()
                .filter(|event| event.run_id == run_id)
                .map(|event| event.seq)
                .collect();
            mine.sort_unstable();
            if mine.len() <= keep {
                return Ok(0);
            }
            let cutoff = mine[mine.len() - keep];
            let before = rows.len();
            rows.retain(|event| event.run_id != run_id || event.seq >= cutoff);
            Ok(before - rows.len())
        }

        fn mark_truncated(&self, run_id: &str) -> Result<(), String> {
            self.truncated.borrow_mut().insert(run_id.to_string());
            Ok(())
        }

        fn list(
            &self,
            run_id: &str,
            after_id: Option<i64>,
            limit: usize,
        ) -> Result<Vec<StoredEvent>, String> {
            let limit = limit.max(1);
            let mut rows: Vec<StoredEvent> = self
                .rows
                .borrow()
                .iter()
                .filter(|event| event.run_id == run_id)
                .filter(|event| after_id.map(|after| event.id > after).unwrap_or(true))
                .cloned()
                .collect();
            if after_id.is_none() {
                rows.sort_by_key(|event| (event.seq, event.id));
                if rows.len() > limit {
                    rows = rows.split_off(rows.len() - limit);
                }
            } else {
                // 增量分支按写入 id 升序（与 LIST_INCREMENTAL_SQL 的 ORDER BY id
                // 对齐）：原地更新产生新 id，本批内被更新的行重交付，游标不跳段
                rows.sort_by_key(|event| event.id);
                rows.truncate(limit);
            }
            Ok(rows)
        }

        fn run_truncated(&self, run_id: &str) -> Result<bool, String> {
            Ok(self.truncated.borrow().contains(run_id))
        }
    }

    /// SQL 形状锁：读取 SQL 只在 wasm 私有库上执行，native 单测覆盖不到执行期，
    /// 两处已知病灶（issue #25 H1/H2）钉在字面上
    #[test]
    fn list_sql_shapes_pin_column_and_cursor_contracts() {
        // H1：尾部快照内外层列清单都必须含 rev（row_to_event 硬取，漏列 = 读取整体失败）
        let (outer, inner) = LIST_TAIL_SQL
            .split_once(" FROM (")
            .expect("尾部快照必须是嵌套 SELECT");
        assert!(outer.contains("rev"), "尾部快照外层列清单漏 rev: {outer}");
        assert!(inner.contains("rev"), "尾部快照内层列清单漏 rev: {inner}");
        // H2：增量分支按写入 id 排序（游标单调不跳段），禁止按 seq 排序
        assert!(
            LIST_INCREMENTAL_SQL.contains("ORDER BY id LIMIT"),
            "增量分支必须按写入 id 排序: {LIST_INCREMENTAL_SQL}"
        );
        assert!(
            !LIST_INCREMENTAL_SQL.contains("ORDER BY seq"),
            "增量分支按 seq 排序会让原地更新顶飞游标: {LIST_INCREMENTAL_SQL}"
        );
    }
}
