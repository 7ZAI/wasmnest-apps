//! 服务任务表：本地任务映射宿主机任务，远端任务在提交时同步完成
//!
//! 任务表住 wasm 内存（停用即丢）；元数据由 [`crate::records`] 持久化。
//! 本地任务轮询 host-stt 的 `job-status / job-result` 并同步状态。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use wasmnest_plugin_api::host::HostLog;
use wasmnest_plugin_api::WasmHost;

use crate::host;
use crate::records::{self, RecordEntry};

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JobState {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    fn is_finished(self) -> bool {
        !matches!(self, Self::Running)
    }
}

#[derive(Debug, Clone)]
struct JobEntry {
    id: String,
    channel: String,
    state: JobState,
    model_id: String,
    language: Option<String>,
    text: String,
    segments: Vec<Value>,
    error_kind: Option<String>,
    error_message: Option<String>,
    elapsed_ms: u64,
    audio_bytes: u64,
    caller_tag: Option<String>,
    created_at: u64,
    host_job_id: Option<String>,
    recorded: bool,
}

static JOBS: OnceLock<Mutex<HashMap<String, JobEntry>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn jobs() -> &'static Mutex<HashMap<String, JobEntry>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, JobEntry>> {
    jobs().lock().unwrap_or_else(|err| err.into_inner())
}

fn next_job_id() -> String {
    format!("sp-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

/// 登记一个本地任务（host-stt job 已提交）
pub fn insert_local(
    host_job_id: String,
    model_id: String,
    language: Option<String>,
    audio_bytes: u64,
    caller_tag: Option<String>,
) -> String {
    let id = next_job_id();
    lock().insert(
        id.clone(),
        JobEntry {
            id: id.clone(),
            channel: "local".to_string(),
            state: JobState::Running,
            model_id,
            language,
            text: String::new(),
            segments: Vec::new(),
            error_kind: None,
            error_message: None,
            elapsed_ms: 0,
            audio_bytes,
            caller_tag,
            created_at: records::now_ms(),
            host_job_id: Some(host_job_id),
            recorded: false,
        },
    );
    id
}

/// 登记一个远端任务（同步完成或失败）
#[allow(clippy::too_many_arguments)]
pub fn insert_remote(
    state: &str,
    model_id: String,
    language: Option<String>,
    text: String,
    segments: Vec<Value>,
    error: Option<(String, String)>,
    elapsed_ms: u64,
    audio_bytes: u64,
    caller_tag: Option<String>,
) -> String {
    let id = next_job_id();
    let state = match state {
        "completed" => JobState::Completed,
        "failed" => JobState::Failed,
        "cancelled" => JobState::Cancelled,
        _ => JobState::Running,
    };
    lock().insert(
        id.clone(),
        JobEntry {
            id: id.clone(),
            channel: "remote".to_string(),
            state,
            model_id,
            language,
            text,
            segments,
            error_kind: error.as_ref().map(|(kind, _)| kind.clone()),
            error_message: error.map(|(_, message)| message),
            elapsed_ms,
            audio_bytes,
            caller_tag,
            created_at: records::now_ms(),
            host_job_id: None,
            recorded: false,
        },
    );
    id
}

/// 任务视图（状态 + 结果/错误）
pub fn status(job_id: &str) -> Result<Value, String> {
    sync_local(job_id)?;
    let snapshot = {
        let jobs = lock();
        jobs.get(job_id)
            .cloned()
            .ok_or_else(|| format!("job not found: {job_id}"))?
    };
    record_if_finished(&snapshot);
    Ok(view(&snapshot))
}

/// 取消任务
pub fn cancel(job_id: &str) -> Result<Value, String> {
    let snapshot = {
        let jobs = lock();
        jobs.get(job_id)
            .cloned()
            .ok_or_else(|| format!("job not found: {job_id}"))?
    };
    if snapshot.channel != "local" {
        return Ok(json!({ "jobId": job_id, "cancelled": false, "state": snapshot.state.as_str() }));
    }
    if !snapshot.state.is_finished() {
        if let Some(host_job) = snapshot.host_job_id.as_deref() {
            let cancelled = host::job_cancel(host_job).unwrap_or(false);
            if let Some(job) = lock().get_mut(job_id) {
                if cancelled {
                    job.state = JobState::Cancelled;
                }
            }
        }
    }
    let state = lock()
        .get(job_id)
        .map(|job| job.state.as_str())
        .unwrap_or("unknown");
    Ok(json!({ "jobId": job_id, "cancelled": true, "state": state }))
}

fn sync_local(job_id: &str) -> Result<(), String> {
    let snapshot = {
        let jobs = lock();
        match jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return Err(format!("job not found: {job_id}")),
        }
    };
    if snapshot.channel != "local" || snapshot.state.is_finished() {
        return Ok(());
    }
    let Some(host_job) = snapshot.host_job_id.as_deref() else {
        return Ok(());
    };
    let status = host::job_status(host_job)?;
    let state = status
        .get("state")
        .and_then(|value| value.as_str())
        .unwrap_or("running");
    let elapsed = status
        .get("elapsedMs")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    match state {
        "completed" => {
            let result = host::job_result(host_job)?;
            let text = result
                .get("text")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let language = result
                .get("language")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| snapshot.language.clone());
            let segments = result
                .get("segments")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            if let Some(job) = lock().get_mut(job_id) {
                job.state = JobState::Completed;
                job.text = text;
                job.language = language;
                job.segments = segments;
                job.elapsed_ms = elapsed;
            }
        }
        "failed" => {
            let error = status.get("error").cloned().unwrap_or(Value::Null);
            if let Some(job) = lock().get_mut(job_id) {
                job.state = JobState::Failed;
                job.error_kind = error
                    .get("kind")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                job.error_message = error
                    .get("message")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
                job.elapsed_ms = elapsed;
            }
        }
        "cancelled" => {
            if let Some(job) = lock().get_mut(job_id) {
                job.state = JobState::Cancelled;
                job.elapsed_ms = elapsed;
            }
        }
        _ => {
            if let Some(job) = lock().get_mut(job_id) {
                job.elapsed_ms = elapsed;
            }
        }
    }
    Ok(())
}

