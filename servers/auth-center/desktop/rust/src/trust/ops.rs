//! trust 编排 —— 统一视图 list / 撤销 revoke（issue #6 六域之「信任」）
//!
//! 行为等价对照（搬迁前实现基准，逐条见模块文档）：
//! - `list`：pairing 段只含活跃记录、按 `paired_at` DESC（= 私有库
//!   `WHERE is_active = 1 ORDER BY paired_at DESC`）；peer 段透传宿主
//!   `list_trusted_peers` 条目序；两段合并为统一数组（pairing 在前，各带 `kind`）
//! - `revoke`：pairing 走私有库软删（`is_active = 0` + 删连接历史）；peer 走
//!   host-peer `revoke-trusted`（宿主 `revoke_trusted_peer` 语义）
//!
//! 没有 `add_pairing` 写入入口：配对完成流写认证记录库（配对状态机的职责），
//! 本模块只读——两套账本合并为一。写入入口同样不在本票（配对码 / QR 状态机
//! 留在下一票）。

use super::model::TrustedDeviceDto;
use super::source::TrustRecords;
use wasmnest_plugin_api::host::HostPeer;
#[cfg(target_arch = "wasm32")]
use wasmnest_plugin_api::wasm_host::WasmHost;

/// 统一视图响应：pairing 段 + peer 段合并。
///
/// pairing 段按 `paired_at` DESC（宿主 `get_pairings` 语义），peer 段保留宿主
/// `list-trusted` 的条目序（两侧各自的时序语义在各自段内成立）。
///
/// peer 侧不可用（无头上下文 / peer-net 未启动）时：pairing 段照常返回，
/// `peerError` 透出宿主错误（不静默降级为空列表——避免「看似成功实则缺失」）。
pub fn list(h: &impl TrustRecords, peer: &impl HostPeer) -> Result<serde_json::Value, String> {
    // pairing 段：活跃过滤 + paired_at DESC（宿主 get_pairings 语义）。
    // 与 active_pairings_json 同口径（T-F04）：混合 offset 的 RFC3339 字典序
    // ≠ 时间序，先归一 unix 秒再比；解析失败按 0 靠后（宽容）
    let mut records = h.records()?;
    records.retain(|r| r.is_active);
    records.sort_by(|a, b| {
        let left = crate::pairing::code::parse_rfc3339_utc(&a.paired_at).unwrap_or(0);
        let right = crate::pairing::code::parse_rfc3339_utc(&b.paired_at).unwrap_or(0);
        right.cmp(&left)
    });

    // peer 段：透传宿主 list-trusted（TrustedPeerDto JSON 数组，条目序保留）。
    // T-G02：非数组 Ok 当 Err 处理（宿主契约破坏伪装成空列表会破坏信任身份）；
    // 单条 DTO 缺 nodeId/addedAt 也按 Err（不静默变空条目）
    let mut peers: Vec<serde_json::Value> = Vec::new();
    let peer_error = match peer.peer_list_trusted() {
        Ok(v) => match v.as_array() {
            Some(arr) => {
                peers = arr.clone();
                None
            }
            None => Some(format!("trusted peers list did not return an array: {v}")),
        },
        Err(e) => Some(e.message),
    };

    let mut devices: Vec<serde_json::Value> = Vec::with_capacity(records.len() + peers.len());
    for record in records {
        devices.push(
            serde_json::to_value(TrustedDeviceDto::from_pairing(&record))
                .map_err(|e| format!("serialize trust dto: {}", e))?,
        );
    }
    for peer in peers {
        // 单条畸形 → 整体报错（不静默跳过——信任列表缺条目会破坏撤销寻址）
        let dto = TrustedDeviceDto::from_peer(&peer)
            .map_err(|e| format!("trusted peer dto invalid: {e}"))?;
        devices.push(serde_json::to_value(dto).map_err(|e| format!("serialize trust dto: {}", e))?);
    }

    Ok(serde_json::json!({
        "devices": devices,
        "peerError": peer_error,
    }))
}

