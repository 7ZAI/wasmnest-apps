//! 任务日志详情（任务行 → CLI 会话转写：对话事件流 + 原始 JSONL）
//!
//! 任务行（`task_history`）只记录「哪个任务、哪个会话、花了多少 token」，**不存
//! 对话**。对话真源是 CLI 自己写的会话记录（claude/pi/codex 的 JSONL、opencode
//! 的 SQLite），由 Agent 管理的会话日志域（`hub::usage`）索引与解析。
//!
//! 本模块只做 **session id 解析**，解析到后委派
//! `crate::hub::usage::read_session_by_cli_id`——与 Agent 管理日志页读同一份真源、
//! 同一条解析路径，不维护第二套转写解析。
//!
//! # id 解析顺序（先权威、后兼容）
//! 1. **宿主运行记录**（`session::record_via_host(task.session_id)` 的
//!    `agent_session_id`）：桥接型 agent（pi / opencode）由 session.meta 事件回填，
//!    是真正的 CLI 会话 id；
//! 2. **任务行的 `claude_sid`**：claude 的 hook 上报的就是 Claude Code 会话 id
//!    （权威）；pi / opencode / codex 的 hook 只上报宿主 PTY 会话 id（历史口径），
//!    这一档对它们通常查不到索引，仅作兜底。
//!
//! # 失败分类（fail-visible）
//! 解析不到 / 索引不到 / 读不出来是三种不同成因，一律用机器可读 `reason` 分开
//! 返回，**不拿空事件流冒充「该会话没有内容」**：
//! - `no-cli-session`：没有可用的 CLI 会话 id（旧任务行 / 未上报会话 id 的 agent）
//! - `not-indexed`：有 CLI 会话 id，但会话日志索引里没有（尚未扫描 / 已被清理）
//! - `unreadable`：索引里有会话，但源文件 / 库读不出来（被删 / sqlite3 缺失）
//!
//! 详情永远是「只读回看」：本模块不写任何表、不改任务状态。

use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostLog, HostPluginDatabase};
use wasmnest_plugin_api::sql_params;
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 返回给前端的原因码（`reason` 字段；null = 成功读到对话）
pub(crate) const REASON_NO_CLI_SESSION: &str = "no-cli-session";
pub(crate) const REASON_NOT_INDEXED: &str = "not-indexed";
pub(crate) const REASON_UNREADABLE: &str = "unreadable";

/// 一次解析尝试的输入（纯数据，便于 native 单测）
pub(crate) struct ResolutionInput<'a> {
    /// 任务行的 agent（adapter id；可能为空）
    pub(crate) task_agent: &'a str,
    /// 任务行的 `claude_sid`（claude 是 CLI 会话 id；其余是历史口径的宿主会话 id）
    pub(crate) claude_sid: &'a str,
    /// 宿主运行记录的 (agent_id, agent_session_id)（运行记录不存在时为 None）
    pub(crate) run: Option<(Option<&'a str>, Option<&'a str>)>,
}

