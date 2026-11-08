//! 双端同形的领域类型。
//!
//! 这些类型此前在两端各有一份逐字副本（含 serde 属性），改一处漏一处就是 wire 形状漂移；
//! 收敛到核内即「同一份定义」。
//!
//! serde 属性是**契约**而非实现细节：`camelCase` 与 `default` 决定了前端与引擎看到的
//! 载荷是否兼容，故 `rename_all` / `skip_serializing_if` 不可随手改。

use serde::{Deserialize, Serialize};

/// 单条共享根。
///
/// `path` 是**双端同位的载荷槽位**：桌面承载本地绝对路径，移动承载 SAF 目录树 URI
/// （`content://...`）。语义差异只体现在推送载荷的字段名（见 `ports::RootWireCodec`），
/// 结构本身双端一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRoot {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// 拨号 endpoint（camelCase wire 形状，前端自建设备缓存的真源）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialEndpoint {
    pub node_id: String,
    /// 单地址来源（mDNS 发现）：配对串带来的端点只有 `addrs`，故该字段可缺省
    #[serde(default)]
    pub addr: String,
    #[serde(default)]
    pub port: u16,
    /// 已知的多地址候选（multiaddr；LAN 直连在前、relay circuit 在后）。
    ///
    /// 来源 = 配对连接串 / 历史快照；顺序即调用方的拨号策略顺序，核内不重排
    /// （§4.9 的「何时纳入 relay」判据见 [`crate::dial`]）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub addrs: Vec<String>,
    /// 上次拨号是否纳入了 relay 候选：重连沿用同一路径（缺省 = 从未走 WAN）。
    ///
    /// 不是「当前传输形态」——真实形态以宿主 `peer:connection` 事件的
    /// `transport` 字段为准，本字段只服务重拨策略。
    #[serde(default)]
    pub wan: bool,
}

/// 单条设备快照（前端缓存条目的落盘形状；`lastSeenMs` 由前端 `Date.now` 盖章）
///
/// 前端可能只填部分字段，故除 `nodeId` 外全部 `default`——收紧任一字段都会让旧快照
/// 反序列化失败，表现为「最近可见设备整批消失」。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshotEntry {
    pub node_id: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub addr: String,
    #[serde(default)]
    pub port: u16,
    /// 能力位图小写 hex（bit0 = 文件传输；空 = 无能力位）
    #[serde(default)]
    pub capabilities_hex: String,
    #[serde(default)]
    pub instance_name: String,
    #[serde(default)]
    pub last_seen_ms: u64,
    /// 配对/历史保留的 multiaddr 候选（LAN 直连在前、relay circuit 在后）。
    ///
    /// 旧快照没有该字段 ⇒ 空表（退回单地址拨号），不因缺字段整条丢弃。
    #[serde(default)]
    pub addrs: Vec<String>,
    /// 手动添加的远程设备（无 mDNS 发现，TTL 清扫不得移除；前端展示「远程」标记）
    #[serde(default)]
    pub paired: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_root_uses_camel_case_shape() {
        let r = SharedRoot {
            id: "r1".into(),
            name: "Docs".into(),
            path: "E:/Docs".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "id": "r1", "name": "Docs", "path": "E:/Docs" })
        );
        // path 槽位对移动端承载 SAF URI，形状不变
        let saf = SharedRoot {
            path: "content://tree/1".into(),
            ..r.clone()
        };
        assert_eq!(
            serde_json::to_value(&saf).unwrap()["path"],
            "content://tree/1"
        );
    }

    #[test]
    fn dial_endpoint_roundtrips_camel_case() {
        let ep = DialEndpoint {
            node_id: "aa".into(),
            addr: "192.168.1.5".into(),
            port: 47821,
            addrs: vec!["/ip4/192.168.1.5/tcp/47821".into()],
            wan: true,
        };
        let v = serde_json::to_value(&ep).unwrap();
        assert_eq!(v["nodeId"], "aa");
        assert_eq!(v["addr"], "192.168.1.5");
        assert_eq!(v["port"], 47821);
        assert_eq!(v["addrs"][0], "/ip4/192.168.1.5/tcp/47821");
        assert_eq!(v["wan"], true);
        assert_eq!(serde_json::from_value::<DialEndpoint>(v).unwrap(), ep);
        // 旧载荷（无 addrs / wan）按缺省解析，不整条拒绝
        let legacy: DialEndpoint = serde_json::from_value(serde_json::json!({
            "nodeId": "aa", "addr": "192.168.1.5", "port": 47821
        }))
        .unwrap();
        assert!(legacy.addrs.is_empty());
        assert!(!legacy.wan);
    }

    #[test]
    fn snapshot_entry_defaults_tolerate_partial_payload() {
        let e: DeviceSnapshotEntry =
            serde_json::from_value(serde_json::json!({ "nodeId": "abc", "lastSeenMs": 1234 }))
                .unwrap();
        assert_eq!(e.node_id, "abc");
        assert_eq!(e.last_seen_ms, 1234);
        assert_eq!(e.port, 0);
        assert_eq!(e.capabilities_hex, "");
        assert_eq!(e.device_name, "");
        assert_eq!(e.instance_name, "");
        assert!(e.addrs.is_empty());
        assert!(!e.paired);
    }

    #[test]
    fn snapshot_entry_carries_pairing_candidates_and_paired_flag() {
        let e: DeviceSnapshotEntry = serde_json::from_value(serde_json::json!({
            "nodeId": "abc",
            "deviceName": "远端",
            "addrs": ["/ip4/10.0.0.2/tcp/47613", "/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/abc"],
            "paired": true,
            "lastSeenMs": 7
        }))
        .unwrap();
        assert_eq!(e.addrs.len(), 2);
        assert!(e.paired, "手动添加的远程设备必须落盘 paired 标记");
        // 回写形状保持 camelCase
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["addrs"][0], "/ip4/10.0.0.2/tcp/47613");
        assert_eq!(v["paired"], true);
    }
}
