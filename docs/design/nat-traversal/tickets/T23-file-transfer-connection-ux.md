# [feat] T23 · file-transfer 连接体验优化（邀请 / 状态 / 直达发送）

- **落仓**：`7ZAI/wasmnest-apps`（应用面为主）；状态事件与换网唤醒涉及 `7ZAI/wasmnest-lib`
- **标签**：`kind:feature`
- **阶段**：T22 之后的体验切片
- **状态**：**P0 已实施（2026-11-12）**：P0-1（邀请 v4）、P0-2（状态卡 + 宿主 envelope）、P0-3（设备行直达发送）均已落地；真实跨 NAT 验收待重打 relay + 宿主运行时
- **依赖**：T22（中继会合发现）、T21（我的设备 / relay 预留）、T20（WAN UX）、T18（net-config）
- **设计依据**：2026-11-12 用户反馈（「扫码无效」「复制连接串怎么给对方」「双端都配置中继」）+ T22 实施记录
- **真源 issue**：待提交（按 `docs/agents/issue-tracker.md`；`gh` 可用后补链接）

> 本文是**设计 spec**，不是实施记录。P0 的验收项在实施前不得勾选；实现完成后把「实施记录 / 验证」补到本文末尾。

---

## 0. 一句话

把跨网连接从「**两端各配 multiaddr + 手工对齐空间码 + 回设备页点连接**」改成
「**一端生成邀请 → 另一端扫一次/粘一次 → 设备自动出现 → 设备行直接发送**」，
并把「没反应」变成「状态卡说清楚下一步」。

## 1. 现状与用户旅程

### 1.1 当前步骤（第一次跨网，手机 ↔ 桌面）

| #   | 用户动作                                          | 摩擦                                           |
| --- | ------------------------------------------------- | ---------------------------------------------- |
| 1   | 准备一台公网中继（VPS / Docker / systemd）        | 普通用户无法完成；没有默认/托管中继            |
| 2   | 桌面打开「内网穿透」应用，导入 `/ip4/…/p2p/12D3…` | 跨应用；multiaddr 是开发者格式                 |
| 3   | 手机打开 file-transfer「我的设备」，再粘贴同一串  | 第二次重复输入；容易多空格/漏段                |
| 4   | 两端各填一个相同的「空间码」                      | 没有生成器；只能自己发明并口头/聊天传递        |
| 5   | 回设备列表等设备出现                              | 不知道是在连接中、空间不一致、还是对方没开应用 |
| 6   | 点连接 → 对方在前台点同意                         | 没有「等待对方确认」的明确状态                 |
| 7   | 切到文件页 → 选文件 → 点「发送到手机」            | 设备页与发送页割裂；不是「给这台设备发文件」   |

### 1.2 代码事实（核实）

- `pairingLink.ts`（双端）只生成/解析 v3 设备链接
  `{ v:3, nodeId, addrs, deviceName }`；载荷**不含中继地址与空间码**。
- 「我的设备」二维码画的是 v3 链接；`addrs` 含会变的 circuit 地址，模块数约 85–95。
- 桌面 relay 真源是 `servers/net-config`；`relay_center::resolve` 中心优先，
  中心「明确未配置」= 空（不复活本机缓存）。
- `get-my-device` 返回 `relayAddrs / relayRoom / relaySource / relayState / relayError`，
  但**没有**「发现是否可用 / 上次查询错误 / 空间内设备数」。
- `peer:relay-devices` 事件只有 `{ devices }`，没有 `status / error / updatedAtMs`。
- 设备行只有连接/断开/切换，没有「发送文件」；发送入口是顶栏
  `sendToPhone`，依赖当前活跃对端（`useTasks.sendPaths`）。
- 首连确认点「接受」会在宿主 `respond_peer_consent` 里**自动写入信任表**；
  弹窗没有「仅本次 / 始终信任」选择。
- 中继会合状态只在宿主日志里（`relay rendezvous announce failed`），前端看不到。
- 移动端没有前台服务；应用不在前台时不会 announce，对端列表里也不会出现。

### 1.3 四个断点

1. **Setup**：中继地址 + 空间码要跨应用、逐字一致地配两遍。
2. **Diagnosis**：不出现设备时，界面无法区分「没配 / 连不上 / 版本旧 / 空间不一致 / 对方没开」。
3. **Action**：发现与发送是两个页面，发文件前要先回设备页建立连接。
4. **Continuity**：对端一旦不再 announce，设备行立刻消失；用户以为「坏了」。

## 2. 目标 / 非目标

**目标**

1. 一端生成**邀请**，另一端扫一次或粘一次即可完成「中继 + 空间码」配置。
2. 设备页有一张**跨网连接状态卡**，把「没反应」变成可操作的原因与下一步。
3. 设备行可直接「发送文件」，连接与选文件合并成一次动作。
4. 对端离线后保留「最近可见」行（宽限期内），不瞬间消失。
5. 邀请/连接串可从剪贴板一键导入；移动端可系统分享邀请。
6. 空间码可一键生成、可轮换；旧邀请失效有明确提示。
7. 设备可设本地别名；首连确认文案明确「接受并信任」。

