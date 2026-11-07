# [feat] T03 · server-http/core：`HttpCaller::Peer` 与对等 HTTP/WS 面（安全测试先行）

- **落仓**：`7ZAI/wasmnest-lib`
- **标签**：`kind:feature`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：无（可与 T02 并行）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§0.2 硬约束 2、§4.5、§5.1、不变量 2/3/16

## 需求描述

堵死「隧道经 127.0.0.1 转发进 8765 → 远端被提升为本机调用方」的权限提升路径。新增对等 HTTP/WS 面：第二个 Actix listener 绑 `127.0.0.1:<ephemeral>`，复用同一套路由表与鉴权中间件，该面上所有未验签请求标记 `HttpCaller::Peer`（线协议 `caller:"peer"`）。**这是平台级一次性修复，所有服务型应用受益。**

## 落点 app 与端

机制：`wasmnest-server-http` / `wasmnest-server-core`；桌面宿主先行，移动宿主对应面在 T06 装配。

## 验收条件

- [ ] **先写安全测试再实现**：bridge 路由（run-attach/run-events/run-commands/run-commands-ack）对 `caller=peer` 返回 403；`peer` 永不被分类为 `localhost`。
- [ ] listener 注入 `peer_face=true`；`classify` 在该标记下对未验签请求返回 `Peer`，**不得**再用 `req.peer_addr().is_loopback()` 判定（`plugin_controller.rs:118-134` 现行逻辑在该面失效）。
- [ ] 复用路由表与 JWT 鉴权中间件：带 JWT 的请求仍注入 `device`，不受影响。
- [ ] WS 升级请求在 peer face 上同样标记 `peer`；终端端点仍要求 JWT。
- [ ] 已验证的 `peerNodeId` 作为请求上下文传给插件（与 `caller` 并列，不信任客户端自报值）；配对态连接另附 pairing 标记（注册表机制供 T05 消费）。
- [ ] peer face 只绑 loopback，不对 LAN 暴露；启动/关闭跟随 `tunnel:serve` 规则生命周期（生命周期接线在 T06）。
- [ ] 现有路由全量回归绿。

## 相关契约与锁

- 不变量 2/3/16；线协议新增 `caller:"peer"` 档位需文档化（插件侧按字符串分派）。
- 面标记注入机制是 T04（链加密豁免判据）的共用基础。
- §0.4 裁定：`task-status`/`session-mode`/`terminal-bg` 无 caller 门禁，peer face 标记保护不了它们——其可达性由隧道匹配校验承担（T05/T07 测试锁），本 ticket 不改这三条路由。