fn view(job: &JobEntry) -> Value {
    json!({
        "jobId": job.id,
        "state": job.state.as_str(),
        "channel": job.channel,
        "modelId": job.model_id,
        "language": job.language,
        "text": if job.state == JobState::Completed { Value::String(job.text.clone()) } else { Value::Null },
        "segments": if job.state == JobState::Completed { Value::Array(job.segments.clone()) } else { Value::Array(Vec::new()) },
        "error": if job.state == JobState::Failed {
            json!({
                "kind": job.error_kind.clone().unwrap_or_else(|| "internal".to_string()),
                "message": job.error_message.clone().unwrap_or_default(),
            })
        } else { Value::Null },
        "elapsedMs": job.elapsed_ms,
        "audioBytes": job.audio_bytes,
    })
}

fn record_if_finished(job: &JobEntry) {
    if !job.state.is_finished() || job.recorded {
        return;
    }
    let entry = RecordEntry {
        id: job.id.clone(),
        created_at: job.created_at,
        channel: job.channel.clone(),
        model_id: job.model_id.clone(),
        language: job.language.clone(),
        audio_bytes: job.audio_bytes,
        text_chars: job.text.chars().count() as u64,
        elapsed_ms: job.elapsed_ms,
        error_kind: job.error_kind.clone(),
        caller_tag: job.caller_tag.clone(),
    };
    records::append(entry);
    if let Some(stored) = lock().get_mut(&job.id) {
        stored.recorded = true;
    }
    WasmHost.log_info(&format!(
        "speech job finished: id={} channel={} state={}",
        job.id,
        job.channel,
        job.state.as_str()
    ));
}