**非目标**

- 不改变传输协议、加密、断点续传、暂停/恢复。
- 不自动信任陌生设备；首连确认仍然保留。
- 不解决移动端后台常驻接收（T06 / 单独票）；只把「对方需打开应用」说清楚。
- 不引入官方/托管中继（产品决策；本文只预留「部署级默认中继」的接缝）。
- 不为 P0 引入新的 WIT 形状；状态事件是总线 JSON 的增量字段。
- 不做「全自动连接所有同空间设备」；只对上次经中继成功的设备自动重连。

## 3. 方案总览

| 优先级 | 切片                                 | 改动面                                                 | 用户价值                         |
| ------ | ------------------------------------ | ------------------------------------------------------ | -------------------------------- |
| P0-1   | 邀请 v4（relay + room）扫码/粘贴导入 | 双端前端 + 双端 Rust `set-settings` / `get-my-device`  | 第一次配置从 6 步降到 2 步       |
| P0-2   | 跨网状态卡 + 发现状态事件            | 宿主 `relay_rendezvous` + 双端前端                     | 不再「什么都没有」               |
| P0-3   | 设备行直达发送 + 等待确认态          | 双端前端（复用 `connect` / `pickFiles` / `sendPaths`） | 发文件从 5 步降到 2 步           |
| P1-1   | 最近可见 / 离线宽限                  | 双端 `deviceState` + `usePeerDevices`                  | 设备不闪没；知道是离线而不是坏了 |
| P1-2   | 剪贴板导入 + 邀请分享                | 双端前端                                               | 复制后少一次找入口               |
| P1-3   | 换网即时唤醒                         | 宿主换网钩子                                           | 切 Wi-Fi/蜂窝后不必等 25s        |
| P1-4   | 本地别名 + 确认文案                  | 双端前端 + app KV                                      | 认得出设备；知道「接受」= 信任   |
| P2     | 默认中继预设 / 移动后台              | 部署 / 平台                                            | 真正降低首次使用门槛             |

## 4. 详细设计

### 4.1 邀请 v4（P0-1）

#### 4.1.1 线格式

新增连接串类型，与 v3 设备链接**并存**（v3 保留为「无法共用中继」的兜底）：

```text
wasmnest://join/<base64url(JSON)>
```

载荷：

```json
{
  "v": 4,
  "room": "nest-7f3a2c91",
  "relay": ["/ip4/203.0.113.9/tcp/4001/p2p/12D3KooW..."],
  "name": "客厅 NAS",
  "relayMeta": {
    "version": 1,
    "peerId": "12D3KooW...",
    "peerIdSha256": "……64 位小写 hex……",
    "accessMode": "open",
    "relayVersion": "0.0.1",
    "controlProtocol": "/wasmnest/relay-control/1",
    "source": "json"
  }
}
```

- `v`：4（未知版本拒绝，不猜语义）。
- `room`：必填；与 `normalize_relay_room` 同判据（`[A-Za-z0-9_-]{1,64}`）。
- `relay`：必填，至少一条；与 `normalize_relay_addrs` 同判据（禁 `/p2p-circuit`、禁未指定地址）。
- `name`：可选，仅用于导入确认页展示；**不参与信任/寻址**。
- `relayMeta`：可选。桌面端从 `net-config.relay-config` 拿到完整配置时带上；
  移动端没有配置中心，通常省略。它只用于「把邀请里的中继写进内网穿透中心」，
  不参与本应用的会合（会合只用 `relay` + `room`）。调用 `relay-adopt` 前，
  接收方把 `invite.relay` 作为 `relayAddrs` 合并进 `relayMeta`，`importedAt`
  留空由中心补；`version` / `source` 缺失时按 `1` / `"json"` 补。
- **载荷不含** nodeId、长期密钥、票据；邀请不是设备配对，导入后仍需首连确认。

`pairingLink.ts` 的新增导出（双端各一份，保持同构）：

```ts
export const JOIN_URI_PREFIX = 'wasmnest://join/'
export type ConnectionInvite = {
  room: string
  relay: string[]
  name: string
  relayMeta?: RelayMeta
}
export type ConnectionInviteResult =
  | { ok: true; invite: ConnectionInvite }
  | { ok: false; reason: 'malformed' | 'missing-room' | 'address-invalid' }
export function buildConnectionInvite(input: ConnectionInvite): string
export function parseConnectionInvite(text: unknown): ConnectionInviteResult
export function isConnectionInvite(text: unknown): boolean
```

`parseRemotePeerLink` 不改 v3 语义；扫码/粘贴入口先试 `parseConnectionInvite`，
失败再试 `parseRemotePeerLink`。

#### 4.1.2 生成

入口：双端「我的设备 → 跨网连接」卡片 + 设备页空态。

1. 读取当前生效 relay：
   - 桌面：`get-my-device` 的 `relayAddrs`（来自中心或缓存）+ `relaySource`；
   - 移动：`get-my-device` 的 `relayAddrs`（本机缓存）。
   - 若为空：不生成邀请，显示「先配置中继」的下一步（打开内网穿透 / 粘贴别人的邀请 / 自建中继）。
