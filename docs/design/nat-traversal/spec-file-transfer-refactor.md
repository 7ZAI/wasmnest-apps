# file-transfer 内网传输形态改造 spec（穿透配置入设置 · 探索统一发现）

> **状态**：draft（2026-11-15，待评审）
> **前置条件（已落地，不在本 spec 范围）**：自建中转服务器可用；穿透能力链路已通（T12 多地址拨号 / T20 跨网体验 / T21 独立化 / T18 穿透配置中心）。
> **设计真源**：[`../nat-traversal.md`](../nat-traversal.md)（选型与裁定）、[`spec.md`](spec.md)（实施 spec 与不变量）、T18（配置中心）、T20/T21（file-transfer 既有接入）。本文档只定义**本次 UI/形态改造**的范围、契约、落点与验收；机制判据以设计文档为准，不复制。
> **一句话结论**：把「内网穿透配置」从探索面板的「我的设备」迁入双端**设置页**（信息直接来自穿透服务），探索面板退化为**统一发现层**（内网 mDNS + 外网穿透发现，隐藏协议实现），发现设备提供**内网 / 外网**两种连接方式；配置分享以二维码承担，移动端扫码获取或经内网连接同步获取。

---

## 1. 背景与动机

### 1.1 现状（事实，已核对代码）

| 项 | 现状 | 落点 |
| --- | --- | --- |
| 桌面「我的设备」弹层（T21） | 承载本机连接串二维码、relay 状态、外网接入配置；relay 地址真源是 T18 配置中心，弹层**只读**展示；入口在探索面板（设备面板头部） | `apps/file-transfer/desktop/src/components/MyDeviceDialog.vue` |
| 移动「我的设备」底部弹层（T21） | 同构：连接串产出 + 外网接入配置 | `apps/file-transfer/mobile/src/components/MyDeviceSheet.vue` |
| 桌面设置页 | 仅有 T12「中继」开关区块（经 relay 拨号的开关 + 大文件阈值），**无穿透配置区块** | `apps/file-transfer/desktop/src/components/SettingsPanel.vue` |
| 移动设置页 | 同构，仅有 T12 中继开关区块 | `apps/file-transfer/mobile/src/components/SettingsSection.vue` |
| 发现面 | 双端探索面板均为**纯内网 mDNS 发现**（桌面设备面板「探索发现」、移动 DevicesTab 雷达扫描） | `PeerDevicesPanel.vue` / `DevicesTab.vue` / `ScanPanel.vue` |
| 穿透配置中心（T18） | 已落地：relay 配置的跨应用唯一真源，命令面 `net-config.relay.get/save/clear/adopt/probe`、`net-config.wan-policy.get/set`、`net-config.status`；业务应用只读消费 | `servers/net-config/desktop/` |

### 1.2 问题

1. **形态错乱**：穿透配置是「设置类」数据，却寄居探索面板的「我的设备」弹层——发现流里混着配置管理，用户认知与功能分类不一致。
2. **桌面端未直连服务配置**：桌面消费穿透配置要经过「我的设备」中间层，未直接对接穿透服务（T18）的配置面。
3. **移动端获取路径不对称**：移动端只能被动等粘贴/扫码，缺少「内网连接成功后同步获取」的主动路径。
4. **发现只做内网**：外网穿透发现未接入探索面板，用户跨网看不到设备。
5. **连接方式不显式**：发现设备只有单一连接路径，内网 / 外网未在设备条目上提供选择。

## 2. 目标与非目标

**目标**：

- **G1** 探索面板成为**统一发现层**：内网 mDNS 发现与外网穿透发现并行，对用户隐藏协议实现（mDNS 记录、multiaddr、relay 拓扑不默认展示）。
- **G2** 删除探索面板上的「我的设备」（双端），穿透配置迁入**设置页**。
- **G3** 桌面设置页「内网穿透」区块**直接使用穿透服务的配置**（T18 为真源，只读展示），并提供**分享**：生成同一份配置的二维码，供移动端扫描。
- **G4** 移动设置页提供「内网穿透」配置：**扫码获取**（桌面分享的二维码）**或内网连接成功时同步获取**（对端推送）。
- **G5** 发现设备列表提供**内网 / 外网**两种连接方式。

**非目标（v1 明确不做）**：

- 改动穿透协议、中继服务端与既有 T12/T20/T21 命令面（均已落地）。
- P2P 打洞（QUIC/DCUtR，P3，T16）。
- 改动 T12 中继开关的语义（见 §3.2 语义隔离）。
- Windows / macOS relay 包、6 位码远程配对、官方公共 relay。
- 把「添加远程设备」（接收方：扫码/粘贴导入）迁出探索面板——它属于发现流的接收侧，保留。

