use std::cell::RefCell;

use super::{
    cancel, dispatch, CancelOutcome, CommandState, DispatchError, DispatchOutcome, DispatchPort,
    DispatchRequest,
};
use crate::orchestration::model::AgentSnapshot;

struct FakePort {
    bridge_ready: bool,
    bridge_error: Option<String>,
    start_run: Result<String, String>,
    create_task_row: Result<(), String>,
    send: Result<i64, String>,
    control_state: CommandState,
    interrupt_error: Option<String>,
    close_error: Option<String>,
    calls: RefCell<Vec<String>>,
}

impl Default for FakePort {
    fn default() -> Self {
        Self {
            bridge_ready: false,
            bridge_error: None,
            start_run: Ok("run-1".into()),
            create_task_row: Ok(()),
            send: Ok(7),
            control_state: CommandState::Done,
            interrupt_error: None,
            close_error: None,
            calls: RefCell::new(vec![]),
        }
    }
}

impl DispatchPort for FakePort {
    fn start_run(&self, project_id: &str, agent_id: &str) -> Result<String, String> {
        self.calls
            .borrow_mut()
            .push(format!("start_run:{project_id}:{agent_id}"));
        self.start_run.clone()
    }

    fn create_task_row(
        &self,
        run_id: &str,
        _prompt: &str,
        agent_id: &str,
        source: &str,
    ) -> Result<(), String> {
        self.calls
            .borrow_mut()
            .push(format!("create_task_row:{run_id}:{agent_id}:{source}"));
        self.create_task_row.clone()
    }

    fn bridge_ready(&self, run_id: &str) -> Result<bool, String> {
        self.calls
            .borrow_mut()
            .push(format!("bridge_ready:{run_id}"));
        match &self.bridge_error {
            Some(error) => Err(error.clone()),
            None => Ok(self.bridge_ready),
        }
    }

    fn enqueue_agent_control(
        &self,
        run_id: &str,
        model: Option<&str>,
        thinking_level: Option<&str>,
    ) -> Result<i64, String> {
        self.calls.borrow_mut().push(format!(
            "enqueue_agent_control:{run_id}:{model:?}:{thinking_level:?}"
        ));
        Ok(11)
    }

    fn command_state(
        &self,
        run_id: &str,
        command_id: i64,
    ) -> Result<Option<CommandState>, String> {
        self.calls
            .borrow_mut()
            .push(format!("command_state:{run_id}:{command_id}"));
        Ok(Some(self.control_state.clone()))
    }

    fn send(&self, run_id: &str, text: &str) -> Result<i64, String> {
        self.calls
            .borrow_mut()
            .push(format!("send:{run_id}:{text}"));
        self.send.clone()
    }

    fn converge_task(&self, run_id: &str, reason: &str) -> Result<(), String> {
        self.calls
            .borrow_mut()
            .push(format!("converge_task:{run_id}:{reason}"));
        Ok(())
    }

    fn interrupt(&self, run_id: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("interrupt:{run_id}"));
        match &self.interrupt_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }

    fn close(&self, run_id: &str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("close:{run_id}"));
        match &self.close_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

fn request<'a>(run_id: Option<&'a str>, task_row_created: bool) -> DispatchRequest<'a> {
    DispatchRequest {
        project_id: "project-1",
        agent_id: "pi",
        profile: None,
        control_command_id: None,
        work_order: "WORK ORDER",
        run_id,
        task_row_created,
        command_id: None,
        dispatched_at_ms: Some(0),
        now_ms: 1_000,
        bridge_timeout_ms: 20_000,
    }
}

#[test]
fn dispatch_creates_task_row_before_waiting_for_bridge_and_sends_later() {
    let port = FakePort::default();
    assert_eq!(
        dispatch(&port, &request(None, false)),
        Ok(DispatchOutcome::WaitingForBridge {
            run_id: "run-1".into(),
        })
    );
    assert_eq!(
        port.calls.borrow().as_slice(),
        &[
            "start_run:project-1:pi".to_string(),
            "create_task_row:run-1:pi:orchestration".to_string(),
            "bridge_ready:run-1".to_string(),
        ]
    );

    let ready = FakePort {
        bridge_ready: true,
        ..FakePort::default()
    };
    assert_eq!(
        dispatch(&ready, &request(Some("run-1"), true)),
        Ok(DispatchOutcome::Sent {
            run_id: "run-1".into(),
            command_id: 7,
        })
    );
    assert_eq!(
        ready.calls.borrow().as_slice(),
        &[
            "bridge_ready:run-1".to_string(),
            "send:run-1:WORK ORDER".to_string(),
        ]
    );
}