2. 空间码：
   - 已有 `relayRoom` → 直接使用；
   - 没有 → 生成 `nest-<8 hex>`（`crypto.getRandomValues` 4 字节），
     通过 `set-settings { relayRoom }` 保存后再生成邀请。
3. `relayMeta`：仅桌面且 `relaySource === 'center'` 时，把
   `net-config.relay-config` 的 `config` 子集放进 `relayMeta`；其他情况省略。
4. 展示：二维码（复用 `qrcode` + `planQrCanvas`，载荷短、模块少）、
   「复制邀请」、「分享」（移动 `navigator.share`）。
5. 二维码/文本**不写日志**（含空间码，按一次性票据同级对待）。

#### 4.1.3 导入

入口：扫码面板、添加远程设备弹层的「粘贴」按钮、状态卡的「粘贴邀请」、
移动端「从剪贴板导入」。

1. 解析 → 校验（版本 / room / relay）。
2. **确认页**（不直接落库）：
   ```
   加入「客厅 NAS」的空间？
   中继：/ip4/203.0.113.9/tcp/4001/p2p/12D3KooW…
   空间码：nest-7f3a…（只显示前 8 位）
   当前空间：3 台设备（加入后将看不到它们）
   [加入] [取消]
   ```
   - 若本机已有不同 `relayRoom`，必须显式确认「离开当前空间」。
   - 若本机 relay 与邀请 relay 不一致，见 4.1.4 的优先级与冲突。
3. 应用：`file-transfer.set-settings { relayAddrs: invite.relay, relayRoom: invite.room, relayOrigin: "invite" }`。
4. 若桌面且 `relayMeta` 存在且中心为空：可选调用
   `net-config.relay-adopt`（P1；见 4.1.4）。失败不阻断本应用会合，只提示
   「全局中继未同步，可到内网穿透中心手动导入」。
5. 成功后：`refresh-devices`；状态卡显示「已加入」；toast；
   不写信任、不自动连接。
6. 失败必须显性：坏码 / 缺 room / 地址非法 / 保存失败分开提示，不静默关闭弹层。

#### 4.1.4 中继来源优先级（关键决策）

当前 `relay_center::resolve` 的语义是「中心明确未配置 = 空，不复活缓存」。
邀请需要在本机（尤其桌面）生效，因此新增来源 `invite`，优先级如下：

| 内网穿透中心  | 本应用缓存             | 生效                | 来源 / 提示                          |
| ------------- | ---------------------- | ------------------- | ------------------------------------ |
| 已配置        | 任意                   | 中心                | `center`；若与邀请不同 → 冲突提示    |
| 明确未配置    | `relayOrigin = invite` | 邀请缓存            | `invite`；允许（邀请是显式用户动作） |
| 明确未配置    | 手动缓存               | 空                  | 保持 T21 语义（不复活旧值）          |
| 不可用 / 超时 | 邀请缓存               | 邀请缓存 + 中心错误 | `invite` + `relayError`              |
| 不可用 / 超时 | 手动缓存               | 缓存 + 中心错误     | `cache` + `relayError`               |

- 新增设置字段 `relay_origin`（`"" | "invite"`）；邀请导入置 `invite`，
  用户手动编辑 relay 地址时清空。
- `relay_center::resolve` 增加一个 `origin` 入参；四种组合各一条单测。
- **冲突**（中心已配置且与邀请不同）：
  - P0：中心优先；确认页显示
    「本机全局中继为 X，邀请使用 Y。自动发现不会工作；请先在「内网穿透」中心切换到 Y，
    或让邀请方使用 X。」提供「打开内网穿透」按钮。
  - P1：增加「仅本应用使用邀请中继」覆盖（`relay_origin = invite` + 中心优先规则
    改为「invite 覆盖中心」）——这会破坏「中心是唯一真源」，需要产品确认后再做。
- 移动端没有中心，邀请直接生效（`invite`）。
- 空间码不受中心影响：邀请的 `room` 总是写入本应用设置。

#### 4.1.5 安全与轮换

- 邀请含空间码（发现隔离键），按**配对秘密**对待：不写日志、不进错误文案全文、
  不落历史记录；二维码仅屏幕展示。
- 邀请**不是授权**：导入只改变发现范围；首连仍需对端确认，信任表仍由宿主维护。
- 轮换：状态卡提供「轮换空间码」；生成新码并提示
  「当前空间内 N 台设备将暂时看不到本机；请把新邀请发给它们」。
  旧邀请导入后仍能进入旧房间，但不会再发现本机——这是预期。
- 空间码泄露的后果 = 同一中继上的发现可见性（PeerId / 展示名 / 在线状态），
  不是文件访问；文案不得暗示「邀请=授权」。

#### 4.1.6 测试

- `buildConnectionInvite` ↔ `parseConnectionInvite` 往返；base64url、UTF-8、
  未知版本、缺字段、非法地址、超长 name。
