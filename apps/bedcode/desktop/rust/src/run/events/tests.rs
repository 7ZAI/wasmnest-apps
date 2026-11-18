//! Seam 1（spec：事件唯一入口）的行为测试
//!
//! 输入是**真实采集的 agent 载荷**：
//! - `fixtures/run-events/opencode.json`：opencode 1.19.1 本机 `opencode.db` 的
//!   event / part 表行（bridge 段为插件事件总线的 `{type, properties}` 包装）；
//! - `fixtures/run-events/pi.json`：pi 1.4.0 本机会话 JSONL 行（mirror 段原样）；
//!   bridge 段按扩展事件类型声明由同一会话的真实消息投影（本机无 pi bridge 抓包）。
//!
//! 断言的是入口的外部行为：归一后的 kind / payload / seq 顺序、来源标记、去重与
//! 重放幂等、未知类型计数、上限淘汰、读取面游标；不断言内部函数调用顺序。

use super::store::tests::MockEventStore;
use super::*;
use model::{EventSource, KINDS};
use serde_json::{json, Value};

const OPENCODE_FIXTURE: &str = include_str!("../../../fixtures/run-events/opencode.json");
const PI_FIXTURE: &str = include_str!("../../../fixtures/run-events/pi.json");
const NOW: &str = "2026-10-30T12:00:00Z";
const CAP: usize = crate::session::store::RUN_EVENT_CAP;

#[derive(serde::Deserialize)]
struct Fixture {
    agent: String,
    provenance: String,
    bridge: Vec<Value>,
    mirror: Vec<Value>,
}

fn fixture(raw: &str, agent: &str) -> Fixture {
    let fixture: Fixture = serde_json::from_str(raw).expect("fixture must be valid JSON");
    assert_eq!(fixture.agent, agent);
    assert!(
        fixture.provenance.contains("实采"),
        "fixture 必须标注真实采集来源"
    );
    assert!(!fixture.bridge.is_empty() && !fixture.mirror.is_empty());
    fixture
}

fn ingest_raws(
    store: &MockEventStore,
    driver: &str,
    source: EventSource,
    run_id: &str,
    raws: &[Value],
    cap: usize,
) -> IngestReport {
    ingest(store, driver, source, run_id, raws, NOW, cap).expect("ingest")
}

fn kinds(store: &MockEventStore) -> Vec<String> {
    store
        .events()
        .iter()
        .map(|event| event.kind.clone())
        .collect()
}

// ==================== opencode ====================

/// opencode 桥接一组：归一序列、源标记、seq、payload 关键字段
#[test]
fn opencode_bridge_fixture_normalizes_into_ordered_ledger() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let store = MockEventStore::new();
    let report = ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-oc",
        &fixture.bridge,
        CAP,
    );

    assert_eq!(
        kinds(&store),
        vec![
            "session.meta",
            "user.message",
            "assistant.thinking",
            "assistant.text",
            "tool.call",
            "patch",
        ]
    );
    assert_eq!(
        store
            .events()
            .iter()
            .map(|event| event.seq)
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5, 6],
        "seq 按首次出现分配，原地更新不占新位置"
    );
    assert!(
        store.events().iter().all(|event| event.source == "bridge"),
        "来源标记必须逐条落库"
    );
    assert_eq!(report.created, 6);
    assert_eq!(report.updated, 2, "文本快照与工具状态各更新一次");
    assert_eq!(report.deduped, 0);
    assert_eq!(report.unknown, 0);
    assert_eq!(report.ignored, 0);

    let events = store.events();
    assert_eq!(
        events[0].payload["agentSessionId"],
        "ses_ebe79a551ffe93M13cDgwIJbC6"
    );
    assert_eq!(events[0].payload["model"], "deepseek-v4.1-flash-free");
    assert_eq!(events[1].payload["text"], "继续");
    assert_eq!(events[1].payload["attachments"], json!([]));
    assert!(events[2].payload["text"]
        .as_str()
        .unwrap()
        .contains("BedCode-branded"));
    assert!(
        events[3].payload["text"]
            .as_str()
            .unwrap()
            .starts_with("完成。桌面端名称与 logo 已改回 BedCode"),
        "同名 part 的最终快照覆盖空快照"
    );
    assert_eq!(events[3].payload["streaming"], false);
    assert_eq!(events[4].payload["name"], "bash");
    assert_eq!(
        events[4].payload["status"], "running",
        "pending → running 原地更新"
    );
    assert_eq!(events[5].payload["diff"], "");
    assert_eq!(events[5].payload["files"].as_array().unwrap().len(), 1);
}

