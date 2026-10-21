//! 适配器分派 + 水位/会话落库 + SQLite 源同步
//!
//! 内置格式解析器与嗅探由适配器声明（[`crate::agents`] 的 `Agent::usage()`），
//! 自定义来源走内容嗅探；水位以 size（JSONL append-only 语义）/ signature
//! （SQLite 变化指纹）判定；SQLite 源（opencode）不进文件枚举，在 JSONL
//! 回灌后同步补一轮，失败隔离只置该槽位 error 态（带机器可读 code，前端 i18n）。

use super::contract::SqliteUsage;
use super::usage_spec;
use crate::agents;
use crate::usage_parse::ParsedSession;
use serde_json::{json, Value};
use wasmnest_plugin_api::host::{HostLog, HostPluginDatabase};
use wasmnest_plugin_api::sql_params;
use wasmnest_plugin_api::wasm_host::WasmHost;

// ==================== 适配器分派 ====================

/// 按适配器名分派解析（扫描回灌与会话日志打开共用）：注册表声明了解析器的
/// 内置格式直连解析，其余（未知 / 自定义来源 / SQLite 源）走内容嗅探降级
pub(super) fn parse_by_adapter(adapter: &str, content: &str) -> Option<ParsedSession> {
    if let Some(parse) = usage_spec(adapter).and_then(|s| s.parse_jsonl) {
        return Some(parse(content));
    }
    Some(parse_sniffed_session(content))
}

/// 自定义来源格式嗅探：按适配器声明的顺序（`sniff_rank`，pi 先于 claude）
/// 逐个判定内容 head，命中即用该适配器的解析器；其余未知格式退化为空事件
/// 会话（cli_session_id 由调用方按文件名补足，详情仅原始行可读）。
pub(super) fn parse_sniffed_session(content: &str) -> ParsedSession {
    let head: Vec<&str> = content.lines().take(64).collect();
    let mut sniffs: Vec<(u8, fn(&[&str]) -> bool, fn(&str) -> ParsedSession)> = agents::all()
        .iter()
        .filter_map(|a| a.usage())
        .filter_map(|s| match (s.sniff, s.parse_jsonl) {
            (Some(sniff), Some(parse)) => Some((s.sniff_rank, sniff, parse)),
            _ => None,
        })
        .collect();
    sniffs.sort_by_key(|(rank, _, _)| *rank);
    for (_, sniff, parse) in sniffs {
        if sniff(&head) {
            return parse(content);
        }
    }
    ParsedSession::default()
}

/// 路径文件名兜底会话 id/标题（去 .jsonl 后缀；未知/损坏路径返回 None）
pub(super) fn file_stem(path: &str) -> Option<&str> {
    let base = path.rsplit(['/', '\\']).next()?;
    let stem = base.strip_suffix(".jsonl").unwrap_or(base);
    if stem.is_empty() {
        None
    } else {
        Some(stem)
    }
}

/// 水位判定：同 (adapter, path) 的已记录 size 与当前一致 → 无需重解析
pub(super) fn watermark_unchanged(h: &WasmHost, adapter: &str, path: &str, size: usize) -> bool {
    h.plugin_db_query_params(
        "SELECT size FROM parse_watermark WHERE adapter = ?1 AND source_path = ?2",
        &sql_params![adapter, path],
    )
    .ok()
    .flatten()
    .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
    .and_then(|row| row.get("size").and_then(|s| s.as_i64()))
    .map(|prev| prev == size as i64)
    .unwrap_or(false)
}

/// 水位落库：先 UPDATE 后 INSERT（同 upsert_session 的单语句兼容策略）
pub(super) fn upsert_watermark(h: &WasmHost, adapter: &str, path: &str, size: usize, now: u64) {
    let params = sql_params![adapter, path, size as i64, now as i64];
    let affected = h
        .plugin_db_execute_params(
            "UPDATE parse_watermark SET size = ?3, parsed_at = ?4 WHERE adapter = ?1 AND source_path = ?2",
            &params,
        )
        .unwrap_or(0);
    if affected == 0 {
        // INSERT 失败仅影响下轮重解析（水位幂等性降级为「多算一轮」），warn 留痕
        if let Err(e) = h.plugin_db_execute_params(
            "INSERT INTO parse_watermark (adapter, source_path, size, mtime, parsed_at) VALUES (?1, ?2, ?3, NULL, ?4)",
            &params,
        ) {
            h.log_warn(&format!("usage: watermark insert failed: {e}"));
        }
    }
}

