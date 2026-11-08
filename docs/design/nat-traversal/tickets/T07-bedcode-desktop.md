# [feat] T07 · bedcode 桌面：隧道 expose、固定 `required` 加密、配对信任与撤销级联

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`
- **阶段**：P1 ｜ **依赖**：T06、T08（接口对齐，可并行开发）｜ **状态**：实施中（2026-11-08 认领：pi 会话；**只做无宿外面依赖的部分**：link-crypto 固定 `required` + §0.4 锁复核。expose / 信任写入 / 撤销级联 / 状态 UI 待 T06 落地。并发 CodeBuddy 会话在能力仓/平台仓做 T06，无重叠）
- **设计依据**：§4.1、§4.5、§4.10、§5.2、§0.4、不变量 7/12/16

## 需求描述

bedcode 桌面作为被访问方接入穿透：经对等面暴露服务（禁止裸转发 8765）、链加密固定 `required` 不可关闭、配对成功写入 peer 信任、撤销级联，并按 §0.4 裁定锁定三条免凭证路由的可达性。

## 落点 app 与端

`bedcode` / 桌面（rust + 前端设置页）。

## 验收条件

- [ ] `host-tunnel.expose({ port: 8765, kind: "http", ... })`（逻辑端口，后端恒为对等面）；「远程访问」开关（含 `allowWan` 语义）控制 expose 与 reservation 计数。
- [x] **link-crypto 固定 `required`**：`useLinkCrypto.ts` 移除 off/preferred 选择，设置页改只读「强制加密」；配置层拒绝关闭；缺链路身份拒绝并提示修复（不变量 12/14）。（2026-11-08 落地，见实施记录）
- [ ] 配对成功且 JWT 签发后，用 peer face 传来的**已验证** `peerNodeId` 写 peer 信任列表（不信任客户端自报值）；auth-center 配对记录保存该 nodeId（供 `allowedPeers` 与撤销）。
- [ ] 解配对/撤销设备同时 `host-peer.revoke-trusted`（不变量 7）；隧道 ACL 立即生效。
- [ ] **§0.4 测试锁**：`task-status`/`session-mode`/`terminal-bg` 经 peer face 仅对已匹配 peer 可达（匹配校验在隧道层）；run-* 四条对 `peer` 一律 403（不变量 3/16）。
- [ ] 状态 UI：设备页显示「互联网可达」、relay 延迟、加密状态；错误按 §7.1 词表显性呈现。
- [ ] 旧客户端不支持 link-crypto → 显性 `encryption-unsupported` + 升级提示，无明文回退。
- [ ] app `test:run` + 根 lint + `cargo test` + wasm 目标构建绿；真实宿主目验；交互面改动同步 `data-testid` 锚点。

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

### 4. 未做（归 T06 落地后接）

- `host-tunnel.expose({ port: 8765, kind: "http" })` + 「远程访问」开关（`allowWan` 语义）与 reservation 引用计数；
- 配对成功用 peer face 传来的**已验证** `peerNodeId` 写 peer 信任（依赖 T03 请求上下文 + T08 配对记录字段）；
- 解配对/撤销设备同时 `host-peer.revoke-trusted`（需 pairing → peerNodeId 映射；内核 `pairings` 记录面加字段属平台/能力仓）；
- 设备页「互联网可达 / relay 延迟 / 加密状态」状态 UI；
- 旧客户端 `encryption-unsupported` 的**宿主侧**拒绝判定（应用侧文案位已就位）。

### 5. 环境（可复用）

本 worktree 的 SDK 链接指向 `.worktrees/wasmnest-apps/wasmnest`（= 平台仓 `feat/file-transfer-refactor` 副本，旧 SDK 缺 `./ui/app-update`，会让 `plugin-contract` collect 失败）。验证期按 T14 口径处理：`WASMNEST_PLATFORM_ROOT=<主树>/wasmnest node scripts/link-platform-sdk.mjs --no-install` + `apps/bedcode/desktop` 内 `pnpm install --offline --no-frozen-lockfile`；跑完 `node scripts/unlink-platform-sdk.mjs` 并 `git checkout` 根/app 的 `pnpm-lock.yaml`（unlink 不还原 lock）。link 状态未提交。
