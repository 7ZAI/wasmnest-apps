# 内网穿透（NAT Traversal）实施 spec

> **状态**：draft（2026-11-07，基于评审修订版方案拆分，待方案复审通过后生效）
> **设计真源**：[`nat-traversal.md`](../nat-traversal.md)（2026-11-07 评审修订，待复审）。本文不复制机制细节，只定义**范围、契约、实施顺序、tickets 与验收**；机制判据以设计文档对应章节为准。
> **Tickets**：[`tickets/`](tickets/) 下 T01–T17，本地编号。`gh` 当前未认证（token 失效），**尚未提交 GitHub Issues**；认证恢复后按各 ticket 头部「落仓」逐条提交，并把本地编号替换为 `owner/repo#n`。

---

## 1. 目标与范围

**目标**：给 bedcode、file-transfer 及后续应用提供跨 NAT 的对等可达性。穿透是**宿主能力 + 中继基础设施**，不是新 wasm 应用；应用业务协议不变。

**范围内**：

- 能力仓：p2p-engine relay client、`host-tunnel` 能力与 `/wasmnest/tunnel/1` 流、对等 HTTP/WS 面（`HttpCaller::Peer`）、双端链加密豁免判据改面标记、`dial-peer-addrs`、`wasmnest-relay` 一键包（仅 Linux）。
- 平台仓：权限词汇（`tunnel:serve` / `tunnel:connect`）、compose / SDK / 双端宿主装配、`net.tunnel` 租约与 reservation 引用计数、§4.9 宿主侧网络判定、release-manifest。
- 应用仓：bedcode 双端（桌面 expose + QR v2 + 固定 `required`；移动 tunnel 客户端）、auth-center QR v2、file-transfer 多地址拨号 + 固定加密、桌面「中转服务器」卡片、**穿透配置中心（T18：统一设置 + 业务注册）**、双端 E2E 与验证模板。

**非目标（v1 明确不做）**：

- QUIC / DCUtR 打洞、UPnP（P3 评估，见 T16；可用性不依赖打洞）。
- 6 位码远程配对（v1 仅 LAN；远程走 QR / 连接串；PAKE 评估另议）。
- Windows / macOS relay 包（已裁定仅 Linux amd64/arm64 + Docker）。
- 官方公共 relay（是否提供待裁定，§9.2#1；自建是一等公民）。
- desktop↔desktop 互访、移动后台常驻接收（§9.2#6/#7，默认不做）。
- 存量 LAN 暴露修复**不混入本方案**——独立 ticket T17。

## 2. 已裁定口径（不可调，实现按此执行）

来自设计 §0.1/§0.3/§0.4/§4.10，评审已裁定：

1. **仅已匹配设备接入**：应用层配对 + 传输层 peer 信任两层同时成立；未匹配设备只能进短命配对窗口（票据 TTL ≤ 120s、一次性、绑目标端口不绑接入路径），窗口只放行配对端点。
2. **内网默认**：只有 §4.9 的「明确不在内网」判据才切 wan；同网段 timeout / `ECONNREFUSED` / 服务未启动 / 认证失败**不触发**自动切换，给手动「尝试外网」。
3. **加密永久强制、不可关闭**：peer/tunnel 强制 Noise；bedcode link-crypto 固定 `required`；file-transfer 应用层加密固定 `true`；无明文回退、无关闭开关；协商失败 fail-visible。
4. **双端链加密豁免判据必须是面标记**（不变量 15）：桌面 `link_crypto.rs` 源 IP 环回豁免、移动 `ws.rs` 环回目标跳过，全部改为面标记 / 代理句柄上下文；peer face 与本地代理流量不享受环回豁免。
5. **§0.4 三路由裁定**：`task-status` / `session-mode` / `terminal-bg` 对**经隧道的已匹配远端**保持可达（移动真实依赖 `session-mode`），访问控制由隧道匹配校验承担；run-* 四条桥接路由对 `peer` 一律 403。此裁定用户可否决；否决则 T05/T07 返工。
6. **relay 默认 open + 配额**，目标端匹配校验是授权权威；relay allowlist 只防滥用。
7. **bedcode 禁止裸转发 8765**：`kind=http` 走对等 HTTP/WS 面（caller=`peer`）；`kind=tcp` 只连回环且拒绝宿主管理端口。

## 3. 契约变更汇总（真源仓与版本纪律）

| 变更 | 真源仓 | Ticket |
| --- | --- | --- |
| `host-tunnel` WIT interface（configure/expose/unexpose/connect/close/issue-pairing-ticket/status；connect 带 `pairing-ticket: option<string>`；configure 带 `allow-wan` + `relay-addrs-json`） | 能力仓（**已裁定**落新 `wasmnest:tunnel@0.0.1` 独立包，§9.2#8） | T05（configure 为 T06 增量） |
| `/wasmnest/tunnel/1` 流协议（首帧 `u32be len \| JSON {v,port,kind,ticket?}`） | 能力仓 | T05 |
| `peer-node-config` 增 `relay-addrs` / `enable-relay`（或宿主设置驱动） | 能力仓 | T02/T05 |
| `dial-peer-addrs(endpoint-json)`（方案 B，旧 `dial-peer` 不动） | 能力仓 | T11 |
| `HttpCaller::Peer`（线协议 `caller:"peer"`）+ 对等面 listener + 面标记注入 | 能力仓 | T03 |
| 权限 `tunnel:serve` / `tunnel:connect` | 平台仓 SDK `permission.rs` | T06 |
| 双端豁免判据改面标记 | 能力仓 + 平台仓（移动 `ws.rs`） | T04 |