/// 撤销统一条目：pairing 目标软删（私有库 `auth_pairings` 置 `is_active = 0`
/// 并连带删连接历史，语义对齐宿主旧 `remove_pairing`）；peer 目标经 host-peer
/// `revoke-trusted`（返回是否删除）。返回 `{ removed, kind }`。
///
/// 未命中：pairing 幂等 `removed=false` 不报错（宿主 UPDATE 影响 0 行）；
/// peer 目标无权限/引擎不可用时上抛错误（不做「看似成功」的假撤销）。
///
/// **T-G01（三态裁决）**：`h.revoke` 的 bool 无法区分「未命中 / 已非活跃 /
/// 根本不是 pairing」——陈旧 pairing id 撞上 peer node id 会把无关的活跃 peer
/// 撤销。故先按 records() 判定目标身份：
/// - records 里找得到该 id 且活跃 → pairing 软删
/// - records 里找得到该 id 但已非活跃 → pairing 幂等成功（removed=false，不落 peer）
/// - records 里找不到 → 才尝试 peer 路径（此时 id 明确不是 pairing）
pub fn revoke(
    h: &impl TrustRecords,
    peer: &impl HostPeer,
    id: &str,
) -> Result<serde_json::Value, String> {
    // 三态预判：目标 id 是否在 pairing 记录里（含软删行——撤销检测依赖可见性）
    let target = h.records()?.into_iter().find(|r| r.id == id);
    match target {
        Some(record) if record.is_active => {
            // 活跃 pairing：软删（records 里的 is_active 是该记录的活跃位）
            let removed = h.revoke(id)?;
            let peer_revoked = revoke_peer_trust(peer, record.peer_node_id.as_deref())?;
            Ok(serde_json::json!({
                "removed": removed,
                "kind": "pairing",
                "peerRevoked": peer_revoked,
            }))
        }
        Some(record) => {
            // 已非活跃 pairing：幂等成功（不落「按 id 找 peer」路径——id 属于
            // pairing 域，即使它撞上一个 peer node id 也不能撤销那个无关 peer）。
            // 但仍按**记录自己的** peer_node_id 重放级联：上次撤销若在级联前
            // 中断（信任撤销失败 / 进程退出），重试必须能把隧道信任补齐——
            // 否则「撤销设备」在 UI 上是幂等成功、隧道却仍匹配（安全洞）。
            let peer_revoked = revoke_peer_trust(peer, record.peer_node_id.as_deref())?;
            Ok(serde_json::json!({
                "removed": false,
                "kind": "pairing",
                "peerRevoked": peer_revoked,
            }))
        }
        None => {
            // 明确不是 pairing → peer 目标（host-peer revoke-trusted，node_id 寻址）
            let removed = peer.peer_revoke_trusted(id).map_err(|e| e.message)?;
            Ok(serde_json::json!({ "removed": removed, "kind": "peer" }))
        }
    }
}

/// T07 级联：撤销配对记录时同步撤销该设备的传输层信任（隧道准入 `matched`
/// 判据 = 信任表命中，不撤就会「解了配对但隧道仍放行」）。
///
/// 只按记录自带的 `peer_node_id` 撤销（LAN 直连配对没有已验证 nodeId → 跳过）；
/// 失败显性上抛：软删已落库，重试会走 `Some(inactive)` 分支重放本函数（幂等）。
fn revoke_peer_trust(peer: &impl HostPeer, peer_node_id: Option<&str>) -> Result<bool, String> {
    let Some(node_id) = peer_node_id.filter(|s| !s.is_empty()) else {
        return Ok(false);
    };
    peer.peer_revoke_trusted(node_id).map_err(|e| {
        format!(
            "pairing revoked but peer trust revoke failed: {}",
            e.message
        )
    })
}

// ==================== 命令面入口（cfg 分流，native 显性失败） ====================
//
// 命令面只调这些入口；native（cargo test）下 WasmHost 无可用 TrustRecords /
// HostPeer（wasm 专属 import 符号不在 native 链接），因此这里只是 wasm 运行时
// 路径的薄包装（与 pairing/keys.rs 同模式）。
//
// 命令面（`auth-center.trust.*`）与互调 api（`trust-list` / `trust-revoke`）都经
// 这两个入口，两条触发面共用同一实现体。

/// 统一视图列表（wasm 运行时）
#[cfg(target_arch = "wasm32")]
pub fn list_via_host() -> Result<serde_json::Value, String> {
    list(&WasmHost, &WasmHost)
}

/// 统一视图列表（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn list_via_host() -> Result<serde_json::Value, String> {
    Err("trust list unavailable outside wasm runtime".to_string())
}

/// 撤销统一条目（wasm 运行时）
#[cfg(target_arch = "wasm32")]
pub fn revoke_via_host(id: &str) -> Result<serde_json::Value, String> {
    revoke(&WasmHost, &WasmHost, id)
}

/// 撤销统一条目（native 无宿主环境）
#[cfg(not(target_arch = "wasm32"))]
pub fn revoke_via_host(_id: &str) -> Result<serde_json::Value, String> {
    Err("trust revoke unavailable outside wasm runtime".to_string())
}

// ==================== Tests ====================

