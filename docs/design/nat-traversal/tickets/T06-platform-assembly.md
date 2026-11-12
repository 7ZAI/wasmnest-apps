# [feat] T06 · 平台仓：权限词汇、compose/SDK、双端宿主装配与传输模式判定

- **落仓**：`7ZAI/wasmnest`（平台协调 issue，正文点名 lib / apps 子任务交叉引用）
- **标签**：`kind:feature`、`cross-repo`
- **阶段**：P1 ｜ **依赖**：T05（WIT 定稿）｜ **状态**：待提交 GitHub（gh 未认证）
- **设计依据**：§4.2（地址解析）、§4.8、§4.9、§5.1/§5.2、§8 P1 顺序 4
- **基线对齐（2026-11-08 用户裁定：对齐多包基线，已开工）**：平台工作树 `.worktrees/wasmnest/nat-traversal`（分支 `feat/nat-traversal`，基于 `dev` 9a0fb2bc）已建立；能力仓对齐工作树为 `.worktrees/wasmnest-lib/nat-traversal-v2`（分支 `feat/nat-traversal-v2`，基于 `dev` 6b4275f）。旧单包 nat 工作树保留归档，不再作为实施基线。T06 在平台 v2 工作树上做 caps.tunnel 登记 / 宿主 bindings / compose 重拼 / `witSha256` / 全量重建。详见 spec §8。
- **装配已具备的机制面（2026-11-08）**：T05 已提供 `TunnelServer::handle_stream` / `TunnelPolicy` / `TicketIssuer` / `PairingRegistry::resolver()` / `ClientConnector` / `BackendConnector` / `TunnelStreamOpener` / `PipeLimits`，宿主只需注入实际端口与信任表、注册 `TUNNEL`（`require_admitted=false`）、实现引擎拨号与句柄表，不重复实现安全判定。

## 需求描述

把 T02–T05 的能力装进双端宿主：权限词汇、compose/SDK 绑定、服务租约、reservation 引用计数、peer face 生命周期、移动本地回环代理与前台服务协作，以及 §4.9 的宿主侧网络判定（不暴露给前端 JS）。

## 落点 app 与端

平台：桌面宿主 + 移动宿主；权限真源 `plugin-sdk-desktop/rust/src/permission.rs`。

## 验收条件

**契约与装配**

- [x] 权限词汇新增 `tunnel:serve`（expose/unexpose/issue-pairing-ticket）与 `tunnel:connect`（connect/close；status 归属一并定）；manifest 校验同步；未声明应用永远 lan-only。**（40 条词汇双端真源 + SDK 副本；`status`/`configure` 允许任一权限）**
- [ ] compose.json / SDK 绑定 / `witSha256` / host-runtime lock / `release-manifest.json` 同步；`check:manifest` 绿。**（compose / SDK / `packages` / `witSha256` 已同步且 `compose-wit --all --check` 绿；`check:manifest` 仍余 lib/apps 工作树无精确 tag 的项：发布打 tag 后复跑）**
- [x] 桌面装配 `net.tunnel` 服务租约（或复用 `net.peer-node`）；peer face 启动/关闭跟随 `tunnel:serve` 规则。**（`plugin/tunnel.rs` + `tunnel/service.rs`；`stop` 清规则/票据/在飞流）**
- [x] 移动装配 `host-tunnel` client 绑定、本地回环代理、前台服务协作（前台建立、离开终端页关闭）。**（绑定与回环代理已落地（`plugin/tunnel_ports.rs` + `MobilePeerFaceStarter` 显性 `tunnel-unavailable`）；前台服务保活**未接**——见下方拆分项）**
- [ ] 移动前台服务协作（Android foreground service 保活；`connect` 的服务租约已记账，OS 级保活未接）。

**reservation 引用计数（单一所有权）**

- [x] 宿主隧道管理器统一引用计数：计数来源 = 生效 expose 规则（`allowWan=true` 才计入）+ 客户端在飞 WAN 拨号；0→1 建立、1→0 释放。
- [x] `expose`/`unexpose`、`allowWan` 开关、服务租约只改计数，不各自直接管理 reservation。
- [x] `allowWan=false` 时即使有 expose 规则也不建立/保留 reservation（LAN 入口不受影响）；lan-active 期间 reservation 可保留（控制面），受同一计数与 `allowWan` 门控。**（`recount` 只计 `allowWan=true`；`connect` 在 `allowWan=false` 时只滤掉 relay 候选、LAN 照拨（R03））**

