# [feat] T20 · file-transfer 跨网连接体验优化（移动优先）

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2（T12 后续切片）
- **依赖**：T12、T11、T06；P1 额外依赖 T02/T05 的 peer 侧 relay 契约
- **状态**：**P0 已实施（2026-11-11）**；P0-4（扫码器迁移）与 P1（peer 侧 relay 契约）未动，见 §0.1
- **设计依据**：`../nat-traversal.md` §4.6 / §4.9 / §4.10；[T12](T12-file-transfer-wan.md)；[T09](T09-bedcode-mobile.md)（移动端「远程设备列表」UX 先例）
- **issue**：`gh` 当前未认证时以本文件为票据；认证恢复后按 `docs/agents/issue-tracker.md` 转 issue（建议 `kind:feature` + `ready-for-agent`）

> **T21 更新（2026-11-11）**：file-transfer 改为自持「我的设备」与 relay 接入，
> 不再依赖 BedCode 生成连接串 / 建立预留；见 [T21](T21-file-transfer-standalone.md)
> 与 issue [#27](https://github.com/7ZAI/wasmnest-apps/issues/27)。本文件的 P0 记录保留，
> P1 的「宿主级我的设备链接」由 T21 取代。

---

## 0. 一句话

把 file-transfer 的跨网连接从「**有 UI，但没有自己的连接串入口；relay 入口还依赖 BedCode 的隧道预留**」改成
「**file-transfer 自己能给链接、能记住中继路径、内网失败后可一键改走中继**」。
P0 只动应用仓即可闭环；P1 补 peer 侧 relay 契约，解除对 BedCode 的结构性耦合。

### 0.1 实施记录（2026-11-11）

已落地（P0-1 / P0-2 / P0-3，本仓，双端同构）：

| 切片 | 落点 | 说明 |
| --- | --- | --- |
| P0-1 上次传输路径 | `rust/core/src/domain.rs`（`DeviceSnapshotEntry.last_transport`）、双端 `deviceState.ts` / `usePeerDevices.ts` | `peer:connection.transport` 写入设备缓存并随快照落盘（断开保留）；`connect()` 缺省 `wan = lastTransport === 'wan-relay'`（LAN 仍优先）；旧快照缺字段 = 不显示、行为不变 |
| P0-2 仅经中继 + 错误分类 | `rust/core/src/dial.rs`（`DialEndpoint.relay_only` + `DialErrorCode`）、`rust/plugin/src/peer.rs`、双端 `deviceState.ts` / `usePeerDevices.ts` | `relayOnly` 跳过 LAN；`allowWan=false` 时 `relay-disabled` 显性失败、无 relay 候选时 `no-endpoint`；分类 token 见下方偏差说明 |
| P0-3 来源提示与徽标 | 双端 `DevicesTab` / `PeerDevicesPanel` / `FileTransferView` / `AddRemoteDeviceDialog` / i18n | 「连接串由对方 BedCode → 设备配对生成」提示；添加成功 toast 区分「含中继」/「仅内网」；行内「含中继 / 仅内网」徽标与「上次：…」；LAN 失败且存在 relay 候选时把「仅经中继」提为主按钮 |

**与 §4.2 的偏差（按平台契约修正，需评审确认）**：原设计把「前缀」放在插件命令的错误
文本里让前端分类。实测两端宿主都把插件命令失败统一序列化成 `{ code, request_id }`
信封（ADR 0030：技术详情永不进信封），**双端前端都拿不到错误原文**——既有
`msg.includes('denied')` 分支实际是死代码。故本实现改为：

- 可分类的拨号失败以 `Ok({ status, detail })` 返回（`status` = §4.2 表中的 token：
  `denied` / `no-endpoint` / `relay-disabled` / `relay-unreachable` / `lan-unreachable` /
  `timeout`），前端只按 token 分类；未识别错误仍 `Err`，前端落 `unknown` + 原文
  （fail-visible，不猜成因）；
- 数据面命令（`ensure_target` 重拨）的错误正文仍带 `<token>:` 前缀，供宿主日志 /
  移动端错误串关联（前端不依赖它做分类）。

未实施：P0-4（扫码器迁移，§10 开放问题 6「复制 vs 共享包」未拍板）、P1 全部（需能力仓
WIT + 平台 SDK/宿主联动）。双端 `test:run`、core/plugin `cargo test`、双端前端构建已跑通；
真机 / 跨 NAT 手工验收（§7.3）与移动 E2E 均未跑（`host-runtime.lock.json` 的 `artifacts`
仍为空 + 无 relay 双网络环境），验收报告应标 `⏭`。

---

## 1. 现状（已按代码核实）

### 1.1 连接形式

| 场景 | 入口 | 机制 | 现状 |
| --- | --- | --- | --- |
| 同一局域网 | mDNS 自动发现 → 点「连接」 | `file-transfer.dial-peer`（单地址）或 `dial-peer-addrs`（多地址）；LAN 候选优先 | ✅ 可用 |
| 跨网 | 「添加远程设备」→ 扫码 / 粘贴 `wasmnest://pair/…` 或 JSON | 存 `nodeId + addrs`；连接时 LAN 优先，**只有显式「尝试外网」/ 无 LAN 候选 / 上次拨号已走 relay** 才把 relay circuit 加入候选 | ⚠️ 有条件可用 |
| 连接串来源 | 桌面 **BedCode → 设备配对** 生成 QR / 复制连接串 | 两端共享同一个 host peer node，BedCode QR 的 `peer` 正好是 `{nodeId, addrs, ticket}`；file-transfer 解析时忽略 token / ticket | ⚠️ file-transfer 没有生成入口 |
| relay ingress | 行内「尝试外网」 | 把 `/p2p-circuit` 候选交给 `dial-peer-addrs` | ⚠️ 依赖对端有 relay 预留 |

代码索引：

- 移动端编排：`apps/file-transfer/mobile/src/composables/usePeerDevices.ts`、`src/components/DevicesTab.vue`
- 双端同构的连接串解析：`apps/file-transfer/{mobile,desktop}/src/utils/pairingLink.ts`
- 拨号候选计划：`apps/file-transfer/rust/core/src/dial.rs`
- 拨号 + endpoint memo：`apps/file-transfer/rust/plugin/src/peer.rs`、`src/device_bridge.rs`
- 快照形状：`apps/file-transfer/rust/core/src/domain.rs`（`DeviceSnapshotEntry` / `DialEndpoint`）
- 设置：`apps/file-transfer/rust/core/src/settings.rs`（`allowWan` / `relayMaxBytesPerTask`）

### 1.2 关键缺口

1. **没有「我的设备二维码 / 复制连接串」**
   - 双端 file-transfer 只有「添加远程设备」的消费面（移动扫码/粘贴，桌面仅粘贴），没有生产面。
   - 实际可用来源是 **桌面 BedCode 设备页的 QR / 连接串**：peer node 是宿主级共享单例，BedCode QR 的
     `peer.nodeId` / `peer.addrs` 对 file-transfer 同样有效（`pairingLink.ts` 头注也明确兼容 QR v2 包装形态）。
   - 用户必须知道「去 BedCode 拿链接」，file-transfer 里没有任何提示；桌面也无法反向添加移动设备
     （移动 file-transfer 同样无法生成自己的链接）。

2. **relay 预留不在 file-transfer 手里**
   - `host-peer` 的节点配置（`../wasmnest-lib/wasmnest-server-peer-net/wit/peer.wit` 的
     `peer-node-config`）只有 `data-dir / device-name / listen-port`，**没有 relay 配置**；
   - **注意实现现状**：WIT 注释写「按 app 维度隔离节点实例」，但当前宿主实现是**单个共享 `PeerCtx` / runtime**
     （`wasmnest-server-peer-net` 的 `start_locked` 幂等早退，桌面 `bootstrap/run.rs` 的 tunnel 与 host-peer 用同一份
     `peer_ctx`）。所以 relay 预留是**宿主级**事实，不是某个 app 的私有资源；P1 设计不能假设 per-app 独立节点；
   - file-transfer 的 `plugin.json` 没有 `tunnel:*` 权限，不会调用 `host-tunnel`；
   - 真正做 relay 预留的是 `host-tunnel` 的 manager（`../wasmnest-lib/wasmnest-server-peer-net/src/tunnel/manager.rs::recount`）；
   - 结果：**BedCode 打开 + 配置 relay 时，file-transfer 的 relay 候选才可能拨通**；BedCode 关闭/未配 relay 时，
     「尝试外网」必失败。且桌面 file-transfer 需处于激活状态（接收端 consent / 句柄在插件侧；壳停用则收不到）。
     移动端作为被连方也没有预留，因此 **desktop→mobile 的跨网主动发送不可用**。

3. **重启后不记得上次走中继**
   - `device_snapshot` 只存 `addrs / paired`，不存上次传输形态；`DialEndpoint.wan` 只活在进程内 `SessionTable`。
   - 上次经中继连过的设备，重启后仍要再点一次「尝试外网」。

4. **「尝试外网」仍先试 LAN**
   - `dial_plan` 永远 `candidates = lan + relay`（`relay` 仅在允许时追加）；在蜂窝网络下，若保存的 LAN
     地址已失效，会先吃 3s × N 次超时才轮到 relay。缺少「仅经中继」的显式快速路径。

5. **扫码器与 BedCode v2 码不匹配**
   - 移动 file-transfer 的 `ScanPanel.vue` 仍是 `html5-qrcode` 默认相机循环（`qrbox 250`）；
   - BedCode v2 载荷是 85–93 模块的稠密码，BedCode 已因同一问题重做多档解码（`docs/FRONTEND.md` §2.5），
     file-transfer 未跟进；「扫码添加」在真机上很可能扫不出，只剩粘贴可用。

6. **错误原因太粗**
   - 前端只分 `denied` / `unreachable`；`relay-unreachable`、`timeout`、`no-endpoint` 全部落到「无法连接」，
     没有可操作出路。

7. **单向跨网**
   - 移动可以拨桌面（依赖 BedCode 的链接与预留）；桌面无法拨移动（移动没有链接生成入口，也没有预留）。

### 1.3 证据（发布口径）

- `NodeSnapshot.addrs` 只在 relay 预留生效（`RelayState::Reserved`）时才包含 `/p2p-circuit` 地址
  （`../wasmnest-lib/wasmnest-server-peer-net/src/tunnel/manager.rs`，`node_snapshot` 段）；
- `TunnelManager` 与 `host-peer` 使用同一个 `PeerCtx`（`../wasmnest/wasmnest-desktop/src-tauri/src/bootstrap/run.rs`）；
- BedCode 桌面应用挂载时已幂等 `session.tunnel.prepare`
  （`apps/bedcode/desktop/src/composables/useTunnelStatus.ts::warmUpTunnelIngress`），
  因此 BedCode 打开期间 shared peer node 通常有预留；但这是**跨应用隐式耦合**，不能作为产品契约。

---

## 2. 目标 / 非目标

**目标**

1. 已配对远程设备在**重启后**仍能识别「上次经中继」，重连时自动把 relay 纳入候选（不必再次找按钮）。
2. 内网拨号失败且存在 relay 候选时，给**一键「仅经中继重试」**（不先等 LAN 超时），并把失败原因说清楚。
3. 添加远程设备的入口明确告诉用户**连接串从哪里来**（P0 指向 BedCode；P1 指向 file-transfer 自己的分享入口）。
4. 设备行能显示「上次：内网直连 / 外网中继」「含中继候选 / 仅内网」，让用户知道当前是否具备跨网能力。
5. P1 后：file-transfer 自己能生成连接串 / 二维码，能独立维护 relay ingress；不再要求 BedCode 同时打开。
6. P1 后：移动端也能被桌面主动拨号（双向跨网），且不改变现有传输协议与加密。

**非目标**

- 不改传输帧协议、断点续传、暂停/恢复、并发闸门、应用层加密（固定 `true`）。
- 不新增跨应用直接 import；扫码器如需复用，按「复制 + 同判据」或后续抽公共包处理。
- 不做自动 WAN 切换（除非 §10 产品拍板）；不改变「同网段不可达不自动烧中继」的默认口径。
- 不做移动后台常驻 / 前台服务（T06 未完成项，另立）。
- 不改 BedCode 的隧道 / QR 契约（T09/T08 已收口）；P1 通过新增 peer 侧契约解耦，而不是让 file-transfer 调 BedCode。

---

## 3. 方案总览

| 优先级 | 切片 | 改动面 | 是否跨仓 | 价值 |
| --- | --- | --- | --- | --- |
| P0-1 | 快照记住上次传输路径 | `rust/core` + 双端前端 | 否 | 重启免重复点「尝试外网」 |
| P0-2 | `relayOnly` 拨号 + 稳定错误前缀 | `rust/core` + `rust/plugin` + 双端前端 | 否 | 失败一键中继、错误可操作 |
| P0-3 | 来源提示 + 中继可用性 / 上次形态展示 | 双端前端 + i18n | 否 | 消除「链接从哪来」的死胡同 |
| P0-4 | 扫码器对齐 BedCode 多档解码 | 移动前端 | 否（复制） | 让扫码添加可用 |
| P1-1 | peer 侧 relay 配置 + `node-info` | 能力仓 WIT + peer-net + 平台 SDK/宿 | **是** | 解除对 BedCode 的预留依赖 |
| P1-2 | file-transfer 自己的链接/QR + 中继就绪状态 | 双端前端 + Rust | 依赖 P1-1 | 自己能分享、能独立 ingress |
| P1-3 | 宿主级「我的设备」链接（可选最优解） | 平台宿主 + 双端 app | **是** | 所有 app 共用一份链接与预留 |

---

## 4. 设计

### 4.1 P0-1：快照记住「上次传输路径」

**数据**

`DeviceSnapshotEntry` 增加（serde 默认，旧快照不受影响）：

```rust
/// 上次连接成功时宿主上报的传输形态（lan-direct / wan-relay；未知 = None）
#[serde(default)]
pub last_transport: Option<String>,
```

前端 `DiscoveredDevice` / `SnapshotEntry` 同步增加 `lastTransport?: 'lan-direct' | 'wan-relay'`。

**写入**

- `peer:connection` `connected=true` 且带 `transport` 时写 `lastTransport`（与现有 `transports` 同源）；
- `disconnected` 时**保留**（用于下次重连与行内展示），不因断开清空；
- 落盘仍走现有 debounce `save-device-snapshot`。

**读取 / 拨号**

- `connect(nodeId)` 默认传 `wan: lastTransport === 'wan-relay'`（表示「把 relay 纳入候选」，仍 LAN 优先）；
- 行内在 idle 时显示「上次：内网直连 / 外网中继」；
- 旧快照无该字段 → `null` → 行为与现在一致（LAN 优先，不自动中继）。

**测试**

- Rust：`DeviceSnapshotEntry` 序列化/反序列化（新字段、旧 JSON 缺字段）；
- 前端：快照恢复映射、连接参数 `wan` 断言；
- 不改 `dial_plan` 语义（已有 `ep.wan` 判据，单测已覆盖）。

### 4.2 P0-2：`relayOnly` 与稳定错误前缀

**问题**：现有「尝试外网」= `wan: true`，候选仍是 `LAN + relay`。在蜂窝 / 换网后，旧 LAN 地址会先超时。
产品上需要一个明确的「跳过内网，直接经中继」动作。

**契约（应用仓内）**

`DialEndpoint` 增加：

```rust
/// 只拨 relay 候选（用户显式「仅经中继」；缺省 false）
#[serde(default)]
pub relay_only: bool,
```

`dial_plan` 增加 `relay_only` 入参：

- `relay_only = true`：
  - `allowWan = false` → 显性 `relay-disabled` 错误（不静默降级）；
  - 无 relay 候选 → `no-endpoint`；
  - 候选 = relay（不再包含 LAN）。
- `relay_only = false`：保持现有 `wan` 逻辑不变。

`file-transfer.dial-peer` 入参增加 `relayOnly?: boolean`；成功后 endpoint memo 记住 `relay_only`，
数据面断线自动重拨沿用（避免中继会话重连又去撞 LAN）。

**稳定错误前缀**

插件命令边界把错误归一为可分类前缀（未识别错误原样展示，fail-visible）：

| 前缀 | 触发 | 前端文案 / 出路 |
| --- | --- | --- |
| `denied:` | 对端拒绝 / 未信任 / consent 未通过 | 检查对端信任与首连确认 |
| `no-endpoint:` | 没有 `addr:port` 且 `addrs` 为空 | 重新添加远程设备 |
| `relay-disabled:` | `allowWan=false` 或只剩 relay 被策略挡下 | 打开设置「中继（外网）」 |
| `relay-unreachable:` | relay 候选全部失败 | 检查 relay / 桌面端在线 |
| `lan-unreachable:` | LAN 候选失败且未纳入 relay | 给「仅经中继重试」 |
| `timeout:` | 宿主超时 | 重试 / 检查网络 |

前缀由 `rust/plugin/src/peer.rs` 的 `dial_peer` / `ensure_target` 统一包装；前端
`usePeerDevices.connect` 只按前缀分类，不猜错误正文。前缀表进单测（Rust + 前端映射）。

**UI**

- 失败态（`dialError === 'lan-unreachable'` 且 `wanAvailable`）把「仅经中继」提升为主按钮；
- 保留现有「尝试外网」（`wan:true`，LAN 优先）作为次级入口；
- 「仅经中继」失败 / 超时给明确文案，不静默回退 LAN。

### 4.3 P0-3：来源提示与中继可用性

- 「添加远程设备」弹层 + 扫码页加一行说明：
  - P0 阶段：「在对方设备的 **BedCode → 设备配对** 页生成二维码或复制连接串；file-transfer 自己的分享入口见 T20 P1」；
  - P1 之后：「在本机『我的设备』中生成二维码 / 复制连接串」。
- 添加成功 toast 区分：「已添加（含中继候选，可跨网）」/「已添加（仅内网）」。
- 设备行 idle 态显示：
  - `上次：外网中继` / `上次：内网直连`（P0-1 数据）；
  - `含中继` / `仅内网` 小徽标（`hasRelayCandidate(addrs)`，已有纯函数）。
- 不新增权限、不新增网络请求。

### 4.4 P0-4（独立切片）：扫码器对齐 BedCode 多档解码

- 移动 file-transfer 的 `ScanPanel.vue` 仍用 `html5-qrcode` 默认相机循环；BedCode v2 码是稠密码，
  与 BedCode 已修复的问题同源（`docs/FRONTEND.md` §2.5）。
- 方案：把 `apps/bedcode/mobile/src/host/scan/`（`decodeStrategy` / `useCameraStream` / `useQrScanLoop` /
  `zxingDecoder` / `nativeDetector` / `scanHint`）按「同判据、复制一份」迁入 file-transfer
  （先例：`pairingLink.ts` 双端各一份），并补纯函数单测；
- 或者后续抽到共享包（跨 app 源码耦合禁令的边界需评审）；本 spec 不强制。
- 相册路径可继续用 `html5-qrcode.scanFile`（若有），或与相机共用同一策略。
- 该项与 WAN 体验正交，可独立合入。

### 4.5 P1-1：peer 侧 relay 配置 + `node-info`（跨仓）

**现状**：`peer-node-config` 没有 relay 字段；`host-tunnel` 是唯一能预留 relay 的消费者；
peer node 是宿主级共享单例（不是 per-app 独立节点）。因此不应让 file-transfer 直接调 BedCode 的隧道。

**方案 A（推荐：应用显式 configure + 引用计数）**

- `host-peer` 新增：

```wit
record peer-node-info {
    node-id: string,
    /// 可拨 multiaddr：LAN 直连在前；仅 relay 预留生效时包含 /p2p-circuit
    addrs: list<string>,
    /// relay-reserved / relay-lost / relay-idle / relay-connecting
    relay-state: string,
}

/// 幂等；按插件引用计数。返回当前可拨地址与 relay 状态。
configure-relay: func(relay-addrs-json: string, enable: bool) -> result<peer-node-info, string>;
/// 只读。
node-info: func() -> result<peer-node-info, string>;
```

- 应用侧（file-transfer 后端，Rust）从网络配置中心读到 relay 地址与 WAN 策略（与 BedCode `relay_center`
  同一真源，经 `host-api-call` 调 `com.wasmnest.net-config` 的 `relay-config` / `wan-policy`），
  在 activate 时 `configure-relay(addrs, allowWan)`、deactivate 时 `configure-relay([], false)`；
- peer-net 在**第一个** `enable=true` 的消费者出现时预留、最后一个释放（引用计数）；
- 优点：不需要宿主能读服务型 wasm 的 KV；与现有「应用读中心 → 写宿主配置」架构一致；
  多个 peer 应用共享同一 ingress 时不会互相覆盖。
- 代价：能力仓 WIT + peer-net + 平台 SDK/宿主；每个 peer 应用要接一次中心读取（可抽成薄模块复用）。

**方案 B（宿主级，长期）**

- 宿主自己持有 relay 配置（网络设置 / 宿主服务），按 `net.peer-node` 消费者计数预留；
- 应用只读 `node-info`，不参与配置；
- 优点：应用零配置、真正的用户级开关；
- 代价：当前宿主没有读 net-config（服务型 wasm）KV 的跨插件原语，需要新增宿主侧网络服务或把配置迁到宿主设置；
  在架构未变前不作为 P1 首选。

**验收（P1-1）**

- 不启动 BedCode，只启动 file-transfer，桌面 peer node 仍有 relay 预留，且 `node-info.addrs` 含 circuit；
- 没有配置 relay / 关闭 allowWan 时，`node-info.relay-state` 显性，不伪造 addrs；
- 最后一个消费者退出后预留释放；
- 能力仓 / 平台仓测试与 `compose-wit --check` 绿。

### 4.6 P1-2：file-transfer 自己的链接 / QR

- 依赖 P1-1 的 `node-info`；
- 双端设备页新增「我的设备」入口：展示 `nodeId` 短指纹、`addrs` 数量、relay 状态；
- 「复制连接串」/「显示二维码」输出与 `pairingLink.ts` 解析端**同一载荷形状**：

```json
{
  "nodeId": "<64 位小写 hex>",
  "addrs": ["/ip4/192.168.1.10/tcp/47613", "/ip4/203.0.113.9/tcp/4001/p2p/<relay>/p2p-circuit/p2p/<peer>"],
  "deviceName": "My Laptop"
}
```

- 或 `wasmnest://pair/<base64url(json)>`；**不包含长期密钥**，`ticket` 可选（file-transfer 目前不消费）；
- 移动端扫码器接收同一载荷；
- 若 relay 未就绪：链接只含 LAN 地址，并在 UI 显性标「仅内网」；不放残缺 relay 地址。

### 4.7 P1-3（可选最优解）：宿主级「我的设备」链接

peer node 本来就是共享单例，链接应该由宿主生成一次：
- 宿主命令 `peer_link_info` / 宿主壳「我的设备」页；
- 输出 `{nodeId, addrs, relayState}`，任何 app 可读；
- 应用只负责「扫 / 贴 / 展示」，不再各自造 QR。

收益：BedCode / file-transfer / 未来的 peer 应用共用同一链接与预留；避免 P1-2 在每个 app 重复实现。
代价：平台仓 UI 与命令面变更；需与 BedCode 现有 QR 页统一。

---

## 5. 数据与契约变更汇总

| 变更 | 落点 | 兼容策略 |
| --- | --- | --- |
| `DeviceSnapshotEntry.last_transport` | 本仓 `file-transfer/rust/core` | serde default；旧快照缺字段 = None |
| 前端 `lastTransport` 映射 | 双端 `deviceState.ts` / `usePeerDevices.ts` | 旧快照无值 = 不显示 |
| `DialEndpoint.relay_only` + `dial-peer.relayOnly` | 本仓 `file-transfer/rust/{core,plugin}` | serde default；旧调用不带 = 行为不变 |
| 错误前缀约定 | 本仓 `file-transfer/rust/plugin` + 前端 | 未识别错误原样展示 |
| `host-peer.configure-relay` / `node-info` | 能力仓 WIT + peer-net | 需版本化：WIT 变更 → compose + `witSha256` + SDK + host lock |
| 宿主级 `peer_link_info`（可选） | 平台仓 | 需新增宿主命令与壳 UI |

**版本纪律**：凡改 WIT（P1-1）必须走「能力仓 → 平台仓 compose/SDK → 应用仓重建产物」三仓联动，
按 tag 钉住；本 spec 的 P0 不触发 WIT 变更。

---

## 6. 安全与不变量

1. 链接只含 `nodeId + addrs`（可选 `ticket`），**不含长期密钥**；首次连接仍走 consent / trust。
2. 加密固定开启（T12 已落地）；relay 与 LAN 都是加密链路，无明文回退。
3. `allowWan=false` 时不得纳入 relay；只剩 relay 候选时显性报错，不静默降级。
4. 「仅经中继」是**用户显式动作**；不因 LAN 失败自动切换（沿用 T12 §4.9 口径）。
5. relay 预留只在有活跃 peer 消费者时存在；退出释放，不残留。
6. 错误分类不得把未知错误猜成成功 / LAN / WAN；未识别原样展示（fail-visible）。
7. 扫码 / 连接串解析日志不落原文（可能含 ticket）；只记结论。

---

## 7. 测试与验收

### 7.1 单元测试

- Rust core：
  - `DeviceSnapshotEntry.last_transport` 序列化往返 + 旧 JSON 缺字段；
  - `dial_plan` 的 `relay_only`：allowWan 开/关、有/无 relay、与 `wan` 组合；
- Rust plugin：
  - `dial-peer` 传 `relayOnly` 的候选表与 memo；
  - 错误前缀分类（denied / no-endpoint / relay-disabled / relay-unreachable / timeout）；
- 前端（双端）：
  - 快照 `lastTransport` 映射与恢复；
  - `connect()` 默认 `wan` 与显式 `relayOnly` 参数；
  - 行状态派生：`lastTransport` 展示、`wanAvailable`、失败按钮优先级；
  - 错误前缀 → 文案 key 映射。

### 7.2 组件 / 集成

- 桌面：`remoteDevices.test.ts` / `deviceState.test.ts` 扩展；
- 移动：当前 vitest 是 node 环境（`apps/file-transfer/mobile/vitest.config.ts`），新增组件交互测试需补
  `happy-dom`；否则至少把纯函数 / composable 逻辑抽出来覆盖；
- 若做扫码器迁移：补与 BedCode 同级的纯函数测试，并保留相册 / 权限错误路径。

### 7.3 手工 / 真机验收

| 场景 | 步骤 | 判据 |
| --- | --- | --- |
| 同 LAN | mDNS 发现 → 连接 → 发送 | 显示「内网直连」；传输成功 |
| 远程（P0 当前链路） | BedCode 桌面生成 QR → 移动 file-transfer 扫码/粘贴 → 添加 → 连接 / 尝试外网 | 显示「外网中继」；发送成功 |
| 重启记忆 | 经中继成功后彻底退出移动 app → 重启 → 看行状态 → 直接连接 | 行显示「上次：外网中继」；连接自动纳入 relay（仍 LAN 优先） |
| LAN 失败一键中继 | 蜂窝网络 + 旧 LAN 地址 → 连接失败 | 出现「仅经中继」主按钮；点击后不先等 LAN 超时，直接 relay |
| allowWan=false | 关闭设置项 → 仅 relay 设备 / 仅经中继 | 显性报错，不静默降级 |
| 撤销 / 未信任 | 桌面撤销该设备 → 重连 | 显性 denied / 安全错误；不自动绕过 |
| 扫码 | 扫 BedCode v2 稠密码（LAN+relay） | 3s 内识别；失败不打断相机 |
| P1（环境就绪后） | 只开 file-transfer（BedCode 关闭）→ 移动经 relay 连接 | 成功；证明 ingress 已解耦 |

**环境阻塞（如实记录）**：`host-runtime.lock.json` 的 `artifacts` 为空，真机 / 双端 E2E 当前不可跑；
跨 NAT 验收需要自建 relay + 两端不同网络。未跑项必须在验收报告中标 `⏭` 并写原因，不得按通过计。

### 7.4 DoD

1. P0-1 / P0-2 / P0-3 完成，双端 `test:run` + 相关 Rust `cargo test` 绿；
2. 旧快照 / 旧连接串 / 旧调用（不带 `relayOnly`）行为不变；
3. `allowWan=false`、未信任、无 endpoint 三类错误有独立文案与出路；
4. 手工场景表（除 P1 / 环境阻塞项）全部通过；
5. 移动 / 桌面构建绿；根 lint 0 error；
6. 文档同步：`docs/verification/file-transfer.md` F-15 增补步骤；T12 加「后续优化见 T20」指针；
7. P1 另票，不阻塞 P0 合入。

---

## 8. 任务拆分

| # | 任务 | 依赖 | 估时 |
| --- | --- | --- | --- |
| T20-1 | 快照 `last_transport`（core/plugin + 双端前端） | — | 1d |
| T20-2 | `relayOnly` + 错误前缀（core/plugin + 前端映射） | — | 1d |
| T20-3 | 行状态 / 按钮 / 来源提示 / i18n / 锚点 | T20-1、T20-2 | 1d |
| T20-4 | 扫码器迁移（`scan/` 复制 + 纯函数测试） | — | 1.5d（可独立） |
| T20-5 | 手工验收 + `docs/verification/file-transfer.md` / T12 文档 | T20-3 | 0.5d |
| P1-1 | 能力仓 `host-peer.configure-relay` / `node-info` + peer-net 预留引用计数 | — | 2d |
| P1-2 | 平台 SDK / 宿主装配 / WIT 重拼 / lock | P1-1 | 1d |
| P1-3 | file-transfer「我的设备」QR/连接串 + relay 就绪状态 | P1-1/2 | 1.5d |
| P1-4 | （可选）宿主级「我的设备」链接 | P1-1/2 | 1d |

> P0-4 与 WAN 体验正交；若排期紧，可先合 P0-1/2/3，扫码器另票。

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| relay 预留仍依赖 BedCode（P0 期间） | 高 | P0 文案明确前置；P1 解耦；验收记录「BedCode 关闭」为 P1 判据 |
| 共享 peer node 的多 app relay 配置冲突 | 高 | 应用 `configure-relay` + 引用计数（方案 A）；不要把预留塞进 per-app 生命周期；宿主级方案（B）作为长期收敛 |
| 旧快照 / 旧调用兼容 | 中 | 全部 serde default；新增参数可选；旧行为回归测试 |
| 错误前缀映射漂移 | 中 | 前缀表单一处定义 + 双端测试；未知错误原样展示 |
| `relayOnly` 在无预留时快速失败 | 中 | 显性文案 + 引导检查 relay / 桌面；不静默回退 LAN |
| 扫码器复制导致双份维护 | 中 | 头注「同判据，两处一起改」；P1 评估抽共享包 |
| 跨 NAT 环境不可用 | 中 | 手工场景拆「同 LAN / 单侧跨网 / 真跨网」；不可跑项标 `⏭` |
| 移动后台 / 前台服务未完成 | 中 | 本 spec 不承诺后台接收；前台接收按现状 |

---

## 10. 开放问题（评审拍板）

1. **「仅经中继」入口**：失败后主按钮，还是远程设备行的常驻次级入口？是否也允许「始终经中继」按设备记忆？
2. **P0-1 的自动纳入**：上次 WAN 成功后，重启默认 `wan:true`（LAN 优先，推荐）还是 `relayOnly:true`（更快但可能错过 LAN 恢复）？
3. **P1 方案 A vs B**：应用显式 `configure-relay` + 引用计数（推荐），还是宿主级 relay 配置（应用零配置、但需宿主能读网络中心）？
4. **链接生成**：P1-2 每个 app 自建，还是 P1-3 宿主统一？后者更干净但平台改动更大。
5. **P0 来源提示**：临时写「去 BedCode 生成」是否可以接受（会增加 BedCode 依赖的显性度）？
6. **扫码器**：复制 `scan/` 还是抽共享包（需评估跨 app 源码耦合禁令）？
7. **中继提示阈值**：默认 `0`（每次提示）是否改默认值 / 本会话不再问（T12 §9.2#4 原口径）？

---

## 11. 附：当前拨号计划（便于对照）

```text
dial_plan(ep, allow_wan, manual_wan):
  lan   = [ep.addr:port 非 relay] + ep.addrs 中非 relay
  relay = [ep.addr:port 若 relay] + ep.addrs 中 relay
  relay_wanted = manual_wan || ep.wan
  include_relay = allow_wan && relay 非空 && (relay_wanted || lan 为空)
  candidates = lan + (include_relay ? relay : [])
  candidates 为空 → 显性错误（区分 allowWan 挡下 / 完全无地址）
```

本 spec 增加：

```text
dial_plan(..., relay_only):
  relay_only && !allow_wan → relay-disabled
  relay_only → candidates = relay（空则 no-endpoint）
  否则沿用上述逻辑
```

---

## 12. 关联

- [T12 file-transfer WAN](T12-file-transfer-wan.md)（导入 / 多地址 / 加密 / 限额）
- [T11 多地址拨号](T11-dial-peer-addrs.md)
- [T09 BedCode 移动端 UX 先例](T09-bedcode-mobile.md)（远程设备列表 / 尝试外网 / 失败态）
- [T06 平台装配](T06-platform-assembly.md)（host-tunnel / 预留引用计数）
- `docs/FRONTEND.md` §2.5（扫码解码策略，P0-4 复用来源）
- `docs/verification/file-transfer.md`（F-15 验收步骤）
