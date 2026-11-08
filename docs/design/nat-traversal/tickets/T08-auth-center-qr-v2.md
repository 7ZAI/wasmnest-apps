# [feat] T08 · auth-center：QR v2 载荷、配对票据透传与 peerNodeId 配对记录

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06 ｜ **状态**：实施中（2026-11-08 认领：pi 会话；只做**无宿外面依赖**的载荷契约：桌面 v1/v2 组装 + 校验、移动 v1/v2 与连接串解析；同日续作补齐**连接串生产端 + 移动粘贴消费端**闭环。`peer` 数据生产（`host-tunnel.status` / `issue-pairing-ticket`）、配对记录 `peerNodeId`、配对成功信任触发待 T06 落地；并发 CodeBuddy 会话做 T06，无重叠）
- **设计依据**：§4.3、§4.1 规则 2、§5.2

## 需求描述

把现有 `{host, port, token}` QR 升级为 v2：追加 `peer` 字段（nodeId + 多地址 + 一次性传输票据），让移动端扫码即可建立隧道；配对记录保存 peerNodeId，配对成功事件供 bedcode 桌面写入 peer 信任。旧版移动端忽略未知字段仍走 LAN（兼容承诺仅对已支持 link-crypto 的旧客户端成立）。

## 落点 app 与端

`auth-center` / 桌面（载荷生成与配对记录）；`bedcode` 双端消费（生成入口在桌面设置页，解析在移动）。

## 验收条件

- [ ] QR v2 载荷：`{v:2, host, port, token, peer:{nodeId, addrs[], ticket}}`；`host/port` 仅旧版兼容与诊断，不作新版数据入口。
- [ ] `peer.addrs`：同一 peer 节点多地址——LAN 直连地址在前（宿主枚举非虚拟网卡 IP，**不返回 `0.0.0.0`**，多网卡列多条，端口取 `host-tunnel.status` 实际监听端口，不写死 47613）+ relay 地址在后。
- [ ] `ticket` 经 `host-tunnel.issue-pairing-ticket` 签发：绑目标端口、TTL ≤ 120s、一次性、LAN/relay 均可用；票据不落日志。
- [x] 连接串形态 `wasmnest://pair/<base64url(json)>` 与 QR 共用一套解析；不放长期密钥。（2026-11-08 生产端 + 消费端闭环，见实施记录 §5）
- [ ] 配对记录保存 `peerNodeId`；配对成功事件触发 bedcode 桌面写 peer 信任（T07 消费）。
- [x] 旧版 QR（无 `peer` 字段）解析不回归；v2 载荷缺字段时 fail-visible。
- [ ] app `test:run` + `cargo test` + 构建绿。

## 相关契约与锁

- QR token 仍是 128-bit 一次性（`servers/auth-center/desktop/rust/src/pairing/qr.rs`）；token 只走带外，relay 不接触（不变量 13）。
- 6 位码 v1 仅 LAN；远程 rendezvous / PAKE 不在本 ticket（§9.2#5）。
- 与 T07（信任写入）、T09（移动解析与 connect 带票据）接口对齐。

## 实施记录（2026-11-08，认领：pi 会话；只做无宿外面依赖部分）

**边界**：`peer` 的**数据来源**是宿主隧道面（`host-tunnel.status` 的节点/地址、
`issue-pairing-ticket` 签发的票据），属 T06；配对记录 `peerNodeId` 依赖 T03 请求上下文
经 T06 绑定到 SDK。本轮只落地两端**不依赖宿外面**的载荷契约，避免 T06 落地后再返工解析/校验。

### 1. 桌面：QR 载荷组装 v1/v2（`src/utils/pairingPayload.ts`）

- `buildQrPayload(info)`：无 `peer`（当前后端尚未提供）→ 与旧实现**逐字一致**的
  `{host, port, token}`；有完整 `peer` → `{v:2, host, port, token, peer}`。
- `peer` 存在但残缺（缺 `nodeId` / `ticket` / `addrs`）或地址不可拨号（不以 `/` 开头、
  含空白、`/ip4/0.0.0.0`、缺 `/p2p/` 目标）→ 抛 `PairingPayloadError`，**禁止静默退回 v1**
  （静默降级会把配对退回明文 LAN 入口，违反不变量 6/9）。
- `useDeviceCenter`：`QrConnectionInfo.peer?` 承接宿主投影；`generateQr` / `restoreQr` 先验证
  再落状态，失败置 `qrError` 且不启动倒计时；设备页 QR 卡片显示显性错误
  （`data-testid="pairing-qr-error"`），文案双语。

### 2. 移动：解析 v1/v2 + 连接串（`src/host/qr.ts`）

- 载荷：无 `v` / `v:1` 忽略未知字段（`peer` 不参与判定，旧行为不变）；`v:2` 要求 `peer`
  完整且地址可拨号，否则 `incomplete`；其他 `v` → `malformed`（不猜新版本语义）。