**§4.9 宿主侧模式判定**

- [ ] 网络类型（Android `ConnectivityManager`）与接口子网枚举由宿主完成；应用只读 `host-tunnel.status` 与 `peer:mode` 事件。
  **（部分：接口子网 + 蜂窝归类已由能力仓 `tunnel/netinfo.rs` 完成并进 `status.modes` / `peer:mode`；Android 仍走 `getifaddrs` + 接口名，未接 `ConnectivityManager`。）**
- [x] 「明确不在内网」判据表全实现：蜂窝直切；候选 IP 不在任何接口子网且无 mDNS；无 LAN 候选；`EHOSTUNREACH`/`ENETUNREACH`。同网段 timeout/`ECONNREFUSED`/服务未启动 → `lan-unreachable` + 手动入口；认证/信任/Noise 失败不切；刚换网等 5s 发现窗口。
  **（已实现并有测试锁；发现窗口分支按 `LanCandidateSource::Mdns` 判，`connect` 用显式候选故不走该分支。）**
- [x] 状态机：`pairing / lan-probing / lan-active / lan-unreachable / wan-connecting / wan-active / wan-unavailable / offline`；wan-active 周期（30s）探测 LAN，连续两次成功才切回。**（第四轮：`TunnelManager::probe_wan_peers_once` + 懒启动周期循环（30s，可覆盖）；先非破坏性 TCP 探活、连两次成功后才**真实拨号**并切 `lan-active`；手动外网不参与探测；`pairing` 态已接线（未匹配入站流投影 `pairing`、窗口结束回落 `offline`；未匹配 + 票据的 `connect` 在拨号期投影 `pairing`，链路就绪后回到真实传输模式，避免配对完成后一直显示「配对中」））**
- [ ] 换网触发：宿主调 `on_network_changed` 把非 `offline` 对端回 `lan-probing`（能力仓 API 已就绪，平台侧无网络变化监听：Android 未接 `ConnectivityManager`、桌面未接网络事件）。
- [x] relay 域名经宿主 `lookup_host` 解析（T02 口径）。**（`configure` / `recount` 走 `resolve_relay_addr`；解析失败点名原始地址）**

## 相关契约与锁

- 平台桌面 + 移动测试全量绿（含 `hostAppBoundaryLock` 不受影响）；新增隧道/对等面测试。
- 事件词表：`peer:transport` / `peer:mode` / `peer:encryption` / `tunnel:state` / `tunnel:error`（设计 §7.2）。
- 模式是**每对端**的，不是全局开关；手动「尝试外网」本次网络会话内保持，换网回自动策略。

## 实施记录（2026-11-08，本轮）

**已落地（实跑通过）**：

1. **权限词汇**：`tunnel:serve`（expose / unexpose / issue-pairing-ticket）与
   `tunnel:connect`（connect / close）进双端真源（`wasmnest-wasm-core::permission`）
   与两端 SDK 副本；`status` / `configure` 允许任一权限（只读投影与通道配置不单独
   构成暴露面）。SDK 生成物 `bin/permission-vocabulary.json` 重出（38 → 40 条）；
   两端 manifest-gen 增加 `tunnel_*` Rust 调用推导规则。未声明应用永远 lan-only。
2. **契约**：`wasmnest:tunnel@0.0.1` 增加 `configure` 原语（`allow-wan` +
   `relay-addrs-json`，`result<bool,string>`）——**为什么需要**：`allowWan` 是应用
   自持设置，宿主按它做 reservation 门控，原 T05 分片没有入口。`expose-config` 形状
   不变。双端 `compose.json` 增加 `caps.tunnel`，`compose-wit --all --check` 绿；
   `release-manifest.json` 的 `packages` 增加 `wasmnest:tunnel@0.0.1`、`witSha256`
   重算为 `31fbb330…67d2`（`check-release-manifest` 的 packages/hash 两项通过；另 3
   项失败为环境性：lib/apps 工作树无精确 tag、apps 链接指向旧工作树）。
