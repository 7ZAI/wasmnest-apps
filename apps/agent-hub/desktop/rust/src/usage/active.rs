//! 正在使用的项目会话（最新会话回退 + 适配器策略钩子）
//!
//! 默认取每个适配器已入库的最新会话（started_at 最大）；适配器可声明
//! `active_session` 策略钩子覆盖它（当前 claude 读 `~/.claude.json` 的
//! lastStartTime 最大项目，比文件 mtime 权威；未授权/损坏时回退最新会话）。
//! 列表接口按 (adapter, cli_session_id) 命中注入 `active: true`。

use crate::agents;
use serde_json::{json, Value};
use wasmnest_plugin_api::host::HostPluginDatabase;
use wasmnest_plugin_api::sql_params;
use wasmnest_plugin_api::wasm_host::WasmHost;

// ==================== 正在使用的项目会话（策略钩子 + 最新回退） ====================

/// 正在使用的项目会话（键=适配器 → { project, session_id }，无则 null）：
/// 默认取各自最新会话（started_at 最大）兜底；适配器声明了 `active_session`
/// 策略钩子时优先采用（claude 读 `~/.claude.json`，其余无钩子）。
pub(super) fn compute_active_sessions(h: &WasmHost) -> Value {
    let mut active = serde_json::Map::new();
    for agent in agents::all().iter().copied() {
        let adapter = agent.id();
        // 回退：该适配器已入库的最新会话
        let mut entry = h
            .plugin_db_query_params(
                "SELECT project, cli_session_id FROM usage_session \
                 WHERE adapter = ?1 ORDER BY started_at DESC, id DESC LIMIT 1",
                &sql_params![adapter],
            )
            .ok()
            .flatten()
            .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
            .and_then(|row| {
                let project = row
                    .get("project")
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());
                row.get("cli_session_id")
                    .and_then(|c| c.as_str())
                    .map(|sid| json!({ "project": project, "session_id": sid.to_string() }))
            })
            .unwrap_or(Value::Null);
        if let Some((project, sid)) = agent
            .usage()
            .and_then(|s| s.active_session)
            .and_then(|policy| policy(h))
        {
            entry = json!({ "project": project, "session_id": sid });
        }
        active.insert(adapter.to_string(), entry);
    }
    Value::Object(active)
}

/// 列表行注入 active 标记（纯函数，可测）：命中 `activeSessions[adapter]
/// .session_id` 的行置 `active: true`；无标记/不匹配保持原样。
pub(super) fn mark_active_rows(rows: &mut Value, active: &Value) {
    let Some(arr) = rows.as_array_mut() else {
        return;
    };
    for row in arr.iter_mut() {
        let adapter = row.get("adapter").and_then(|v| v.as_str()).unwrap_or("");
        let sid = row
            .get("cli_session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if adapter.is_empty() || sid.is_empty() {
            continue;
        }
        let hit = active
            .get(adapter)
            .and_then(|e| e.as_object())
            .and_then(|e| e.get("session_id"))
            .and_then(|v| v.as_str())
            .map(|a| a == sid)
            .unwrap_or(false);
        if hit {
            row["active"] = json!(true);
        }
    }
}

// ==================== Tests（纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::*;

    /// 列表注入 active 标记：按 (adapter, cli_session_id) 命中；不匹配行不动
    #[test]
    fn mark_active_rows_by_adapter_session() {
        let mut rows = json!([
            { "adapter": "claude", "cli_session_id": "s-1", "title": "a" },
            { "adapter": "claude", "cli_session_id": "s-2", "title": "b" },
            { "adapter": "pi", "cli_session_id": "s-1", "title": "c" },
            { "adapter": "custom", "cli_session_id": "s-9", "title": "d" },
        ]);
        let active = json!({
            "claude": { "project": "/home/u/new", "session_id": "s-2" },
            "pi": null,
        });
        mark_active_rows(&mut rows, &active);
        let arr = rows.as_array().expect("array");
        // 命中标记仅限同适配器同会话 id（claude/s-1 不标记；pi 条目为 null 不标记）
        assert!(arr[0].get("active").is_none());
        assert_eq!(arr[1]["active"], json!(true));
        assert!(arr[2].get("active").is_none());
        assert!(arr[3].get("active").is_none());
        // 空 activeSessions → 无标记
        let mut rows2 = json!([{ "adapter": "claude", "cli_session_id": "s-2" }]);
        mark_active_rows(&mut rows2, &json!({}));
        assert!(rows2[0].get("active").is_none());
    }
}