**版本纪律**：任何 WIT 变更 → compose 重拼 + `witSha256` 更新 + SDK / host-runtime lock 同步 + 按当前 SDK 全量重建相关 app；跨仓 tag 钉住（`lib-v*` / `apps-v*`），禁止把 `file:` / `path` 提交回仓库。relay 独立轴 `relay-vX.Y.Z`。

## 4. 不变量（验收基准，16 条）

实现必须机器判 / 测试锁，全文见设计 §6.2；tickets 按编号引用：

1. 客户端代理 listener 只绑 127.0.0.1。
2. `kind=tcp` 只连 127.0.0.1 且拒绝宿主管理端口；`kind=http` 只连对等面，永不连 8765。
3. `caller=peer` 永不当 `localhost`；bridge 路由对 `peer` 403。
4. 配对票据一次性、TTL ≤ 120s、绑目标端口（LAN/relay 均可用），用后失效。
5. relay 不记 payload / 文件名 / 路径；指标只含计数与字节数。
6. 无 relay 不静默降级公网明文直连；失败可见。
7. 应用撤销设备时 peer 信任同步撤销。
8. 未匹配 peer 不能开任何业务 tunnel/流；配对窗口只放行配对端点。
9. 只有 §4.9 明确判据触发 lan→wan；认证/信任/协议错误、同网段 timeout/`ECONNREFUSED` 不触发。
10. wan 不降低匹配/JWT 要求；relay 不是授权点。
11. WAN 数据面必须经过 Noise；relay 不得终止/解密。
12. bedcode link-crypto 固定 `required`、file-transfer 加密固定开（WAN/LAN 都强制）；无关闭开关；缺能力即失败。
13. relay 不接触 token/票据明文；6 位码走 relay 必须 PAKE；QR token 只走带外。
14. 加密策略只能按应用设置，宿主无「全局关闭加密」后门；`required` 缺链路身份必须拒绝。
15. 双端豁免/跳过判据必须是面标记，不得按源 IP/目标环回（双端各一条测试锁）。
16. 无 caller 门禁的免凭证路由经 peer face 仅对已匹配 peer 可达（§0.4 测试锁）；run-* 对 `peer` 一律 403。

## 5. 实施顺序与 ticket 依赖

按设计 §8「P1 实施顺序（依赖先行，避免契约半落地）」拆分。**P1 全部完成并验收后才动 file-transfer（P2）**，避免同时改两个应用的调用面。

```text
T01(P0 PoC)
  └─▶ T02(engine relay) ─┐
      T03(peer face) ────┼─▶ T05(host-tunnel 契约+流) ─▶ T06(平台装配) ─┬─▶ T07(bedcode desktop) ─┐
      T04(面标记豁免) ───┘   [T03 提供面标记机制/注册表]                ├─▶ T08(auth-center QR v2) ┼─▶ T09(bedcode mobile) ─▶ T10(P1 E2E)
                                                                      └─────────────────────────┘
P2: T11(dial-peer-addrs) ─▶ T12(file-transfer) ─┐
    T13(relay 一键包) ─▶ T14(中转服务器卡片) ────┼─▶ T15(P2 验收) ─▶ T16(P3 直连评估)
T17(存量 LAN 暴露)：独立，随时可开，不阻塞也不被阻塞
```

**实施进度（2026-11-07）**：T01/T02 已在能力仓分支 `feat/nat-traversal` 落实现（**已提交 `c19938a`，2026-11-08**）——`relay` feature（默认关闭）、
reservation 建立/释放/退避重连、多地址拨号、`transport` / `relay` 事件词汇、relay 域名解析与 PeerId 钉住；
native 双 feature 测试全绿、Android `cargo check` 绿且依赖树零 rustls/aws-lc/openssl-sys/quinn。T01 的
「两台不同 NAT 真机」验收待补。T03 起当时未开始。详见 [T01](tickets/T01-p0-relay-poc.md) / [T02](tickets/T02-engine-relay-client.md) 的「实施记录」。

**实施进度（2026-11-08 追加）**：T03 + T04 的**能力仓部分**已落地并提交（T03 `de87213` / T04 `d8b1532`）——`RequestFace` 面标记（server-base）、`serve_peer_face` 只绑 loopback、`HttpCaller::Peer` / 线协议 `caller:"peer"`、`peerNodeId` / `pairing` 上下文、配对窗口路径白名单、链加密豁免判据改面标记（不变量 15 桌面侧 3 条测试锁）；四个 crate `cargo test` 全绿（39/48/90/49）、`common-host` 两形态 check 绿、应用仓桥接门禁锁绿。T03 的宿主生命周期接线在 T06，T04 的移动侧代理判据 + 测试锁在 T09（事实核查：移动宿主当前无「环回跳过」逻辑）。详见 [T03](tickets/T03-peer-http-face.md) / [T04](tickets/T04-crypto-exemption-face-flag.md) 实施记录。

