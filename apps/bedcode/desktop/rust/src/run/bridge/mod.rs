//! 桥接（agent 原生扩展）后端面：事件入站 / 命令下行 / 心跳
//!
//! 协议（回环 HTTP，`auth: none`，沿用 `task-status` 的环回免凭证先例）：
//! - `POST run-events` `{runId, events:[<agent 原生载荷>]}` → 唯一归一入口落账，
//!   回执入队报告；
//! - `POST run-commands` `{runId}` → 领取待执行命令（同时是心跳）；
//! - `POST run-commands-ack` `{runId, results:[{id, ok, error?}]}` → 回执。
//!
//! 心跳写进 `runs.bridge_seen_at`（不碰 `updated_at`：桥接在跑不等于用户有动作）。
//! 界面据此把「非终态 + 心跳不新鲜」标成镜像模式；终端页签不受影响。
//!
//! 成功入站还会把 `session.meta` 的 agent 会话 id / 标题 / 模型回填到运行行（这些
//! 字段是运行列表与对话面头部要展示的事实），标题缺省时用首条用户消息派生。

pub mod commands;

use commands::{CommandStore, COMMAND_SEND};
use serde_json::{json, Value};

#[cfg(target_arch = "wasm32")]
use crate::session::model::SessionRecord;
#[cfg(target_arch = "wasm32")]
use crate::session::store::RUN_EVENT_CAP;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 桥接协议版本（扩展在命令轮询回执里读；将来协议不兼容时用于显性拒绝旧扩展）
pub const BRIDGE_PROTOCOL_VERSION: u32 = 1;

/// 单批事件上限：扩展 150ms 合批，正常远低于此；超限是协议误用，显性拒绝
pub const MAX_EVENT_BATCH: usize = 500;

/// 命令领取的回收窗口：扩展崩溃后 30s 内不重投，避免「执行了但回执丢了」被立刻重放
pub const COMMAND_CLAIM_STALE_SECS: i64 = 30;

/// 本域回环路由（注册表与分派表的共同事实源；全部 `auth: none`）
pub const HTTP_ENDPOINTS: &[&str] = &["run-attach", "run-events", "run-commands", "run-commands-ack"];

/// 桥接支持的驱动（本轮 opencode / pi；claude / codex 只读镜像，无桥接）
pub fn supports_bridge(agent_id: &str) -> bool {
    matches!(agent_id, "opencode" | "pi")
}

/// 认领裁决（`run-attach` 的纯逻辑；native 单测直测，wasm 侧喂 REGISTRY 快照）
///
/// 输入是某项目的全部运行记录快照（`Registry::all` = `created_at, id` 升序）：
/// - `ownable_bridge_runs`：桥接可服务的运行（心跳 + 命令轮询的对象）——同项目、
///   opencode 驱动（共享服务架构下插件实例按 agent 扩展部署，pi 走进程内 env 不经
///   此路径）、非终态、PTY 句柄在（宿主重启后启动对账清空——僵尸运行天然不在列）。
///   **不限会话绑定状态**：桥接实例是项目内唯一写者，对未绑定运行也必须心跳
///   （opencode 会话是懒创建的，首条消息前没有任何会话事件，输入解锁靠心跳）。
/// - `claim_bridge_run`（带 agentSessionId）：幂等重绑（已绑定且非终态 → 原运行）；
///   否则认领最旧未绑定可服务运行（`agent_session_id` 未绑定即排他——绑定即认领；
///   `claim = false` 只重绑不认领，引导补绑用——历史死会话绝不抢活运行）。
///
/// 并发 attach 的交错由「绑定写库」收敛（绑定即排他）；残余竞态（两条新运行
/// 几乎同时起、桥接到达顺序颠倒）记 ADR 0004 已知边界。
pub fn ownable_bridge_runs<'a>(
    records: &'a [crate::session::model::SessionRecord],
    project_ids: &[String],
) -> Vec<&'a crate::session::model::SessionRecord> {
    records
        .iter()
        .filter(|record| {
            record
                .project_id
                .as_deref()
                .is_some_and(|id| project_ids.iter().any(|pid| pid == id))
                && record.agent_id.as_deref() == Some("opencode")
                && !record.status.is_terminal()
                && record.pty_id.is_some()
        })
        .collect()
}

