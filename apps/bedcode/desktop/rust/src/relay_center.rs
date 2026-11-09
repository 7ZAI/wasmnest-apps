//! 网络配置中心消费面（T18）
//!
//! T18 起 relay 地址的**真源**是 `com.wasmnest.net-config`（L2 服务型 wasm）；
//! BedCode 的插件 KV `network.relay` 降级为**本地缓存**（中心不可用时兜底）。
//!
//! ## 为什么在这里（后端）读中心
//!
//! 宿主给应用前端的命令白名单里没有跨插件调用原语（`host-api-call` 只在 wasm
//! guest 侧可用），所以「业务取中心配置」只能由业务后端转发。本模块是**薄读取
//! 层**：只调中心的只读 api（`relay-config`）与迁移用的 `relay-adopt`，不代任何
//! 业务 `expose` / `connect`，也不持有权限。
//!
//! ## 失败语义（fail-visible）
//!
//! - 中心明确「未配置」（`configured:false`）→ 空地址 = 仅 LAN，**不**回落到
//!   本地缓存（用户可能是主动清空的，复活旧值等于静默撤销）；
//! - 中心不可用（超时 / 未登记 / 被禁用）→ 用本地缓存，并把中心错误带出；
//! - 两者都拿不到 → 显性错误（不返回空数组冒充「没配置」）。
//!
//! ## 迁移（T18 §5）
//!
//! BedCode 首次启动（activate）调用 [`migrate_on_activate`]：本地缓存可解析时
//! 经 `relay-adopt` 写入中心（**中心已有值则不覆盖**），结果记在
//! `network.relay.migration`，设置页据此显性提示。成功后本地键**保留为缓存**。

use serde_json::Value;

/// 网络配置中心插件 id
pub const NET_CONFIG_ID: &str = "com.wasmnest.net-config";
/// 本插件 id（WAN 注册表的键）
pub const SELF_PLUGIN_ID: &str = "com.wasmnest.bedcode";
/// 迁移结果键（本插件 KV；`{version, state, reason?, detail?, at}`）
pub const MIGRATION_STORAGE_KEY: &str = "network.relay.migration";
/// 迁移结果 schema 版本
pub const MIGRATION_VERSION: u64 = 1;

/// 单次互调超时（毫秒）：设置页取数在人机交互窗口内
#[cfg(target_arch = "wasm32")]
const CALL_TIMEOUT_MS: u64 = 5_000;

#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::HostBus;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::plugin_api;

/// 消费方镜像（判据 `trait ⊆ manifest`：只声明真正调用的三条——
/// `relay-config` / `wan-policy` 只读 + 迁移用 `relay-adopt`）
#[cfg(target_arch = "wasm32")]
#[plugin_api(manifest = "../../../../servers/net-config/desktop/plugin.json")]
#[allow(dead_code)]
trait NetConfigApi {
    #[api("relay-config")]
    fn relay_config() -> Result<Value, String>;

    #[api("wan-policy")]
    fn wan_policy() -> Result<Value, String>;

    #[api("relay-adopt")]
    fn relay_adopt(config: Value) -> Result<Value, String>;
}

/// 解析后的中继配置（中心优先，缓存兜底）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRelay {
    /// 是否有可用地址（false = 中心明确未配置 / 仅 LAN）
    pub configured: bool,
    /// 可拨 relay 地址（空 = 仅 LAN）
    pub addrs: Vec<String>,
    /// `center` / `cache`
    pub source: &'static str,
    /// 中心读取失败原因（source=`cache` 时非空）
    pub center_error: Option<String>,
    /// 原始配置载荷（页面展示 / 调试；不保证存在于所有分支）
    pub raw: Option<Value>,
}

/// 中心 + 本地缓存的宿主访问面（native 单测注入替身）
pub trait RelayCenterHost {
    /// 调中心 `relay-config` → `{configured, config}`
    fn read_center(&self) -> Result<Value, String>;
    /// 调中心 `wan-policy` → `{version, apps}`
    fn read_policy(&self) -> Result<Value, String>;
    /// 调中心 `relay-adopt` → `{adopted, reason?}`
    fn adopt(&self, config: &Value) -> Result<Value, String>;
    /// 读本插件 KV（`network.relay` 缓存 / `network.relay.migration` 状态）
    fn read_kv(&self, key: &str) -> Result<Option<Value>, String>;
    /// 写本插件 KV（迁移状态）
    fn write_kv(&self, key: &str, value: &Value) -> Result<(), String>;
}