- v3/v4 共存：扫码文本先判前缀；v3 仍走设备链接；v4 走邀请确认。
- `normalize_relay_room` / `normalize_relay_addrs` 复用核内判据（不复制第二套）。
- 导入后 `set-settings` 载荷包含 `relayOrigin: "invite"`。
- 桌面优先级四组合单测（`relay_center`）。

### 4.2 跨网状态卡（P0-2）

#### 4.2.1 数据来源

| 数据                       | 来源                                           |
| -------------------------- | ---------------------------------------------- |
| 中继地址 / 来源 / 中心错误 | `get-my-device`（已有）                        |
| 空间码                     | `get-my-device.relayRoom`（已有）              |
| 预留状态                   | `get-my-device.relayState`（已有）             |
| 发现状态 / 错误 / 更新时间 | **扩展** `peer:relay-devices` 载荷（见 4.2.2） |
| 空间内设备数               | 同一事件的 `devices.length`                    |
| 本机是否启用会合           | 同一事件的 `status`（`disabled` = 插件未启用） |

#### 4.2.2 宿主事件扩展

`wasmnest-server-peer-net/src/relay_rendezvous.rs` 的 `RelaySnapshot` 增加：

```json
{
  "devices": [],
  "status": "ok | disabled | relay-unavailable | unsupported | denied | error",
  "error": "invalid-request | not-allowed | <detail> | null",
  "relay": "/ip4/.../p2p/...",
  "updatedAtMs": 1730000000000
}
```

- 成功：`status: "ok"`，`error: null`。
- `!current_enabled`：`disabled`。
- `relay_status != relay-reserved`：`relay-unavailable`（带 `relayState` 由前端另行读取）。
- 全部 announce 失败：
  - 错误含 `invalid-request` → `unsupported`（旧中继）；
  - 含 `not-allowed` → `denied`（allowlist 未登记）；
  - 其他 → `error` + 截断的 detail。
- 比较 **整个 envelope**（devices + status + error）决定是否发布；失败时保留
  上一份 devices（`status` 变化要发，设备列表不清空）。
- 保持向后兼容：前端旧解析只读 `devices`，忽略新字段。

前端 `usePeerDevices` 增加：

```ts
const relayDiscovery = ref<{
  status: RelayDiscoveryStatus
  error: string | null
  updatedAtMs: number
  relay: string
  count: number
} | null>(null)
```

`parseRelayDevicesPayload` 保持只返回设备；新增 `parseRelayDiscoveryPayload`
（或让同一个解析函数返回 `{devices, discovery}`）。

#### 4.2.3 状态卡

位置：

- 桌面 `PeerDevicesPanel` 顶部（设备列表之前）；
- 移动 `DevicesTab` 扫描带下方 / 空态之上；
- 「我的设备」弹层保留现有 relay 区块，补充「发现状态」一行。

状态与文案（zh / en 对称）：

| 条件                     | 标题                   | 说明                                     | 主操作                  |
| ------------------------ | ---------------------- | ---------------------------------------- | ----------------------- |
| 无 relay                 | 跨网连接未配置         | 需要一台中继；可以粘贴别人的邀请，或自建 | 粘贴邀请 / 打开内网穿透 |
| `relay-connecting`       | 正在连接中继…          | 首次连接可能需要几秒                     | 查看详情                |
| `relay-lost`             | 中继不可达             | 检查地址 / 网络 / 中继进程               | 重试 / 查看地址         |
| `relay-idle` + 有地址    | 中继未启用             | 检查「允许中继」开关                     | 打开设置                |
| reserved + `unsupported` | 中继不支持自动发现     | 升级中继到 T22 之后的版本                | 查看升级说明            |
| reserved + `denied`      | 中继拒绝了本机         | allowlist 模式需先 enrollment            | 查看中继配置            |
| reserved + `error`       | 发现查询失败           | 显示截断原因                             | 重试                    |
| reserved + `ok` + 0 台   | 已就绪，空间内暂无设备 | 确认对方已打开应用，或空间码一致         | 生成邀请 / 刷新         |
| reserved + `ok` + N 台   | 空间内 N 台设备在线    | 上次更新 X 秒前                          | 发送文件                |
| `room` 为空              | 未设置空间码           | 同一中继上的所有设备互相可见             | 生成空间码              |
| 中心与邀请冲突           | 全局中继与邀请不一致   | 自动发现不会工作                         | 打开内网穿透            |

- 状态卡只展示**一个主操作 + 一个次操作**，避免按钮堆叠。
- `updatedAtMs` 超过 60s 未更新时显示「状态可能过期」并给「刷新」。
- 错误 detail 只展示截断文本（≤120 字符），完整内容进控制台/日志。

#### 4.2.4 测试

- 宿主：成功 / 全部失败 / 旧中继 / 未启用 / 预留丢失 五种 envelope；
  失败时 devices 保留；状态不变不重复发布。
- 前端：状态映射纯函数（输入 envelope + relayState + addrs，输出卡片模型）；
  文案 key 全覆盖；空态/有设备/错误三态渲染。
