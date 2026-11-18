//! 认证记录存储端口（2026-09-22 认证记录下沉）：真源 = 插件私有库
//! （host-plugin-database，`storage` 权限）
//!
//! **为什么需要它**：用户裁定（2026-09-22）`pairings` / `connection_history`
//! 不再留宿主主库（AGENTS.md §8「留宿主」口径撤销），认证记录归认证中心
//! （本插件）自持。宿主 host-auth 记录面原语（v18/v19 七函数）随之退役；
//! 本端口是配对设备 / 连接历史的**唯一写者与读源**。
//!
//! 与 [`crate::config::store`] / [`crate::quick_actions::store`] 同模式：端口按
//! **行语义**（而非 SQL）暴露，校验 / 排序 / 迁移编排等策略留在 [`super::ops`]，
//! 可被 native 单测完整覆盖；SQL 与列映射只存在于 wasm 实现里（native 链接不
//! 引用 wasm 专属 import 符号）。
//!
//! 表结构（插件私有库，无主库 `plugin_<id>_` 前缀约束）：
//! - `auth_pairings`：配对设备公开记录（**不含凭据列** `public_key` /
//!   `session_token`——session_token 是死列直接丢弃，凭据零复制；公钥自
//!   B-downsink 起真源 = 本库 `auth_biometric_keys` 独立表，见下）
//! - `auth_biometric_keys`：生物凭证公钥表（2026-09-30 生物线下沉：公钥托管
//!   从宿主 `plugin_secrets` 迁本库，P-256 验签执行点也在插件内）
//! - `auth_connection_history`：连接历史（无凭据列）

use super::model::{ConnectionEventRecord, PairingRecord};

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub const SCHEMA: &[&str] = &[
    // 配对设备：公开记录面（id / 展示名 / 指纹 / 地址 / 稳定 UID 锚点 / 时间戳 /
    // 计数 / 活跃标记）。软删（is_active=0）保留行——撤销检测依赖「已撤销记录
    // 仍可见」，删除行会让撤销决策 fail-open
    "CREATE TABLE IF NOT EXISTS auth_pairings (\
     id TEXT PRIMARY KEY, \
     device_name TEXT NOT NULL, \
     device_fingerprint TEXT NOT NULL UNIQUE, \
     address TEXT, \
     uid_hash TEXT, \
     peer_node_id TEXT, \
     paired_at TEXT NOT NULL, \
     last_seen TEXT, \
     connect_count INTEGER NOT NULL DEFAULT 1, \
     is_active INTEGER NOT NULL DEFAULT 1)",
    "CREATE INDEX IF NOT EXISTS idx_auth_pairings_fingerprint ON auth_pairings(device_fingerprint)",
    // 生物凭证公钥（B-downsink：真源从宿主 `plugin_secrets` 迁入本库；
    // 与 host-auth `biometric-*` 三原语同日退役，验签执行点在插件内）
    "CREATE TABLE IF NOT EXISTS auth_biometric_keys (\
     fingerprint TEXT PRIMARY KEY, \
     public_key TEXT NOT NULL, \
     updated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_auth_biometric_keys_fingerprint ON auth_biometric_keys(fingerprint)",
    // 连接历史：按 device_id（= auth_pairings.id）键控
    "CREATE TABLE IF NOT EXISTS auth_connection_history (\
     id INTEGER PRIMARY KEY AUTOINCREMENT, \
     device_id TEXT NOT NULL, \
     auth_method TEXT NOT NULL, \
     result TEXT NOT NULL, \
     address TEXT, \
     connected_at TEXT NOT NULL, \
     disconnected_at TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_auth_history_device ON auth_connection_history(device_id, connected_at DESC)",
];

/// 认证记录存储端口（真源读写；排序与解读归调用方）
pub trait AuthRecordsStore {
    /// 建表（幂等）
    fn ensure_schema(&self) -> Result<(), String>;

    // ==================== 配对设备 ====================