**实施进度（2026-11-08 追加 2，T05 两轮）**：T05 的**能力仓契约真源 + 流机制**已落地并提交（`974c813`）——独立包 `wasmnest:tunnel@0.0.1` WIT 分片（六原语）、`/wasmnest/tunnel/1` 首帧/响应线协议、暴露规则与准入（不变量 2/8/16）、一次性配对票据（不变量 4，LAN/relay 双路径）、配对连接注册表（接 T03 `PeerFaceResolver`）、只绑 loopback 的本地代理（不变量 1）；续作补服务端 `TunnelServer::handle_stream`（首帧裁决 → 后端连接 → face 登记 → 响应 → pipe → 清窗口）、客户端 `open_tunnel_stream` / `ClientConnector`（响应只认 `caller=peer`）、pipe 的字节配额 / 空闲回收 / WS Upgrade 保活，并修复 `read_from` 重复解帧缺陷。隧道模块 40 条单测全绿、`wasmnest-server-peer-net` 全量 177 绿、`wasmnest-p2p-engine` 双形态 45/42 绿、`common-host` check 绿、双 crate `cargo fmt --check` 绿、零平台引用锁补跑 1 passed（磁盘清理后）。**未落地**：WIT provider 绑定、tunnel 流接收器与引擎拨号接线、`connect`/`close` 句柄表、事件词表、平台 compose 重拼与产物重建，归 T06；[T05](tickets/T05-host-tunnel-contract.md) 的验收项仍全部未勾选，禁止把「机制已锁」当作整票完成。

**实施进度（2026-11-08 追加 2）**：T17（存量 LAN 暴露，独立于穿透）已实施——`task-status` / `session-mode` 两条免凭证端点加调用方门禁（`localhost`；`session-mode` 另认已验签 `device`），两条都放行隧道对等面 `peer`（授权在隧道 ACL，§0.4）；`terminal-bg` 不收紧并留残余风险记录（宿主静态路由，壁纸无敏感信息）。`cargo test --lib` 1012 passed、wasm release 构建绿。详见 [T17](tickets/T17-lan-exposure-authnone.md) 实施记录。

**实施进度（2026-11-08 追加 3）**：T13（`wasmnest-relay` 一键包）代码与交付物已落地（能力仓分支 `feat/relay-oneclick`）——libp2p Circuit Relay v2 服务端（HOP 显式开启）+ 配额（默认单 circuit 1 GiB / 1 小时，对齐 1GB 验收）+ 只绑回环的指标端点 + `open`/`allowlist` 准入 + 一次性 enrollment token（只落 sha256）+ `/wasmnest/relay-control/1` 控制协议 + `init`/`run`/`doctor`/`print-addrs`/`token create`；部署侧 `deploy/relay/`（Dockerfile / Compose / install.sh + systemd unit / 示例配置 / 运维手册）。127 条单测绿（含经 relay 建 circuit 并转发字节的端到端用例、白名单拒绝、端口/指标占用失败清场），`cargo build --release` + `run` 实跑通过。**未验证**：镜像/静态 musl 构建（本机无法访问 registry 与 crates.io）与真机跨网（归 T15）。平台仓已登记 `SCANNED_CRATES`（未提交）。详见 [T13](tickets/T13-relay-oneclick.md)。

**实施进度（2026-11-08 追加 4）**：T14（桌面「中转服务器」卡片）**应用侧已落地**，落点裁定为 bedcode desktop 设置页（应用级 KV `network.relay`）——部署文本生成（Compose / docker run / systemd，不含凭据）、`print-addrs` JSON / 文本 / multiaddr 导入（PeerId 解码 + 指纹本地复算、版本与协议不匹配显性拒绝）、当前配置展示与显式移除；40 条新单测 + bedcode 全量 1274 条（3 shard）绿、根 lint 0 error。**阻塞（显性）**：宿主 SDK 尚无 relay/tunnel 面（T06），「检测连通性」按钮保持禁用并给服务器侧 `doctor` 出路，未伪造能力；`relayAddrs` 的 §4.9 拨号消费在 T07/T12。真实宿主目验 / E2E 因 `host-runtime.lock.json` 的 `artifacts` 为空未跑（锚点已同步）。详见 [T14](tickets/T14-relay-settings-card.md)。

**实施进度（2026-11-08 追加 5）**：T07（bedcode 桌面）**应用侧无宿外面依赖部分已落地**——link-crypto 固定 `required`（不变量 12/14）：三档选择器退役为只读徽标，唯一写入口 `enforce()` 无入参只写 required，`load()` 自动收紧宿主旧值；身份未初始化 / 旧宿主 WS 帧加密未接线时**不写库也不宣称已加密**（`blockReason` + `lastError` 显性）；17 条新/改写单测 + bedcode 全量 1283 条（3 shard）绿、根 lint 0 error、前端产物构建成功、平台 `hostAppBoundaryLock` 7 passed。**未做（归 T06 落地后）**：expose/reservation、用已验证 peerNodeId 写信任、撤销级联（需 pairing→nodeId 映射）、设备页状态 UI；E2E 因宿主运行时 artifacts 为空未跑（锚点已补）。并发 CodeBuddy 会话在做 T06，无重叠。详见 [T07](tickets/T07-bedcode-desktop.md)。

