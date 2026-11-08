# [feat] T07 · bedcode 桌面：隧道 expose、固定 `required` 加密、配对信任与撤销级联

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06、T08（接口对齐，可并行开发）｜ **状态**：实施中（2026-11-08 三轮：① pi 会话做 link-crypto 固定 `required` + §0.4 锁复核；② expose / 通道配置 / 状态 UI；③ 配对信任写入 + 撤销级联 + **旧客户端 `encryption-unsupported` 宿主侧拒绝判定**。**仍未做**：真宿主 E2E（`host-runtime.lock.json` 的 `artifacts` 仍为空）、移动端逐字文案区分）
- **设计依据**：§4.1、§4.5、§4.10、§5.2、§0.4、不变量 7/12/16

## 需求描述

bedcode 桌面作为被访问方接入穿透：经对等面暴露服务（禁止裸转发 8765）、链加密固定 `required` 不可关闭、配对成功写入 peer 信任、撤销级联，并按 §0.4 裁定锁定三条免凭证路由的可达性。

## 落点 app 与端

`bedcode` / 桌面（rust + 前端设置页）。

## 验收条件

- [x] `host-tunnel.expose({ port: 8765, kind: "http", ... })`（逻辑端口，后端恒为对等面）；`allowWan` 由应用 KV `network.relay` 是否有中继地址推出，经 `configure` 交给宿主引用计数。（2026-11-08 本轮落地，见实施记录 §6；端口取宿主实际运行端口，不写死 8765）
- [x] **link-crypto 固定 `required`**：`useLinkCrypto.ts` 移除 off/preferred 选择，设置页改只读「强制加密」；配置层拒绝关闭；缺链路身份拒绝并提示修复（不变量 12/14）。（2026-11-08 落地，见实施记录）
- [x] 配对成功且 JWT 签发后，用 peer face 传来的**已验证** `peerNodeId` 写 peer 信任列表（不信任客户端自报值）；auth-center 配对记录保存该 nodeId（供 `allowedPeers` 与撤销）。**（2026-11-08 T08 §7：`host-peer.trust-node` 唯一写入原语；auth-center `_http_endpoint` 只采信宿主注入的 `caller=peer` 上下文，配对记录新增 `peer_node_id` 列；`verify` / `qr-connect` 成功后写信任（记录或信任失败均显性中止））**
- [x] 解配对/撤销设备同时 `host-peer.revoke-trusted`（不变量 7）；隧道 ACL 立即生效。**（撤销按记录 `peer_node_id` 级联 `revoke-trusted`；已软删记录重复撤销也重放级联（防「UI 幂等成功、隧道仍匹配」））**
- [x] **§0.4 测试锁**：`task-status`/`session-mode`/`terminal-bg` 经 peer face 仅对已匹配 peer 可达（匹配校验在隧道层）；run-* 四条对 `peer` 一律 403（不变量 3/16）。**（`rust/src/run/bridge/mod.rs::bridge_caller_gate_accepts_only_loopback_tier` 断言 `caller_allowed("peer") == false`；`rust/src/task/mod.rs` 的 `caller_allowed_for_none_auth` 逐条锁 `task-status` / `session-mode` 放行 `CALLER_PEER`、拒 `device` / `anonymous` / 空值；「仅已匹配」由隧道准入（未匹配一律 `not-matched`）承担）**
- [x] 状态 UI（**本轮范围 = 传输模式 + 加密常量徽标**）：设备页显示 `内网直连 / 外网中继 / 隧道就绪 / 内网不可达 / 外网不可用 / 外网已关闭 / 离线 / 隧道不可用` + 「已加密」（不可关闭）；失败原因进 `title`。（relay 延迟不在宿主 `status` 投影内，未伪造；§7.1 词表的逐字文案归 T10 复核）
- [x] 旧客户端不支持 link-crypto → 显性 `encryption-unsupported` + 升级提示，无明文回退。（2026-11-08 §8：宿主侧判定落在能力仓 `link_crypto` / `http_filter` / WS 升级门禁，平台移动宿主把码透给应用；移动端**逐字文案**区分归 T09）
- [ ] app `test:run` + 根 lint + `cargo test` + wasm 目标构建绿；真实宿主目验；交互面改动同步 `data-testid` 锚点。**（已验证：前端全量单测 / `cargo test` / `build:frontend` / `wasm32-wasip3` 构建 / 根 lint 0 error；锚点 `pairing-tunnel-status` / `pairing-tunnel-encryption` / `pairing-qr-copy-link` 已同步；**真实宿主目验未跑**：`host-runtime.lock.json` 的 `artifacts` 为空，`e2e.mjs` packed 形态无宿主可装）**

