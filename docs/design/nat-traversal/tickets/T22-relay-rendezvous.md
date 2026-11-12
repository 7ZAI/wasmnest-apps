# [feat] T22 · file-transfer 中继会合发现（跨 NAT 自动发现）

- **落仓**：`7ZAI/wasmnest-apps`（应用面）+ `7ZAI/wasmnest-lib`（中继 / 宿主机制）
- **状态**：**已实施（2026-11-12）**；真实两端跨 NAT 验收待补（需先重建 relay 与宿主运行时）
- **前置**：T21（file-transfer 自持「我的设备」/ relay 预留）、T18（net-config relay 真源）

## 0. 一句话

把跨网连接从「**先扫码 / 复制连接串，再手动点「尝试外网」**」改成
「**两端配置同一台中继（建议再填同一个空间码）→ 设备经中继自动出现 → 直接连接**」。
二维码 / 连接串降级为「无法共用中继」时的兜底，不再主路径。

## 1. 现状问题（已按代码核实）

| 现象 | 根因 |
| --- | --- |
| 系统相机扫「我的设备」二维码没有任何反应 | 二维码载荷是 `wasmnest://pair/…`，**操作系统没有注册该 scheme**；只有 file-transfer 自己的「扫码」能解析。桌面端根本没有相机入口。 |
| 复制连接串后「怎么给对方」 | 剪贴板只负责暂存；原实现没有分享面板 / 粘贴按钮，用户必须自己找聊天工具粘贴。复制按钮本身不是投递通道。 |
| 跨网时必须先有连接串 | mDNS 只在同一二层网络发现；relay 只转发字节，**没有告诉两端对方是谁**。对端 nodeId + circuit 地址只能靠带外交换。 |
| 「我的设备」链接经常不可用 | `node_info.addrs` 只有 relay 预留真正 `Reserved` 时才含 circuit；对端没配中继 / 预留失败时，链接只剩不可达的 LAN 地址。 |
| 「尝试外网」依赖用户理解 | 需要用户知道「被连方」要配中继、连接方要显式点按钮；对端不在 mDNS 缓存里时连入口都没有。 |

## 2. 方案（relay rendezvous）

### 2.1 机制

```text
设备 A                         中继 (wasmnest-relay)                    设备 B
  │ relay 预留 (Circuit Relay v2) │                                      │
  ├────────────── announce ──────▶ 会合表 (room → peers, TTL 90s) ◀──────┤
  │  ◀────────── 同房间 peers ────┤                                      │
  │                                 │                                     │
  ├──── dial <relay>/p2p-circuit/p2p/<B> ────────────────────────────────▶│
  │                                 │                                     │
  └──── Noise + trust-status + 首连确认（与 LAN 直连同一条引擎路径）──────┘
```

- 中继控制协议 `/wasmnest/relay-control/1` 增加两条低频消息：
  - `announce { v, room, node_id, name }` → 登记 / 续期，并回带同房间其它设备；
  - `query { v, room }` → 只读查询（当前宿主用 announce 的返回值，query 留给排障）。
- 中继按 `room` 隔离，TTL 90s；每房间上限 64 台，满了淘汰最久未续期的一条。
- 回执含 `peer_id`（libp2p base58，铺 circuit 地址用）、`node_id`（64 位 hex，
  宿主拨号握手会复核）、`name`、`last_seen_ms`。
- 宿主在 relay 预留 `relay-reserved` 后每 25s announce；拿到同房间设备后拼
  `<relay>/p2p-circuit/p2p/<peer_id>`，经总线 `peer:relay-devices` 推给插件。
- 插件转 `plugin:file-transfer:relay-devices`；前端与 mDNS 缓存按 nodeId 归并。
- 中继丢失 / 插件停用 → 宿主推空快照，界面的「中继发现」标记消失。

### 2.2 房间边界（安全）

- **默认**：房间键 = `nest`，即「同一台中继 = 同一个私有网络」。适合自建 / 私有中继。
- **建议**：两端在「我的设备 → 外网接入」填同一个**空间码**。宿主计算
  `hex(SHA-256("wasmnest-relay-room\0" + code))` 作为房间键；中继只看到哈希，
  看不到空间码明文。
- **发现 ≠ 授权**：会合表只负责「对方现在在不在」。连接仍走引擎的
  node-id 绑定校验 + 宿主首连确认 + 信任表；未匹配设备不能开业务流。
- 中继仍然只转发密文；会合消息只含 PeerId / 自报 nodeId / 展示名，不含文件、
  路径、票据或长期密钥。

## 3. 改动面

### 3.1 能力仓 `wasmnest-lib`