**实施进度（2026-11-08 追加 5，T06 首轮）**：T06 的平台装配已完成第一轮（详见 [T06](tickets/T06-platform-assembly.md) 实施记录）——权限词汇双位进双端真源与 SDK 生成物（40 条）、`wasmnest:tunnel@0.0.1` 增加 `configure`（`allow-wan` / `relay-addrs-json`）、双端 compose 与 `witSha256` 同步、能力仓 `tunnel/manager.rs`（单一引用计数：生效 expose 规则 + 在飞 WAN 通道；0→1 reserve / 1→0 release）、`net.tunnel` 服务租约、WIT provider 绑定、桌面 `DesktopPeerFaceStarter`（`127.0.0.1:0` + 实际地址回写）与移动 `MobilePeerFaceStarter`（`tunnel-unavailable` 显性失败）、双端宿主 boot 装配。实跑：peer-net 200 passed（含 9 条管理器单测）、wasm-core 权限过滤 29 passed、双端 SDK `cargo check`、桌面 `check --lib` + tunnel 2 + bindings 4、移动 `check --lib` + tunnel 2、`compose-wit --all --check` 绿；`check-release-manifest` 的 packages / witSha 两项通过（其余为工作树无 tag 的环境性失败）。**未完成**：§4.9 模式判定与 8 态状态机、`peer:mode` / `tunnel:*` 事件桥、移动前台服务协作、T07/T08/T09 应用侧消费与真实宿主 E2E；T06 验收项尚不可整票勾选。

**实施进度（2026-11-08 追加 3，基线对齐）**：用户裁定「对齐多包基线」。已新建基于各仓 `dev` 的对齐工作树：能力仓 `.worktrees/wasmnest-lib/nat-traversal-v2`（`feat/nat-traversal-v2`）、平台仓 `.worktrees/wasmnest/nat-traversal`（`feat/nat-traversal`）、应用仓 `.worktrees/wasmnest-apps/nat-traversal-v2`（`feat/nat-traversal-v2`）；旧单包工作树保留归档。能力仓 T01–T05 改动以补丁 + 新文件全部迁移到 v2，4 个冲突文件按 dev 语义重落，验证实跑：6 crate `cargo check` 绿；单测 `server-core` 57+1 / `server-http` 99 / `server-websocket` 58 / `server-peer-net` 182 / `p2p-engine` 42（relay 45+1 ignored）全绿；6 crate `cargo fmt --check` 绿。`wasmnest:tunnel@0.0.1` 分片符合 compose v2 独立包形态。**剩余**：平台 caps.tunnel 登记 / 宿主 bindings / compose 重拼 / `witSha256` / 产物重建归 T06；应用仓并行在途实施（T13/T14 等）仍在旧工作树，未擅自迁移。

**实施进度（2026-11-08 追加 6，T08 续作）**：T08 的**无宿外面依赖部分已闭环**（详见 [T08](tickets/T08-auth-center-qr-v2.md) 实施记录）——QR v2 载荷双端契约（桌面 v1/v2 组装 + 校验、移动 v1/v2 与 `wasmnest://pair/<base64url>` 解析）、连接串**生产端**（桌面设备页「复制连接串」，剪贴板不可用显性失败）与**消费端**（移动手动输入框粘贴连接串 → 与扫码同一解析 `parseQrText`、同一结果卡与 token 认证路径，不开明文旁路）。实跑：桌面 1305 passed（4 shard；第 3 片 worker 默认 2 GB 堆耗尽属既有环境限制，剩余文件单跑通过）、移动 55 files / 664 passed、根 lint 0 error / 44 warning、双端 `vue-tsc --noEmit` 干净（桌面仅既存 `qrcode` 声明缺失）、桌面 `build:frontend` 与移动 `build` 均成功；新增锚点 `pairing-qr-copy-link`，移动既有 `mobile-*` 未改名。**未做**：`peer` 数据生产（`host-tunnel.status` / `issue-pairing-ticket`）、配对记录 `peerNodeId`、配对成功写 peer 信任——均待 T06 的宿外面进 SDK；E2E 因 `host-runtime.lock.json` 的 `artifacts` 为空未跑。

**实施进度（2026-11-08 追加 7，T06 第二轮：§4.9 模式判定）**：T06 的**传输模式判定与事件出口**已落地，落点裁定在**能力仓**（`wasmnest-server-peer-net/src/tunnel/{mode,netinfo}.rs`），平台仓本轮零改动——判据输入只有接口子网 / 蜂窝 / 拨号成因，与宿主类型无关，写两份必然漂移；能力仓本身就是宿主侧库，符合「判定由宿主完成、不暴露给前端 JS」。内容：判据表全实现（蜂窝直切 / 跨子网 / 无 LAN 候选 / `EHOSTUNREACH` 切 wan；timeout / `ECONNREFUSED` / 服务未启动 / 认证失败保持 LAN 并显性 `lan-unreachable`；事实未知一律先试 LAN）、8 态状态机与每对端视图（wan-active 回切需连续两次 LAN 探测成功）、`connect` 改 LAN-first（LAN 打通不建 reservation，进 wan 才按引用计数建）、失败成因分类（`DialTimeout` / 认证 / 传输层 unreachable / 保守 `Other`）、`status.modes`、`set_manual_wan` / `on_network_changed` / `on_lan_probe_result`，以及 `peer:mode` / `peer:transport` / `tunnel:state` / `tunnel:error` 四事件进宿主事件面 + 插件总线（topic 映射已补）。实跑：peer-net 默认 **236 passed**、`common-host,relay` **237 passed**、`fmt --check` 绿、平台桌面 `check --lib` + `plugin::tunnel` 2 passed 绿、移动 `check --lib` 绿。**未做**：wan-active 周期 / 换网 LAN 探测**循环**（状态与防抖已就绪，探测动作待消费端）、Android `ConnectivityManager` 精确网络类型（当前按接口名归类，认不出按非蜂窝）、`pairing` 态接线、移动前台服务、T07/T08/T09 消费与真实宿主 E2E；**未跑**（磁盘 100%）格式化后复跑与移动 `plugin::tunnel_ports` 2。详见 [T06](tickets/T06-platform-assembly.md)。