/// 同一批原始载荷重放：账本零变化（流式旧快照被 rev 挡住）
#[test]
fn opencode_fixture_replay_is_idempotent() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let store = MockEventStore::new();
    ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-oc",
        &fixture.bridge,
        CAP,
    );
    let before = store.events();

    let replay = ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-oc",
        &fixture.bridge,
        CAP,
    );
    assert_eq!(replay.created, 0);
    assert_eq!(replay.updated, 0);
    assert_eq!(
        replay.deduped,
        fixture.bridge.len(),
        "每条载荷都命中既有身份（含被 rev 挡住的旧快照）"
    );
    assert_eq!(store.events(), before, "重放不得改动任何一行");
}

/// opencode 镜像一组：event 表行形状（带 `.1` 版本后缀、`data` 包装）同样可归一
#[test]
fn opencode_mirror_fixture_marks_source_and_ignores_lifecycle_noise() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let store = MockEventStore::new();
    let report = ingest_raws(
        &store,
        "opencode",
        EventSource::Mirror,
        "run-oc",
        &fixture.mirror,
        CAP,
    );

    assert_eq!(
        kinds(&store),
        vec!["session.meta", "assistant.text", "tool.result"],
        "step-start 是已识别但无归一形态的噪声，不落账本"
    );
    assert_eq!(report.ignored, 1);
    assert_eq!(report.unknown, 0);
    assert!(store.events().iter().all(|event| event.source == "mirror"));
    let tool_result = &store.events()[2];
    assert_eq!(
        tool_result.payload["callId"],
        "chatcmpl-tool-5cf48d6cc6b34b40bd7f0004b0110f84"
    );
    assert_eq!(tool_result.payload["exitCode"], 0);
    assert!(!tool_result.payload["output"].as_str().unwrap().is_empty());
}

// ==================== pi ====================

/// pi 扩展事件：流式快照先落，message_end 终态在同一 seq 原地收口
#[test]
fn pi_bridge_fixture_streams_then_finalizes_in_place() {
    let fixture = fixture(PI_FIXTURE, "pi");
    let store = MockEventStore::new();
    let report = ingest_raws(
        &store,
        "pi",
        EventSource::Bridge,
        "run-pi",
        &fixture.bridge,
        CAP,
    );

    assert_eq!(
        kinds(&store),
        vec![
            "status",
            "user.message",
            "assistant.text",
            "assistant.thinking",
            "session.meta",
            "tool.call",
            "tool.result",
            "status",
        ]
    );
    assert_eq!(report.updated, 1, "message_end 收口同一条 assistant.text");
    assert_eq!(report.unknown, 0);
    assert_eq!(report.ignored, 0);

    let events = store.events();
    assert_eq!(events[0].payload["state"], "busy");
    assert!(events[1].payload["text"].as_str().unwrap().contains("mdns"));
    let text = &events[2];
    assert_eq!(text.payload["streaming"], false, "终态快照覆盖流式快照");
    assert!(text.payload["text"].as_str().unwrap().contains("结论先行"));
    assert!(!events[3].payload["text"].as_str().unwrap().is_empty());
    assert!(events[4].payload["tokens"]["total"].as_i64().unwrap() > 0);
    assert_eq!(events[5].payload["name"], "bash");
    assert_eq!(events[6].payload["callId"], events[5].payload["callId"]);
    assert_eq!(events[7].payload["state"], "idle");
}