## 3. 总体设计

### 3.1 三层划分

```text
┌─ 发现层（探索面板）────────────────────────────────────────┐
│ 数据源 A：内网 mDNS 发现（_wasmnest-peer._tcp.local.）      │
│ 数据源 B：外网穿透发现（宿主 peer:relay-devices envelope）   │
│ 输出：统一设备列表，每台设备标注可用连接方式                 │
│ 隐藏：mDNS 记录 / multiaddr / relay 拓扑等实现细节           │
├─ 配置层（设置页 · 双端）────────────────────────────────────┤
│ 内网穿透配置：真源 = T18 穿透配置中心（只读消费）            │
│ 桌面：展示 + 分享（生成配置二维码）                          │
│ 移动：扫码导入 / 内网连接成功后同步获取（来源可溯源）         │
├─ 连接层（设备条目操作）────────────────────────────────────┤
│ 每台设备提供「内网」「外网」连接方式                         │
│ 口径沿用已裁定：内网默认、明确不在内网才切外网；加密固定开启   │
└────────────────────────────────────────────────────────────┘
```

### 3.2 配置与开关的语义隔离（硬约束）

设置页存在两个独立概念，**禁止合并成一个开关**：

| 概念 | 来源 | 语义 | 现状落点 |
| --- | --- | --- | --- |
| 穿透配置 | T18 配置中心（`net-config.relay.get` 等） | 本机接入外网的 relay 地址与策略（**怎么接入**） | 本次新增区块 |
| 中继开关 | T12（`settings.relayEnabled`） | 拨号策略——是否允许经 relay 拨号（**用不用外网通道**） | 既有区块，不动语义 |

两区块同页相邻展示、各有独立文案与测试锚点，避免用户把「配置了 relay」误读为「已开外网」。

### 3.3 配置真源与消费口径

- 穿透配置唯一真源 = T18 配置中心（`servers/net-config`）。客户端（file-transfer 双端）**只读消费 + 分享，不保留第二份编辑器**——配置的写入/导入/探测仍在配置中心页面完成，file-transfer 设置页只展示与传播。
- 中心不可用时：回退本机缓存并**显性提示来源与错误**（沿用 T18 既有口径：不伪造、fail-visible）。
- 配置来源标记贯穿全链路：`center`（中心直读）/ `cache`（本地缓存回退）/ `qr`（扫码导入）/ `sync`（内网同步获取）。设置页展示来源，便于用户判断配置新鲜度。

## 4. 改造项

### 4.1 探索面板：统一发现 + 隐藏实现

**4.1.1 删除「我的设备」入口（G2）**

- 桌面：移除 `MyDeviceDialog.vue` 在设备面板的入口（组件下线或移出探索流）；`useMyDevice.ts` 保留，改造为设置页穿透配置区块的数据源（命令面 `file-transfer.get-my-device` 不变）。
- 移动：移除 `MyDeviceSheet.vue` 在 DevicesTab 的入口，同构改造。
- 「生成方分享」与「接收方导入」分离：分享移至设置页（§4.2/§4.3），接收方「添加远程设备」留在探索面板，双方职责清晰。

**4.1.2 统一发现（G1、G5）**

- 发现数据源合并：
  - 内网：沿用既有 mDNS 发现（双端 `usePeerDevices.ts` / `deviceState.ts` 的 RelayDiscovery 模型扩展）。
  - 外网：消费宿主 `peer:relay-devices` envelope（穿透服务侧的对等设备登记），结合本机穿透配置（§3.3）判定外网可达性。
- 设备条目统一模型：每台设备标注**可用连接方式**——`仅内网` / `仅外网` / `内网+外网`。来源不展示协议细节（mDNS 记录、multiaddr、relay 节点路径折叠进详情或不展示）。
- 移动探索页（DevicesTab + ScanRadar）与桌面设备面板（PeerDevicesPanel）按同一模型渲染；扫描按钮语义从「重新扫描同网节点」扩展为「重新发现（内网+外网）」，文案同步更新。

### 4.2 桌面设置页：内网穿透配置 + 分享（G3）

新增「内网穿透」区块，**信息直接来自穿透服务**：

