//! 运行事件账本（ADR 0004）：**唯一归一入口** + 读取面
//!
//! 桥接（agent 原生扩展推上来的事件）与账本镜像（只读轮询 agent 自己的记录）
//! 都汇到 [`ingest`] 一个入口，由它完成：
//! 1. **归一**（[`normalize`]：agent 原生载荷 → 12 类 [`model::KINDS`]）；
//! 2. **去重**（运行内稳定身份 `dedupe_key`；同身份原地更新，不追加重复快照）；
//! 3. **seq 分配**（逻辑顺序，按它渲染；同身份更新保留原 seq）；
//! 4. **落库**（`run_events`，`(run_id, seq)` 唯一）；
//! 5. **上限淘汰**（每条运行最近 [`crate::session::store::RUN_EVENT_CAP`] 条，
//!    超出按 seq 淘汰并置 `runs.truncated`）。
//!
//! 未知事件类型**丢弃并计数**（[`model::IngestReport::unknown`]），不静默、不打断
//! 其余事件。界面只读账本（[`list_via_host`]），不区分来源；`source` 只用于降级
//! 标注与排障。
//!
//! **写入序 vs 逻辑序**：`run_events.id` 是写入序号（原地更新会换新 id），`seq`
//! 是逻辑位置。读取面用 `id` 做增量游标（能看见老位置的新内容），按 `seq` 排序
//! 渲染。这条分工是流式正文不刷爆账本的前提。
//!
//! **meta 槽拆分**：`session.meta` 在账本里是三个身份（`meta:session` /
//! `meta:model` / `meta:usage`），各带自己知道的字段；读取方按到达顺序合并，
//! 不让「只有 token 数的快照」把「带标题的快照」覆盖成半截。

pub mod model;
pub mod normalize;
pub mod store;

#[cfg(test)]
mod tests;

use model::{AppendOutcome, DraftEvent, EventSource, IngestReport, StoredEvent};
use store::EventStore;

/// 唯一归一入口：一批原始载荷（同一运行、同一来源）→ 归一、去重、落库、截断
///
/// `driver` = 运行的 agent id（决定用哪份归一化）；`now` 由调用方注入（native
/// 单测可复现）。未知驱动下每条载荷都落「未知计数」，不猜形状。
pub fn ingest<S: EventStore>(
    store: &S,
    driver: &str,
    source: EventSource,
    run_id: &str,
    raws: &[serde_json::Value],
    now: &str,
    cap: usize,
) -> Result<IngestReport, String> {
    let mut report = IngestReport::default();
    for raw in raws {
        let outcome = normalize::normalize(driver, raw, now);
        if let Some(label) = outcome.unknown {
            report.record_unknown(&label);
            continue;
        }
        if outcome.ignored {
            report.ignored += 1;
        }
        for draft in outcome.drafts {
            match upsert(store, run_id, source, &draft)? {
                AppendOutcome::Created(_) => report.created += 1,
                AppendOutcome::Updated(_) => report.updated += 1,
                AppendOutcome::Duplicate => report.deduped += 1,
            }
        }
    }
    if report.created + report.updated > 0 {
        let pruned = store.prune(run_id, cap)?;
        if pruned > 0 {
            store.mark_truncated(run_id)?;
            report.truncated = true;
            report.pruned = pruned;
        }
    }
    Ok(report)
}

/// 同身份事件：高优先级来源覆盖低优先级；同源只在内容变化时原地更新
fn upsert<S: EventStore>(
    store: &S,
    run_id: &str,
    source: EventSource,
    draft: &DraftEvent,
) -> Result<AppendOutcome, String> {
    let Some(existing) = store.get_by_dedupe(run_id, &draft.dedupe_key)? else {
        let seq = store.next_seq(run_id)?;
        store.insert(run_id, seq, draft, source)?;
        return Ok(AppendOutcome::Created(seq));
    };
    let incoming = source.priority();
    let current = existing.source_priority();
    let same_payload = existing.kind == draft.kind && existing.payload == draft.payload;
    // 跨源：高优先级覆盖（内容与版本都不作数——桥接实时快照就是比镜像权威）
    // 同源：旧快照重放不得覆盖新内容（rev 更小 → 丢弃）；同版本只在内容变化时更新
    let should_replace = if incoming != current {
        incoming > current
    } else {
        draft.rev >= existing.rev && !same_payload
    };
    if !should_replace {
        return Ok(AppendOutcome::Duplicate);
    }
    store.replace(run_id, existing.id, existing.seq, draft, source)?;
    Ok(AppendOutcome::Updated(existing.seq))
}

/// 读取面的 wire 投影（事件不含写入 id；`cursor` 才是增量游标）
///
/// - `truncated`：运行的事件账本发生过上限淘汰；
/// - `cursor`：本批最大的写入序号（无行 = 请求的 `afterId`，初次 = 0）。
pub fn list_json(
    run_id: &str,
    truncated: bool,
    after_id: Option<i64>,
    events: &[StoredEvent],
) -> serde_json::Value {
    let cursor = events
        .iter()
        .map(|event| event.id)
        .max()
        .or(after_id)
        .unwrap_or(0);
    let events: Vec<serde_json::Value> = events.iter().map(event_json).collect();
    serde_json::json!({
        "runId": run_id,
        "truncated": truncated,
        "cursor": cursor,
        "events": events,
    })
}

fn event_json(event: &StoredEvent) -> serde_json::Value {
    serde_json::json!({
        "seq": event.seq,
        "at": event.at,
        "kind": event.kind,
        "payload": event.payload,
        "source": event.source,
    })
}

// ==================== wasm：命令面入口 ====================

/// `run.events {runId, afterId?, limit?}` → `{runId, truncated, cursor, events[]}`
///
/// 读取失败显性报错（运行不存在 / 私有库不可用）：对话面不能把「读不到」伪装成
/// 「没有事件」——那会让用户以为 agent 什么都没说。
#[cfg(target_arch = "wasm32")]
pub fn list_via_host(args: &serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::session::store::RUN_EVENT_CAP;
    use wasmnest_plugin_api::wasm_host::WasmHost;

    let run_id = args
        .get("runId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "run.events: runId required".to_string())?;
    let after_id = match args.get("afterId") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(
            value
                .as_i64()
                .filter(|after| *after >= 0)
                .ok_or_else(|| "run.events: afterId must be a non-negative integer".to_string())?,
        ),
    };
    let limit = match args.get("limit") {
        None | Some(serde_json::Value::Null) => RUN_EVENT_CAP,
        Some(value) => value
            .as_u64()
            .ok_or_else(|| "run.events: limit must be a positive integer".to_string())?
            .clamp(1, RUN_EVENT_CAP as u64) as usize,
    };
    let record = crate::session::record_via_host(run_id)?
        .ok_or_else(|| format!("run.events: run not found: {run_id}"))?;
    let now = crate::config::model::now_rfc3339();
    let events = WasmHost
        .list(run_id, after_id, limit)
        .map_err(|e| format!("run.events: {e}"))?;
    let mut view = list_json(run_id, record.truncated, after_id, &events);
    // 对话面每拍都读这里：桥接状态随事件一起回，不额外读 run.list
    view["bridge"] = serde_json::json!({
        "connected": record.bridge_connected(&now),
        "lastSeenAt": record.bridge_seen_at,
    });
    Ok(view)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn list_via_host(_args: &serde_json::Value) -> Result<serde_json::Value, String> {
    Err("run event ledger unavailable outside wasm runtime".to_string())
}
