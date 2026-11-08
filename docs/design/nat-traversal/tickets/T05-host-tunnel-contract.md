# [feat] T05 · `host-tunnel` 契约：`/wasmnest/tunnel/1` 流、ACL、配对票据与配对窗口

- **落仓**：`7ZAI/wasmnest-lib`（WIT 真源仓；契约类）
- **标签**：`kind:contract`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：T02、T03 ｜ **状态**：待提交 GitHub（gh 未认证）；**能力仓契约真源 + 流机制 + 宿主 provider 绑定已全部落地（2026-11-08 两轮 + T06 装配，已提交 `974c813` / 平台 `4e61b7e9`）；剩余真机 LAN + relay 双路径验收归 T10**
- **设计依据**：§4.1、§4.4、§5.1、不变量 1/2/4/8/16
- **开工前裁定**：§9.2#8 **已裁定**（2026-11-07 用户：新开 `wasmnest:tunnel` 包独立演进，本票按此落地）；§9.2#2 未裁定，按 spec §6 默认口径「按设备 + 宿主全局信任现状」执行（用户可否决，否决则 T05/T07 返工）

## 需求描述

落地穿透通道契约与服务端/客户端机制：`host-tunnel` WIT、`/wasmnest/tunnel/1` 流协议、已匹配准入、配对票据与配对窗口。这是 P1 的契约核心，平台装配（T06）与应用接入（T07–T09）都以此为准。

## 落点 app 与端

机制：`wasmnest-server-peer-net`（WIT 绑定、流、ACL、票据）；双端共用（桌面 serve / 移动 connect）。

## 验收条件

**WIT 与流协议**

- [x] `host-tunnel` interface：`expose` / `unexpose` / `connect`（含 `pairing-ticket: option<string>`，写入首帧）/ `close` / `issue-pairing-ticket` / `status`（设计 §4.4 提案）。**（`wit/tunnel.wit`；T06 增 `configure`，仍属 0.0.1 预发布线）**
- [x] 首帧 `u32be len | JSON {v:1, port, kind:"http"|"tcp", ticket?}`；响应 `{ok:true, caller:"peer", peerNodeId}`；之后裸字节双向 pipe。**（`frame.rs` + `client.rs` 响应形状校验）**
- [x] `kind=http`：`port` 为逻辑端口标识，后端恒为 T03 对等面，不做回环探测；`kind=tcp`：`port` 必须回环可达且拒绝宿主管理端口（8765 网关、peer 端口、peer face、relay 控制端口）。**（`policy.rs` 后端解析 + 管理端口黑名单；宿主注入实际端口）**

**准入与配对窗口**

- [x] 服务端校验：已匹配（应用配对 + 传输信任）→ `allowedPeers`（空 = 所有已匹配）→ 端口/kind 规则 → 票据（仅配对窗口）→ 并发/字节配额；未匹配一律拒绝（不变量 8）。**（实现顺序 = 首帧形状 → 端口/kind 规则 → 已匹配/票据 → `allowedPeers` → 配对窗口 kind 限制 → 并发配额 → **准入通过后才消费票据**；错端口不烧票据有锁）**
- [x] 票据：一次性、TTL ≤ 120s、绑定目标端口、LAN/relay 两路径均可用、用后立即失效（不变量 4，双路径测试）。**（`ticket.rs`：`ticket_is_single_use_on_both_access_paths` / `ttl_is_capped_and_expiry_is_enforced`）**
- [x] 准入 `Pairing` 态：仅 trust-status 首帧携带有效票据才进入；只允许 `/wasmnest/trust-status/1` 与 tunnel（且 tunnel 只到配对端点）；不放行 transfer/shared-dir/session 业务流。**（`server.rs` + `wasmnest-server-http/src/peer_face.rs::pairing_path_allowed`，含 `/api/auth/../` 与 `%2e%2e` 绕过拒绝锁）**
- [x] 配对连接注册表（宿主进程内共享，连接四元组为键，accept 时消费）：配对态连接 dial 对等面前登记，供 peer face 执行路径白名单（bedcode 仅 `/api/auth/*`，白名单外 403）；配对成功/票据失效立即清除；配对窗口连接不得复用于业务。**（`registry.rs`；`stop` / 票据 `revoke` 均清窗口）**
- [x] 配对成功写入信任后由移动端重建隧道（或宿主提升 Admitted）。**（口径 = 宿主提升：`matched` 每条入站流按信任表重算（R07 口径 A），配对成功后同一句柄上的新流即按已匹配准入，无需重建隧道；已配对但对端仍带票据时按一次性消费、不降级）**

**客户端与生命周期**

