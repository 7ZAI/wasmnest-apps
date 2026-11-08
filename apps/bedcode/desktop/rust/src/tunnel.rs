//! 内网穿透通道的应用侧编排（T07 / T08）
//!
//! 机制（首帧 / 票据 / ACL / 本地代理 / 引用计数 / 模式判定）全在宿主隧道管理器
//! （`host-tunnel`，T06）。本模块只做**应用自己的三件事**：
//!
//! 1. **通道配置**：把应用级网络配置（插件 KV `network.relay`，T14 导入的中继地址）
//!    写成宿主 `tunnel-configure`。`allowWan` 由「是否配置了中继地址」推出——
//!    没有中继地址却宣称允许外网，只会让每次 `expose` 都拿到 `wan-disabled`；
//! 2. **暴露本机 HTTP 面**：登记 `kind=http` 的暴露规则（端口 = 宿主实际运行端口），
//!    让已匹配 peer 能经隧道访问本应用的 `/api/*`（T07 的 expose + reservation）；
//! 3. **生产配对 `peer`**：`{nodeId, addrs, ticket}`——QR v2 / 连接串 `peer` 字段的
//!    唯一后端来源（T08）。地址来自宿主 `status.node.addrs`（宿主把通配监听地址
//!    展开成可拨地址），票据是宿主签发的一次性配对票据（TTL ≤ 120s，不变量 4）。
//!
//! **加密不可关闭**：本域没有「关闭加密」的原语；`allowWan=false` 只关外网通道，
//! 链路加密永久强制（不变量 12/14）。
//!
//! **失败语义（fail-visible）**：隧道面缺失 / 配置损坏 → 显性错误；配对载荷生产失败
//! 时**不产出残缺 `peer`**（半份 `peer` 会让对端拨不通，且违反 `pairingPayload`
//! 的显性失败判据）——调用方据此退回 v1 载荷，并把失败原因随回执带给界面。

#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::host::{HostStorage, HostTunnel, TunnelConfig, TunnelExposeConfig};
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 应用级网络配置键（真源 = 前端 `useRelaySettings` 的 `RELAY_SETTINGS_STORAGE_KEY`）
pub const RELAY_SETTINGS_STORAGE_KEY: &str = "network.relay";

/// 一次性配对票据 TTL（秒）：不变量 4 上限 120s，取上限（窗口越短越安全，
/// 但过短会让「扫码 → 对端拨号」擦边失败）
pub const PAIRING_TICKET_TTL_SECS: u32 = 120;

/// 暴露规则类型：本应用的隧道后端恒为对等 HTTP/WS 面
pub const EXPOSE_KIND_HTTP: &str = "http";

/// 暴露规则标签（仅展示用）
pub const EXPOSE_LABEL: &str = "bedcode";

/// 隧道状态投影里 `node.addrs` 的最小可拨判据（与前端 `pairingPayload` 同口径）
///
/// 只做**格式**校验：地址必须以 `/` 开头、无空白、带 `/p2p/` 目标段，且不是
/// `/ip4/0.0.0.0` 这类不可拨地址。宿主已负责把通配监听地址展开。
fn is_dialable_addr(addr: &str) -> bool {
    if !addr.starts_with('/') || addr.contains(char::is_whitespace) {
        return false;
    }
    if !addr.contains("/p2p/") {
        return false;
    }
    !(addr.contains("/ip4/0.0.0.0") || addr.contains("/ip6/::"))
}