/// 会话聚合落库：先 UPDATE 后 INSERT，返回本文件贡献的会话数（空会话——
/// 无 cli_session_id——丢弃，不产生记录）
pub(super) fn upsert_session(
    h: &WasmHost,
    adapter: &str,
    path: &str,
    parsed: &ParsedSession,
    now: u64,
) -> u32 {
    // 无会话 id 的文件（如仅剩损坏行）不入库，但水位仍推进（内容没变就不会变好）
    if parsed.cli_session_id.is_empty() {
        return 0;
    }
    let started = parsed.started_at.unwrap_or(0);
    let ended = parsed.ended_at.unwrap_or(started);
    let duration = (ended.saturating_sub(started)).max(0);
    let dominant = parsed.dominant_model().unwrap_or("unknown");
    let models_json = serde_json::to_string(&parsed.models).unwrap_or_else(|_| "[]".to_string());
    let cost = parsed.cost_total;
    // UPDATE 与 INSERT 共用同一参数序列（?1..?17，INSERT 的 first_seen_at
    // 与 updated_at 共用 ?17）
    let params = sql_params![
        adapter,
        parsed.cli_session_id,
        parsed.project,
        parsed.title,
        path,
        started,
        ended,
        duration,
        dominant,
        models_json,
        parsed.tokens.input,
        parsed.tokens.output,
        parsed.tokens.cache_read,
        parsed.tokens.cache_write,
        parsed.tokens.reasoning,
        cost,
        now as i64,
    ];

    let affected = h
        .plugin_db_execute_params(
            "UPDATE usage_session SET project = ?3, title = ?4, source_path = ?5, \
                 started_at = ?6, ended_at = ?7, duration_ms = ?8, model = ?9, models_json = ?10, \
                 tokens_in = ?11, tokens_out = ?12, tokens_cache_read = ?13, tokens_cache_write = ?14, \
                 tokens_reasoning = ?15, cost_total = ?16, updated_at = ?17 \
             WHERE adapter = ?1 AND cli_session_id = ?2",
            &params,
        )
        .unwrap_or(0);
    if affected > 0 {
        return 0; // 更新既有行，不新增会话
    }
    let inserted = h
        .plugin_db_execute_params(
            "INSERT INTO usage_session (adapter, cli_session_id, project, title, source_path, \
                 started_at, ended_at, duration_ms, model, models_json, \
                 tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, tokens_reasoning, \
                 cost_total, first_seen_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
            &params,
        )
        .unwrap_or(0);
    if inserted > 0 {
        1
    } else {
        0
    }
}

/// 遍历注册表声明的 SQLite 源并逐源同步（当前唯一内置源 = opencode）
///
/// 幂等靠**变化指纹**（`{db 字节}:{wal 字节}`，见 [`crate::usage_sqlite::signature`]）：
/// 指纹未变则整轮跳过（不跑 sqlite3），变了则全量重拉并逐会话 upsert
/// （`UNIQUE(adapter, cli_session_id)` 保证重复扫描不产生重复会话）。
///
/// 与 JSONL 路径不同：库里没有「本会话的源文件」概念，源路径统一记库文件
/// 路径（供日志页展示与 SQLite 分支重查）。
pub(super) fn sync_sqlite_sources(h: &WasmHost, state: &mut Value, now: u64) {
    let home = crate::HOME.get().map(|s| s.as_str()).unwrap_or("");
    for agent in agents::all().iter().copied() {
        let Some(spec) = agent.usage() else {
            continue;
        };
        let Some(engine) = spec.sqlite else {
            continue;
        };
        let db = format!("{home}/{}", spec.source.seg());
        sync_sqlite_source(h, agent.id(), &db, &engine, state, now);
    }
}

