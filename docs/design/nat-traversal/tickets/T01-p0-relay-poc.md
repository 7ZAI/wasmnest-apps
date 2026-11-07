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

- [ ] 引擎加 `relay` feature：`libp2p-relay` client + `listen_on(relay_addr/p2p-circuit)`，只做 reservation。
- [ ] 测试/夹具：A 在 relay 预留，B 经 relay multiaddr 拨 A，开 `/wasmnest/session/1` 流 echo 1MB。
- [ ] 引擎层把 relay multiaddr 传给 `RunningNode::dial`，跑通真实 `send_files` 线协议（夹具直连引擎，不改 app；`DialEndpoint` 多地址扩展属 T11）。
- [ ] **两台不同 NAT 后的真机/真网络**经 relay 建立连接（不允许只用 loopback/同机双进程代替）。
- [ ] Android 目标 `cargo check` 绿，依赖树确认无 rustls / quinn / aws-lc / openssl-sys。
- [ ] PoC 报告记录：reservation 建立耗时、relay RTT、1MB/100MB 吞吐、断线重连行为。

## 相关契约与锁

- 不改 WIT / 权限 / 流协议名；feature 默认关闭，不影响现有构建。
- Android 零 aws-lc-rs 纪律：`wasmnest-p2p-engine/Cargo.toml:25-29`。
- 产出测量数据供 T13 relay 配额默认值（`max_circuit_bytes` 与 1GB 验收对齐）参考。