## 相关契约与锁

- 依赖 T05 的 `host-tunnel` 绑定与 T03 的 `peerNodeId`/pairing 请求上下文。
- `hostAppBoundaryLock`：不动 `entry.ts` 边界；若动则平台桌面测试全量。
- i18n / E2E 锚点 / `docs/verification/bedcode.md` 同步（T10 收口）。
- §0.4 裁定用户可否决；否决则本 ticket 与 T05 返工。
## 实施记录（2026-11-08，认领：pi 会话；只做无宿外面依赖部分）

**边界**：T07 的 expose / 配对信任写入 / 撤销级联 / 状态 UI 都以 `host-tunnel` 宿主面为前提，归 T06（并发 CodeBuddy 会话正在能力仓/平台仓实施 T06，本会话不碰）。本轮落地**不依赖宿外面且属安全红线**的部分：link-crypto 固定 `required`（不变量 12/14）+ §0.4 锁复核。

### 1. link-crypto 固定 `required`

| 文件 | 改动 |
| --- | --- |
| `src/composables/useLinkCrypto.ts` | 导出 `FORCED_ENCRYPTION_POLICY = 'required'`；唯一写入口 `enforce()` **无入参**（调用点拿不到写 off/preferred 的能力）；`load()` 拉能力 + 当前策略后，在可强制时**自动收紧**；新增 `enforced` / `blockReason`（`identity-missing` / `ws-unsupported`）/ `lastError` 显性状态 |
| `src/components/LinkCryptoSettingsSection.vue` | 三档选择器退役 → 只读状态徽标（`data-testid="link-crypto-policy"` + `data-policy` / `data-enforced`）；三种显性状态：旧宿主不可用 / 无法强制（不写库、不宣称已加密）/ 修复入口（`link-crypto-enforce` + `link-crypto-error`）；指纹行保留 |
| `src/i18n/{messages,zh-CN,en}.ts` | 删 `policyOff/policyPreferred/policyRequired/offHint/preferredHint/saved/saveFailed/wsNotEncrypted`；新增 `forced/forcedPending/currentOff/currentPreferred/repairNeeded/enforce/enforced/enforceFailed/blockedIdentityMissing/blockedWsUnsupported`（双语同步） |
| `src/entry.ts` | **仅注释**：策略固定 required（L3 锁剔除注释；平台 `hostAppBoundaryLock` 实跑验证） |
| `e2e/specs/bedcode.spec.ts` | 新增结构用例：三档按钮一律不存在 + 徽标带 `data-enforced`（不依赖机器状态/语言） |

**判据（不静默降级）**

- 宿主记录 `off` / `preferred`（旧版本遗留）→ 加载即写 `required`；写失败保留「未生效」与 `lastError`，不显示已生效假象。
- 身份未初始化（`identityFingerprint = null`）→ **不写库**：写 `required` 会把全部非本机对端拒掉；界面给修复路径。
- 旧宿主 `wsSession=false` → 同样不写、不宣称：强制档覆盖不到 WS 端点（WS 仍明文）。
- 旧宿主无 `appScopedPolicy` / 无 own-token 方法 → `supported=false`，显性提示升级。
- 未知策略字面量按 `off` 归一后收紧（不把脏值粉饰成已加密）。

### 2. §0.4 锁复核（不新增重复锁）

`task-status` / `session-mode` 的 peer 可达与 run-* 对 `peer` 403 已由 T17 的 `task::tests::none_auth_endpoints_gate_by_caller` + `run::bridge::caller_allowed` 覆盖；`terminal-bg` 为宿主静态路由（残余风险与跟进见 T17）。本轮未重复造锁，T07 该项待 T10 真机跨网复核。

### 3. 验证（实跑结果）