- 旧宿主（不发新字段）：状态卡降级为「仅显示 relayState」，不报错。

### 4.3 设备行直达发送（P0-3）

#### 4.3.1 交互

设备行新增主操作「发送文件」（纸张/箭头图标）：

- 未连接：点击 → 连接 → 成功后立即弹文件选择器 → 发送；
- 连接中：按钮禁用，meta 显示「连接中…（对方可能需确认）」；
- 已连接：点击 → 设为活跃对端 → 选文件 → 发送；
- 拨号失败：按分类提示（`denied` / `timeout` / `relay-unreachable`…），不弹选择器；
- 非文件传输能力 / 离线宽限行：按钮禁用，给「重试发现」。

移动端：发送成功后切到「传输」页；桌面端：保持当前页，任务面板/状态栏出现新任务。

#### 4.3.2 编排

`FileTransferView` 新增：

```ts
async function handleSendToDevice(nodeId: string): Promise<void> {
  const device = deviceRows.value.find((r) => r.nodeId === nodeId)
  if (!device || !device.fileTransfer || device.relayOffline) return
  if (device.status !== 'connected') {
    const status = await connectDevice(nodeId)
    if (status !== 'connected') {
      // connect 已在行内写入分类错误；这里只给一次 toast / 保持行内提示
      return
    }
  }
  if (!(await switchPeer(nodeId))) return
  const paths = await pickFiles()
  if (paths.length === 0) return
  const result = await sendPaths(paths)
  if (result.error) toast.error(result.error)
}
```

- `connect` 成功后 `ensureActiveFallback` 只在「当前活跃不可用」时切换；
  直达发送必须显式 `switchPeer(nodeId)`，否则可能发给上一个活跃设备。
- 选择文件在连接成功之后：避免「选了文件但连接失败」的浪费。
- 重复点击：`connectingIds` 已防重入；按钮同时禁用。
- 顶栏 `sendToPhone` 保留为「发送到当前设备」的快捷入口；文案改为
  「发送到当前设备」，不再暗示只有手机。

#### 4.3.3 等待确认态

- 拨号期间行内文案：`transfer.devices.connecting` 改为
  「连接中…（对方可能需要在弹窗中确认）」；新增短文案用于窄屏。
- 失败映射：
  - `denied` → 「对方拒绝了连接」；
  - `timeout` → 「对方未响应：请确认对方已打开应用并点允许」；
  - `relay-unreachable` → 「经中继不可达：检查双方中继配置」；
  - `lan-unreachable` → 现有分类 + 「尝试外网」。
- 不做「发起方弹一个等待遮罩」：设备行 + toast 足够，避免阻塞其他操作。

#### 4.3.4 测试

- 已连接 + 非活跃：点击发送 → `set-active-peer` 被调用 → `pick-files` → `enqueue`。
- 未连接：`dial-peer` 成功后再 `pick-files`；失败不调 `pick-files`。
- 拨号中重复点击：只一次 `dial-peer`。
- 选择器取消：不调 `enqueue`，不报错。
- 移动端发送成功后 tab 切到 transfers（组件测试 / E2E）。

### 4.4 最近可见 / 离线宽限（P1-1）

- 常量：`RELAY_OFFLINE_GRACE_MS = 10 * 60_000`。
- `DiscoveredDevice` 增加 `relayOffline?: boolean`、`relaySeenAt?: number`；
  `DeviceRow` 增加 `relayOffline`。
- `mergeRelayDevices`：
  - 快照中的设备：`relayOffline: false`，续期；
  - 快照消失的纯中继设备：不立即移除，标 `relayOffline: true`、
    `relaySeenAt: now`；保留 row；
  - 超过宽限（或用户手动刷新且已过期）再移除；
  - 有 LAN 证据 / paired / connected 的行仍按 T22 的规则保留，`relay` 标记摘掉。
- `sweepStaleDevices`：`relayOffline` 行按 `RELAY_OFFLINE_GRACE_MS` 清扫，
  不按 mDNS 的 120s。
- UI：meta 显示「中继 · 离线（2 分钟前）」；连接按钮禁用；
  提供「重试发现」（触发 `refresh-devices`）。
- 快照落盘：`relayOffline` 行不落盘（重启后由宿主重新 announce）；
  避免把旧 circuit 当地址用。
- 测试：快照消失 → 行保留 + 离线标记；宽限后清扫；重新出现 → 恢复在线；
  已配对行不因中继消失被删。

### 4.5 剪贴板 / 分享（P1-2）

- 双端「添加远程设备」弹层拆两个入口：
  - 「邀请」（v4）：扫码 / 粘贴；
  - 「设备链接」（v3）：现有兜底。
- 状态卡 / 我的设备提供「粘贴邀请」按钮：点击时读剪贴板，解析 v4；
  失败给「剪贴板没有有效邀请」。
- 移动端「分享邀请」用 `navigator.share({ text: invite })`；
  桌面端提供「复制邀请」。
