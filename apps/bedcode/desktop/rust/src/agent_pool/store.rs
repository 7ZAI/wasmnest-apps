//! Agent 池私有库端口（行语义；SQL 只存在于 wasm 实现）。
//!
//! 与 quick_actions / project 同模式：native 测试用 [`MemoryStore`]，wasm 走
//! `host-plugin-database`。表只有一张 `agent_profiles`，数组列存 JSON 文本。

use super::model::AgentProfile;

/// 建表语句（逐条执行——`plugin_db_execute` 是单语句版）
pub(crate) const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS agent_profiles (\
     id TEXT PRIMARY KEY, \
     name TEXT NOT NULL, \
     cli TEXT NOT NULL, \
     model TEXT, \
     thinking_level TEXT, \
     tags_json TEXT NOT NULL, \
     specialties_json TEXT NOT NULL, \
     description TEXT NOT NULL, \
     can_orchestrate INTEGER NOT NULL DEFAULT 0, \
     enabled INTEGER NOT NULL DEFAULT 1, \
     created_at TEXT NOT NULL, \
     updated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_agent_profiles_created ON agent_profiles(created_at)",
];

/// 池存储端口（排序 / 唯一性归调用方）
pub(crate) trait AgentPoolStore {
    fn ensure_schema(&self) -> Result<(), String>;
    fn list(&self) -> Result<Vec<AgentProfile>, String>;
    fn get(&self, id: &str) -> Result<Option<AgentProfile>, String>;
    fn put(&self, profile: &AgentProfile) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<bool, String>;
}