**实施进度（2026-11-08 追加 8，T06 第三轮 + T07/T08 宿外面消费）**：T06 补上
`host-tunnel.status` 的**本机可拨地址投影**（`node.addrs`：通配监听展开成 LAN IPv4、
不返回 `0.0.0.0`、relay circuit 排后），并修掉双端 SDK `connect` 的 `Option<String>`
→ `Option<&str>` 绑定类型错配（此前应用 crate 一按 `wasm` feature 编译即 E0308）。
应用侧 T07 接上 `tunnel:serve` → `configure`（应用 KV `network.relay` 推出 `allowWan`）
+ 幂等 `expose(kind=http)` + 设备页状态栏（8 态 + 常量「已加密」徽标）；T08 接上
`peer` 生产（`status.nodeId` + `node.addrs` + TTL=120s 一次性票据），`peer` 不可得时
回执带 `peerError`、载荷退回 v1 且界面显性提示「仅内网」。实跑：能力仓 peer-net
默认 240 / relay 241 passed + `fmt` 绿；bedcode rust 1023 passed/1 ignored +
`wasm32-wasip3` 构建绿；桌面前端全量单测 + `build:frontend` 绿；根 lint 0 errors /
44 warnings（既有基线）。**未做**：T07 配对成功写 peer 信任 / 撤销级联、T08
配对记录 `peerNodeId`、T09 移动 `tunnel.connect` 拨号消费、T10 真机 E2E；真宿主
目验受 `host-runtime.lock.json` 的 `artifacts` 为空阻塞。详见
[T06](tickets/T06-platform-assembly.md) / [T07](tickets/T07-bedcode-desktop.md) /
[T08](tickets/T08-auth-center-qr-v2.md) 实施记录。T11 由 pi agent 并行在途（双端
`peer.wit` + `HostPeer.peer_dial_addrs`），本轮已同步 bedcode 两处 native 测试替身；
compose 重拼 / `witSha256` / 全量重建归 T11。

**实施进度（2026-11-08 追加 10，T09 bedcode 移动）**：T09 的**拨号方应用切片**已落地（只改
`apps/bedcode/mobile/**`，与同 worktree 的 T06/T07/T08 在途改动零重叠）——新增 `rust/src/tunnel.rs`
（`TunnelHost` 端口 + 对端记录 `nodeId/relayAddrs/deviceName/逻辑端口/最近模式与原因`，**不存
LAN IP**、损坏显性报错；`configure` 的 `allowWan` 由设置 × relay 地址决定；拨号入参校验后原样
交给宿主做 LAN 优先判定；句柄登记 + `deactivate` 全关；`peer:mode`/`peer:transport`/
`tunnel:state`/`tunnel:error` 四 topic 订阅并转发 `bedcode-tunnel-event`、`peer:mode` 落盘）、
前端纯映射 `src/host/tunnel.ts`（八态文案 / 手动入口三条件 / 错误码映射 / 回执归一）、
扫码路径先建隧道再连回环代理（旧载荷不回归）、已连接与失败态两条状态栏（模式 + 不可关闭
「已加密」徽标 + 外网关闭提示 + 手动「尝试外网」）、断开/失败先关通道再断 WS。实跑：移动
`test:run` 56 files / **681 passed**（+17）、`cargo test --lib` **79 passed**（+22）、
`cargo check --target wasm32-unknown-unknown` 绿、`vue-tsc` 干净、`pnpm run build` 绿
（650,698 bytes 组件）、根 lint 0 error / 44 warning。**未做**：已匹配省略票据与历史/mDNS
重连（连接历史缺 `nodeId`，需先扩应用数据结构）、移动侧链加密测试锁（平台仓面）、
Android dev / 真机目验与双端 E2E（`host-runtime.lock.json` 的 `artifacts` 为空，既有缺口）。