3. **能力仓机制层**：新增 `tunnel/manager.rs`（**单一引用计数**：生效 expose 规则
   `allowWan=true` 且配置 relay 地址才计入 + 客户端在飞 WAN 通道；0→1 reserve、
   1→0 release；句柄 / 规则属主仲裁；`status` 投影；入站 `/wasmnest/tunnel/1`
   接收循环）、`tunnel/service.rs`（`net.tunnel` 服务租约）、
   `tunnel/plugin_binding.rs`（`host-tunnel` 双权限门 + 租约 acquire/release +
   模块自报；WIT provider 绑定补齐 T05 遗留）。`TunnelPolicy` 支持先装配后
   `set_peer_face`（宿主 listener 端口由系统分配）；`server-core` 增加
   `serve_peer_face_on`（返回实际 loopback 地址）；p2p-engine 再导出 `Multiaddr`；
   peer-net 增加 `relay` feature 转发。
4. **桌面装配**：`plugin/tunnel.rs`（端口 adapter + `expect_host_module!` +
   装配器静态 + `DesktopPeerFaceStarter`：独立 Actix 线程绑 `127.0.0.1:0`，
   实际地址写回策略黑名单）；boot 期构造管理器并注册 `net.tunnel`，先于
   `PluginHost::new`。
5. **移动装配**：`plugin/tunnel_ports.rs`（端口 adapter + 装配器静态）；
   `MobilePeerFaceStarter` 对 `expose` / `issue-pairing-ticket` 显性返回
   `tunnel-unavailable`（移动端是拨号方，不伪装服务端能力）；boot 期注册
   `net.tunnel` 并装端口。

**验证（实跑命令与结果）**：

- 能力仓 `wasmnest-server-peer-net`（`--features common-host,relay`）全量 200 passed
  （含新增 9 条 manager 单测：引用计数共享、`allowWan` 门控、属主仲裁、
  WAN 拨号失败回滚、stop 清场）；`wasmnest-wasm-core` 权限过滤 29 passed。
- 双端 SDK `cargo check` 绿（desktop / mobile 的 `rust/`）。
- 平台桌面 `cargo check --lib` 绿；`plugin::tunnel` 2 passed、`plugin::bindings`
  4 passed（含新增 tunnel cap 的双向覆盖锁）。
- 平台移动 `cargo check --lib` 绿；`plugin::tunnel_ports` 2 passed。
- `node scripts/compose-wit.mjs --all --check` 绿。
- 未跑：移动 `mobile_wit_composition_lock` / `host_module_desc_noun_lock` 集成测试
  （构建中途磁盘满，清理 target 后未重跑；生成物 include 集已由 `compose-wit
  --check` 覆盖）；桌面/移动全量测试与真实宿主 E2E（需 T07/T09 接线）。

**未完成（不得当作整票完成）**：

- §4.9 宿主侧模式判定（Android `ConnectivityManager` / 接口子网枚举 / 「明确不在
  内网」判据表 / 8 态状态机 / `peer:mode` 事件 / wan-active 30s 与换网两次成功回切）
  **未实现**；`status` 只投影节点 / 对等面 / relay 状态。
- `peer:transport` / `tunnel:state` / `tunnel:error` 事件桥未接（管理器已有状态
  快照，事件出口在应用仓 T07/T09 消费前补）。
- 移动前台服务协作未接（`connect` 的服务租约已记账，Android 前台服务保活归 T09）。
- 应用侧 consumer：bedcode 桌面 expose / auth-center QR v2 / bedcode 移动 connect
  分别归 T07/T08/T09；本轮只保证契约与宿主装配可用。

## 实施记录（2026-11-08，第二轮：§4.9 模式判定 + 事件出口）

**落点裁定（与首轮的差异，先看这里）**：§4.9 判定落在**能力仓**
`wasmnest-server-peer-net/src/tunnel/{mode,netinfo}.rs`，平台仓本轮**零改动**。
理由：判据的输入只有「接口子网 / 蜂窝 / 拨号成因」，与宿主类型无关；写两份
（桌面 + 移动）必然漂移，且设计禁止把判据暴露给应用 JS——能力仓本身就是宿主侧
库。`switch`/`modes` 只做「给判据 + 记账」，安全判定仍全在 T05 模块。

