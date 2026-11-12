//! 网络配置中心（`com.wasmnest.net-config`）消费面 —— relay 地址去重（T21 收尾）
//!
//! T18 起 relay 地址的**真源**是「内网穿透」配置中心（`servers/net-config`）；本插件
//! 的 settings KV `relayAddrs` 降级为**本地缓存**（中心不可用时兜底，与 BedCode
//! `relay_center` 同口径）。
//!
//! ## 为什么在插件后端读
//!
//! 宿主给应用前端的命令白名单里没有跨插件调用原语（`host-api-call` 只在 wasm
//! guest 侧可用），所以「业务取中心配置」只能由业务后端转发。本模块是**薄读取
//! 层**：只调中心的只读 api `relay-config`，不代任何业务 `expose` / `connect`，
//! 也不写中心。
//!
//! ## 失败语义（fail-visible）
//!
//! - 中心明确「未配置」（`configured:false`）→ 空地址 = 仅 LAN，**不**回落到本地
//!   缓存（用户可能是主动清空的，复活旧值等于静默撤销）；
//! - 中心不可用（超时 / 未登记 / 被禁用 / 载荷损坏）→ 用本地缓存，并把中心错误
//!   带出，由界面显性提示；
//! - 移动端没有配置中心（`net-config` 只有桌面端；移动宿主的 `host-api-call` 是
//!   显性 unsupported 桩）→ 直接用本地缓存，不报错。
//!
//! 测试策略：纯解析 / 降级编排经 [`RelayCenter`] 注入假实现 native 直测；wasm
//! 侧真正的互调闭环由构建期 `#[plugin_api]` 的 manifest 比对 + 宿主测试覆盖。
//!
//! native 构建只有编排层单测在用（client / 入口是 wasm-only），故 dead_code
//! 仅在 native 放宽；wasm 侧的真正死代码仍会被 clippy 报出来。
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use serde_json::Value;
use wasmnest_file_transfer_core::settings::normalize_relay_addrs;

use crate::platform::Platform;

/// 网络配置中心插件 id（仅 wasm 端使用）
#[cfg(target_arch = "wasm32")]
pub(crate) const NET_CONFIG_ID: &str = "com.wasmnest.net-config";

/// 单次互调超时（毫秒）：读面在人机交互窗口内
#[cfg(target_arch = "wasm32")]
const CALL_TIMEOUT_MS: u64 = 5_000;

#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::HostBus;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::plugin_api;

/// 消费方镜像（判据 `trait ⊆ manifest`：只声明真正调用的一条）
///
/// 仅 wasm 目标声明：native（cargo test）不消费 client，跳过宏展开。
#[cfg(target_arch = "wasm32")]
#[plugin_api(manifest = "../../../../servers/net-config/desktop/plugin.json")]
#[allow(dead_code)]
pub(crate) trait NetConfigApi {
    #[api("relay-config")]
    fn relay_config() -> Result<Value, String>;
}

/// 中心 relay 配置读面（native 单测注入假实现）
pub(crate) trait RelayCenter {
    fn relay_config(&self) -> Result<Value, String>;
}

/// wasm 真实现：宏生成 client 直连配置中心
#[cfg(target_arch = "wasm32")]
pub(crate) struct WasmRelayCenter;

#[cfg(target_arch = "wasm32")]
impl RelayCenter for WasmRelayCenter {
    fn relay_config(&self) -> Result<Value, String> {
        NetConfigApiClient::new(NET_CONFIG_ID)
            .with_timeout(CALL_TIMEOUT_MS)
            .relay_config()
            .map_err(|e| e.to_string())
    }
}

/// 地址来源（界面据此区分「中心已配置」与「降级用缓存」）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RelaySource {
    Center,
    Cache,
    /// 邀请导入的地址（`relay_origin = invite`）：中心明确未配置时允许生效
    Invite,
}

impl RelaySource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Center => "center",
            Self::Cache => "cache",
            Self::Invite => "invite",
        }
    }
}

/// 解析后的 relay 视图
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RelayView {
    /// 生效地址（来源见 `source`；空 = 仅内网）
    pub addrs: Vec<String>,
    pub source: RelaySource,
    /// 读取 / 解析中心的错误（仅降级时非空；不吞，交界面展示）
    pub error: Option<String>,
}