    /// 全部配对记录（**含软删行**，不排序——撤销检测依赖「已撤销记录仍可见」，
    /// 过滤与排序归 [`super::ops`]）
    fn pairings_all(&self) -> Result<Vec<PairingRecord>, String>;
    /// 按指纹查配对记录（含软删；供撤销检测 / 生物凭证判定）
    fn pairing_by_fingerprint(&self, fingerprint: &str) -> Result<Option<PairingRecord>, String>;
    /// 写入/归并配对记录（按 id upsert：id 已存在 → 整行更新（含指纹变更；
    /// `uid_hash` / `peer_node_id` 为 None 时 COALESCE 保留旧值）；id 不存在但
    /// 指纹已被占 → UNIQUE 冲突报错；否则插入。uid_hash 归并由调用方编排——
    /// 归并路径的 id 由调用方算出（见 [`super::ops::upsert_record`]））
    fn pairing_put(&self, record: &PairingRecord) -> Result<(), String>;
    /// 软删配对（`is_active = 0`）；返回是否命中了活跃记录
    fn pairing_revoke(&self, id: &str) -> Result<bool, String>;

    // ==================== 生物凭证公钥（B-downsink：真源从宿主迁入本库） ====================

    /// 按指纹取生物凭证公钥（未绑定 → `Ok(None)`）
    fn biometric_key_get(&self, fingerprint: &str) -> Result<Option<String>, String>;
    /// 绑定/覆盖生物凭证公钥（`updated_at` 由存储写入）
    fn biometric_key_set(&self, fingerprint: &str, public_key: &str) -> Result<(), String>;
    /// 解绑（删行；未绑定视为成功幂等）
    fn biometric_key_delete(&self, fingerprint: &str) -> Result<(), String>;

    // ==================== 连接历史 ====================

