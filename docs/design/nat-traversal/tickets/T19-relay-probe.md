# [feat] T19 · relay 连通性探测：`host-tunnel.probe-relay` + 网络配置中心接线

- **落仓**：能力仓 `7ZAI/wasmnest-lib`（主实施）＋ 平台仓 `7ZAI/wasmnest`（SDK/装配）＋ 应用仓 `7ZAI/wasmnest-apps`（接线）
- **标签**：`kind:feature`、`cross-repo`、`security-sensitive`（只读探测，无写面）
- **阶段**：P2（T18 后续；补上 T14/T18 一直禁用的「检测连通性」）
- **依赖**：T06（`host-tunnel` 宿主面，平台 HEAD `59a523ec` 已落地）、T18（中心页面 / 导入 / 注册表已落地）、T13（relay 端 `/wasmnest/relay-control/1` 与 `doctor`）
- **状态**：implemented（2026-11-11，四仓代码落地，尚未提交）。§9 两项按**默认口径**执行：权限位 `tunnel:probe`；v1 只做可达 + PeerId + RTT（不实现 relay 控制协议客户端）。发布链（重打宿主 / 刷新 `host-runtime.lock.json` / 真宿主点击一次）、真实 E2E 与提交未完成，见 §11。
- **设计依据**：设计 §4.2.1（「检测连通性」：用 peer 引擎拨 relay，显示 PeerId 指纹与 RTT；失败给端口/防火墙/DNS/版本原因）、§7.1 错误分类、§8 P2 验收、不变量 1 / 5 / 6 / 8 / 10

## 0. 一句话结论

给 `wasmnest:tunnel` 增加一个**只读、无持久副作用**的 `probe-relay` 原语：用本机 p2p 栈对给定 relay 端点做一次「TCP + Noise + PeerId 校验 + ping」往返，返回指纹与 RTT；网络配置中心据此把现在写死禁用的按钮接上。不新增 relay 服务端能力，不建 reservation，不暴露端口，不改任何配置。

## 1. 问题陈述

**用户视角**：在中心导入 relay 地址后，无法确认「这个地址现在到底通不通、是不是我导入的那台中继」。只能 SSH 上服务器跑 `doctor`，或从另一台机器手敲 `nc`。

**现状证据（2026-11-10 核查）**：

| 事实 | 证据 |
| --- | --- |
| 按钮是**静态禁用**，从不询问宿主 | `servers/net-config/desktop/src/components/NetConfigView.vue:472-487`：`disabled` 无 `@click`，`relay.probe.unsupported` 无条件渲染 |
| T18 明确把真实实现列为不做 | `tickets/T18-net-config-service.md:165`；后续项 `:243`「T06 落地 relay 拨号原语后接上」 |
| 契约层没有探测原语 | `wasmnest-lib/wasmnest-server-peer-net/wit/tunnel.wit:17-68`：只有 configure / expose / unexpose / connect / close / issue-pairing-ticket / status；`status` 注释明确「不含 RTT」 |
| 中心自身无网络权限 | `servers/net-config/desktop/plugin.json:13-15` 仅 `storage`；边界「本页不拨号」 |
| 发布宿主可能整块缺 T06 | T06 `59a523ec`（2026-11-08）不在平台 `v0.0.1`（2026-10-28），也不在 `host-runtime.lock.json` 的 `sourceCommit 21c84dd` 里 |

**为什么不能用现有原语凑**（详见 §5）：

- `configure` + `status`：`TunnelManager::configure` 只写 config 再 `recount()`；`recount` 的 `desired` 只统计 **expose 规则 + `inbound_wan`**（`wasmnest-server-peer-net/src/tunnel/manager.rs:1183-1232`）。没有 expose 规则时不会建立 reservation，`status.relay.state` 恒为 `idle`。
- `connect`：走 `/wasmnest/tunnel/1` 业务流，relay 不实现该协议，必然失败；还会在本机起 listener。
- relay 的 `/healthz`：容器内绑回环、宿主仅发布到 `127.0.0.1:9090`（服务器实测），公网拉不到；即使暴露也只证明 HTTP 9090，不证明 libp2p 4001。
- `host-process` 跑 `nc`：无法校验 PeerId（同 IP 换身份检测不出来），且给配置中心执行进程的权力，越过安全边界。

## 2. 目标与非目标

**目标**

1. 一次调用回答：给定 relay 地址**此刻**是否可达、是不是该 PeerId、RTT 多少、失败原因是什么。
2. 探测**零持久副作用**：不建/不释放 reservation，不登记 expose 规则，不写信任，不改插件配置，不产生 `peer-connected` / `tunnel:state` 事件。
3. 结果可被界面直接渲染（PeerId 短指纹 + RTT + 地址 + 检查时间 + 可操作错误）。
4. 与现有权限模型一致：不给配置中心 `tunnel:serve` / `tunnel:connect` 的任何能力。

