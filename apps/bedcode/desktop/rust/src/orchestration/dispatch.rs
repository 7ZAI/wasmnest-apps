//! 派发端口：run.start → 建 task 行 → 等桥接 → 应用 profile → send。
//!
//! 顺序是硬约束：模型 / 思考等级经 `agent-control` 命令入队，**回执 done 之后**
//! 才发 work order。否则桥接命令失败时 prompt 会落到默认模型上——那是一次静默
//! 降级，比失败更糟。命令本身至少一次投递，回执幂等，由命令队列兜底。

use crate::agent_pool::model::AgentProfile;

pub(crate) trait DispatchPort {
    fn start_run(&self, project_id: &str, agent_id: &str) -> Result<String, String>;
    fn create_task_row(
        &self,
        run_id: &str,
        prompt: &str,
        agent_id: &str,
        source: &str,
    ) -> Result<(), String>;
    fn bridge_ready(&self, run_id: &str) -> Result<bool, String>;
    /// 入队 `agent-control`（`{model?, thinkingLevel?}`），返回命令 id
    fn enqueue_agent_control(
        &self,
        run_id: &str,
        model: Option<&str>,
        thinking_level: Option<&str>,
    ) -> Result<i64, String>;
    /// 命令回执状态；`None` = 行不存在（队列被清理 / 跑错 run）
    fn command_state(&self, run_id: &str, command_id: i64) -> Result<Option<CommandState>, String>;
    fn send(&self, run_id: &str, text: &str) -> Result<i64, String>;
    fn converge_task(&self, run_id: &str, reason: &str) -> Result<(), String>;
    fn interrupt(&self, run_id: &str) -> Result<(), String>;
    fn close(&self, run_id: &str) -> Result<(), String>;
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) enum CommandState {
    #[default]
    Pending,
    Done,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DispatchRequest<'a> {
    pub project_id: &'a str,
    pub agent_id: &'a str,
    /// 节点 / planner 的派发快照（None = 不应用运行内控制）
    pub profile: Option<&'a super::model::AgentSnapshot>,
    /// 已入队的 `agent-control` 命令 id（幂等重入）
    pub control_command_id: Option<i64>,
    pub work_order: &'a str,
    pub run_id: Option<&'a str>,
    pub task_row_created: bool,
    pub command_id: Option<i64>,
    pub dispatched_at_ms: Option<i64>,
    pub now_ms: i64,
    pub bridge_timeout_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DispatchOutcome {
    WaitingForBridge { run_id: String },
    WaitingForProfile { run_id: String, command_id: i64 },
    Sent { run_id: String, command_id: i64 },
    AlreadySent { run_id: String, command_id: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DispatchError {
    RunStartFailed { detail: String },
    TaskRowFailed { run_id: String, detail: String },
    BridgeTimeout { run_id: String },
    BridgeProbeFailed { run_id: String, detail: String },
    ProfileApplyFailed { run_id: String, detail: String },
    ProfileTimeout { run_id: String },
    ProfileCommandMissing { run_id: String, command_id: i64 },
    SendFailed { run_id: String, detail: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CancelOutcome {
    Interrupted,
    WaitingForGrace,
    Closed,
    /// 宿主动作失败（run 已回收 / 无 PTY / 宿主重启）：不再把错误上抛阻塞
    /// 状态机，而是退化成「记录时间 + 宽限后 close」，detail 由调用方落事件。
    /// `closed` = 节点此刻即可判定终态。
    Degraded {
        action: &'static str,
        detail: String,
        closed: bool,
    },
}

pub(crate) const CANCEL_GRACE_MS: i64 = 10_000;

/// 派发失败收尾：本函数启动 / 接管的 run 必须同时收敛任务行并关闭。
/// 只 converge 不 close 会留下孤儿会话占 PTY 槽（M2）；清理动作自身失败
/// 不改变失败结论（宿主动作同样可能失败，按 H3 的降级口径不上抛）。
fn abort_run(port: &impl DispatchPort, run_id: &str, reason: &str) {
    let _ = port.converge_task(run_id, reason);
    let _ = port.close(run_id);
}

pub(crate) fn dispatch(
    port: &impl DispatchPort,
    request: &DispatchRequest<'_>,
) -> Result<DispatchOutcome, DispatchError> {
    if let (Some(run_id), Some(command_id)) = (request.run_id, request.command_id) {
        return Ok(DispatchOutcome::AlreadySent {
            run_id: run_id.to_string(),
            command_id,
        });
    }

    let run_id = match request.run_id {
        Some(run_id) => run_id.to_string(),
        None => port
            .start_run(request.project_id, request.agent_id)
            .map_err(|detail| DispatchError::RunStartFailed { detail })?,
    };

    if !request.task_row_created {
        if let Err(detail) = port.create_task_row(
            &run_id,
            request.work_order,
            request.agent_id,
            "orchestration",
        ) {
            abort_run(port, &run_id, "task-row-failed");
            return Err(DispatchError::TaskRowFailed { run_id, detail });
        }
    }

    let ready = match port.bridge_ready(&run_id) {
        Ok(ready) => ready,
        Err(detail) => {
            abort_run(port, &run_id, "bridge-offline");
            return Err(DispatchError::BridgeProbeFailed { run_id, detail });
        }
    };

    if !ready {
        let timed_out = request
            .dispatched_at_ms
            .is_some_and(|started| request.now_ms - started > request.bridge_timeout_ms);
        if timed_out {
            abort_run(port, &run_id, "bridge-offline");
            return Err(DispatchError::BridgeTimeout { run_id });
        }
        return Ok(DispatchOutcome::WaitingForBridge { run_id });
    }

    // 运行内 profile：先入队控制命令，等回执 done 再发 prompt。
    if let Some(profile) = request.profile {
        if profile.has_control() {
            let command_id = match request.control_command_id {
                Some(command_id) => command_id,
                None => {
                    let command_id = port
                        .enqueue_agent_control(
                            &run_id,
                            profile.model.as_deref(),
                            profile.thinking_level.as_deref(),
                        )
                        .map_err(|detail| {
                            abort_run(port, &run_id, "agent-profile-enqueue-failed");
                            DispatchError::ProfileApplyFailed {
                                run_id: run_id.clone(),
                                detail,
                            }
                        })?;
                    return Ok(DispatchOutcome::WaitingForProfile { run_id, command_id });
                }
            };
            match port.command_state(&run_id, command_id) {
                Ok(Some(CommandState::Done)) => {}
                Ok(Some(CommandState::Pending)) => {
                    let timed_out = request.dispatched_at_ms.is_some_and(|started| {
                        request.now_ms - started > request.bridge_timeout_ms
                    });
                    if timed_out {
                        abort_run(port, &run_id, "agent-profile-timeout");
                        return Err(DispatchError::ProfileTimeout { run_id });
                    }
                    return Ok(DispatchOutcome::WaitingForProfile { run_id, command_id });
                }
                Ok(Some(CommandState::Failed(detail))) => {
                    abort_run(port, &run_id, "agent-profile-failed");
                    return Err(DispatchError::ProfileApplyFailed { run_id, detail });
                }
                Ok(None) => {
                    abort_run(port, &run_id, "agent-profile-missing");
                    return Err(DispatchError::ProfileCommandMissing { run_id, command_id });
                }
                Err(detail) => {
                    abort_run(port, &run_id, "agent-profile-probe-failed");
                    return Err(DispatchError::ProfileApplyFailed { run_id, detail });
                }
            }
        }
    }

    match port.send(&run_id, request.work_order) {
        Ok(command_id) => Ok(DispatchOutcome::Sent { run_id, command_id }),
        Err(detail) => {
            abort_run(port, &run_id, "send-failed");
            Err(DispatchError::SendFailed { run_id, detail })
        }
    }
}

pub(crate) fn cancel(
    port: &impl DispatchPort,
    run_id: &str,
    interrupted_at_ms: Option<i64>,
    now_ms: i64,
) -> CancelOutcome {
    match interrupted_at_ms {
        None => match port.interrupt(run_id) {
            Ok(()) => CancelOutcome::Interrupted,
            Err(detail) => CancelOutcome::Degraded {
                action: "interrupt",
                detail,
                closed: false,
            },
        },
        Some(interrupted_at) if now_ms - interrupted_at < CANCEL_GRACE_MS => {
            CancelOutcome::WaitingForGrace
        }
        Some(_) => match port.close(run_id) {
            Ok(()) => CancelOutcome::Closed,
            Err(detail) => CancelOutcome::Degraded {
                action: "close",
                detail,
                closed: true,
            },
        },
    }
}

#[cfg(test)]
mod tests;