/// pi JSONL（镜像）：会话 / 模型 / 用户 / 助手块 / 工具结果 / 用量全部归一
#[test]
fn pi_mirror_fixture_normalizes_session_log() {
    let fixture = fixture(PI_FIXTURE, "pi");
    let store = MockEventStore::new();
    let report = ingest_raws(
        &store,
        "pi",
        EventSource::Mirror,
        "run-pi",
        &fixture.mirror,
        CAP,
    );

    assert_eq!(
        kinds(&store),
        vec![
            "session.meta",
            "session.meta",
            "user.message",
            "assistant.thinking",
            "tool.call",
            "tool.call",
            "session.meta",
            "tool.result",
            "assistant.thinking",
            "assistant.text",
        ]
    );
    assert_eq!(report.ignored, 1, "custom 摘要条目不进对话面");
    assert_eq!(report.unknown, 0);
    assert_eq!(
        report.updated, 1,
        "两条助手消息的用量合并到同一 meta:usage 槽"
    );

    let events = store.events();
    assert_eq!(
        events[0].payload["agentSessionId"],
        "01a18bff-f55c-7467-a37c-444bc325754a"
    );
    assert_eq!(events[1].payload["model"], "deepseek-v4.1-flash");
    assert!(events[2].payload["text"].as_str().unwrap().contains("mdns"));
    assert_eq!(events[4].payload["status"], "pending");
    assert_eq!(events[5].payload["status"], "pending");
    assert!(!events[7].payload["output"].as_str().unwrap().is_empty());
    assert!(events[9].payload["text"]
        .as_str()
        .unwrap()
        .contains("结论先行"));
}

// ==================== 去重 / 来源优先级 ====================

/// 同身份跨源：桥接永远赢；镜像后到不得把内容改回镜像版本
#[test]
fn bridge_outranks_mirror_for_the_same_identity() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let raw = fixture
        .bridge
        .iter()
        .find(|raw| {
            raw["properties"]["part"]["type"].as_str() == Some("text")
                && !raw["properties"]["part"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .is_empty()
        })
        .expect("fixture 需要一条非空 text part");

    let mirror_first = MockEventStore::new();
    let mut mirror_raw = raw.clone();
    mirror_raw["properties"]["part"]["text"] = json!("mirror-version");
    ingest_raws(
        &mirror_first,
        "opencode",
        EventSource::Mirror,
        "run-a",
        &[mirror_raw.clone()],
        CAP,
    );
    ingest_raws(
        &mirror_first,
        "opencode",
        EventSource::Bridge,
        "run-a",
        &[raw.clone()],
        CAP,
    );
    let event = &mirror_first.events()[0];
    assert_eq!(event.source, "bridge", "桥接覆盖镜像并改写来源");
    assert_eq!(
        event.payload["text"].as_str().unwrap(),
        raw["properties"]["part"]["text"].as_str().unwrap()
    );

    let bridge_first = MockEventStore::new();
    ingest_raws(
        &bridge_first,
        "opencode",
        EventSource::Bridge,
        "run-b",
        &[raw.clone()],
        CAP,
    );
    let update = ingest_raws(
        &bridge_first,
        "opencode",
        EventSource::Mirror,
        "run-b",
        &[mirror_raw],
        CAP,
    );
    assert_eq!(update.updated, 0);
    assert_eq!(update.deduped, 1, "低优先级来源不得覆盖桥接");
    assert_eq!(bridge_first.events()[0].source, "bridge");
}