**已落地（实跑通过）**：

1. **判据表全实现**（`mode::judge_before_lan` / `judge_after_lan_failure`）：
   蜂窝直切；候选不在任何接口子网且无 mDNS；无 LAN 候选（显式来源）；全部候选
   `EHOSTUNREACH`/`ENETUNREACH` → 切 wan；同网段 timeout / `ECONNREFUSED` /
   服务未启动 / 认证失败 / Noise 失败 / 无法归类 → 保持 LAN（`lan-unreachable`
   + 手动「尝试外网」）。**事实未知（枚举失败 / 只有环回）一律先试 LAN**，不猜。
2. **8 态状态机 + 每对端视图**（`ModeMachine`）：`pairing / lan-probing /
   lan-active / lan-unreachable / wan-connecting / wan-active / wan-unavailable /
   offline`；`peer:mode` 词表字面与归因（`cellular` / `different-subnet` /
   `no-lan-candidate` / `host-unreachable` / `user` / `wan-disabled` /
   `relay-unavailable` / `lan-restored` / `network-changed`）；wan-active 回切
   `lan-active` 需**连续两次**探测成功（`LAN_RESTORE_PROBES = 2`）。
3. **`connect` 改 LAN-first**：候选按 `/p2p-circuit` 拆成 LAN / relay 两组；LAN
   先拨（3s/候选），失败按成因决定是否进 wan；进 wan 才 `acquire_wan`（预留 →
   拨号 → 失败回滚计数）。LAN 打通不建立 reservation（lan-active 无中继流量）。
4. **失败成因分类**（`TunnelEngine::dial_classified`）：`DialTimeout` → timeout；
   `NotAdmitted` / `NodeIdMismatch` / `UnsupportedPeerIdentity` → auth；传输层文本
   里的 `no route to host` / `network is unreachable` → unreachable；其余 → `Other`
   （保守 = 保持 LAN）。**已知局限**：成因取 `io::Error` 的 Display 文本（Linux /
   Android 同源），要更精确需 p2p-engine 在拨号路径回结构化 cause（未做）。
5. **网络事实**（`netinfo::system_network_facts`）：`if-addrs` 枚举接口地址 +
   前缀长度；接口名归类（`rmnet*`/`ccmni*`/`pdp*` 等 = 蜂窝，`wlan*`/`eth*` = 非
   蜂窝）；链路本地与环回不入子网；**Android 走 `getifaddrs`，未接
   `ConnectivityManager`**（老 RW 网络类型是增强项，判据方向不变：认不出蜂窝就
   按「非蜂窝」先试 LAN）。
6. **事件出口**（设计 §7.2 四个）：`peer-mode` / `peer-transport` /
   `tunnel-state` / `tunnel-error`，经 `TunnelEngine::emit` → 能力仓既有
   `emit_json`（宿主事件面 + 插件总线双写），总线 topic 映射补进
   `bus_topic_for`（`peer:mode` / `peer:transport` / `tunnel:state` /
   `tunnel:error`）。
7. **`status` 增 `modes`**（`PeerModeView`：nodeId / mode / reason /
   lanProbeWins / manualWan / updatedAtMs）；新增 `set_manual_wan`（会话内保持）、
   `on_network_changed`（清手动指令 + 计数，非 offline 回到 lan-probing）、
   `on_lan_probe_result`（wan-active 回切防抖记账）；`close` 最后一个句柄 →
   `offline` + `tunnel:state:closed`。

**验证（实跑命令与结果）**：

- 能力仓 `wasmnest-server-peer-net`：`cargo test --offline --lib` = **236 passed**；
  `--features common-host,relay` = **237 passed**（新增判据 / netinfo / manager
  接线共 36 条，含「同网段 timeout 不切 relay」「认证失败不切 relay」
  「蜂窝直切」「未知事实先试 LAN」「两次探测才回切」「手动入口会话内保持」）。