- 可选（P1）：桌面窗口重新获得焦点时，如果剪贴板以 `wasmnest://join/` 开头，
  显示一条非模态提示「检测到邀请，是否加入？」。移动端不做自动读（权限/隐私）。
- 邀请原文不写日志、不持久化到历史。

### 4.6 信任与别名（P1-4）

**确认文案（P0，文案级）**

- 宿主 `respond_peer_consent(accepted=true)` 会写入信任表；弹窗文案改为
  「接受并信任此设备（以后不再询问）」；拒绝按钮保持「拒绝」。
- 如果产品要求「仅本次」，需要宿主契约增加 `trust: bool` 参数（WIT 变更），
  另立票；P0 不做。

**本地别名（P1，app-only）**

- app KV：`peer_aliases` = `{ [nodeId]: alias }`，alias ≤ 32 字符、去控制字符。
- 命令：`file-transfer.get-peer-aliases` / `set-peer-alias` / `clear-peer-alias`
  （或复用 `storage` 直存；建议命令面，便于双端同构）。
- 展示优先级：本地别名 > 宿主 deviceName > 短指纹。
- 设备行菜单：重命名；确认弹窗显示别名（比裸 nodeId 友好）。
- 别名不写入宿主信任表，不跨设备同步；换机后重新命名。

### 4.7 换网即时唤醒（P1-3，宿主）

- 宿主已有 `TunnelManager::on_network_changed`（tunnel/mode）；peer-net 的会合
  需要在同一时机被唤醒：
  - 调用 `ctx.state.rendezvous_wakeup.notify_one()`；
  - 调 `request_discovery_refresh(ctx)`（mDNS 重查 + 连接态重发）；
  - 若 `relay_status` 为 `Lost`，保持引擎的退避重连；不在这里重复 `reserve`。
- 目标：切 Wi-Fi / 蜂窝后 5s 内重新 announce，而不是等 25s 心跳。
- 若宿主换网钩子当前未接到 peer-net（T06 遗留），在平台装配处补一条调用；
  这是宿主/平台改动，不新增 WIT。
- 测试：模拟 `on_network_changed` → 会合任务被唤醒（可用注入的 Notify 观察）。

### 4.8 中继引导 / 默认中继 / 移动后台（P2，产品决策）

**中继引导**

- 状态卡无 relay 时给三条路：
  1. 粘贴邀请（最快）；
  2. 打开「内网穿透」导入（桌面）；
  3. 自建中继（打开部署文本 / 文档）。
- 移动端没有 net-config：提供「粘贴邀请」+「从文本导入 relay」+ 文档链接。

**部署级默认中继（建议，不是官方服务）**

- 新增构建/部署配置 `DEFAULT_RELAY_ADDRS`（空 = 无默认）。
- 状态卡在空配置且存在预设时显示「使用预设中继」一键配置。
- 这样企业/团队可发布带默认中继的安装包，而不需要本仓承诺公共服务。
- 是否提供官方托管中继是商业决策，本文不拍板。

**移动后台**

- 不在本票范围。当前行为必须在 UI 说清楚：
  - 在线设备才可发送；
  - 对方应用不在前台时不会 announce，离线宽限行会显示「对方需打开应用」；
  - 大文件接收建议双方保持前台（后续前台服务票解决）。

## 5. 契约与改动面

### 5.1 P0（app-only + 一个宿主事件增量）

| 落点                                        | 改动                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 双端 `utils/pairingLink.ts`                 | v4 邀请 build/parse；v3 不变                                                                 |
| 双端 `AddRemoteDeviceDialog` / `DevicesTab` | 邀请入口、确认页、粘贴邀请                                                                   |
| 双端 `MyDeviceDialog` / `MyDeviceSheet`     | 「生成邀请」卡（relay + room + QR + copy/share）、轮换空间码                                 |
| 双端 `PeerDevicesPanel` / `DevicesTab`      | 状态卡、设备行「发送文件」、离线 meta                                                        |
| 双端 `usePeerDevices.ts`                    | 邀请导入后的刷新、状态卡数据、离线宽限、直达发送编排                                         |
| 双端 `deviceState.ts`                       | `relayOffline`、宽限清扫、状态卡模型纯函数                                                   |
| `rust/core/settings.rs`                     | `relay_origin` 字段 + 校验                                                                   |
| `rust/plugin/src/peer.rs`                   | `get-my-device` 增 `relayOrigin`；`set-settings` 接收 `relayOrigin`；`relay_center` 优先规则 |
| 宿主 `relay_rendezvous.rs`                  | envelope 增 `status/error/relay/updatedAtMs`；失败保留 devices                               |
| 宿主 `lib.rs`                               | 换网唤醒（P1）                                                                               |

### 5.2 P1（可选，跨应用）

- `file-transfer/desktop/plugin.json` 增加
  `"api": ["com.wasmnest.net-config.relay-adopt"]`；新增消费方 mirror
  `#[plugin_api(manifest = "../../../../servers/net-config/desktop/plugin.json")]`。
- 邀请导入且 `relayMeta` 存在、中心为空时调用 `relay-adopt`；
  中心非空时只提示冲突，不覆盖。