**非目标**

- 吞吐 / 配额压测（1GB 跨 NAT 归 T15）。
- relay 准入兑换（enrollment token）与 allowlist 管理（T13 的 `token create` 面）。
- 公网可达性的**服务端自证**（`doctor` 已如实标 `unknown`；本原语从客户端侧实测，两者互补）。
- 周期探测 / 后台健康检查 / 多 relay 排名。
- 移动端页面（中心是桌面服务型 wasm；移动 SDK 只需返回 `tunnel-unavailable`）。
- 改动 relay 二进制或控制协议（`Hello` 已够用；v1 甚至不依赖它）。

## 3. 方案总览

```text
net-config 前端（按钮）
  → 本插件命令 net-config.relay.probe（Rust 后端，走 appInvoke）
  → 平台 SDK：HostTunnel::tunnel_probe_relay(addrs, timeout)
  → WIT：wasmnest:tunnel@0.0.1/host-tunnel.probe-relay
  → 能力域：wasmnest-server-peer-net::tunnel::probe
  → 引擎：wasmnest-p2p-engine::probe::probe_relay（临时 swarm）
  → 公网 relay（TCP 4001 + Noise）
  ← report { peerId, peerIdSha256, handshakeMs, rttMs, addr, checkedAt }
```

| 层 | 改动 | 产物 |
| --- | --- | --- |
| 能力仓 `wasmnest-p2p-engine` | 新增 `probe` 模块：临时 swarm 拨号 + ping | `probe_relay()` + 单测 |
| 能力仓 `wasmnest-server-peer-net` | WIT 追加 `probe-relay`；域函数（校验/解析/限流/错误映射）；权限门；错误码 | `tunnel/probe.rs`、`plugin_binding.rs`、`mod.rs` |
| 能力仓 `wasmnest-wasm-core` | 权限词表新增 `tunnel:probe` | `permission.rs`（词表真源） |
| 平台仓 | SDK trait + `WasmHost` 实现 + WIT 分片重拼 + 权限副本 / 生成物 + `witSha256` / manifest | SDK 产物重出、宿主重打（版本按发布流程 bump） |
| 应用仓 `net-config` | 命令 `net-config.relay.probe`、按钮接线、结果区、i18n、单测、E2E 锚点 | app 产物重打（版本按发布流程 bump） |

## 4. 契约

### 4.1 WIT（`wasmnest:tunnel@0.0.1` 追加，不升包版本）

```wit
/// 只读探测：对给定 relay 端点做一次 TCP + Noise + PeerId 校验 + ping。
/// relay-addrs-json = multiaddr 字符串数组（每个都必须钉住 `/p2p/<relay>`，
/// 不得含 `/p2p-circuit`）；timeout-ms = 0 用宿主默认（8000），上限 15000。
/// 成功返回 JSON report（见 §4.2）；失败返回 `code: detail`（见 §4.3）。
/// **无持久副作用**：不建 reservation、不登记规则、不写信任、不发事件。
probe-relay: func(relay-addrs-json: string, timeout-ms: u32) -> result<string, string>;
```

**为什么留 0.0.1**：T06 已用同样方式在 0.0.1 追加过 `configure`（WIT 注释「仍属 0.0.1 预发布线」）。本次是宿主**新增导出**，**旧 guest** 的 import 集合是子集，实例化不受影响；包版本进入 import 名，贸然升 `0.0.2` 会迫使所有 tunnel 消费者重打。

**反向不成立（实施期修正）**：**新 guest 在旧宿主上会实例化失败**（宿主缺 `probe-relay` 导出，实例化期点名缺失），不是「按钮可点但返回 `tunnel-unavailable`」。因此发布必须**宿主与消费方同批重打**，`host-runtime.lock.json` 按发布流程刷新；dev 期未重打的旧宿主表现为该插件整体加载失败（显性），不会静默降级。

### 4.2 成功 report（JSON，camelCase，`v=1`）

```json
{
  "v": 1,
  "addr": "/ip4/113.45.43.60/tcp/4001/p2p/12D3KooW…",
  "peerId": "12D3KooW…",
  "peerIdSha256": "bc1420f7…b29b7",
  "handshakeMs": 62,
  "rttMs": 65,
  "checkedAt": "2026-11-10T13:26:37Z"
}
```