/// 单个 SQLite 源同步：**直接写 `state.adapters.<id>` 整槽**，不进
/// `per_adapter`（后者是「文件枚举口径」的累加器，SQLite 源不是文件源，
/// 混进去会让 files/parsed 口径失真）。错误分类三种各有机器可读 code 写入
/// `error` 字段——**不静默吞错**（spec §8 fail-visible：宁可显式报错也不要
/// 「永远没数据且无解释」）。
///
/// 错误轮次**保留上轮的 sessions 计数**：列表仍能展示旧数据，只是标明
/// 「本轮未刷新」，而不是把已有数据抹成 0。
fn sync_sqlite_source(
    h: &WasmHost,
    adapter: &str,
    db: &str,
    engine: &SqliteUsage,
    state: &mut Value,
    now: u64,
) {
    let (files, skipped) = (0u32, 0u32);
    // 库不存在（CLI 未装 / 从未跑过）——不是错误，是常态
    let Some(sig) = crate::usage_sqlite::signature(h, db) else {
        write_sqlite_slot(state, adapter, None, 0, 0, files, skipped);
        return;
    };
    if watermark_signature_matches(h, adapter, db, &sig) {
        // 水位未变：沿用上轮会话数（不重跑 sqlite3），计入「已同步」水位
        let prev = sqlite_slot(state, adapter)
            .and_then(|s| s.get("sessions"))
            .and_then(|s| s.as_u64())
            .unwrap_or(0);
        write_sqlite_slot(state, adapter, None, prev as u32, 0, files, 1);
        return;
    }
    let sessions = match (engine.collect)(h, db) {
        Ok(s) => s,
        Err(e) => {
            h.log_warn(&format!("usage: {adapter} sqlite sync failed: {e:?}"));
            let prev = sqlite_slot(state, adapter)
                .and_then(|s| s.get("sessions"))
                .and_then(|s| s.as_u64())
                .unwrap_or(0);
            write_sqlite_slot(
                state,
                adapter,
                Some(e.code()),
                prev as u32,
                0,
                files,
                skipped,
            );
            return;
        }
    };
    let mut added = 0u32;
    for parsed in &sessions {
        added += upsert_session(h, adapter, db, parsed, now);
    }
    upsert_watermark_signature(h, adapter, db, &sig, now);
    h.log_info(&format!(
        "usage: {adapter} sessions imported, total = {}, added = {added}",
        sessions.len()
    ));
    write_sqlite_slot(
        state,
        adapter,
        None,
        added,
        sessions.len() as u32,
        files,
        skipped,
    );
}

/// SQLite 源适配器槽位（可变）
fn sqlite_slot_mut<'a>(state: &'a mut Value, adapter: &str) -> Option<&'a mut Value> {
    state.get_mut("adapters")?.as_object_mut()?.get_mut(adapter)
}

/// SQLite 源适配器槽位（只读）
pub(super) fn sqlite_slot<'a>(state: &'a Value, adapter: &str) -> Option<&'a Value> {
    state.get("adapters")?.as_object()?.get(adapter)
}

/// 整体写回 SQLite 源槽位（口径：files 恒 0——它不是文件枚举源；
/// `parsed` = 本轮解析的会话数，`sessions` = 本轮新增的会话数，
/// `skipped` = 水位未变而跳过的轮次）
pub(super) fn write_sqlite_slot(
    state: &mut Value,
    adapter: &str,
    error: Option<&str>,
    sessions: u32,
    parsed: u32,
    files: u32,
    skipped: u32,
) {
    if let Some(slot) = sqlite_slot_mut(state, adapter) {
        *slot = json!({
            "files": files,
            "parsed": parsed,
            "skipped": skipped,
            "sessions": sessions,
            "error": error,
        });
    }
}

/// SQLite 源水位判定：同 (adapter, path) 的 `signature` 与当前一致 → 无需重拉
fn watermark_signature_matches(h: &WasmHost, adapter: &str, path: &str, sig: &str) -> bool {
    h.plugin_db_query_params(
        "SELECT signature FROM parse_watermark WHERE adapter = ?1 AND source_path = ?2",
        &sql_params![adapter, path],
    )
    .ok()
    .flatten()
    .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
    .and_then(|row| {
        row.get("signature")
            .and_then(|s| s.as_str())
            .map(|s| s == sig)
    })
    .unwrap_or(false)
}

/// SQLite 源水位落库：先 UPDATE 后 INSERT（同 upsert_session 的单语句兼容策略）
fn upsert_watermark_signature(h: &WasmHost, adapter: &str, path: &str, sig: &str, now: u64) {
    let params = sql_params![adapter, path, sig, now as i64];
    let affected = h
        .plugin_db_execute_params(
            "UPDATE parse_watermark SET signature = ?3, parsed_at = ?4 WHERE adapter = ?1 AND source_path = ?2",
            &params,
        )
        .unwrap_or(0);
    if affected == 0 {
        // INSERT 失败仅影响下轮重拉（幂等性降级为「多拉一轮」），warn 留痕
        if let Err(e) = h.plugin_db_execute_params(
            "INSERT INTO parse_watermark (adapter, source_path, size, mtime, parsed_at, signature) \
             VALUES (?1, ?2, NULL, NULL, ?4, ?3)",
            &params,
        ) {
            h.log_warn(&format!("usage: watermark signature insert failed: {e}"));
        }
    }
}