| Ticket | 阶段 | 落仓（issue 真源仓） | 主题 | 依赖 |
| --- | --- | --- | --- | --- |
| [T01](tickets/T01-p0-relay-poc.md) | P0 | wasmnest-lib | relay PoC + Android 依赖树验证 | — |
| [T02](tickets/T02-engine-relay-client.md) | P1 | wasmnest-lib | p2p-engine relay client / reservation / 多地址 / 事件 | T01 |
| [T03](tickets/T03-peer-http-face.md) | P1 | wasmnest-lib | `HttpCaller::Peer` + 对等面 listener（安全测试先行） | — |
| [T04](tickets/T04-crypto-exemption-face-flag.md) | P1 | wasmnest-lib（平台联动） | 双端链加密豁免判据改面标记（不变量 15） | T03 |
| [T05](tickets/T05-host-tunnel-contract.md) | P1 | wasmnest-lib | `host-tunnel` WIT + tunnel 流 + ACL/票据/配对窗口 | T02、T03；§9.2#8 已裁定，§9.2#2 按 §6 默认口径 |
| [T06](tickets/T06-platform-assembly.md) | P1 | wasmnest | 权限/compose/SDK/双端装配/租约引用计数/模式判定 | T05 |
| [T07](tickets/T07-bedcode-desktop.md) | P1 | wasmnest-apps | bedcode 桌面 expose + 固定 required + 信任/撤销 | T06、T08（接口对齐） |
| [T08](tickets/T08-auth-center-qr-v2.md) | P1 | wasmnest-apps | auth-center QR v2 + 票据透传 + peerNodeId | T06 |
| [T09](tickets/T09-bedcode-mobile.md) | P1 | wasmnest-apps | bedcode 移动 tunnel 客户端 + 模式消费 + 重连 | T06、T08、T04 |
| [T10](tickets/T10-p1-e2e.md) | P1 | wasmnest-apps | P1 双端 E2E + 真机跨网 + 验证模板 | T07、T08、T09 |
| [T11](tickets/T11-dial-peer-addrs.md) | P2 | wasmnest-lib | `dial-peer-addrs` + 数据面多地址记忆 | T02 |
| [T12](tickets/T12-file-transfer-wan.md) | P2 | wasmnest-apps | file-transfer 远程传输 + 固定加密 | T11、T06 |
| [T13](tickets/T13-relay-oneclick.md) | P2 | wasmnest-lib | `wasmnest-relay` 一键包（仅 Linux） | T01（可与 P1 并行） |
| [T14](tickets/T14-relay-settings-card.md) | P2 | wasmnest-apps | 桌面「中转服务器」卡片（已裁定落点 bedcode 设置页） | T13 |
| [T15](tickets/T15-p2-acceptance.md) | P2 | wasmnest-apps | P2 验收：1GB 跨 NAT + 一键 relay 全流程 | T12、T13、T14 |
| [T18](tickets/T18-net-config-service.md) | P2 | wasmnest-apps | 穿透配置中心（服务型 wasm）：统一设置 + 业务注册 | T14（迁移来源）、T06 |
| [T16](tickets/T16-p3-direct-upgrade.md) | P3 | wasmnest-lib | 直连升级评估（QUIC/DCUtR/TCP 打洞/UPnP） | T15 |
| [T17](tickets/T17-lan-exposure-authnone.md) | 独立 | wasmnest-apps | 存量 LAN 暴露：三条 auth:none 路由收紧评估 | — |

**实施进度（2026-11-08 追加 9，T11：多地址拨号）**：T11 已收口（能力仓 `8e21f9a` / 平台仓 `816e828b` / 应用仓测试替身 `f0c0ff2a`）——`dial-peer-addrs` 契约（方案 B，旧 `dial-peer` 不动）、逐候选 3s 短超时按调用方顺序拨号、会话句柄记忆全部候选、数据面 send/browse/pull 与 resume 去发现缓存重拨、`transport` 进拨号结果与 `peer-connected` 事件；peer-net 提交面 247/248/248、双端宿主 `cargo check` 与 file-transfer 双端 wasm 构建绿（移动 `--frontend-only` 为 SDK `dist` 环境缺口）。详见 [T11](tickets/T11-dial-peer-addrs.md)。

## 6. 待裁定项（设计 §9.2）与默认执行口径

| # | 事项 | 默认执行口径（未裁定前） | 影响 ticket |
| --- | --- | --- | --- |
| 1 | 官方公共 relay | 不做；自建一键包覆盖 | T13 不阻塞；官方托管另开 |
| 2 | 匹配粒度/作用域 | **按设备 + 宿主全局信任现状**；per-app 隔离若要做需给信任条目加 app scope（契约变更，另开 ticket） | T05/T07 **开工前确认** |
| 3 | 同网段不可达处理 | 不自动切，只给手动「尝试外网」（设计默认） | T06/T09/T12 |
| 4 | 大文件中继阈值 | 无阈值；经 relay 给一次提示可取消（设计默认） | T12 |
| 5 | 6 位码远程配对 | v1 不做（仅 LAN）；坚持则单独 PAKE 评估 ticket | 范围外 |
| 6 | desktop↔desktop | 不做（桌面服务端 + 移动客户端） | 范围外 |
| 7 | 移动后台接收 | 不做（前台接收 + 前台服务保活） | T12 |
| 8 | `host-tunnel` WIT 归属 | **已裁定（2026-11-07，用户）**：新开 `wasmnest:tunnel` 包独立演进（与 `wasmnest:peer` 解耦）；T05 按此落地 | T05 解阻 |

另：T14 落点 app（候选 bedcode desktop 设置页）开工前确认；§0.4 裁定用户可否决（否决则 T05/T07 返工）。

## 7. 验证计划

**底线（设计 §8）**：跨网测试必须真机/真网络（手机蜂窝 ↔ 家庭宽带），不能只用 loopback/同机双进程代替；安全用例（peer face 拒绝 bridge、票据一次性、ACL、不变量 15/16）必须自动化。