// 用例按功能拆至 `ops/tests/`（本内联模块的子模块路径由 rustc
// 自动解析到该目录；模块树 `trust::ops::tests::<文件>` 与内联形态等价，私有项可见性不受影响）。
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use wasmnest_plugin_api::host::HostError;
    // 跨分组共享的测试脚手架（子模块经 `use super::*` 可见）

    /// mock host-peer（native 单测；peer_list_trusted 返回 TrustedPeerDto
    /// JSON 数组，与宿主 list_trusted_peers wire 形状一致）
    struct MockPeer {
        trusted: Mutex<Vec<serde_json::Value>>,
        /// 模拟 `revoke-trusted` 失败（信任撤销错误必须显性上抛，不假成功）
        fail_revoke: bool,
    }
    impl MockPeer {
        fn new(trusted: Vec<serde_json::Value>) -> Self {
            Self {
                trusted: Mutex::new(trusted),
                fail_revoke: false,
            }
        }
        fn failing(trusted: Vec<serde_json::Value>) -> Self {
            Self {
                trusted: Mutex::new(trusted),
                fail_revoke: true,
            }
        }
    }
    /// mock host-peer 的未实现方法统一 panic（本测试只消费 list / revoke 两函数）
    macro_rules! unimplemented_peer {
        () => {
            unimplemented!()
        };
    }
    impl HostPeer for MockPeer {
        fn peer_dial(&self, _endpoint: &serde_json::Value) -> Result<String, HostError> {
            unimplemented_peer!()
        }
        /// T11 `dial-peer-addrs`：本测试只消费 list / revoke 两函数，不拨号
        fn peer_dial_addrs(&self, _endpoint: &serde_json::Value) -> Result<String, HostError> {
            unimplemented_peer!()
        }
        fn peer_close(&self, _handle: &str) -> Result<bool, HostError> {
            unimplemented_peer!()
        }
        fn peer_respond_consent(
            &self,
            _request_id: &str,
            _accepted: bool,
        ) -> Result<bool, HostError> {
            unimplemented_peer!()
        }
        fn peer_list_trusted(&self) -> Result<serde_json::Value, HostError> {
            Ok(serde_json::Value::Array(
                self.trusted.lock().unwrap().clone(),
            ))
        }
        fn peer_revoke_trusted(&self, node_id: &str) -> Result<bool, HostError> {
            if self.fail_revoke {
                return Err(HostError::custom(-1, "trust store unavailable"));
            }
            let mut trusted = self.trusted.lock().unwrap();
            let before = trusted.len();
            trusted.retain(|t| t["nodeId"] != node_id);
            Ok(trusted.len() < before)
        }
        /// 信任写入：本组用例只走 list / revoke 两函数
        fn peer_trust_node(
            &self,
            _node_id: &str,
            _display_name: Option<&str>,
        ) -> Result<bool, HostError> {
            unimplemented_peer!()
        }
        fn peer_send_files(
            &self,
            _session: &str,
            _paths: &[serde_json::Value],
        ) -> Result<String, HostError> {
            unimplemented_peer!()
        }
        fn peer_respond_transfer(&self, _batch_id: &str, _accept: bool) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_set_receive_policy(
            &self,
            _mode: &str,
            _timeout_secs: u64,
        ) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_pause_transfer(&self, _batch_id: &str) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_resume_transfer(&self, _batch_id: &str) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_set_shared_roots(&self, _dirs: &[serde_json::Value]) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_list_shared_roots(&self, _session: &str) -> Result<serde_json::Value, HostError> {
            unimplemented_peer!()
        }
        fn peer_browse_directory(
            &self,
            _session: &str,
            _dir_id: &str,
            _rel_path: &str,
        ) -> Result<serde_json::Value, HostError> {
            unimplemented_peer!()
        }
        fn peer_pull_files(
            &self,
            _session: &str,
            _dir_id: &str,
            _files: &[serde_json::Value],
        ) -> Result<u32, HostError> {
            unimplemented_peer!()
        }
        fn peer_set_download_dir(&self, _path: &str) -> Result<(), HostError> {
            unimplemented_peer!()
        }
        fn peer_start_node(
            &self,
            _config: &wasmnest_plugin_api::host::PeerNodeConfig,
        ) -> Result<bool, HostError> {
            unimplemented_peer!()
        }
        fn peer_stop_node(&self) -> Result<bool, HostError> {
            unimplemented_peer!()
        }
        fn peer_active_transfers(&self) -> Result<serde_json::Value, HostError> {
            unimplemented_peer!()
        }
        fn peer_collect_outgoing(
            &self,
            _paths: &[serde_json::Value],
        ) -> Result<serde_json::Value, HostError> {
            unimplemented_peer!()
        }
    }
    fn sample_peer(node_id: &str, name: &str) -> serde_json::Value {
        serde_json::json!({
            "nodeId": node_id,
            "displayName": name,
            "fingerprintShort": &node_id[..8],
            "addedAt": "2026-09-18T12:00:00Z",
        })
    }
    mod list;
    mod revoke;
}
