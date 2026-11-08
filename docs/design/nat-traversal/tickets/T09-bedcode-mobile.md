# [feat] T09 · bedcode 移动：tunnel 客户端、本地回环代理接入与模式状态消费

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06、T08、T04 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.5（对移动端的影响）、§4.8、§4.9、§5.2

## 需求描述

bedcode 移动作为拨号方接入穿透：QR v2 / 已配对记录解析出 peer 信息，`tunnel.connect` 建立隧道后把 `127.0.0.1:<localPort>` 当作现有 `address:port`——HTTP/WS/JWT/重连代码几乎不改。新版始终走 tunnel（LAN 直连地址优先，明确不在内网才 relay），不存在「LAN 直连 HTTP 绕过对等面」的第二条路径。

## 落点 app 与端

`bedcode` / 移动（rust + 前端）。

## 验收条件

- [ ] `PrimaryTarget` 增可选 `peer` 信息；持久化改为 nodeId + relayAddrs + deviceName + 最近一次模式与原因（**不再持久化 LAN IP**），重启后重新判定。**现状（2026-11-08）**：持久化已按此形状落地（`PeerTarget`，含逻辑端口、不含 LAN IP）；`PrimaryTarget` 未改（`primary-target` 是宿主投影，应用侧用独立记录表达 peer 身份，见实施记录 §4）。
- [ ] `tunnel.connect({nodeId, port, kind:"http", addrs, pairingTicket?})`：首次配对带票据（来自 QR/连接串），已匹配省略；成功后本地代理地址接入现有 HTTP/WS 代码。**现状（2026-11-08）**：QR v2 / 连接串路径已接入（票据 + 回环代理地址走既有连接编排）；「已匹配省略票据」与历史/mDNS 重连需连接历史带 `nodeId`，见实施记录 §4。
- [x] 模式消费：只读 `host-tunnel.status` + `peer:mode` 事件；Wi-Fi 先 LAN、蜂窝/明确不在内网才 WAN；`lan-unreachable` 显示「内网不可达」+ 手动「尝试外网」入口。（2026-11-08 落地，见实施记录 §1/§2）
- [ ] 链加密：初始化 link-crypto context；本地代理流量**不触发环回跳过**（T04 判据），正常协商；能力不足/协商失败显性失败（`encryption-required`/`encryption-unsupported`），不降级。**现状（2026-11-08）**：错误码映射已就位；宿主侧本无环回跳过逻辑（T04 事实核查），但**测试锁未补**（平台仓面），见实施记录 §4。
- [x] 生命周期：前台建立、离开终端页 `close(handle)`；代理关闭后重连拨号映射为显性 `tunnel-closed`/`peer-offline`，**不对已关闭的 127.0.0.1 端口静默重试**；桌面离线显性 `peer-offline`，不退化成 30s 超时。**偏差**：close 绑在「断开设备 / 插件 deactivate」，不绑终端页退出——会话页、项目页同样消费通道，按页关会让其余页面立刻断（见实施记录 §2）。
- [ ] 被撤销后表现：连接失败显性报安全错误，不自动切 relay 绕过（不变量 9）。**现状（2026-11-08）**：`not-matched` / `peer-offline` 显性映射，本端无任何「失败后自动改拨 relay」路径；撤销级联属 T07/T08 信任面。
- [x] 状态栏：`内网直连`/`外网中继`/`内网不可达`/`外网已关闭`/`离线` + `已加密` 标记；切换轻提示不弹模态。（2026-11-08 落地：八态全映射 + 未识别模式显性「未知」；`已加密` 为不可关闭常量徽标）
- [ ] app `test:run` + `cargo test` + 构建绿；Android dev 目验；`mobile-` 前缀锚点同步。**现状（2026-11-08）**：681 前端单测 / 79 rust 单测 / `pnpm run build` / `vue-tsc` 全绿，锚点已按 `mobile-` 前缀新增；Android dev 目验未跑（环境缺口，见实施记录 §4）。

## 相关契约与锁

- 依赖 T05 `connect` 票据入参、T06 宿主判定与事件、T08 QR v2 解析。
- 平台仓移动测试全量（若动运行面）；真机单端 E2E 在 T10 收口。
- 旧版回退：`host/port` 仅旧版客户端使用；新版不存在明文 LAN HTTP 路径。

## 实施记录（2026-11-08，认领：pi 会话；apps 仓 `.worktrees/wasmnest-apps/nat-traversal`）

**并行分工**：同 worktree 的未提交改动属 T06 第三轮 + T07/T08（device_face / DeviceCenterView / tunnel.rs 桌面侧），本票**只写 `apps/bedcode/mobile/**`**，未碰桌面与文档以外文件。

### 1. 后端（`rust/src/tunnel.rs`，新模块）