| 子项 | 口径 |
| --- | --- |
| 配置读取 | `file-transfer.get-my-device`（其 relay 面读穿透配置中心，`relaySource` 区分 center/cache）；中心不可用时后端回退缓存并回传 `relayError`，界面显性展示 |
| 展示 | relay 地址（可复制、默认脱敏）、接入状态（relayState）、WAN 策略、来源标记（center/cache） |
| 分享 | **生成同一份配置的二维码**，置于区块内；扫码方（移动端）在设置页扫码导入（§4.3） |
| 探测 | 复用配置中心 `net-config.relay.probe`（只读连通性探测，不建预留、不开暴露面），结果内联展示 |
| 边界 | 不做配置编辑器；配置导入/编辑仍跳配置中心（跳转通道），本页不复制第二份写面 |

分享入口与既有 T21 连接串的关系：v1 以穿透配置分享为主（含 relay 接入信息）；旧 v3 连接串解析**保留兼容**（已存快照与历史链接不失效，新入口下线后按 fail-visible 提示），不强制迁移，迁移窗口见 §9。

### 4.3 移动设置页：内网穿透配置（G4）

新增「内网穿透」区块，两条获取路径：

1. **扫码获取**：调用既有 `scan/` 扫码栈（`useQrScanLoop` + `zxingDecoder`，与「添加远程设备」同一解码链路）扫描桌面分享的穿透配置二维码 → schema 校验 → 保存，来源标记 `qr`。
2. **内网同步获取**：本机与对端**内网直连成功**后，向对端拉取其穿透配置（命令面新增配置同步用例，见 §7 Rust 落点）；保存来源标记 `sync`。
   - 信任边界：**仅已配对/信任设备**可推送配置，未配对设备一律拒绝（防配置注入）；同步只拉配置快照，不拉长期密钥。
3. 展示与桌面同构：relay 地址、状态、来源标记（qr/sync/center/cache）、同步时间。

### 4.4 发现设备：内网 / 外网连接方式（G5）

- 每台发现设备条目提供**内网**与**外网**两个连接入口，按 §4.1.2 标注的可用方式显隐。
- 连接口径（沿用已裁定，不改动）：
  - 默认**内网优先**：先 mDNS/上次 LAN 地址短超时拨号；
  - **不自动切外网**：同网段不可达、`ECONNREFUSED`、服务未启动、认证失败均不触发自动切换，用户手动点「外网」；
  - 存在 relay 候选且上次走外网时，「外网」可直点（沿用 T20 `lastTransport` 口径）。
- 连接建立后，条目与传输界面展示实际通道（内网直连 / 外网中继），沿用 T20 徽标口径。

## 5. 分享载荷规范

穿透配置分享的二维码载荷（**与设备配对串分离的新载荷，复用其安全判据**）：

```json
{
  "v": 1,
  "kind": "ft-relay-config",
  "relayAddrs": ["<multiaddr/地址，来自穿透配置>"],
  "wanPolicy": "allowed",
  "deviceName": "<展示名，可选>",
  "generatedAt": 1734000000000
}
```

| 判据 | 口径 |
| --- | --- |
| 版本 | `v` 字段版本化，双端同一解析器（复用 `pairingLink.ts` 的解析模式，新增独立载荷类型，不混用） |
| 安全 | 载荷**只含 relay 接入信息，不含长期密钥**；扫码导入不建立设备信任，信任仍走既有配对流程 |
| 时效 | v1 载荷带 `generatedAt`，扫码端展示生成时间供判断；是否强制过期/一次性令牌见 §9 待裁定项 |
| 失败处理 | 载荷不合法、版本不识别、relay 地址为空：显性报错，不静默保存 |

## 6. 关键流程

**F1 桌面配置 → 分享 → 移动扫码导入**

```text
桌面设置页「内网穿透」→ 读取穿透配置（中心/缓存）→ 生成配置二维码
→ 移动端设置页「内网穿透」→ 扫码 → 校验载荷 → 保存（来源=qr）→ 展示
```

**F2 内网连接成功 → 配置同步**

```text
本机 ↔ 对端内网直连成功 → 本机（未持有穿透配置或配置过期时）请求对端配置快照
→ 信任校验（已配对/信任）→ 保存（来源=sync）→ 展示
```

**F3 探索发现 → 内网/外网连接**

```text
探索面板 → mDNS 发现 + 穿透外网发现 → 统一设备列表（标注可用方式）
→ 点「内网」/「外网」→ 按 §4.4 口径拨号 → 通道徽标展示
```

## 7. 改造落点清单

> 路径基准：应用仓根。标注：**新增** / **改造** / **下线**。

