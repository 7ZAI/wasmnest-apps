//! 隧道客户端编排（T09）：拨号方的应用侧三件事，机制全在宿主。
//!
//! 机制（LAN 优先 / §4.9 模式判定 / 引用计数 / 本地回环代理 / 一次性票据）
//! 全在宿主隧道管理器（`host-tunnel`，T06）。本模块只做：
//!
//! 1. **通道配置**：把应用自持的网络设置写成宿主 `configure`
//!    （`allowWan` + 已知 relay 地址）。宿主 `connect` 在 `wan_addrs` 非空时要求
//!    `allowWan=true` 且 relay 地址非空——这是配置事实，不是安全开关；
//!    加密永远强制（不变量 12/14），本域没有关闭原语。
//! 2. **拨号**：`connect(nodeId, port, kind, addrs, pairingTicket?)` → 本地回环代理。
//!    首次配对带票据（来自 QR v2 / 连接串），已匹配省略。拨号策略顺序由宿主按
//!    §4.9 执行（LAN 先试，只有判据明确「不在内网」才走 relay）；本端**不**
//!    自己拍顺序、也不在 LAN 失败时静默切 relay。
//! 3. **对端记录**：持久化 `nodeId + relayAddrs + deviceName + 最近一次模式与原因`
//!    （**不存 LAN IP**——地址会变，重启后由 mDNS / 新扫码重新给；relay 地址是
//!    唯一值得跨会话保留的拨号候选）。
//!
//! **失败语义（fail-visible）**：宿主错误码原样上抛（`lan-unreachable` /
//! `relay-unreachable` / `wan-disabled` / `peer-offline` / …），前端按码给文案；
//! 存储损坏显性报错，不静默当成「没配置过」。

use serde::{Deserialize, Serialize};

/// 对端记录存储键（应用级 KV，按插件隔离）
pub const TARGETS_STORAGE_KEY: &str = "network.peer-targets";

/// `allowWan` 设置存储键（默认开；关闭只关外网通道，不关加密）
pub const ALLOW_WAN_STORAGE_KEY: &str = "network.allow-wan";

/// 通道类型：本应用的业务面恒为桌面 HTTP/WS 面对等暴露
pub const KIND_HTTP: &str = "http";

/// 对端记录上限（桌面环境够用；超出按「最近使用」淘汰）
pub const MAX_TARGETS: usize = 16;

/// relay 候选地址的 multiaddr 标记（`/ip4/…/p2p/<relay>/p2p-circuit/p2p/<peer>`）
const WAN_ADDR_MARKER: &str = "/p2p-circuit";

/// 已配对对端记录（持久化形状；**不含 LAN 地址**）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTarget {
    pub node_id: String,
    #[serde(default)]
    pub device_name: String,
    /// relay circuit 候选（跨会话保留；拨号时排在 LAN 候选之后由宿主判定）
    #[serde(default)]
    pub relay_addrs: Vec<String>,
    /// 目标逻辑端口（桌面业务端口；手动「尝试外网」重建拨号入参用，不是 LAN IP）
    #[serde(default)]
    pub port: u16,
    /// 最近一次传输模式（宿主 §4.9 词表字面）
    #[serde(default)]
    pub last_mode: Option<String>,
    /// 最近一次模式归因（`cellular` / `different-subnet` / `user` …）
    #[serde(default)]
    pub last_reason: Option<String>,
    /// 最近一次更新时刻（前端 `Date.now()`；插件 wasm32 无时钟）
    #[serde(default)]
    pub updated_at_ms: u64,
}

/// 可拨 multiaddr 判据（与 T08 载荷校验 / 桌面 `pairingPayload` 同口径）
///
/// 只做格式判据：以 `/` 开头、无空白、带 `/p2p/` 目标段、不是未指定地址。
/// 通配监听地址由宿主 `status.node.addrs` 展开，本端不猜；本端是**拨号方**，
/// 环回地址指向自己而不是对端，故按不可拨处理。
pub fn is_dialable_addr(addr: &str) -> bool {
    if !addr.starts_with('/') || addr.contains(char::is_whitespace) {
        return false;
    }
    if !addr.contains("/p2p/") {
        return false;
    }
    !(addr.contains("/ip4/0.0.0.0") || addr.contains("/ip6/::") || addr.contains("/ip4/127.0.0.1"))
}

/// 是否经 relay 的候选（用于从拨号候选里提取宿主 `configure` 需要的 relay 地址）
pub fn is_relay_addr(addr: &str) -> bool {
    addr.contains(WAN_ADDR_MARKER)
}

/// 候选归一：只留可拨地址、去重保序（顺序即调用方拨号策略顺序）
pub fn normalize_addrs<I, S>(addrs: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out: Vec<String> = Vec::new();
    for raw in addrs {
        let addr = raw.as_ref().trim();
        if !is_dialable_addr(addr) {
            continue;
        }
        if !out.iter().any(|existing| existing == addr) {
            out.push(addr.to_string());
        }
    }
    out
}

/// 从候选里提取 relay 地址（宿主 `configure` 的 `relayAddrs`）
pub fn relay_addrs_from(addrs: &[String]) -> Vec<String> {
    normalize_addrs(addrs.iter().filter(|addr| is_relay_addr(addr)))
}