/// 未知事件类型丢弃并计数，不影响同批已知事件的落库
#[test]
fn unknown_types_are_counted_without_blocking_known_events() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let text_raw = fixture
        .bridge
        .iter()
        .find(|raw| {
            raw["properties"]["part"]["type"].as_str() == Some("text")
                && !raw["properties"]["part"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .is_empty()
        })
        .expect("fixture 需要一条非空 text part")
        .clone();
    let unknown = json!({"type": "vendor.mystery", "properties": {"x": 1}});

    let store = MockEventStore::new();
    let report = ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-x",
        &[unknown, text_raw],
        CAP,
    );
    assert_eq!(report.unknown, 1);
    assert_eq!(
        report.unknown_types,
        vec!["opencode:vendor.mystery".to_string()]
    );
    assert_eq!(report.created, 1, "已知事件照常落库");
    assert_eq!(kinds(&store), vec!["assistant.text"]);
}

// ==================== 上限淘汰 ====================

/// 每条运行保留最近 20000 条：超出按 seq 淘汰最旧并置截断标记
#[test]
fn retention_keeps_newest_events_and_marks_run_truncated() {
    let raws: Vec<Value> = (0..5)
        .map(|index| {
            json!({
                "type": "message.part.updated",
                "properties": {
                    "time": 1792100000000i64 + index,
                    "part": {
                        "id": format!("prt-{index}"),
                        "messageID": format!("msg-{index}"),
                        "type": "text",
                        "text": format!("chunk-{index}"),
                        "time": {"start": 1792100000000i64 + index}
                    }
                }
            })
        })
        .collect();
    let store = MockEventStore::new();
    let report = ingest_raws(&store, "opencode", EventSource::Bridge, "run-t", &raws, 3);

    assert_eq!(report.created, 5);
    assert_eq!(report.pruned, 2);
    assert!(report.truncated);
    assert_eq!(
        store
            .events()
            .iter()
            .map(|event| event.seq)
            .collect::<Vec<_>>(),
        vec![3, 4, 5],
        "淘汰按 seq 从最旧开始"
    );
    assert!(
        store.run_truncated("run-t").expect("truncated flag"),
        "截断必须落到 runs.truncated（界面据此提示历史不完整）"
    );
    assert!(!store.run_truncated("run-other").expect("other flag"));
}

// ==================== 读取面 ====================

/// 读取面：seq 升序、wire 形状、增量游标能看见「老位置的新内容」
#[test]
fn read_surface_orders_by_seq_and_cursor_sees_in_place_updates() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let store = MockEventStore::new();
    ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-r",
        &fixture.bridge,
        CAP,
    );

    let page = store.list("run-r", None, 100).expect("list");
    let view = list_json("run-r", false, None, &page);
    assert_eq!(view["runId"], "run-r");
    assert_eq!(view["truncated"], false);
    assert_eq!(view["events"].as_array().unwrap().len(), 6);
    let first = &view["events"][0];
    assert!(
        first.get("id").is_none(),
        "写入序号不外溢，只有 cursor 暴露它"
    );
    for key in ["seq", "at", "kind", "payload", "source"] {
        assert!(first.get(key).is_some(), "wire 缺字段 {key}: {first}");
    }
    let cursor = view["cursor"].as_i64().unwrap();
    assert!(cursor > 0);

    // 更新一条既有事件：同 seq、新写入序号 → 增量读取必须看见它
    let text_raw = fixture
        .bridge
        .iter()
        .find(|raw| {
            raw["properties"]["part"]["type"].as_str() == Some("text")
                && !raw["properties"]["part"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .is_empty()
        })
        .expect("fixture 需要一条非空 text part")
        .clone();
    let mut next = text_raw.clone();
    next["properties"]["time"] = json!(1792109999999i64);
    next["properties"]["part"]["text"] = json!("updated-by-bridge");
    ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-r",
        &[next],
        CAP,
    );
    let delta = store.list("run-r", Some(cursor), 100).expect("list delta");
    assert_eq!(delta.len(), 1, "只有被更新的那一行是新写入序号");
    assert_eq!(delta[0].payload["text"], "updated-by-bridge");
    assert_eq!(delta[0].seq, 4, "逻辑位置不变");
    let delta_view = list_json("run-r", false, Some(cursor), &delta);
    assert!(delta_view["cursor"].as_i64().unwrap() > cursor);

    // limit：无 afterId 时取最近 N 条，仍按 seq 升序
    let tail = list_json(
        "run-r",
        false,
        None,
        &store.list("run-r", None, 2).expect("tail"),
    );
    let seqs: Vec<i64> = tail["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["seq"].as_i64().unwrap())
        .collect();
    assert_eq!(seqs, vec![5, 6]);
}

