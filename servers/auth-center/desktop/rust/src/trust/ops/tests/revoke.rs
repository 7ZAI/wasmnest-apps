//! revoke：撤销分派 — crate 内单元测试（自 wasmnest-desktop/wasm-apps/bedcode/rust/src/trust/ops.rs 迁出）

use super::*;

use crate::trust::source::tests::MockRecords;

/// 撤销 pairing：软删后列表立即消失；返回值 kind=pairing
#[test]
fn revoke_pairing_removes_from_list_immediately() {
    let records = MockRecords::new(vec![MockRecords::record(
        "p-1",
        "Phone",
        "fp-1",
        "2026-09-19T00:00:00Z",
    )]);
    let peer = MockPeer::new(vec![]);
    assert_eq!(
        list(&records, &peer).expect("list")["devices"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let r = revoke(&records, &peer, "p-1").expect("revoke");
    assert_eq!(r["removed"], true);
    assert_eq!(r["kind"], "pairing");

    // 撤销后立即生效：列表不再包含
    let devices = list(&records, &peer).expect("list after revoke")["devices"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(devices.len(), 0, "撤销后立即从统一视图消失");
}
/// 撤销未命中的 id：pairing 幂等 false；peer 侧未命中也 false（宿主
/// revoke_trusted_peer 返回是否删除），整体不报错
#[test]
fn revoke_unknown_id_returns_removed_false() {
    let records = MockRecords::new(vec![]);
    let peer = MockPeer::new(vec![]);
    let r = revoke(&records, &peer, "ghost-id").expect("revoke unknown");
    assert_eq!(r["removed"], false);
    assert_eq!(r["kind"], "peer", "未命中 pairing 即按 peer 寻址");
}
/// T-G01：已非活跃 pairing 的 id 不得落 peer 路径——即使它撞上某个 peer
/// node id，也不能撤销那个无关的活跃 peer（旧实现 bool false 无法区分
/// 「已非活跃」与「不是 pairing」，会误撤销）
#[test]
fn revoke_inactive_pairing_id_does_not_touch_peer() {
    let mut inactive = MockRecords::record("p-stale-00", "Old", "fp-x", "2026-09-01T00:00:00Z");
    inactive.is_active = false;
    let records = MockRecords::new(vec![inactive]);
    // peer 列表里恰好有个 node id = 陈旧的 pairing id：
    // 撤销该 id 必须只报 pairing 幂等，绝不能删掉这个活跃 peer
    let peer = MockPeer::new(vec![sample_peer("p-stale-00", "书房台式机")]);
    let r = revoke(&records, &peer, "p-stale-00").expect("revoke stale pairing");
    assert_eq!(r["removed"], false);
    assert_eq!(r["kind"], "pairing", "id 在 pairing 域 → 不落 peer 路径");
    let after = peer.trusted.lock().unwrap();
    assert_eq!(after.len(), 1, "活跃 peer 必须原样保留");
}
/// 撤销 peer 目标：转发 host-peer revoke-trusted（kind=peer、removed 透传）
#[test]
fn revoke_peer_forwards_to_host_peer() {
    let records = MockRecords::new(vec![]);
    let node_id = "aabbccdd";
    let peer = MockPeer::new(vec![sample_peer(node_id, "书房台式机")]);

    let r = revoke(&records, &peer, node_id).expect("revoke peer");
    assert_eq!(r["removed"], true);
    assert_eq!(r["kind"], "peer");

    // 二次撤销同一 node_id：宿主 revoke_trusted_peer 语义 removed=false
    let r2 = revoke(&records, &peer, node_id).expect("revoke peer again");
    assert_eq!(r2["removed"], false);
}
/// 数据源不可用（host-auth 原语报错）：显性上抛，不静默空列表
/// （空列表会被消费方读成「没有任何信任设备」，是危险的默认值）
#[test]
fn list_surfaces_record_source_failure() {
    struct BrokenRecords;
    impl TrustRecords for BrokenRecords {
        fn records(&self) -> Result<Vec<crate::trust::model::PairingRecord>, String> {
            Err("host-auth trusted-devices-list failed: permission denied".to_string())
        }
        fn revoke(&self, _id: &str) -> Result<bool, String> {
            Err("host-auth trusted-device-revoke failed: permission denied".to_string())
        }
    }

    let err = list(&BrokenRecords, &MockPeer::new(vec![])).unwrap_err();
    assert!(err.contains("permission denied"), "got: {err}");
    let err = revoke(&BrokenRecords, &MockPeer::new(vec![]), "p-1").unwrap_err();
    assert!(err.contains("permission denied"), "got: {err}");
}

/// T07 级联：撤销带已验证 nodeId 的配对记录时同步撤销传输层信任
/// （隧道准入 matched = 信任表命中；只软删配对会让隧道继续放行）
#[test]
fn revoke_pairing_with_peer_node_id_cascades_trust_revoke() {
    let node_id = "a".repeat(64);
    let mut record = MockRecords::record("p-1", "Phone", "fp-1", "2026-09-19T00:00:00Z");
    record.peer_node_id = Some(node_id.clone());
    let records = MockRecords::new(vec![record]);
    let peer = MockPeer::new(vec![sample_peer(&node_id, "Pixel 9")]);

    let r = revoke(&records, &peer, "p-1").expect("revoke pairing");
    assert_eq!(r["removed"], true);
    assert_eq!(r["kind"], "pairing");
    assert_eq!(r["peerRevoked"], true, "必须级联撤销传输层信任");
    assert!(
        peer.trusted.lock().unwrap().is_empty(),
        "隧道信任表不得残留被撤销设备"
    );
}

/// LAN 直连配对（无已验证 nodeId）不碰 peer 信任表：`peerRevoked=false`，
/// 其它 peer 条目原样保留（不得按配对 id 猜 node id）
#[test]
fn revoke_pairing_without_peer_node_id_skips_trust_cascade() {
    let records = MockRecords::new(vec![MockRecords::record(
        "p-1",
        "Phone",
        "fp-1",
        "2026-09-19T00:00:00Z",
    )]);
    let peer = MockPeer::new(vec![sample_peer("unrelated-node", "别的设备")]);

    let r = revoke(&records, &peer, "p-1").expect("revoke pairing");
    assert_eq!(r["peerRevoked"], false);
    assert_eq!(
        peer.trusted.lock().unwrap().len(),
        1,
        "无 nodeId 不得误撤其它条目"
    );
}

/// 中断重试：配对已软删但级联未完成（信任仍在）时，再次撤销必须重放级联
/// ——否则 UI 幂等成功、隧道却仍匹配（安全洞）
#[test]
fn revoke_inactive_pairing_replays_trust_cascade_idempotently() {
    let node_id = "b".repeat(64);
    let mut record = MockRecords::record("p-1", "Phone", "fp-1", "2026-09-19T00:00:00Z");
    record.is_active = false;
    record.peer_node_id = Some(node_id.clone());
    let records = MockRecords::new(vec![record]);
    let peer = MockPeer::new(vec![sample_peer(&node_id, "Pixel 9")]);

    let r = revoke(&records, &peer, "p-1").expect("revoke inactive pairing");
    assert_eq!(r["removed"], false, "软删已发生：幂等语义");
    assert_eq!(r["kind"], "pairing");
    assert_eq!(r["peerRevoked"], true, "重试必须补齐隧道信任撤销");
    assert!(peer.trusted.lock().unwrap().is_empty());
}

/// 级联失败显性上抛（不把「配对已撤、隧道仍匹配」包装成成功）
#[test]
fn revoke_pairing_surfaces_trust_cascade_failure() {
    let node_id = "c".repeat(64);
    let mut record = MockRecords::record("p-1", "Phone", "fp-1", "2026-09-19T00:00:00Z");
    record.peer_node_id = Some(node_id.clone());
    let records = MockRecords::new(vec![record]);
    let peer = MockPeer::failing(vec![sample_peer(&node_id, "Pixel 9")]);

    let err = revoke(&records, &peer, "p-1").expect_err("级联失败必须显性报错");
    assert!(
        err.contains("peer trust revoke failed"),
        "错误文案要点名级联失败: {err}"
    );
}
