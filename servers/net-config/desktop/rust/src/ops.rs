//! 配置中心域逻辑（纯函数 + 存储接口；native 可直测）
//!
//! 三条不变式（与 T18 的失败语义一致）：
//!
//! 1. **不静默清除**：读到无法解析的存储 → 显性错误并保留原值；只有显式移除才删键；
//! 2. **不覆盖既有配置**：收养（给 BedCode 迁移用）在目标已有值时返回
//!    `adopted=false`，不写任何键；
//! 3. **未配置 ≠ 中心不可用**：读取面用 `{configured:false}` 表达「没配置」，
//!    api 调用失败（超时 / 未登记 / 被禁用）由传输层报错——两者不得混成空数组。

use crate::model::{
    iso8601_utc, parse_relay_config, parse_wan_policy, RelayConfig, WanPolicy, RELAY_KEY,
    WAN_POLICY_KEY,
};
use crate::store::NetConfigStore;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// 当前 Unix 秒（与 auth-center 同口径；wasip3 提供 std 时钟）
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 读 relay 配置：缺键 = `None`；存在但不可解析 = 显性错误（原值保留）
pub fn load_relay(store: &impl NetConfigStore) -> Result<Option<RelayConfig>, String> {
    match store.read(RELAY_KEY)? {
        None => Ok(None),
        Some(value) => parse_relay_config(&value).map(Some),
    }
}

/// 保存 relay 配置（导入 / 页面写入的唯一写路径）
///
/// `importedAt` 缺失时补当前时间（不猜其它字段）；其余结构按
/// [`parse_relay_config`] 严格校验，非法载荷不写盘。
pub fn save_relay(
    store: &impl NetConfigStore,
    raw: &Value,
    now_secs: u64,
) -> Result<RelayConfig, String> {
    let mut value = raw.clone();
    let needs_timestamp = value
        .get("importedAt")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::is_empty)
        .unwrap_or(true);
    if needs_timestamp {
        if let Some(object) = value.as_object_mut() {
            object.insert(
                "importedAt".to_string(),
                Value::String(iso8601_utc(now_secs)),
            );
        }
    }
    let config = parse_relay_config(&value)?;
    serde_json::to_value(&config)
        .map_err(|e| format!("relay settings serialize: {e}"))
        .and_then(|stored| store.write(RELAY_KEY, &stored).map(|()| config))
}

/// 移除 relay 配置（显式动作；幂等）
pub fn clear_relay(store: &impl NetConfigStore) -> Result<(), String> {
    store.delete(RELAY_KEY)
}

/// 收养一份 relay 配置（BedCode 迁移用；幂等）
///
/// 目标已有值（无论能否解析）→ `{adopted:false, reason:"already-configured"}`，
/// **不覆盖**：中心一旦有配置就是唯一真源，迁移只负责补空。
pub fn adopt_relay(
    store: &impl NetConfigStore,
    raw: &Value,
    now_secs: u64,
) -> Result<Value, String> {
    if store.read(RELAY_KEY)?.is_some() {
        return Ok(serde_json::json!({
            "adopted": false,
            "reason": "already-configured",
        }));
    }
    let config = save_relay(store, raw, now_secs)?;
    Ok(serde_json::json!({
        "adopted": true,
        "config": config,
    }))
}

/// 读 WAN 注册表（缺键 = 空表，不是错误）
pub fn load_policy(store: &impl NetConfigStore) -> Result<WanPolicy, String> {
    match store.read(WAN_POLICY_KEY)? {
        None => Ok(WanPolicy::default()),
        Some(value) => parse_wan_policy(&value),
    }
}

/// 写一条业务策略（逐业务开关；失败不写盘）
pub fn set_policy(
    store: &impl NetConfigStore,
    plugin_id: &str,
    allow_wan: bool,
    note: &str,
    now_secs: u64,
) -> Result<WanPolicy, String> {
    // 先校验入参再读存储：非法 plugin id 不该先去碰一次 KV（也让错误原因与存储无关）
    if !crate::model::plugin_id_is_valid(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }
    let mut policy = load_policy(store)?;
    policy.upsert(plugin_id, allow_wan, note, &iso8601_utc(now_secs))?;
    let stored = serde_json::to_value(&policy).map_err(|e| format!("wan policy serialize: {e}"))?;
    store.write(WAN_POLICY_KEY, &stored)?;
    Ok(policy)
}