| 项 | 结果 |
| --- | --- |
| 新增/改写单测 | `useLinkCrypto` 10 + `linkCryptoSettingsSection` 7 = **17 passed** |
| 关联测试 | `plugin-contract` 26 / `i18n` 4 / `i18nPrefixDiscipline` 6 / `SettingsView` 3 全绿（53 passed） |
| 全量 app 单测 | 3 shard：291 + 329 + 663 = **1283 passed**（每 shard `--maxWorkers=1` 避免 OOM） |
| 根 lint | `pnpm run lint`：**0 errors / 44 warnings**（既有基线） |
| 前端产物构建 | `pnpm run build:frontend` 成功（`dist/index.js` 2.73 MB）；产物含新文案、无 `linkCrypto.policyOff` |
| 平台桌面锁 | `hostAppBoundaryLock` **7 passed**（主平台仓执行，`WASMNEST_APPS_ROOT` 指向本 worktree） |
| E2E | **未跑（既有环境阻塞）**：`host-runtime.lock.json` 的 `artifacts` 为空 + 缺 tauri-driver/WebKitWebDriver；用例已按锚点纪律补入 `e2e/specs/bedcode.spec.ts` |

### 4. 当时未做（已在 §5 续作接掉，保留历史记录）

- `host-tunnel.expose({ port: 8765, kind: "http" })` + 「远程访问」开关（`allowWan` 语义）与 reservation 引用计数 → **§5 已做**；
- 配对成功用 peer face 传来的**已验证** `peerNodeId` 写 peer 信任 → **仍未做**；
- 解配对/撤销设备同时 `host-peer.revoke-trusted` → **仍未做**；
- 设备页「互联网可达 / relay 延迟 / 加密状态」状态 UI → **§5 做了模式 + 加密；relay 延迟宿主未投影，不伪造**；
- 旧客户端 `encryption-unsupported` 的**宿主侧**拒绝判定 → **已做**，见 §8。

### 5. 续作（2026-11-08，T06 宿外面落地后接）

**边界**：本轮只做「应用侧编排 + 状态 UI」。配对成功写信任 / 撤销级联仍缺
`peerNodeId` 的 auth-center 记录面（T08）与 `host-peer.revoke-trusted` 的级联调用，
不伪造；T09 移动拨号与 T10 真机 E2E 未做。

| 层 | 落点 | 内容 |
| --- | --- | --- |
| 能力仓（T06 增补） | `tunnel/manager.rs::NodeSnapshot.addrs` + `dialable_addrs()`、`tunnel/netinfo.rs::dialable_ipv4_from()` | `status.node.addrs` 投影本节点可拨地址：通配监听展开成本机 LAN IPv4（不返回 `0.0.0.0`）、环回/链路本地/虚拟网卡丢弃、relay 预留生效时追加 `<relay>/p2p-circuit/p2p/<self>`；LAN 在前、relay 在后。这是 QR v2 `peer.addrs` 的唯一来源（见 T08） |
| 平台仓（T06 修复） | 双端 SDK `rust/src/wasm_host.rs` | `host_tunnel::connect` 生成参数是 `Option<&str>`，SDK 传 `Option<String>` 会在应用 wasm 构建期报 E0308；改 `.as_deref()`（桌面/移动同一处） |
| 应用 rust | 新增 `rust/src/tunnel.rs` | `TunnelHost` trait（wasm→宿主原语 / native→测试替身）；`sync_channel_config`（KV `network.relay` → `allowWan` + relay 地址，损坏配置显性报错不清空）、`prepare_channel`（幂等暴露 `kind=http`）、`pairing_peer`（票据 TTL=120s + 状态 → `peer`）、`status_view`（只读投影，不含票据/令牌） |
| 应用 rust | `device_face.rs` | `network_port_via_host()`（u64→u16，0/越界显性失败）；`qr_connection_info` 经 `session.qr.generate/info` 产出 `peer` 或 `peerError` |
| 应用 rust | `lib.rs` / `plugin.json` | 新增 `session.tunnel.{prepare,status,unexpose}` 三条命令；声明 `tunnel:serve`（**不**声明 `tunnel:connect`：桌面是被访问方）；权限清单锁（rust pin + `plugin-contract`）同步 |
| 前端 | `utils/tunnelStatus.ts` + `composables/useTunnelStatus.ts` + `DeviceCenterView.vue` | 状态派生纯函数（8 态映射 + 语气）；页面进入 `prepare`、切回 `refresh`、事件订阅留给 T10；锚点 `pairing-tunnel-status` / `pairing-tunnel-encryption` / `pairing-qr-peer-error`；i18n 双语同步 |

**判据（安全 / 不静默降级）**：

- `allowWan` 由「应用自己是否配置了中继地址」推出，宿主按单一引用计数建 / 放 reservation；
  配置损坏 → 报错且**不写宿主**（避免把用户唯一的中继寻址信息静默清掉）。
