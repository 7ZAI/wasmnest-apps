# [feat] T02 · p2p-engine：relay client、reservation 生命周期、多地址拨号与传输事件

- **落仓**：`7ZAI/wasmnest-lib`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T01 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§3.3、§4.2（地址解析）、§4.8、§7.2、§8 P1 顺序 1

## 需求描述

把 PoC 的 relay 能力产品化为引擎正式面：relay client、reservation 生命周期、多地址 dial、传输状态事件。本 ticket **先不改 WIT**，用测试夹具验证；WIT 显式化在 T05。

## 落点 app 与端

机制：`wasmnest-p2p-engine`；双端共用（桌面服务端 reservation / 移动拨号方）。

## 验收条件

- [x] `relay` feature 默认关闭，宿主显式开启；Android 构建树仍零 rustls/aws-lc。
- [x] reservation 建立/释放/自动重连 + 指数退避；relay 重启后恢复。
- [x] 多地址 dial：同一 nodeId 的 LAN 直连地址 + relay multiaddr 候选列表，按调用方给定顺序尝试。
- [x] 传输状态事件：`lan-direct` / `wan-relay` / `relay-reserved` / `relay-lost`（词表与设计 §7.2 一致）。
- [x] relay 域名地址由**宿主层** `tokio::net::lookup_host` 解析成 IP 再拼 multiaddr（不启用引擎 `dns` feature，避免改 Android feature 面）。
- [x] relay PeerId 钉住校验：拒绝「同 IP 不同 PeerId」替换。
- [x] native 测试 + Android `cargo check` 绿。

## 实施记录（2026-11-07）

**公开面（`wasmnest_p2p_engine`）**

| 面 | 语义 |
| --- | --- |
| `relay` feature | 默认关闭；启用时 `libp2p-relay` client + 组合传输；关闭时 `reserve_relay` 返回 `P2pError::RelayDisabled` |
| `RunningNode::reserve_relay(Vec<Multiaddr>)` | 建预留（端点 `.../p2p/<relay>`，引擎自行拼 `/p2p-circuit`）；返回实际端点；首个失败显性 Err，后台继续退避 |
| `RunningNode::release_relay()` | 释放（幂等；返回是否命中） |
| `RunningNode::relay_status()` | `RelayStatus { state, relay_addr, detail }`（`Idle` / `Connecting` / `Reserved` / `Lost`） |
| `RunningNode::dial_addrs(&[…], node, per_addr_timeout)` | 多地址按序拨号 → `DialOutcome { addr, transport }`；全失败 `P2pError::DialAllFailed` |
| `RunningNode::dial_with_timeout(..)` | 可配窗口的 `dial` |
| `P2pEventSink::transport_changed` / `relay_status_changed` | 默认空实现（现有宿主零改动）；`TransportChanged` / `RelayStatusChanged` 词汇 |
| `relay::resolve_relay_addr(&str)` | 域名 → IP multiaddr（`lookup_host`，IPv4 优先，保留 `/p2p` 尾部） |
| `relay::RelayEndpoint::parse(addr, expected)` | 形状校验 + PeerId 钉住；拒绝 DNS / 缺 `/p2p` / 含 `/p2p-circuit` |
| `LinkRegistry` 链路快照 `PeerLink.transport` | lan-direct / wan-relay |

**退避**：`1s → 2s → 4s → … → 60s` 封顶（`relay::retry_delay`）；预留请求硬超时 10s
（`relay::RESERVATION_TIMEOUT`）。预留丢失信号：relay 控制连接断开后 relay client 发出的
`ExternalAddrExpired`（circuit 地址）+ `ListenerClosed` / `ListenerError`。

**测试**（`cargo test --features relay`）

- `经_relay_预留_拨号_并往返_1mib_具名流`：预留 → 经 relay 拨号（判 `wan-relay`）→ `/wasmnest/session/1` 1MiB 逐字往返。
- `relay_重启后自动恢复预留`：relay 停机 → `Lost` → 同身份同端口重启 → 退避重试恢复 `Reserved`。
- `relay_预留_释放幂等_状态回到_idle` / `relay_端点地址非法_显性拒绝_不进退避`。
- `多地址拨号_按入参顺序回退_并上报传输形态` / `多地址拨号_候选全失败_逐条成因显性返回`。
- `relay_feature_未启用时_预留显性失败`（默认 feature 构建）。
- 结果：`--features relay` 45 passed；默认 42 passed；peer-net `cargo test` 137 passed。

**跨 crate 配套**：`wasmnest-server-peer-net` 的 `map_p2p_error` 补齐新错误变体映射
（`Relay` / `RelayPeerMismatch` / `RelayDisabled` / `DialAllFailed`），否则 exhaustiveness 拒绝编译。

**未做（留给后续 ticket）**

- WIT 面 `relay-addrs` / `enable-relay`（随 T05 定稿；当前宿主可用 `reserve_relay` 原语驱动）。
- 宿主侧「状态机 + 模式判定」（§4.9 三用例）在 T06/T09；引擎只提供 `transport` / `relay` 事实。
- 全局 peer 节点共享与 reservation 引用计数在 T06（引擎不做计数）。

## 相关契约与锁

- `peer-node-config` 增 `relay-addrs: option<list<string>>` / `enable-relay: bool` 的取舍随 T05 定稿（也可宿主设置驱动）。
- 全局 `PeerCtx` 共享：一个进程一个身份、一个 reservation（`plugin_binding.rs:556-561`）；不做 per-app 多身份。
- reservation 的**引用计数所有权在宿主隧道管理器**（T06），引擎只提供建立/释放原语。