#[test]
fn send_failure_converges_the_just_created_task_row() {
    let port = FakePort {
        bridge_ready: true,
        send: Err("queue full".into()),
        ..FakePort::default()
    };

    assert_eq!(
        dispatch(&port, &request(Some("run-1"), true)),
        Err(DispatchError::SendFailed {
            run_id: "run-1".into(),
            detail: "queue full".into(),
        })
    );
    assert!(port
        .calls
        .borrow()
        .iter()
        .any(|call| call == "converge_task:run-1:send-failed"));
    // M2：失败必须连 run 一起关闭，只收敛任务行会留下孤儿会话占 PTY 槽。
    assert!(port.calls.borrow().iter().any(|call| call == "close:run-1"));
}

#[test]
fn bridge_timeout_converges_and_reports_offline() {
    let port = FakePort::default();
    let mut timed_out = request(Some("run-1"), true);
    timed_out.now_ms = 20_001;

    assert_eq!(
        dispatch(&port, &timed_out),
        Err(DispatchError::BridgeTimeout {
            run_id: "run-1".into(),
        })
    );
    assert!(port
        .calls
        .borrow()
        .iter()
        .any(|call| call == "converge_task:run-1:bridge-offline"));
    assert!(port.calls.borrow().iter().any(|call| call == "close:run-1"));
}

#[test]
fn bridge_probe_failure_is_fail_visible_and_converges() {
    let port = FakePort {
        bridge_error: Some("mirror mode".into()),
        ..FakePort::default()
    };

    assert_eq!(
        dispatch(&port, &request(Some("run-1"), true)),
        Err(DispatchError::BridgeProbeFailed {
            run_id: "run-1".into(),
            detail: "mirror mode".into(),
        })
    );
    assert!(port
        .calls
        .borrow()
        .iter()
        .any(|call| call == "converge_task:run-1:bridge-offline"));
    assert!(port.calls.borrow().iter().any(|call| call == "close:run-1"));
}

#[test]
fn profile_rejection_closes_the_started_run() {
    let port = FakePort {
        bridge_ready: true,
        control_state: CommandState::Failed("model rejected".into()),
        ..FakePort::default()
    };
    let mut request = request(Some("run-1"), true);
    let profile = AgentSnapshot {
        profile_id: "ap-1".into(),
        name: "coder".into(),
        cli: "pi".into(),
        model: Some("vendor/model-x".into()),
        thinking_level: None,
    };
    request.profile = Some(&profile);
    request.control_command_id = Some(11);

    assert_eq!(
        dispatch(&port, &request),
        Err(DispatchError::ProfileApplyFailed {
            run_id: "run-1".into(),
            detail: "model rejected".into(),
        })
    );
    assert!(port.calls.borrow().iter().any(|call| call == "close:run-1"));
}

#[test]
fn an_already_sent_attempt_is_never_resent() {
    let port = FakePort::default();
    let mut sent = request(Some("run-1"), true);
    sent.command_id = Some(42);

    assert_eq!(
        dispatch(&port, &sent),
        Ok(DispatchOutcome::AlreadySent {
            run_id: "run-1".into(),
            command_id: 42,
        })
    );
    assert!(port.calls.borrow().is_empty());
}

#[test]
fn task_row_failure_closes_the_started_run() {
    let port = FakePort {
        create_task_row: Err("db unavailable".into()),
        ..FakePort::default()
    };

    assert_eq!(
        dispatch(&port, &request(None, false)),
        Err(DispatchError::TaskRowFailed {
            run_id: "run-1".into(),
            detail: "db unavailable".into(),
        })
    );
    assert!(port.calls.borrow().iter().any(|call| call == "close:run-1"));
}