- `peer` 只由宿主已验证的 `nodeId` + 宿主枚举的可拨地址 + 一次性票据组成，
  `peer` 生产失败时**回执带 `peerError`**、载荷退回 v1（仅内网），界面显性提示。
- 「已加密」是常量徽标（不变量 12/14），无开关；`status` 只读投影不含票据/令牌。
- trait 方法名刻意与 SDK `HostTunnel` 不同名，避免 `WasmHost` 方法解析 E0034 歧义。

**验证（实跑结果）**：

| 项 | 结果 |
| --- | --- |
| 能力仓 `wasmnest-server-peer-net` | `cargo test --offline --lib` **240 passed**；`--features common-host,relay` **241 passed**；`cargo fmt --check` 绿（含 4 条新增地址投影单测） |
| bedcode rust | `cargo test --offline --lib` **1023 passed / 1 ignored**（新增 `tunnel::tests` 11 条）；`rustfmt tunnel.rs` 后 `cargo fmt --check` 中 `tunnel.rs` 0 diff（该 crate 其余 226 处 fmt 差异是既有基线） |
| wasm 产物目标 | `cargo +nightly-2026-09-16 build --target wasm32-wasip3 --no-default-features --features wasm` **成功**（`Finished dev`） |
| 前端单测 | 新增 `tunnelStatus` 8 条 + `deviceCenter` C27/C28/C29 3 条；定向 44 passed；全量 `--maxWorkers=1` = **79 files / 1316 passed** |
| 根 lint | `pnpm run lint` **0 errors / 44 warnings**（既有基线） |
| 产物 | `pnpm run build:frontend` 成功（`dist/index.js` 2,743.38 kB） |
| 类型检查 | `vue-tsc --noEmit` 仅 1 条既有 `qrcode` 缺声明（T08 已记录），本轮无新增错误 |
| 真宿主目验 / E2E | **未跑**：`host-runtime.lock.json` 的 `artifacts` 为空 + 缺 tauri-driver/WebKitWebDriver；锚点已同步，归 T10 |

**并行变更（T11）**：本轮验证期间平台仓工作树在途加入 `dial-peer-addrs`（pi 会话），
`HostPeer` trait 增加一个方法；bedcode 两个 native 测试替身（`trust/ops.rs`、
`trust/ops/tests/list.rs`）补齐该方法（未实现 → `unimplemented_peer!()`），
native 单测恢复 1023 passed。WIT 产物重拼 / `witSha256` / 全量重建归 T11。

### 6. 环境（可复用）

本 worktree 的 SDK 链接指向 `.worktrees/wasmnest-apps/wasmnest`（= 平台仓 `feat/file-transfer-refactor` 副本，旧 SDK 缺 `./ui/app-update`，会让 `plugin-contract` collect 失败）。验证期按 T14 口径处理：`WASMNEST_PLATFORM_ROOT=<主树>/wasmnest node scripts/link-platform-sdk.mjs --no-install` + `apps/bedcode/desktop` 内 `pnpm install --offline --no-frozen-lockfile`；跑完 `node scripts/unlink-platform-sdk.mjs` 并 `git checkout` 根/app 的 `pnpm-lock.yaml`（unlink 不还原 lock）。link 状态未提交。

### 7. 续作（2026-11-08，配对信任写入 + 撤销级联：跨三仓）

**落地裁定（用户 2026-11-08 选 A）**：契约缺口先补、再收应用侧。此前
`host-peer` 只有 `list-trusted` / `revoke-trusted`，信任只能经首连确认
（`respond-consent`，需 pending request）落库；而隧道配对走一次性票据窗口、
没有 pending 确认请求 ⇒ 配对完成后**没有**任何写入信任的路径，而隧道准入的
`matched` 判据正是 `engine.trust_contains(node_id)`（`tunnel/manager.rs`）。
本轮新增原语并把「配对成功写信任」落到 **auth-center**（它同时持有已验证
`peerNodeId` 与配对事实；bedcode 只做转发，见下）。

