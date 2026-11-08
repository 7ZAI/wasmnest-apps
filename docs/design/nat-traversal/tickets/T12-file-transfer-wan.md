# [feat] T12 · file-transfer：远程设备连接串、多地址拨号、中继状态与固定加密

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P2 ｜ **依赖**：T11、T06 ｜ **状态**：实施中（2026-11-08 认领：pi 会话；只做**无 T11/T06 依赖**的「加密固定开启」子项（不变量 12）。连接串导入 / 多地址拨号 / relay 状态与限额 / 按 nodeId 持久化依赖 T11/T06，未动；并发 CodeBuddy 会话在做 T08，文件无重叠）
- **设计依据**：§4.6、§4.9、§4.10、§5.2、不变量 9/12
- **默认执行口径（待裁定项按设计默认）**：§9.2#3 同网段不可达不自动切；#4 大文件无阈值、经 relay 一次提示；#7 前台接收（不做后台常驻）

## 需求描述

file-transfer 跨 NAT：远程设备连接串/QR 导入、多地址拨号（内网默认）、中继传输状态与限额；**应用层加密固定开启**（WAN/LAN 都强制，移除关闭项）。传输帧协议、断点续传、暂停/恢复、并发闸门全部复用现有实现。

## 落点 app 与端

`file-transfer` / 双端（共用 wasm + 双端前端）。

## 验收条件

- [ ] 远程设备连接串 `wasmnest://pair/<base64url(json)>` / 纯 JSON：桌面「添加远程设备」、移动「扫码或粘贴」共用解析；只放 nodeId + addrs + 一次性票据，不放长期密钥。
- [ ] 拨号策略：mDNS/上次 LAN 地址先试（2-3s 短超时）；只有 §4.9 明确判据才 `dial-peer-addrs` 走 relay；同网段不可达显示「设备离线/服务未启动」，不自动烧中继。
- [ ] `PeerLink.transport` 记录 lan/wan；状态栏 `内网直连`/`外网中继`/`内网不可达`/`已暂停`。
- [ ] **加密固定 `true`**：`settings.rs:35,51` 默认改 `true` 并移除关闭项；UI 显示「始终加密」而非可切换项；WAN/LAN 批次都强制；旧对端不支持显性失败（不变量 12）。
- [ ] `allowWan`（默认开，可关；关闭 ≠ 关闭加密）与 `relayMaxBytesPerTask` 设置项；大文件经 relay 给一次「可能较慢」提示，可取消（不改变模式判定）。
- [ ] relay 配额断开 circuit → 断点续传重新拨号建新 circuit 继续（预期行为，非错误）。
- [ ] 已配对设备按 nodeId 持久化 `{deviceName, relayAddrs[], lastSeen}`；地址变化由应用更新。
- [ ] 双端 `test:run`（移动无 vitest 则按现状说明）+ `cargo test` + 双端构建绿；真实环境目验。

## 相关契约与锁

- 依赖 T11 `dial-peer-addrs`；T06 模式事件与 `allowWan` 门控。
- 加密吞吐影响需实测（§9.1 风险 10），结果记入 T15 验收。
- 撤销设备 → peer 信任同步撤销（不变量 7，consent 写入同一份信任列表）。
- i18n / 锚点 / `docs/verification/file-transfer.md` 同步（T15 收口）。

## 实施记录（2026-11-08，认领：pi 会话；只做固定加密子项）

**边界**：T12 其余验收（连接串 / `dial-peer-addrs` / relay 状态与限额 / nodeId 持久化）
依赖 T11（能力仓）与 T06（宿主隧道面），本轮未动。固定加密是**不变量 12 的安全红线**、
与穿透拨号面无关，且 P1 应用侧无剩余可并行工作（T08 由 CodeBuddy 会话接续），故前置落地此项；
按 spec §5 的 P2 排序，T12 整体仍需待 P1 验收。

### 1. Rust（双端共享核 + 插件）

| 文件 | 改动 |
| --- | --- |
| `rust/core/src/settings.rs` | `TransferSettings::encryption` 缺省（`Default` + `serde(default)`）改 `true`；`load()` 把旧库存量 `false` **读取即收紧**；`save_and_push()` 强制只落 `true`（任何写入口无法留下明文开关）；新增 `validate_encryption_patch()`（缺省/`true` 放行，`false` / 非布尔显性报错） |
| `rust/plugin/src/peer.rs` | `set-settings` 不再接受 `encryption:false`：改走 `validate_encryption_patch()`，旧调用点显性拿到 `encryption cannot be disabled (required)`，不静默改写 |

**判据（无明文回退）**：发送帧的 `encrypt` 取 `settings_store::load_or_migrate()` 的返回值；读面收紧
后，即使存储被旧版本写成 `false` 或调用方直写 `save_and_push(false)`，发送侧仍只会拿到 `true`。

### 2. 桌面 / 移动前端

- 双端设置页的「开/关」分段控件退役为只读徽标（`data-testid="ft-encryption-required"`，文案「始终加密」）；
  关闭入口（`setEncryption`）从 composable 与面板事件面删除，旧回执里的 `encryption:false` 不采信。
