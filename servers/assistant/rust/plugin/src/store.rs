//! 数据底座：插件私有库（host-plugin-database）+ 表结构 / 迁移 / CRUD
//! （票 07 / spec §5.3）
//!
//! - 表名统一前缀 `assistant_`；敏感列（消息正文 / 记忆值 / 校验值）为 AEAD 密文，
//!   解密归调用方（会话密钥住 [`crate::vault`] 进程内存，store 不持有）。
//! - `schema_version` 表 + 顺序迁移；迁移失败 fail-visible，不允许半迁移。
//! - 端口按行语义暴露（[`Store`] trait），wasm 实现走 `WasmHost` 的
//!   `plugin_db_*`；native 单测只覆盖纯映射与 schema 校验，不依赖 wasm 宿主。

use serde::{Deserialize, Serialize};

use crate::vault::VaultMeta;

/// 当前 schema 版本（新增迁移须递增并在下方追加步骤）
pub const SCHEMA_VERSION: i32 = 2;

// ==================== 表结构 ====================

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS assistant_conversations (\
        id TEXT PRIMARY KEY, \
        title TEXT NOT NULL, \
        kind TEXT NOT NULL, \
        created_at TEXT NOT NULL, \
        updated_at TEXT NOT NULL, \
        archived INTEGER NOT NULL DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS idx_assistant_conversations_updated \
        ON assistant_conversations(updated_at)",
    "CREATE TABLE IF NOT EXISTS assistant_messages (\
        id TEXT PRIMARY KEY, \
        conversation_id TEXT NOT NULL, \
        seq INTEGER NOT NULL, \
        role TEXT NOT NULL, \
        content_enc TEXT NOT NULL, \
        meta_json TEXT NOT NULL DEFAULT '{}', \
        created_at TEXT NOT NULL, \
        UNIQUE(conversation_id, seq))",
    "CREATE INDEX IF NOT EXISTS idx_assistant_messages_conv \
        ON assistant_messages(conversation_id, seq)",
    "CREATE TABLE IF NOT EXISTS assistant_memory_facts (\
        id TEXT PRIMARY KEY, \
        scope TEXT NOT NULL, \
        scope_ref TEXT, \
        key TEXT NOT NULL, \
        value_enc TEXT NOT NULL, \
        source_conversation_id TEXT, \
        source_message_id TEXT, \
        status TEXT NOT NULL, \
        created_at TEXT NOT NULL, \
        updated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_assistant_memory_scope \
        ON assistant_memory_facts(scope, status)",
    "CREATE TABLE IF NOT EXISTS assistant_providers (\
        id TEXT PRIMARY KEY, \
        name TEXT NOT NULL, \
        api_style TEXT NOT NULL, \
        base_url TEXT NOT NULL, \
        model TEXT NOT NULL, \
        extra_json TEXT NOT NULL DEFAULT '{}', \
        is_default INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS assistant_settings (\
        key TEXT PRIMARY KEY, \
        value_json TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS assistant_vault_meta (\
        id INTEGER PRIMARY KEY CHECK (id = 1), \
        kdf TEXT NOT NULL, \
        salt TEXT NOT NULL, \
        params_json TEXT NOT NULL, \
        verifier_enc TEXT NOT NULL, \
        created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS assistant_audit (\
        id TEXT PRIMARY KEY, \
        ts TEXT NOT NULL, \
        tool_id TEXT NOT NULL, \
        app_id TEXT, \
        command TEXT NOT NULL, \
        risk TEXT NOT NULL, \
        decision TEXT NOT NULL, \
        args_digest TEXT, \
        result_digest TEXT, \
        user_visible INTEGER NOT NULL DEFAULT 1)",
    "CREATE INDEX IF NOT EXISTS idx_assistant_audit_ts ON assistant_audit(ts)",
    // 票 08：保险库密钥槽（provider API key 等；value_enc 为 AEAD 密文 hex，
    // key = `provider:<providerId>`，spec §5.8）
    "CREATE TABLE IF NOT EXISTS assistant_secrets (\
        key TEXT PRIMARY KEY, \
        value_enc TEXT NOT NULL, \
        nonce TEXT NOT NULL, \
        updated_at TEXT NOT NULL)",
];

// ==================== 模型 ====================

/// 会话（`kind = companion | task`）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
}