| 字段 | 语义 | 失败时 |
| --- | --- | --- |
| `addr` | 实际探测成功的地址（多地址时是首个成功项） | — |
| `peerId` | 地址里钉住的 relay PeerId（libp2p 握手已校验） | — |
| `peerIdSha256` | `sha256(ed25519 公钥)`；前端可再本地复算比对 | — |
| `handshakeMs` | dial → `ConnectionEstablished` 耗时 | — |
| `rttMs` | 首次 ping 往返；ping 超时但连接已建立时给 `null` | 允许 null |
| `checkedAt` | 探测完成时间（RFC3339） | — |

**v1 不返回** `relayVersion` / `access` / `allowed`：那需要额外实现 `/wasmnest/relay-control/1` 客户端（控制帧编解码），而 T18 现有文案只承诺「PeerId 指纹与 RTT」。v2 若产品要显示「准入模式 / 本机是否被 allowlist 放行」再加（见 §9）。

### 4.3 错误码（`code: detail`，沿用 `TunnelError::as_wire_error`）

| code | 触发 | 界面方向 |
| --- | --- | --- |
| `relay-address-invalid`（新增） | 空 / 非法 multiaddr / 含 `/p2p-circuit` / 多地址跨 PeerId / 缺 `/p2p/<relay>` | 「地址不合法，请重新导入 print-addrs」 |
| `relay-unreachable`（复用 `CODE_RELAY_UNREACHABLE`） | TCP 拒绝 / 超时 / Noise 失败 / 全候选失败 | 「中继不可达：检查 TCP 端口、防火墙/安全组、DNS」 |
| `relay-identity-mismatch`（新增） | 握手得到的 PeerId 与地址里的 `/p2p/` 不符 / 非 ed25519 | 「中继身份不符：地址可能被替换，请核对指纹」 |
| `probe-rate-limited`（新增） | 同插件已有在飞探测，或 2s 冷却内重复点击 | 「正在检测，请稍候」 |
| `peer-offline`（复用） | 本机 p2p 节点无法启动（端口/身份不可用） | 「本机对等网络未就绪」 |
| `tunnel-unavailable`（复用，兜底） | 宿主导出接口但域层声明不支持（当前 probe **不产出**；旧宿主是实例化期失败，见 §4.1） | 「当前宿主不支持连通性检测，请升级」 |

**多地址语义**：按入参顺序逐个尝试，首个成功即返回；全失败返回聚合错误，`detail` 含逐项 `addr → code`（不截断到只剩最后一条）。

### 4.4 权限：新增 `tunnel:probe`

- 只授予 `probe-relay`；**不授予** `configure` / `expose` / `connect` / `close` / `issue-pairing-ticket` / `status`。
- 词表真源 `wasmnest-wasm-core::permission`（平台 SDK 副本 + `bin/permission-vocabulary.json` + `manifest-gen.js` 推导规则同步；40 → 41 条）。
- 复用 `tunnel:connect` 的替代方案被否：`connect` 能把**任意远端端口**映射到本机回环，是比「测一下」大得多的权力；配置中心不应为了一个诊断按钮获得它。
- 门禁位置与现有双位一致：`plugin_binding.rs` 入口 `require(..., PERMISSION_TUNNEL_PROBE, "host_tunnel_probe_relay")`，fail-closed；`MODULE_PERMISSIONS` 增加第三项，`plugin/tunnel.rs` 的描述符逐字锁同步。

## 5. 能力仓实现

### 5.1 `wasmnest-p2p-engine::probe`（独立临时 swarm）

**为什么不用主 swarm**：主引擎的 `ConnectionEstablished` 会进链路表、跑准入闸门（首连确认）、发 `peer-connected`。探测连接一旦走这条路，会污染信任/状态机，还要处理「探测连接与已有 relay 预留连接」的拆除竞态（拆错就断掉真实预留）。

**做法**：每次探测新建一个最小 swarm —— `tcp + noise + yamux + ping`，**无 listener、无 libp2p-stream 业务协议、无 relay client 行为**，使用一次性随机 ed25519 身份。

- 随机身份的理由：不触达宿主私钥；relay 处于 `open` 模式时无影响；`allowlist` 模式下探测仍能完成 TCP/Noise/控制面（`Hello` 会回 `allowed:false`），只是 v1 不报告该字段。
- 流程：`RelayEndpoint::parse(&addr, None)` 预检（拒 `/p2p-circuit`、拒 DNS——宿主先解析）→ `swarm.dial(addr)`（libp2p 用地址里的 `/p2p/` 校验 PeerId）→ 等 `ConnectionEstablished`（记 `handshakeMs`）→ 等首个 `Ping::Ok`（`ping::Config` interval 1s / timeout 5s，记 `rttMs`）→ `swarm.disconnect(peer)` → 返回 report。
- 超时：`timeout` 是**整次探测总预算**（多地址逐个尝试）。拨号 / 握手超时 → `Unreachable`（交给下一候选 / 汇总）；**握手成功后 ping 超时 → `rttMs = null`**（可达性与身份已成立，不当作失败）；drop 时关闭 swarm。
- **不依赖 `relay` feature**：普通 libp2p 客户端即可连 relay 端点；host 构建已开 relay，不影响。