**桌面（apps/file-transfer/desktop/src）**

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `components/MyDeviceDialog.vue` | 下线 | 探索面板入口移除；分享功能迁至设置页 |
| `composables/useMyDevice.ts` | 改造 | 数据面保留（get-my-device 读面），服务对象从弹层改为设置页穿透配置区块 |
| `components/SettingsPanel.vue` | 改造 | 新增「内网穿透」区块：配置展示（中心/缓存来源）+ 分享二维码 + 探测结果；与 T12 中继开关区块语义隔离 |
| `composables/useRelayStatus.ts` | 改造 | 状态数据继续服务设置页区块（中心优先 + 缓存兜底口径不变） |
| `composables/usePeerDevices.ts` / `composables/deviceState.ts` | 改造 | 发现合并：mDNS + `peer:relay-devices`；设备条目增加可用连接方式标注（仅内网/仅外网/内网+外网） |
| `components/PeerDevicesPanel.vue` | 改造 | 条目渲染内网/外网连接入口；扫描按钮文案与语义扩展 |
| `utils/pairingLink.ts` | 改造 | 新增穿透配置载荷的生成/解析（`kind: ft-relay-config`）；v3 连接串解析保留兼容 |
| `i18n/` | 新增 | 双端文案（区块标题、来源标签、分享提示、连接方式按钮、错误文案） |

**移动（apps/file-transfer/mobile/src）**

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `components/MyDeviceSheet.vue` | 下线 | 探索面板入口移除 |
| `composables/useMyDevice.ts` | 改造 | 同桌面，服务对象改为设置页区块 |
| `components/SettingsSection.vue` | 改造 | 新增「内网穿透」区块：扫码入口（复用 `scan/` 栈）+ 来源展示 + 同步获取结果 |
| `composables/usePeerDevices.ts` / `composables/deviceState.ts` | 改造 | 同桌面：发现合并 + 连接方式标注 |
| `components/DevicesTab.vue` / `ScanPanel.vue` | 改造 | 条目渲染内网/外网连接入口；雷达页文案扩展 |
| `utils/pairingLink.ts` | 改造 | 同桌面：穿透配置载荷解析 |

**Rust（apps/file-transfer/rust）**

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `core/src/settings.rs` | 改造 | 穿透配置存储模型扩展：来源标记（center/cache/qr/sync）、同步时间；校验与归一化沿用 `normalize_relay_addrs` |
| `plugin/src/peer.rs` | 改造 | 新增配置同步用例（内网连接成功后拉取对端配置快照，仅已配对可推送）；`get-my-device` 读面保持 |
| `plugin/src/relay_center.rs` | 改造 | 穿透配置读写与来源标记贯通（若有独立命令面，按既有命令清单同步注册） |

**E2E（e2e/）**

- 改造 `e2e/specs/file-transfer.spec.ts`、`e2e/dual/`、`e2e/mobile/` 中涉及「我的设备」弹层与探索扫描的用例锚点；新增：设置页穿透配置展示/分享、移动端扫码导入、内网同步获取、设备内网/外网连接方式用例。

## 8. 验收条件

- [ ] 探索面板不再有「我的设备」入口（桌面弹层与移动 sheet 下线），双端构建绿。
- [ ] 桌面设置页「内网穿透」区块：配置信息来自穿透服务（中心可用时来源显示 center；中心不可用时回退缓存并显性提示，不伪造）。
- [ ] 桌面分享生成穿透配置二维码，载荷符合 §5 规范（不含长期密钥）。
- [ ] 移动端设置页扫码导入桌面分享的二维码，保存成功且来源标记 `qr`，配置展示与桌面一致。
- [ ] 内网直连成功场景下，移动端从已配对设备同步获取穿透配置，来源标记 `sync`；未配对设备推送被拒绝。
- [ ] 发现设备列表按「仅内网 / 仅外网 / 内网+外网」标注，每台设备可按标注点「内网」「外网」连接。
- [ ] 连接口径符合已裁定：内网优先、不自动切外网、加密固定开启；连接后通道徽标正确。
- [ ] T12 中继开关语义未变，与穿透配置区块文案互不误导。
- [ ] 双端单测（vitest）+ core/plugin cargo test + 桌面/移动构建绿；E2E 锚点用例通过。

## 9. 风险与待裁定

| # | 项 | 建议口径 | 说明 |
| --- | --- | --- | --- |
| 1 | 分享载荷时效 | v1 仅展示 `generatedAt`，不强制过期/一次性 | 配置本身可在配置中心变更；强制令牌增加配对流程复杂度，P2 再评估 |
| 2 | 配置同步信任边界 | 仅已配对/信任设备可推送 | 防配置注入；未配对一律拒绝并留痕 |
| 3 | 旧 v3 连接串兼容窗口 | 解析保留兼容，不做强制迁移 | 已存快照与历史链接不失效；新分享全部走穿透配置载荷 |
| 4 | 外网发现的隐私 | 默认自建 relay（已裁定）；发现列表不展示 relay 拓扑 | relay 可见连接元数据，界面仅呈现设备与连接方式 |
| 5 | 移动后台发现限制 | 外网发现走前台事件驱动 + 前台扫码 | iOS/Android 后台发现受限，v1 不做后台常驻（与既有裁定一致） |