impl RelayView {
    /// 仅用本机缓存（移动端 / native 测试）
    pub(crate) fn from_cache(cache: &[String], error: Option<String>) -> Self {
        Self {
            addrs: cache.to_vec(),
            source: RelaySource::Cache,
            error,
        }
    }

    /// 邀请导入的地址（用户显式动作，来源与手动缓存区分开，便于界面提示）
    fn from_invite(cache: &[String], error: Option<String>) -> Self {
        Self {
            addrs: cache.to_vec(),
            source: RelaySource::Invite,
            error,
        }
    }
}

/// 解析中心只读 api 回执：`{configured, config: {relayAddrs: [...]} | null}`。
///
/// 地址再过一遍核内 `normalize_relay_addrs`（形状 / 去重 / 禁 `/p2p-circuit`）：
/// 中心导入时已校验，但存储可能被旧版本或手工改坏——坏值整批拒绝并点名，
/// 不静默丢单条。
pub(crate) fn parse_center_relay(view: &Value) -> Result<Vec<String>, String> {
    let configured = view
        .get("configured")
        .and_then(Value::as_bool)
        .ok_or_else(|| "relay-config: missing boolean `configured`".to_string())?;
    if !configured {
        return Ok(Vec::new());
    }
    let raw = view
        .get("config")
        .and_then(|c| c.get("relayAddrs"))
        .and_then(Value::as_array)
        .ok_or_else(|| "relay-config: configured but `config.relayAddrs` missing".to_string())?;
    let mut addrs = Vec::with_capacity(raw.len());
    for item in raw {
        let addr = item
            .as_str()
            .ok_or_else(|| "relay-config: `relayAddrs` contains non-string".to_string())?;
        addrs.push(addr.to_string());
    }
    normalize_relay_addrs(&addrs)
}

/// 中心优先、缓存兜底。中心「明确未配置」= 空（不复活手动缓存）。
///
/// 唯一例外是 `origin = invite`：邀请导入是显式用户动作，中心为空 / 不可用时
/// 允许使用邀请带来的缓存地址（否则「按邀请加入」在桌面上永远无效）。中心已
/// 配置时仍中心优先——冲突留给界面提示，不在这里静默覆盖。
pub(crate) fn resolve(center: &dyn RelayCenter, cache: &[String], origin: &str) -> RelayView {
    let invite = origin == "invite" && !cache.is_empty();
    match center.relay_config().and_then(|v| parse_center_relay(&v)) {
        Ok(addrs) if !addrs.is_empty() => RelayView {
            addrs,
            source: RelaySource::Center,
            error: None,
        },
        // 中心明确未配置（或配置为空表）：邀请缓存可以生效，手动缓存不复活
        Ok(_) if invite => RelayView::from_invite(cache, None),
        Ok(_) => RelayView {
            addrs: Vec::new(),
            source: RelaySource::Center,
            error: None,
        },
        Err(e) if invite => RelayView::from_invite(cache, Some(e)),
        Err(e) => RelayView::from_cache(cache, Some(e)),
    }
}

/// 按端解析生效 relay 地址：桌面读中心（失败回退缓存），移动直接用本地缓存。
///
/// 单产物双端共用：`activate` 与 `get-my-device` 都经这里，避免两处口径漂移。
pub(crate) fn effective(platform: Platform, cache: &[String], origin: &str) -> RelayView {
    match platform {
        Platform::Desktop => center_relay_view(cache, origin),
        // 移动端没有配置中心：邀请来源只影响提示文案，地址直接用本地缓存
        Platform::Mobile if origin == "invite" => RelayView::from_invite(cache, None),
        Platform::Mobile => RelayView::from_cache(cache, None),
    }
}

/// 桌面：中心优先、缓存兜底。native 构建（cargo test）不触达互调，只用缓存。
#[cfg(target_arch = "wasm32")]
fn center_relay_view(cache: &[String], origin: &str) -> RelayView {
    resolve(&WasmRelayCenter, cache, origin)
}