- 连接串：`wasmnest://pair/<base64url(json)>` 走同一解析（base64url → UTF-8，非法编码判
  `malformed`）；`peer` 校验口径与桌面组装侧一致。
- `QrPayload.peer?` 只描述传输层（nodeId + addrs + 一次性票据），不含长期密钥；
  现有扫码连接仍用 `host/port/token`，`peer` 由 T09 的 `tunnel.connect` 消费。

### 3. 验证（实跑结果）

| 项 | 结果 |
| --- | --- |
| 新增单测 | 桌面 `pairingPayload` 17 条（13 + 连接串 4 条 T08-6）+ `deviceCenter` 新增 5 条（C5e/C5f/C5g/C5h/C5i）；移动 `qr` 新增 v2/连接串用例（共 45 条）+ `components` 新增 2 条（C-C9 成功 / 坏串） |
| 桌面全量 | 4 shard：220 + 265 + 335（第 1/2/4 片）+ 482（第 3 片已过文件）+ 3（第 3 片剩余 1 文件单跑）= **1305 passed**，0 failed。第 3 片 worker 堆耗尽中断（2 GB 默认堆，属既有环境限制，单独重跑该文件通过） |
| 移动全量 | **55 files / 664 passed**（`--maxWorkers=2`） |
| 根 lint | **0 errors / 44 warnings**（既有基线） |
| 类型检查 | 移动 `vue-tsc --noEmit` **EXIT=0 干净**；桌面 `vue-tsc --noEmit` 仅 1 条既存 `qrcode` 缺声明（T07 已记录，非本轮引入） |
| 前端产物 | 桌面 `build:frontend` 成功（含新文案与连接串代码）；移动 `pnpm run build` 成功（rust release + componentize，产物 562537 bytes） |
| 环境 | 本 worktree 的 `file:` SDK 依赖装成旧副本（桌面缺 `./ui/app-update`、移动无 `dist`）→ 桌面 7 个套件 / 移动 `useHostPage` 相关套件 import 失败。**只改本地 `node_modules`（不入库）**：`pnpm install --offline` 后把桌面 SDK 指到 `.pnpm/…@file+..+..+..+..+..+..*`（含完整导出与 dist），移动 SDK 指到主平台树 `wasmnest/wasmnest-mobile/packages/plugin-sdk-mobile`。未改 `package.json` / lock；仓库里 committed 的 4 个 `../` 是主检出布局，worktree 内解析不到（既有基线问题，归平台侧 link 脚本处理） |

### 4. 未做（归 T06 落地后接）

- `peer` 生产：宿主 `host-tunnel.status`（节点/多地址/监听端口）+ `issue-pairing-ticket`
  （TTL ≤ 120s、一次性、绑端口）经插件后端透传到 `QrConnectionInfo.peer`；
  `peer.addrs` 的「LAN 在前、relay 在后、多网卡、不返回 0.0.0.0」由宿主枚举保证。
- 配对记录 `peerNodeId`（auth-center `PairingRecord` 扩展 + 配对时从请求上下文取已验证
  nodeId）与配对成功事件触发 bedcode 桌面写 peer 信任（T07 消费）。
- v2 载荷的 `peer` 在移动端**只保存不使用**：真正拨号消费（`tunnel.connect` 带票据）
  归 T09。

### 5. 连接串闭环（2026-11-08 续作）

上一轮把连接串生产端留待「有消费方再做」。本轮先落**消费方**（移动手动入口），
再补生产端，避免死代码；两端共用同一解析口径（`parseQrText` / `buildQrPayload` 字段与地址判据一致）。

| 端 | 改动 | 判据 |
| --- | --- | --- |
| 桌面 | `src/utils/pairingPayload.ts` 新增 `PAIR_URI_PREFIX` + `buildPairUri()`（`buildQrPayload` → UTF-8 → base64url 去 padding） | 与 QR **同载荷同校验**：`peer` 残缺/地址不可拨号照样抛 `PairingPayloadError`，不产出半成品 |
| 桌面 | `useDeviceCenter.qrPairUri()` + 设备页「复制连接串」按钮（`data-testid="pairing-qr-copy-link"`，仅 `hasQr` 时在场） | 复制成功 toast `pairing.qr.copyLinkDone`；剪贴板不可用 → `pairing.qr.copyLinkFailed` 显性失败，**不假装成功** |
| 移动 | `DevicesSection.handleConnectManual` 识别 `wasmnest://…` 前缀 → `parseQrText` | 成功：关弹层 → 与扫码**同一个结果卡** → 现成 token 认证路径（不为连接串开明文旁路）；失败：`hub.pairLinkInvalid`，日志只记 `reason` 不落原文（串内含一次性 token） |
| 移动 | `hub.addressPlaceholder` 文案改为「设备地址或连接串」 | 用户可见入口与能力一致 |

**为何不新增旁路**：连接串只是 QR 载荷的另一种编码，token 认证、单次性、TTL 全部沿用
现有扫码路径；`peer` 字段在本轮仍不被消费（T09）。