/// 消息（`content_enc` 为 AEAD 密文 hex；明文解密归调用方）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub seq: i64,
    pub role: String,
    pub content_enc: String,
    pub meta_json: String,
    pub created_at: String,
}

/// 记忆事实（`value_enc` 为 AEAD 密文 hex；`status = pending | confirmed | rejected`）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryFact {
    pub id: String,
    pub scope: String,
    pub scope_ref: Option<String>,
    pub key: String,
    pub value_enc: String,
    pub source_conversation_id: Option<String>,
    pub source_message_id: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 模型供应商（**不存密钥**；密钥在保险库）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_style: String,
    pub base_url: String,
    pub model: String,
    pub extra_json: String,
    pub is_default: bool,
}

/// 审计条目（不存参数 / 结果原文，只存摘要）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub ts: String,
    pub tool_id: String,
    pub app_id: Option<String>,
    pub command: String,
    pub risk: String,
    pub decision: String,
    pub args_digest: Option<String>,
    pub result_digest: Option<String>,
    pub user_visible: bool,
}

/// 保险库密钥槽（`value_enc` 为 AEAD 密文 hex；密钥明文不落库）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Secret {
    /// 密钥名（如 `provider:<id>`，spec §5.8）
    pub key: String,
    pub value_enc: String,
    pub nonce: String,
    pub updated_at: String,
}

// ==================== 端口（行语义） ====================

/// 数据底座端口：建表 / 迁移 + 各表 CRUD + 导出 / 清空 / 重加密
///
/// 部分方法（get_conversation / get_provider / clear_memory_scope / record_audit）
/// 为票 08–14 预留，票 07 阶段命令层尚未调用，故按 API 面保留。
#[allow(dead_code)]
pub trait Store {
    /// 建表 + 迁移（幂等；迁移失败显性报错）
    fn ensure_schema(&self) -> Result<(), String>;
    /// 当前 schema 版本
    fn schema_version(&self) -> Result<i32, String>;

    // ---- 保险库元数据 ----
    fn vault_meta(&self) -> Result<Option<VaultMeta>, String>;
    fn put_vault_meta(&self, meta: &VaultMeta) -> Result<(), String>;

    // ---- 会话 ----
    fn list_conversations(&self) -> Result<Vec<Conversation>, String>;
    fn get_conversation(&self, id: &str) -> Result<Option<Conversation>, String>;
    fn create_conversation(&self, c: &Conversation) -> Result<(), String>;
    fn rename_conversation(&self, id: &str, title: &str) -> Result<(), String>;
    fn archive_conversation(&self, id: &str, archived: bool) -> Result<(), String>;
    fn touch_conversation(&self, id: &str, at: &str) -> Result<(), String>;

    // ---- 消息 ----
    fn append_message(&self, m: &Message) -> Result<(), String>;
    /// 最近 N 条（按 seq 倒序取，返回正序）
    fn list_messages(&self, conversation_id: &str, limit: i64) -> Result<Vec<Message>, String>;

    // ---- 记忆 ----
    /// 按 scope / status 过滤（空串 = 不过滤）
    fn list_memory(&self, scope: &str, status: &str) -> Result<Vec<MemoryFact>, String>;
    fn upsert_memory(&self, f: &MemoryFact) -> Result<(), String>;
    fn delete_memory(&self, id: &str) -> Result<bool, String>;
    /// 清空指定 scope 的全部记忆（forget 的 scope 级清空）
    fn clear_memory_scope(&self, scope: &str) -> Result<u64, String>;

    // ---- 供应商 ----
    fn list_providers(&self) -> Result<Vec<Provider>, String>;
    fn get_provider(&self, id: &str) -> Result<Option<Provider>, String>;
    fn upsert_provider(&self, p: &Provider) -> Result<(), String>;
    fn set_default_provider(&self, id: &str) -> Result<(), String>;
    fn delete_provider(&self, id: &str) -> Result<bool, String>;

    // ---- 设置 ----
    fn get_setting(&self, key: &str) -> Result<Option<String>, String>;
    fn set_setting(&self, key: &str, value_json: &str) -> Result<(), String>;

    // ---- 审计 ----
    fn record_audit(&self, a: &AuditEntry) -> Result<(), String>;
    fn list_audit(&self, limit: i64) -> Result<Vec<AuditEntry>, String>;

