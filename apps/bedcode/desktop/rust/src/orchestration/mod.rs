//! Agent 编排（v1）：计划 / 执行 / 证据三平面。
//!
//! 本模块是编排域**唯一对外面**：命令路由、宿主端口适配与定时器注册；
//! 纯逻辑在 `plan` / `sched` / `evidence` / `service`，持久化在 `store`。

pub(crate) mod actions;
pub(crate) mod dispatch;
pub(crate) mod evidence;
pub(crate) mod handoff;
pub(crate) mod model;
pub(crate) mod plan;
pub(crate) mod recover;
pub(crate) mod sched;
pub(crate) mod service;
pub(crate) mod store;

/// 宿主定时器回调命令名（需在 `plugin.json` contributes.commands 声明）
pub(crate) const TICK_COMMAND: &str = "session.orchestration.tick";
/// tick 间隔（秒）
pub(crate) const TICK_INTERVAL_SECS: u64 = 1;
/// 与 `plugin.json` 的 `ptyQuota` 保持一致
const PTY_QUOTA: u8 = 8;
/// 给用户手动运行保留的 PTY 余量
const RESERVED_PTY_SLOTS: u8 = 2;

#[cfg(target_arch = "wasm32")]
mod wasm_commands {
    use serde_json::{json, Value};
    use wasmnest_plugin_api::host::{HostLog, HostProcess, HostTimer};
    use wasmnest_plugin_api::wasm_host::WasmHost;

    use super::dispatch::{CommandState, DispatchPort};
    use super::evidence::{EvidencePort, FileFingerprint, GitSnapshot};
    use super::model::{self, Plan, PlanMode, ReasonCode};
    use super::service::{self, CreateInput, ProjectInfo, RuntimePort};
    use super::store::OrchStore;
    use super::{PTY_QUOTA, RESERVED_PTY_SLOTS, TICK_COMMAND, TICK_INTERVAL_SECS};
    use crate::orchestration::evidence::CommandResult;

    const MAX_EVIDENCE_TAIL: usize = 8192;

    pub(crate) fn ensure_schema() -> Result<(), String> {
        WasmHost.ensure_schema()
    }

    pub(crate) fn recover_on_activate() {
        let now = crate::config::model::now_rfc3339();
        match service::recover_all(&WasmHost, &WasmHost, &now) {
            Ok(report) if report.checked > 0 => WasmHost.log_warn(&format!(
                "orchestration recovery: checked={} failedNodes={} paused={} errors={}",
                report.checked,
                report.failed_nodes,
                report.paused,
                report.errors.len()
            )),
            Ok(_) => WasmHost.log_debug("orchestration recovery: no non-terminal orchestration"),
            Err(error) => WasmHost.log_warn(&format!(
                "orchestration recovery failed at activate (orchestration degraded): {error}"
            )),
        }
    }

    pub(crate) fn register_timer() {
        match WasmHost.timer_register(TICK_INTERVAL_SECS, TICK_COMMAND) {
            Ok(()) => WasmHost.log_info(&format!(
                "orchestration timer registered: interval={}s",
                TICK_INTERVAL_SECS
            )),
            Err(error) => WasmHost.log_warn(&format!(
                "orchestration timer registration failed (scheduler degraded): {}",
                error
            )),
        }
    }

    fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
        args.get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    }

    fn arg_i64(args: &Value, key: &str) -> Option<i64> {
        args.get(key).and_then(Value::as_i64)
    }

    fn new_id() -> Result<String, String> {
        crate::config::model::new_config_id()
    }

    pub(crate) fn invoke_command(name: &str, args: Value) -> Result<Value, String> {
        let now = crate::config::model::now_rfc3339();
        match name {
            "orchestration.meta" => meta(),
            "orchestration.list" => {
                let project_id = arg_str(&args, "projectId").map(str::to_string);
                service::list(&WasmHost, &WasmHost, project_id.as_deref())
            }
            "orchestration.get" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.get: id required".to_string())?;
                service::get(&WasmHost, &WasmHost, id)
            }
            "orchestration.create" => {
                let project_id = arg_str(&args, "projectId")
                    .ok_or_else(|| "orchestration.create: projectId required".to_string())?;
                let title = arg_str(&args, "title").unwrap_or_default();
                let goal = arg_str(&args, "goal").unwrap_or_default();
                let mode = match arg_str(&args, "mode").unwrap_or("manual") {
                    "manual" => PlanMode::Manual,
                    "auto" => PlanMode::Auto,
                    other => {
                        return Err(format!(
                            "{}: unknown mode `{other}`",
                            ReasonCode::PlanInvalid.as_str()
                        ))
                    }
                };
                let orchestrator_agent_id = arg_str(&args, "orchestratorAgentId").map(str::to_string);
                let require_approval = args
                    .get("requireApproval")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let plan: Option<Plan> = match args.get("plan") {
                    Some(value) if !value.is_null() => Some(
                        serde_json::from_value(value.clone())
                            .map_err(|e| format!("plan-invalid: {e}"))?,
                    ),
                    _ => None,
                };
                service::create(
                    &WasmHost,
                    &WasmHost,
                    CreateInput {
                        id: new_id()?,
                        project_id: project_id.to_string(),
                        title: title.to_string(),
                        goal: goal.to_string(),
                        mode,
                        orchestrator_agent_id,
                        require_approval,
                        plan,
                    },
                    &now,
                )
            }
            "orchestration.update-plan" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.update-plan: id required".to_string())?;
                let plan: Plan = serde_json::from_value(
                    args.get("plan")
                        .cloned()
                        .ok_or_else(|| "orchestration.update-plan: plan required".to_string())?,
                )
                .map_err(|e| format!("plan-invalid: {e}"))?;
                service::update_plan(&WasmHost, &WasmHost, id, &plan, &now)
            }
            "orchestration.approve" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.approve: id required".to_string())?;
                service::approve(&WasmHost, id, &now)
            }
            "orchestration.start" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.start: id required".to_string())?;
                service::start(&WasmHost, &WasmHost, id, &now)
            }
            "orchestration.pause" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.pause: id required".to_string())?;
                service::pause(&WasmHost, id, &now)
            }
            "orchestration.resume" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.resume: id required".to_string())?;
                service::resume(&WasmHost, id, &now)
            }
            "orchestration.cancel" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.cancel: id required".to_string())?;
                service::cancel(&WasmHost, &WasmHost, id, &now)
            }
            "orchestration.retry-node" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.retry-node: id required".to_string())?;
                let node_key = arg_str(&args, "nodeKey")
                    .ok_or_else(|| "orchestration.retry-node: nodeKey required".to_string())?;
                service::retry_node(&WasmHost, &WasmHost, id, node_key, &now)
            }
            "orchestration.skip-node" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.skip-node: id required".to_string())?;
                let node_key = arg_str(&args, "nodeKey")
                    .ok_or_else(|| "orchestration.skip-node: nodeKey required".to_string())?;
                service::skip_node(&WasmHost, id, node_key, &now)
            }
            "orchestration.events" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.events: id required".to_string())?;
                let after_seq = arg_i64(&args, "afterSeq").unwrap_or(0);
                let limit = arg_i64(&args, "limit").map(|value| value.max(1) as usize);
                service::events(&WasmHost, id, after_seq, limit)
            }
            "orchestration.plan" => {
                let id = arg_str(&args, "id")
                    .ok_or_else(|| "orchestration.plan: id required".to_string())?;
                let agent_profile_id = arg_str(&args, "agentProfileId");
                service::start_planning(&WasmHost, &WasmHost, id, agent_profile_id, &now)
            }
            TICK_COMMAND => {
                let now = args
                    .get("now_utc")
                    .or_else(|| args.get("nowUtc"))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or(now);
                let report = service::tick(&WasmHost, &WasmHost, &now)?;
                for (id, error) in &report.errors {
                    WasmHost.log_error(&format!("orchestration tick failed (id={id}): {error}"));
                }
                Ok(json!({ "ticked": report.ticked, "errors": report.errors }))
            }
            other => Err(format!("unknown orchestration command: {other}")),
        }
    }

    fn meta() -> Result<Value, String> {
        let described = crate::hub::invoke_command("agent.list-agents", Value::Null)
            .map_err(|e| e.to_string())?;
        let state = crate::hub::invoke_command("agent.get-state", Value::Null)
            .map_err(|e| e.to_string())?;
        let clis = state
            .get("state")
            .and_then(|state| state.get("clis"))
            .and_then(Value::as_object)
            .ok_or_else(|| format!("agent.get-state returned no clis object: {state}"))?;
        let described_agents = described
            .get("agents")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("agent.list-agents returned no agents array: {described}"))?;
        let mut agents = Vec::with_capacity(described_agents.len());
        for (index, agent) in described_agents.iter().enumerate() {
            let id = agent
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("agent.list-agents entry {index} has no id: {agent}"))?;
            let display_name = agent
                .get("displayName")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("agent.list-agents entry {index} has no displayName: {agent}")
                })?;
            let ready = clis
                .get(id)
                .and_then(|cli| cli.get("installed"))
                == Some(&Value::Bool(true));
            agents.push(model::AgentOption {
                id: id.to_string(),
                display_name: display_name.to_string(),
                ready,
            });
        }
        let profiles = crate::agent_pool::list_views()?;
        serde_json::to_value(model::meta(&agents, &profiles))
            .map_err(|e| format!("serialize orchestration meta failed: {e}"))
    }

    // ==================== 宿主端口 ====================

    fn run_git(cwd: &str, args: &[String], timeout_secs: u64) -> Result<String, String> {
        let request = json!({
            "command": "git",
            "args": args,
            "cwd": cwd,
            "timeout_ms": timeout_secs.saturating_mul(1000),
        });
        let result = HostProcess::process_run_sync(&WasmHost, &request.to_string())
            .map_err(|e| format!("orchestration git failed: {}", e.message))?;
        if result.timed_out {
            return Err("orchestration git timed out".to_string());
        }
        if result.exit_code != Some(0) {
            return Err(format!(
                "orchestration git exited {:?}: {}",
                result.exit_code,
                result.stderr.trim()
            ));
        }
        Ok(result.stdout)
    }

    fn content_fingerprints(
        working_dir: &str,
        paths: &[String],
        timeout_secs: u64,
    ) -> Result<std::collections::BTreeMap<String, FileFingerprint>, String> {
        let mut fingerprints = std::collections::BTreeMap::new();
        for batch in paths.chunks(200) {
            let mut args = vec!["hash-object".to_string(), "--".to_string()];
            args.extend(batch.iter().cloned());
            let stdout = run_git(working_dir, &args, timeout_secs)?;
            let hashes: Vec<&str> = stdout.lines().filter(|line| !line.is_empty()).collect();
            if hashes.len() != batch.len() {
                return Err(format!(
                    "git hash-object returned {} hashes for {} paths",
                    hashes.len(),
                    batch.len()
                ));
            }
            for (path, hash) in batch.iter().zip(hashes) {
                fingerprints.insert(
                    path.clone(),
                    FileFingerprint::Content(hash.trim().to_string()),
                );
            }
        }
        Ok(fingerprints)
    }

    fn snapshot(working_dir: &str, timeout_secs: u64) -> Result<GitSnapshot, String> {
        let stdout = run_git(
            working_dir,
            &[
                "status".to_string(),
                "--porcelain".to_string(),
                "-z".to_string(),
                "-uall".to_string(),
            ],
            timeout_secs,
        )?;
        let mut hashed: Vec<String> = Vec::new();
        let mut deleted: Vec<String> = Vec::new();
        let mut fields = stdout.split('\0');
        while let Some(field) = fields.next() {
            if field.is_empty() {
                continue;
            }
            if field.len() < 4 {
                return Err(format!("unexpected git status entry: {field:?}"));
            }
            let bytes = field.as_bytes();
            let index_status = bytes[0] as char;
            let worktree_status = bytes[1] as char;
            let path = field[3..].to_string();
            if matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C') {
                // rename/copy：本字段是新路径，下一字段是旧路径
                hashed.push(path);
                if let Some(original) = fields.next() {
                    if !original.is_empty() {
                        deleted.push(original.to_string());
                    }
                }
                continue;
            }
            if matches!(index_status, 'D') || matches!(worktree_status, 'D') {
                deleted.push(path);
            } else {
                hashed.push(path);
            }
        }
        let mut files = content_fingerprints(working_dir, &hashed, timeout_secs)?;
        for path in deleted {
            files.insert(path, FileFingerprint::Deleted);
        }
        Ok(GitSnapshot { files })
    }

    fn tail(value: &str, max_bytes: usize) -> String {
        if value.len() <= max_bytes {
            return value.to_string();
        }
        let mut start = value.len() - max_bytes;
        while start < value.len() && !value.is_char_boundary(start) {
            start += 1;
        }
        format!("…{}", &value[start..])
    }

    fn task_status(run_id: &str) -> Result<Option<model::TaskStatus>, String> {
        let status =
            crate::task::state::get_task_status(&WasmHost, run_id).map_err(|e| e.to_string())?;
        let status = status.get("task_status").and_then(Value::as_str);
        Ok(match status {
            Some("in_progress") => Some(model::TaskStatus::InProgress),
            Some("asking") => Some(model::TaskStatus::Asking),
            Some("retrying") => Some(model::TaskStatus::Retrying),
            Some("completed") => Some(model::TaskStatus::Completed),
            Some("interrupted") => Some(model::TaskStatus::Interrupted),
            _ => None,
        })
    }

    impl DispatchPort for WasmHost {
        fn start_run(&self, project_id: &str, agent_id: &str) -> Result<String, String> {
            let launched = crate::run::start_via_host(&json!({
                "projectId": project_id,
                "agentId": agent_id,
            }))?;
            launched
                .get("runId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| "run.start returned no runId".to_string())
        }

        fn create_task_row(
            &self,
            run_id: &str,
            prompt: &str,
            agent_id: &str,
            source: &str,
        ) -> Result<(), String> {
            crate::task::state::create_task_from_dispatch(self, run_id, prompt, agent_id, source)
        }

        fn bridge_ready(&self, run_id: &str) -> Result<bool, String> {
            let record = crate::session::record_via_host(run_id)?
                .ok_or_else(|| format!("run not found: {run_id}"))?;
            Ok(record.bridge_connected(&crate::config::model::now_rfc3339()))
        }

        fn enqueue_agent_control(
            &self,
            run_id: &str,
            model: Option<&str>,
            thinking_level: Option<&str>,
        ) -> Result<i64, String> {
            let mut payload = serde_json::Map::new();
            if let Some(model) = model {
                payload.insert("model".to_string(), json!(model));
            }
            if let Some(level) = thinking_level {
                payload.insert("thinkingLevel".to_string(), json!(level));
            }
            if payload.is_empty() {
                return Err("agent-control requires model or thinkingLevel".to_string());
            }
            crate::run::bridge::commands::enqueue(
                self,
                run_id,
                crate::run::agent_control::COMMAND_AGENT_CONTROL,
                &Value::Object(payload),
                &crate::config::model::now_rfc3339(),
            )
        }

        fn command_state(
            &self,
            run_id: &str,
            command_id: i64,
        ) -> Result<Option<CommandState>, String> {
            let status = crate::run::bridge::commands::CommandStore::status(
                self,
                run_id,
                command_id,
            )?;
            Ok(status.map(|(status, error)| match status.as_str() {
                "done" => CommandState::Done,
                "failed" => CommandState::Failed(
                    error.unwrap_or_else(|| "agent-control failed".to_string()),
                ),
                _ => CommandState::Pending,
            }))
        }

        fn send(&self, run_id: &str, text: &str) -> Result<i64, String> {
            let sent = crate::run::bridge::send_via_host(&json!({
                "runId": run_id,
                "text": text,
            }))?;
            sent.get("commandId")
                .and_then(Value::as_i64)
                .ok_or_else(|| "run.send returned no commandId".to_string())
        }

        fn converge_task(&self, run_id: &str, reason: &str) -> Result<(), String> {
            crate::task::state::interrupt_running_tasks(self, run_id, reason);
            Ok(())
        }

        fn interrupt(&self, run_id: &str) -> Result<(), String> {
            crate::session::input_via_pty(run_id, "", Some("ctrl+c"))
        }

        fn close(&self, run_id: &str) -> Result<(), String> {
            crate::actions::close_via_host(&json!({ "sessionId": run_id })).map(|_| ())
        }
    }

    impl EvidencePort for WasmHost {
        fn git_status(&self, working_dir: &str, timeout_secs: u64) -> Result<GitSnapshot, String> {
            snapshot(working_dir, timeout_secs)
        }

        fn run_command(
            &self,
            working_dir: &str,
            cwd: Option<&str>,
            argv: &[String],
            timeout_secs: u64,
        ) -> Result<CommandResult, String> {
            let (program, rest) = argv
                .split_first()
                .ok_or_else(|| "acceptance command is empty".to_string())?;
            let cwd = match cwd {
                Some(relative) => format!(
                    "{}/{}",
                    working_dir.trim_end_matches('/'),
                    relative.trim_matches('/')
                ),
                None => working_dir.to_string(),
            };
            let request = json!({
                "command": program,
                "args": rest,
                "cwd": cwd,
                "timeout_ms": timeout_secs.saturating_mul(1000),
            });
            let result = HostProcess::process_run_sync(self, &request.to_string())
                .map_err(|e| format!("acceptance command failed: {}", e.message))?;
            let combined = format!("{}{}", result.stdout, result.stderr);
            Ok(CommandResult {
                exit_code: result.exit_code,
                timed_out: result.timed_out,
                output_tail: tail(&combined, MAX_EVIDENCE_TAIL),
            })
        }

        fn last_assistant_text(&self, run_id: &str) -> Result<Option<String>, String> {
            let view = crate::run::events::list_via_host(&json!({
                "runId": run_id,
                "limit": 20000,
            }))?;
            let events = view["events"].as_array().cloned().unwrap_or_default();
            Ok(events
                .iter()
                .rev()
                .find(|event| event["kind"] == "assistant.text")
                .and_then(|event| event["payload"]["text"].as_str())
                .map(str::to_string))
        }
    }

    impl RuntimePort for WasmHost {
        fn project(&self, project_id: &str) -> Result<Option<ProjectInfo>, String> {
            use crate::project::store::ProjectStore;
            Ok(
                ProjectStore::get(self, project_id)?.map(|project| ProjectInfo {
                    name: project.name,
                    working_dir: project.working_dir,
                }),
            )
        }

        fn is_git_repo(&self, working_dir: &str) -> Result<bool, String> {
            Ok(crate::project::git::is_git_repo(self, working_dir))
        }

        fn task_status(&self, run_id: &str) -> Result<Option<model::TaskStatus>, String> {
            task_status(run_id)
        }

        fn run_active(&self, run_id: &str) -> Result<bool, String> {
            Ok(crate::session::record_via_host(run_id)?
                .map(|record| !record.status.is_terminal())
                .unwrap_or(false))
        }

        fn run_state(&self, run_id: &str) -> Result<super::recover::RunState, String> {
            Ok(match crate::session::record_via_host(run_id)? {
                None => super::recover::RunState::NotStarted,
                Some(record) if record.status.is_terminal() => super::recover::RunState::Ended,
                Some(_) => super::recover::RunState::Running,
            })
        }

        fn agent_ready(&self, agent_id: &str) -> Result<bool, String> {
            let state = crate::hub::invoke_command("agent.get-state", Value::Null)
                .map_err(|e| e.to_string())?;
            Ok(state["state"]["clis"][agent_id]["installed"] == Value::Bool(true))
        }

        fn agent_profiles(
            &self,
        ) -> Result<Vec<crate::agent_pool::model::AgentProfile>, String> {
            crate::agent_pool::list_profiles()
        }

        fn pty_slots(&self) -> Result<u8, String> {
            let active = crate::session::records_snapshot_via_host()?
                .iter()
                .filter(|record| !record.status.is_terminal())
                .count() as u8;
            Ok(PTY_QUOTA
                .saturating_sub(RESERVED_PTY_SLOTS)
                .saturating_sub(active))
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_commands::{
    ensure_schema, invoke_command, recover_on_activate, register_timer,
};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn ensure_schema() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn register_timer() {}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn recover_on_activate() {}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn invoke_command(
    _name: &str,
    _args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("orchestration commands are only available in the wasm host".to_string())
}

#[cfg(test)]
mod tests;