| 阶段 | 验收出口 | 载体 |
| --- | --- | --- |
| P0 | 两台不同 NAT 机器经 relay 连通；file-transfer 帧协议在 relay 跑通；Android 依赖树零 rustls/aws-lc/openssl-sys；性能记录 | T01 |
| P1 | 移动经 relay 开桌面终端/JWT/WS 重连；run-* 403；三路由仅已匹配可达；票据一次性（LAN+relay）；配对窗口白名单；模式判定三用例；加密失败可见无明文回退；不变量 15 双端锁 | T10（双端 E2E + 真机） |
| P2 | 1GB 跨 NAT（断点续传跨 circuit 为预期）；暂停/恢复/取消；一键 relay 全流程（重启 PeerId 不变、抓包只有密文）；撤销立即失效；限额生效 | T15 |
| P3 | 直连成功率/吞吐对比 relay；失败回退不降级；Android 仍无 aws-lc | T16 |

各仓本地验证按 AGENTS.md §7：改前端 → 该 app `test:run` + 根 lint + 真实宿主目验；改交互面 → E2E 锚点同步；改 Rust → `cargo test` + 产物构建；改 WIT/契约 → 重拼 + 全量重建 + 平台锁。

## 8. 风险与跟踪

- 风险全文见设计 §9.1（12 项）；最高优先：#6 对等面平台改动 + 面标记判据（T03/T04）、#7 契约面扩散（T05/T06 版本纪律）、#9 强制加密破旧客户端（T07/T09 升级提示）。
- **跨任务冲突（2026-11-08 已消解）**：原记录风险为 T17 在途代码收紧 `task-status` / `session-mode` 门禁后会拒绝 `caller=peer`。核查当前实现：T17 已实施，`caller_allowed_for_none_auth` 两条端点均显式放行 `CALLER_PEER`（测试锁覆盖），与 §0.4 一致；详见 §5 T17 进度与 [T17](tickets/T17-lan-exposure-authnone.md)。剩余工作为 T10 E2E 用真机跨网复核「已匹配 peer 可达 + run-\* 仍 403」，无需再裁定 §0.4。
- **证据漂移（2026-11-08）**：设计附录 B 若干行号 / 路径与当前代码不符（环回豁免位置、移动 `ws.rs` 路径与行为、链加密策略非三态枚举）；已登记于设计文档附录 C，后续 ticket 按代码真源实施。
- **基线对齐（2026-11-08 用户裁定：对齐多包基线）**：三仓 nat 工作树原基于 `feat/file-transfer-refactor`（能力仓单包 `wasmnest:plugin@0.0.2` + 平台 compose v1），各仓 `dev` 已是多包（`wasmnest:peer@0.0.1` / `wasmnest:plugin@0.1.0` + compose v2）。执行方式 = **不 rebase / 不重置旧在途工作树**，新建基于各仓 `dev` 的对齐工作树：能力仓 `.worktrees/wasmnest-lib/nat-traversal-v2`（分支 `feat/nat-traversal-v2`，基于 6b4275f）、平台仓 `.worktrees/wasmnest/nat-traversal`（分支 `feat/nat-traversal`，基于 9a0fb2bc）；旧 `feat/nat-traversal` 工作树保留为单包归档。能力仓 T01–T05 改动以补丁 + 新文件迁移，4 个与 dev 冲突的文件按 dev 语义重落；平台侧 cap-tunnel 接线、compose 重拼与产物重建归 T06；应用仓对齐待后续。
  - **当前实态（2026-11-08 核查）**：归档单包线的 T01–T05 已提交（`c19938a` / `de87213` / `d8b1532` / `974c813`），native 测试与 `fmt` 全绿。v2 迁移线**未收口且未提交**——缺 `http_filter.rs` 的面标记注入 service 级锁（T04 锁之一），`wasmnest-server-http` / `wasmnest-server-websocket` 的 `cargo fmt --check` 未过。v2 补锁 + fmt + 实跑 + 提交之前，不得当作交付线，也不得据此宣布「已对齐多包基线」。
- 方案本身**待复审**：本 spec 与 tickets 在复审通过前不实施；复审若推翻 §0.4 或面标记裁定，回改 T03/T04/T05/T07。
- tickets 提交 GitHub 后，本文 §5 表格与 ticket 头部的本地编号替换为 issue 编号；依赖关系用 GitHub native issue dependencies 维护（不可用时退回 `Blocked by:` 行）。
**实施进度（2026-11-08 追加 11，T07/T08 收尾：配对信任写入与撤销级联）**：用户裁定选 A（先补契约缺口）。能力仓新增
`host-peer.trust-node`（唯一信任写入原语，幂等、落盘失败显性上抛；`peer` 权限不增词表）；平台双端 SDK 补 trait 方法
`peer_trust_node` 并 `compose-wit --all` 重拼；auth-center 的 `_http_endpoint` 只采信宿主注入的 `caller=peer` 上下文
（`PeerFace`），配对记录新增 `peer_node_id` 列（建表 + 老库补列），`verify`/`qr-connect` 成功后写信任（记录或信任失败均
显性中止，不发半个 token），撤销时按记录 nodeId 级联 `revoke-trusted`（已软删记录重复撤销会重放级联，避免「UI 幂等成功、
隧道仍匹配」）。实跑：peer-net 254 / 255（默认 / `common-host,relay`）、auth-center 138 passed + wasm32-wasip3 release 构建绿、
双端 SDK `check --features wasm` 绿、`compose-wit --all --check` 绿、bedcode 1023 passed/1 ignored、file-transfer rust 98 +
desktop 10 files/59 passed。**未做项更新（2026-11-08 追加 12）**：旧客户端 `encryption-unsupported` 宿主侧判定**已落地**
（能力仓 `link-crypto` 新增拒绝码头 `X-WasmNest-Crypto-Error` + 两个码，`server-core` /
`http_filter` / WS 升级门禁下码，平台移动宿主把码透回应用；判据与实跑见
[T07](tickets/T07-bedcode-desktop.md) §8），从「未做」移除；仍剩：真宿主 E2E（`artifacts`
仍为空）、移动端 `encryption-unsupported` 的逐字文案区分（归 T09/T10）。
文档勾选未提交：同批文档文件另有并发会话（T12）与 T06 第三轮在途记录。详见 [T07](tickets/T07-bedcode-desktop.md) /
[T08](tickets/T08-auth-center-qr-v2.md) §7。