pub fn claim_bridge_run<'a>(
    records: &'a [crate::session::model::SessionRecord],
    project_ids: &[String],
    agent_session_id: Option<&str>,
    claim: bool,
) -> Option<&'a crate::session::model::SessionRecord> {
    let in_project = |record: &crate::session::model::SessionRecord| {
        record
            .project_id
            .as_deref()
            .is_some_and(|id| project_ids.iter().any(|pid| pid == id))
    };
    if let Some(session_id) = agent_session_id.filter(|value| !value.is_empty()) {
        if let Some(record) = records.iter().find(|record| {
            record.agent_session_id.as_deref() == Some(session_id)
                && in_project(record)
                && !record.status.is_terminal()
        }) {
            return Some(record);
        }
    }
    if !claim {
        return None;
    }
    records.iter().find(|record| {
        in_project(record)
            && record.agent_id.as_deref() == Some("opencode")
            && !record.status.is_terminal()
            && record.pty_id.is_some()
            && record.agent_session_id.is_none()
    })
}

/// 时间回退 `secs` 秒（RFC3339 秒级；用于领取回收窗口）
pub fn stale_before(now: &str, secs: i64) -> Result<String, String> {
    let epoch = crate::config::model::unix_from_rfc3339(now)
        .ok_or_else(|| format!("invalid clock value: {now}"))?;
    Ok(crate::config::model::rfc3339_from_unix(
        epoch.saturating_sub(secs.max(0) as u64),
    ))
}

/// 首条用户消息 → 运行标题（单行、60 字内；空文本返回 None）
pub fn derive_title(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let mut title: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        title.push('…');
    }
    Some(title)
}

// ==================== HTTP 路由 ====================

