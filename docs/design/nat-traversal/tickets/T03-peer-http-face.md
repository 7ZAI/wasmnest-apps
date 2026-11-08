# [feat] T03 · server-http/core：`HttpCaller::Peer` 与对等 HTTP/WS 面（安全测试先行）

- **落仓**：`7ZAI/wasmnest-lib`
- **标签**：`kind:feature`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：无（可与 T02 并行）｜ **状态**：能力仓机制已落地（2026-11-08）；**宿主生命周期接线在 T06**；待提交 GitHub（gh 未认证）
- **设计依据**：§0.2 硬约束 2、§4.5、§5.1、不变量 2/3/16

## 需求描述

堵死「隧道经 127.0.0.1 转发进 8765 → 远端被提升为本机调用方」的权限提升路径。新增对等 HTTP/WS 面：第二个 Actix listener 绑 `127.0.0.1:<ephemeral>`，复用同一套路由表与鉴权中间件，该面上所有未验签请求标记 `HttpCaller::Peer`（线协议 `caller:"peer"`）。**这是平台级一次性修复，所有服务型应用受益。**

## 落点 app 与端

机制：`wasmnest-server-http` / `wasmnest-server-core` / `wasmnest-server-base`；桌面宿主先行，移动宿主对应面在 T06 装配。

## 验收条件

- [x] **先写安全测试再实现**：`caller_classification_priority_and_wire_values`（peer 压倒验签/环回 8 格）、`peer_face_never_classified_as_localhost`、`peer_context_ignores_client_supplied_headers`、`peer_face_forwarded_shape_locks_caller_and_context`；跨仓门禁锁 `apps/bedcode/desktop/rust/src/run/bridge/mod.rs::bridge_caller_gate_accepts_only_loopback_tier` 显式断言 `caller_allowed("peer") == false`（run-* 四条 403）。
- [x] listener 注入 `RequestFace`（`peer` / `peer_node_id` / `pairing`）；`classify` 在该标记下对**所有**请求返回 `Peer`，不再按 `req.peer_addr().is_loopback()` 判定该面身份。
- [x] 复用路由表、认证闸门与 JWT 中间件：带 JWT 的请求仍注入 `device`；`verified` 改为 `device.is_some()`，不因 `caller=peer` 误判未验签。
- [x] WS 升级请求在 peer face 上同样带面标记（`ConnSpec.face` → 帧级 `FilterContext`）；配对窗口在协议升级前 403；终端端点 JWT 要求未改。
- [x] 已验证的 `peerNodeId` 与 `pairing` 作为请求上下文传给插件（与 `caller` 并列），只认宿主注入的扩展，客户端自报头不透传；`PeerFaceResolver`（连接四元组 → `RequestFace`）是 T05 配对连接注册表的接线点。
- [x] peer face 只绑 `127.0.0.1`（`serve_peer_face` / `serve_on(LOCALHOST_IP, ...)`），复用同一 `faces` 路由表。
- [ ] **启动/关闭跟随 `tunnel:serve` 规则生命周期**：公开 API 已就绪，宿主装配（权限、租约、reservation 引用计数）归 T06，本票**未接线**。
- [x] 现有路由全量回归绿：`wasmnest-server-http` 90 passed、`server-core` 48 passed、`server-websocket` 49 passed、`server-base` 39 passed（详见实施记录）。

## 实施记录（2026-11-08）

落点：`wasmnest-lib` 分支 `feat/nat-traversal`（工作树 `.worktrees/wasmnest-lib/nat-traversal`），**未提交**。

**代码**