- i18n：删 `encryptionOn` / `encryptionOff`，增 `encryptionAlwaysOn`（双语）；桌面安全告知由「局域网明文传输」
  改为「始终端到端加密 + 旧对端显性失败」（同一 `ft-settings-warning` 锚点，文案语义更新）。
- E2E（`e2e/specs/file-transfer.spec.ts`）：断言只读徽标可见 + `ft-encryption-true` / `ft-encryption-false` 均不存在。

### 3. 验证（实跑结果）

| 项 | 结果 |
| --- | --- |
| core `cargo test --lib` | **76 passed**（新增 4 条：缺省 true / 存量收紧 / 写入不落 false / 补丁校验） |
| plugin `cargo test --lib` | **93 passed**（临时把 SDK path 指向主平台树以避开旧副本签名漂移，跑完已还原 Cargo.toml） |
| file-transfer desktop `test:run` | **8 files / 43 passed**（含新增 `settingsEncryption` 3 条；为使 `preview.test.ts` 可解析，验证期把本 app 的 SDK `file:` 临时指到主平台树，跑完已还原 package.json / lock） |
| 根 lint | **0 errors / 44 warnings**（既有基线） |
| 类型检查 | desktop `vue-tsc` 仅 3 条既存 `node:fs` 缺 `@types/node`（`sdk-componentize.test.ts`，非本改动）；移动无 `vue-tsc` / `test:run` 脚本，未可跑 |
| 构建 | `pnpm run build` 成功（前端 + wasm32-unknown-unknown + componentize；产物 `.build/plugins/com.wasmnest.file-transfer`，wasm 1,075,293 bytes，已注入 wasmHash）；验证期临时修正 SDK path，跑完已还原 Cargo.toml |
| 目验 / E2E | **未跑**：`host-runtime.lock.json` 的 `artifacts` 为空 + 缺 tauri-driver/WebKitWebDriver（既有阻塞）；E2E 用例已按锚点纪律更新（只读徽标 + 无开关断言） |

### 4. 未做（T11/T06 落地后接）

- 连接串/QR 导入与「添加远程设备」、多地址拨号与 §4.9 模式判定、`allowWan` / `relayMaxBytesPerTask`、
  按 nodeId 持久化与地址刷新、relay 提示与断点续传跨 circuit、真实环境目验与 T15 验收。
## 实施记录（2026-11-08 第二轮，认领：pi 会话；剩余应用侧主体）

**边界**：本轮只改 `apps/file-transfer/**` 与 file-transfer 文档；**未碰**同 worktree 并行
会话在途的 bedcode 桌面（T07/T08）与 `spec.md` / T06–T08 ticket（避免撞车）。平台仓仅有
并行会话未提交的 SDK 增量（`peer_trust_node`，T07 信任写入），本轮为保持编译通过的
测试替身补了该方法的桩，未在 file-transfer 业务面使用。

### 1. 后端（共享核 + 插件）

| 文件 | 改动 |
| --- | --- |
| `rust/core/src/dial.rs`（新） | 拨号候选纯函数：LAN 候选（`/ip4\|ip6/<addr>/tcp/<port>`）永远在前；relay（`/p2p-circuit`）仅在 ① 用户显式「尝试外网」② 无 LAN 候选 ③ 上次拨号已走 relay 时纳入；`allowWan=false` 时永不纳入且只剩 relay 时**显性报错**（点名字闸门），不静默降级；去重保序 |
| `rust/core/src/domain.rs` | `DialEndpoint` 增 `addrs`（配对多地址，`serde(default)`）与 `wan`（上次拨号是否纳入 relay，供重连沿用）；`addr/port` 改为可缺省（配对端点只有 `addrs`）。`DeviceSnapshotEntry` 增 `addrs` + `paired`（旧快照缺字段按空/false 解析） |
| `rust/core/src/settings.rs` | `allowWan`（缺省 true）与 `relayMaxBytesPerTask`（字节，0 = 每次提示）；`load()` 对旧库缺字段按缺省；`save_and_push` 原样持久化（与加密正交，写入面仍强制 `encryption=true`） |
| `rust/plugin/src/peer.rs` | 拨号统一经 `dial_with_plan`：单地址 LAN 端点仍走旧 `dial-peer`（不外泄内部字段），多地址/relay 走 `dial-peer-addrs`；`dial_peer` 收 `wan:true`（手动入口）；成功后 memo 记 `wan` 以便断线重连沿用同路径；`get/set-settings` 暴露并校验两个新字段（非布尔/非整数显性报错）；`preview-outgoing` 命令汇总宿主 `collect-outgoing` 元数据供中继提示阈值判定 |
| `plugin.json`（双端） | 新增 `file-transfer.preview-outgoing` 命令声明 |

### 2. 前端（双端同构）

