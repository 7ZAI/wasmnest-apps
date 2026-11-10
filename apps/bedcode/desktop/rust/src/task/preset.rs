//! 预设任务管理（一次性消耗）
//!
//! 预设任务是「无运行中会话 / 未选会话时创建的待投递任务」：
//! 创建时不绑定会话，加入某会话队列后即从预设中删除（one-shot 语义），
//! 删除由 `add-preset-to-queue` 原子完成（先删后插，单消费者）。
//!
//! 仅桌面端功能：事件只走 emit_event + bus 前端通道，不广播移动端
//! 同步通道（broadcast_sync），与 SyncEvent 线协议解耦。
//!
//! 生命周期：create → 存 task_preset → add-preset-to-queue 复制进
//! task_queue（source='queue'，预存入队后归为自动任务）并删除预设。

use serde_json::Value;
use wasmnest_plugin_api::constants::EVENT_TASK_PRESET_CHANGED;
use wasmnest_plugin_api::host::{HostBus, HostEvents, HostLog, HostPluginDatabase};
use wasmnest_plugin_api::sql_params;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 预设任务表建表 SQL（按语句拆分，宿主 plugin_db_execute 单语句执行）
pub const PRESET_TASKS_SCHEMA: &[&str] = &[
    r#"
CREATE TABLE IF NOT EXISTS task_preset (
    id         TEXT PRIMARY KEY,
    project_id TEXT,
    agent_id   TEXT,
    prompt     TEXT NOT NULL,
    created_at TEXT NOT NULL
)"#,
    "CREATE INDEX IF NOT EXISTS idx_task_preset_created ON task_preset(created_at)",
];

// ==================== Preset Operations ====================

/// 查询全部预设任务（创建时间倒序，最新在上）
pub fn list_presets(host: &WasmHost) -> Vec<Value> {
    host.plugin_db_query(
        "SELECT id, project_id, agent_id, prompt, created_at FROM task_preset \
         ORDER BY created_at DESC, id DESC",
    )
    .ok()
    .flatten()
    .and_then(|v| v.as_array().cloned())
    .unwrap_or_default()
}

/// 创建预设任务，返回 preset_id
///
/// `project_id` / `agent_id` 是任务的投递目标（可为空 = 未绑定，加入队列时再选）。
pub fn create_preset(host: &WasmHost, prompt: &str, project_id: &str, agent_id: &str) -> String {
    let id = new_id(host);
    let project_param = (!project_id.is_empty()).then_some(project_id);
    let agent_param = (!agent_id.is_empty()).then_some(agent_id);
    let _ = host.plugin_db_execute_params(
        "INSERT INTO task_preset (id, project_id, agent_id, prompt, created_at) \
         VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        &sql_params![id, project_param, agent_param, prompt],
    );

    host.log_info(&format!(
        "Preset task created: id={} prompt={:?}",
        id,
        prompt.chars().take(64).collect::<String>()
    ));

    id
}

/// 删除预设任务；返回是否实际删除（已被消耗/不存在时为 false）
pub fn delete_preset(host: &WasmHost, preset_id: &str) -> bool {
    let affected = host
        .plugin_db_execute_params(
            "DELETE FROM task_preset WHERE id = ?1",
            &sql_params![preset_id],
        )
        .unwrap_or(-1);

    if affected > 0 {
        host.log_info(&format!("Preset task deleted: id={}", preset_id));
        true
    } else {
        false
    }
}

/// 更新预设任务内容与目标；返回是否实际更新（不存在/已被消耗时为 false）
///
/// 目标字段用 `NULL` 表示「未绑定」（空串入参），不是「清空目标」以外的语义。
pub fn update_preset(
    host: &WasmHost,
    preset_id: &str,
    prompt: &str,
    project_id: &str,
    agent_id: &str,
) -> bool {
    let project_param = (!project_id.is_empty()).then_some(project_id);
    let agent_param = (!agent_id.is_empty()).then_some(agent_id);
    let affected = host
        .plugin_db_execute_params(
            "UPDATE task_preset SET prompt = ?1, project_id = ?2, agent_id = ?3 WHERE id = ?4",
            &sql_params![prompt, project_param, agent_param, preset_id],
        )
        .unwrap_or(-1);

    if affected > 0 {
        host.log_info(&format!("Preset task updated: id={}", preset_id));
        true
    } else {
        false
    }
}