| 文件 | 变更 |
| --- | --- |
| `wasmnest-server-base/src/face.rs`（新） | `RequestFace`（`peer` / `peer_node_id` / `pairing`）、`PeerFaceResolver`（连接四元组 → 面上下文）；面标记唯一真源，T04 共用 |
| `wasmnest-server-core/src/app.rs` | 抽出 `serve_on(bind_address, port, config, faces, face, resolver)`；`serve` 保持原签名（普通面）；新增 `serve_peer_face` 只绑 `LOCALHOST_IP`，在 `wrap_fn` 把 `RequestFace` 注入 `ServiceRequest.extensions`（HTTP 与 WS 请求都覆盖） |
| `wasmnest-server-http/src/controllers/plugin_controller.rs` | `HttpCaller::Peer`（线协议 `"peer"`）、`classify(verified, loopback, peer_face)`、`request_face`；`PluginHttpRequest.face`；`build_plugin_http_args` 追加 `peerNodeId`（仅宿主验证过）/ `pairing`（仅配对态）；认证档位判定改 `device.is_some()` |
| `wasmnest-server-http/src/gateway.rs` | `verified` 与 caller 档位解耦，转发携带 `request_face` |
| `wasmnest-server-http/src/peer_face.rs`（新） | 配对窗口路径白名单（`/api/auth/*`，拒路径穿越与 `%2e%2e`）+ `peer_face_guard` 403 闸门 |
| `wasmnest-server-http/src/face.rs` | 闸门挂 HTTP face 中间件链外层，普通面零介入 |
| `wasmnest-server-websocket/src/{routes.rs,conn.rs}` | WS 握手读面标记、配对态拒绝升级；`ConnSpec.face` 传到帧级 `FilterContext` |
| `apps/bedcode/desktop/rust/src/run/bridge/mod.rs`（应用仓） | 桥接门禁测试锁补 `caller="peer"` 反例 |

**验证（本机实跑，2026-11-08）**

```bash
export PATH="$HOME/.cargo/bin:$PATH"
# 能力仓按 crate 逐个跑（无根 workspace）
for c in wasmnest-server-base wasmnest-server-core wasmnest-server-http wasmnest-server-websocket; do
  (cd $c && cargo test --offline)        # 39 / 48 / 90 / 49 passed，0 failed
  cargo fmt --manifest-path $c/Cargo.toml -- --check   # 全部干净
done
(cd wasmnest-server-http && cargo check --offline --lib --features common-host)   # 绿
(cd wasmnest-server-websocket && cargo check --offline --lib --features common-host)  # 绿
# 应用仓桥接门禁锁
cargo test --offline --manifest-path apps/bedcode/desktop/rust/Cargo.toml bridge_caller_gate_accepts_only_loopback_tier  # 1 passed
```

`server-http` 测试编译残留 4 条 **既有** unused-import warning（`gateway.rs:257/258`、`gateway/tests/decide_forwards_only_when.rs:3`、`middleware/auth_gateway/tests/host_public_paths_are_only.rs:5`），非本票引入，未顺手清理。

**未接线 / 后续**

- `serve_peer_face` 尚无生产调用点：权限 `tunnel:serve` / `tunnel:connect`、租约与 reservation 引用计数、配对连接注册表实体都在 T05/T06；本票只交付机制与测试锁。
- 线协议新增档位需文档化：**`caller:"peer"`**，peer 面可附 `peerNodeId`（string，宿主验证过才有）/ `pairing`（bool，仅 `true` 时写）；普通面线协议逐字不变，老插件忽略未知字段。
- **跨任务冲突（2026-11-08 已消解）**：原记录为 T17 在途代码把 `task-status` 收紧为只认 `localhost`、`session-mode` 认 `localhost` + `device`，新 `peer` 档会被拒，与设计 §0.4 冲突。核查当前实现：T17 已落地，`task::caller_allowed_for_none_auth` 对 `task-status` / `session-mode` 均显式放行 `CALLER_PEER`（`none_auth_endpoints_gate_by_caller` 锁覆盖），与 §0.4 一致；本票**未碰** T17 代码。剩余为 T10 真机跨网复核「已匹配 peer 可达 + `run-*` 仍 403」，无需再裁定 §0.4。
- **证据漂移**：设计附录 B 引用的 `link_crypto.rs:968-981`、`plugin_controller.rs:118-134` 等行号与当前代码不符（已在设计文档附录 C 登记）。

## 相关契约与锁

- 不变量 2/3/16；线协议新增 `caller:"peer"` 档位需文档化（插件侧按字符串分派）。
- 面标记注入机制是 T04（链加密豁免判据）的共用基础。
- §0.4 裁定：`task-status`/`session-mode`/`terminal-bg` 无 caller 门禁，peer face 标记保护不了它们——其可达性由隧道匹配校验承担（T05/T07 测试锁），本 ticket 不改这三条路由。