| 仓 | 落点 | 内容 |
| --- | --- | --- |
| 能力仓 | `wasmnest-server-peer-net/wit/peer.wit` | `host-peer.trust-node(node-id, display-name)`（与 `revoke-trusted` 对称的唯一信任写入原语；幂等，返回是否新加入） |
| 能力仓 | `src/lib.rs` / `src/plugin_binding.rs` | `trust_peer_node` 引擎入口（形状校验 → `TrustStore::add_with_metadata`，落盘失败显性上抛）+ 绑定层权限门（`peer` 权限，不新增词表） |
| 平台仓 | 双端 SDK（`host/peer.rs` + `wasm_host.rs`） | trait 方法 `peer_trust_node` + WIT 绑定实现；`compose-wit --all` 重拼双端 `deps/peer/peer.wit` |
| 应用仓 | `servers/auth-center`（`auth_http` / `auth_records` / `trust`） | `_http_endpoint` 从宿主入参构造 `PeerFace`（**仅 `caller=peer` 时**采信 `peerNodeId`/`pairing`）；配对记录新增 `peer_node_id` 列（建表 + 老库 `ALTER TABLE` 补列）；`verify` / `qr-connect` 成功后写信任；撤销时按记录 `peer_node_id` 级联 `revoke-trusted`（含已软删记录重试补齐） |

**判据（安全 / 不静默降级）**：

- `peerNodeId` 只来自宿主注入的 peer face 上下文；客户端请求头/请求体同名
  字段不构成面标记（`PeerFace::from_args` 在 `caller != "peer"` 时整体丢弃，
  3 条 native 用例锁定）。
- 有已验证 nodeId 时**配对记录写失败是致命的**（撤销级联依赖该映射），
  不再沿用 LAN 路径的「只 warn」——先信任后丢记录等于让撤销找不到目标。
- 信任写入失败返回显性错误（1001 + 点名文案），不返回「看似配对成功」的 token。
- 级联撤销失败显性上抛；已软删记录的重复撤销会**重放**级联（信任撤销幂等），
  避免「UI 幂等成功、隧道仍匹配」的安全洞。
- LAN 直连配对没有可验证 nodeId → `peerRevoked=false`，不按配对 id 猜 node id。

**验证（实跑）**：

| 项 | 结果 |
| --- | --- |
| 能力仓 peer-net（默认 / `common-host,relay`） | **254 passed** / **255 passed**（新增 3 条：权限门 / 非法 node id / 幂等 + 展示名不覆盖） |
| auth-center `cargo test --lib` | **138 passed**（新增 6 条：PeerFace 3 / 配对记录 nodeId 2 / 级联 4，含级联失败与重试重放） |
| auth-center wasm 目标 | `cargo +nightly-2026-09-16 build --target wasm32-wasip3 --no-features wasm --release` **绿** |
| 双端 SDK | `cargo check --features wasm` **绿**；`compose-wit --all --check` **绿** |
| bedcode rust | `cargo test --offline --lib` **1023 passed / 1 ignored**（只为新 trait 方法补两处测试替身） |
| file-transfer rust / desktop | 98 passed / 10 files 59 passed（新 trait 方法无额外替身需求） |
| 真宿主目验 / E2E | **未跑**：`host-runtime.lock.json` 的 `artifacts` 仍为空 + 缺 tauri-driver/WebKitWebDriver（既有阻塞） |

**仍未做**：旧客户端 `encryption-unsupported` 的宿主侧拒绝判定 → **§8 已做**；
`docs/verification/bedcode.md` 与本票验收勾选随 T10 收口（本轮文档文件同时有
并发会话在途改动，未提交勾选，避免混入他人半成品记录）。

### 8. 续作（2026-11-08，旧客户端 `encryption-unsupported` 宿主侧拒绝判定）

**问题（实测，不是文档推断）**：`required` 下拒绝对端时，宿主只有一段自由文本 +
`code: 1003`，客户端与日志无法机器区分「对端压根没发起协商（旧客户端 / 无信任锚）」
与「协商了但建不起来」。设计 §7.1 的两个错误码此前**没有任何宿主产出**；应用侧
`apps/bedcode/mobile/src/host/tunnel.ts` 虽已能消费 `encryption-unsupported`，但没有
生产者。另一条更硬的约束：这条判定必须在宿主侧（应用看不到入站请求，判不了）。

**判据（可机械裁决，不靠文案猜）**：

| 码 | 触发 | 出路 |
| --- | --- | --- |
| `encryption-unsupported` | `required` ∧ 对端**没有发起**协商（HTTP 无 `X-WasmNest-Crypto` / WS 升级无提案 / HEAD 同判据） | 升级对端，或先完成配对（无 pin 的客户端同样不会协商，宿主**不假装**知道是哪一种） |
| `encryption-required` | 发起过协商但链路建不起来（头畸形 / 公钥非法 / 派生或解密失败 / 本端身份缺失 / 响应密钥缺失 / WS 会话无密码 / 本端 link-crypto 未参与） | 检查链路身份、重新配对 |