#[test]
fn cancel_interrupts_then_force_closes_after_the_grace_period() {
    let port = FakePort::default();

    assert_eq!(
        cancel(&port, "run-1", None, 0),
        CancelOutcome::Interrupted
    );
    assert_eq!(
        port.calls.borrow().as_slice(),
        &["interrupt:run-1".to_string()]
    );

    port.calls.borrow_mut().clear();
    assert_eq!(
        cancel(&port, "run-1", Some(0), 5_000),
        CancelOutcome::WaitingForGrace
    );
    assert!(port.calls.borrow().is_empty());

    assert_eq!(
        cancel(&port, "run-1", Some(0), 10_000),
        CancelOutcome::Closed
    );
    assert_eq!(port.calls.borrow().as_slice(), &["close:run-1".to_string()]);
}

#[test]
fn cancel_degrades_on_missing_run_instead_of_sticking_in_cancelling() {
    // run 已回收 / 宿主重启：interrupt 与 close 都可能硬错误。取消必须仍
    // 能跨越宽限期收敛，否则编排永久停在 Cancelling（H3）。
    let port = FakePort {
        interrupt_error: Some("run not found".into()),
        ..FakePort::default()
    };
    assert_eq!(
        cancel(&port, "run-1", None, 0),
        CancelOutcome::Degraded {
            action: "interrupt",
            detail: "run not found".into(),
            closed: false,
        }
    );
    assert_eq!(
        cancel(&port, "run-1", Some(0), 5_000),
        CancelOutcome::WaitingForGrace
    );
    assert_eq!(
        cancel(&port, "run-1", Some(0), 10_000),
        CancelOutcome::Closed
    );

    let port = FakePort {
        close_error: Some("already gone".into()),
        ..FakePort::default()
    };
    assert_eq!(
        cancel(&port, "run-1", Some(0), 10_000),
        CancelOutcome::Degraded {
            action: "close",
            detail: "already gone".into(),
            closed: true,
        }
    );
}

fn profile() -> AgentSnapshot {
    AgentSnapshot {
        profile_id: "ap-1".into(),
        name: "实现".into(),
        cli: "pi".into(),
        model: Some("m1".into()),
        thinking_level: Some("high".into()),
    }
}

#[test]
fn profile_control_is_applied_before_the_work_order() {
    let port = FakePort {
        bridge_ready: true,
        ..FakePort::default()
    };
    let profile = profile();
    let mut req = request(Some("run-1"), true);
    req.profile = Some(&profile);

    assert_eq!(
        dispatch(&port, &req),
        Ok(DispatchOutcome::WaitingForProfile {
            run_id: "run-1".into(),
            command_id: 11,
        })
    );
    assert_eq!(
        port.calls.borrow().as_slice(),
        &[
            "bridge_ready:run-1".to_string(),
            "enqueue_agent_control:run-1:Some(\"m1\"):Some(\"high\")".to_string(),
        ],
        "profile command must be enqueued before send"
    );

    let mut resumed = request(Some("run-1"), true);
    resumed.profile = Some(&profile);
    resumed.control_command_id = Some(11);
    assert_eq!(
        dispatch(&port, &resumed),
        Ok(DispatchOutcome::Sent {
            run_id: "run-1".into(),
            command_id: 7,
        })
    );
    assert_eq!(
        port.calls.borrow().as_slice(),
        &[
            "bridge_ready:run-1".to_string(),
            "enqueue_agent_control:run-1:Some(\"m1\"):Some(\"high\")".to_string(),
            "bridge_ready:run-1".to_string(),
            "command_state:run-1:11".to_string(),
            "send:run-1:WORK ORDER".to_string(),
        ]
    );
}

#[test]
fn failed_profile_control_never_sends_the_work_order() {
    let port = FakePort {
        bridge_ready: true,
        control_state: CommandState::Failed("model auth not configured".into()),
        ..FakePort::default()
    };
    let profile = profile();
    let mut req = request(Some("run-1"), true);
    req.profile = Some(&profile);
    req.control_command_id = Some(11);

    assert_eq!(
        dispatch(&port, &req),
        Err(DispatchError::ProfileApplyFailed {
            run_id: "run-1".into(),
            detail: "model auth not configured".into(),
        })
    );
    assert!(
        !port
            .calls
            .borrow()
            .iter()
            .any(|call| call.starts_with("send:")),
        "a failed profile must not fall back to the default model"
    );
}