- [x] `connect` 幂等确保全局 peer 节点就绪；本地代理 listener **只绑 `127.0.0.1:0`**（不变量 1）；每条 accept 的 TCP 连接开一条新 tunnel 流；`close(handle)` 关 listener 与全部在飞流。**（`manager.rs::connect` / `proxy.rs`；回执 `address` 只回 IP 字面量，端口独立字段）**
- [x] 空闲超时只回收短连接 HTTP 流；WS 升级后的流按长连接处理（保活），不得杀静默终端 WS。**（`pipe.rs`；分片 `Upgrade` 头也识别，有锁）**
- [x] `expose` 幂等确保节点就绪；不直接管理 reservation（引用计数归 T06 宿主隧道管理器）。**（幂等命中时刷新 ACL；`kind=tcp` 不强制启动对等面）**

## 相关契约与锁

- WIT 变更纪律：compose 重拼 + `witSha256` + SDK/host-runtime lock + 按当前 SDK 全量重建；跨仓 tag 钉住。
- 权限 `tunnel:serve` / `tunnel:connect` 词汇在平台仓 T06 落地；本 ticket 的 manifest 声明先行设计。
- 错误码词表按设计 §7.1（`not-matched` / `ticket-expired` / `port-not-exposed` / `tunnel-limit` 等）。
- 不变量 16 的隧道侧匹配校验测试锁与 T07 路由侧锁配对。

## 实施记录（2026-11-08，能力仓 `feat/nat-traversal`，已提交 `974c813`）

**已落地（契约真源 + 机制 + 测试锁）**

- `wasmnest-server-peer-net/wit/tunnel.wit`：按 §9.2#8 已裁定口径新开 `package wasmnest:tunnel@0.0.1;`，`interface host-tunnel` 六原语（`expose` / `unexpose` / `connect` / `close` / `issue-pairing-ticket` / `status`，`connect` 带 `pairing-ticket`）、`record expose-config`、`world cap-tunnel`；独立版本轴，不混进主插件包。
- `wasmnest-p2p-engine/src/stream_proto.rs`：追加 `TUNNEL = "/wasmnest/tunnel/1"`，并注明**该协议接收器必须 `require_admitted = false`** —— `start_with_protocols` 对非 `TRUST_STATUS` 协议强制已准入，若沿用业务流闸门，未匹配 peer 的配对票据根本送不到服务端。
- `wasmnest-server-peer-net/src/tunnel/`（新模块，纯机制 / 端口抽象）：
  - `frame.rs`：首帧 `u32be len | JSON {v,port,kind,ticket?}`、响应 `{ok,caller:"peer",peerNodeId}`、长度上限与畸形帧拒绝（不回显票据明文）；`read_from` / `read_reply` / `write_reply` 异步帧 IO。**修复**：`read_from` 曾把已剥掉长度前缀的 payload 再当完整帧解码（服务端必失败），现有 `read_from_accepts_wire_hello_and_reply` 生产路径锁钉住。
  - `ticket.rs`：票据一次性消费、TTL ≤ 120s、绑目标端口、`AccessPath` 不参与校验（LAN/relay 双路径可用）、`revoke` / `purge_expired` 立即清窗口。
  - `policy.rs`：`expose` 规则表（幂等、默认不暴露）、准入顺序（规则 → 配额 → 已匹配/票据 → `allowedPeers` → 后端）；`kind=http` 后端恒为对等面，`kind=tcp` 只连回环且拒绝宿主管理端口（8765 / 节点端口 / peer face / relay 控制，由宿主注入实际端口）；缺隧道层验证过的 `peerNodeId` 的「已匹配」声明一律拒绝。
  - `registry.rs`：配对连接注册表（连接四元组 → `RequestFace`），实现 T03 的 `PeerFaceResolver`；查不到条目时保持「peer 面但无身份」，绝不回落普通面。
  - `proxy.rs`：本地 listener 只绑 `127.0.0.1:0`，每条 accept 连接开一条流，`shutdown` 关 listener 与在飞流，开流失败显性关闭本地连接。
  - `server.rs`（续作）：`TunnelServer::handle_stream` 按「首帧 → 票据消费 → `TunnelPolicy` 准入 → 连后端 → **在任何请求字节写入后端前登记 face** → 回 `caller=peer` 响应 → pipe → 清注册表」逐条裁决；`BackendConnector` 由宿主注入，返回后端流与本端连接四元组；失败一律回点名错误码，不静默连 8765。
  - `client.rs`（续作）：`open_tunnel_stream` 写首帧、校验 `ok=true` + `caller="peer"` + `peerNodeId` 形状（不变量 3）；未知服务端错误码收敛为 `peer-offline`，不把远端字符串当本地错误类型；`ClientConnector` 把 `TunnelStreamOpener` 接到 proxy 契约，一条 TCP 连接恰好一次握手。
  - `pipe.rs`（续作）：双向 pipe 的单流字节配额（双向共计数）、短连接 HTTP 空闲回收、按首块 HTTP `Upgrade: websocket` 头取消空闲超时（WS 保活）；指标只含字节数与 WS 标记，不记 payload。
  - `mod.rs`：错误码词表（§7.1 子集 + 新增 `invalid-frame` / `proxy-bind-failed` / `tunnel-idle`）、WIT 形状锁（独立包 / 六原语 / 单 world）。