    /// 某设备的连接历史（倒序由端口保证——wasm `ORDER BY connected_at DESC`，
    /// mock 同序；与索引 `idx_auth_history_device` 的排序方向一致）
    fn history_by_device(&self, device_id: &str) -> Result<Vec<ConnectionEventRecord>, String>;
    /// 追加连接事件（指纹解析 device_id 由调用方完成；本端口只落库）
    fn history_append(&self, record: &ConnectionEventRecord) -> Result<(), String>;
    /// 回填断开时间（最近一条未关闭的连接）
    fn history_close_open(&self, device_id: &str, disconnected_at: &str) -> Result<bool, String>;
    /// 裁剪某设备的连接历史：只保留最新 `keep` 条（`connected_at` 序，同刻按 id），
    /// 删除最旧的超出部分；不足 `keep` 条不动（区别于 [`Self::history_clear`] 的全删）
    fn history_trim(&self, device_id: &str, keep: usize) -> Result<(), String>;
    /// 清空某设备的连接历史；返回是否命中至少一条
    fn history_clear(&self, device_id: &str) -> Result<bool, String>;
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::{HostLog, HostPluginDatabase};
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    /// 行（snake_case 列名，宿主 `query_to_json` 输出）→ 配对模型
    fn row_to_pairing(row: &serde_json::Value) -> Result<PairingRecord, String> {
        let required = |key: &str| -> Result<String, String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("auth pairing row missing column '{}': {}", key, row))
        };
        Ok(PairingRecord {
            id: required("id")?,
            device_name: required("device_name")?,
            device_fingerprint: required("device_fingerprint")?,
            address: row
                .get("address")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            uid_hash: row
                .get("uid_hash")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            peer_node_id: row
                .get("peer_node_id")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            paired_at: required("paired_at")?,
            last_seen: row
                .get("last_seen")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            connect_count: row
                .get("connect_count")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as u32,
            is_active: row.get("is_active").and_then(|v| v.as_i64()).unwrap_or(1) != 0,
        })
    }

    /// 行 → 连接历史模型
    fn row_to_history(row: &serde_json::Value) -> Result<ConnectionEventRecord, String> {
        let required = |key: &str| -> Result<String, String> {
            row.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .ok_or_else(|| format!("auth history row missing column '{}': {}", key, row))
        };
        Ok(ConnectionEventRecord {
            id: row.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            device_id: required("device_id")?,
            auth_method: required("auth_method")?,
            result: required("result")?,
            address: row
                .get("address")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            connected_at: required("connected_at")?,
            disconnected_at: row
                .get("disconnected_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    /// JSON 数组（查询结果）→ 模型列表；`None` / 非数组 → 空
    fn rows_to<T>(
        rows: Option<serde_json::Value>,
        mapper: impl Fn(&serde_json::Value) -> Result<T, String>,
    ) -> Result<Vec<T>, String> {
        let rows = rows.unwrap_or_else(|| serde_json::json!([]));
        let array = rows
            .as_array()
            .ok_or_else(|| format!("plugin db query did not return an array: {}", rows))?;
        array.iter().map(mapper).collect()
    }

    impl AuthRecordsStore for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            for stmt in SCHEMA {
                self.plugin_db_execute(stmt)
                    .map_err(|e| format!("plugin db execute failed: {}", e.message))?;
            }
            // 老库补列：`CREATE TABLE IF NOT EXISTS` 对既有表不生效，缺列会让
            // `pairing_put` 在 prepare 期直接失败（新装能用、升级后写不进配对记录）。
            let rows = self
                .plugin_db_query("PRAGMA table_info(auth_pairings)")
                .map_err(|e| format!("plugin db query failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            let columns: Vec<String> = rows
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
                .unwrap_or_default();
            for (column, ddl) in [(
                "peer_node_id",
                "ALTER TABLE auth_pairings ADD COLUMN peer_node_id TEXT",
            )] {
                if columns.iter().any(|existing| existing == column) {
                    continue;
                }
                self.plugin_db_execute(ddl)
                    .map_err(|e| format!("auth_pairings {column} add failed: {}", e.message))?;
                self.log_warn(&format!(
                    "auth_pairings: added {column} column (legacy records db)"
                ));
            }
            Ok(())
        }

        fn pairings_all(&self) -> Result<Vec<PairingRecord>, String> {
            self.plugin_db_query("SELECT * FROM auth_pairings")
                .map_err(|e| format!("plugin db query failed: {}", e.message))
                .and_then(|rows| rows_to(rows, row_to_pairing))
        }

        fn pairing_by_fingerprint(
            &self,
            fingerprint: &str,
        ) -> Result<Option<PairingRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM auth_pairings WHERE device_fingerprint = ?1",
                    &sql_params![fingerprint],
                )
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            let mut list = rows_to(rows, row_to_pairing)?;
            Ok(list.pop())
        }

        fn pairing_put(&self, record: &PairingRecord) -> Result<(), String> {
            // 冲突目标选 id 而非指纹：uid_hash 归并路径会以「存量 id + 新指纹」
            // 落库（`ops::upsert_record` 先算好目标 id），若只按指纹冲突则 id 已存在
            // 于另一行时 INSERT 直接撞主键报错（mock 能通过、真 SQL 必挂的路径）；
            // 按 id upsert 让「同 id 换指纹」与「同指纹同 id 更新」两条归并都命中。
            self.plugin_db_execute_params(
                "INSERT INTO auth_pairings \
                 (id, device_name, device_fingerprint, address, uid_hash, peer_node_id, paired_at, last_seen, connect_count, is_active) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
                 ON CONFLICT(id) DO UPDATE SET \
                   device_name = excluded.device_name, \
                   device_fingerprint = excluded.device_fingerprint, \
                   address = excluded.address, \
                   uid_hash = COALESCE(excluded.uid_hash, auth_pairings.uid_hash), \
                   peer_node_id = COALESCE(excluded.peer_node_id, auth_pairings.peer_node_id), \
                   last_seen = excluded.last_seen, \
                   connect_count = excluded.connect_count, \
                   is_active = excluded.is_active",
                &sql_params![
                    record.id,
                    record.device_name,
                    record.device_fingerprint,
                    record.address,
                    record.uid_hash,
                    record.peer_node_id,
                    record.paired_at,
                    record.last_seen,
                    record.connect_count,
                    if record.is_active { 1 } else { 0 }
                ],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn pairing_revoke(&self, id: &str) -> Result<bool, String> {
            let changed = self
                .plugin_db_execute_params(
                    "UPDATE auth_pairings SET is_active = 0 WHERE id = ?1 AND is_active = 1",
                    &sql_params![id],
                )
                .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(changed > 0)
        }

        fn biometric_key_get(&self, fingerprint: &str) -> Result<Option<String>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT public_key FROM auth_biometric_keys WHERE fingerprint = ?1",
                    &sql_params![fingerprint],
                )
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            let rows = rows.unwrap_or_else(|| serde_json::json!([]));
            Ok(rows
                .as_array()
                .and_then(|a| a.first())
                .and_then(|r| r.get("public_key"))
                .and_then(|v| v.as_str())
                .map(str::to_string))
        }

        fn biometric_key_set(&self, fingerprint: &str, public_key: &str) -> Result<(), String> {
            let now = crate::pairing::jwt::now_secs();
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO auth_biometric_keys (fingerprint, public_key, updated_at) \
                 VALUES (?1, ?2, ?3)",
                &sql_params![fingerprint, public_key, now.to_string()],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn biometric_key_delete(&self, fingerprint: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "DELETE FROM auth_biometric_keys WHERE fingerprint = ?1",
                &sql_params![fingerprint],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn history_by_device(&self, device_id: &str) -> Result<Vec<ConnectionEventRecord>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM auth_connection_history WHERE device_id = ?1 ORDER BY connected_at DESC",
                    &sql_params![device_id],
                )
                .map_err(|e| format!("plugin db query failed: {}", e.message))?;
            rows_to(rows, row_to_history)
        }

        fn history_append(&self, record: &ConnectionEventRecord) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT INTO auth_connection_history \
                 (device_id, auth_method, result, address, connected_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                &sql_params![
                    record.device_id,
                    record.auth_method,
                    record.result,
                    record.address,
                    record.connected_at
                ],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn history_close_open(
            &self,
            device_id: &str,
            disconnected_at: &str,
        ) -> Result<bool, String> {
            let changed = self
                .plugin_db_execute_params(
                    "UPDATE auth_connection_history SET disconnected_at = ?1 \
                     WHERE id = (SELECT id FROM auth_connection_history \
                                 WHERE device_id = ?2 AND disconnected_at IS NULL \
                                 ORDER BY connected_at DESC LIMIT 1)",
                    &sql_params![disconnected_at, device_id],
                )
                .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(changed > 0)
        }

        fn history_trim(&self, device_id: &str, keep: usize) -> Result<(), String> {
            // 保留最新 keep 条、删其余：NOT IN 子查询取「要保留的」，不足 keep 条时
            // 子查询覆盖全部行 → 零删除（若改写「LIMIT count-keep 删最旧」，负数 LIMIT
            // 在 SQLite 里是无上限 = 全删，正是本方法要避免的事故）
            self.plugin_db_execute_params(
                "DELETE FROM auth_connection_history WHERE device_id = ?1 AND id NOT IN ( \
                   SELECT id FROM auth_connection_history WHERE device_id = ?1 \
                   ORDER BY connected_at DESC, id DESC LIMIT ?2)",
                &sql_params![device_id, keep as i64],
            )
            .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(())
        }

        fn history_clear(&self, device_id: &str) -> Result<bool, String> {
            let changed = self
                .plugin_db_execute_params(
                    "DELETE FROM auth_connection_history WHERE device_id = ?1",
                    &sql_params![device_id],
                )
                .map_err(|e| format!("plugin db write failed: {}", e.message))?;
            Ok(changed > 0)
        }
    }
}

// ==================== Tests ====================

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 内存实现（native 单测注入）：行语义与私有库对齐
    #[derive(Default)]
    pub struct MockAuthRecords {
        pub pairings: Mutex<Vec<PairingRecord>>,
        pub history: Mutex<Vec<ConnectionEventRecord>>,
        pub biometric_keys: Mutex<std::collections::HashMap<String, String>>,
    }

    impl MockAuthRecords {
        pub fn new(pairings: Vec<PairingRecord>) -> Self {
            Self {
                pairings: Mutex::new(pairings),
                history: Mutex::new(Vec::new()),
                biometric_keys: Mutex::new(std::collections::HashMap::new()),
            }
        }
    }

    impl AuthRecordsStore for MockAuthRecords {
        fn ensure_schema(&self) -> Result<(), String> {
            Ok(())
        }

        fn pairings_all(&self) -> Result<Vec<PairingRecord>, String> {
            Ok(self.pairings.lock().unwrap().clone())
        }

        fn pairing_by_fingerprint(
            &self,
            fingerprint: &str,
        ) -> Result<Option<PairingRecord>, String> {
            Ok(self
                .pairings
                .lock()
                .unwrap()
                .iter()
                .find(|r| r.device_fingerprint == fingerprint)
                .cloned())
        }

        fn pairing_put(&self, record: &PairingRecord) -> Result<(), String> {
            let mut pairings = self.pairings.lock().unwrap();
            // 与真 SQL 逐条对齐（ON CONFLICT(id) + device_fingerprint UNIQUE）：
            // 指纹被**其他**行持有 → UNIQUE 冲突报错（INSERT 与按 id UPDATE 两面
            // 都撞）；id 已存在 → 整行更新（uid_hash / peer_node_id 为 None 时
            // COALESCE 保留旧值）；否则插入。SQL 里没有 uid_hash 锚点兜底归并——
            // 归并 id 由 ops 层算出，mock 不得替它补一条 SQL 会失败的路径
            if pairings
                .iter()
                .any(|r| r.device_fingerprint == record.device_fingerprint && r.id != record.id)
            {
                return Err(
                    "UNIQUE constraint failed: auth_pairings.device_fingerprint".to_string()
                );
            }
            match pairings.iter().position(|r| r.id == record.id) {
                Some(idx) => {
                    let mut updated = record.clone();
                    updated.uid_hash = updated.uid_hash.or_else(|| pairings[idx].uid_hash.clone());
                    updated.peer_node_id = updated
                        .peer_node_id
                        .or_else(|| pairings[idx].peer_node_id.clone());
                    pairings[idx] = updated;
                }
                None => pairings.push(record.clone()),
            }
            Ok(())
        }

        fn pairing_revoke(&self, id: &str) -> Result<bool, String> {
            let mut pairings = self.pairings.lock().unwrap();
            let Some(record) = pairings.iter_mut().find(|r| r.id == id) else {
                return Ok(false);
            };
            if !record.is_active {
                return Ok(false);
            }
            record.is_active = false;
            Ok(true)
        }

        fn biometric_key_get(&self, fingerprint: &str) -> Result<Option<String>, String> {
            Ok(self
                .biometric_keys
                .lock()
                .unwrap()
                .get(fingerprint)
                .cloned())
        }

        fn biometric_key_set(&self, fingerprint: &str, public_key: &str) -> Result<(), String> {
            self.biometric_keys
                .lock()
                .unwrap()
                .insert(fingerprint.to_string(), public_key.to_string());
            Ok(())
        }

        fn biometric_key_delete(&self, fingerprint: &str) -> Result<(), String> {
            self.biometric_keys.lock().unwrap().remove(fingerprint);
            Ok(())
        }

        fn history_by_device(&self, device_id: &str) -> Result<Vec<ConnectionEventRecord>, String> {
            let mut rows: Vec<ConnectionEventRecord> = self
                .history
                .lock()
                .unwrap()
                .iter()
                .filter(|r| r.device_id == device_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| b.connected_at.cmp(&a.connected_at));
            Ok(rows)
        }

        fn history_append(&self, record: &ConnectionEventRecord) -> Result<(), String> {
            let mut history = self.history.lock().unwrap();
            let mut row = record.clone();
            // 对齐 SQLite AUTOINCREMENT：id 由存储分配，单调递增不复用
            //（调用方传 0；同秒事件的裁剪次序靠 id tie-break）
            row.id = history.iter().map(|r| r.id).max().unwrap_or(0) + 1;
            history.push(row);
            Ok(())
        }

        fn history_close_open(
            &self,
            device_id: &str,
            disconnected_at: &str,
        ) -> Result<bool, String> {
            let mut history = self.history.lock().unwrap();
            let Some(record) = history
                .iter_mut()
                .filter(|r| r.device_id == device_id && r.disconnected_at.is_none())
                .max_by(|a, b| a.connected_at.cmp(&b.connected_at))
            else {
                return Ok(false);
            };
            record.disconnected_at = Some(disconnected_at.to_string());
            Ok(true)
        }

        fn history_trim(&self, device_id: &str, keep: usize) -> Result<(), String> {
            let mut history = self.history.lock().unwrap();
            // 与 wasm SQL 同语义：保留最新 keep 条（connected_at DESC, id DESC），
            // 删最旧的超出部分；其他设备的行不动
            let mut device_rows: Vec<(String, i64)> = history
                .iter()
                .filter(|r| r.device_id == device_id)
                .map(|r| (r.connected_at.clone(), r.id))
                .collect();
            device_rows.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
            device_rows.truncate(keep);
            let keep_ids: std::collections::HashSet<i64> =
                device_rows.into_iter().map(|(_, id)| id).collect();
            history.retain(|r| r.device_id != device_id || keep_ids.contains(&r.id));
            Ok(())
        }

        fn history_clear(&self, device_id: &str) -> Result<bool, String> {
            let mut history = self.history.lock().unwrap();
            let before = history.len();
            history.retain(|r| r.device_id != device_id);
            Ok(history.len() < before)
        }
    }

    fn put_record(id: &str, fp: &str, uid: Option<&str>) -> PairingRecord {
        PairingRecord {
            id: id.into(),
            device_name: "Phone".into(),
            device_fingerprint: fp.into(),
            address: None,
            uid_hash: uid.map(str::to_string),
            peer_node_id: None,
            paired_at: "2026-09-19T00:00:00Z".into(),
            last_seen: None,
            connect_count: 1,
            is_active: true,
        }
    }

    /// mock 与真 SQL 同语义：id 冲突整行更新；uid_hash / peer_node_id 为 None
    /// 时 COALESCE 保留旧值（不覆盖成 None）
    #[test]
    fn mock_put_id_conflict_updates_row_with_coalesce() {
        let mut existing = put_record("p-1", "fp-1", Some("uid-1"));
        existing.peer_node_id = Some("node-1".into());
        let store = MockAuthRecords::new(vec![existing]);
        let mut update = put_record("p-1", "fp-2", None);
        update.connect_count = 5;
        store.pairing_put(&update).expect("id conflict update");
        let all = store.pairings_all().expect("all");
        assert_eq!(all.len(), 1, "按 id 更新不新增行");
        assert_eq!(all[0].device_fingerprint, "fp-2", "同 id 换指纹允许");
        assert_eq!(all[0].connect_count, 5);
        assert_eq!(all[0].uid_hash.as_deref(), Some("uid-1"), "None 不覆盖旧值");
        assert_eq!(all[0].peer_node_id.as_deref(), Some("node-1"));
    }

    /// mock 与真 SQL 同语义：指纹被其他行持有 → UNIQUE 报错（按 id UPDATE 换
    /// 指纹与全新 INSERT 两面都撞）；policy 撤销检查的「同指纹至多一行」不变量
    /// 由本约束保证
    #[test]
    fn mock_put_fingerprint_unique_conflict_errors() {
        let store = MockAuthRecords::new(vec![
            put_record("p-1", "fp-1", None),
            put_record("p-2", "fp-2", None),
        ]);
        // UPDATE 面：p-1 改成 p-2 的指纹
        let err = store
            .pairing_put(&put_record("p-1", "fp-2", None))
            .expect_err("UNIQUE on update");
        assert!(err.contains("UNIQUE"), "got: {err}");
        // INSERT 面：新 id 撞既有指纹
        let err = store
            .pairing_put(&put_record("p-3", "fp-1", None))
            .expect_err("UNIQUE on insert");
        assert!(err.contains("UNIQUE"), "got: {err}");
        let all = store.pairings_all().expect("all");
        assert_eq!(all.len(), 2, "冲突写入不落行");
        assert_eq!(all[0].device_fingerprint, "fp-1");
    }

    /// SQL 里没有 uid_hash 锚点兜底归并：同 uid、不同 id、不同指纹 → 插入新行
    ///（归并 id 是 ops 层编排职责，mock 不得补一条 SQL 会失败/不存在的路径）
    #[test]
    fn mock_put_does_not_merge_by_uid_hash() {
        let store = MockAuthRecords::new(vec![put_record("p-1", "fp-1", Some("uid-1"))]);
        store
            .pairing_put(&put_record("p-2", "fp-2", Some("uid-1")))
            .expect("insert");
        let all = store.pairings_all().expect("all");
        assert_eq!(all.len(), 2, "同 uid 不触发存储层归并");
        assert_eq!(all[1].id, "p-2");
    }

    /// mock 撤销：软删保留行（撤销检测依赖软删可见）
    #[test]
    fn mock_revoke_soft_deletes_keeps_row() {
        let store = MockAuthRecords::new(vec![PairingRecord {
            id: "p-1".into(),
            device_name: "Phone".into(),
            device_fingerprint: "fp-1".into(),
            address: None,
            uid_hash: None,
            peer_node_id: None,
            paired_at: "2026-09-19T00:00:00Z".into(),
            last_seen: None,
            connect_count: 1,
            is_active: true,
        }]);
        assert!(store.pairing_revoke("p-1").expect("revoke"));
        assert!(!store
            .pairing_revoke("p-1")
            .expect("revoke again idempotent"));
        let all = store.pairings_all().expect("all");
        assert_eq!(all.len(), 1, "软删保留行");
        assert!(!all[0].is_active);
    }

    /// mock 裁剪：保留最新 keep 条、不足不动、其他设备不受影响（与 wasm SQL 同语义）
    #[test]
    fn mock_history_trim_keeps_newest_and_spares_other_devices() {
        let store = MockAuthRecords::default();
        for i in 0..5 {
            store
                .history_append(&ConnectionEventRecord {
                    id: 0,
                    device_id: "d-1".into(),
                    auth_method: "qr".into(),
                    result: "success".into(),
                    address: None,
                    connected_at: crate::pairing::code::format_rfc3339_utc(1_700_000_000 + i),
                    disconnected_at: None,
                })
                .expect("append d-1");
        }
        store
            .history_append(&ConnectionEventRecord {
                id: 0,
                device_id: "d-2".into(),
                auth_method: "jwt".into(),
                result: "success".into(),
                address: None,
                connected_at: "2026-09-19T00:00:00Z".into(),
                disconnected_at: None,
            })
            .expect("append d-2");
        store.history_trim("d-1", 3).expect("trim");
        let rows = store.history_by_device("d-1").expect("list d-1");
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[0].connected_at,
            crate::pairing::code::format_rfc3339_utc(1_700_000_004),
            "最新在前且保留"
        );
        assert_eq!(
            rows[2].connected_at,
            crate::pairing::code::format_rfc3339_utc(1_700_000_002),
            "最旧两条被裁"
        );
        assert_eq!(store.history_by_device("d-2").expect("list d-2").len(), 1);
        store.history_trim("d-1", 10).expect("trim under limit");
        assert_eq!(
            store.history_by_device("d-1").expect("list").len(),
            3,
            "不足 keep 不动"
        );
    }

    /// mock 历史：倒序由端口保证（ORDER BY connected_at DESC 语义）
    #[test]
    fn mock_history_sorted_desc() {
        let store = MockAuthRecords::default();
        store
            .history_append(&ConnectionEventRecord {
                id: 0,
                device_id: "d-1".into(),
                auth_method: "qr".into(),
                result: "success".into(),
                address: None,
                connected_at: "2026-09-19T00:00:00Z".into(),
                disconnected_at: None,
            })
            .expect("append");
        store
            .history_append(&ConnectionEventRecord {
                id: 0,
                device_id: "d-1".into(),
                auth_method: "jwt".into(),
                result: "success".into(),
                address: None,
                connected_at: "2026-09-20T00:00:00Z".into(),
                disconnected_at: None,
            })
            .expect("append");
        let rows = store.history_by_device("d-1").expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].auth_method, "jwt", "最新在前");
    }
}
