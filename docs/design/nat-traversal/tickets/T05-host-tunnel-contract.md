# [feat] T05 · `host-tunnel` 契约：`/wasmnest/tunnel/1` 流、ACL、配对票据与配对窗口

- **落仓**：`7ZAI/wasmnest-lib`（WIT 真源仓；契约类）
- **标签**：`kind:contract`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：T02、T03 ｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.1、§4.4、§5.1、不变量 1/2/4/8
- **开工前必须裁定**：§9.2#8（WIT 归属：`wasmnest:peer` 新 interface vs 新 `wasmnest:tunnel` 包）；§9.2#2（匹配粒度/作用域，默认按设备 + 全局信任现状）

## 需求描述

落地穿透通道契约与服务端/客户端机制：`host-tunnel` WIT、`/wasmnest/tunnel/1` 流协议、已匹配准入、配对票据与配对窗口。这是 P1 的契约核心，平台装配（T06）与应用接入（T07–T09）都以此为准。

## 落点 app 与端

机制：`wasmnest-server-peer-net`（WIT 绑定、流、ACL、票据）；双端共用（桌面 serve / 移动 connect）。

## 验收条件

**WIT 与流协议**

- [ ] `host-tunnel` interface：`expose` / `unexpose` / `connect`（含 `pairing-ticket: option<string>`，写入首帧）/ `close` / `issue-pairing-ticket` / `status`（设计 §4.4 提案）。
- [ ] 首帧 `u32be len | JSON {v:1, port, kind:"http"|"tcp", ticket?}`；响应 `{ok:true, caller:"peer", peerNodeId}`；之后裸字节双向 pipe。
- [ ] `kind=http`：`port` 为逻辑端口标识，后端恒为 T03 对等面，不做回环探测；`kind=tcp`：`port` 必须回环可达且拒绝宿主管理端口（8765 网关、peer 端口、peer face、relay 控制端口）。

**准入与配对窗口**

- [ ] 服务端校验：已匹配（应用配对 + 传输信任）→ `allowedPeers`（空 = 所有已匹配）→ 端口/kind 规则 → 票据（仅配对窗口）→ 并发/字节配额；未匹配一律拒绝（不变量 8）。
- [ ] 票据：一次性、TTL ≤ 120s、绑定目标端口、LAN/relay 两路径均可用、用后立即失效（不变量 4，双路径测试）。
- [ ] 准入 `Pairing` 态：仅 trust-status 首帧携带有效票据才进入；只允许 `/wasmnest/trust-status/1` 与 tunnel（且 tunnel 只到配对端点）；不放行 transfer/shared-dir/session 业务流。
- [ ] 配对连接注册表（宿主进程内共享，连接四元组为键，accept 时消费）：配对态连接 dial 对等面前登记，供 peer face 执行路径白名单（bedcode 仅 `/api/auth/*`，白名单外 403）；配对成功/票据失效立即清除；配对窗口连接不得复用于业务。
- [ ] 配对成功写入信任后由移动端重建隧道（或宿主提升 Admitted）。

**客户端与生命周期**

- [ ] `connect` 幂等确保全局 peer 节点就绪；本地代理 listener **只绑 `127.0.0.1:0`**（不变量 1）；每条 accept 的 TCP 连接开一条新 tunnel 流；`close(handle)` 关 listener 与全部在飞流。
- [ ] 空闲超时只回收短连接 HTTP 流；WS 升级后的流按长连接处理（保活），不得杀静默终端 WS。
- [ ] `expose` 幂等确保节点就绪；不直接管理 reservation（引用计数归 T06 宿主隧道管理器）。

## 相关契约与锁

- WIT 变更纪律：compose 重拼 + `witSha256` + SDK/host-runtime lock + 按当前 SDK 全量重建；跨仓 tag 钉住。
- 权限 `tunnel:serve` / `tunnel:connect` 词汇在平台仓 T06 落地；本 ticket 的 manifest 声明先行设计。
- 错误码词表按设计 §7.1（`not-matched` / `ticket-expired` / `port-not-exposed` / `tunnel-limit` 等）。
- 不变量 16 的隧道侧匹配校验测试锁与 T07 路由侧锁配对。