#[cfg(target_arch = "wasm32")]
enum RouteError {
    BadRequest(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

#[cfg(target_arch = "wasm32")]
impl RouteError {
    fn response(self) -> Value {
        match self {
            RouteError::BadRequest(message) => {
                wasmnest_plugin_api::http_response::error(400, &message)
            }
            RouteError::NotFound(message) => {
                wasmnest_plugin_api::http_response::error(404, &message)
            }
            RouteError::Conflict(message) => {
                wasmnest_plugin_api::http_response::error(409, &message)
            }
            RouteError::Internal(message) => {
                wasmnest_plugin_api::http_response::error(500, &message)
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn required_str<'a>(body: &'a Value, key: &str) -> Result<&'a str, RouteError> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| RouteError::BadRequest(format!("{key} required")))
}

#[cfg(target_arch = "wasm32")]
fn load_run(host: &WasmHost, run_id: &str) -> Result<SessionRecord, RouteError> {
    crate::session::record_via_host(run_id)
        .map_err(RouteError::Internal)?
        .ok_or_else(|| RouteError::NotFound(format!("run not found: {run_id}")))
}

#[cfg(target_arch = "wasm32")]
fn touch(host: &WasmHost, run_id: &str, now: &str) -> Result<(), RouteError> {
    crate::session::note_bridge_seen(run_id, now).map_err(RouteError::Internal)
}

#[cfg(target_arch = "wasm32")]
fn supported_driver(record: &SessionRecord) -> Result<&str, RouteError> {
    let agent = record.agent_id.as_deref().unwrap_or("");
    if !supports_bridge(agent) {
        return Err(RouteError::Conflict(format!(
            "agent has no bridge adapter: {agent}"
        )));
    }
    Ok(agent)
}

/// 回环路由入口（由 `_http_endpoint` 分派；路径全等匹配）
#[cfg(target_arch = "wasm32")]
pub fn handle_http_endpoint(host: &WasmHost, method: &str, path: &str, body: &Value) -> Value {
    if method != "POST" {
        return wasmnest_plugin_api::http_response::error(
            405,
            &format!("method not allowed: {method}"),
        );
    }
    let result = match path {
        "run-attach" => handle_run_attach(host, body),
        "run-events" => handle_run_events(host, body),
        "run-commands" => handle_run_commands(host, body),
        "run-commands-ack" => handle_run_commands_ack(host, body),
        other => Err(RouteError::NotFound(format!(
            "unknown bridge path: {other}"
        ))),
    };
    match result {
        Ok(response) => response,
        Err(error) => {
            let response = error.response();
            host.log_warn(&format!(
                "bridge {path} rejected: {}",
                response["body"]["message"]
                    .as_str()
                    .unwrap_or("unknown error")
            ));
            response
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn handle_http_endpoint(_host: &WasmHost, _method: &str, _path: &str, _body: &Value) -> Value {
    wasmnest_plugin_api::http_response::error(503, "bridge routes unavailable outside wasm runtime")
}

/// `POST run-attach` `{cwd, agentSessionId?, claim?}` → `{runIds: string[]}` 或 `{runId}`
///
/// 桥接取运行身份的握手：共享服务架构下扩展实例活在 opencode 服务进程里，进程
/// env 拿不到当前运行（可能是陈旧泄漏值，**不可**当 runId 用），改按项目目录解析。
/// - **无 `agentSessionId`**：返回本项目全部可服务运行（[`ownable_bridge_runs`]）——
///   桥接开机即逐运行心跳 + 轮询命令（输入解锁靠心跳，不依赖会话存在）。
/// - **带 `agentSessionId`**：会话绑定（[`claim_bridge_run`]，幂等重绑 / 认领最旧
///   未绑定运行；`claim=false` 只重绑）。返回 `{runId}`（null = 无可绑定）。
#[cfg(target_arch = "wasm32")]
fn handle_run_attach(host: &WasmHost, body: &Value) -> Result<Value, RouteError> {
    let cwd = required_str(body, "cwd")?;
    let agent_session_id = body
        .get("agentSessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let claim = body.get("claim").and_then(Value::as_bool).unwrap_or(true);
    let project_ids =
        crate::project::ids_by_working_dir_via_host(cwd).map_err(RouteError::Internal)?;
    if agent_session_id.is_none() {
        let records =
            crate::session::records_snapshot_via_host().map_err(RouteError::Internal)?;
        let run_ids: Vec<String> = ownable_bridge_runs(&records, &project_ids)
            .into_iter()
            .map(|record| record.id.clone())
            .collect();
        return Ok(wasmnest_plugin_api::http_response::ok_with_data(json!({
            "runIds": run_ids,
        })));
    }
    let now = crate::config::model::now_rfc3339();
    let run_id =
        crate::session::bind_bridge_via_host(&project_ids, agent_session_id, claim, &now)
            .map_err(RouteError::Internal)?;
    if run_id.is_none() {
        host.log_debug(&format!(
            "bridge run-attach: no claimable run (cwd={cwd:?}, agentSessionId={agent_session_id:?}, claim={claim})"
        ));
    }
    Ok(wasmnest_plugin_api::http_response::ok_with_data(json!({
        "runId": run_id,
    })))
}

#[cfg(target_arch = "wasm32")]
fn handle_run_events(host: &WasmHost, body: &Value) -> Result<Value, RouteError> {
    let run_id = required_str(body, "runId")?;
    let events = body
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| RouteError::BadRequest("events array required".to_string()))?;
    if events.len() > MAX_EVENT_BATCH {
        return Err(RouteError::BadRequest(format!(
            "event batch too large: {} > {MAX_EVENT_BATCH}",
            events.len()
        )));
    }
    let record = load_run(host, run_id)?;
    let driver = supported_driver(&record)?;
    let now = crate::config::model::now_rfc3339();
    touch(host, run_id, &now)?;

    let report = crate::run::events::ingest(
        host,
        driver,
        crate::run::events::model::EventSource::Bridge,
        run_id,
        events,
        &now,
        RUN_EVENT_CAP,
    )
    .map_err(RouteError::Internal)?;
    sync_run_meta(&record, driver, events, &now)?;

    if report.unknown > 0 {
        host.log_warn(&format!(
            "bridge run-events: {} unknown event(s) dropped (run={run_id}, types={:?})",
            report.unknown, report.unknown_types
        ));
    }
    if report.truncated {
        host.log_warn(&format!(
            "bridge run-events: ledger truncated for run {run_id} (pruned={})",
            report.pruned
        ));
    }
    let report = serde_json::to_value(&report)
        .map_err(|e| RouteError::Internal(format!("report serialize failed: {e}")))?;
    Ok(wasmnest_plugin_api::http_response::ok_with_data(
        json!({ "report": report }),
    ))
}

#[cfg(target_arch = "wasm32")]
fn handle_run_commands(host: &WasmHost, body: &Value) -> Result<Value, RouteError> {
    let run_id = required_str(body, "runId")?;
    let _record = load_run(host, run_id)?;
    let now = crate::config::model::now_rfc3339();
    touch(host, run_id, &now)?;
    let cutoff = stale_before(&now, COMMAND_CLAIM_STALE_SECS).map_err(RouteError::Internal)?;
    let claimed = commands::CommandStore::claim_ready(host, run_id, &now, &cutoff)
        .map_err(RouteError::Internal)?;
    let commands: Vec<Value> = claimed
        .iter()
        .map(|command| {
            json!({
                "id": command.id,
                "kind": command.kind,
                "payload": command.payload,
            })
        })
        .collect();
    Ok(wasmnest_plugin_api::http_response::ok_with_data(json!({
        "protocol": BRIDGE_PROTOCOL_VERSION,
        "commands": commands,
    })))
}

#[cfg(target_arch = "wasm32")]
fn handle_run_commands_ack(host: &WasmHost, body: &Value) -> Result<Value, RouteError> {
    let run_id = required_str(body, "runId")?;
    let results = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| RouteError::BadRequest("results array required".to_string()))?;
    let _record = load_run(host, run_id)?;
    let now = crate::config::model::now_rfc3339();
    touch(host, run_id, &now)?;

    let mut acked = 0usize;
    let mut failed = 0usize;
    let mut ignored = 0usize;
    for result in results {
        let Some(id) = result.get("id").and_then(Value::as_i64) else {
            ignored += 1;
            continue;
        };
        let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(false);
        let error = result.get("error").and_then(Value::as_str);
        let hit = commands::CommandStore::finish(host, run_id, id, ok, error, &now)
            .map_err(RouteError::Internal)?;
        if !hit {
            ignored += 1;
        } else if ok {
            acked += 1;
        } else {
            failed += 1;
        }
    }
    Ok(wasmnest_plugin_api::http_response::ok_with_data(json!({
        "acked": acked,
        "failed": failed,
        "ignored": ignored,
    })))
}

/// 把归一 meta 回填到运行行（agent 会话 id / 标题 / 模型）
///
/// 只回填非空字段；标题缺省时从首条用户消息派生（用户故事 17）。写失败显性上抛：
/// 运行行是项目面与对话面头部的事实来源，静默丢掉会让界面长期显示无名运行。
#[cfg(target_arch = "wasm32")]
fn sync_run_meta(
    record: &SessionRecord,
    driver: &str,
    raws: &[Value],
    now: &str,
) -> Result<(), RouteError> {
    let mut agent_session_id: Option<String> = None;
    let mut title: Option<String> = None;
    let mut model: Option<String> = None;
    let mut first_user: Option<String> = None;
    for raw in raws {
        let outcome = crate::run::events::normalize::normalize(driver, raw, now);
        for draft in outcome.drafts {
            match draft.kind {
                "session.meta" => {
                    if let Some(value) = draft
                        .payload
                        .get("agentSessionId")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                    {
                        agent_session_id = Some(value.to_string());
                    }
                    if let Some(value) = draft
                        .payload
                        .get("title")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                    {
                        title = Some(value.to_string());
                    }
                    if let Some(value) = draft
                        .payload
                        .get("model")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                    {
                        model = Some(value.to_string());
                    }
                }
                "user.message" if first_user.is_none() => {
                    first_user = draft
                        .payload
                        .get("text")
                        .and_then(Value::as_str)
                        .and_then(derive_title);
                }
                _ => {}
            }
        }
    }
    if title.is_none() && record.title.is_none() {
        title = first_user;
    }
    if agent_session_id.is_none() && title.is_none() && model.is_none() {
        return Ok(());
    }
    crate::session::note_run_meta(
        &record.id,
        agent_session_id.as_deref(),
        title.as_deref(),
        model.as_deref(),
    )
    .map_err(RouteError::Internal)
}

// ==================== 前端命令：run.send ====================

/// `run.send {runId, text}` → `{commandId}`
///
/// 桥接不在线（镜像模式）时**显性拒绝**：把消息投进一条没人取的队列，界面会以为
/// 发出去了。前端据此把输入框禁用并指向终端页签。
#[cfg(target_arch = "wasm32")]
pub fn send_via_host(args: &Value) -> Result<Value, String> {
    let run_id = args
        .get("runId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "run.send: runId required".to_string())?;
    let text = args
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "run.send: text required".to_string())?;
    let record = crate::session::record_via_host(run_id)?
        .ok_or_else(|| format!("run.send: run not found: {run_id}"))?;
    if record.status.is_terminal() {
        return Err("run.send: run has ended".to_string());
    }
    let agent = record.agent_id.as_deref().unwrap_or("");
    if !supports_bridge(agent) {
        return Err(format!("run.send: agent has no bridge adapter: {agent}"));
    }
    let now = crate::config::model::now_rfc3339();
    if !record.bridge_connected(&now) {
        return Err(
            "run.send: bridge unavailable (mirror mode); send from the terminal tab".to_string(),
        );
    }
    // agentSessionId 一并下发：扩展刚启动还没收到 session 事件时也能直接发送
    let command_id = commands::enqueue(
        &WasmHost,
        run_id,
        COMMAND_SEND,
        &json!({ "text": text, "agentSessionId": record.agent_session_id }),
        &now,
    )?;
    WasmHost.log_info(&format!(
        "run.send queued (run={run_id}, command={command_id})"
    ));
    Ok(json!({ "commandId": command_id, "runId": run_id }))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn send_via_host(_args: &Value) -> Result<Value, String> {
    Err("bridge commands unavailable outside wasm runtime".to_string())
}

// ==================== 共用（native 可测） ====================

/// 桥接在线判据（供运行视图与 send 共用；终态运行一律 false）
pub fn connected(record: &crate::session::model::SessionRecord, now: &str) -> bool {
    record.bridge_connected(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_before_subtracts_seconds() {
        assert_eq!(
            stale_before("2026-10-30T12:00:30Z", 30).unwrap(),
            "2026-10-30T12:00:00Z"
        );
        assert_eq!(
            stale_before("2026-10-30T00:00:10Z", 30).unwrap(),
            "2026-10-29T23:59:40Z",
            "跨日回退"
        );
        assert!(stale_before("not-a-time", 30).is_err());
    }

    #[test]
    fn derived_title_is_single_line_and_bounded() {
        assert_eq!(
            derive_title("  first line\nsecond"),
            Some("first line".to_string())
        );
        assert_eq!(derive_title("   \n  "), None);
        let long = "词".repeat(80);
        let title = derive_title(&long).unwrap();
        assert_eq!(title.chars().count(), 61, "60 字 + 省略号");
        assert!(title.ends_with('…'));
    }

    #[test]
    fn only_opencode_and_pi_have_bridge_adapters() {
        assert!(supports_bridge("opencode"));
        assert!(supports_bridge("pi"));
        assert!(!supports_bridge("claude"));
        assert!(!supports_bridge("codex"));
        assert!(!supports_bridge(""));
    }

    // ==================== run-attach 认领裁决（纯函数） ====================

    /// 造一条运行记录（其余字段与桥接裁决无关，取默认）
    fn run_record(id: &str, project_id: &str) -> crate::session::model::SessionRecord {
        crate::session::model::SessionRecord {
            id: id.to_string(),
            pty_id: Some("pty-live".to_string()),
            config_id: String::new(),
            project_id: Some(project_id.to_string()),
            agent_id: Some("opencode".to_string()),
            agent_session_id: None,
            title: None,
            model: None,
            truncated: false,
            bridge_seen_at: None,
            name: id.to_string(),
            status: crate::session::model::SessionStatus::Running,
            created_at: "2026-10-31T00:00:00Z".to_string(),
            started_at: None,
            stopped_at: None,
            canonical_renderer: None,
            owner: None,
            updated_at: "2026-10-31T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn claim_picks_oldest_live_unbound_run() {
        let records = vec![
            run_record("run-old", "p1"),
            run_record("run-new", "p1"),
        ];
        let projects = vec!["p1".to_string()];
        let picked = claim_bridge_run(&records, &projects, None, true).unwrap();
        assert_eq!(picked.id, "run-old", "升序第一个可服务者胜（先启动先服务）");
    }

    #[test]
    fn claim_skips_zombies_terminal_and_other_projects() {
        let mut zombie = run_record("run-zombie", "p1");
        // 宿主重启后启动对账清空 PTY 句柄：僵尸运行不可认领
        zombie.pty_id = None;
        let mut dead = run_record("run-dead", "p1");
        dead.status = crate::session::model::SessionStatus::Stopped;
        let other = run_record("run-other", "p2");
        let records = vec![zombie, dead, other];
        let picked = claim_bridge_run(&records, &["p1".to_string()], None, true);
        assert!(picked.is_none(), "僵尸 / 终态 / 他项目一律不可认领");
    }

    #[test]
    fn claim_rebinds_same_agent_session_idempotently() {
        let mut bound = run_record("run-bound", "p1");
        bound.agent_session_id = Some("ses_a".to_string());
        let fresh = run_record("run-fresh", "p1");
        let records = vec![bound.clone(), fresh];
        let projects = vec!["p1".to_string()];
        let picked =
            claim_bridge_run(&records, &projects, Some("ses_a"), true).unwrap();
        assert_eq!(picked.id, "run-bound", "已绑定会话幂等返回原运行");
    }

    #[test]
    fn claim_falls_back_when_bound_run_went_terminal() {
        let mut bound = run_record("run-bound", "p1");
        bound.agent_session_id = Some("ses_a".to_string());
        bound.status = crate::session::model::SessionStatus::Stopped;
        let fresh = run_record("run-fresh", "p1");
        let records = vec![bound, fresh];
        let picked =
            claim_bridge_run(&records, &["p1".to_string()], Some("ses_a"), true)
                .unwrap();
        assert_eq!(picked.id, "run-fresh", "终态运行不收事件：回落重新认领");
    }

    #[test]
    fn claim_skips_already_bound_runs() {
        // 认领的排他 = agent_session_id 未绑定（绑定即认领）；心跳新鲜度不再是
        // 认领条件——桥接实例是项目内唯一写者，心跳只表达存活不表达占用
        let fresh = run_record("run-fresh", "p1");
        let records = vec![run_record("run-held", "p1"), fresh.clone()];
        let picked = claim_bridge_run(&records, &["p1".to_string()], None, true).unwrap();
        assert_eq!(picked.id, "run-held", "最旧未绑定运行胜");
        let mut bound = run_record("run-bound", "p1");
        bound.agent_session_id = Some("ses_a".to_string());
        let records2 = vec![bound, fresh];
        let picked2 =
            claim_bridge_run(&records2, &["p1".to_string()], Some("ses_b"), true).unwrap();
        assert_eq!(picked2.id, "run-fresh", "已绑定运行对其他会话不可认领");
    }

    #[test]
    fn ownable_lists_all_live_runs_of_project() {
        let mut zombie = run_record("run-zombie", "p1");
        // 宿主重启后启动对账清空 PTY 句柄：僵尸不可服务
        zombie.pty_id = None;
        let mut dead = run_record("run-dead", "p1");
        dead.status = crate::session::model::SessionStatus::Stopped;
        let mut pi_run = run_record("run-pi", "p1");
        pi_run.agent_id = Some("pi".to_string());
        let live_bound = run_record("run-live-bound", "p1");
        let live_unbound = run_record("run-live-unbound", "p1");
        let other_project = run_record("run-other", "p2");
        let records = vec![
            zombie,
            dead,
            pi_run,
            live_bound,
            live_unbound,
            other_project,
        ];
        let ownable: Vec<&str> = ownable_bridge_runs(&records, &["p1".to_string()])
            .into_iter()
            .map(|record| record.id.as_str())
            .collect();
        assert_eq!(
            ownable,
            vec!["run-live-bound", "run-live-unbound"],
            "可服务 = 同项目 + opencode + 非终态 + PTY 在场（含已绑定：心跳与轮询不分绑定与否）"
        );
    }

    #[test]
    fn rebind_only_mode_never_claims() {
        // 引导补绑（claim=false）：已绑定会话幂等重绑；未绑定会话一律落空——
        // 历史死会话不能借补绑路径抢走活运行的认领
        let mut bound = run_record("run-bound", "p1");
        bound.agent_session_id = Some("ses_a".to_string());
        let fresh = run_record("run-fresh", "p1");
        let records = vec![bound, fresh];
        let projects = vec!["p1".to_string()];
        let picked =
            claim_bridge_run(&records, &projects, Some("ses_a"), false)
                .unwrap();
        assert_eq!(picked.id, "run-bound", "重绑模式仍可幂等命中已绑定运行");
        assert!(
            claim_bridge_run(&records, &projects, Some("ses_b"), false)
                .is_none(),
            "重绑模式不为未绑定会话开新认领"
        );
        assert!(
            claim_bridge_run(&records, &projects, None, false).is_none(),
            "重绑模式拒绝纯认领语义"
        );
    }
}