// ==================== native：内存实现 ====================

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
pub(crate) struct MemoryStore {
    profiles: std::sync::Mutex<Vec<AgentProfile>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl MemoryStore {
    pub(crate) fn new() -> Self {
        Self::default()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl AgentPoolStore for MemoryStore {
    fn ensure_schema(&self) -> Result<(), String> {
        Ok(())
    }

    fn list(&self) -> Result<Vec<AgentProfile>, String> {
        let profiles = self
            .profiles
            .lock()
            .map_err(|e| format!("memory store lock poisoned: {e}"))?;
        let mut out = profiles.clone();
        out.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.name.cmp(&b.name)));
        Ok(out)
    }

    fn get(&self, id: &str) -> Result<Option<AgentProfile>, String> {
        let profiles = self
            .profiles
            .lock()
            .map_err(|e| format!("memory store lock poisoned: {e}"))?;
        Ok(profiles.iter().find(|profile| profile.id == id).cloned())
    }

    fn put(&self, profile: &AgentProfile) -> Result<(), String> {
        let mut profiles = self
            .profiles
            .lock()
            .map_err(|e| format!("memory store lock poisoned: {e}"))?;
        match profiles.iter_mut().find(|existing| existing.id == profile.id) {
            Some(existing) => *existing = profile.clone(),
            None => profiles.push(profile.clone()),
        }
        Ok(())
    }

    fn delete(&self, id: &str) -> Result<bool, String> {
        let mut profiles = self
            .profiles
            .lock()
            .map_err(|e| format!("memory store lock poisoned: {e}"))?;
        let before = profiles.len();
        profiles.retain(|profile| profile.id != id);
        Ok(profiles.len() != before)
    }
}

// ==================== wasm：插件私有库实现 ====================

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;
    use wasmnest_plugin_api::host::HostPluginDatabase;
    use wasmnest_plugin_api::sql_params;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    fn required_str(row: &serde_json::Value, key: &str) -> Result<String, String> {
        row.get(key)
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("agent_profiles row missing column '{key}': {row}"))
    }

    fn optional_str(row: &serde_json::Value, key: &str) -> Option<String> {
        row.get(key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn required_bool(row: &serde_json::Value, key: &str) -> Result<bool, String> {
        row.get(key)
            .and_then(|value| value.as_i64())
            .map(|value| value != 0)
            .ok_or_else(|| format!("agent_profiles row missing boolean '{key}': {row}"))
    }

    fn json_array(row: &serde_json::Value, key: &str) -> Result<Vec<String>, String> {
        let raw = required_str(row, key)?;
        serde_json::from_str(&raw).map_err(|e| format!("agent_profiles column '{key}' is not JSON: {e}"))
    }

    fn row_to_profile(row: &serde_json::Value) -> Result<AgentProfile, String> {
        Ok(AgentProfile {
            id: required_str(row, "id")?,
            name: required_str(row, "name")?,
            cli: required_str(row, "cli")?,
            model: optional_str(row, "model"),
            thinking_level: optional_str(row, "thinking_level"),
            tags: json_array(row, "tags_json")?,
            specialties: json_array(row, "specialties_json")?,
            description: required_str(row, "description")?,
            can_orchestrate: required_bool(row, "can_orchestrate")?,
            enabled: required_bool(row, "enabled")?,
            created_at: required_str(row, "created_at")?,
            updated_at: required_str(row, "updated_at")?,
        })
    }

    fn json_text(values: &[String]) -> Result<String, String> {
        serde_json::to_string(values).map_err(|e| format!("serialize agent profile list failed: {e}"))
    }

    impl AgentPoolStore for WasmHost {
        fn ensure_schema(&self) -> Result<(), String> {
            for statement in SCHEMA {
                self.plugin_db_execute(statement)
                    .map_err(|e| format!("agent_profiles schema failed: {}", e.message))?;
            }
            Ok(())
        }

        fn list(&self) -> Result<Vec<AgentProfile>, String> {
            let rows = self
                .plugin_db_query("SELECT * FROM agent_profiles ORDER BY created_at ASC, name ASC")
                .map_err(|e| format!("query agent_profiles failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            // 宿主返回非数组是形状故障，不是「池为空」：静默返回空清单会让
            // check_capacity 误判、把整批成员当成可覆盖（L5）。
            let rows = rows
                .as_array()
                .cloned()
                .ok_or_else(|| format!("agent_profiles query returned non-array: {rows}"))?;
            rows.iter().map(row_to_profile).collect()
        }

        fn get(&self, id: &str) -> Result<Option<AgentProfile>, String> {
            let rows = self
                .plugin_db_query_params(
                    "SELECT * FROM agent_profiles WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("query agent_profile failed: {}", e.message))?
                .unwrap_or_else(|| serde_json::json!([]));
            rows.as_array()
                .and_then(|rows| rows.first())
                .map(row_to_profile)
                .transpose()
        }

        fn put(&self, profile: &AgentProfile) -> Result<(), String> {
            self.plugin_db_execute_params(
                "INSERT INTO agent_profiles \
                 (id, name, cli, model, thinking_level, tags_json, specialties_json, \
                  description, can_orchestrate, enabled, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
                 ON CONFLICT(id) DO UPDATE SET \
                  name = excluded.name, cli = excluded.cli, model = excluded.model, \
                  thinking_level = excluded.thinking_level, \
                  tags_json = excluded.tags_json, \
                  specialties_json = excluded.specialties_json, \
                  description = excluded.description, \
                  can_orchestrate = excluded.can_orchestrate, enabled = excluded.enabled, \
                  updated_at = excluded.updated_at",
                &sql_params![
                    profile.id,
                    profile.name,
                    profile.cli,
                    profile.model,
                    profile.thinking_level,
                    json_text(&profile.tags)?,
                    json_text(&profile.specialties)?,
                    profile.description,
                    profile.can_orchestrate as i64,
                    profile.enabled as i64,
                    profile.created_at,
                    profile.updated_at,
                ],
            )
            .map_err(|e| format!("upsert agent_profile failed: {}", e.message))?;
            Ok(())
        }

        fn delete(&self, id: &str) -> Result<bool, String> {
            let affected = self
                .plugin_db_execute_params(
                    "DELETE FROM agent_profiles WHERE id = ?1",
                    &sql_params![id],
                )
                .map_err(|e| format!("delete agent_profile failed: {}", e.message))?;
            Ok(affected > 0)
        }
    }
}