**测试锁（实施期落点修正）**：

1. `wasmnest-p2p-engine` 内单测（不触网）：指纹与 ed25519 公钥派生一致、拨号前剥掉 `/p2p` 尾部、空列表 / 含 `/p2p-circuit` / 跨 PeerId 在校验期拒绝、关闭端口归 `Unreachable` 且总预算约束耗时并逐候选点名地址。
2. **真 relay 用例放 `wasmnest-test/cross-end-tests/relay-transport/tests/relay_probe.rs`**，不是票面原写的 `probe/tests`：引擎的 `boundary_lock` B-4 禁止 dev-dependency 出现任何 `wasmnest*` 内部 crate（通用引擎不为测试长出内部依赖边），与 `relay_reservation_flow` 共用同一份进程内 relay 夹具。断言：报告 `addr` / `peerId` 指回真实中继、指纹与 `RelayIdentity::fingerprint()` **逐字相等**、`handshake` 在预算内、`rtt` 非空、中继 `connections_total >= 1` 且 `reservations_active == 0`（真连 + 零预留）。
3. 同文件另三条：多地址首败次成（报告指回成功项）、地址钉住身份不符 → `IdentityMismatch`（不退化成都不可达）、关闭端口 → `Unreachable`。
4. 零事件锁的落点：探测不使用主引擎（无 `P2pPorts`、无链路表、无准入），由模块结构保证；服务端计数（`reservations_active == 0`）是「未产生持久资源」的实测判据。

### 5.2 `wasmnest-server-peer-net::tunnel::probe`（域函数）

```rust
pub async fn probe_relay(
    ports: &Arc<dyn TunnelPorts>,
    plugin_id: &str,
    addrs_json: &str,
    timeout_ms: u32,
) -> Result<String, String>
```

- 权限门 `tunnel:probe`（未声明 fail-closed，错误串 `permission denied: tunnel:probe`）。
- **不依赖 `TunnelManager`**（实施期修正）：探测不持有任何隧道资源，管理器是否装配与「能不能测一下」无关；`tunnel-unavailable` 不再由「管理器缺失」触发，而是宿主未导出 WIT 原语时在实例化 / 调用侧显性暴露。
- 解析：`serde_json` 数组 → 逐项 `Multiaddr` → 条数上限 16 → 去重 → 同 PeerId 校验 → 拒 `/p2p-circuit`；空/超限拒绝。
- 域名：复用 `wasmnest_p2p_engine::relay::resolve_relay_addr`（与 `configure` 同口径，宿主侧 `lookup_host`），解析后去重并保持声明顺序。
- 限流：进程级 `HashMap<plugin_id, ProbeSlot>`（`LazyLock<Mutex<…>>`）；同插件只允许 1 个在飞，结束后 2s 冷却（`probe-rate-limited`，不排队）。**只有真正进入拨号阶段**（地址解析通过）才记冷却——形状 / 解析失败不冷却，否则用户改完配置立刻重试会被「冷却中」误导。
- 超时：`timeout_ms == 0` → 8000；上限 15000；下限 1000。
- report DTO：camelCase（`v/addr/peerId/peerIdSha256/handshakeMs/rttMs/checkedAt`），`checkedAt` 为 RFC3339 UTC 秒级。
- **不 acquire `net.tunnel` 服务租约**（probe 不持有任何隧道资源，与 `configure` / `status` 同类）。
- 错误映射见 §4.3；成功时序列化 `TunnelProbeReport`。

### 5.3 平台仓

| 文件 | 改动 |
| --- | --- |
| `wasmnest-desktop/packages/plugin-sdk-desktop/rust/wit/deps/tunnel/tunnel.wit` | 由 `compose-wit` 重拼（不手改生成物） |
| `.../rust/src/host/tunnel.rs` | trait 新增 `fn tunnel_probe_relay(&self, addrs: &[String], timeout_ms: u32) -> Result<Value, HostError>` |
| `.../rust/src/wasm_host.rs` | `impl HostTunnel for WasmHost` 调 `host_tunnel::probe_relay`；`relay_addrs_json` 序列化沿用 `tunnel_configure` 写法 |
| `.../rust/src/permission.rs` + `bin/permission-vocabulary.json` + `bin/manifest-gen.js` | `tunnel:probe` 副本与生成规则（41 条） |
| 桌面 / 移动 compose | `wasmnest:tunnel@0.0.1` 重拼；`witSha256` 重算；`release-manifest.json` packages 同步 |
| 双端描述符锁 | 桌面 `plugin/tunnel.rs:213`、移动 `plugin/tunnel_ports.rs:143` 的 `MODULE_PERMISSIONS` 逐字断言加第三项 |
| 移动宿主 | **不是 `tunnel-unavailable`**（实施期修正）：能力 lib 自报 `host-tunnel` 接口，移动与桌面是同一份域代码，探测天然可用且受 `tunnel:probe` 门禁；移动无中心页面（不接线是产品范围，不是能力缺失） |