/// 取 `config.relayAddrs`（结构不对 = 中心回执损坏，不静默当空）
fn relay_addrs_from_center_payload(payload: &Value) -> Result<Vec<String>, String> {
    let config = payload
        .get("config")
        .ok_or_else(|| "network centre reply missing config".to_string())?;
    let raw = config
        .get("relayAddrs")
        .and_then(Value::as_array)
        .ok_or_else(|| "network centre config missing relayAddrs".to_string())?;
    let mut addrs = Vec::with_capacity(raw.len());
    for item in raw {
        let addr = item
            .as_str()
            .ok_or_else(|| "network centre config has a non-string relay address".to_string())?;
        addrs.push(addr.to_string());
    }
    crate::tunnel::validate_relay_addrs(&addrs)
}

/// 解析当前可用 relay 配置（中心 → 本地缓存；两者都不可用 = 显性错误）
pub fn resolve_relay(host: &impl RelayCenterHost) -> Result<ResolvedRelay, String> {
    let mut center_error: Option<String>;

    match host.read_center() {
        Ok(payload) => {
            let configured = payload
                .get("configured")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !configured {
                // 中心明确说「未配置」：不回落到缓存（用户可能主动清空了中心）
                return Ok(ResolvedRelay {
                    configured: false,
                    addrs: Vec::new(),
                    source: "center",
                    center_error: None,
                    raw: None,
                });
            }
            match relay_addrs_from_center_payload(&payload) {
                Ok(addrs) => {
                    return Ok(ResolvedRelay {
                        configured: true,
                        addrs,
                        source: "center",
                        center_error: None,
                        raw: payload.get("config").cloned(),
                    })
                }
                Err(e) => center_error = Some(e),
            }
        }
        Err(e) => center_error = Some(e),
    }

    // 中心不可用 / 回执损坏 → 本地缓存兜底
    let cached = host.read_kv(crate::tunnel::RELAY_SETTINGS_STORAGE_KEY)?;
    match cached {
        Some(value) => {
            let addrs = crate::tunnel::relay_addrs_from_settings(&value)?;
            Ok(ResolvedRelay {
                configured: true,
                addrs,
                source: "cache",
                center_error,
                raw: Some(value),
            })
        }
        None => Err(format!(
            "relay configuration unavailable: {}",
            center_error.unwrap_or_else(|| "network centre returned no usable config".to_string())
        )),
    }
}

/// 业务 WAN 开关：注册表显式 false = 禁止；未登记 / 缺字段 = 默认 true
///
/// 默认 true 与 spec「未显式设置时 true」一致：新业务接入不需要先改注册表就能
/// 用已配置的 relay；用户显式关掉才停止建立中继预留。
pub fn allow_wan_for(host: &impl RelayCenterHost, plugin_id: &str) -> Result<bool, String> {
    let policy = host.read_policy()?;
    let value = policy
        .get("apps")
        .and_then(|apps| apps.get(plugin_id))
        .and_then(|entry| entry.get("allowWan"))
        .and_then(Value::as_bool);
    Ok(value.unwrap_or(true))
}

/// 本插件的 WAN 开关 + 读取失败原因（失败时按默认 true 继续，但原因必须可见）
pub fn allow_wan_via(host: &impl RelayCenterHost) -> (bool, Option<String>) {
    match allow_wan_for(host, SELF_PLUGIN_ID) {
        Ok(value) => (value, None),
        Err(e) => (true, Some(format!("wan policy unreadable: {e}"))),
    }
}

/// 设置页 / 命令面视图：`{configured, relayAddrs, source, centerError, allowWan, wanPolicyError, config}`
pub fn relay_config_view(host: &impl RelayCenterHost) -> Result<Value, String> {
    let resolved = resolve_relay(host)?;
    let (allow_wan, wan_policy_error) = allow_wan_via(host);
    Ok(serde_json::json!({
        "configured": resolved.configured,
        "relayAddrs": resolved.addrs,
        "source": resolved.source,
        "centerError": resolved.center_error,
        "allowWan": allow_wan,
        "wanPolicyError": wan_policy_error,
        "config": resolved.raw,
    }))
}