**实施进度（2026-11-08 追加 13，T06 第四轮：回切探测循环 + `pairing` 态接线 + 勾选复核）**：T06 最后两个「机制在、行为不在」
的缺口已闭环（详见 [T06](tickets/T06-platform-assembly.md) 第四轮实施记录）——`wan-active` 周期（默认 30s）LAN 回切探测循环
（`TunnelManager::probe_wan_peers_once` + 懒启动任务；先**非破坏性 TCP 探活**、连续两次成功后才真实拨号并切 `lan-active`，
拨号失败保持 `wan-active` 并清零；手动「尝试外网」不参与探测；relay-only 拨号不清已记的 LAN 候选），以及 `pairing` 态接线
（未匹配的入站流投影 `pairing`、窗口结束回落 `offline`；未匹配 + 票据的 `connect` 拨号期投影 `pairing`，链路就绪后回到真实传输模式）。实跑：peer-net 默认 **286 passed**、
`common-host,relay` **284 passed**、`fmt --check` 绿；平台双端 `cargo check --lib` 绿。

同轮把 T05 / T06 / T07 / T08 / T10 的勾选按代码真源复核回写（此前多张单据的实现记录已写而清单仍旧）：
T05 验收项全勾（真机双路径验收归 T10）；T06 只剩 4 项未完成——`check:manifest` 的 tag 项、移动前台服务、Android
`ConnectivityManager`、换网→`on_network_changed` 的平台触发；T07 的信任写入 / 撤销级联 / §0.4 测试锁三项已勾（真宿主目验仍缺）；
T08 的 `peerNodeId` 落库与信任写入已勾；T10 的安全用例按「已有自动化锁」逐条点名（移动侧链加密锁仍缺），
`docs/verification/bedcode.md` 新增 **F-16 内网穿透（跨网）S-16-01..11** 与 P-09 前置。

**仍未完成（P1 收口口径不变）**：T10 全部真机 / 双端 E2E（`host-runtime.lock.json` 的 `artifacts` 为空、无真机）；T09 历史 / mDNS
重连（连接历史缺 `nodeId`，需平台移动 SDK 数据结构变更）与移动侧链加密测试锁；T01 两台不同 NAT 真机与 PoC 报告实测数据；
T14「检测连通性」（宿主 `status` 尚无 relay RTT 投影）。

**实施进度（2026-11-11 追加 14，T19：relay 连通性探测）**：T19 四仓代码已落地（**未提交**），本节取代「追加 12」中把 T19 列为阻塞的表述。能力仓新增 `wasmnest-p2p-engine::probe`（一次性 swarm：tcp + noise + yamux + ping、随机身份、无 listener；拨号前剥掉 `/p2p/<relay>` 让 Noise 实测身份再比对）与 `wasmnest-server-peer-net::tunnel::probe`（权限门 / 地址形状与同 PeerId 校验 / 域名解析 / ≤16 条 / 在飞 1 个 + 2s 冷却 / `code: detail` 映射，且**不依赖 TunnelManager**）；WIT `wasmnest:tunnel@0.0.1` 追加 `probe-relay`，词表 41 条（`tunnel:probe` 独立第三位）。平台仓双端 SDK trait/impl + compose 重拼 + 描述符锁三位 + `witSha256`；应用仓 net-config 命令（只读 KV 已保存地址）/ 组件 / i18n / 单测 / E2E 锚点。§9 两项按默认口径裁定（`tunnel:probe`；v1 只做可达 + PeerId + RTT）。实跑：p2p-engine **46**、peer-net probe **7**、`relay-transport/relay_probe` **4**（真 relay，指纹与 `RelayIdentity::fingerprint()` 逐字相等、`reservations_active == 0`）、net-config rust **28** / vitest **67**、双端宿主描述符锁 **6 + 3**、`compose-wit --all --check` 绿。**未做（显性）**：发布链（重打宿主 + 刷新 `host-runtime.lock.json`）、真宿主对已部署 relay 的点击与 E2E 实跑（`artifacts` 仍为空）。§4.1 反向风险已回写：**新 guest 在旧宿主上实例化失败**（缺 `probe-relay` 导出），发布必须宿主与消费方同批重打。详见 [T19](tickets/T19-relay-probe.md) §11。