宿主 `plugin/tunnel.rs` 的端口装配不变（T06 已把管理器装好）；只跑它的描述符锁确认第三位权限与能力域一致。

### 5.4 应用仓 `net-config`

| 文件 | 改动 |
| --- | --- |
| `plugin.json` | `permissions` 加 `tunnel:probe`；`contributes.commands` 加 `net-config.relay.probe` |
| `rust/src/lib.rs` | `dispatch_command` 增加分支：读当前配置的 `relayAddrs`（不接受前端任意地址，避免把探测当 SSRF 用），调 SDK `tunnel_probe_relay` |
| `rust/src/probe.rs`（新） | `ProbeHost` trait（native 测试注入替身）+ wasm 实现（`WasmHost`）+ 读 KV `relayAddrs` + 剥掉 SDK 错误前缀（`tunnel_probe_relay: `）后再上抛 `code: detail` |
| `src/components/NetConfigView.vue` | 按钮启用条件 = `relay.config != null && !probing`；结果区（成功/失败/已检查时间）；无配置时显示 `relay.probe.empty` |
| i18n `zh-CN` / `en` / `messages.ts` | 新增结果与六类错误文案；`relay.probe.unsupported` 退役 |
| 测试 | 组件测试：禁用态 / 成功渲染 / 各错误码映射 / 连点限流；Rust：命令分支 native 测试 |
| E2E | 复用 `net-config-probe-button`；新增 `net-config-probe-result` / `-error` 锚点（锚点改名 = 用例红） |

**为什么不接受前端传地址**：地址真源是中心 KV；若命令允许任意 `relayAddrs`，配置中心就变成「任意 multiaddr 拨号器」。探测只针对已导入配置，多地址一起探测，天然与 `relayAddrs` 真源一致。

## 6. 状态与失败语义

- 探测中：按钮 loading，重复点击返回 `probe-rate-limited`（不排队）。
- 成功：显示 `PeerId 前 16 位…`、指纹前 16 hex、`RTT xx ms`、地址、`checkedAt`。
- 失败：显示 code 对应文案 + detail（detail 只放地址/端口/DNS 等非敏感片段）。
- 旧宿主（无该原语）：**插件在实例化期失败并点名缺导出**（见 §4.1 反向修正），界面根本拿不到「可点按钮」；`tunnel-unavailable` 只作为域层兜底文案保留（当前 probe 不产出该码）。**不**回到「静默禁用 + 假称未装配」。
- 结果不落库（每次实测）；不进日志的敏感面：仅 peer id 短指纹与耗时。

## 7. 安全与不变量

| # | 不变量 | 判据 |
| --- | --- | --- |
| P1 | 探测**不产生持久资源**：无 reservation、无 expose 规则、无信任写入、无 `net.tunnel` 租约 | 真 relay 用例断言 `reservations_active == 0` 且 `connections_total >= 1`（真连但零预留） |
| P2 | 探测连接**不进主引擎链路表 / 不跑准入 / 不发 peer 事件** | 结构保证：probe swarm 独立、无 `P2pPorts` 可写；并非只靠 fake sink 断言 |
| P3 | PeerId 必须由握手校验，地址不匹配即 `relay-identity-mismatch` | 双 relay 交叉地址用例 |
| P4 | 只探测**已保存**的 relay 地址，不接受前端任意地址 | 命令签名无 addrs 参数（从 KV 读） |
| P5 | 权限最小化：`tunnel:probe` 不蕴含任何写面 | 未声明权限 fail-closed；`MODULE_PERMISSIONS` 逐字锁 |
| P6 | 失败可见，不静默降级成「可用」 | 六类错误码 + 组件测试逐条断言 |

## 8. 验收条件

**契约与装配**