/// 插件 KV `network.relay` → 中继地址列表
///
/// 存储内容不可信（旧版本 / 手工改坏），但**不静默丢弃**：解析不出来就显性报错，
/// 由调用方决定提示；静默当成「没配置」会让用户以为已启用却永远走不到外网。
///
/// 只取 `relayAddrs`（应用自己的字段）；`version` 不是 1 视为未知版本 → 报错。
pub fn relay_addrs_from_settings(value: &serde_json::Value) -> Result<Vec<String>, String> {
    let version = value.get("version").and_then(|v| v.as_u64());
    if version != Some(1) {
        return Err(format!(
            "relay settings version unsupported: {}",
            version
                .map(|v| v.to_string())
                .unwrap_or_else(|| "<missing>".into())
        ));
    }
    let raw = value
        .get("relayAddrs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "relay settings missing relayAddrs".to_string())?;
    let mut addrs: Vec<String> = Vec::with_capacity(raw.len());
    for item in raw {
        let addr = item.as_str().map(str::trim).unwrap_or("");
        if addr.is_empty() {
            return Err("relay settings has empty relay address".to_string());
        }
        addrs.push(addr.to_string());
    }
    if addrs.is_empty() {
        return Err("relay settings has no relay address".to_string());
    }
    Ok(addrs)
}

/// 宿主 `status` + 票据 → 配对载荷的 `peer` 字段
///
/// 判据（任一不满足即显性失败，绝不产出残缺 `peer`）：
/// - `node.nodeId` 非空（宿主已验证的身份，本端不代签）；
/// - `node.addrs` 至少一条**可拨**地址（空地址列表的 `peer` 等于给对端一个
///   拨不通的号码）；
/// - 票据非空。
pub fn peer_info_from_status(
    status: &serde_json::Value,
    ticket: &str,
) -> Result<serde_json::Value, String> {
    let node_id = status
        .get("node")
        .and_then(|n| n.get("nodeId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "tunnel node id unavailable (node not started)".to_string())?;

    let ticket = ticket.trim();
    if ticket.is_empty() {
        return Err("pairing ticket is empty".to_string());
    }

    let raw_addrs = status
        .get("node")
        .and_then(|n| n.get("addrs"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "tunnel node addrs unavailable".to_string())?;
    let mut addrs: Vec<String> = Vec::with_capacity(raw_addrs.len());
    for item in raw_addrs {
        let addr = item.as_str().map(str::trim).unwrap_or("");
        if !is_dialable_addr(addr) {
            continue;
        }
        if !addrs.iter().any(|existing| existing == addr) {
            addrs.push(addr.to_string());
        }
    }
    if addrs.is_empty() {
        return Err(
            "tunnel node has no dialable address (relay / LAN address missing)".to_string(),
        );
    }

    Ok(serde_json::json!({
        "nodeId": node_id,
        "addrs": addrs,
        "ticket": ticket,
    }))
}

/// 宿主 `status` → 设备页只读视图（字段全部来自宿主，本端只重命名/裁剪）
///
/// 只读投影，不含票据 / 令牌明文（宿主 `status` 本身也不含）。
pub fn status_view(status: &serde_json::Value) -> serde_json::Value {
    let node = status.get("node");
    let relay = status.get("relay");
    let modes: Vec<serde_json::Value> = status
        .get("modes")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    Some(serde_json::json!({
                        "nodeId": row.get("nodeId")?.as_str()?,
                        "mode": row.get("mode")?.as_str()?,
                        "reason": row.get("reason").cloned().unwrap_or(serde_json::Value::Null),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    serde_json::json!({
        "nodeId": node.and_then(|n| n.get("nodeId")).cloned().unwrap_or(serde_json::Value::Null),
        "started": node.and_then(|n| n.get("started")).and_then(|v| v.as_bool()).unwrap_or(false),
        "addrs": node.and_then(|n| n.get("addrs")).cloned().unwrap_or_else(|| serde_json::json!([])),
        "peerFace": status.get("peerFace").cloned().unwrap_or(serde_json::Value::Null),
        "allowWan": status.get("allowWan").and_then(|v| v.as_bool()).unwrap_or(false),
        "relayAddrsConfigured": status
            .get("relayAddrsConfigured")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "reservation": status.get("reservation").and_then(|v| v.as_bool()).unwrap_or(false),
        "relayState": relay.and_then(|r| r.get("state")).cloned().unwrap_or(serde_json::Value::Null),
        "relayAddr": relay.and_then(|r| r.get("relayAddr")).cloned().unwrap_or(serde_json::Value::Null),
        "relayDetail": relay.and_then(|r| r.get("detail")).cloned().unwrap_or(serde_json::Value::Null),
        "exposeRules": status.get("exposeRules").and_then(|v| v.as_u64()).unwrap_or(0),
        "connects": status.get("connects").and_then(|v| v.as_u64()).unwrap_or(0),
        "modes": modes,
    })
}

/// 宿主隧道面（native 单测注入替身：wasm 专属 import 符号在 native 链接里不存在）
///
/// 方法名刻意与 `HostTunnel`（SDK 的宿主 trait）**不同名**：两者都实现于
/// `WasmHost`，同名会让 `host.method()` 变成 E0034 多候选歧义。
pub trait TunnelHost {
    /// 写入本应用的通道配置（幂等全量替换；宿主只改引用计数）
    fn apply_config(&self, allow_wan: bool, relay_addrs: &[String]) -> Result<bool, String>;
    /// 登记暴露规则 → 规则 id（宿主幂等：同 port + kind 返回既有 id）
    fn expose_http(&self, port: u16, kind: &str, label: &str) -> Result<String, String>;
    /// 撤销暴露规则 → 是否命中
    fn unexpose_rule(&self, rule_id: &str) -> Result<bool, String>;
    /// 只读状态投影（节点 / 对等面 / relay / 本应用计数 / 每对端模式）
    fn read_status(&self) -> Result<serde_json::Value, String>;
    /// 签发一次性配对票据（TTL ≤ 120s；明文不落日志）
    fn issue_ticket(&self, port: u16, ttl_secs: u32) -> Result<String, String>;
    /// 读插件 KV（应用级网络配置）
    fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String>;
}

/// wasm 运行时：宿主隧道面（`wasmnest:tunnel/host-tunnel`）
#[cfg(target_arch = "wasm32")]
impl TunnelHost for WasmHost {
    fn apply_config(&self, allow_wan: bool, relay_addrs: &[String]) -> Result<bool, String> {
        HostTunnel::tunnel_configure(
            self,
            &TunnelConfig {
                allow_wan,
                relay_addrs: relay_addrs.to_vec(),
            },
        )
        .map_err(|e| e.message)
    }

    fn expose_http(&self, port: u16, kind: &str, label: &str) -> Result<String, String> {
        HostTunnel::tunnel_expose(
            self,
            &TunnelExposeConfig {
                port,
                kind: kind.to_string(),
                label: label.to_string(),
                // 空 = 所有**已匹配** peer（授权仍由隧道 ACL / 宿主信任表裁决，
                // 本应用不在这里另造白名单）
                allowed_peers: Vec::new(),
            },
        )
        .map_err(|e| e.message)
    }

    fn unexpose_rule(&self, rule_id: &str) -> Result<bool, String> {
        HostTunnel::tunnel_unexpose(self, rule_id).map_err(|e| e.message)
    }

    fn read_status(&self) -> Result<serde_json::Value, String> {
        HostTunnel::tunnel_status(self).map_err(|e| e.message)
    }

    fn issue_ticket(&self, port: u16, ttl_secs: u32) -> Result<String, String> {
        HostTunnel::tunnel_issue_pairing_ticket(self, port, ttl_secs).map_err(|e| e.message)
    }

    fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String> {
        HostStorage::storage_get(self, key).map_err(|e| e.message)
    }
}

/// 应用配置 → 宿主通道配置（幂等；每次 `expose` 前都可安全重放）
///
/// `allowWan` 由「配置里有中继地址」推出：`allowWan=true` 且没有中继地址会被宿主
/// 直接拒绝（`wan-disabled`），那是配置错误而不是安全默认值。
pub fn sync_channel_config(host: &impl TunnelHost) -> Result<bool, String> {
    let relay_addrs = match host.read_storage(RELAY_SETTINGS_STORAGE_KEY)? {
        None => Vec::new(),
        Some(value) => relay_addrs_from_settings(&value)?,
    };
    let allow_wan = !relay_addrs.is_empty();
    host.apply_config(allow_wan, &relay_addrs)
}

/// 确保本机 HTTP 面已暴露 → 规则 id（端口非法即显性失败，不发「0 号端口」规则）
pub fn ensure_http_exposed(host: &impl TunnelHost, port: u16) -> Result<String, String> {
    if port == 0 {
        return Err("network port unavailable (config missing/invalid)".to_string());
    }
    host.expose_http(port, EXPOSE_KIND_HTTP, EXPOSE_LABEL)
}

/// 通道准备（写配置 + 登记暴露规则）→ 规则 id
///
/// 幂等：宿主按 port + kind 返回同一规则 id，重复调用不会产生多条规则。
/// 放在配对 / 状态页入口调用一次，保证「配对成功后业务面立刻可达」。
pub fn prepare_channel(host: &impl TunnelHost, port: u16) -> Result<String, String> {
    if port == 0 {
        return Err("network port unavailable (config missing/invalid)".to_string());
    }
    sync_channel_config(host)?;
    ensure_http_exposed(host, port)
}

/// 生产配对 `peer`：签票据 → 读状态 → 组装
///
/// 顺序刻意是「票据 → 状态」：票据签发路径会确保对等面与节点在场
/// （`ensure_peer_face` 内含 `ensure_running`），反过来读状态可能拿到
/// `nodeId = null`。调用方应先 [`prepare_channel`]（保证业务面可达）。
pub fn pairing_peer(host: &impl TunnelHost, port: u16) -> Result<serde_json::Value, String> {
    if port == 0 {
        return Err("network port unavailable (config missing/invalid)".to_string());
    }
    let ticket = host.issue_ticket(port, PAIRING_TICKET_TTL_SECS)?;
    let status = host.read_status()?;
    peer_info_from_status(&status, &ticket)
}

// ==================== 命令面（wasm 运行时） ====================

/// 已登记的暴露规则 id（撤销时用；宿主幂等返回同一 id，重复准备不产生多条规则）
#[cfg(target_arch = "wasm32")]
static EXPOSED_RULE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(target_arch = "wasm32")]
fn remember_rule(rule_id: String) {
    if let Ok(mut guard) = EXPOSED_RULE.lock() {
        *guard = Some(rule_id);
    }
}

/// 准备隧道（配置 + 暴露）→ 只读状态视图
#[cfg(target_arch = "wasm32")]
pub fn prepare_via_host(port: u16) -> Result<serde_json::Value, String> {
    let host = WasmHost;
    let rule = prepare_channel(&host, port)?;
    remember_rule(rule);
    Ok(status_view(&host.read_status()?))
}

/// 只读状态视图（不做配置 / 暴露，供轮询展示）
#[cfg(target_arch = "wasm32")]
pub fn status_via_host() -> Result<serde_json::Value, String> {
    Ok(status_view(&WasmHost.read_status()?))
}

/// 生产配对 `peer`（QR v2 / 连接串的 `peer` 字段；内部先准备通道）
#[cfg(target_arch = "wasm32")]
pub fn pairing_peer_via_host(port: u16) -> Result<serde_json::Value, String> {
    let host = WasmHost;
    let rule = prepare_channel(&host, port)?;
    remember_rule(rule);
    pairing_peer(&host, port)
}

/// 撤销本应用的暴露规则（未准备过 = 幂等空操作，不凭空建一条再删）
#[cfg(target_arch = "wasm32")]
pub fn unexpose_via_host() -> Result<bool, String> {
    let rule_id = EXPOSED_RULE
        .lock()
        .map_err(|e| format!("tunnel expose rule lock: {e}"))?
        .take();
    match rule_id {
        Some(rule_id) => WasmHost.unexpose_rule(&rule_id),
        None => Ok(false),
    }
}

/// 准备隧道（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn prepare_via_host(_port: u16) -> Result<serde_json::Value, String> {
    Err("tunnel unavailable outside wasm runtime".to_string())
}

/// 只读状态视图（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn status_via_host() -> Result<serde_json::Value, String> {
    Err("tunnel unavailable outside wasm runtime".to_string())
}

/// 生产配对 `peer`（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn pairing_peer_via_host(_port: u16) -> Result<serde_json::Value, String> {
    Err("tunnel unavailable outside wasm runtime".to_string())
}

/// 撤销暴露规则（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn unexpose_via_host() -> Result<bool, String> {
    Err("tunnel unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const NODE_ID: &str = "12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA";

    fn status_with(addrs: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "node": { "started": true, "nodeId": NODE_ID, "addrs": addrs },
            "peerFace": "127.0.0.1:39001",
            "allowWan": true,
            "relayAddrsConfigured": 1,
            "reservation": true,
            "relay": { "state": "relay-active", "relayAddr": "/ip4/203.0.113.9/tcp/4001", "detail": "" },
            "exposeRules": 1,
            "connects": 0,
            "modes": [],
        })
    }

    /// 中继地址：只认 version 1 + 非空 relayAddrs；空 / 缺字段 / 未知版本显性报错
    #[test]
    fn relay_settings_parse_is_strict() {
        let ok = serde_json::json!({
            "version": 1,
            "relayAddrs": ["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWPbYEEfpRvnRKk2YLu43F28fLZgU22wic2M5m6Spkv9ZA"],
        });
        assert_eq!(
            relay_addrs_from_settings(&ok).expect("parse"),
            vec!["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWPbYEEfpRvnRKk2YLu43F28fLZgU22wic2M5m6Spkv9ZA".to_string()]
        );

        for (name, value) in [
            (
                "未知版本",
                serde_json::json!({ "version": 2, "relayAddrs": ["/ip4/1.2.3.4/tcp/1"] }),
            ),
            (
                "缺版本",
                serde_json::json!({ "relayAddrs": ["/ip4/1.2.3.4/tcp/1"] }),
            ),
            (
                "空列表",
                serde_json::json!({ "version": 1, "relayAddrs": [] }),
            ),
            (
                "空字符串",
                serde_json::json!({ "version": 1, "relayAddrs": ["  "] }),
            ),
            (
                "非数组",
                serde_json::json!({ "version": 1, "relayAddrs": "/ip4/1.2.3.4/tcp/1" }),
            ),
        ] {
            assert!(
                relay_addrs_from_settings(&value).is_err(),
                "{name} 必须显性失败（不静默当「未配置」）"
            );
        }
    }

    /// 配对 `peer`：nodeId / 可拨地址 / 票据三者齐全才产出，且过滤不可拨地址
    #[test]
    fn peer_info_requires_node_id_dialable_addr_and_ticket() {
        let peer = peer_info_from_status(
            &status_with(serde_json::json!([
                "/ip4/0.0.0.0/tcp/39000/p2p/".to_string() + NODE_ID,
                "/ip4/192.168.1.7/tcp/39000/p2p/".to_string() + NODE_ID,
                "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWPbYEEfpRvnRKk2YLu43F28fLZgU22wic2M5m6Spkv9ZA/p2p-circuit/p2p/".to_string() + NODE_ID,
            ])),
            "ticket-1",
        )
        .expect("peer");
        assert_eq!(peer["nodeId"], NODE_ID);
        assert_eq!(
            peer["addrs"],
            serde_json::json!([
                "/ip4/192.168.1.7/tcp/39000/p2p/".to_string() + NODE_ID,
                "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWPbYEEfpRvnRKk2YLu43F28fLZgU22wic2M5m6Spkv9ZA/p2p-circuit/p2p/".to_string() + NODE_ID,
            ]),
            "不可拨的通配地址必须被丢弃，可拨地址保序"
        );
        assert_eq!(peer["ticket"], "ticket-1");
    }

    /// 缺 nodeId / 无可用地址 / 空票据 → 显性失败（不产出半份 peer）
    #[test]
    fn peer_info_fails_visible_instead_of_emitting_partial_peer() {
        let no_node =
            serde_json::json!({ "node": { "started": false, "nodeId": null, "addrs": [] } });
        assert!(peer_info_from_status(&no_node, "ticket").is_err());

        let no_addr = status_with(serde_json::json!([
            "/ip4/0.0.0.0/tcp/39000/p2p/x".to_string()
        ]));
        assert!(
            peer_info_from_status(&no_addr, "ticket").is_err(),
            "只有通配地址时视为无可用地址"
        );

        let ok_status = status_with(serde_json::json!([
            "/ip4/10.0.0.5/tcp/39000/p2p/x".to_string()
        ]));
        assert!(
            peer_info_from_status(&ok_status, "  ").is_err(),
            "空票据不得放行"
        );
    }

    /// 状态视图只透出可展示字段（不含票据 / 令牌），模式数组裁剪成三字段
    #[test]
    fn status_view_projects_only_display_fields() {
        let mut status = status_with(serde_json::json!([
            "/ip4/10.0.0.5/tcp/39000/p2p/x".to_string()
        ]));
        status["modes"] = serde_json::json!([{
            "nodeId": NODE_ID,
            "mode": "wan-active",
            "reason": "cellular",
            "lanProbeWins": 0,
            "manualWan": false,
            "updatedAtMs": 1,
        }]);
        let view = status_view(&status);
        assert_eq!(view["nodeId"], NODE_ID);
        assert_eq!(view["allowWan"], true);
        assert_eq!(view["reservation"], true);
        assert_eq!(view["relayState"], "relay-active");
        assert_eq!(view["exposeRules"], 1);
        assert_eq!(
            view["modes"],
            serde_json::json!([{ "nodeId": NODE_ID, "mode": "wan-active", "reason": "cellular" }])
        );
        assert!(
            !view.to_string().contains("ticket") && !view.to_string().contains("token"),
            "只读视图不得携带票据 / 令牌"
        );
    }

    /// 替身（native 单测）：记录调用顺序与参数
    #[derive(Default)]
    struct FakeTunnel {
        stored: RefCell<Option<serde_json::Value>>,
        calls: RefCell<Vec<String>>,
        status: serde_json::Value,
        expose_error: RefCell<Option<String>>,
    }

    impl FakeTunnel {
        fn new(status: serde_json::Value, stored: Option<serde_json::Value>) -> Self {
            Self {
                stored: RefCell::new(stored),
                calls: RefCell::new(Vec::new()),
                status,
                expose_error: RefCell::new(None),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl TunnelHost for FakeTunnel {
        fn apply_config(&self, allow_wan: bool, relay_addrs: &[String]) -> Result<bool, String> {
            self.calls.borrow_mut().push(format!(
                "configure allowWan={allow_wan} addrs={}",
                relay_addrs.len()
            ));
            Ok(true)
        }

        fn expose_http(&self, port: u16, kind: &str, label: &str) -> Result<String, String> {
            if let Some(err) = self.expose_error.borrow().as_ref() {
                return Err(err.clone());
            }
            self.calls
                .borrow_mut()
                .push(format!("expose {port} {kind} {label}"));
            Ok("rule-1".to_string())
        }

        fn unexpose_rule(&self, rule_id: &str) -> Result<bool, String> {
            self.calls.borrow_mut().push(format!("unexpose {rule_id}"));
            Ok(true)
        }

        fn read_status(&self) -> Result<serde_json::Value, String> {
            self.calls.borrow_mut().push("status".to_string());
            Ok(self.status.clone())
        }

        fn issue_ticket(&self, port: u16, ttl_secs: u32) -> Result<String, String> {
            self.calls
                .borrow_mut()
                .push(format!("ticket {port} ttl={ttl_secs}"));
            Ok("ticket-1".to_string())
        }

        fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String> {
            self.calls.borrow_mut().push(format!("storage {key}"));
            Ok(self.stored.borrow().clone())
        }
    }

    /// 通道配置由应用 KV 推出：有中继地址才 allowWan；未配置 = lan-only
    #[test]
    fn channel_config_follows_relay_settings() {
        let status = status_with(serde_json::json!([
            "/ip4/10.0.0.5/tcp/39000/p2p/x".to_string()
        ]));

        let none = FakeTunnel::new(status.clone(), None);
        assert!(sync_channel_config(&none).expect("configure"));
        assert_eq!(
            none.calls(),
            vec![
                format!("storage {RELAY_SETTINGS_STORAGE_KEY}"),
                "configure allowWan=false addrs=0".to_string(),
            ],
            "未配置中继 → allowWan=false（LAN 入口不受影响）"
        );

        let configured = FakeTunnel::new(
            status,
            Some(serde_json::json!({
                "version": 1,
                "relayAddrs": ["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWPbYEEfpRvnRKk2YLu43F28fLZgU22wic2M5m6Spkv9ZA"],
            })),
        );
        assert!(sync_channel_config(&configured).expect("configure"));
        assert_eq!(
            configured.calls().last().unwrap(),
            "configure allowWan=true addrs=1",
            "有中继地址才宣称允许外网"
        );
    }

    /// 存储损坏 → 显性报错，且**不**退回「allowWan=false 继续跑」
    #[test]
    fn channel_config_fails_visible_on_corrupted_settings() {
        let fake = FakeTunnel::new(
            status_with(serde_json::json!([])),
            Some(serde_json::json!({ "version": 7 })),
        );
        let err = sync_channel_config(&fake).expect_err("损坏配置必须报错");
        assert!(err.contains("version"), "错误信息必须点名原因: {err}");
        assert!(
            !fake.calls().iter().any(|c| c.starts_with("configure")),
            "配置不可信时不得写入宿主（避免把用户的中继配置静默清空）"
        );
    }

    /// 端口 0 不得登记暴露规则（否则宿主拿到一条无意义的规则）
    #[test]
    fn expose_and_ticket_require_a_real_port() {
        let fake = FakeTunnel::new(status_with(serde_json::json!([])), None);
        let err = ensure_http_exposed(&fake, 0).expect_err("端口 0 必须报错");
        assert!(err.contains("network port"), "{err}");
        assert!(pairing_peer(&fake, 0).is_err());
        assert!(fake.calls().is_empty(), "非法端口不得触达宿主");
    }

    /// 通道准备顺序：读应用配置 → 写宿主配置 → 登记暴露规则
    #[test]
    fn prepare_channel_orders_storage_configure_expose() {
        let fake = FakeTunnel::new(
            status_with(serde_json::json!([
                "/ip4/10.0.0.5/tcp/39000/p2p/x".to_string()
            ])),
            None,
        );
        assert_eq!(prepare_channel(&fake, 8765).expect("prepare"), "rule-1");
        let calls = fake.calls();
        let position = |prefix: &str| {
            calls
                .iter()
                .position(|c| c.starts_with(prefix))
                .unwrap_or_else(|| panic!("缺调用 {prefix}: {calls:?}"))
        };
        assert!(
            position("storage") < position("configure"),
            "先读应用配置再写宿主配置"
        );
        assert!(
            position("configure") < position("expose"),
            "配置必须先于暴露（allowWan 门控 reservation）"
        );
        assert!(
            calls.contains(&format!("expose 8765 {EXPOSE_KIND_HTTP} {EXPOSE_LABEL}")),
            "暴露 kind/端口/标签必须与契约一致: {calls:?}"
        );
    }

    /// 配对顺序：票据先于状态（票据路径确保节点 / 对等面在场）
    #[test]
    fn pairing_issues_ticket_before_reading_status() {
        let fake = FakeTunnel::new(
            status_with(serde_json::json!([
                "/ip4/10.0.0.5/tcp/39000/p2p/x".to_string()
            ])),
            None,
        );
        let peer = pairing_peer(&fake, 8765).expect("peer");
        assert_eq!(peer["nodeId"], NODE_ID);
        assert_eq!(
            fake.calls(),
            vec![
                format!("ticket 8765 ttl={PAIRING_TICKET_TTL_SECS}"),
                "status".to_string(),
            ],
            "票据先于状态（票据路径确保节点在场）"
        );
        assert!(PAIRING_TICKET_TTL_SECS <= 120, "不变量 4：票据 TTL ≤ 120s");
    }

    /// 暴露失败（宿主 `tunnel-unavailable` 等）必须原样透出，不吞成成功
    #[test]
    fn expose_errors_are_propagated() {
        let fake = FakeTunnel::new(status_with(serde_json::json!([])), None);
        *fake.expose_error.borrow_mut() =
            Some("tunnel-unavailable: peer face unavailable".to_string());
        let err = ensure_http_exposed(&fake, 8765).expect_err("必须失败");
        assert!(err.contains("tunnel-unavailable"), "{err}");
    }

    /// native 面显性报错（与 device_face 同口径：不返回空视图）
    #[test]
    fn command_faces_fail_loudly_on_native() {
        for (name, result) in [
            ("tunnel.prepare", prepare_via_host(8765).map(|_| ())),
            ("tunnel.status", status_via_host().map(|_| ())),
            ("tunnel.peer", pairing_peer_via_host(8765).map(|_| ())),
            ("tunnel.unexpose", unexpose_via_host().map(|_| ())),
        ] {
            let err = result.expect_err("native 必须显性失败");
            assert!(
                err.contains("unavailable outside wasm runtime"),
                "{name} 错误信息缺上下文: {err}"
            );
        }
    }
}