- `utils/pairingLink.ts`（新，双端各一份、同判据）：解析 `wasmnest://pair/<base64url>` / 纯 JSON（QR v2 `peer` 包装与扁平形态），校验 64 位 hex `nodeId`、至少一个可拨号 multiaddr；坏连接串 / 字段缺失 / 地址不可拨号三种原因分开（不静默失败）。ticket 只回传、不落盘。
- `deviceState.ts`（双端同步）：`DiscoveredDevice` 增 `addrs` / `paired`；`DeviceRow` 增 `transport`（宿主 `peer:connection.transport` → lan-direct / wan-relay）与 `wanAvailable`；配对设备不参与 TTL 清扫。
- `usePeerDevices.ts`（双端）：记录/清除 transport；`connect(nodeId, { wan })` 带 `addrs` 与显式 `wan`；新增 `addRemotePeer`（同 nodeId 合并候选去重、不覆盖已有名）与 `removeRemotePeer`；快照读写带 `addrs` / `paired`；**配对设备例外**：快照恢复的远程设备可直接拨号（发现条目仍受 restored 防线约束）。
- 桌面：`PeerDevicesPanel.vue` 增「添加远程设备」入口、「远程」标签、传输形态徽标、「尝试外网」与「移除」；新增 `AddRemoteDeviceDialog.vue`（粘贴连接串，按原因显示可操作文案）；`SettingsPanel.vue` 增「中继（外网）」开关与提示阈值（MB，0 = 每次）；`FileTransferView.vue` 发送前按阈值弹一次可取消的中继提示（`preview-outgoing` 判定，预览失败按无阈值口径提示）。
- 移动：`DevicesTab.vue` 同等能力（内联粘贴面板，无摄像头扫码）；`SettingsSection.vue` 同设置项；`FileTransferView.vue` 上传前用宿主 `showConfirm` 做同口径提示。
- i18n 双语 + `messages.ts` key 类型同步；新增锚点：`ft-remote-add` / `ft-remote-add-input` / `ft-remote-add-confirm` / `ft-remote-add-error` / `ft-dev-remote-tag` / `ft-dev-transport` / `ft-dev-try-wan` / `ft-relay-on|off` / `ft-relay-threshold-input`；移动 `mobile-remote-*` / `mobile-dev-transport` / `mobile-dev-try-wan`。

### 3. 验证（实跑）

| 项 | 结果 |
| --- | --- |
| core `cargo test --lib` | **86 passed**（+10：候选计划 8 条 + 设置 2 条） |
| plugin `cargo test --lib` | **98 passed**（+5：多地址/relay 门禁/旧原语兼容/体积预览） |
| 插件 wasm 目标 | `cargo check --target wasm32-unknown-unknown --no-features=wasm --release` 绿 |
| 桌面 `test:run` | **10 files / 59 passed**（+9：连接串解析 7、远程设备与拨号载荷 5、传输形态/清扫 3） |
| 桌面 `vue-tsc --noEmit` | 仅既存 SDK `dist` 缺失（`@binblink/wasmnest-plugin-sdk-desktop` 无法解析）与 `node:fs` 类型缺口，无新增错误 |
| 根 lint | **0 errors / 44 warnings**（既有基线） |
| 桌面 `pnpm run build` | 绿（wasm 1,113,553 bytes + componentize + 注入 wasmHash） |
| 移动构建 | Rust wasm 目标编译绿（`cargo check`）；`pnpm run build` 在 **frontend-only** 阶段失败——SDK JS `dist/vite-plugin.js` 缺失（既有环境缺口，非本改动）；移动 `tsc --noEmit` 仅 SDK dist 解析错误 |
| 目验 / E2E | **未跑**：`host-runtime.lock.json` 的 `artifacts` 为空（既有阻塞）；`docs/verification/file-transfer.md` 已补 F-15 场景与已知缺口 |

### 4. 未做 / 依赖外部

- **扫码**：已补（2026-11-08 追加切片，移动端）：新增 `components/ScanPanel.vue` + `html5-qrcode@2.3.8`
  依赖，扫码结果与粘贴走同一 `parseRemotePeerLink`；非法码继续扫、不落二维码原文；
  相机失败 / 无权限分开提示（无权限给系统设置出路）；桌面端仍只有粘贴（无摄像头）。
- **扫码验证边界**：本 worktree 移动 `pnpm run build` 的 frontend-only 阶段仍被 SDK JS `dist`
  缺失阻塞，未做相机实机目验；静态校验用临时 tsconfig（paths 指向 SDK `src`）跑
  `vue-tsc --noEmit` 全绿（临时文件已删，未入库）。
- **中继接收端预留**：应用侧只能把 relay circuit 加入拨号候选；对端 peer 节点建立 relay 预留仍需宿主 `peer-node-config` relay 面（T02/T06 未落地）。跨 NAT **双向接收**因此仍受宿主能力限制，应用侧按「拨号失败可见」呈现。
- 真实跨网验收（真机蜂窝 ↔ 家庭宽带）与 1GB 中继传输归 T15。
- `allowWan` / `relayMaxBytesPerTask` 的**产品语义**按默认口径实现：`allowWan` 只控制拨号候选（与加密正交）；`relayMaxBytesPerTask` 是「提示阈值」而非硬限额（0 = 每次经中继发送都提示），真正的中继字节/时长配额在 relay 服务端（T13）。