/// 把预设任务加入指定会话队列（一次性消耗，原子语义）
///
/// 顺序保证单消费者：先删除预设（affected=1 才继续），再复制 prompt 进
/// task_queue 末尾（source='queue'）。并发场景下只有一个调用方成功删除，
/// 其余收到「已消耗」错误，不会重复入队。
///
/// 返回 (task_id, position)
/// `target` 为空时沿用预设自带的 `(project_id, agent_id)`；两者都为空则显性报错
/// （任务不知道往哪投递，不能静默丢）。`session_id` 非空时保留旧调用方的直接
/// 会话绑定（终端工具栏等运行内入口），否则按项目 + agent 解析活跃运行。
pub fn add_preset_to_queue(
    host: &WasmHost,
    preset_id: &str,
    project_id: &str,
    agent_id: &str,
    session_id: Option<&str>,
) -> Result<(String, i64, String), String> {
    // 1. 读取预设 prompt + 自带目标（先读后删：prompt 用于入队）
    let row = host
        .plugin_db_query_params(
            "SELECT prompt, project_id, agent_id FROM task_preset WHERE id = ?1",
            &sql_params![preset_id],
        )
        .ok()
        .flatten()
        .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
        .ok_or_else(|| format!("preset task not found or already consumed: {}", preset_id))?;
    let prompt = row
        .get("prompt")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("preset task has empty prompt: {}", preset_id))?;
    let preset_project = row.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
    let preset_agent = row.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    let target_project = if project_id.is_empty() {
        preset_project
    } else {
        project_id
    };
    let target_agent = if agent_id.is_empty() {
        preset_agent
    } else {
        agent_id
    };
    let explicit_session = session_id.filter(|v| !v.is_empty());
    // 先校验再删除：目标缺失时若先删，预设会被无谓消耗（用户任务直接丢失）。
    if explicit_session.is_none() && (target_project.is_empty() || target_agent.is_empty()) {
        return Err(format!(
            "preset task {} has no target project/agent; select one before enqueue",
            preset_id
        ));
    }

    // 2. 删除预设（先删后插：删除成功才继续，保证单次消耗）
    if !delete_preset(host, preset_id) {
        return Err(format!("preset task already consumed: {}", preset_id));
    }

    // 3. 复制进队列（source='queue'：预存被消费后即归入自动任务，
    //    来源只区分 手动输入/自动任务/定时任务 三种）；入队失败显性报错。
    //    运行内入口（显式 session_id）优先；否则必须有项目 + agent 目标。
    let (task_id, position, bound_session) = match explicit_session {
        Some(session_id) => {
            let (task_id, position) = crate::task::queue::add_task_with_source_target(
                host,
                session_id,
                (!target_project.is_empty()).then_some(target_project),
                (!target_agent.is_empty()).then_some(target_agent),
                &prompt,
                "queue",
            )
            .map_err(|e| format!("preset enqueue failed: {e}"))?;
            (task_id, position, session_id.to_string())
        }
        None => crate::task::queue::add_task_for_target(
            host,
            target_project,
            target_agent,
            &prompt,
            "queue",
        )
        .map_err(|e| format!("preset enqueue failed: {e}"))?,
    };

    host.log_info(&format!(
        "Preset task enqueued: preset_id={} task_id={} session_id={} position={}",
        preset_id, task_id, bound_session, position
    ));

    Ok((task_id, position, bound_session))
}

/// 广播预设任务变更事件（前端 UI 刷新通道；仅桌面端，不广播移动端）
pub fn broadcast_preset_changed(host: &WasmHost, preset_id: &str, action: &str) {
    let _ = host.bus_publish(
        EVENT_TASK_PRESET_CHANGED,
        &serde_json::json!({ "preset_id": preset_id, "action": action }),
    );
    host.emit_event(
        EVENT_TASK_PRESET_CHANGED,
        &serde_json::json!({ "preset_id": preset_id, "action": action }),
    );
}

// ==================== Helpers ====================

/// 生成预设任务 ID（与 queue.rs 同法：randomblob hex）
///
/// 回退仅作编译期/极端兜底（randomblob 查询几乎不会失败），
/// 用 preset 表行数近似唯一，避免依赖 wasm 不可用的系统 API
fn new_id(host: &WasmHost) -> String {
    host.plugin_db_query("SELECT lower(hex(randomblob(16))) AS id")
        .ok()
        .flatten()
        .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
        .and_then(|row| {
            row.get("id")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| {
            let count = host
                .plugin_db_query("SELECT count(*) AS c FROM task_preset")
                .ok()
                .flatten()
                .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
                .and_then(|row| row.get("c").and_then(|v| v.as_i64()))
                .unwrap_or(0);
            format!("preset-{}", count + 1)
        })
}