- [x] WIT `probe-relay` 进 `wasmnest:tunnel@0.0.1`，`compose-wit --all --check` 绿（EXIT 0，逐文件 ok）。
- [x] `tunnel:probe` 进词表真源 + 双端 SDK 副本 + `permission-vocabulary.json`（41 条）；`manifest --check` 侧：桌面宿主描述符锁 6 passed / 移动 3 passed。
- [x] 双端 SDK `cargo check` 绿；桌面宿主 `cargo check --lib` 绿（本轮以 `plugin::tunnel` 目标测试完成同等编译，6 passed）。移动端**不是** `tunnel-unavailable`：同一份域代码 + `tunnel:probe` 门禁（见 §5.3）。
- [x] `witSha256` 重算进 `release-manifest.json`（`9eca829a…b46c`）；`check:manifest` **仍有 4 项红，全部是环境/在途**（lib/apps HEAD 无精确 tag、`lanbitou` 的 `package` / `sha256` 属他人未提交改动），无新增结构红项。`host-runtime.lock.json` **未刷新**（发布链未做）。

**能力层**

- [x] 进程内真 relay 探测成功（PeerId / 指纹 / RTT）：`relay_probe` **4 passed**；指纹与 `RelayIdentity::fingerprint()` 逐字相等。
- [x] 关闭端口 → `relay-unreachable`；PeerId 不符 → `relay-identity-mismatch`；含 `/p2p-circuit` → `relay-address-invalid`（域层 7 passed + 集成用例覆盖）。
- [x] 多地址：首项失败、次项成功 → 返回次项（`多地址_首项失败次项成功_返回次项` ok）；全失败 → 聚合 detail（域层 `引擎错误映射到契约错误码` + p2p-engine `关闭端口…`）。
- [x] 限流：在飞第二次调用 → `probe-rate-limited`（`在飞探测_第二次调用立即限流` ok）；冷却后可再测（`连点_冷却期内返回限流_冷却后可再测` ok）。
- [x] P1/P2 测试锁绿：真 relay `reservations_active == 0` + `connections_total >= 1`；P2 由结构保证（见 §7）。

**应用层**

- [x] 未配置时按钮禁用 + `relay.probe.empty`（组件 R6 + E2E 断言）。
- [x] 已配置时点击 → 成功渲染指纹/RTT/时间；失败按 code 渲染（`netConfigView` 27 + `relayProbe` 8，合计 vitest **67 passed / 5 files**）。
- [x] 该 app `vitest run` 全绿；改动文件 eslint **0 error**（e2e 目录按现行 ignore 策略跳过；根 lint 受 `.worktrees/` 环境问题未跑全量，见 §11）。
- [ ] 真实宿主：对**已部署 relay**（脚本见 §10）点击一次，界面显示可达与 RTT；E2E `node scripts/e2e.mjs --app net-config` 绿（锚点同步）。**未跑**：`host-runtime.lock.json` 的 `artifacts` 为空且宿主未按新 WIT 重打，见 §11。

## 9. 待裁定（开工前）

1. **权限位命名**：默认 `tunnel:probe`（推荐，最小权力）；备选复用 `tunnel:connect`（少一次词表变更，但配置中心获得端口映射能力）。
2. **v1 范围**：默认只做「可达 + PeerId + RTT」（不实现控制协议客户端）；若要求同时显示 relay 版本 / 准入模式 / 是否被 allowlist 放行，则 v1 需加 `/wasmnest/relay-control/1` 客户端（+0.5~1 天，见 §12）。

**裁定结果（2026-11-11）**：按默认口径执行，未引入额外变更——

1. 权限位 = **`tunnel:probe`**（独立第三位，不蕴含 `serve` / `connect`）。
2. v1 范围 = **可达 + PeerId 指纹 + RTT**；`relayVersion` / `access` / `allowed` 留 v2（需 `/wasmnest/relay-control/1` 客户端）。

## 10. 服务器侧验证（2026-11-10 实测）

**被测对象**：用户自建 relay，`ssh -p 2222 blink@113.45.43.60`；Docker Compose 部署。

### 10.1 部署形态与身份

```text
compose 文件：/home/blink/wasmnest-relay/docker-compose.yml
镜像：wasmnest-relay:0.0.1（本地构建，非 ghcr）
容器：wasmnest-relay，restart=unless-stopped，Started=2026-11-10T09:12:53Z
端口：0.0.0.0:4001->4001/tcp、127.0.0.1:9090->9090/tcp
卷：wasmnest-relay-data:/data（identity.key 0600、config.toml 0644）
```

`docker logs` 显示 09:11:05 启动 → 09:12:53 停止并重启，两次 `local_peer_id` 相同；证明**重启不换 PeerId**（身份在卷里）。

### 10.2 地址与自检

`print-addrs --json`：