/// 合并 relay 地址（新候选 + 存量记录；去重保序）
pub fn merge_relay_addrs(incoming: &[String], remembered: &[String]) -> Vec<String> {
    let mut merged = normalize_addrs(incoming.iter().filter(|a| is_relay_addr(a)));
    for addr in remembered {
        if is_relay_addr(addr) && !merged.iter().any(|existing| existing == addr) {
            merged.push(addr.clone());
        }
    }
    merged
}

/// 通道配置决策：`allowWan` 只看用户设置与「是否有 relay 地址」
///
/// 没有 relay 地址却宣称 `allowWan=true` 会被宿主直接 `wan-disabled`，
/// 那是配置错误不是安全默认值——本函数把它收敛成 `allowWan=false` 的
/// LAN-only 形态（对外仍显性：状态视图里 `allowWan=false`）。
pub fn channel_config(allow_wan_setting: bool, relay_addrs: &[String]) -> (bool, Vec<String>) {
    let relay = relay_addrs_from(relay_addrs);
    (allow_wan_setting && !relay.is_empty(), relay)
}

/// 解析存储里的对端记录（不可信输入；损坏显性报错）
pub fn parse_targets(value: Option<&serde_json::Value>) -> Result<Vec<PeerTarget>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| "peer targets corrupted: not an array".to_string())?;
    let mut out: Vec<PeerTarget> = Vec::with_capacity(items.len());
    for item in items {
        let target: PeerTarget = serde_json::from_value(item.clone())
            .map_err(|e| format!("peer targets corrupted: {e}"))?;
        if target.node_id.trim().is_empty() {
            return Err("peer targets corrupted: empty nodeId".to_string());
        }
        out.push(target);
    }
    Ok(out)
}

/// 序列化对端记录（写 KV）
pub fn targets_value(targets: &[PeerTarget]) -> serde_json::Value {
    serde_json::to_value(targets).unwrap_or_else(|_| serde_json::Value::Array(Vec::new()))
}

/// 新增 / 更新一条记录（按 nodeId 去重；最新使用置顶；超上限淘汰尾部）
pub fn upsert_target(targets: &mut Vec<PeerTarget>, target: PeerTarget) {
    targets.retain(|existing| existing.node_id != target.node_id);
    targets.insert(0, target);
    targets.truncate(MAX_TARGETS);
}

/// 删除一条记录（返回是否命中）
pub fn remove_target(targets: &mut Vec<PeerTarget>, node_id: &str) -> bool {
    let before = targets.len();
    targets.retain(|target| target.node_id != node_id);
    targets.len() != before
}

/// 在记录里查找对端
pub fn find_target<'a>(targets: &'a [PeerTarget], node_id: &str) -> Option<&'a PeerTarget> {
    targets.iter().find(|target| target.node_id == node_id)
}

/// 从宿主 `status` 取指定对端的模式与归因（`modes` 投影）
pub fn mode_of(status: &serde_json::Value, node_id: &str) -> (Option<String>, Option<String>) {
    let row = status
        .get("modes")
        .and_then(|v| v.as_array())
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("nodeId").and_then(|v| v.as_str()) == Some(node_id))
        });
    let Some(row) = row else {
        return (None, None);
    };
    let mode = row.get("mode").and_then(|v| v.as_str()).map(str::to_string);
    // `reason` 为 `null` 是合法事实（自动判据无归因），不当成错误
    let reason = row
        .get("reason")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    (mode, reason)
}