- `TunnelHost` 端口 trait（`apply_config` / `dial` / `close_handle` / `read_status` / `read_write_storage` / `emit`）——方法名刻意与 SDK `HostTunnel` 不同名，避免 wasm 构建里 `host.method()` 的 E0034 多候选歧义；native 单测用记录型替身。
- **对端记录** `PeerTarget { nodeId, deviceName, relayAddrs[], port, lastMode, lastReason, updatedAtMs }` 落插件 KV `network.peer-targets`：**只存 relay 候选 + 逻辑端口，不存 LAN IP**（LAN 地址随网络变化，重启后由 mDNS / 新扫码重新给）。损坏输入显性报错（`peer targets corrupted: …`），不静默当「没配置过」。
- **通道配置**：`allowWan`（KV `network.allow-wan`，缺省开）× 「是否有 relay 地址」→ 传给宿主 `configure`。没有 relay 地址时收敛成 LAN-only，而不是把 `allowWan=true` 扔给宿主换一个必然的 `wan-disabled`。
- **拨号**：`connect_via` = 校验入参（nodeId / port≠0 / kind∈{http,tcp} / 至少一条可拨 multiaddr）→ 合并本次候选与记录里的 relay 地址 → 写配置 → `connect` → 读 `status` 记模式。拨号**入参顺序原样交给宿主**（LAN 优先与 §4.9 判据在宿主，不在应用）。
- 拨号失败也把失败模式（如 `lan-unreachable` + `host-unreachable`）落盘：界面据此给「尝试外网」入口。
- **句柄登记**：插件侧再记一份 handle，`deactivate` 走 `close_all_via` 全关——宿主降级/卸载时前端已没有机会发 close，否则回环 listener 会泄漏成孤儿端口。
- **事件**：`activate` 订阅 `peer:mode` / `peer:transport` / `tunnel:state` / `tunnel:error` 四个全局 topic（宿主不重放，晚订阅静默丢），`on_bus_event` 原样转发为 Tauri 事件 `bedcode-tunnel-event`（`{topic, payload}`），并只在 `peer:mode` 时更新记录的最近模式（`atMs` 来自宿主，插件 wasm32 无时钟）。
- 命令面新增 `bedcode.tunnel-connect|tunnel-close|tunnel-status|peer-targets|forget-peer|set-allow-wan`；`plugin.json` 增 `tunnel:connect` 权限与六条命令（构建期 manifest-gen 未回退）。

### 2. 前端

- `src/host/tunnel.ts`（纯函数）：八态模式→文案、归因→文案、色调、`shouldOfferManualWan`（`lan-unreachable` + `allowWan` + 已配置 relay 三条件）、`peer:mode` 事件解析与并入快照、宿主错误码→文案（未识别码返回 `null` 由调用方原样展示）、QR `peer`→拨号入参、`connect` 回执归一（缺 handle/address/port 直接抛，不生成 `127.0.0.1:undefined`）。
- `useHostPage`：`tunnelStatus` / `tunnelHandle` / `tunnelNodeId` 状态，`openTunnel`（QR v2）、`tryWan`（relay-only 重拨，用户意图即判据）、`closeTunnel`（先关通道）、`refreshTunnelStatus`、`setAllowWan`、`forgetPeer`；订阅 `bedcode-tunnel-event`。
- `DevicesSection`：扫码路径先建隧道再连回环代理（旧版无 `peer` 载荷保持原 LAN 直连，不回归）；已连接卡片与失败态各有状态栏（模式 + 常量「已加密」徽标 + 外网关闭提示 + 手动「尝试外网」）；`confirmDisconnect` 与扫码失败路径**先关通道再断 WS**（反序会让宿主自动重连去拨已关闭的回环端口）。
- i18n 双语新增 40 条（模式 / 归因 / 错误 / 加密徽标 / 手动入口）。
- 新锚点：`mobile-tunnel-status`（失败态）/ `mobile-tunnel-mode` / `mobile-tunnel-encryption` / `mobile-tunnel-wan-off` / `mobile-tunnel-try-wan`；已连接态同义 `-connected` 后缀，避免选择器歧义。

### 3. 验证（实跑）

- `pnpm run test:run`：56 files / **681 passed**（基线 664 + 17 条新增 `src/host/__tests__/tunnel.test.ts`）。
- `cargo test --lib`：**79 passed**（基线 57 + 22 条 `tunnel` 单测：可拨判据 / 候选归一去重 / relay 拆分 / 配置决策 / 记录损坏显性 / upsert 上限 / 拨号入参校验 / 失败仍记模式 / allowWan 开关 / 状态视图 / 事件转发与落盘 / 句柄全关）。
- `cargo check --lib --features wasm --target wasm32-unknown-unknown`：绿（仅 SDK 与 keys.rs 既有 warning）。
- `pnpm exec vue-tsc --noEmit`：干净。
- `pnpm run build`：绿（前端 + wasm 650,698 bytes + componentize）。
- 根 `pnpm run lint`：**0 error / 44 warning（既有基线）**。

### 4. 未做 / 未验证（显性）

- **已匹配省略票据 / 非扫码重连**：历史记录与 mDNS 发现仍按 `address:port` 直连 LAN，未接 `tunnel.connect`——历史条目里没有 `nodeId`，需要先给连接历史加 nodeId 字段（应用侧数据结构变更，另开切片）。因此「新版始终走 tunnel」目前只覆盖 QR v2 / 连接串路径。
- `PrimaryTarget` 未加 `peer` 字段：host `primary-target` 是宿主投影，应用侧以独立对端记录表达 peer 身份（改写宿主契约会越线）；语义等价的部分已落地。
- **移动侧链加密测试锁未补**：核对平台仓移动宿主当前无「按目标环回跳过链加密」逻辑（T04 事实核查），回环代理流量本就正常协商，故不变量 15 由既有实现保证；把锁写进平台仓属 T04/T06 面，未在本票代做。
- **Android dev / 真机目验未跑**：本机无设备/APK 环境；`node scripts/e2e-mobile.mjs --app bedcode` 与双端 E2E 仍被 `host-runtime.lock.json` 的 `artifacts` 为空阻塞（既有环境缺口）。
- 「撤销后显性安全错误」只到错误码映射层（`not-matched` / `peer-offline`），撤销级联本身归 T07/T08 的信任面。