    // ---- 保险库密钥槽（票 08） ----
    fn put_secret(&self, s: &Secret) -> Result<(), String>;
    fn get_secret(&self, key: &str) -> Result<Option<Secret>, String>;
    fn delete_secret(&self, key: &str) -> Result<bool, String>;
    fn list_secret_keys(&self) -> Result<Vec<String>, String>;

    // ---- 导出 / 清空 ----
    /// 导出 JSON（会话 + 已确认记忆明文由调用方先解密后传入；密钥不导出）
    fn export_all(&self, conversations: &[Conversation], memory: &[MemoryFact], audit: &[AuditEntry])
        -> Result<serde_json::Value, String>;
    /// 清空全部业务表（保险库元数据保留；vacuum 视宿主能力）
    fn clear_all(&self) -> Result<(), String>;

    // ---- 改密重加密 ----
    /// 用新密钥重加密全部内容密文（复用原 nonce；单事务）
    fn reencrypt_all(&self, old_key: &[u8; 32], new_key: &[u8; 32]) -> Result<(), String>;
}

// ==================== 纯映射（native 可测） ====================

fn row_str<'a>(row: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    row.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("行缺列 {key}: {row}"))
}

fn row_opt_str(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn row_bool(row: &serde_json::Value, key: &str) -> bool {
    row.get(key).and_then(|v| v.as_i64()).unwrap_or(0) != 0
}

fn row_to_conversation(row: &serde_json::Value) -> Result<Conversation, String> {
    Ok(Conversation {
        id: row_str(row, "id")?.to_string(),
        title: row_str(row, "title")?.to_string(),
        kind: row_str(row, "kind")?.to_string(),
        created_at: row_str(row, "created_at")?.to_string(),
        updated_at: row_str(row, "updated_at")?.to_string(),
        archived: row_bool(row, "archived"),
    })
}

fn row_to_message(row: &serde_json::Value) -> Result<Message, String> {
    Ok(Message {
        id: row_str(row, "id")?.to_string(),
        conversation_id: row_str(row, "conversation_id")?.to_string(),
        seq: row.get("seq").and_then(|v| v.as_i64()).unwrap_or(0),
        role: row_str(row, "role")?.to_string(),
        content_enc: row_str(row, "content_enc")?.to_string(),
        meta_json: row_str(row, "meta_json")?.to_string(),
        created_at: row_str(row, "created_at")?.to_string(),
    })
}

fn row_to_memory(row: &serde_json::Value) -> Result<MemoryFact, String> {
    Ok(MemoryFact {
        id: row_str(row, "id")?.to_string(),
        scope: row_str(row, "scope")?.to_string(),
        scope_ref: row_opt_str(row, "scope_ref"),
        key: row_str(row, "key")?.to_string(),
        value_enc: row_str(row, "value_enc")?.to_string(),
        source_conversation_id: row_opt_str(row, "source_conversation_id"),
        source_message_id: row_opt_str(row, "source_message_id"),
        status: row_str(row, "status")?.to_string(),
        created_at: row_str(row, "created_at")?.to_string(),
        updated_at: row_str(row, "updated_at")?.to_string(),
    })
}

fn row_to_provider(row: &serde_json::Value) -> Result<Provider, String> {
    Ok(Provider {
        id: row_str(row, "id")?.to_string(),
        name: row_str(row, "name")?.to_string(),
        api_style: row_str(row, "api_style")?.to_string(),
        base_url: row_str(row, "base_url")?.to_string(),
        model: row_str(row, "model")?.to_string(),
        extra_json: row_str(row, "extra_json")?.to_string(),
        is_default: row_bool(row, "is_default"),
    })
}

fn row_to_audit(row: &serde_json::Value) -> Result<AuditEntry, String> {
    Ok(AuditEntry {
        id: row_str(row, "id")?.to_string(),
        ts: row_str(row, "ts")?.to_string(),
        tool_id: row_str(row, "tool_id")?.to_string(),
        app_id: row_opt_str(row, "app_id"),
        command: row_str(row, "command")?.to_string(),
        risk: row_str(row, "risk")?.to_string(),
        decision: row_str(row, "decision")?.to_string(),
        args_digest: row_opt_str(row, "args_digest"),
        result_digest: row_opt_str(row, "result_digest"),
        user_visible: row_bool(row, "user_visible"),
    })
}

fn map_rows<T, F>(rows: Option<serde_json::Value>, map: F) -> Result<Vec<T>, String>
where
    F: Fn(&serde_json::Value) -> Result<T, String>,
{
    let rows = rows.unwrap_or_else(|| serde_json::json!([]));
    let array = rows
        .as_array()
        .ok_or_else(|| format!("查询结果不是数组: {rows}"))?
        .clone();
    array.iter().map(map).collect()
}

// ==================== wasm 实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    impl Store for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            // 1. 建表（幂等）
            for stmt in SCHEMA {
                self.plugin_db_execute(stmt)
                    .map_err(|e| format!("建表失败: {e}"))?;
            }
            // 2. 迁移：schema_version 缺行或低于当前版本 → 顺序补齐后登记
            // v1 = 初始 schema；v2 = 新增 assistant_secrets 表（票 08，
            // 建表在上方幂等执行，此处仅登记版本）
            self.plugin_db_execute("DELETE FROM schema_version")
                .map_err(|e| format!("迁移清理失败: {e}"))?;
            self.plugin_db_execute("INSERT INTO schema_version(version) VALUES (2)")
                .map_err(|e| format!("迁移登记失败: {e}"))?;
            Ok(())
        }

        fn schema_version(&self) -> Result<i32, String> {
            let rows = self
                .plugin_db_query("SELECT version FROM schema_version")
                .map_err(|e| format!("读 schema_version 失败: {e}"))?;
            match rows {
                Some(v) => v
                    .as_array()
                    .and_then(|a| a.first())
                    .and_then(|r| r.get("version"))
                    .and_then(|x| x.as_i64())
                    .map(|x| x as i32)
                    .ok_or_else(|| "schema_version 行缺 version 列".to_string()),
                None => Ok(0),
            }
        }

        fn vault_meta(&self) -> Result<Option<VaultMeta>, String> {
            let rows = self
                .plugin_db_query("SELECT kdf, salt, params_json, verifier_enc, created_at \
                    FROM assistant_vault_meta WHERE id = 1")
                .map_err(|e| format!("读保险库元数据失败: {e}"))?;
            match rows {
                Some(v) => {
                    let arr = v.as_array().ok_or("保险库元数据查询结果非数组")?;
                    if arr.is_empty() {
                        return Ok(None);
                    }
                    let r = &arr[0];
                    Ok(Some(VaultMeta {
                        kdf: row_str(r, "kdf")?.to_string(),
                        salt_hex: row_str(r, "salt")?.to_string(),
                        params_json: row_str(r, "params_json")?.to_string(),
                        verifier_enc_hex: row_str(r, "verifier_enc")?.to_string(),
                        created_at: row_str(r, "created_at")?.to_string(),
                    }))
                }
                None => Ok(None),
            }
        }

        fn put_vault_meta(&self, meta: &VaultMeta) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_vault_meta \
                    (id, kdf, salt, params_json, verifier_enc, created_at) \
                    VALUES (1, ?1, ?2, ?3, ?4, ?5)",
                &sql_params![meta.kdf, meta.salt_hex, meta.params_json, meta.verifier_enc_hex, meta.created_at],
            )
            .map_err(|e| format!("写保险库元数据失败: {e}"))?;
            Ok(())
        }

        fn list_conversations(&self) -> Result<Vec<Conversation>, String> {
            let rows = self
                .plugin_db_query("SELECT * FROM assistant_conversations ORDER BY updated_at DESC")
                .map_err(|e| format!("列会话失败: {e}"))?;
            map_rows(rows, row_to_conversation)
        }

        fn get_conversation(&self, id: &str) -> Result<Option<Conversation>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM assistant_conversations WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("取会话失败: {e}"))?;
            match rows {
                Some(v) => {
                    let arr = v.as_array().ok_or("会话查询结果非数组")?;
                    if arr.is_empty() {
                        Ok(None)
                    } else {
                        row_to_conversation(&arr[0]).map(Some)
                    }
                }
                None => Ok(None),
            }
        }

        fn create_conversation(&self, c: &Conversation) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_conversations \
                    (id, title, kind, created_at, updated_at, archived) \
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                &sql_params![c.id, c.title, c.kind, c.created_at, c.updated_at, c.archived as i64],
            )
            .map_err(|e| format!("建会话失败: {e}"))?;
            Ok(())
        }

        fn rename_conversation(&self, id: &str, title: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "UPDATE assistant_conversations SET title = ?1 WHERE id = ?2",
                &sql_params![title, id],
            )
            .map_err(|e| format!("改会话名失败: {e}"))?;
            Ok(())
        }

        fn archive_conversation(&self, id: &str, archived: bool) -> Result<(), String> {
            self.plugin_db_execute_params(
                "UPDATE assistant_conversations SET archived = ?1 WHERE id = ?2",
                &sql_params![archived as i64, id],
            )
            .map_err(|e| format!("归档会话失败: {e}"))?;
            Ok(())
        }

        fn touch_conversation(&self, id: &str, at: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "UPDATE assistant_conversations SET updated_at = ?1 WHERE id = ?2",
                &sql_params![at, id],
            )
            .map_err(|e| format!("刷新会话时间失败: {e}"))?;
            Ok(())
        }

        fn append_message(&self, m: &Message) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_messages \
                    (id, conversation_id, seq, role, content_enc, meta_json, created_at) \
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                &sql_params![m.id, m.conversation_id, m.seq, m.role, m.content_enc, m.meta_json, m.created_at],
            )
            .map_err(|e| format!("写消息失败: {e}"))?;
            Ok(())
        }

        fn list_messages(&self, conversation_id: &str, limit: i64) -> Result<Vec<Message>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM assistant_messages WHERE conversation_id = ?1 \
                    ORDER BY seq DESC LIMIT ?2",
                    &sql_params![conversation_id, limit],
                )
                .map_err(|e| format!("取消息失败: {e}"))?;
            let mut msgs = map_rows(rows, row_to_message)?;
            msgs.reverse();
            Ok(msgs)
        }

        fn list_memory(&self, scope: &str, status: &str) -> Result<Vec<MemoryFact>, String> {
            // scope / status 均为受控枚举值；条件按需拼接，参数按序绑定（`?` 占位）
            let mut sql = String::from("SELECT * FROM assistant_memory_facts WHERE 1=1");
            let mut params: Vec<serde_json::Value> = vec![];
            if !scope.is_empty() {
                sql.push_str(" AND scope = ?");
                params.push(serde_json::Value::String(scope.to_string()));
            }
            if !status.is_empty() {
                sql.push_str(" AND status = ?");
                params.push(serde_json::Value::String(status.to_string()));
            }
            sql.push_str(" ORDER BY updated_at DESC");
            let rows = self
                .plugin_db_query_params(&sql, &params)
                .map_err(|e| format!("取记忆失败: {e}"))?;
            map_rows(rows, row_to_memory)
        }

        fn upsert_memory(&self, f: &MemoryFact) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_memory_facts \
                    (id, scope, scope_ref, key, value_enc, source_conversation_id, \
                    source_message_id, status, created_at, updated_at) \
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                &sql_params![
                    f.id, f.scope, f.scope_ref, f.key, f.value_enc,
                    f.source_conversation_id, f.source_message_id, f.status, f.created_at, f.updated_at
                ],
            )
            .map_err(|e| format!("写记忆失败: {e}"))?;
            Ok(())
        }

        fn delete_memory(&self, id: &str) -> Result<bool, String> {
            let n = self
                .plugin_db_execute_params(
                    "DELETE FROM assistant_memory_facts WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("删记忆失败: {e}"))?;
            Ok(n > 0)
        }

        fn clear_memory_scope(&self, scope: &str) -> Result<u64, String> {
            let n = self
                .plugin_db_execute_params(
                    "DELETE FROM assistant_memory_facts WHERE scope = ?1",
                    &sql_params![scope],
                )
                .map_err(|e| format!("清空记忆 scope 失败: {e}"))?;
            Ok(n as u64)
        }

        fn list_providers(&self) -> Result<Vec<Provider>, String> {
            let rows = self
                .plugin_db_query("SELECT * FROM assistant_providers ORDER BY is_default DESC, name")
                .map_err(|e| format!("列供应商失败: {e}"))?;
            map_rows(rows, row_to_provider)
        }

        fn get_provider(&self, id: &str) -> Result<Option<Provider>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM assistant_providers WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("取供应商失败: {e}"))?;
            match rows {
                Some(v) => {
                    let arr = v.as_array().ok_or("供应商查询结果非数组")?;
                    if arr.is_empty() {
                        Ok(None)
                    } else {
                        row_to_provider(&arr[0]).map(Some)
                    }
                }
                None => Ok(None),
            }
        }

        fn upsert_provider(&self, p: &Provider) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_providers \
                    (id, name, api_style, base_url, model, extra_json, is_default) \
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                &sql_params![p.id, p.name, p.api_style, p.base_url, p.model, p.extra_json, p.is_default as i64],
            )
            .map_err(|e| format!("写供应商失败: {e}"))?;
            Ok(())
        }

        fn set_default_provider(&self, id: &str) -> Result<(), String> {
            // 单事务：清旧默认 + 设新默认
            let sqls = vec![
                "UPDATE assistant_providers SET is_default = 0".to_string(),
                format!("UPDATE assistant_providers SET is_default = 1 WHERE id = '{}'", id),
            ];
            self.plugin_db_execute_batch(&sqls)
                .map_err(|e| format!("设默认供应商失败: {e}"))?;
            Ok(())
        }

        fn delete_provider(&self, id: &str) -> Result<bool, String> {
            let n = self
                .plugin_db_execute_params(
                    "DELETE FROM assistant_providers WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("删供应商失败: {e}"))?;
            Ok(n > 0)
        }

        fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT value_json FROM assistant_settings WHERE key = ?1",
                    &sql_params![key],
                )
                .map_err(|e| format!("读设置失败: {e}"))?;
            match rows {
                Some(v) => {
                    let arr = v.as_array().ok_or("设置查询结果非数组")?;
                    if arr.is_empty() {
                        Ok(None)
                    } else {
                        row_str(&arr[0], "value_json").map(|s| Some(s.to_string()))
                    }
                }
                None => Ok(None),
            }
        }

        fn set_setting(&self, key: &str, value_json: &str) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_settings(key, value_json) VALUES (?1, ?2)",
                &sql_params![key, value_json],
            )
            .map_err(|e| format!("写设置失败: {e}"))?;
            Ok(())
        }

        fn record_audit(&self, a: &AuditEntry) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_audit \
                    (id, ts, tool_id, app_id, command, risk, decision, args_digest, \
                    result_digest, user_visible) \
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                &sql_params![
                    a.id, a.ts, a.tool_id, a.app_id, a.command, a.risk, a.decision,
                    a.args_digest, a.result_digest, a.user_visible as i64
                ],
            )
            .map_err(|e| format!("写审计失败: {e}"))?;
            Ok(())
        }

        fn list_audit(&self, limit: i64) -> Result<Vec<AuditEntry>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM assistant_audit ORDER BY ts DESC LIMIT ?1",
                    &sql_params![limit],
                )
                .map_err(|e| format!("取审计失败: {e}"))?;
            map_rows(rows, row_to_audit)
        }

        fn put_secret(&self, s: &Secret) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT OR REPLACE INTO assistant_secrets(key, value_enc, nonce, updated_at) \
                    VALUES (?1, ?2, ?3, ?4)",
                &sql_params![s.key, s.value_enc, s.nonce, s.updated_at],
            )
            .map_err(|e| format!("写密钥槽失败: {e}"))?;
            Ok(())
        }

        fn get_secret(&self, key: &str) -> Result<Option<Secret>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM assistant_secrets WHERE key = ?1",
                    &sql_params![key],
                )
                .map_err(|e| format!("取密钥槽失败: {e}"))?;
            match rows {
                Some(v) => {
                    let arr = v.as_array().ok_or("密钥槽查询结果非数组")?;
                    if arr.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(Secret {
                            key: row_str(&arr[0], "key")?.to_string(),
                            value_enc: row_str(&arr[0], "value_enc")?.to_string(),
                            nonce: row_str(&arr[0], "nonce")?.to_string(),
                            updated_at: row_str(&arr[0], "updated_at")?.to_string(),
                        }))
                    }
                }
                None => Ok(None),
            }
        }

        fn delete_secret(&self, key: &str) -> Result<bool, String> {
            let n = self
                .plugin_db_execute_params(
                    "DELETE FROM assistant_secrets WHERE key = ?1",
                    &sql_params![key],
                )
                .map_err(|e| format!("删密钥槽失败: {e}"))?;
            Ok(n > 0)
        }

        fn list_secret_keys(&self) -> Result<Vec<String>, String> {
            let rows = self
                .plugin_db_query("SELECT key FROM assistant_secrets ORDER BY key")
                .map_err(|e| format!("列密钥槽失败: {e}"))?;
            let keys = map_rows(rows, |row| row_str(row, "key").map(|s| s.to_string()))?;
            Ok(keys)
        }

        fn export_all(
            &self,
            conversations: &[Conversation],
            memory: &[MemoryFact],
            audit: &[AuditEntry],
        ) -> Result<serde_json::Value, String> {
            // 导出不含密钥：会话 / 记忆 / 审计的明文由调用方先解密后传入，
            // 此处只做形状组装（密钥不在此路径）。导出时间由调用方给定。
            Ok(serde_json::json!({
                "schemaVersion": SCHEMA_VERSION,
                "conversations": conversations,
                "memory": memory,
                "audit": audit,
            }))
        }

        fn clear_all(&self) -> Result<(), String> {
            // 保险库元数据保留（口令 / salt / 校验值不动）；业务表全清。
            // 单事务批量执行。
            let sqls = vec![
                "DELETE FROM assistant_messages".to_string(),
                "DELETE FROM assistant_memory_facts".to_string(),
                "DELETE FROM assistant_conversations".to_string(),
                "DELETE FROM assistant_providers".to_string(),
                "DELETE FROM assistant_settings".to_string(),
                "DELETE FROM assistant_audit".to_string(),
                "DELETE FROM assistant_secrets".to_string(),
            ];
            self.plugin_db_execute_batch(&sqls)
                .map_err(|e| format!("清空数据失败: {e}"))?;
            Ok(())
        }

        fn reencrypt_all(&self, old_key: &[u8; 32], new_key: &[u8; 32]) -> Result<(), String> {
            use crate::vault;
            // 1. 消息正文
            let msg_rows = self
                .plugin_db_query("SELECT id, conversation_id, seq, content_enc FROM assistant_messages")
                .map_err(|e| format!("读消息密文失败: {e}"))?;
            let msg_arr = msg_rows
                .unwrap_or_else(|| serde_json::json!([]))
                .as_array()
                .cloned()
                .unwrap_or_default();
            for row in msg_arr {
                let id = row_str(&row, "id")?.to_string();
                let conv = row_str(&row, "conversation_id")?.to_string();
                let seq = row.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
                let enc = row_str(&row, "content_enc")?.to_string();
                let aad = vault::content_aad("message", &format!("{conv}:{seq}"));
                let pt = vault::decrypt(old_key, &enc, &aad)?;
                // 复用原 nonce（blob 前 24 字节）换新密钥重加密
                let new_enc = reencrypt_blob(new_key, &enc, &pt, &aad)?;
                self.plugin_db_execute_params(
                    "UPDATE assistant_messages SET content_enc = ?1 WHERE id = ?2",
                    &sql_params![new_enc, id],
                )
                .map_err(|e| format!("重加密消息失败: {e}"))?;
            }
            // 2. 记忆值
            let mem_rows = self
                .plugin_db_query("SELECT id, value_enc FROM assistant_memory_facts")
                .map_err(|e| format!("读记忆密文失败: {e}"))?;
            let mem_arr = mem_rows
                .unwrap_or_else(|| serde_json::json!([]))
                .as_array()
                .cloned()
                .unwrap_or_default();
            for row in mem_arr {
                let id = row_str(&row, "id")?.to_string();
                let enc = row_str(&row, "value_enc")?.to_string();
                let aad = vault::content_aad("memory", &id);
                let pt = vault::decrypt(old_key, &enc, &aad)?;
                let new_enc = reencrypt_blob(new_key, &enc, &pt, &aad)?;
                self.plugin_db_execute_params(
                    "UPDATE assistant_memory_facts SET value_enc = ?1 WHERE id = ?2",
                    &sql_params![new_enc, id],
                )
                .map_err(|e| format!("重加密记忆失败: {e}"))?;
            }
            // 3. 密钥槽（票 08）
            let sec_rows = self
                .plugin_db_query("SELECT key, value_enc FROM assistant_secrets")
                .map_err(|e| format!("读密钥槽密文失败: {e}"))?;
            let sec_arr = sec_rows
                .unwrap_or_else(|| serde_json::json!([]))
                .as_array()
                .cloned()
                .unwrap_or_default();
            for row in sec_arr {
                let key = row_str(&row, "key")?.to_string();
                let enc = row_str(&row, "value_enc")?.to_string();
                let aad = vault::content_aad("secret", &key);
                let pt = vault::decrypt(old_key, &enc, &aad)?;
                let new_enc = reencrypt_blob(new_key, &enc, &pt, &aad)?;
                self.plugin_db_execute_params(
                    "UPDATE assistant_secrets SET value_enc = ?1 WHERE key = ?2",
                    &sql_params![new_enc, key],
                )
                .map_err(|e| format!("重加密密钥槽失败: {e}"))?;
            }
            Ok(())
        }
    }

    /// 复用原 nonce（blob 前 24 字节）换新密钥重加密
    fn reencrypt_blob(
        new_key: &[u8; 32],
        old_blob_hex: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<String, String> {
        use crate::vault;
        let old_blob = hex::decode(old_blob_hex).map_err(|e| format!("旧密文非 hex: {e}"))?;
        let nonce_hex = hex::encode(&old_blob[..vault::NONCE_LEN]);
        vault::encrypt(new_key, &nonce_hex, plaintext, aad)
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod native_stub {
    //! native 单测不链接 wasm 宿主：Store 的 wasm 实现不编译，
    //! 纯映射与 schema 校验由 `super::tests` 覆盖。
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_statements_are_non_empty_and_prefixed() {
        assert!(!SCHEMA.is_empty());
        for stmt in SCHEMA {
            assert!(
                stmt.contains("CREATE TABLE IF NOT EXISTS") || stmt.contains("CREATE INDEX IF NOT EXISTS"),
                "schema 语句须为幂等建表/建索引: {stmt}"
            );
        }
        // 敏感表名统一前缀
        for name in [
            "assistant_conversations",
            "assistant_messages",
            "assistant_memory_facts",
            "assistant_providers",
            "assistant_settings",
            "assistant_vault_meta",
            "assistant_audit",
            "assistant_secrets",
        ] {
            assert!(
                SCHEMA.iter().any(|s| s.contains(name)),
                "缺表 {name}"
            );
        }
    }

    #[test]
    fn row_mapping_roundtrip_shapes() {
        let conv = serde_json::json!({
            "id": "c1", "title": "t", "kind": "companion",
            "created_at": "a", "updated_at": "b", "archived": 1
        });
        let c = row_to_conversation(&conv).unwrap();
        assert_eq!(c.id, "c1");
        assert!(c.archived);

        let msg = serde_json::json!({
            "id": "m1", "conversation_id": "c1", "seq": 3, "role": "user",
            "content_enc": "hex", "meta_json": "{}", "created_at": "t"
        });
        let m = row_to_message(&msg).unwrap();
        assert_eq!(m.seq, 3);
        assert_eq!(m.role, "user");

        let mem = serde_json::json!({
            "id": "f1", "scope": "global", "scope_ref": null, "key": "k",
            "value_enc": "hex", "source_conversation_id": null, "source_message_id": null,
            "status": "confirmed", "created_at": "a", "updated_at": "b"
        });
        let f = row_to_memory(&mem).unwrap();
        assert_eq!(f.scope, "global");
        assert_eq!(f.status, "confirmed");
        assert!(f.scope_ref.is_none());

        let p = serde_json::json!({
            "id": "p1", "name": "n", "api_style": "openai", "base_url": "u",
            "model": "m", "extra_json": "{}", "is_default": 1
        });
        let pr = row_to_provider(&p).unwrap();
        assert!(pr.is_default);

        let a = serde_json::json!({
            "id": "a1", "ts": "t", "tool_id": "memory.remember", "app_id": null,
            "command": "x", "risk": "write", "decision": "allowed",
            "args_digest": "d", "result_digest": null, "user_visible": 1
        });
        let au = row_to_audit(&a).unwrap();
        assert_eq!(au.tool_id, "memory.remember");
        assert!(au.user_visible);
    }

    #[test]
    fn rows_helper_handles_empty_and_non_array() {
        assert!(map_rows::<Conversation, _>(None, row_to_conversation).unwrap().is_empty());
        assert!(map_rows::<Conversation, _>(Some(serde_json::json!("not-array")), row_to_conversation).is_err());
    }
}