/// 宿主 `status` → 前端只读视图（字段全部来自宿主，本端只裁剪 / 重命名）
///
/// 只读投影：不含票据 / 令牌明文（宿主 `status` 本身也不含）。
pub fn status_view(status: &serde_json::Value, node_id: Option<&str>) -> serde_json::Value {
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
                        "manualWan": row.get("manualWan").and_then(|v| v.as_bool()).unwrap_or(false),
                        "updatedAtMs": row.get("updatedAtMs").and_then(|v| v.as_u64()).unwrap_or(0),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    let (mode, reason) = node_id
        .map(|id| mode_of(status, id))
        .unwrap_or((None, None));
    serde_json::json!({
        "nodeId": node
            .and_then(|n| n.get("nodeId"))
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        "started": node
            .and_then(|n| n.get("started"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        "addrs": node
            .and_then(|n| n.get("addrs"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
        "allowWan": status
            .get("allowWan")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        "relayAddrsConfigured": status
            .get("relayAddrsConfigured")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "reservation": status
            .get("reservation")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        "relayState": relay
            .and_then(|r| r.get("state"))
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        "relayAddr": relay
            .and_then(|r| r.get("relayAddr"))
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        "relayDetail": relay
            .and_then(|r| r.get("detail"))
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        "connects": status
            .get("connects")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "modes": modes,
        "mode": mode,
        "reason": reason,
    })
}

/// 宿主 `connect` 入参校验 → (nodeId, addrs, ticket)
///
/// 端口 0 / 空地址 / 非法 kind 一律显性拒绝：发给宿主只会得到更模糊的错误。
pub fn validate_connect_args(
    args: &serde_json::Value,
) -> Result<(String, u16, String, Vec<String>, Option<String>), String> {
    let node_id = args
        .get("nodeId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "missing nodeId".to_string())?
        .to_string();
    let port = args
        .get("port")
        .and_then(|v| v.as_u64())
        .map(|v| v as u16)
        .filter(|port| *port != 0)
        .ok_or_else(|| "target port unavailable".to_string())?;
    let kind = args
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or(KIND_HTTP)
        .to_string();
    if kind != KIND_HTTP && kind != "tcp" {
        return Err(format!("unsupported tunnel kind: {kind}"));
    }
    let raw_addrs: Vec<String> = args
        .get("addrs")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let addrs = normalize_addrs(raw_addrs);
    if addrs.is_empty() {
        return Err("no dialable address (peer addrs missing/invalid)".to_string());
    }
    let ticket = args
        .get("pairingTicket")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    Ok((node_id, port, kind, addrs, ticket))
}

/// `Date.now()` 从前端带进来（插件 wasm32 无时钟；缺省 0 表示未知）
pub fn now_ms_from(args: &serde_json::Value) -> u64 {
    args.get("nowMs").and_then(|v| v.as_u64()).unwrap_or(0)
}

// ==================== 宿主端口（native 单测注入替身） ====================

/// 隧道事件 → 前端事件名（Tauri 事件名合法字符集：alphanumeric / `-` / `:` / `_`）
pub const EVENT_TUNNEL: &str = "bedcode-tunnel-event";

/// 宿主隧道面（方法名刻意与 SDK `HostTunnel` 不同名：同名会让 `host.method()`
/// 在 wasm 构建里变成 E0034 多候选歧义）
pub trait TunnelHost {
    /// 写入通道配置（幂等全量替换）
    fn apply_config(&self, allow_wan: bool, relay_addrs: &[String]) -> Result<bool, String>;
    /// 拨号 → `{ handle, address, port }`
    fn dial(
        &self,
        node_id: &str,
        port: u16,
        kind: &str,
        addrs: &[String],
        pairing_ticket: Option<String>,
    ) -> Result<serde_json::Value, String>;
    /// 关闭句柄
    fn close_handle(&self, handle: &str) -> Result<bool, String>;
    /// 只读状态
    fn read_status(&self) -> Result<serde_json::Value, String>;
    fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String>;
    fn write_storage(&self, key: &str, value: &serde_json::Value) -> Result<(), String>;
    /// 向前端发事件（fire-and-forget）
    fn emit(&self, event: &str, payload: &serde_json::Value);
}

/// 读应用设置 `allowWan`（缺省 = 开：外网可用但只在判据明确时使用）
pub fn allow_wan_setting(host: &impl TunnelHost) -> Result<bool, String> {
    let value = host.read_storage(ALLOW_WAN_STORAGE_KEY)?;
    Ok(value.and_then(|v| v.as_bool()).unwrap_or(true))
}

/// 读对端记录（损坏显性报错，不静默清空）
pub fn read_targets(host: &impl TunnelHost) -> Result<Vec<PeerTarget>, String> {
    let value = host.read_storage(TARGETS_STORAGE_KEY)?;
    parse_targets(value.as_ref())
}

fn write_targets(host: &impl TunnelHost, targets: &[PeerTarget]) -> Result<(), String> {
    host.write_storage(TARGETS_STORAGE_KEY, &targets_value(targets))
}

/// 写通道配置：`allowWan` 设置 + 记录里的 relay 地址
fn sync_config(host: &impl TunnelHost, relay_addrs: &[String]) -> Result<bool, String> {
    let setting = allow_wan_setting(host)?;
    let (allow_wan, relay) = channel_config(setting, relay_addrs);
    host.apply_config(allow_wan, &relay)
}

/// 拨号（首次配对带票据）→ 句柄信息 + 模式
///
/// 调用顺序：写配置（含本次候选里的 relay 地址）→ connect → 读状态记模式。
/// 记录在**拨号成功与否**都更新模式（失败模式 `lan-unreachable` 也是事实，
/// 前端据此给「尝试外网」入口）。
pub fn connect_via(
    host: &impl TunnelHost,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (node_id, port, kind, addrs, ticket) = validate_connect_args(args)?;
    let mut targets = read_targets(host)?;
    let remembered = find_target(&targets, &node_id)
        .map(|target| target.relay_addrs.clone())
        .unwrap_or_default();
    let relay = merge_relay_addrs(&addrs, &remembered);
    sync_config(host, &relay)?;

    let entry = host.dial(&node_id, port, kind.as_str(), &addrs, ticket);
    let status = host.read_status().ok();
    let (mode, reason) = status
        .as_ref()
        .map(|status| mode_of(status, &node_id))
        .unwrap_or((None, None));

    // 记录：只保留 relay 候选 + 模式（LAN 地址不落盘）
    let mut target = PeerTarget {
        node_id: node_id.clone(),
        port,
        device_name: args
            .get("deviceName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        relay_addrs: relay,
        last_mode: mode.clone(),
        last_reason: reason.clone(),
        updated_at_ms: now_ms_from(args),
    };
    if target.device_name.is_empty() {
        if let Some(previous) = find_target(&targets, &node_id) {
            target.device_name = previous.device_name.clone();
        }
    }
    upsert_target(&mut targets, target);
    write_targets(host, &targets)?;

    let entry = entry?;
    let mut out = entry;
    if let Some(object) = out.as_object_mut() {
        object.insert("mode".into(), serde_json::json!(mode));
        object.insert("reason".into(), serde_json::json!(reason));
    }
    Ok(out)
}

/// 关闭句柄（宿主把最后一个句柄关闭后置该对端 `offline`）
pub fn close_via(host: &impl TunnelHost, handle: &str) -> Result<bool, String> {
    if handle.trim().is_empty() {
        return Err("missing tunnel handle".to_string());
    }
    host.close_handle(handle)
}

/// 状态视图（附对端记录：重启后据此在设备页展示上次模式）
pub fn status_via(
    host: &impl TunnelHost,
    node_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let status = host.read_status()?;
    let targets = read_targets(host)?;
    let mut view = status_view(&status, node_id);
    if let Some(object) = view.as_object_mut() {
        object.insert(
            "targets".into(),
            serde_json::to_value(&targets).unwrap_or_else(|_| serde_json::json!([])),
        );
    }
    Ok(view)
}

/// 对端记录列表
pub fn targets_via(host: &impl TunnelHost) -> Result<serde_json::Value, String> {
    Ok(targets_value(&read_targets(host)?))
}

/// 忘记对端（解配 / 撤销后清理；不触碰宿主信任表——那是配对域的事）
pub fn forget_via(host: &impl TunnelHost, node_id: &str) -> Result<bool, String> {
    let mut targets = read_targets(host)?;
    let hit = remove_target(&mut targets, node_id);
    if hit {
        write_targets(host, &targets)?;
    }
    Ok(hit)
}

/// 写 `allowWan` 设置并同步宿主配置（关闭 ≠ 关闭加密；LAN 入口不受影响）
pub fn set_allow_wan_via(host: &impl TunnelHost, allow_wan: bool) -> Result<bool, String> {
    host.write_storage(ALLOW_WAN_STORAGE_KEY, &serde_json::json!(allow_wan))?;
    let targets = read_targets(host)?;
    let relay: Vec<String> = targets
        .iter()
        .flat_map(|target| target.relay_addrs.clone())
        .collect();
    let (effective, relay) = channel_config(allow_wan, &relay);
    host.apply_config(effective, &relay)?;
    Ok(effective)
}

// ==================== wasm 运行时（宿主隧道面） ====================

use wasmnest_plugin_api_mobile::host::{HostStorage, HostTunnel, TunnelConfig};
use wasmnest_plugin_api_mobile::wasm_host::WasmHost;

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

    fn dial(
        &self,
        node_id: &str,
        port: u16,
        kind: &str,
        addrs: &[String],
        pairing_ticket: Option<String>,
    ) -> Result<serde_json::Value, String> {
        HostTunnel::tunnel_connect(self, node_id, port, kind, addrs, pairing_ticket)
            .map_err(|e| e.message)
    }

    fn close_handle(&self, handle: &str) -> Result<bool, String> {
        HostTunnel::tunnel_close(self, handle).map_err(|e| e.message)
    }

    fn read_status(&self) -> Result<serde_json::Value, String> {
        HostTunnel::tunnel_status(self).map_err(|e| e.message)
    }

    fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String> {
        HostStorage::storage_get(self, key).map_err(|e| e.message)
    }

    fn write_storage(&self, key: &str, value: &serde_json::Value) -> Result<(), String> {
        HostStorage::storage_set(self, key, value).map_err(|e| e.message)
    }

    fn emit(&self, event: &str, payload: &serde_json::Value) {
        wasmnest_plugin_api_mobile::host::HostEvents::emit_event(self, event, payload);
    }
}

/// wasm 运行时：拨号（`bedcode.tunnel-connect`）
pub fn connect_from_host(args: &serde_json::Value) -> Result<serde_json::Value, String> {
    let out = connect_via(&WasmHost, args)?;
    if let Some(handle) = out.get("handle").and_then(|v| v.as_str()) {
        remember_handle(handle);
    }
    Ok(out)
}

/// wasm 运行时：关闭句柄
pub fn close_from_host(handle: &str) -> Result<bool, String> {
    let closed = close_via(&WasmHost, handle)?;
    forget_handle(handle);
    Ok(closed)
}

/// wasm 运行时：状态视图
pub fn status_from_host(node_id: Option<&str>) -> Result<serde_json::Value, String> {
    status_via(&WasmHost, node_id)
}

/// wasm 运行时：对端记录
pub fn targets_from_host() -> Result<serde_json::Value, String> {
    targets_via(&WasmHost)
}

/// wasm 运行时：忘记对端
pub fn forget_from_host(node_id: &str) -> Result<bool, String> {
    forget_via(&WasmHost, node_id)
}

/// wasm 运行时：写 `allowWan`
pub fn set_allow_wan_from_host(allow_wan: bool) -> Result<bool, String> {
    set_allow_wan_via(&WasmHost, allow_wan)
}

/// 对端模式变化时更新持久化记录（bus 事件驱动；写失败只报错给调用方留痕）
pub fn record_mode(
    host: &impl TunnelHost,
    node_id: &str,
    mode: Option<&str>,
    reason: Option<&str>,
    now_ms: u64,
) -> Result<bool, String> {
    let mut targets = read_targets(host)?;
    let Some(index) = targets.iter().position(|target| target.node_id == node_id) else {
        // 未记录的对端（如桌面主动来连）不凭空造记录
        return Ok(false);
    };
    targets[index].last_mode = mode.map(str::to_string);
    targets[index].last_reason = reason.map(str::to_string);
    if now_ms > 0 {
        targets[index].updated_at_ms = now_ms;
    }
    write_targets(host, &targets)?;
    Ok(true)
}

// ==================== 在飞句柄（deactivate / 显式断开必须能全关） ====================

/// 本进程内已开句柄（前端持有 handle；插件侧再记一份，保证 deactivate 不泄漏
/// 本地回环 listener —— 宿主降级/卸载时前端已无机会发 close 命令）
static ACTIVE_HANDLES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// 记一个已开句柄
pub fn remember_handle(handle: &str) {
    if handle.trim().is_empty() {
        return;
    }
    if let Ok(mut handles) = ACTIVE_HANDLES.lock() {
        if !handles.iter().any(|existing| existing == handle) {
            handles.push(handle.to_string());
        }
    }
}

/// 忘一个已关闭句柄（返回是否存在）
pub fn forget_handle(handle: &str) -> bool {
    let Ok(mut handles) = ACTIVE_HANDLES.lock() else {
        return false;
    };
    let before = handles.len();
    handles.retain(|existing| existing != handle);
    handles.len() != before
}

/// 关闭全部在飞句柄（返回成功关闭数）
pub fn close_all_via(host: &impl TunnelHost) -> usize {
    let handles: Vec<String> = ACTIVE_HANDLES
        .lock()
        .map(|mut handles| std::mem::take(&mut *handles))
        .unwrap_or_default();
    let mut closed = 0;
    for handle in handles {
        if host.close_handle(&handle).unwrap_or(false) {
            closed += 1;
        }
    }
    closed
}

/// 隧道/传输事件到达（bus）→ 前端转发 + `peer:mode` 落盘最近模式与原因
///
/// 事件是宿主事实（插件不重算）：`peer:mode` 的 `mode` / `reason` 原样透传，
/// 记录里只更新 “最近一次”，不能代替 `status` 对账（重启后仍读 `status`）。
pub fn on_bus_event(host: &impl TunnelHost, topic: &str, payload: &serde_json::Value) {
    if topic == "peer:mode" {
        let node_id = payload.get("nodeId").and_then(|v| v.as_str()).unwrap_or("");
        if !node_id.is_empty() {
            let mode = payload.get("mode").and_then(|v| v.as_str());
            let reason = payload.get("reason").and_then(|v| v.as_str());
            // 插件 wasm32 无时钟：宿主在事件里给了 `atMs`，没有就不写时刻
            let at_ms = payload.get("atMs").and_then(|v| v.as_u64()).unwrap_or(0);
            if let Err(e) = record_mode(host, node_id, mode, reason, at_ms) {
                host.emit(
                    EVENT_TUNNEL,
                    &serde_json::json!({ "topic": "tunnel:error", "detail": e }),
                );
            }
        }
    }
    host.emit(
        EVENT_TUNNEL,
        &serde_json::json!({ "topic": topic, "payload": payload }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// 宿主替身：记录调用顺序与入参，可注入错误
    #[derive(Default)]
    struct FakeHost {
        configs: RefCell<Vec<(bool, Vec<String>)>>,
        dials: RefCell<Vec<(String, u16, String, Vec<String>, Option<String>)>>,
        closed: RefCell<Vec<String>>,
        status: RefCell<serde_json::Value>,
        storage: RefCell<std::collections::HashMap<String, serde_json::Value>>,
        dial_error: RefCell<Option<String>>,
        emitted: RefCell<Vec<(String, serde_json::Value)>>,
    }

    impl FakeHost {
        fn with_status(status: serde_json::Value) -> Self {
            Self {
                status: RefCell::new(status),
                ..Default::default()
            }
        }
    }

    impl TunnelHost for FakeHost {
        fn apply_config(&self, allow_wan: bool, relay_addrs: &[String]) -> Result<bool, String> {
            self.configs
                .borrow_mut()
                .push((allow_wan, relay_addrs.to_vec()));
            Ok(true)
        }
        fn dial(
            &self,
            node_id: &str,
            port: u16,
            kind: &str,
            addrs: &[String],
            pairing_ticket: Option<String>,
        ) -> Result<serde_json::Value, String> {
            self.dials.borrow_mut().push((
                node_id.to_string(),
                port,
                kind.to_string(),
                addrs.to_vec(),
                pairing_ticket,
            ));
            if let Some(err) = self.dial_error.borrow().as_ref() {
                return Err(err.clone());
            }
            Ok(serde_json::json!({
                "handle": "tunnel-1",
                "address": "127.0.0.1",
                "port": 5555,
            }))
        }
        fn close_handle(&self, handle: &str) -> Result<bool, String> {
            self.closed.borrow_mut().push(handle.to_string());
            Ok(true)
        }
        fn read_status(&self) -> Result<serde_json::Value, String> {
            Ok(self.status.borrow().clone())
        }
        fn read_storage(&self, key: &str) -> Result<Option<serde_json::Value>, String> {
            Ok(self.storage.borrow().get(key).cloned())
        }
        fn write_storage(&self, key: &str, value: &serde_json::Value) -> Result<(), String> {
            self.storage
                .borrow_mut()
                .insert(key.to_string(), value.clone());
            Ok(())
        }
        fn emit(&self, event: &str, payload: &serde_json::Value) {
            self.emitted
                .borrow_mut()
                .push((event.to_string(), payload.clone()));
        }
    }

    fn lan_addr() -> String {
        "/ip4/192.168.1.9/tcp/4001/p2p/12D3KooWLAN".to_string()
    }

    fn relay_addr() -> String {
        "/ip4/203.0.113.7/tcp/4001/p2p/12D3KooWRELAY/p2p-circuit/p2p/12D3KooWPEER".to_string()
    }

    fn status_with_mode(node_id: &str, mode: &str, reason: Option<&str>) -> serde_json::Value {
        serde_json::json!({
            "node": { "started": true, "nodeId": "12D3KooWSELF", "addrs": [lan_addr()] },
            "allowWan": true,
            "relayAddrsConfigured": 1,
            "reservation": false,
            "relay": { "state": "idle", "relayAddr": null, "detail": "" },
            "connects": 1,
            "modes": [{ "nodeId": node_id, "mode": mode, "reason": reason, "manualWan": false, "updatedAtMs": 7 }],
        })
    }

    #[test]
    fn dialable_addr_rules_match_pairing_payload() {
        assert!(is_dialable_addr(&lan_addr()));
        assert!(is_dialable_addr(&relay_addr()));
        // 未指定地址 / 环回 / 空白 / 缺 p2p 段 / 非 multiaddr 一律不可拨
        assert!(!is_dialable_addr("/ip4/0.0.0.0/tcp/4001/p2p/12D3KooW"));
        assert!(!is_dialable_addr("/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW"));
        assert!(!is_dialable_addr("/ip4/192.168.1.9/tcp/4001"));
        assert!(!is_dialable_addr("192.168.1.9:4001"));
        assert!(!is_dialable_addr("/ip4/192.168.1.9/tcp/4001/p2p/12D3Koo W"));
    }

    #[test]
    fn normalize_addrs_dedupes_and_preserves_order() {
        let addrs = normalize_addrs([relay_addr(), lan_addr(), lan_addr(), "garbage".to_string()]);
        assert_eq!(addrs, vec![relay_addr(), lan_addr()]);
    }

    #[test]
    fn relay_and_lan_candidates_are_split_without_reordering() {
        let all = vec![lan_addr(), relay_addr()];
        assert_eq!(relay_addrs_from(&all), vec![relay_addr()]);
        assert!(is_relay_addr(&relay_addr()));
        assert!(!is_relay_addr(&lan_addr()));
    }

    #[test]
    fn channel_config_requires_relay_addresses() {
        // 用户开 + 有 relay → 开
        assert_eq!(
            channel_config(true, &[relay_addr()]),
            (true, vec![relay_addr()])
        );
        // 用户开但没有 relay → 收敛成 LAN-only（否则每次拨号都 wan-disabled）
        assert_eq!(channel_config(true, &[]), (false, Vec::<String>::new()));
        // 用户关 → 关（LAN 不受影响）
        assert_eq!(
            channel_config(false, &[relay_addr()]),
            (false, vec![relay_addr()])
        );
    }

    #[test]
    fn parse_targets_rejects_corruption() {
        assert!(parse_targets(None).unwrap().is_empty());
        let bad = serde_json::json!({ "not": "array" });
        assert!(parse_targets(Some(&bad)).is_err());
        let empty_id = serde_json::json!([{ "nodeId": "" }]);
        assert!(parse_targets(Some(&empty_id)).is_err());
        let ok = serde_json::json!([{ "nodeId": "12D3KooWPEER", "relayAddrs": [] }]);
        assert_eq!(parse_targets(Some(&ok)).unwrap().len(), 1);
    }

    #[test]
    fn upsert_keeps_latest_first_and_caps_length() {
        let mut targets = Vec::new();
        for index in 0..MAX_TARGETS + 2 {
            upsert_target(
                &mut targets,
                PeerTarget {
                    node_id: format!("peer-{index}"),
                    ..Default::default()
                },
            );
        }
        assert_eq!(targets.len(), MAX_TARGETS);
        assert_eq!(targets[0].node_id, format!("peer-{}", MAX_TARGETS + 1));
        // 同 nodeId 更新而不是新增
        upsert_target(
            &mut targets,
            PeerTarget {
                node_id: format!("peer-{}", MAX_TARGETS + 1),
                device_name: "renamed".into(),
                ..Default::default()
            },
        );
        assert_eq!(targets.len(), MAX_TARGETS);
        assert_eq!(targets[0].device_name, "renamed");
    }

    #[test]
    fn remove_and_find_target() {
        let mut targets = vec![PeerTarget {
            node_id: "a".into(),
            ..Default::default()
        }];
        assert!(find_target(&targets, "a").is_some());
        assert!(remove_target(&mut targets, "a"));
        assert!(!remove_target(&mut targets, "a"));
    }

    #[test]
    fn validate_connect_args_rejects_incomplete_input() {
        assert!(validate_connect_args(&serde_json::json!({})).is_err());
        // 缺 port
        assert!(validate_connect_args(&serde_json::json!({
            "nodeId": "n", "addrs": [lan_addr()]
        }))
        .is_err());
        // 地址全部不可拨 = 没有可拨地址（不静默拉长到宿主再报错）
        assert!(validate_connect_args(&serde_json::json!({
            "nodeId": "n", "port": 8765, "addrs": ["garbage"]
        }))
        .is_err());
        // 未知 kind 不猜语义
        assert!(validate_connect_args(&serde_json::json!({
            "nodeId": "n", "port": 8765, "kind": "udp", "addrs": [lan_addr()]
        }))
        .is_err());

        let (node, port, kind, addrs, ticket) = validate_connect_args(&serde_json::json!({
            "nodeId": " 12D3KooWPEER ",
            "port": 8765,
            "addrs": [lan_addr(), relay_addr(), lan_addr()],
            "pairingTicket": " ticket-1 "
        }))
        .unwrap();
        assert_eq!(node, "12D3KooWPEER");
        assert_eq!(port, 8765);
        assert_eq!(kind, KIND_HTTP);
        assert_eq!(addrs, vec![lan_addr(), relay_addr()]);
        assert_eq!(ticket.as_deref(), Some("ticket-1"));
    }

    #[test]
    fn mode_of_reads_status_projection() {
        let status = status_with_mode("peer-1", "lan-unreachable", Some("host-unreachable"));
        assert_eq!(
            mode_of(&status, "peer-1"),
            (
                Some("lan-unreachable".to_string()),
                Some("host-unreachable".to_string())
            )
        );
        assert_eq!(mode_of(&status, "peer-2"), (None, None));
    }

    #[test]
    fn connect_writes_config_and_persists_relay_only() {
        let host = FakeHost::with_status(status_with_mode("12D3KooWPEER", "lan-active", None));
        let out = connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "12D3KooWPEER",
                "port": 8765,
                "addrs": [lan_addr(), relay_addr()],
                "deviceName": "Home Desktop",
                "pairingTicket": "t-1",
                "nowMs": 123,
            }),
        )
        .unwrap();

        assert_eq!(out["handle"], "tunnel-1");
        assert_eq!(out["address"], "127.0.0.1");
        assert_eq!(out["mode"], "lan-active");

        // 配置先于拨号，且 relayAddrs 只含 relay 候选
        let configs = host.configs.borrow();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].0, true);
        assert_eq!(configs[0].1, vec![relay_addr()]);

        // 拨号入参顺序即调用方给出的顺序（宿主自己决定 LAN 优先）
        let dials = host.dials.borrow();
        assert_eq!(dials[0].0, "12D3KooWPEER");
        assert_eq!(dials[0].3, vec![lan_addr(), relay_addr()]);
        assert_eq!(dials[0].4.as_deref(), Some("t-1"));

        // 记录只落 relay 地址（不存 LAN IP）+ 模式
        let targets = read_targets(&host).unwrap();
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].node_id, "12D3KooWPEER");
        assert_eq!(targets[0].relay_addrs, vec![relay_addr()]);
        assert_eq!(targets[0].port, 8765);
        assert_eq!(targets[0].last_mode.as_deref(), Some("lan-active"));
        assert_eq!(targets[0].device_name, "Home Desktop");
        assert_eq!(targets[0].updated_at_ms, 123);
    }

    #[test]
    fn connect_reuses_remembered_relay_when_next_time_only_lan_is_given() {
        let host = FakeHost::with_status(status_with_mode("peer-1", "lan-active", None));
        // 首次配对：LAN + relay
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765,
                "addrs": [lan_addr(), relay_addr()],
            }),
        )
        .unwrap();
        // 重启后只有 mDNS 的 LAN 地址：relay 候选从记录里补回
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765,
                "addrs": [lan_addr()],
            }),
        )
        .unwrap();
        let configs = host.configs.borrow();
        assert_eq!(configs.last().unwrap().1, vec![relay_addr()]);
        assert_eq!(
            read_targets(&host).unwrap()[0].relay_addrs,
            vec![relay_addr()]
        );
    }

    #[test]
    fn connect_failure_still_records_mode_for_manual_entry() {
        let host = FakeHost::with_status(status_with_mode(
            "peer-1",
            "lan-unreachable",
            Some("host-unreachable"),
        ));
        *host.dial_error.borrow_mut() = Some("lan-unreachable: timeout".to_string());
        let err = connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765,
                "addrs": [lan_addr(), relay_addr()],
            }),
        )
        .unwrap_err();
        assert!(err.contains("lan-unreachable"));
        // 失败也是事实：记录住「内网不可达」，前端据此给「尝试外网」
        let targets = read_targets(&host).unwrap();
        assert_eq!(targets[0].last_mode.as_deref(), Some("lan-unreachable"));
        assert_eq!(targets[0].last_reason.as_deref(), Some("host-unreachable"));
    }

    #[test]
    fn close_requires_handle() {
        let host = FakeHost::default();
        assert!(close_via(&host, "  ").is_err());
        assert!(close_via(&host, "tunnel-1").unwrap());
        assert_eq!(host.closed.borrow().as_slice(), ["tunnel-1"]);
    }

    #[test]
    fn allow_wan_off_keeps_lan_only_config() {
        let host = FakeHost::with_status(status_with_mode("peer-1", "lan-active", None));
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765,
                "addrs": [lan_addr(), relay_addr()],
            }),
        )
        .unwrap();
        assert!(!set_allow_wan_via(&host, false).unwrap());
        {
            let configs = host.configs.borrow();
            assert_eq!(configs.last().unwrap().0, false);
            // relay 地址仍保留（关闭外网不等于忘掉中继）；
            // 重新打开即可恢复外网能力
            assert_eq!(configs.last().unwrap().1, vec![relay_addr()]);
        }
        assert!(set_allow_wan_via(&host, true).unwrap());
    }

    #[test]
    fn allow_wan_setting_defaults_to_true() {
        let host = FakeHost::default();
        assert!(allow_wan_setting(&host).unwrap());
        host.write_storage(ALLOW_WAN_STORAGE_KEY, &serde_json::json!(false))
            .unwrap();
        assert!(!allow_wan_setting(&host).unwrap());
    }

    #[test]
    fn status_view_projects_mode_and_targets() {
        let host =
            FakeHost::with_status(status_with_mode("peer-1", "wan-active", Some("cellular")));
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765, "addrs": [lan_addr(), relay_addr()],
            }),
        )
        .unwrap();
        let view = status_via(&host, Some("peer-1")).unwrap();
        assert_eq!(view["mode"], "wan-active");
        assert_eq!(view["reason"], "cellular");
        assert_eq!(view["nodeId"], "12D3KooWSELF");
        assert_eq!(view["modes"][0]["nodeId"], "peer-1");
        assert_eq!(view["targets"][0]["nodeId"], "peer-1");
    }

    #[test]
    fn record_mode_updates_only_known_targets() {
        let host = FakeHost::default();
        assert!(!record_mode(&host, "unknown", Some("offline"), None, 5).unwrap());
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765,
                "addrs": [lan_addr()],
            }),
        )
        .unwrap();
        assert!(record_mode(&host, "peer-1", Some("wan-active"), Some("user"), 9).unwrap());
        let targets = read_targets(&host).unwrap();
        assert_eq!(targets[0].last_mode.as_deref(), Some("wan-active"));
        assert_eq!(targets[0].last_reason.as_deref(), Some("user"));
        assert_eq!(targets[0].updated_at_ms, 9);
    }

    #[test]
    fn forget_removes_record_only_when_present() {
        let host = FakeHost::default();
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765, "addrs": [lan_addr()],
            }),
        )
        .unwrap();
        assert!(forget_via(&host, "peer-1").unwrap());
        assert!(!forget_via(&host, "peer-1").unwrap());
        assert!(read_targets(&host).unwrap().is_empty());
    }

    #[test]
    fn corrupted_storage_is_visible_not_silently_empty() {
        let host = FakeHost::default();
        host.write_storage(TARGETS_STORAGE_KEY, &serde_json::json!({ "bad": true }))
            .unwrap();
        assert!(targets_via(&host).is_err());
    }

    /// 句柄登记与 deactivate 全关（单一测试嚰全局静态，避免并行相互干扰）
    #[test]
    fn handles_track_dedupe_and_close_all() {
        let host = FakeHost::default();
        remember_handle("tunnel-a");
        remember_handle("tunnel-a");
        remember_handle("tunnel-b");
        remember_handle("  ");
        assert!(forget_handle("tunnel-a"));
        assert!(!forget_handle("tunnel-a"));
        remember_handle("tunnel-c");
        assert_eq!(close_all_via(&host), 2);
        let closed = host.closed.borrow();
        assert!(closed.contains(&"tunnel-b".to_string()));
        assert!(closed.contains(&"tunnel-c".to_string()));
        // 已清空：再关一次没有命中
        assert_eq!(close_all_via(&host), 0);
    }

    #[test]
    fn bus_mode_event_is_forwarded_and_persisted() {
        let host = FakeHost::default();
        connect_via(
            &host,
            &serde_json::json!({
                "nodeId": "peer-1", "port": 8765, "addrs": [lan_addr()],
            }),
        )
        .unwrap();
        host.emitted.borrow_mut().clear();

        on_bus_event(
            &host,
            "peer:mode",
            &serde_json::json!({
                "nodeId": "peer-1", "mode": "wan-active", "reason": "cellular", "atMs": 42,
            }),
        );

        // 前端拿到原样事件（不重命名字段）
        let emitted = host.emitted.borrow();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].0, EVENT_TUNNEL);
        assert_eq!(emitted[0].1["topic"], "peer:mode");
        assert_eq!(emitted[0].1["payload"]["mode"], "wan-active");

        // 记录被更新（下次启动仍显示上次模式）
        let targets = read_targets(&host).unwrap();
        assert_eq!(targets[0].last_mode.as_deref(), Some("wan-active"));
        assert_eq!(targets[0].last_reason.as_deref(), Some("cellular"));
        assert_eq!(targets[0].updated_at_ms, 42);
    }

    #[test]
    fn bus_event_for_unknown_peer_still_reaches_frontend() {
        let host = FakeHost::default();
        on_bus_event(
            &host,
            "tunnel:state",
            &serde_json::json!({ "state": "closed" }),
        );
        assert_eq!(host.emitted.borrow().len(), 1);
        assert!(read_targets(&host).unwrap().is_empty());
    }
}
