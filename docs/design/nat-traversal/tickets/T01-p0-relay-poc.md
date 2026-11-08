# [feat] T01 · P0：relay 可行性 PoC（跨 NAT 连通 + Android 依赖树验证）

- **落仓**：`7ZAI/wasmnest-lib`（机制真源仓）
- **标签**：`kind:feature`
- **阶段**：P0 ｜ **依赖**：无 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§8 P0、附录 A；spec [`../spec.md`](../spec.md)

## 需求描述

验证「libp2p Circuit Relay v2 + 现有 Noise/Yamux 名流」作为跨 NAT 基线的可行性，为 P1 契约落地提供实测依据。不改 WIT、不改 app，全部在引擎层与测试夹具内完成。

## 落点 app 与端

机制：`wasmnest-p2p-engine`（relay feature，默认关闭）+ 独立 relay v2 节点（stock relay 或最小 Rust 二进制，固定 PeerId）；Android 目标构建验证。

## 验收条件

- [x] 引擎加 `relay` feature：`libp2p-relay` client + `listen_on(relay_addr/p2p-circuit)`，只做 reservation。
- [x] 测试/夹具：A 在 relay 预留，B 经 relay multiaddr 拨 A，开 `/wasmnest/session/1` 流 echo 1MB。
- [ ] 引擎层把 relay multiaddr 传给 `RunningNode::dial`，跑通真实 `send_files` 线协议（夹具直连引擎，不改 app；`DialEndpoint` 多地址扩展属 T11）。**现状**：relay multiaddr 已能进 `RunningNode::dial` / `dial_addrs`（`/wasmnest/session/1` 1MiB 往返已通），但 `send_files` 线协议夹具未做——留 T11/P2 前置。
- [ ] **两台不同 NAT 后的真机/真网络**经 relay 建立连接（不允许只用 loopback/同机双进程代替）。**待人工验收**：需两台不同 NAT 后的机器；本机只有 loopback 数据。
- [x] Android 目标 `cargo check` 绿，依赖树确认无 rustls / quinn / aws-lc / openssl-sys。
- [ ] PoC 报告记录：reservation 建立耗时、relay RTT、1MB/100MB 吞吐、断线重连行为。**loopback 数据已测（见下）；真机跨网数据待补。**

## 实施记录（2026-11-07）

落点：`wasmnest-lib` 分支 `feat/nat-traversal`（工作树 `.worktrees/wasmnest-lib/nat-traversal`）。

**实现**

- `wasmnest-p2p-engine/Cargo.toml`：新增 `relay = ["libp2p/relay", "dep:rand"]`（默认关闭）。
- `wasmnest-p2p-engine/src/relay.rs`：relay 地址面（端点解析 / PeerId 钉住 / 域名解析 / 传输形态 / 预留状态）。
- `wasmnest-p2p-engine/src/engine.rs`：`NodeBehaviour` 增加 `relay_client`（feature 门控）；`with_relay_client` 组合传输；`RelayRuntime` 管理预留、失败退避与状态发布。
- 测试夹具（`#[cfg(feature = "relay")]` 内联 relay v2 服务端）：`RelayServer::start(key, port)`；`relay_poc_metrics` 为手动测量的 `#[ignore]` 用例。

**验证命令与结果（本机 loopback，2026-11-07）**

```bash
# 功能与安全用例（含 1MiB 经 relay 往返、重启恢复、钉住校验）
cargo test --features relay --offline -- --test-threads=1
# → 45 passed; 0 failed

# 默认 feature（relay 关闭）回归
cargo test --offline -- --test-threads=1
# → 42 passed; 0 failed

# PoC 指标（release，loopback）
cargo test --release --features relay --offline relay_poc_metrics -- --ignored --nocapture
# [poc] reservation_ms=1
# [poc] dial_via_relay_ms=2
# [poc] rtt_1kib_avg_ms=0.11
# [poc] echo_1mib_secs=0.018 throughput_mib_s=55.7
# [poc] echo_100mib_secs=1.502 throughput_mib_s=66.6

# Android 目标
cargo check --target aarch64-linux-android --features relay --offline   # 绿
cargo tree --features relay --target aarch64-linux-android | grep -Eic "rustls|aws-lc|openssl-sys|quinn"   # 0
```

**数据边界**：上述耗时/吞吐全部是 **loopback + 同机**（relay 进程与两端同机），只证明实现无死锁、
顺序正确与数量级合理；不能替代「两台不同 NAT 机器」的真机验收。真机跨网按 T10 执行。

**已知取舍**

- relay 服务端 `Status` 默认 `Disable`（不通告 HOP）；测试夹具显式 `set_status(Some(Enable))` +
  `add_external_address`（否则客户端收到 `Reservation(Unsupported)` / `NoAddressesInReservation`）。
  T13 的 `init` / `run` 必须做这两件事。
- relay 的控制连接不登记为业务对端（不触发 `peer_connected`），避免宿主设备列表出现 relay。
- 单节点同时只保留一个预留（多地址是 failover 顺序，不是并行多预留）。

## 相关契约与锁

- 不改 WIT / 权限 / 流协议名；feature 默认关闭，不影响现有构建。
- Android 零 aws-lc-rs 纪律：`wasmnest-p2p-engine/Cargo.toml:25-29`。
- 产出测量数据供 T13 relay 配额默认值（`max_circuit_bytes` 与 1GB 验收对齐）参考。