```json
{
  "v": 1, "kind": "wasmnest-relay", "relay_version": "0.0.1",
  "peer_id": "12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud",
  "peer_id_sha256": "bc1420f7ef30a98de637c87ab49581bf3c9a649e7c82f5719aeb9388d61b29b7",
  "control_protocol": "/wasmnest/relay-control/1",
  "addrs": ["/ip4/113.45.43.60/tcp/4001/p2p/12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud"],
  "access": { "mode": "open" },
  "quota": { "max_circuit_bytes": 1073741824, "max_circuit_duration_secs": 3600 }
}
```

`GET 127.0.0.1:9090/healthz`（宿主侧 curl）与上述逐字一致；`listen_addrs` 为 `127.0.0.1:4001` / `172.18.0.2:4001`。

`doctor`：**6 项通过 / 2 项警告 / 0 项失败**。

- 警告 1（预期）：`listen 0.0.0.0:4001 已被占用`——relay 正在运行。
- 警告 2（预期）：`metrics 0.0.0.0:9090 非回环且已显式开启公网暴露`——这是**容器内**视角；宿主只发布到 `127.0.0.1:9090`，公网不可达。若将来要公网抓取，按部署 README 加反代 TLS + token。
- `reachability` 如实标 `?`（本机不能自证公网可达）——这正是本 ticket 要补的客户端侧实测。

### 10.3 真实客户端端到端（正向）

用仓库既有用例（`wasmnest-test/cross-end-tests/relay-transport`，真实 `wasmnest-p2p-engine` 客户端 × 真实 `wasmnest-relay`）：

```bash
WASMNEST_RELAY_E2E_ADDRS='/ip4/113.45.43.60/tcp/4001/p2p/12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud' \
  cargo test -p relay-transport --test relay_reservation_flow -- --ignored --test-threads=1
```

结果：`1 passed; 0 failed; finished in 1.14s`。该用例链路 = A 在公网 relay 预留 → B 经 `/p2p-circuit` 拨 A → `/wasmnest/session/1` 流 64 KiB 往返逐字一致。

服务端计数（探测前 → 后）：

| 指标 | 前 | 后 |
| --- | --- | --- |
| `reservations_total` | 5 | 6 |
| `circuits_total` | 5 | 6 |
| `connections_total` | 12 | 14 |

日志同一时刻：`reservation 已接受 peer=12D3KooW…1xkg renewed=false`。两侧证据闭合。

### 10.4 负向验证

同一用例换成关闭端口 `4002`：

```text
WASMNEST_RELAY_E2E_ADDRS='/ip4/113.45.43.60/tcp/4002/p2p/12D3KooW…'
→ FAILED（10.01s）：Relay("relay circuit 监听关闭：Ok(())")
```

结论：不可达会失败且**不会**被误判为成功；但当前底层错误文案可读性差，T19 的 `relay-unreachable` 需要在域层补「端口/超时/拒绝」分类。

### 10.5 公网端口

从本机对 `113.45.43.60:4001` 做 TCP 连接：`OPEN`。云安全组控制台未在本次验证范围（无凭据），但端口实测已通。

### 10.6 本次未验证

- 跨真实 NAT 的两台消费设备（手机蜂窝 ↔ 家宽）——归 T15 / T10。
- `allowlist` 模式下的探测与 enrollment——本次部署是 `open`。
- 1GB 单 circuit 上限与断点续传跨 circuit——归 T15。
- 探测原语本身（尚未实现）；本节验证的是它所依赖的 relay 与既有客户端栈。（**实施后注**：探测已于 2026-11-11 落地，真 relay 集成用例见 §11；对已部署 `113.45.43.60:4001` 的真宿主点击仍未做。）

## 11. 测试计划

| 层 | 用例 |
| --- | --- |
| p2p-engine | 进程内 relay 成功 / 关端口失败 / PeerId 不符 / 超时预算 / 零事件锁 |
| server-peer-net | 权限 fail-closed / 地址形状 / 多地址聚合 / 限流 / 域名解析失败点名 / report 序列化 |
| 平台 SDK | `cargo check`（desktop/mobile）+ WIT 描述符逐字锁 + 权限词表 41 条 |
| 应用 Rust | 命令分支（有/无配置、成功/失败、错误拆分）native 测试 |
| 应用前端 | 按钮禁用/启用、loading、成功渲染、六类错误、限流提示 |
| E2E | 真实宿主 + 已部署 relay：点击 → 显示可达 + RTT（锚点 `net-config-probe-*`） |

**验证底线**：能力层必须用**真 relay**跑一次（进程内 + 已部署各一）；应用层必须真实宿主点击一次；不得只用 mock。

