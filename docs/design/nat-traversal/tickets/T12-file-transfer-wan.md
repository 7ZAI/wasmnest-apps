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