/// 迁移本地旧配置到中心（幂等；目标已有值不覆盖）→ 迁移状态
///
/// 本地键在成功后**保留为缓存**（T18 §5：中心不可用时兜底）。
pub fn migrate(host: &impl RelayCenterHost) -> Result<Value, String> {
    let Some(local) = host.read_kv(crate::tunnel::RELAY_SETTINGS_STORAGE_KEY)? else {
        return Ok(serde_json::json!({
            "version": MIGRATION_VERSION,
            "state": "none",
        }));
    };

    let status = match crate::tunnel::relay_addrs_from_settings(&local) {
        Err(detail) => serde_json::json!({
            "version": MIGRATION_VERSION,
            "state": "failed",
            "detail": detail,
            "at": crate::config::model::now_rfc3339(),
        }),
        Ok(_) => match host.adopt(&local) {
            Ok(reply) => {
                let adopted = reply
                    .get("adopted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                serde_json::json!({
                    "version": MIGRATION_VERSION,
                    "state": if adopted { "adopted" } else { "skipped" },
                    "reason": reply.get("reason").cloned().unwrap_or(Value::Null),
                    "at": crate::config::model::now_rfc3339(),
                })
            }
            Err(detail) => serde_json::json!({
                "version": MIGRATION_VERSION,
                "state": "failed",
                "detail": detail,
                "at": crate::config::model::now_rfc3339(),
            }),
        },
    };

    host.write_kv(MIGRATION_STORAGE_KEY, &status)?;
    Ok(status)
}

/// 读迁移状态（缺记录 = `{state:"none"}`；记录损坏 = 显性错误）
pub fn migration_status(host: &impl RelayCenterHost) -> Result<Value, String> {
    match host.read_kv(MIGRATION_STORAGE_KEY)? {
        None => Ok(serde_json::json!({
            "version": MIGRATION_VERSION,
            "state": "none",
        })),
        Some(value) => {
            let state = value.get("state").and_then(Value::as_str);
            match state {
                Some("none" | "adopted" | "skipped" | "failed") => Ok(value),
                _ => Err("relay migration status unreadable".to_string()),
            }
        }
    }
}

// ==================== wasm 运行时实现 ====================

#[cfg(target_arch = "wasm32")]
struct WasmCenterHost;

#[cfg(target_arch = "wasm32")]
impl RelayCenterHost for WasmCenterHost {
    fn read_center(&self) -> Result<Value, String> {
        NetConfigApiClient::new(NET_CONFIG_ID)
            .with_timeout(CALL_TIMEOUT_MS)
            .relay_config()
            .map_err(|e| e.to_string())
    }

    fn read_policy(&self) -> Result<Value, String> {
        NetConfigApiClient::new(NET_CONFIG_ID)
            .with_timeout(CALL_TIMEOUT_MS)
            .wan_policy()
            .map_err(|e| e.to_string())
    }

    fn adopt(&self, config: &Value) -> Result<Value, String> {
        NetConfigApiClient::new(NET_CONFIG_ID)
            .with_timeout(CALL_TIMEOUT_MS)
            .relay_adopt(config.clone())
            .map_err(|e| e.to_string())
    }

    fn read_kv(&self, key: &str) -> Result<Option<Value>, String> {
        use wasmnest_plugin_api::host::HostStorage;
        use wasmnest_plugin_api::wasm_host::WasmHost;
        HostStorage::storage_get(&WasmHost, key).map_err(|e| e.message)
    }

    fn write_kv(&self, key: &str, value: &Value) -> Result<(), String> {
        use wasmnest_plugin_api::host::HostStorage;
        use wasmnest_plugin_api::wasm_host::WasmHost;
        HostStorage::storage_set(&WasmHost, key, value).map_err(|e| e.message)
    }
}

/// 解析当前可用 relay 配置（wasm；中心优先，缓存兜底）
#[cfg(target_arch = "wasm32")]
pub fn resolve_relay_addrs_via_host() -> Result<ResolvedRelay, String> {
    resolve_relay(&WasmCenterHost)
}