- `cargo fmt --manifest-path wasmnest-server-peer-net/Cargo.toml -- --check` 绿。
- 平台桌面 `cargo check --lib` 绿；`plugin::tunnel` 2 passed。
- 平台移动 `cargo check --lib` 绿。
- **未跑（环境，非代码）**：格式化后复跑能力仓单测与移动
  `plugin::tunnel_ports` 2 passed —— 磁盘 100%（仅 5.3 MB 可用），
  `rm -rf` 清理构建目录的授权两次超时。清理后按上面两条命令补跑即可。

**验收勾选变化**：本轮的 §4.9 相关三条从「未实现」变为「部分完成」——
接口子网 / 蜂窝归类 / 判据表 / 8 态 / 双探测回切 / 事件出口已落地；
**未完成**：wan-active 周期（30s）与换网时的 LAN 探测**循环**（判定与防抖已就绪，
探测动作留给消费端：wan 期间重新 `dial` 会按引擎语义断开现役链路，需专门的探活
方式）；Android `ConnectivityManager` 精确网络类型；`pairing` 态接线（等 T09 配对
流程消费）；移动前台服务；T07/T08/T09 应用侧消费与真实宿主 E2E。

## 实施记录（2026-11-08，第三轮：`status` 可拨地址投影 + SDK 绑定修复）

**为什么**：T08 的 QR v2 载荷需要「怎么找到本机」——`peer.addrs` 必须是真能拨的
multiaddr，而 `status.node` 当时只有 `started` / `nodeId`，应用无法凭空推出监听端口
（更不能把 `/ip4/0.0.0.0` 外发）。同时首次把应用 crate 按 `features = ["wasm"]`
链接到 T06 SDK 时暴露了一处 guest 绑定类型错配，本轮一并修掉。

| 仓 | 落点 | 内容 |
| --- | --- | --- |
| 能力仓 | `tunnel/manager.rs` | `NodeSnapshot` 增 `addrs: Vec<String>`（camelCase 进 `status.node.addrs`）；新增纯函数 `dialable_addrs(listen, local_ipv4, relay_addr, peer_id)`：通配监听展开成本机 IPv4、环回/链路本地/组播/端口 0 丢弃、relay 预留时追加 `<relay>/p2p-circuit/p2p/<self>`，去重保序（LAN 在前）；`PeerCtxEngine::node_snapshot` 接 `RunningNode::listen_addresses()` / `relay_status()` |
| 能力仓 | `tunnel/netinfo.rs` | `dialable_ipv4_from()`（纯函数，丢环回 / 链路本地 / IPv6 / 虚拟网卡）+ `dialable_ipv4_addrs()`（枚举失败回空，不猜地址） |
| 平台仓 | 双端 SDK `rust/src/wasm_host.rs` | `host_tunnel::connect` 的 WIT 生成参数 `option<string>` → `Option<&str>`，SDK 却传 `Option<String>`（trait 签名）。改 `pairing_ticket.as_deref()`；桌面/移动同一处 |

**验证**：能力仓 `wasmnest-server-peer-net` 默认形态 **240 passed**、
`--features common-host,relay` **241 passed**（新增 4 条：通配展开 + relay 追加、
端口 0 不猜、LAN IPv4 白名单、只有虚拟网卡回空）、`cargo fmt --check` 绿；
T11 改动落入同一工作树后复跑 relay 形态 **252 passed / 0 failed**、`fmt --check`
仍绿（增量来自 T11）；双端 SDK `cargo check --features wasm` 通过；
应用侧 bedcode rust **1023 passed / 1 ignored**、前端全量单测、`build:frontend`、
`wasm32-wasip3` 构建均绿（详见 [T07](T07-bedcode-desktop.md) §5 /
[T08](T08-auth-center-qr-v2.md) §6）。

**注意（并行变更）**：本轮验证期间平台仓工作树同时有 T11 在途改动
（`dial-peer-addrs` 进 `HostPeer` trait + WIT + 双端 `wasm_host.rs`，pi 会话）。
SDK 绑定修复与 T11 落在同一文件，合流时按「T11 的 `peer_dial_addrs` +
本轮的 `.as_deref()`」两处一起保留；`witSha256` / compose 重拼 / 全量重建归 T11。

**仍未完成（第三轮时点）**：§4.9 的 30s 探测循环 / Android `ConnectivityManager` / `pairing` 态
接线 / 移动前台服务——前两项中的探测循环与 `pairing` 已在第四轮补上，见下节。
## 实施记录（2026-11-08，第四轮：回切探测循环 + `pairing` 态接线）