- 若 `relay-adopt` 接受「最小载荷 + Probe 补指纹」，需要 net-config 侧小改；
  否则只支持 `relayMeta` 完整的邀请（桌面生成）。
- **不新增 WIT**；`peer:relay-devices` 是总线 JSON 增量。

### 5.3 不做

- 不改 `peer.wit` / `tunnel.wit`。
- 不改文件传输帧协议 / 加密 / 信任表语义。
- 不把空间码写进宿主信任表；空间码不是授权。

## 6. 验收标准

### 6.1 功能

1. A 生成邀请（自动生成空间码）→ B 扫码/粘贴 → 5s 内双方设备列表出现对方；
   无需手动输入 multiaddr、无需口头对齐空间码。
2. B 已有不同空间：确认页明确「将离开当前空间」；加入后旧空间设备不可见。
3. 旧中继（不支持 announce）：状态卡显示「中继不支持自动发现」，不显示假设备，
   不自动清空已有设备。
4. 中继断开：设备行进入离线宽限；恢复后自动回到在线；宽限后清除。
5. 设备行「发送文件」：未连接时先连后选文件；连接失败不弹选择器；
   已连接但非活跃时先切换再发送。
6. 桌面中心已配置且与邀请不同：明确冲突文案，不静默改用邀请中继。
7. 空间码轮换：旧邀请仍能进旧房间但看不到本机；新邀请可重新发现。
8. 别名：重启后仍在；设备行/确认弹窗显示别名。

### 6.2 UX

- 状态卡在任意状态下都有**一个明确下一步**，没有「什么都没有」的空态。
- 邀请二维码的模块数明显低于 v3 设备链接：**最小邀请**（relay + room + name）
  目标 ≤ 60×60；带 `relayMeta` 的桌面邀请会更大，移动端默认不带 meta。
  以 `qrcode.create` 实测为准。
- 所有错误文案可操作；不出现原始 multiaddr / 堆栈 / 英文内部码作为唯一信息。
- 不改变「接受 = 信任」的既有语义时，文案必须显式说明。

### 6.3 测试

- 新增纯函数/组件测试见各节；双端 `test:run` 全绿。
- 宿主 `cargo test --features relay` 全绿；新增 envelope / 换网唤醒用例。
- 双端 `vue-tsc` / `tsc` 无新增错误；根 lint 0 error。
- E2E：桌面邀请生成 / 粘贴导入 / 状态卡 / 设备行发送（需可用宿主运行时）；
  移动端扫码导入 + 发送后切 tab（真机或 mobile E2E）。
- 手工：两台不同 NAT 设备 + 真实 relay，完成「邀请 → 发现 → 首连确认 → 传文件」。

## 7. 实施顺序

1. **P0-1a**：`ConnectionInvite` v4 编解码 + 双端测试（不碰 UI）。
2. **P0-1b**：`relay_origin` + `relay_center` 优先级 + `set-settings` 往返（Rust + 单测）。
3. **P0-1c**：双端生成/导入 UI + 确认页 + 剪贴板/分享。
4. **P0-2**：宿主 envelope 扩展 + 前端状态卡（先做「旧宿主降级」）。
5. **P0-3**：设备行发送 + 等待确认文案 + 移动 tab 切换。
6. **P1-1**：离线宽限。
7. **P1-2/3/4**：剪贴板自动检测 / 换网唤醒 / 别名。
8. **P2**：默认中继预设、移动后台另行立项。

每步独立可回滚；P0-1 与 P0-2 不应合成一个巨大 diff。

## 8. 风险与开放问题

| #   | 问题                             | 倾向                                                                  |
| --- | -------------------------------- | --------------------------------------------------------------------- |
| 1   | 中心已配置时，邀请是否允许覆盖？ | P0 中心优先 + 冲突提示；P1 再评估「仅本应用」覆盖                     |
| 2   | 邀请是否应一次性/带 TTL？        | 本轮持久空间码；一次性邀请需 relay 侧房间 TTL / 配对握手，另立票      |
| 3   | 默认/托管中继                    | 部署级预设优先；官方服务是商业决策                                    |
| 4   | 移动后台接收                     | 不在本轮；UI 必须显性说明                                             |
| 5   | 邀请里的空间码泄露               | 发现可见性风险，不是文件访问；轮换 + 文案说明                         |
| 6   | `relay-adopt` 最小载荷           | 需要 net-config 接受缺指纹并 probe 填充，或只支持桌面完整 `relayMeta` |
| 7   | 离线宽限期间是否允许拨号         | 不建议；给「重试发现」，避免打陈旧 circuit                            |
| 8   | 别名是否写入宿主信任表           | 不写；app 本地别名，避免跨设备语义漂移                                |

## 9. 实施记录 / 验证

> 实施后填写：提交号、实跑命令与结果、E2E 报告路径、未跑项及原因。

### 2026-11-12 · P0-1 + P0-3（应用仓）

**已落地**

