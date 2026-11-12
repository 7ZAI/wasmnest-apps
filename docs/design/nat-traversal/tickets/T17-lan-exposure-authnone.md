# [feat] T17 · 存量 LAN 暴露：bedcode 三条 auth:none 路由无 caller 门禁（独立于穿透方案）

- **落仓**：`7ZAI/wasmnest-apps`
- **标签**：`kind:feature`（安全收紧评估；若裁定为缺陷可改 `kind:bug`）
- **阶段**：独立 ｜ **依赖**：无（不阻塞穿透，也不被穿透阻塞）｜ **状态**：实施中（2026-11-08 认领；实施记录见文末）
- **设计依据**：§0.4 边界、§9.1 风险 12；评审待办①
- **重要边界**：这是**先于穿透方案存在**的存量暴露，不属穿透引入；穿透方案 §0.4 裁定只覆盖「经隧道的已匹配远端」，不为本现状背书。

## 需求描述

bedcode 的 `task-status` / `session-mode` / `terminal-bg` 三条 `auth:none` 路由今天绑 `0.0.0.0:8765` 且无 caller 检查（`http_routes.rs:115,121,316`；`task/mod.rs:1116-1122` 分派签名不含 caller；`terminal-bg` 由宿主路由服务、应用侧无门禁）——**LAN 内任意设备本就可调**。评估并收紧 LAN 面。

## 落点 app 与端

`bedcode` / 桌面（路由门禁）；可能涉及宿主路由服务（`terminal-bg`）与平台仓联动。

## 验收条件

- [x] 暴露面核实：三条路由的当前绑定、调用方、LAN 可达性实测记录（含 `session-mode` 是 POST 写操作）。
- [x] 收紧方案裁定与实施：候选方向包括 LAN 面要求配对/JWT、caller 门禁扩展到这三条、或绑定面收窄；**约束**：移动端真实依赖 `session-mode`（`apps/bedcode/mobile/src/task/api.ts:160`），收紧不得打断 LAN 远程控制产品功能。
- [x] 与穿透 §0.4 裁定的关系显性化：经隧道的已匹配远端可达性由隧道 ACL 承担；LAN 面收紧方案不得与隧道面裁定冲突（若冲突，回评审重裁）。
- [x] 若收紧：测试锁覆盖「LAN 未授权设备调用被拒 + 已授权移动 LAN 调用正常」；若裁定不收紧：写明理由与残余风险再关闭（fail-visible，禁止静默消失）。
- [ ] app `test:run` + `cargo test` 绿；涉及宿主路由则平台仓测试联动。（`cargo test` 绿；app `test:run` 本 worktree 环境阻塞，见实施记录「验证」）

## 相关契约与锁

- 不变量 16 只锁隧道面；本 ticket 的 LAN 面锁独立命名，避免混淆。
- 评审会话裁定（2026-11-07）：三条路由对已匹配远端保持可达的依据是移动产品依赖；本 ticket 处理的是 LAN 直连面，两者并行不悖。
- 穿透 tickets T05/T07 实施时引用本 issue 编号，标明存量暴露的处理状态。

## 实施记录（2026-11-08，认领：pi 会话；并发会话在做 T03/T04，无重叠）

### 1. 暴露面核实（事实，逐条可复核）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 监听面 | 宿主 HTTP 服务绑 `0.0.0.0`，默认端口 `8765` | `wasmnest-lib/wasmnest-server-base/src/constants.rs:407`（`BIND_ADDRESS`）、`:362`（`DEFAULT_SERVER_PORT`）；`wasmnest-server-core/src/app.rs:149`（`.bind(BIND_ADDRESS:port)`） |
| 三条 `auth:none` | `task-status`（GET）、`session-mode`（GET+POST）、`terminal-bg`（GET，`/static/terminal-bg`） | `apps/bedcode/desktop/rust/src/http_routes.rs:120,126,321`；清单 `lib.rs:NO_AUTH_HTTP_ENDPOINTS` |
| 调用方判定 | 宿主按「已验签 > 环回 > 匿名」判三档，经 `_http_endpoint` 的 `caller` 字段转发（`device` / `localhost` / `anonymous`） | `wasmnest-lib/wasmnest-server-http/src/controllers/plugin_controller.rs:132`（`caller_identity`）、`:100-128`（`HttpCaller`）；插件侧取参 `apps/bedcode/desktop/rust/src/lib.rs:2106` |
| 旧分派面 | `task::handle_http_via_host` 签名不含 `caller`，三条路由**不判调用方** → LAN 匿名可达（`session-mode` POST 是写操作：设置 auto_execute / auto_answer） | 改前 `task/mod.rs:1116-1122` |