**验证（实跑，磁盘清理后）**：`wasmnest-server-peer-net` 隧道模块 40 passed、`cargo test --offline` 全量 177 passed；`wasmnest-p2p-engine` 默认 42 passed、relay 45 passed / 1 ignored；peer-net `cargo check --offline --features common-host` 绿；两 crate `cargo fmt --check` 绿；`cargo clippy --offline --lib` 对 `src/tunnel/` 零 warning；能力仓 `platform_reference_registry_lock` 补跑 1 passed（上轮因磁盘 100% 失败，本轮磁盘 29G 可用）。crate 既有 15 warnings 与 1 个 `never_loop` deny 错误位于 `base/shared.rs`，与本轮无关。

**未跑项与原因（fail-visible）**：平台仓 / 测试仓跨仓锁未跑（平台侧未改、nat 平台工作树不存在）；双端 SDK 侧锁待 T06 建立平台工作树后补跑。

**未落地（2026-11-08 核销：本节原 6 项已全部由 T06 装配 / T07 状态栏完成）**

1. ✅ `host-tunnel` 的 provider 侧 WIT 绑定与六原语句柄表 —— T06（`tunnel/plugin_binding.rs` + 双端 `plugin/tunnel*.rs`）。
2. ✅ tunnel 流接收器接线（`start_with_protocols` 预注册 `TUNNEL` + `require_admitted=false`）与 `PairingRegistry::resolver()` 接对等面 —— T06（含 R09 / R14 锁）。
3. ✅ 引擎侧 `TunnelStreamOpener` / `connect`·`close` 句柄表 / `tunnel-closed` 语义 —— T06。
4. ✅ `peer:mode` / `peer:transport` / `tunnel:state` / `tunnel:error` 事件与状态栏 —— T06 + T07/T09。
5. ✅ compose 重拼 / `witSha256` / SDK 绑定 / 全量重建 —— T06（`host-runtime.lock` 待发布打 tag）。
6. ⏳ 真机 LAN + relay 双路径票据一次性验收 —— 仍归 T10（`artifacts` 为空、无真机）。

**接线语义修正（对照本票验收条件）**：T03 的 `PeerFaceResolver` 在 `app.rs` 是**每请求**调用（`wrap_fn` 按 `req.peer_addr()` 解析），不是每 accept 一次；故 registry 默认提供非消费 `resolve`，`consume` / `clear` 由宿主按连接生命周期（配对成功 / 票据失效 / 连接关闭）显式调用。若按请求消费，keep-alive 的第二个请求会丢掉面标记。face 登记发生在**首个请求字节写入后端之前**（等价于设计「dial 对等面前登记」的安全语义，且能在拿到本端连接四元组后执行）。其余「窗口只放行配对端点」判据不变，仍由 `peer_face_guard` 的白名单执行。

**基线对齐（2026-11-08 用户裁定：对齐多包基线）**：三仓 nat 工作树原基于 `feat/file-transfer-refactor`，能力仓单包 `wasmnest:plugin@0.0.2`、平台仓 compose v1；各仓 `dev` 已是多包（`wasmnest:peer@0.0.1` / `wasmnest:plugin@0.1.0` + compose v2）。执行方式 = 不 rebase / 不重置旧在途工作树，新建基于 dev 的对齐工作树：能力仓 `.worktrees/wasmnest-lib/nat-traversal-v2`（`feat/nat-traversal-v2`）、平台仓 `.worktrees/wasmnest/nat-traversal`（`feat/nat-traversal`）。T01–T05 改动以补丁 + 新文件迁到 v2，4 个与 dev 冲突的文件按 dev 语义重落。旧单包工作树保留归档；后续实施以 v2 为准。平台 caps.tunnel 登记与 compose 重拼归 T06。

**迁移线状态（2026-11-08 复核后更新）**：归档单包线 `feat/nat-traversal` 的 T01–T05 已提交（`c19938a` / `de87213` / `d8b1532` / `974c813`）；v2 对齐线已收口并合入能力仓 `dev`（`b129b19` 合流 + `560817c` 状态可拨地址 + `17b6080` 审核修复 R02–R15），`wasmnest-server-http` 的 `http_filter` 面标记押入锁与两 crate `fmt --check` 均已绿（见 `review-2026-11-08.md` §5/§8）。旧单包工作树仅作归档，不再作为交付线。

**错误码增补**：设计 §7.1 词表不是封闭集；实现侧新增 `invalid-frame`（畸形首帧 / 响应）、`proxy-bind-failed`（回环代理绑定 / 接受失败）、`tunnel-idle`（短连接 HTTP 流空闲回收），登记在此并已同步设计附录 C。