| 文件 | 改动 |
| --- | --- |
| `wasmnest-relay/src/wire.rs` | 新增 `Announce` / `Query` 请求与 `RendezvousPeer` 回执；帧上限 4 KiB → 64 KiB（64 台设备的房间回执约 14 KiB）；新增 `ControlResponse::with_peers` |
| `wasmnest-relay/src/rendezvous.rs`（新） | 会合表：房间隔离、TTL、容量淘汰、房间 / node-id 校验、名称清洗 |
| `wasmnest-relay/src/control.rs` | 分发 announce / query；`allowlist` 模式下未登记 peer 返回 `not-allowed` |
| `wasmnest-relay/src/server.rs` | `ControlContext` 持会合表；新增真实 libp2p stream 的 announce / query 往返用例 |
| `wasmnest-p2p-engine/src/engine.rs` | `RunningNode::open_stream_to_peer`（不经过 peer-net 准入闸门，只给中继控制面用） |
| `wasmnest-server-peer-net/src/relay_rendezvous.rs`（新） | 中继会合客户端：25s announce、circuit 地址拼装、`peer:relay-devices` 全量快照、房间码订阅与哈希派生、预留未就绪 2s 短轮询、失败保留上一份快照 |
| `wasmnest-server-peer-net/src/{lib,plugin_binding}.rs` | 状态字段 / 任务启停 / `peer:relay-room` 静态订阅 / 配置变更与手动刷新唤醒 |

### 3.2 应用仓

| 文件 | 改动 |
| --- | --- |
| `rust/core/src/settings.rs` | `relay_room` 持久化 + `normalize_relay_room` |
| `rust/plugin/src/peer.rs` | `get-my-device` 回 `relayRoom`；`set-settings` 接收 `relayRoom`；每次收敛预留时把房间码发布到 `peer:relay-room`（本地总线，宿主负责哈希） |
| `rust/plugin/src/lib.rs` | 订阅 / 转发 `peer:relay-devices`；停用时关闭会合并释放预留；`refresh-devices` 重发房间码 |
| 双端 `deviceState.ts` | `parseRelayDevicesPayload` / `mergeRelayDevices`；`relay` 标记；中继快照消失时删除纯中继行、保留 LAN / 配对 / 已连接行并摘掉中继标记 |
| 双端 `usePeerDevices.ts` | 订阅 `plugin:file-transfer:relay-devices`；纯中继设备 `relayOnly`；当前只经中继可见的设备把 relay 纳入候选（仍 LAN 优先）；上次经中继的设备自动重连（每会话一次） |
| 双端「我的设备」 | 空间码输入 + 保存；自动发现说明；二维码文案改为「仅兜底，用本应用扫码」 |
| 双端「添加远程设备」 | **粘贴**按钮（直接读剪贴板）；来源提示改为「优先同一中继」 |
| 移动「我的设备」 | 系统分享面板（Web Share API），复制之外多一条「交给对方」的通道 |
| 双端空态 | 「同一中继上的设备会自动出现」提示 |

## 4. 部署 / 升级顺序

1. **中继**：重建 `wasmnest-relay` 并部署（新增的 announce/query 是加法；旧中继会回
   `invalid-request`，新宿主会按失败保留上一份快照，不会假装没有设备）。
2. **宿主运行时**：用含本方案的能力仓提交重打 `lib-v*`，再重建桌面 / 移动宿主；
   应用侧 `host-runtime.lock.json` 的 `hostRuntime` 按平台仓发布更新。
3. **应用**：按当前 SDK 重建 file-transfer 双端产物（本次没有 WIT 变更，不需要重拼
   WIT；但宿主必须已含会合客户端）。
4. 两端配置**同一台中继**；建议再填**同一个空间码**。

## 5. 验证（本轮实跑）

- 能力仓：`wasmnest-relay` 144 tests（含真实 libp2p stream 的 announce/query 往返）；
  `wasmnest-server-peer-net --features relay` 327 tests；`wasmnest-p2p-engine` 46 tests；
  双端宿主 `cargo check --lib` 通过。
- 应用仓：core 97 / plugin 124 / desktop 114 / mobile 78 tests；双端 `vue-tsc` / `tsc`
  无新增错误；desktop `build:frontend`、desktop `build:rust`（wasm + componentize）、
  mobile `build`（wasm + 前端）通过；根 `pnpm run lint` 0 error / 42 warning（既有）。
- **未跑**：真实两端跨 NAT 手工验收（需要先部署新 relay + 重建宿主；`host-runtime.lock.json`
  的 `artifacts` 仍为空），以及桌面 E2E / 双端 E2E（同上）。

## 6. 已知限制（显性）

- 房间是**平面的**：同一空间码下所有设备互相可见。需要「只允许指定设备」时，
  仍靠首连确认 / 信任表，不靠房间。
- 中继会合只解决「发现」；不做打洞（DCUtR）、不做自动信任。
- 旧中继（不含 announce/query）会返回 `invalid-request`：新宿主保留上一份快照，
  用户看到的是「中继发现不可用」，不会看到伪造设备。
- 空间码是隔离键，不是密码；忘记空间码不会泄露历史，但会让两端互相看不到。

## 后续

连接体验的下一步（邀请码 / 状态卡 / 设备行直达发送 / 离线宽限）见
[T23](T23-file-transfer-connection-ux.md)。