**真实消费方（收紧的边界条件）**

| 端点 | 消费方 | 调用路径 / 档位 |
| --- | --- | --- |
| `task-status` | hook / 桥接脚本（pi、opencode、claude、codex 模板） | 固定 `127.0.0.1`（`scripts/wasmnest_bridge_pi.ts:63`、`scripts/wasmnest_bridge_opencode.ts:66`）→ `localhost` |
| `task-status` | 桌面 WebView | 同机 HTTP → `localhost`。移动端**无**调用（`apps/bedcode/mobile` 全量 grep 无命中） |
| `session-mode` | 同 hook 脚本 | `localhost` |
| `session-mode` | 移动端（LAN 远程控制） | `apps/bedcode/mobile/src/task/api.ts:160` → `mobileApi.httpRequest`（`wasmnest-mobile/src/composables/useHttpApi.ts:157`：宿主壳以 loader 凭证代发）→ `http_request` 判定 `host_request=true` 时注入 JWT（`wasmnest-mobile/src-tauri/src/commands/http_proxy.rs:165` `should_inject_jwt`）→ 桌面验签 → `device`。**标：装配证据链成立，未跑真机 E2E 实测该档位** |
| `terminal-bg` | 桌面 WebView 的 CSS `background-image` | 宿主静态路由（`wasmnest-lib/wasmnest-server-http/src/routes.rs:64` `terminal_bg_image`），插件侧无 handler；注释已记「壁纸无敏感信息，局域网可见可接受」 |

### 2. 裁定（本 ticket 的收紧方案）

1. **`task-status` → 只认 `localhost` 与 `peer`**：hook 与桌面 WebView 都走环回；`peer` 是穿透对等面隧道流量（T03 的 `caller: "peer"`），其授权点在隧道层匹配校验（§0.4 / T05 / T07），本层不得重复拦成死路。
2. **`session-mode` → 认 `localhost`、`device`、`peer`**：多出 `device` 是因为移动端 LAN 远程控制真实依赖（既有产品功能）；`anonymous` 与缺失档一律 403。
3. **`terminal-bg` → 不收紧（显性记录理由 + 残余风险）**：路由由宿主静态服务实现（插件侧无分派点，收紧需改平台/能力仓），且 CSS `background-image` 不可能携带凭证。残余风险 = **同网段任意设备可读取用户自选的终端壁纸字节**（信息面极小：无路径参数、只扫固定前缀 `terminal_bg.<白名单扩展>`、无目录穿越）。跟进：若要收，归 T06 装配（宿主静态路由补 caller 判定），本 ticket 不越仓改。

裁定方向选择：**「caller 门禁」**（ticket 候选方向之二）。不选「绑定面收窄」——移动端 LAN 远程控制与 hook 都要用；不选「LAN 面一律要求配对/JWT」——hook 脚本拿不到 JWT，会把任务面板/自动模式打成静默 401。

### 3. 实施

| 文件 | 改动 |
| --- | --- |
| `apps/bedcode/desktop/rust/src/task/mod.rs` | 新增 `CALLER_LOCALHOST` / `CALLER_DEVICE` / `CALLER_PEER`、`CALLER_GATED_ENDPOINTS`、纯函数 `caller_allowed_for_none_auth`（`:1192-1222`）；`handle_http_via_host` 收 `caller` 并在分派前 403（`http_response::error(403, "forbidden caller for <path>")`，同时 `log_warn` 留痕） |
| `apps/bedcode/desktop/rust/src/lib.rs` | `_http_endpoint` 把宿主已判定的 `caller` 传进任务域（`:2468`）；`NO_AUTH_HTTP_ENDPOINTS` 文档改成「免凭证 ≠ LAN 公开」 |
| `apps/bedcode/desktop/rust/src/http_routes.rs` | 两条 none 档声明补门禁说明；`no_auth_routes_are_justified` 提示语点名门禁（none 清单本身不变） |