#[cfg(not(target_arch = "wasm32"))]
fn center_relay_view(cache: &[String], origin: &str) -> RelayView {
    if origin == "invite" {
        return RelayView::from_invite(cache, None);
    }
    RelayView::from_cache(cache, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fake(Result<Value, String>);

    impl RelayCenter for Fake {
        fn relay_config(&self) -> Result<Value, String> {
            self.0.clone()
        }
    }

    fn relay_addr() -> &'static str {
        "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay"
    }

    #[test]
    fn parse_accepts_configured_payload() {
        let view = json!({
            "configured": true,
            "config": { "relayAddrs": [relay_addr()] }
        });
        assert_eq!(parse_center_relay(&view).unwrap(), vec![relay_addr()]);
    }

    #[test]
    fn parse_treats_explicitly_unconfigured_as_empty() {
        let view = json!({ "configured": false, "config": null });
        assert_eq!(parse_center_relay(&view).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn parse_rejects_missing_flag_and_missing_addrs() {
        assert!(parse_center_relay(&json!({})).is_err());
        assert!(parse_center_relay(&json!({ "configured": true, "config": {} })).is_err());
        assert!(parse_center_relay(
            &json!({ "configured": true, "config": { "relayAddrs": [1] } })
        )
        .is_err());
    }

    #[test]
    fn parse_rejects_corrupt_addresses() {
        // 带 /p2p-circuit 的是拨号目标，不是中继端点——整批拒绝
        let view = json!({
            "configured": true,
            "config": { "relayAddrs": [format!("{}/p2p-circuit/p2p/abc", relay_addr())] }
        });
        assert!(parse_center_relay(&view).is_err());
    }

    #[test]
    fn resolve_prefers_center_and_ignores_cache() {
        let center = Fake(Ok(json!({
            "configured": true,
            "config": { "relayAddrs": [relay_addr()] }
        })));
        let view = resolve(
            &center,
            &["/ip4/198.51.100.7/tcp/4001/p2p/old".to_string()],
            "",
        );
        assert_eq!(view.source, RelaySource::Center);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert!(view.error.is_none());
    }

    #[test]
    fn resolve_does_not_resurrect_manual_cache_when_center_is_empty() {
        let center = Fake(Ok(json!({ "configured": false, "config": null })));
        let view = resolve(&center, &[relay_addr().to_string()], "");
        assert_eq!(view.source, RelaySource::Center);
        assert!(view.addrs.is_empty());
        assert!(view.error.is_none());
    }

    #[test]
    fn resolve_uses_invite_cache_when_center_is_empty() {
        let center = Fake(Ok(json!({ "configured": false, "config": null })));
        let view = resolve(&center, &[relay_addr().to_string()], "invite");
        assert_eq!(view.source, RelaySource::Invite);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert!(view.error.is_none());
    }

    #[test]
    fn resolve_keeps_center_over_invite_cache() {
        let center = Fake(Ok(
            json!({ "configured": true, "config": { "relayAddrs": [relay_addr()] } }),
        ));
        let view = resolve(
            &center,
            &["/ip4/198.51.100.7/tcp/4001/p2p/invite".to_string()],
            "invite",
        );
        assert_eq!(view.source, RelaySource::Center);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert!(view.error.is_none());
    }

    #[test]
    fn resolve_invite_with_empty_cache_falls_back_to_center_semantics() {
        let center = Fake(Ok(json!({ "configured": false, "config": null })));
        let view = resolve(&center, &[], "invite");
        assert_eq!(view.source, RelaySource::Center);
        assert!(view.addrs.is_empty());
        assert!(view.error.is_none());
    }

    #[test]
    fn resolve_falls_back_to_cache_on_center_failure() {
        let center = Fake(Err("api-call: timeout".to_string()));
        let view = resolve(&center, &[relay_addr().to_string()], "");
        assert_eq!(view.source, RelaySource::Cache);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert_eq!(view.error.as_deref(), Some("api-call: timeout"));
    }

    #[test]
    fn resolve_marks_invite_cache_with_center_error_on_failure() {
        let center = Fake(Err("api-call: timeout".to_string()));
        let view = resolve(&center, &[relay_addr().to_string()], "invite");
        assert_eq!(view.source, RelaySource::Invite);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert_eq!(view.error.as_deref(), Some("api-call: timeout"));
    }

    #[test]
    fn resolve_falls_back_when_center_payload_is_corrupt() {
        let center = Fake(Ok(
            json!({ "configured": true, "config": { "relayAddrs": "x" } }),
        ));
        let view = resolve(&center, &[relay_addr().to_string()], "");
        assert_eq!(view.source, RelaySource::Cache);
        assert_eq!(view.addrs, vec![relay_addr()]);
        assert!(view.error.is_some());
    }
}