**为什么**：第三轮把 8 态、判据表、双向探测防抖都做完了，但**没有驱动**——`on_lan_probe_result`
只有测试在调，生产上 `wan-active` 永远不会自己回 `lan-active`；`pairing` 态在状态机里
有、没有任何一处会进入它。两者都是「机制在、行为不在」，用户可见的差别是：手机回到
同一 Wi-Fi 后仍一直走中继，首次配对的隧道在状态栏里显示成上一次会话的模式。

**落点**（全部在能力仓，平台仓零改动）：

| 文件 | 内容 |
| --- | --- |
| `tunnel/mode.rs` | `record_lan_probe(node, ok) -> bool`（只记账、**不改模式**，达阈值返回 true）；`nodes_in(mode)`；`on_lan_probe_success` / `on_lan_probe_failure` 改为它的包装（既有语义不变） |
| `tunnel/manager.rs` | `TunnelEngine::probe_lan(addrs, timeout)` 端口（默认实现一律失败 = 宿主没实现探活时保持当前模式）；`PeerCtxEngine` 实现为**只做 TCP 握手**（不进 swarm、不动现役链路）；`ManagerState.lan_candidates`（`connect` 时记 LAN 候选，relay-only 拨号不清旧候选）；`probe_wan_peers_once()` + 懒启动周期循环（默认 30s，`set_probe_interval` 可覆盖，弱引用不延长管理器寿命，`stop` 中止）；`pairing` 投影（未匹配 + 票据的 `connect` 在**拨号期**进 `pairing`、链路就绪后回到真实传输模式；未匹配的入站流进 `pairing`、窗口结束回落 `offline`）；`state` 改 `Arc<Mutex<_>>` 与入站循环共享 |

**关键判据（为什么这么写）**：

1. **探活不能用 `dial`**：引擎在「已准入链路但拨号地址变了」时会先断旧链路再重拨
   （`dial_with_timeout` 的 `must_redial` 分支）——wan-active 期间那样会打断经 relay
   的现役流。所以探活只做一次 1.5s TCP 握手。
2. **探测成功 ≠ 已回内网**：连续两次探活成功后还要**真实拨一次 LAN 并成功**，才把模式
   改成 `lan-active`；拨号失败则保持 `wan-active` 并清零计数。否则状态栏会声称「内网直连」
   而数据仍在 relay 上。
3. **手动「尝试外网」不参与探测**：设计 §4.9 规定手动指令本次网络会话内保持；探测只对
   自动进入 wan 的对端生效。
4. **relay-only 拨号不清 LAN 候选**：T09 的 `tryWan` 只带 relay 地址；若按「全量替换」
   存候选，回切探测就再也拿不到目标。

**验证（实跑）**：

```text
wasmnest-server-peer-net: cargo test --lib --offline              → 286 passed（275 → +11）
wasmnest-server-peer-net: --features common-host,relay            → 284 passed
wasmnest-server-peer-net: cargo fmt --check                       → 绿
平台桌面 wasmnest-desktop/src-tauri: cargo check --lib --offline   → 绿
平台移动 wasmnest-mobile/src-tauri:  cargo check --lib --offline   → 绿（仅既有 unused 警告）
```

新增/改写测试：`wan_active_restores_lan_only_after_two_probes` / `probe_failure_resets_the_restore_counter` /
`restore_dial_failure_keeps_wan_active` / `manual_wan_is_not_overridden_by_probe` /
`probe_only_uses_lan_candidates` / `probe_loop_runs_on_interval` /
`pairing_ticket_for_untrusted_peer_marks_pairing_during_dial_only` / `inbound_unmatched_stream_marks_pairing_then_offline` /
`record_lan_probe_counts_without_switching_mode` / `record_lan_probe_ignores_non_wan_active_peers` / `nodes_in_filters_by_mode`。

**仍未完成（本轮范围外）**：Android `ConnectivityManager` 精确网络类型与「换网→
`on_network_changed`」的平台触发；移动前台服务保活；`check:manifest` 的 tag 项；
T09 历史/mDNS 重连与 T10 真机 E2E。