/// H2 回归（issue #25）：早期行的原地更新不得让增量分页跳过中段历史
///
/// 场景：事件数超过单页 limit，且首拍被取走**之前**有一条早期事件被原地更新
/// （新写入 id、原 seq）。增量分支按写入 id 排序时游标单调，续拉必然取全；
/// 若按 seq 排序，批内新 id 会把游标顶过未交付行，中段历史此后永久读不到。
#[test]
fn incremental_pagination_survives_inplace_update_of_early_row() {
    let fixture = fixture(OPENCODE_FIXTURE, "opencode");
    let store = MockEventStore::new();
    ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-p",
        &fixture.bridge,
        CAP,
    );
    let total = store.len();
    assert!(total > 4, "fixture 需要多于单页 limit(4) 的事件");

    // 首拍之前更新一条早期事件（同身份 → 原地更新：新写入 id、原 seq）
    let text_raw = fixture
        .bridge
        .iter()
        .find(|raw| {
            raw["properties"]["part"]["type"].as_str() == Some("text")
                && !raw["properties"]["part"]["text"]
                    .as_str()
                    .unwrap_or("")
                    .is_empty()
        })
        .expect("fixture 需要一条非空 text part")
        .clone();
    let mut next = text_raw.clone();
    next["properties"]["time"] = json!(1792109999999i64);
    next["properties"]["part"]["text"] = json!("updated-early");
    ingest_raws(
        &store,
        "opencode",
        EventSource::Bridge,
        "run-p",
        &[next],
        CAP,
    );

    // 模拟对话面：afterId=0 起步、limit=4、满页续拉，游标恒取本批最大写入 id
    let mut cursor = 0;
    let mut seen: Vec<(i64, String)> = Vec::new();
    for _ in 0..8 {
        let page = store.list("run-p", Some(cursor), 4).expect("page");
        let full = page.len() == 4;
        for event in &page {
            seen.push((
                event.seq,
                event.payload["text"].as_str().unwrap_or("").to_string(),
            ));
        }
        cursor = page.iter().map(|event| event.id).max().unwrap_or(cursor);
        if !full {
            break;
        }
    }

    let mut covered: Vec<i64> = seen.iter().map(|(seq, _)| *seq).collect();
    covered.sort_unstable();
    covered.dedup();
    let expected: Vec<i64> = (1..=total as i64).collect();
    assert_eq!(
        covered, expected,
        "增量续拉必须覆盖全部 seq（不跳中段历史）"
    );
    assert!(
        seen.contains(&(4, "updated-early".to_string())),
        "早期行的新内容必须随新写入 id 重交付"
    );
}

/// 12 类 kind 是全集的唯一真源：归一实现只能产出表内值
#[test]
fn every_stored_kind_belongs_to_the_twelve_kind_vocabulary() {
    let mut seen = std::collections::BTreeSet::new();
    for unique in KINDS {
        assert!(seen.insert(unique), "KINDS 重复: {unique}");
    }
    assert_eq!(seen.len(), 12);

    let opencode = fixture(OPENCODE_FIXTURE, "opencode");
    let pi = fixture(PI_FIXTURE, "pi");
    for (driver, raws) in [
        ("opencode", opencode.bridge),
        ("opencode", opencode.mirror),
        ("pi", pi.bridge),
        ("pi", pi.mirror),
    ] {
        let store = MockEventStore::new();
        ingest_raws(&store, driver, EventSource::Bridge, "run-k", &raws, CAP);
        for event in store.events() {
            assert!(
                KINDS.contains(&event.kind.as_str()),
                "归一实现产出了词表外的 kind: {}",
                event.kind
            );
        }
    }
}