**测试锁（native，`cargo test --lib`）**

- `task::tests::none_auth_endpoints_gate_by_caller`：`task-status` —— `localhost` ✓ / `peer` ✓ / `device` ✗ / `anonymous` ✗ / 空串 ✗；`session-mode` —— `localhost` ✓ / `device` ✓ / `peer` ✓ / `anonymous` ✗ / 空串 ✗；清单外端点（`task-queue/*`、`session-settings` 等）**不受本门禁影响**（避免无声改写 JWT 档准入）。
- `task::tests::caller_gated_endpoints_are_none_auth_task_endpoints`：门禁清单必须是本域端点清单子集，且两条都在 `NO_AUTH_HTTP_ENDPOINTS`（档位与门禁同源，改一处必须两处同改）。
- 既有 `none_auth_routes_cover_public_surface_and_match_no_auth_list` / `routes_table_is_self_consistent` / `d10_contract_test`（假 invoker，不跑插件代码）全绿。

### 4. 验证（实跑结果）

- `cargo test --lib`（bedcode desktop，native）：**1012 passed / 0 failed / 1 ignored**。
- wasm 目标构建（同一隔离副本）：`cargo build --target wasm32-wasip3 --no-default-features --features wasm --release`（`RUSTUP_TOOLCHAIN=nightly-2026-09-16`）**成功**（宏路径与产物口径一并验证）。
- `cargo fmt -- --check`：本次改动的 `task/mod.rs` / `http_routes.rs` 无新增 diff（仓内既存 fmt 噪声不在本 ticket 处理，见本机 scratchpad）。
- **环境阻塞（非本改动引入）**：本 worktree 的 cargo 依赖按 `../../../../../wasmnest` 解析到平台仓 `feat/file-transfer-refactor` 副本（旧 SDK，`peer_start_node` 签名不匹配）→ 直接在本 worktree 跑 native 测试编译失败。本次验证在隔离副本（`/tmp/t17`，SDK 指主树平台仓 + 能力仓 `feat/nat-traversal`）完成；worktree 的共享 SDK 符号链接未改动。
- **app `test:run` 未绿（环境，非代码）**：本 worktree 的 `apps/bedcode/desktop/package.json` 把 SDK 写作 `file:../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop`，经 `.worktrees/wasmnest-apps/wasmnest` 符号链接解析到**平台仓 `feat/file-transfer-refactor` 副本**（2026-11-01，旧 SDK）：无 `./ui/app-update` 出口、Select 无新版 `required` / `error` 面。装完依赖后 `plugin-contract.test.ts` collect 失败（`Missing "./ui/app-update" specifier`）、`Select.test.ts` 3 条断言失败；同一批文件在主树（SDK 指向平台仓 dev）**全绿**。本改动为纯 Rust（前端零 diff），未为跑测试去改 worktree 的 SDK 链接（会动共用的符号链接 / `package.json`，并与并发会话冲）。

### 5. 残余风险与未做

- `terminal-bg` 仍对 LAN 匿名可读（理由与跟进见裁定 3）。
- `session-mode` 的 LAN 可达性现在依赖移动端宿主壳的 JWT 注入；token 过期时播 `anonymous` → 403（fail-visible，界面报错而非静默失败），符合不变量 6 的口径。
- 未做 per-app 信任 scope（§9.2#2）：`device` 档是设备级信任，与 T05/T07 的匹配粒度裁定保持一致。
- 未跑真实宿主目验与 LAN 设备实测：三条路由的 LAN 可达性结论来自代码路径（`0.0.0.0` 绑定 + 无 caller 判定），**未在第二台机器上抓包/复现**；真实宿主目验随 T10 E2E 一并做。