/// 解析结果：适配器 + CLI 会话 id 候选（按可信度排序，去重）
pub(crate) struct Resolution {
    pub(crate) adapter: String,
    pub(crate) candidates: Vec<(String, &'static str)>,
}

/// 纯解析：任务行 + 运行记录 → (adapter, CLI 会话 id 候选)
///
/// 候选顺序 = 可信度顺序：运行记录的 `agent_session_id` 先于任务行的
/// `claude_sid`（后者对 pi/opencode/codex 是宿主会话 id，只有 claude 是真 id）。
/// 空值一律不产生候选；重复值只保留先出现的一档。
pub(crate) fn resolve_cli_ids(input: &ResolutionInput<'_>) -> Resolution {
    let (run_agent, run_cli) = input.run.unwrap_or((None, None));
    let adapter = if !input.task_agent.trim().is_empty() {
        input.task_agent.trim().to_string()
    } else {
        run_agent.unwrap_or("").trim().to_string()
    };
    let mut candidates: Vec<(String, &'static str)> = Vec::new();
    let run_cli = run_cli.unwrap_or("").trim();
    if !run_cli.is_empty() {
        candidates.push((run_cli.to_string(), "run"));
    }
    let claude_sid = input.claude_sid.trim();
    if !claude_sid.is_empty() && !candidates.iter().any(|(id, _)| id == claude_sid) {
        candidates.push((claude_sid.to_string(), "claude_sid"));
    }
    Resolution {
        adapter,
        candidates,
    }
}

/// 「唯一候选其实是宿主会话 id」判定
///
/// pi / opencode / codex 的 hook / 桥接历史口径只上报宿主 PTY 会话 id（作为
/// `task_history.claude_sid`）；claude 例外——它的 hook 上报的就是 Claude Code
/// 会话 id。故非 claude 适配器只有 `claude_sid` 一档候选时，那并不是 CLI 会话
/// id：扫描也查不到，恢复命令更是错的。这种行如实落 `no-cli-session`，不误导成
/// 「未索引」、也不提供 resume。
pub(crate) fn host_sid_only(adapter: &str, candidates: &[(String, &'static str)]) -> bool {
    matches!(adapter, "pi" | "opencode" | "codex")
        && candidates.len() == 1
        && candidates[0].1 == "claude_sid"
}

/// 任务日志详情：`{ task_id }` → 任务行 + 解析出的 CLI 会话 + 转写（或原因码）
///
/// 成功（`reason: null`）时 `log` 是 `read-session` 的同形状载荷（会话行 + 事件流
/// + 原始行），前端与 Agent 管理日志详情共用同一套渲染。任何可预期的「看不到
/// 内容」都走 `reason` 分支而不是命令失败——命令失败只留给真正的程序错误。
pub fn read_task_log(host: &WasmHost, task_id: &str) -> anyhow::Result<Value> {
    let row = host
        .plugin_db_query_params(
            "SELECT id, description, status, agent, source, session_id, claude_sid, \
                    working_dir, exit_reason, created_at, started_at, completed_at, \
                    input_tokens, output_tokens \
             FROM task_history WHERE id = ?1",
            &sql_params![task_id],
        )
        .map_err(|e| anyhow::anyhow!("log-session: task query failed: {e}"))?
        .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
        .ok_or_else(|| anyhow::anyhow!("log-session: task {task_id} not found"))?;

    let field = |key: &str| row.get(key).and_then(|v| v.as_str()).unwrap_or("");
    let task_agent = field("agent");
    let claude_sid = field("claude_sid");
    let session_id = field("session_id");

    // 运行记录可能已删除（会话被移除 / 旧库迁移）：读不到就退化为「只有任务行」，
    // 不把取数失败当成命令失败（详情仍应能展示任务元数据）。
    let run = if session_id.is_empty() {
        None
    } else {
        match crate::session::record_via_host(session_id) {
            Ok(Some(record)) => Some(record),
            Ok(None) => None,
            Err(e) => {
                host.log_warn(&format!(
                    "log-session: session record unavailable for {session_id}: {e}"
                ));
                None
            }
        }
    };
    let resolution = resolve_cli_ids(&ResolutionInput {
        task_agent,
        claude_sid,
        run: run
            .as_ref()
            .map(|r| (r.agent_id.as_deref(), r.agent_session_id.as_deref())),
    });

    // 非 claude 的「只有宿主会话 id」不是可用的 CLI 会话 id：不给出可恢复的空承诺
    let host_sid_only = host_sid_only(&resolution.adapter, &resolution.candidates);
    let base = json!({
        "task": row,
        "adapter": resolution.adapter,
        "cliSessionId": if host_sid_only {
            String::new()
        } else {
            resolution.candidates.first().map(|(id, _)| id.clone()).unwrap_or_default()
        },
        "resolvedBy": if host_sid_only {
            "none"
        } else {
            resolution.candidates.first().map(|(_, by)| *by).unwrap_or("none")
        },
    });
    let with = |reason: Option<&str>, log: Option<Value>| {
        let mut out = base.clone();
        out["reason"] = json!(reason);
        out["log"] = log.unwrap_or(Value::Null);
        out
    };

    if resolution.adapter.is_empty() || resolution.candidates.is_empty() || host_sid_only {
        return Ok(with(Some(REASON_NO_CLI_SESSION), None));
    }

    for (cli_id, by) in &resolution.candidates {
        // 命中哪一档就把该档如实写回（`resolvedBy` 不是「猜测顺序」，而是实际
        // 用于定位的那一档）：第一档可能在索引里查不到、由第二档兜底命中。
        let hit = |reason: Option<&str>, log: Option<Value>| {
            let mut out = with(reason, log);
            if !cli_id.is_empty() {
                out["cliSessionId"] = json!(cli_id);
                out["resolvedBy"] = json!(by);
            }
            out
        };
        match crate::hub::usage::read_session_by_cli_id(host, &resolution.adapter, cli_id) {
            Ok(Some(log)) => return Ok(hit(None, Some(log))),
            Ok(None) => continue, // 未索引：继续试下一档候选
            Err(e) => {
                // 索引命中但读不出来（源文件被删 / sqlite3 缺失）：已经定位到具体
                // 会话，不再试其它候选，显性归类（原文只进插件日志，ADR 0030）。
                host.log_warn(&format!(
                    "log-session: read transcript failed (adapter={}, cli={cli_id}): {e}",
                    resolution.adapter
                ));
                return Ok(hit(Some(REASON_UNREADABLE), None));
            }
        }
    }
    Ok(with(Some(REASON_NOT_INDEXED), None))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input<'a>(
        task_agent: &'a str,
        claude_sid: &'a str,
        run: Option<(Option<&'a str>, Option<&'a str>)>,
    ) -> ResolutionInput<'a> {
        ResolutionInput {
            task_agent,
            claude_sid,
            run,
        }
    }

    /// 桥接型 agent（pi/opencode）：运行记录的 agent_session_id 优先于任务行的
    /// 宿主会话 id（任务行 claude_sid 对它们是历史口径，不能当 CLI id 用）。
    #[test]
    fn run_meta_session_id_outranks_task_claude_sid() {
        let r = resolve_cli_ids(&input(
            "pi",
            "host-session-uuid",
            Some((Some("pi"), Some("01a1-pi-cli"))),
        ));
        assert_eq!(r.adapter, "pi");
        assert_eq!(
            r.candidates,
            vec![
                ("01a1-pi-cli".to_string(), "run"),
                ("host-session-uuid".to_string(), "claude_sid"),
            ]
        );
    }

    /// claude 没有桥接：运行记录 agent_session_id 为空，任务行 claude_sid 就是
    /// CLI 会话 id（权威）。
    #[test]
    fn claude_falls_back_to_task_claude_sid() {
        let r = resolve_cli_ids(&input("claude", "c-123", Some((Some("claude"), None))));
        assert_eq!(r.adapter, "claude");
        assert_eq!(r.candidates, vec![("c-123".to_string(), "claude_sid")]);
    }

    /// 没有运行记录（旧任务行 / 会话已被移除）时，只有任务行 claude_sid 一档。
    #[test]
    fn missing_run_record_keeps_task_claude_sid() {
        let r = resolve_cli_ids(&input("codex", "t-9", None));
        assert_eq!(r.adapter, "codex");
        assert_eq!(r.candidates, vec![("t-9".to_string(), "claude_sid")]);
    }

    /// 任务行 agent 为空时用运行记录的 agent_id 兜底；两边都没有就是空适配器
    /// （调用方据此落 `no-cli-session`，不猜一家去查）。
    #[test]
    fn adapter_falls_back_to_run_agent_then_empty() {
        let r = resolve_cli_ids(&input("", "c-1", Some((Some("opencode"), None))));
        assert_eq!(r.adapter, "opencode");
        let r = resolve_cli_ids(&input("  ", "c-1", Some((None, None))));
        assert_eq!(r.adapter, "");
    }

    /// 候选去重：运行记录与任务行是同一个 id 时只保留「运行记录」这一档。
    #[test]
    fn duplicate_candidate_keeps_first_tier() {
        let r = resolve_cli_ids(&input(
            "claude",
            "same-id",
            Some((Some("claude"), Some("same-id"))),
        ));
        assert_eq!(r.candidates, vec![("same-id".to_string(), "run")]);
    }

    /// 空值不产生候选（空 agent、空 id 都不许进查询，避免 "查一个空串" 伪命中）。
    #[test]
    fn empty_values_produce_no_candidates() {
        let r = resolve_cli_ids(&input("pi", "  ", Some((Some("pi"), Some("")))));
        assert!(r.candidates.is_empty());
    }

    /// 非 claude 的 pi/opencode/codex：任务行 claude_sid 是宿主 PTY 会话 id，
    /// 「只有这一档候选」= 没有可用的 CLI 会话 id（不能当未索引、更不能拿去 resume）。
    #[test]
    fn host_sid_only_for_bridge_agents() {
        for agent in ["pi", "opencode", "codex"] {
            let r = resolve_cli_ids(&input(agent, "host-sid", Some((Some(agent), None))));
            assert!(
                host_sid_only(agent, &r.candidates),
                "{agent} 只有 claude_sid 时应判定为宿主会话 id"
            );
        }
    }

    /// claude 的 claude_sid 就是 CLI 会话 id：不算宿主 id（未索引仍可扫描救回）；
    /// 有运行记录兜底时也不算（那一档是真 CLI 会话 id）。
    #[test]
    fn host_sid_only_excludes_claude_and_run_meta() {
        let claude = resolve_cli_ids(&input("claude", "c-1", Some((Some("claude"), None))));
        assert!(!host_sid_only("claude", &claude.candidates));
        let pi = resolve_cli_ids(&input(
            "pi",
            "host-sid",
            Some((Some("pi"), Some("01a1-cli"))),
        ));
        assert!(!host_sid_only("pi", &pi.candidates));
    }
}