两种都是 `Reject` / 400 / Close(4003)，**没有明文回退**。

| 仓 | 落点 | 内容 |
| --- | --- | --- |
| 能力仓 | `link-crypto/src/lib.rs` | `ERROR_HEADER = X-WasmNest-Crypto-Error` + 两个码 + `REJECTION_CODES` / `coded_reason` / `reason_code` / `parse_code`（码→文案→解析同一真源，正文/日志用 `<code>: ` 前缀） |
| 能力仓 | `wasmnest-server-core/src/link_crypto.rs` | 7 处拒绝分支下码：HTTP 无协商 = `unsupported`，其余 = `required`；WS 帧层只下 `required`（帧层分不出「从未协商」，旧客户端由升级期判定） |
| 能力仓 | `wasmnest-server-http/src/middleware/http_filter.rs` | 入站/HEAD/fail-visible 拒绝响应带 `X-WasmNest-Crypto-Error` 头（头的值取自 `reason_code(&rej.reason)`，其他过滤器的拒绝不下码） |
| 能力仓 | `wasmnest-server-websocket/src/routes.rs` | WS 升级期三种拒绝同样带码（无提案 = `unsupported`，坏提案/坏协商 = `required`）；帧层 4003 的 close 描述随原因带走前缀 |
| 平台仓 | `wasmnest-mobile/src-tauri/src/plugin/host_domains/http.rs` | 应用发起 HTTP 的响应若带拒绝码头 → 原码交回应用（`encryption-unsupported` / `encryption-required`），不再吞成笼统的 `LINK_ENCRYPTION_DOWNGRADE`；头里非登记值不采信 |
| 平台仓 | `wasmnest-mobile/src-tauri/src/commands/http_proxy.rs` | 同上（宿主代理面；两个 strict 档位都报码——拒绝没有载荷可交付，不是可容忍的降级） |

**验证（实跑）**：

| 项 | 结果 |
| --- | --- |
| 能力仓 `wasmnest-link-crypto` | `cargo test --offline` **6 passed**（新增码往返 + 边界：缺分隔符 / 近似词 / 自由文本 / 非登记头值一律不认） |
| 能力仓 `wasmnest-server-core` | `cargo test --offline --lib` **59 passed**（新增 2 条：peer 面 + 普通面无协商 → `unsupported` 且不落明文；坏协商 → `required`） |
| 能力仓 `wasmnest-server-http` | `--lib` **101 passed**（新增 service 级端到端：真注册端点 + 真过滤器链 → 400 带 `unsupported` 头且 handler 未被调用；坏协商 → `required`） |
| 能力仓 `wasmnest-server-websocket` | `--lib` **59 passed**（新增拒绝码头/正文同源） |
| 平台仓移动宿主 | `cargo check --offline --lib` 绿；`--lib` 过滤跑 `envelope_*` 5 passed（新增拒码透传）+ `commands::http_proxy` 6 passed（新增码白名单） |
| 格式 | 改动文件 `rustfmt --check` 0 diff（其余既有文件本就不合规，未批量重排） |
| 真宿主目验 / E2E | **未跑**（`host-runtime.lock.json` 的 `artifacts` 为空 + 缺 tauri-driver/WebKitWebDriver，既有阻塞） |

**未做 / 边界**：

- 移动端**逐字文案**仍把 `encryption-unsupported` 与 `encryption-required` 映射到同一条
  `hub.tunnelErrorEncryptionRequired`（「链路加密协商失败」），缺「对端不支持加密，请升级」
  的措辞 → 归 T09（应用仓）与 T10 复核，本轮不代改。
- WS 升级期的拒绝码已在服务端 400 响应里带上，但移动端 WS 客户端只在**升级成功后**
  读响应头（`MobileWsCryptoFactory::complete`）——被拒时按升级失败处理（无明文回退，
  已达要求），未把码单独抽出上报；要逐字区分需改共享 ws-client 引擎（另立票）。
- 桌面 LAN 直连的旧客户端只由单测锁定（service 级用真过滤器链，不依赖真宿主）。

**跨仓提交**：能力仓 `feat/nat-traversal-v2` 与平台仓 `feat/nat-traversal` 各一条提交；
未打 tag、未动 `release-manifest.json`（发布线收口时按 §3 钉）。