| 切片                 | 落点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1a 邀请编解码     | 双端 `utils/pairingLink.ts`：`buildConnectionInvite` / `parseConnectionInvite` / `isConnectionInvite` / `sameRelaySet`；`wasmnest://join/<base64url>`，未知版本 / 缺空间码 / circuit 目标 / 未指定地址分别拒绝；展示名去控制字符并截断 64；`relayMeta` 缺 peerId / 指纹时整块丢弃                                                                                                                                                                                                      |
| P0-1b 来源优先级     | `rust/core/settings.rs` 新增 `relay_origin` + `normalize_relay_origin`；`relay_center::resolve` 增 `origin`：中心已配置 → 中心；中心为空 + invite → 邀请缓存；中心为空 + 手动缓存 → 空；中心失败 + invite → 邀请缓存 + `relayError`。`get-my-device` / `get-settings` 带 `relayOrigin`；手动改 `relayAddrs` 且未声明来源时清空 origin                                                                                                                                                  |
| P0-1c 生成 / 导入 UI | 双端 `composables/useConnectionInvite.ts`（生成即补空间码 `nest-<8hex>`、轮换、导入 `relayOrigin=invite`、中心冲突判定）；桌面「我的设备」邀请二维码 / 复制 / 轮换；移动「我的设备」邀请文本 / 复制 / 系统分享 / 轮换；双端添加弹层先出确认页（名称 / 中继 / 空间码前缀 / 当前设备数 / 离开空间 / 中心冲突，桌面可跳「内网穿透」）；移动扫码识别 v4                                                                                                                                    |
| P0-3 直达发送        | 双端设备行「发送文件」；`prepareDeviceSend` 纯函数保证「未连接先连、成功才切活跃、失败不弹选择器」；桌面复用 `handleUpload`（含中继提示），移动复用 `uploadFile`（发送成功后切传输页）                                                                                                                                                                                                                                                                                                 |
| P0 文案              | 桌面首连确认改为「接受并信任」+ 信任表提示；连接中文案补「对方可能需要在弹窗中确认」；桌面顶栏改为「发送到当前设备」                                                                                                                                                                                                                                                                                                                                                                   |
| P0-2 状态卡          | 宿主 `RelaySnapshot` 增 `status / error / relay / updatedAtMs`；`disabled / relay-unavailable / unsupported / denied / error / ok` 六态，失败保留上一份 devices，按 `devices+status+error+relay` 去重（不含时间戳）。前端 `parseRelayDiscoveryPayload` + `deriveRelayCard` 纯函数；双端 `useRelayStatus` 读 `get-my-device`（含新增 `relayCacheAddrs`）+ envelope；桌面 `PeerDevicesPanel` / 移动 `DevicesTab` 顶部状态卡（每态一个主操作 + 次操作），旧宿主降级为按 `relayState` 展示 |

**未做 / 偏差**

- **桌面 `relayMeta` 生成未接线**：`net-config.relay-adopt` 属 P1；P0 邀请只带 relay + room。编解码与 `relayMeta` 校验已就绪，后续接线不需要改线格式。
- **升级前置**：状态卡依赖新宿主运行时（`wasmnest-lib` 的 envelope）。已安装的旧宿主只发 `{devices}`，前端按旧宿主降级（不报错）；要看到状态卡需用新 lib 重打并部署宿主运行时与 relay。
- P1（离线宽限 / 别名 / 换网唤醒 / 剪贴板自动检测）与 P2 未做。

**验证（实跑）**

| 命令                                                                           | 结果                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `apps/file-transfer/desktop pnpm run test:run`                                 | 17 files / 153 tests 全绿                                                                       |
| `apps/file-transfer/mobile pnpm run test:run`                                  | 12 files / 102 tests 全绿                                                                       |
| `cargo test --manifest-path apps/file-transfer/rust/core/Cargo.toml`           | 98 passed                                                                                       |
| `cargo test --manifest-path apps/file-transfer/rust/plugin/Cargo.toml`         | 128 passed                                                                                      |
| `cargo test -p wasmnest-server-peer-net --features relay`（lib 仓）            | 332 passed                                                                                      |
| `apps/file-transfer/desktop pnpm run build:rust`                               | wasm + componentize 成功（含新 Rust 字段）                                                      |
| `apps/file-transfer/desktop pnpm run build:frontend` / `mobile pnpm run build` | 成功                                                                                            |
| `pnpm exec vue-tsc --noEmit`（desktop）                                        | 仅既有 `sdk-componentize.test.ts` 缺 `@types/node` 报错（与本票无关）                           |
| `pnpm exec tsc --noEmit`（mobile）                                             | 干净                                                                                            |
| `pnpm run lint`（仓根）                                                        | 0 error / 42 warning（既有）                                                                    |
| E2E / 真机                                                                     | 未跑：宿主运行时版本与 app 期望不一致（既有环境阻塞），跨 NAT 验收还需先重打 relay 与宿主运行时 |

**提交**：P0-1 / P0-3 已随 `b41d9a30`（uat）提交，lib 侧 T22 随 `75e3851`（uat）提交；P0-2 在本提交（应用仓 + lib 仓 `relay_rendezvous` envelope）。