/// 只读 api / 命令面：`{configured, config}`（未配置 = `configured:false`，不是错误）
pub fn relay_config_view(store: &impl NetConfigStore) -> Result<Value, String> {
    let config = load_relay(store)?;
    Ok(serde_json::json!({
        "configured": config.is_some(),
        "config": config,
    }))
}

/// 状态摘要（页面预览 / 诊断；损坏时把原因如实带出，不把整个中心打成不可用）
pub fn status_view(store: &impl NetConfigStore) -> Value {
    let relay = load_relay(store);
    let policy = load_policy(store);
    let (configured, addrs, relay_error) = match &relay {
        Ok(Some(config)) => (true, config.relay_addrs.len(), Value::Null),
        Ok(None) => (false, 0, Value::Null),
        Err(e) => (false, 0, Value::String(e.clone())),
    };
    let (policy_count, policy_error) = match &policy {
        Ok(policy) => (policy.apps.len(), Value::Null),
        Err(e) => (0, Value::String(e.clone())),
    };
    serde_json::json!({
        "configured": configured,
        "relayAddrsCount": addrs,
        "relayError": relay_error,
        "wanApps": policy_count,
        "wanError": policy_error,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RELAY_SCHEMA_VERSION, WAN_POLICY_VERSION};
    use crate::store::MemoryStore;

    const PEER_ID: &str = "12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H";
    const FINGERPRINT: &str = "d842779d48acb8694b01b0091b72e4b81f7a52bad4bca0ee03cf14e3c689cadb";

    fn relay_payload() -> Value {
        serde_json::json!({
            "version": 1,
            "relayAddrs": [format!("/dns4/relay.example.com/tcp/4001/p2p/{PEER_ID}")],
            "peerId": PEER_ID,
            "peerIdSha256": FINGERPRINT,
            "accessMode": "open",
            "relayVersion": "0.0.1",
            "controlProtocol": "/wasmnest/relay-control/1",
            "quota": { "maxCircuitBytes": 1, "maxCircuitDurationSecs": 2 },
            "importedAt": "2026-11-08T00:00:00Z",
            "source": "json",
        })
    }

    #[test]
    fn unconfigured_centre_reports_configured_false_not_an_error() {
        let store = MemoryStore::default();
        let view = relay_config_view(&store).expect("view");
        assert_eq!(view["configured"], serde_json::json!(false));
        assert_eq!(view["config"], Value::Null);
    }

    #[test]
    fn save_persists_camel_case_shape_and_reads_back() {
        let store = MemoryStore::default();
        let saved = save_relay(&store, &relay_payload(), 1_700_000_000).expect("save");
        assert_eq!(saved.peer_id, PEER_ID);
        let stored = store.get(RELAY_KEY).expect("stored");
        assert_eq!(stored["version"], serde_json::json!(RELAY_SCHEMA_VERSION));
        assert_eq!(stored["peerId"], serde_json::json!(PEER_ID));
        assert_eq!(stored["peerIdSha256"], serde_json::json!(FINGERPRINT));
        assert_eq!(
            load_relay(&store).expect("load").expect("some").relay_addrs.len(),
            1
        );
    }

    #[test]
    fn save_fills_missing_imported_at_instead_of_guessing_other_fields() {
        let store = MemoryStore::default();
        let mut payload = relay_payload();
        payload.as_object_mut().expect("obj").remove("importedAt");
        let saved = save_relay(&store, &payload, 0).expect("save");
        assert_eq!(saved.imported_at, "1970-01-01T00:00:00Z");
    }

    #[test]
    fn corrupted_storage_is_reported_and_never_deleted() {
        let corrupt = serde_json::json!({ "version": 7, "relayAddrs": "nope" });
        let store = MemoryStore::with(RELAY_KEY, corrupt.clone());
        let err = load_relay(&store).expect_err("must fail loudly");
        assert!(err.contains("version"), "{err}");
        assert_eq!(
            store.get(RELAY_KEY),
            Some(corrupt),
            "损坏值必须原样保留（静默清除 = 用户丢中继寻址）"
        );
        // 显式移除才删键
        clear_relay(&store).expect("clear");
        assert!(store.get(RELAY_KEY).is_none());
    }

    #[test]
    fn clear_is_idempotent() {
        let store = MemoryStore::default();
        clear_relay(&store).expect("clear");
        clear_relay(&store).expect("clear again");
    }

    #[test]
    fn adopt_writes_only_into_an_empty_centre() {
        let store = MemoryStore::default();
        let first = adopt_relay(&store, &relay_payload(), 1_700_000_000).expect("adopt");
        assert_eq!(first["adopted"], serde_json::json!(true));
        assert_eq!(
            store.get(RELAY_KEY).expect("stored")["peerId"],
            serde_json::json!(PEER_ID)
        );

        // 第二次（或目标已有值）不覆盖，返回是否采纳
        let mut other = relay_payload();
        other["peerId"] = serde_json::json!("12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA");
        other["relayAddrs"] = serde_json::json!([format!(
            "/dns4/other.example.com/tcp/4001/p2p/12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA"
        )]);
        let second = adopt_relay(&store, &other, 1_700_000_001).expect("adopt again");
        assert_eq!(second["adopted"], serde_json::json!(false));
        assert_eq!(second["reason"], serde_json::json!("already-configured"));
        assert_eq!(
            store.get(RELAY_KEY).expect("stored")["peerId"],
            serde_json::json!(PEER_ID),
            "既有配置不得被收养覆盖"
        );
    }

    #[test]
    fn adopt_rejects_invalid_payload_without_writing() {
        let store = MemoryStore::default();
        let mut payload = relay_payload();
        payload["version"] = serde_json::json!(99);
        assert!(adopt_relay(&store, &payload, 0).is_err());
        assert!(store.get(RELAY_KEY).is_none());
    }

    #[test]
    fn wan_policy_starts_empty_and_persists_per_app_updates() {
        let store = MemoryStore::default();
        let empty = load_policy(&store).expect("policy");
        assert_eq!(empty.version, WAN_POLICY_VERSION);
        assert!(empty.apps.is_empty());

        let policy = set_policy(
            &store,
            "com.wasmnest.bedcode",
            true,
            "desktop",
            1_700_000_000,
        )
        .expect("set");
        assert!(policy.apps["com.wasmnest.bedcode"].allow_wan);
        assert_eq!(
            policy.apps["com.wasmnest.bedcode"].updated_at,
            "2023-11-14T22:13:20Z"
        );

        // 逐业务：关掉一个不影响另一个
        set_policy(&store, "com.wasmnest.file-transfer", false, "", 1_700_000_001)
            .expect("set");
        let read = load_policy(&store).expect("read");
        assert_eq!(read.apps.len(), 2);
        assert!(!read.apps["com.wasmnest.file-transfer"].allow_wan);
        assert!(read.apps["com.wasmnest.bedcode"].allow_wan);
    }

    #[test]
    fn corrupted_policy_is_reported_and_preserved_on_write() {
        let corrupt = serde_json::json!({ "version": 9, "apps": {} });
        let store = MemoryStore::with(WAN_POLICY_KEY, corrupt.clone());
        assert!(load_policy(&store).is_err());
        assert!(
            set_policy(&store, "com.wasmnest.bedcode", true, "", 0).is_err(),
            "读不出旧表时不得覆盖写（会丢掉其它业务的策略）"
        );
        assert_eq!(store.get(WAN_POLICY_KEY), Some(corrupt));
    }

    #[test]
    fn status_view_reports_errors_instead_of_hiding_them() {
        let store = MemoryStore::with(RELAY_KEY, serde_json::json!({ "version": 7 }));
        let status = status_view(&store);
        assert_eq!(status["configured"], serde_json::json!(false));
        assert!(
            status["relayError"].as_str().expect("error").contains("version"),
            "{status}"
        );

        let ok = MemoryStore::default();
        save_relay(&ok, &relay_payload(), 0).expect("save");
        let status = status_view(&ok);
        assert_eq!(status["configured"], serde_json::json!(true));
        assert_eq!(status["relayAddrsCount"], serde_json::json!(1));
        assert_eq!(status["relayError"], Value::Null);
    }
}