## 10. 实施记录（2026-11-15）

**已落地**

| 切片 | 落点 |
| --- | --- |
| 载荷 `ft-relay-config` v1 | 双端 `utils/pairingLink.ts`：`buildRelayConfigShare` / `parseRelayConfigShare` / `isRelayConfigShare`；`wasmnest://relay-config/<base64url>`，`{v,kind,relayAddrs,wanPolicy,deviceName,generatedAt}`；`relayAddrs` 沿用 relay 端点判据（禁 circuit / 未指定地址），未知版本 / 缺地址 / 坏策略分别拒绝。**扩展**：`room` 为可选字段（分享方有空间码时一并带走，空则省略 = relay-wide，不覆盖接收方现有空间码）。 |
| 桌面入口下线 | `MyDeviceDialog.vue` 与其测试删除；`PeerDevicesPanel` 移除「我的设备」按钮；状态卡 `share-config` 动作改开设置页。 |
| 桌面设置区块 | 新增 `components/RelayConfigSection.vue` + `utils/relayConfig.ts`：来源 / 状态 / 对外网 / 空间码 / 获取时间；地址默认脱敏、可展开与复制；分享二维码（`buildRelayConfigShare`）；中心不可用时显性展示 `relayError`。`SettingsPanel` 插在 T12 中继开关之前，语义隔离。 |
| 移动入口下线 + 设置区块 | `MyDeviceSheet.vue` 删除；`DevicesTab` 移除两个「我的设备」入口；状态卡分享动作开设置二级页。新增 `components/RelayConfigSection.vue`：只读展示 + 扫码导入（`ScanPanel mode="relay-config"`，复用 `scan/` 栈）+ 导入确认页（替换提示）+ `import-relay-config` 落库。 |
| 设备行连接方式 | 双端 `DeviceRow` 增加 `lanAvailable` / `connectionModes`；设备行标注「内网+外网 / 仅内网 / 仅外网 / 暂无通路」，idle 态改为「内网」「外网」两个入口；`connect` 增加 `lanOnly`（显式内网不被上次外网记录隐式升级），外网入口仍为 relay-only（失败不回退）。 |
| Rust 存储 / 导入 | `core/settings.rs`：`relay_origin` 扩展 `qr` / `sync`，新增 `relay_synced_at`；`relay_center.rs` 来源枚举加 `Qr` / `Sync`；`peer.rs` 新增 `import-relay-config`（只写 relay 地址 / 空间码 / 来源 / 同步时刻，`sync` 必须带 `peerNodeId` 且命中宿主信任表），`get-my-device` 增 `relayOrigin` / `relaySyncedAt` / `wanPolicy`；双端 `plugin.json` 注册命令。 |
| **对端配置同步（第二批，跨三仓）** | 能力仓 `wasmnest-server-peer-net`：`TransferFrame::ConfigRequest/ConfigResponse` + `SharedConfigSnapshot`（16 KiB / JSON 对象校验）+ `set_config_snapshot` / `fetch_shared_config` / `fetch_peer_config`；WIT `host-peer` 增 `set-config-snapshot` / `fetch-config`（23 条原语）。平台仓：`compose-wit` 重新生成双端 SDK 契约；`HostPeer` trait 增两方法（默认 unsupported，旧宿主不静默失败）并在 `WasmHost` 实现。应用仓：`apply_relay_reservation` 顺带发布本机快照（中心不可用且缓存为空时保留旧快照）；新命令 `sync-peer-relay-config`（要求既有会话 + 信任表命中，不隐式拨号；成功写 `sync` 来源并重收敛预留）；移动设置区块增「从已连接设备同步」按钮与逐项 status 文案。 |

**未完成 / 阻塞（显性）**

- **探测结果内联**：`net-config.relay.probe` 未对外开放 `api`（只是本应用命令），文件传输无法跨插件调用；桌面设置区块给「去内网穿透检测」的说明，不复制第二份探测实现。要内联需在 net-config 增加 `api` 声明，另立票。
- E2E 未跑：仓库既有环境阻塞（宿主运行时版本与 app 期望不一致）；本轮未新增 E2E 锚点用例，设备行锚点已改为 `ft-dev-connect-lan` / `ft-dev-connect-wan`（移动 `mobile-dev-connect-lan` / `mobile-dev-connect-wan`）。