/// 设置页视图（wasm）
#[cfg(target_arch = "wasm32")]
pub fn relay_config_view_via_host() -> Result<Value, String> {
    relay_config_view(&WasmCenterHost)
}

/// 本插件 WAN 开关（wasm；读取失败按默认 true + 原因）
#[cfg(target_arch = "wasm32")]
pub fn allow_wan_via_host() -> (bool, Option<String>) {
    allow_wan_via(&WasmCenterHost)
}

/// 首启迁移（wasm；activate 内 best-effort 调用）
#[cfg(target_arch = "wasm32")]
pub fn migrate_on_activate() -> Result<Value, String> {
    migrate(&WasmCenterHost)
}

/// 迁移状态（wasm）
#[cfg(target_arch = "wasm32")]
pub fn migration_status_via_host() -> Result<Value, String> {
    migration_status(&WasmCenterHost)
}

// ==================== native（cargo test）====================

#[cfg(not(target_arch = "wasm32"))]
pub fn resolve_relay_addrs_via_host() -> Result<ResolvedRelay, String> {
    Err("net-config centre unavailable outside wasm runtime".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relay_config_view_via_host() -> Result<Value, String> {
    Err("net-config centre unavailable outside wasm runtime".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn allow_wan_via_host() -> (bool, Option<String>) {
    (
        true,
        Some("net-config centre unavailable outside wasm runtime".to_string()),
    )
}

#[cfg(not(target_arch = "wasm32"))]
pub fn migrate_on_activate() -> Result<Value, String> {
    Err("net-config centre unavailable outside wasm runtime".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn migration_status_via_host() -> Result<Value, String> {
    Err("net-config centre unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tunnel::RELAY_SETTINGS_STORAGE_KEY;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    const PEER_ID: &str = "12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H";
    const ADDR: &str = "/dns4/relay.example.com/tcp/4001/p2p/12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H";

    fn relay_settings(addrs: &[&str]) -> Value {
        serde_json::json!({
            "version": 1,
            "relayAddrs": addrs,
        })
    }

    struct FakeCenter {
        center: Result<Value, String>,
        policy: Result<Value, String>,
        adopt: Result<Value, String>,
        local: RefCell<BTreeMap<String, Value>>,
    }

    impl FakeCenter {
        fn new(center: Result<Value, String>) -> Self {
            Self {
                center,
                policy: Ok(serde_json::json!({ "version": 1, "apps": {} })),
                adopt: Ok(serde_json::json!({ "adopted": true })),
                local: RefCell::new(BTreeMap::new()),
            }
        }

        fn with_policy(mut self, policy: Result<Value, String>) -> Self {
            self.policy = policy;
            self
        }

        fn with_local(self, value: Value) -> Self {
            self.local
                .borrow_mut()
                .insert(RELAY_SETTINGS_STORAGE_KEY.to_string(), value);
            self
        }

        fn with_adopt(mut self, outcome: Result<Value, String>) -> Self {
            self.adopt = outcome;
            self
        }
    }

    impl RelayCenterHost for FakeCenter {
        fn read_center(&self) -> Result<Value, String> {
            self.center.clone()
        }

        fn read_policy(&self) -> Result<Value, String> {
            self.policy.clone()
        }

        fn adopt(&self, _config: &Value) -> Result<Value, String> {
            self.adopt.clone()
        }

        fn read_kv(&self, key: &str) -> Result<Option<Value>, String> {
            Ok(self.local.borrow().get(key).cloned())
        }

        fn write_kv(&self, key: &str, value: &Value) -> Result<(), String> {
            self.local
                .borrow_mut()
                .insert(key.to_string(), value.clone());
            Ok(())
        }
    }

    #[test]
    fn centre_config_wins_over_local_cache() {
        let host = FakeCenter::new(Ok(serde_json::json!({
            "configured": true,
            "config": relay_settings(&[ADDR]),
        })))
        .with_local(relay_settings(&[
            "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA",
        ]));
        let resolved = resolve_relay(&host).expect("resolve");
        assert_eq!(resolved.source, "center");
        assert_eq!(resolved.addrs, vec![ADDR.to_string()]);
        assert!(resolved.center_error.is_none());
    }

    #[test]
    fn centre_unconfigured_does_not_resurrect_local_cache() {
        let host = FakeCenter::new(Ok(serde_json::json!({
            "configured": false,
            "config": null,
        })))
        .with_local(relay_settings(&[ADDR]));
        let resolved = resolve_relay(&host).expect("resolve");
        assert!(!resolved.configured);
        assert!(resolved.addrs.is_empty());
        assert_eq!(resolved.source, "center", "中心明确未配置 → 不回落到缓存");
    }

    #[test]
    fn centre_failure_falls_back_to_cache_and_reports_reason() {
        let host = FakeCenter::new(Err("api call host error: timeout".to_string()))
            .with_local(relay_settings(&[ADDR]));
        let resolved = resolve_relay(&host).expect("resolve");
        assert!(resolved.configured);
        assert_eq!(resolved.source, "cache");
        assert_eq!(resolved.addrs, vec![ADDR.to_string()]);
        assert!(
            resolved
                .center_error
                .as_deref()
                .unwrap_or("")
                .contains("timeout"),
            "中心错误必须带出（界面要显性提示正在用缓存）"
        );
    }

    #[test]
    fn centre_failure_without_cache_is_a_visible_error() {
        let host = FakeCenter::new(Err("api call host error: no such plugin".to_string()));
        let err = resolve_relay(&host).expect_err("必须显性失败");
        assert!(err.contains("no such plugin"), "{err}");
        assert!(
            err.contains("unavailable"),
            "错误要说明「拿不到配置」而不是空数组: {err}"
        );
    }

    #[test]
    fn corrupted_centre_payload_falls_back_and_reports() {
        let host = FakeCenter::new(Ok(serde_json::json!({
            "configured": true,
            "config": { "version": 1, "relayAddrs": ["not-an-addr"] },
        })))
        .with_local(relay_settings(&[ADDR]));
        let resolved = resolve_relay(&host).expect("resolve");
        assert_eq!(resolved.source, "cache");
        assert!(resolved
            .center_error
            .as_deref()
            .unwrap_or("")
            .contains("shape invalid"));
    }

    #[test]
    fn corrupted_local_cache_is_a_visible_error() {
        let host = FakeCenter::new(Err("down".to_string()))
            .with_local(serde_json::json!({ "version": 9 }));
        let err = resolve_relay(&host).expect_err("缓存损坏必须报错");
        assert!(err.contains("version"), "{err}");
    }

    #[test]
    fn config_view_reports_source_and_center_error() {
        let host = FakeCenter::new(Err("timeout".to_string())).with_local(relay_settings(&[ADDR]));
        let view = relay_config_view(&host).expect("view");
        assert_eq!(view["configured"], serde_json::json!(true));
        assert_eq!(view["source"], serde_json::json!("cache"));
        assert_eq!(view["centerError"], serde_json::json!("timeout"));
        assert_eq!(view["relayAddrs"], serde_json::json!([ADDR]));
        assert_eq!(view["allowWan"], serde_json::json!(true), "未登记默认允许");
    }

    #[test]
    fn wan_policy_gate_defaults_true_and_honours_explicit_false() {
        // 未登记 → 默认 true（新业务不需要先改注册表）
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": false })));
        assert!(allow_wan_for(&host, SELF_PLUGIN_ID).expect("policy"));

        // 显式 false → 关闭
        let off = FakeCenter::new(Ok(serde_json::json!({ "configured": false }))).with_policy(Ok(
            serde_json::json!({
                "version": 1,
                "apps": { SELF_PLUGIN_ID: { "allowWan": false, "note": "", "updatedAt": "2026-11-09T00:00:00Z" } },
            }),
        ));
        assert!(!allow_wan_for(&off, SELF_PLUGIN_ID).expect("policy"));
        assert_eq!(allow_wan_via(&off), (false, None));

        // 显式 true → 开启
        let on = FakeCenter::new(Ok(serde_json::json!({ "configured": false }))).with_policy(Ok(
            serde_json::json!({
                "version": 1,
                "apps": { SELF_PLUGIN_ID: { "allowWan": true, "note": "", "updatedAt": "2026-11-09T00:00:00Z" } },
            }),
        ));
        assert!(allow_wan_for(&on, SELF_PLUGIN_ID).expect("policy"));
    }

    #[test]
    fn wan_policy_read_failure_keeps_default_true_but_reports_reason() {
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": false })))
            .with_policy(Err("api call host error: timeout".to_string()));
        let (allow, error) = allow_wan_via(&host);
        assert!(allow, "注册表读不到时不静默关掉外网（默认 true）");
        assert!(
            error.as_deref().unwrap_or("").contains("timeout"),
            "原因必须上屏: {error:?}"
        );
    }

    #[test]
    fn migrate_adopts_local_cache_and_keeps_it_as_cache() {
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": false })))
            .with_local(relay_settings(&[ADDR]));
        let status = migrate(&host).expect("migrate");
        assert_eq!(status["state"], serde_json::json!("adopted"));
        assert_eq!(
            host.local
                .borrow()
                .get(RELAY_SETTINGS_STORAGE_KEY)
                .expect("local cache retained"),
            &relay_settings(&[ADDR]),
            "成功后本地键保留为缓存"
        );
        assert_eq!(
            host.local
                .borrow()
                .get(MIGRATION_STORAGE_KEY)
                .expect("migration status recorded")["state"],
            serde_json::json!("adopted")
        );
    }

    #[test]
    fn migrate_reports_skipped_when_centre_already_configured() {
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": true })))
            .with_local(relay_settings(&[ADDR]))
            .with_adopt(Ok(serde_json::json!({
                "adopted": false,
                "reason": "already-configured",
            })));
        let status = migrate(&host).expect("migrate");
        assert_eq!(status["state"], serde_json::json!("skipped"));
        assert_eq!(
            status["reason"],
            serde_json::json!("already-configured"),
            "非空不覆盖必须如实回报"
        );
    }

    #[test]
    fn migrate_failures_are_recorded_not_silent() {
        // 本地缓存损坏 → failed
        let corrupt = FakeCenter::new(Ok(serde_json::json!({ "configured": false })))
            .with_local(serde_json::json!({ "version": 3 }));
        let status = migrate(&corrupt).expect("migrate");
        assert_eq!(status["state"], serde_json::json!("failed"));
        assert!(status["detail"].as_str().unwrap_or("").contains("version"));

        // 收养调用失败 → failed
        let down = FakeCenter::new(Ok(serde_json::json!({ "configured": false })))
            .with_local(relay_settings(&[ADDR]))
            .with_adopt(Err("api call host error: timeout".to_string()));
        let status = migrate(&down).expect("migrate");
        assert_eq!(status["state"], serde_json::json!("failed"));
        assert!(status["detail"]
            .as_str()
            .unwrap_or("")
            .contains("timeout"));
    }

    #[test]
    fn migrate_without_local_cache_records_nothing() {
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": false })));
        let status = migrate(&host).expect("migrate");
        assert_eq!(status["state"], serde_json::json!("none"));
        assert!(
            host.local.borrow().get(MIGRATION_STORAGE_KEY).is_none(),
            "没有本地配置时不写迁移记录"
        );
    }

    #[test]
    fn migration_status_reads_record_and_rejects_garbage() {
        let host = FakeCenter::new(Ok(serde_json::json!({ "configured": false })));
        assert_eq!(
            migration_status(&host).expect("status")["state"],
            serde_json::json!("none")
        );
        host.local.borrow_mut().insert(
            MIGRATION_STORAGE_KEY.to_string(),
            serde_json::json!({ "version": 1, "state": "adopted" }),
        );
        assert_eq!(
            migration_status(&host).expect("status")["state"],
            serde_json::json!("adopted")
        );
        host.local.borrow_mut().insert(
            MIGRATION_STORAGE_KEY.to_string(),
            serde_json::json!({ "version": 1, "state": "weird" }),
        );
        assert!(migration_status(&host).is_err());
    }

    #[test]
    fn peer_id_fixture_is_well_formed() {
        // 锁住夹具：PEER_ID 变化会让上面的地址校验静默失效
        assert!(ADDR.contains(PEER_ID));
    }
}