### 11.1 实施期实跑结果（2026-11-11）

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path wasmnest-p2p-engine/Cargo.toml --lib` | **46 passed**（含 probe 模块 4 条） |
| `cargo test --manifest-path wasmnest-server-peer-net/Cargo.toml --lib -- tunnel::probe` | **7 passed** |
| `cargo test -p relay-transport --test relay_probe`（`wasmnest-test/cross-end-tests`） | **4 passed** |
| `cargo test --manifest-path servers/net-config/desktop/rust/Cargo.toml` | **28 passed** |
| `vitest run`（`servers/net-config/desktop`） | **67 passed / 5 files** |
| 桌面/移动宿主描述符锁（`host_module_declaration_matches_capability_domain_desc`） | 桌面 **6 passed** / 移动 **3 passed** |
| 双端 SDK `cargo check` | 均 Finished |
| `scripts/compose-wit.mjs --all --check` | EXIT 0 |
| `cargo fmt --check`（本次触及的 lib 文件）+ `cargo clippy`（`-p wasmnest-p2p-engine --all-targets`） | fmt 绿；probe 相关 **0 warning**（server-peer-net 的 2 条 deny-lint 为 1.98 工具链下既存代码，非本票新增） |
| 改动文件 eslint | **0 error**（e2e 目录按现行 ignore 跳过；根 lint 全量受 `.worktrees/` 环境问题未跑） |

**未跑（显性记录，不得写成通过）**：

1. 真宿主 + 已部署 relay 点击一次 / `node scripts/e2e.mjs --app net-config`：`host-runtime.lock.json` 的 `artifacts` 为空，且现有宿主产物按旧 WIT 构建（无 `probe-relay`），需先走发布链重打宿主。E2E 只保留「未配置禁用 + 已配置可点」的锚点断言，**不点击**（点击会真拨 relay，而该用例不写真实配置）。
2. 发布链：重打双端宿主 + net-config / bedcode desktop 产物、刷新 `host-runtime.lock.json`、实例化回归。
3. `pnpm run check:manifest` 全绿：lib/apps 当前 HEAD 无精确 tag（未提交），且另有 `lanbitou` 在途改动，属环境依赖项。
4. 移动端页面（不做）与 `allowlist` 模式下的探测（部署为 `open`）。

## 12. 实施顺序与工作量（估算）

1. **能力仓**（0.5–1 天）：`p2p-engine::probe` + 进程内 relay 用例；`server-peer-net` 域函数 + WIT + 权限 + 测试。
2. **平台仓**（0.5 天）：SDK trait/impl、compose 重拼、词表与生成物、双端 check、宿主重打。
3. **应用仓**（0.5 天）：命令 + 组件 + i18n + 测试 + 锚点。
4. **发布链**（0.5 天）：`witSha256` / manifest / host-runtime lock / 新宿主产物；net-config 与 bedcode desktop 重打并实例化回归。**（未做）**
5. 真实宿主 + 已部署 relay 收口（0.5 天）。**（未做）**

合计约 **2–3 天**（v1 不含控制协议客户端）；若 §9#2 选「显示版本/准入」，再加 0.5–1 天。

## 13. 风险

| 风险 | 缓解 |
| --- | --- |
| 临时 swarm 与主节点同进程双栈，端口/身份资源竞争 | probe swarm 不监听、用一次性身份、结束即 drop；真 relay 用例断言中继侧零预留 |
| relay 在 `allowlist` 模式下探测成功但预留仍被拒 | UI 文案区分「可达」与「可预留」；`status` 的 reservation 原因仍由业务侧展示；v2 再补 `allowed` |
| WIT 变更引发全量重建 | 保持 0.0.1 只加导出；必须重打 net-config 与 bedcode desktop，其余不受影响 |
| 旧宿主 / lock 仍是 0.0.1（无 T06） | **新 guest 在旧宿主上实例化失败并点名缺导出**（§4.1）；发布项 = 宿主与消费方同批重打 + `host-runtime.lock.json` 升级，禁止只发 app |
| 探测被当成 SSRF 面 | 只读中心已保存地址（P4）；不接受前端任意地址 |
| RTT 受 ping 首包调度影响 | `ping::Config` 显式 interval 1s / timeout 5s；ping 超时允许 `rttMs: null`（可达性仍成立） |

## 14. 相关

- T18（中心页面/导入/注册表，探测占位来源）：`tickets/T18-net-config-service.md`
- T06（`host-tunnel` 宿主面与权限位）：`tickets/T06-platform-assembly.md`
- T13（relay 一键包 / 控制协议 / `doctor` / `print-addrs`）：`tickets/T13-relay-oneclick.md`
- 设计：`docs/design/nat-traversal.md` §4.2.1（检测连通性）、§7.1（错误分类）
- 真机 E2E 夹具：`wasmnest-test/cross-end-tests/relay-transport/tests/relay_reservation_flow.rs`