// ==================== Tests（纯函数单测） ====================

#[cfg(test)]
mod tests {
    use super::super::default_state;
    use super::*;

    /// 文件名兜底：去 .jsonl 后缀、合法 stem、损坏路径 None
    #[test]
    fn session_file_stem() {
        assert_eq!(file_stem("/a/b/2024-01-01.jsonl"), Some("2024-01-01"));
        assert_eq!(file_stem("C:\\x\\y.jsonl"), Some("y"));
        assert_eq!(file_stem("/a/.jsonl"), None);
        assert_eq!(file_stem(""), None);
    }

    /// 格式嗅探：pi / claude 标记命中各自解析器，未知格式退化为空事件会话
    #[test]
    fn sniffed_session_formats() {
        // pi：顶层 type=message
        let pi = parse_sniffed_session(
            "{\"type\":\"session\",\"id\":\"s1\"}\n{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}\n",
        );
        assert_eq!(pi.cli_session_id, "s1");
        assert!(pi.events.len() >= 1);

        // claude：顶层 type=user / assistant（真实数据 user content 为字符串）
        let claude = parse_sniffed_session(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"hi\"},\"timestamp\":\"2026-01-01T00:00:00Z\"}\n",
        );
        assert!(claude.events.len() >= 1);

        // 未知格式：无事件、无会话 id（由调用方按文件名兜底）
        let unknown = parse_sniffed_session("[not-json-line]\n{\"foo\":1}\n");
        assert!(unknown.events.is_empty());
        assert!(unknown.cli_session_id.is_empty());
    }

    /// 适配器分派：codex 走官方 rollout 解析器（不降级为嗅探）
    #[test]
    fn parse_by_adapter_dispatches_codex() {
        let codex = "{\"timestamp\":\"2026-04-20T16:44:37.772Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"t-1\",\"cwd\":\"/w\"}}\n";
        let s = parse_by_adapter("codex", codex).expect("codex branch");
        assert_eq!(s.cli_session_id, "t-1");
        // 未知来源仍走嗅探降级（自定义目录行为不变）
        assert!(parse_by_adapter("my-logs", "[]").is_some());
    }

    /// SQLite 源槽位写入：口径固定（files 恒 0，error 可为 null）
    #[test]
    fn write_sqlite_slot_shape() {
        let mut state = default_state();
        write_sqlite_slot(&mut state, "opencode", Some("sqlite3-missing"), 0, 0, 0, 0);
        let slot = sqlite_slot(&state, "opencode").expect("opencode slot");
        assert_eq!(slot["error"], json!("sqlite3-missing"));
        // 它不是文件枚举源：files 恒 0（不进 per_adapter 累加器）
        assert_eq!(slot["files"], json!(0));
        assert_eq!(slot["sessions"], json!(0));
        assert_eq!(slot["parsed"], json!(0));

        // 成功轮：error 归 null，parsed = 本轮解析会话数，sessions = 新增数
        write_sqlite_slot(&mut state, "opencode", None, 7, 54, 0, 0);
        let slot = sqlite_slot(&state, "opencode").expect("opencode slot");
        assert_eq!(slot["error"], json!(null));
        assert_eq!(slot["sessions"], json!(7));
        assert_eq!(slot["parsed"], json!(54));
    }

    /// 回归见证：槽位写错键会让「另一家适配器的 error」被 SQLite 源覆盖
    #[test]
    fn write_sqlite_slot_only_touches_its_own_adapter() {
        let mut state = default_state();
        // 预置 claude 的成功计数
        state["adapters"]["claude"] =
            json!({ "files": 3, "parsed": 3, "skipped": 0, "sessions": 5, "error": null });
        write_sqlite_slot(&mut state, "opencode", Some("db-missing"), 1, 1, 0, 0);
        // claude 不得被影响
        assert_eq!(state["adapters"]["claude"]["sessions"], json!(5));
        assert_eq!(state["adapters"]["claude"]["files"], json!(3));
    }
}
