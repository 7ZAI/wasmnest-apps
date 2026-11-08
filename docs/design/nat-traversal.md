# 内网穿透服务（NAT Traversal）——技术选型与设计方案

> **状态**：proposal（2026-11-07 评审修订，待复审；本文不含实现代码）
> **评审修订（2026-11-07）**：按评审结论修复六项阻断问题——双端环回豁免改面标记（§4.5/§4.10/不变量 15）、三条免凭证路由裁定（§0.4/不变量 16）、`connect` 补票据入参与票据绑定语义（§4.4）、`kind=http` 逻辑端口语义（§4.4）、清除 §6.1 加密残留矛盾、配对窗口路径闸门落点（§4.1/§4.5）；并收敛 reservation 生命周期（§4.8）、补齐状态机与证据引用。
> **已裁定（2026-11-07）**：仅已匹配设备接入；内网默认、明确不在内网才切外网；**加密永久强制、不可关闭**；一键 relay **仅覆盖 Linux**；relay 默认 open + 配额（目标端匹配是授权权威）。
> **范围**：给 bedcode、file-transfer 及后续应用提供跨 NAT 的对等可达性。应用业务协议不变，穿透是宿主能力 + 中继基础设施，不是新的 wasm 应用。
> **一句话结论**：以 **libp2p Circuit Relay v2 + 现有 Noise/Yamux 具名流** 作为跨 NAT 基线；宿主新增 `host-tunnel` 能力（服务端端口暴露 + 客户端本地回环代理）；**只允许已匹配用户（设备）接入**；**内网模式默认，只有明确判定不在内网时才切外网**；**全链路加密永久强制**（Noise 强制 + bedcode link-crypto `required` + file-transfer 应用层加密固定开启，无明文回退、无关闭开关）；配套 `wasmnest-relay`（仅 Linux）一键配置/一键运行；bedcode 的 HTTP/WS 必须走独立的「对等 HTTP/WS 面」（caller = `peer`），**禁止**把 8765 端口裸转发；file-transfer 保持现有传输协议，只扩展多地址拨号。QUIC / DCUtR 打洞作为 P3 优化，不作为 v1 可用性的前提。

---

## 0. 结论先行

### 0.1 选型结论

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 传输基线 | **libp2p Circuit Relay v2（TCP + Noise + Yamux）** | 复用现有 `wasmnest-p2p-engine` 身份、信任、名流；穿透中继是标准能力；移动端不需要 VpnService |
| 服务形态 | **宿主级能力 `host-tunnel` + 可自建 relay 守护进程** | wasm 插件没有 socket/listen 原语；穿透必须落在宿主；relay 与应用无关，可独立部署 |
| bedcode 接入 | **对等 HTTP/WS 面 + 本地回环代理** | 保留现有 HTTP/WS/JWT 契约；同时避免「隧道来自 127.0.0.1」被误判为本机调用方 |
| file-transfer 接入 | **多地址拨号（内网默认；明确不在内网才走 relay）** | 传输帧协议、断点续传、加密机制全部不动；只改寻址、传输状态与加密固定值 |
| 直连打洞 | **P3，QUIC/DCUtR 另行评估** | `libp2p-quic 0.14` 硬依赖 `quinn/rustls-aws-lc-rs`，与 Android 禁 aws-lc-rs 纪律冲突；不能把它当 v1 前提 |
| 首次配对 | **QR v2（128-bit token + 一次性传输票据）**；6 位码远程配对另议 | 6 位码在不可信中继上做 rendezvous 需要 PAKE，否则可被离线枚举；QR 是现成的高熵通道 |
| **接入控制** | **仅已匹配用户/设备可接入**；未匹配设备只能进入短命的「配对窗口」，且只放行配对端点 | 匹配 = 应用配对/信任 + 宿主 peer 信任两层都成立；配对票据只是引导，不是访问授权 |
| **传输模式** | **内网默认；只有明确判定不在内网才切外网**；同网段不可达不自动切，给手动「尝试外网」 | 避免两端同 LAN 却走中继；避免把「服务没开/设备休眠」误判成「不在内网」 |
| **加密** | **永久强制、不可关闭**：peer/tunnel 强制 Noise；bedcode 链路加密固定 `required`；file-transfer 应用层加密固定开启；协商失败即失败，不静默降级 | relay 不可信；外网消息必须端到端加密；不提供明文回退开关 |
| **中转服务** | 配套 `wasmnest-relay`（**仅 Linux**）：单文件二进制 + Docker/Compose + `init` / `doctor` / `print-addrs`；支持一键配置与一键运行 | 自建 relay 的主路径不能要求用户手写 libp2p 配置；导入地址即可用 |
| 隐私 | **默认自建 relay 优先，官方 relay 可选** | relay 能看到连接元数据；本地优先项目不应强制依赖单一公共中继 |

### 0.2 三个必须先承认的硬约束

1. **wasm 插件没有网络原语**。前端与 wasm 只能经宿主能力访问网络（`host-http` / `host-ws-client` / `host-peer`）。穿透服务只能是宿主能力，不能是 wasm 应用。
2. **bedcode 的 8765 端口存在「环回即本机」的信任假设**。宿主 `HttpCaller::classify` 以 `req.peer_addr().is_loopback()` 判定 `localhost`（`../wasmnest-lib/wasmnest-server-http/src/controllers/plugin_controller.rs:118-134`），而 bedcode 的桥接路由（`run-attach` / `run-events` / `run-commands` / `run-commands-ack`）是 `auth:none` + 仅接受 `caller == "localhost"`（`apps/bedcode/desktop/rust/src/run/bridge/mod.rs:44-54`）。**任何把远程流量经 127.0.0.1 转发进 8765 的裸隧道，都会把远端提升为本机调用方**。必须新增对等 HTTP/WS 面（caller = `peer`），或在应用侧先把桥接门禁改成每运行 bearer secret；本方案选前者。注意：caller 门禁只覆盖 run-* 四条；其余三条免凭证路由的处置见 §0.4 裁定。
3. **Android 不能引 aws-lc-rs**。`wasmnest-p2p-engine/Cargo.toml:25-29` 明确记录：启用 tls/quic 会拉 rustls/quinn，当前 feature 集在 Android 目标树里必须保持 rustls/quinn/aws-lc/openssl-sys 为零。`libp2p-quic 0.14.0` 的 `quinn` 依赖写死 `rustls-aws-lc-rs`（本机 registry 已核实），所以 QUIC 不是「加个 feature」就能落地。

### 0.3 本次追加的产品约束

1. **只允许已匹配用户/设备接入**：未匹配设备只能进入目标用户主动发起的短命配对窗口，且窗口只放行配对端点（§4.1）。
2. **内网默认；只有明确不在内网才切外网**：同网段不可达/服务未启动/认证失败都不触发自动切换（§4.9）。
3. **加密永久强制**：WAN 必须经 Noise；bedcode 链路加密固定 `required`；file-transfer 应用层加密固定开启；**不提供关闭开关**；协商失败即失败，不静默降级（§4.10）。
4. **配套一键 relay（仅 Linux）**：`wasmnest-relay` 提供单文件二进制（linux-amd64/arm64）+ Docker/Compose + `init` / `doctor` / `print-addrs`；桌面可生成部署文本并导入地址；不做 Windows/macOS 包（§4.2.1）。

这四条是产品约束，不是可调参数；实现时按对应章节的判据与不变量执行。

### 0.4 评审追加裁定（2026-11-07）：三条免凭证路由对已匹配远端可达

**事实**（评审核实）：bedcode 的 7 条 `auth:none` 路由中，仅 run-* 四条有 `caller == localhost` 门禁；`task-status` / `session-mode` 的分派签名不接收 caller（`apps/bedcode/desktop/rust/src/task/mod.rs:1116-1122`），`terminal-bg` 由宿主路由服务、应用侧无门禁。peer face 的 `caller=peer` 标记**保护不了不看 caller 的路由**。

**裁定**：这三条对**已匹配**远端保持可达，不补 localhost-only 门禁。依据：

1. 移动端真实依赖 `session-mode`（`apps/bedcode/mobile/src/task/api.ts:160`，设置会话自动模式，POST 写操作）；改成仅 localhost 会打断远程控制产品功能。
2. 到达 peer face 的唯一路径是 tunnel，tunnel ACL 已在连接层强制「仅已匹配」（§4.1/§4.4）——这三条的访问控制由隧道匹配校验承担，不再另设路由门禁。
3. run-* 四条桥接路由维持原门禁：`peer` 一律 403（不变量 3）。

**边界**：此裁定只覆盖「经隧道的已匹配远端」。这三条路由今天绑 `0.0.0.0:8765` 且无 caller 检查，**LAN 内任意设备本就可调**——属先于本方案的存量暴露，独立开票处理（待开，`gh` 当前未认证），不混入本方案范围。

---

## 1. 需求与现状证据

### 1.1 bedcode：桌面是服务端，移动是远程控制端

- 桌面声明 `backgroundTransport: true`、`ws:server`、`peer`、`network:http`（`apps/bedcode/desktop/plugin.json`），运行期持有 `net.transport` 租约，关闭界面后 HTTP/WS 服务仍可存活（`../wasmnest/wasmnest-desktop/src-tauri/src/plugin/services.rs:9-20`）。
- 桌面 HTTP/WS 服务绑 `0.0.0.0:8765`（`../wasmnest-lib/wasmnest-server-base/src/constants.rs:362,407`），路由含 JWT 档与 `auth:none` 档（`apps/bedcode/desktop/rust/src/http_routes.rs`）。
- 移动把桌面地址存成 `{ address, port }`（`apps/bedcode/mobile/rust/src/lib.rs:198-215`），HTTP 用 `http://{address}:{port}`（`.../session.rs:102`），终端 WS 用 `ws://{address}:{port}`（`.../link.rs:162`）。
- 二维码载荷是 `{ host, port, token }`（`apps/bedcode/mobile/src/host/qr.ts:13-17,38-60`），token 为 128-bit 一次性 QR token（`servers/auth-center/desktop/rust/src/pairing/qr.rs`）。
- 结论：移动端只缺一个「可达的 peer 连接」。宿主在移动侧把 tunnel 映射成本地回环 `address:port`，现有 HTTP/WS/JWT/重连代码几乎不用改。

### 1.2 file-transfer：host-peer 名流，LAN-only

- 双端共用一份 wasm，使用 `mdns` + `peer` 能力；不直接依赖 peer-net crate（`apps/file-transfer/rust/plugin/src/lib.rs:71-73`）。
- 调 `peer_start_node`（声明默认端口 47613，常量在 `apps/file-transfer/rust/plugin/src/lib.rs:129`；生产租约装配下实际用宿主全局端口，见该 app CHANGELOG）、`peer_dial({nodeId, addr, port})`、`peer_send_files` / `peer_pull_files`（`apps/file-transfer/rust/plugin/src/peer.rs`）。
- peer-net 的传输是 TCP + Noise + Yamux，具名流 `/wasmnest/{trust-status,transfer,shared-dir,session}/1`（`../wasmnest-lib/wasmnest-p2p-engine/src/stream_proto.rs`）。
- 发现走 `_wasmnest-peer._tcp.local.` 的 mDNS；跨网段/被防火墙拦截即不可达；数据面要求对端在发现缓存里，`dial_peer_endpoint` 是唯一的显式地址逃生口（`../wasmnest-lib/wasmnest-server-peer-net/wit/peer.wit:44`；`src/lib.rs:349`）。
- 结论：跨 NAT 只需要让 `dial` 能接受 relay multiaddr，并让数据面记住多地址；传输协议本身不动。

### 1.3 现有 p2p 栈的能力边界

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 身份 | Ed25519；`node_id = hex(SHA-256(pubkey))`；PeerId ↔ node_id 互验 | `wasmnest-p2p-engine/src/identity_bridge.rs` |
| 传输 | libp2p 0.57.1，TCP + Noise + Yamux；无 QUIC/TLS | `wasmnest-p2p-engine/Cargo.toml:25-38` |
| 发现 | 宿主 mDNS（`wasmnest-discovery-engine`），引擎不含 mDNS | `wasmnest-p2p-engine/src/lib.rs` 头注 |
| 流 | `libp2p-stream` 具名流；四个 `/wasmnest/*/1` | `stream_proto.rs` |
| 准入 | 信任状态流 + 首连确认；30s 超时 / 8 pending | `wasmnest-p2p-engine/src/admission.rs` |
| 外网地址 | 无 identify / 无 observed addr / 无 relay / 无打洞 | `wasmnest-p2p-engine/src/lib.rs:42-43` P2 列「QUIC / relay / 打洞、外部地址学习」；不启用 identify 的纪律在 `Cargo.toml:35-37` 注释 |
| 节点实例 | 服务租约路径恒用全局 `PeerCtx`；per-app 实例表未落地（#5） | `wasmnest-server-peer-net/src/plugin_binding.rs:556-561` |

**关键含义**：穿透不需要新建一套身份/信任；但必须先决定「谁拥有中继连接」。本方案复用**宿主全局 peer 节点**（一个进程一个 node identity、一个 relay reservation），应用通过能力 ACL 共享，不做 per-app 多身份。

### 1.4 移动端生命周期

移动宿主没有常驻 daemon；`ForegroundService.kt` 只用于保持 WebSocket/唤醒锁（`../wasmnest/wasmnest-mobile/src-tauri/gen/android/app/src/main/java/com/wasmnest/mobile/ForegroundService.kt`）。因此：

- bedcode 移动作为**拨号方**，不需要 relay reservation，前台时建立隧道即可。
- file-transfer 移动若要**被桌面主动发送**，需要在接收期间保持 peer 节点/前台服务；后台常驻接收是独立产品决策，不在本方案默认范围。

---

## 2. 技术选型

### 2.1 候选比较

| 方案 | 复用现有身份/信任 | 跨 NAT | 大文件 | 移动端可行性 | E2E 加密 | 运维成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **libp2p Relay v2 + 现有名流** | **高**（Ed25519/Noise/Yamux 全复用） | 高（relay 可达即通；打洞 P3） | 中（受中继带宽限制） | **高**（纯 Rust，无 VpnService） | 高（Noise） | 中（自建 relay） | **推荐** |
| frp / rathole 反向隧道 | 低（另起身份与进程） | 高 | 中 | 中（移动端要 sidecar/前台服务） | 中（TLS） | 中 | 只适合 bedcode 的 PoC，不解决 file-transfer |
| Tailscale / WireGuard | 低（另建网络层与控制面） | 高 | 高 | 低（Android VpnService + 常驻） | 高 | 低（托管）/高（自建） | 不推荐 |
| WebRTC + STUN/TURN | 低（DTLS/SCTP 另起栈） | 高 | 中/高 | 中 | 高 | 高（TURN 带宽） | 不推荐 |
| Cloudflare Tunnel / ngrok | 低 | 高 | 低 | 中 | 中 | 低 | 外部依赖、无 P2P、不适合批量文件 |
| UPnP / NAT-PMP | 中 | 低（仅部分路由；CGNAT 无效） | 高 | 低 | 中 | 低 | 可选优化，不作为基线 |

### 2.2 为什么选 libp2p Relay v2

1. **身份与信任已经对齐**：peer-net 的 node_id、PeerId、Noise、信任列表、首连确认全部可复用；不需要第二套密钥/配对。
2. **业务协议零改动**：file-transfer 的四条具名流在 relayed connection 上照常多路复用；bedcode 只需要把 HTTP/WS 字节送进隧道。
3. **移动端最轻**：relay client 是纯 Rust/libp2p 组件，不要求 Android VpnService、不要求系统级守护进程；前台服务只用于保持连接。
4. **relay 是标准件**：Circuit Relay v2 就是为「双方都在 NAT 后」设计的；先落地 relay-only，可用性不依赖打洞成功率。
5. **可自建**：relay 是独立守护进程，用户可以在自己的 VPS 上跑；不强制依赖官方公共中继。

### 2.3 为什么不选其它

- **frp/rathole**：本质是「把某个 TCP 端口反向暴露到公网」，没有对等身份、没有应用层信任、没有多路复用语义；移动端还要额外 sidecar。它可以作为 bedcode 单应用的临时 PoC，但不能作为「给多个应用调用」的服务。
- **Tailscale/WireGuard**：网络层方案，能力过宽（IP 级访问）、Android 需要 VpnService、难以嵌进 wasm 宿主的权限模型；与「产品语义在应用、机制在宿主」的边界冲突。
- **WebRTC**：需要 DTLS/SCTP/ICE 全套，Rust 侧栈重；TURN 仍是中继，且要再建一套身份与信任。收益不抵复杂度。
- **Cloudflare Tunnel/ngrok**：把可达性外包给第三方，无法做 P2P 大文件，隐私与成本都不可控。
- **UPnP/NAT-PMP**：只在用户路由器支持且开启时有效，CGNAT/移动网络下无效；且自动开端口有安全风险。可以作为桌面端的可选直连优化，不作为服务基线。

### 2.4 为什么 QUIC/DCUtR 不是 v1

- `libp2p-quic 0.14.0` 的 `quinn` 依赖固定 `rustls-aws-lc-rs`（已在本机 registry 核实）；仓库纪律要求 Android 目标树零 aws-lc-rs（`wasmnest-p2p-engine/Cargo.toml:25-29`）。
- 启用 `identify` 会引入「准入放行前交换元信息」的语义变化（引擎当前刻意不启用，见 `Cargo.toml:35-37` 注释）；DCUtR 依赖 identify 的 observed address。
- TCP 打洞的成功率远低于 UDP/QUIC，不能作为可用性承诺。
- 因此：**relay 是基线，打洞是优化**。P3 再评估「fork/patch libp2p-quic 用 ring」或「自管 UDP 打洞」的可行性。

---

## 3. 总体架构

### 3.1 组件图

```text
┌────────────────────────── 桌面宿主（Tauri + tokio） ──────────────────────────┐
│  bedcode desktop (wasm)        file-transfer (wasm)       其它应用 (wasm)      │
│        │ host-tunnel                │ host-peer                  │              │
│        ▼                            ▼                            ▼              │
│  ┌───────────────────────── 宿主能力层 ────────────────────────────────────┐  │
│  │ host-tunnel（新）: expose / connect / pairing-ticket                   │  │
│  │ host-peer（现有）: 身份 / 信任 / 名流 / 传输                            │  │
│  │ 对等 HTTP/WS 面（新）: 127.0.0.1:<peer-face>，caller = peer             │  │
│  └──────────────────────────────┬──────────────────────────────────────────┘  │
│                                 │ Noise + Yamux 名流                           │
└─────────────────────────────────┼──────────────────────────────────────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │  wasmnest-relay      │  公网/自建 VPS
                       │  Circuit Relay v2    │  预留 + 流量转发 + 配额
                       │  /wasmnest/pairing/1 │  可选：配对码 rendezvous
                       └──────────▲──────────┘
                                  │ Noise + Yamux
┌─────────────────────────────────┼──────────────────────────────────────────────┐
│  ┌──────────────────────────────┴──────────────────────────────────────────┐  │
│  │ 宿主能力层（移动）: host-tunnel client / host-peer / host-http / ws-client│  │
│  └──────────────────────────────┬──────────────────────────────────────────┘  │
│  bedcode mobile (wasm)          │ file-transfer (wasm)                         │
│  本地回环 127.0.0.1:<port> ─────┘ 直接走 peer 流（无需 HTTP 隧道）             │
└────────────────────────── 移动宿主（Android） ────────────────────────────────┘
```

### 3.2 两条数据路径

| 场景 | 路径 | 说明 |
| --- | --- | --- |
| bedcode 远程终端 | 移动 wasm → host-http/ws-client → 本地回环代理 → `/wasmnest/tunnel/1` 流 → 桌面**对等 HTTP/WS 面** → 现有路由/JWT | 现有 HTTP/WS 代码不改；只替换 `address:port` 的解析来源 |
| file-transfer | 发送方 wasm → `peer_send_files` → peer 名流 → 桌面/移动 peer 节点 | 传输帧协议不变；拨号地址多一个 relay multiaddr |

### 3.3 组件职责

| 组件 | 所在仓 | 职责 |
| --- | --- | --- |
| `wasmnest-p2p-engine` | 能力仓 | relay client、reservation 生命周期、多地址拨号、传输状态事件；P3 再接 QUIC/DCUtR |
| `wasmnest-server-peer-net` | 能力仓 | `host-tunnel` WIT 绑定、`/wasmnest/tunnel/1` 流、端口 ACL、对等 HTTP/WS 面的服务端接入 |
| `wasmnest-relay` | 能力仓（新 crate/可部署二进制） | Relay v2 server、reservation 准入、配额、可选配对 rendezvous、指标 |
| `wasmnest-server-http` / `-core` | 能力仓 | `HttpCaller::Peer` 分类、对等面监听、与现有网关共享路由表 |
| 桌面宿主 | 平台仓 | 装配 `net.tunnel` 服务租约、对等面生命周期、权限位、manifest |
| 移动宿主 | 平台仓 | `host-tunnel` client 绑定、本地回环代理、前台服务协作 |
| bedcode | 应用仓 | 桌面经对等面暴露 8765（`kind=http`，逻辑端口）、QR v2、状态 UI；移动目标解析与重连；解配对时撤销 peer 信任 |
| file-transfer | 应用仓 | 远程设备连接串/QR、多地址拨号、中继传输状态与限额 |
| auth-center | 应用仓 | QR v2 载荷、配对票据透传；配对成功后触发 peer 信任 |

---

## 4. 机制设计

### 4.1 两层信任（不要混为一谈）

| 层 | 凭据 | 存储 | 作用 |
| --- | --- | --- | --- |
| 传输层 | 宿主 peer 身份（Ed25519 / node_id）+ 信任列表 + 配对票据 | `trusted_nodes.json`（peer-net） | 决定「这个节点能不能开隧道/开流」 |
| 应用层 | auth-center JWT / 6 位配对码 / QR token | 认证中心密钥环 + 配对库 | 决定「这个设备能不能调这个 API」 |

**「已匹配」的判定**：本文「匹配」= 已完成配对/信任的状态，不是设备发现/搜索的匹配。一台设备只有同时满足下面两条才算匹配，才允许接入（开隧道 / 收发文件 / 调远端 API）。当前粒度按**设备**；若产品要求账号级匹配，需要跨应用匹配表，见 §9.2。

| 条件 | bedcode | file-transfer |
| --- | --- | --- |
| 应用层 | auth-center 配对记录有效（JWT 可验签） | 接收方已同意首连（consent） |
| 传输层 | 宿主 peer 信任列表含该 node_id | 同一份 peer 信任列表（consent 即写入） |

**配对窗口**：未匹配设备不是「一律拒绝到无法配对」，而是只允许一个**短命、单用途**的窗口：

- 窗口由目标设备用户主动发起（生成 QR / 配对码 / 连接串），宿主签发一次性配对票据（TTL ≤ 120s，绑定目标端口；LAN 与 relay 两条接入路径均可使用，见 §4.4）。
- 窗口内只放行**配对端点**（bedcode 的 `/api/auth/*`；file-transfer 的 trust-status + consent），不放行任何业务端口/业务流。
- 窗口结束（成功、过期、失败、用户取消）立即关闭；成功后设备进入「已匹配」，后续走正常匹配校验。
- 未匹配且无票据的 peer：传输层直接拒绝，不弹「是否信任」的业务访问；最多只允许 trust-status 首连确认流（不承载数据）。

**传输层实现要点**：准入闸门需要一个 `Pairing` 态——只有 trust-status 首帧携带有效配对票据时才进入；该态只允许 `/wasmnest/trust-status/1` 与 `/wasmnest/tunnel/1`（且 tunnel 只允许配对端点），不允许 transfer / shared-dir / session 等业务流。配对成功写入信任后，由移动端重建隧道（或宿主把链路提升为 Admitted）；配对窗口的连接不得被复用于业务访问。

**配对窗口的路径级闸门落点**：tunnel 首帧之后是裸字节 pipe，流本身无法做路径级裁决；「只放行配对端点」必须在 HTTP 层执行——

- 隧道服务端把首帧判定为配对态（票据有效）的连接标记为 pairing，并在 dial 对等面之前把该连接登记进 peer face 的配对连接注册表（宿主进程内共享；以连接四元组为键，accept 时消费）。
- peer face 对配对态连接强制路径白名单：bedcode 仅 `/api/auth/*`；白名单外一律 403。非配对态的已匹配连接不受此白名单限制（其访问面由 §0.4 裁定与路由自身门禁决定）。
- 配对态随请求上下文传递（与 `peerNodeId` 并列），插件与宿主路由都可据此裁决；配对成功/票据失效后注册表条目立即清除。
- 注意：`/api/auth/` 在 link-crypto 的 HTTP 白名单豁免内（`link_crypto.rs:968-981`），配对流量是 Noise 内的明文 HTTP——这是有意设计（配对端点本身是信任引导入口），不视为降级；但豁免判据本身必须按 §4.5 改为面标记，防止业务流量借环回豁免逃逸。

**作用域提醒**：宿主 peer 信任当前是**进程级全局**（`trusted_nodes.json`），不是 per-app。若产品要求「应用间隔离」（例如 bedcode 配对不应自动获得 file-transfer 的信任），需要给信任条目加 app scope，或在应用侧维护独立的 allowlist；否则一次 bedcode 配对会让 file-transfer 也认为该设备已信任。这个取舍必须显式裁定（见 §9.2）。隧道层可以用 `allowedPeers` 先做 bedcode 侧的收窄，但 file-transfer 的 peer 流仍按全局信任判定——收窄不完整。

规则：

1. 隧道只对**已匹配**的 peer 开放；首次配对用一次性**配对票据**开口，票据只允许访问配对所需的端口/目标（绑定目标端口，LAN/relay 均可用），用完即焚。
2. bedcode 配对成功后，桌面必须把移动 node_id 加进 peer 信任列表，并在 auth-center 配对记录里保存该 nodeId（供隧道 `allowedPeers` 与撤销使用）；否则下次远程访问仍会弹首连确认，allowlist 也建不起来。
3. 解配对/撤销设备时，必须同时 `host-peer.revoke-trusted`，否则「应用层已撤销、传输层仍可开隧道」。
4. 不做隐式信任：relay 的 reservation 不等于信任；relay 只是转发。relay 级 allowlist 只用于防滥用，不能替代目标宿主的匹配校验。

### 4.2 中继节点（wasmnest-relay）

**定位**：独立守护进程，跑在公网 VPS / 用户自建服务器；不是 wasm，不是宿主内嵌服务。

**最小行为**：

- libp2p swarm：TCP + Noise + Yamux；relay v2 server；ping；`libp2p-stream` 用于控制协议。
- 监听示例：`/ip4/0.0.0.0/tcp/4001`；对外通告 `/dns4/relay.example.com/tcp/4001` 或 IP 字面量。
- Reservation 准入：按 PeerId 允许/拒绝；支持「开放 + 配额」与「allowlist」两种模式。
- **relay 不是授权点**：reservation 只代表「可以经我转发」，不代表「可以访问目标」。匹配校验的权威在目标宿主；公开 relay 的 enrollment/allowlist 只用于防滥用，不能替代匹配校验。
- 配额：`max_reservations`、`reservation_ttl`、`max_circuit_duration`、`max_circuit_bytes`、每 peer 并发 circuit 上限、每 IP 连接上限。
- 可选控制协议 `/wasmnest/pairing/1`：配对码/连接串的 rendezvous（见 4.3）；v1 可以先不做。
- 指标：reservations / active circuits / bytes / rejected；不记录 payload、文件名、路径。
- 部署：Dockerfile + systemd unit + 示例配置；无需 TLS 证书（Noise 在 libp2p 层完成），域名只需 DNS 解析。

**地址解析**：引擎当前 `default-features = false` 未启用 `dns`。relay 地址若是域名，需二选一：

- 启用 libp2p `dns` feature（评估 Android 构建）；或
- 宿主层用 `tokio::net::lookup_host` 把域名解析成 IP，再拼 multiaddr（推荐，避免改引擎 feature 面）。

**地址格式**（libp2p 标准）：

```text
# 本机在 relay 上预留
/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay.../p2p-circuit

# 对端可拨（relay 地址 + 目标 PeerId）
/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay.../p2p-circuit/p2p/12D3KooWTarget...
```

#### 4.2.1 一键配置 / 一键运行（交付物）

**交付物**（能力仓新增 `wasmnest-relay` crate + `deploy/relay/`）：

- 单文件二进制：`wasmnest-relay`（**仅 Linux**：linux-amd64 / linux-arm64 静态）。不做 Windows/macOS 二进制或服务包。
- Docker 镜像：`ghcr.io/7zai/wasmnest-relay:<version>`（linux/amd64、linux/arm64）；附 `docker-compose.yml`。
- 可选 `install.sh` + systemd unit（Linux VPS）；默认推荐 Docker Compose（镜像 digest 钉住）。
- 配置向导与自检命令：

```bash
# 一键配置：生成身份密钥、配置、relay multiaddr / 二维码
wasmnest-relay init --dir /etc/wasmnest-relay --advertise relay.example.com

# 一键运行
wasmnest-relay run --config /etc/wasmnest-relay/config.toml

# 自检：身份、端口、公网可达、时钟、磁盘、版本
wasmnest-relay doctor

# 输出给应用导入的地址（JSON / 二维码）
wasmnest-relay print-addrs --json

# 可选：私有 relay 的 enrollment token
wasmnest-relay token create --label phone
```

```bash
# Docker 一键运行（身份与配置落 /data，重启不换 PeerId）
docker run -d --name wasmnest-relay --restart unless-stopped \
  -p 4001:4001 -v wasmnest-relay-data:/data \
  ghcr.io/7zai/wasmnest-relay:<version>

# 或
docker compose up -d
```

**桌面端配套**：设置页新增「中转服务器」卡片：

- 「生成部署命令 / 下载 compose」——只生成文本，不在应用内 SSH 或保存服务器凭据。
- 「导入 relay 地址」——粘贴 `print-addrs` 的 JSON / multiaddr / 二维码。
- 「检测连通性」——用 peer 引擎拨 relay，显示 PeerId 指纹与 RTT；失败给可操作原因（端口/防火墙/DNS/版本）。

**默认值**：

- libp2p 监听 `0.0.0.0:4001/tcp`；v1 不启用 UDP（QUIC 在 P3 再评估）；无需 TLS 证书（Noise 在 libp2p 层）。
- 指标/健康端点绑 `127.0.0.1:9090`，不默认对公网暴露；如需公网暴露，必须加 token 或反代 TLS。
- 默认「开放 + 配额」降低上手门槛；`--allowlist` 或 enrollment 供私有 relay 使用。目标宿主的匹配校验仍是权威。
- 身份密钥存 `/data/identity.key`；`init` 检测到已有密钥时拒绝覆盖（需显式 `--force`）。丢失身份 = PeerId 变化 = 所有客户端需重新导入。
- 不记录 payload / 文件名 / 路径；指标只聚合计数与字节数。
- 防火墙只需放行 TCP 4001；P3 若启用 QUIC 再加 UDP 4001。
- Compose 带 `restart: unless-stopped`、healthcheck 与数据卷；生产建议镜像 digest 固定。
- 版本独立：relay 按 `relay-vX.Y.Z` 发版；`print-addrs` 带协议版本，应用导入/`doctor` 校验；身份密钥与版本解耦。

**一键配置 vs 一键运行**：`init` 解决「配置」；`docker run` / `compose up` / `install.sh` 解决「运行」；两者可独立使用。桌面端只生成部署文本和导入地址，不代替用户执行远端命令。若用户没有 VPS，才需要「官方托管 relay」；一键包解决的是自建路径，两者不是同一件事。

### 4.3 地址与配对

#### QR v2（推荐路径）

在现有 `{host, port, token}` 上追加 `peer` 字段，旧版移动端忽略未知字段仍走 LAN：

```json
{
  "v": 2,
  "host": "192.168.1.5",
  "port": 8765,
  "token": "…32 hex…",
  "peer": {
    "nodeId": "…64 hex…",
    "addrs": [
      "/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget...",
      "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay.../p2p-circuit/p2p/12D3KooWTarget..."
    ],
    "ticket": "…一次性传输票据…"
  }
}
```

- `peer.addrs` 是**同一个 peer 节点**的多地址列表：LAN 直连地址（第一条，端口取 `host-tunnel.status` 的实际监听端口，不写死 47613）+ relay 地址（后续）。LAN 地址由宿主枚举本机非虚拟网卡 IP 生成，**不能返回 `0.0.0.0`**；多网卡时列多条。`host/port` 是桌面 HTTP 端口，只用于旧版移动端兼容与诊断，不作为新版 bedcode 的数据入口。
- `ticket` 由桌面宿主签发（`host-tunnel.issue-pairing-ticket`），绑定目标端口 + TTL（建议 ≤ 120s）+ 一次性；LAN 与 relay 两条接入路径均可使用（§4.9 要求先试 LAN，票据不得绑定单一接入路径）；只用于首次配对，不代表应用层信任。
- 移动端拿到 QR 后：按 §4.9 先试 LAN 地址，明确不在内网才试 relay；`host:port` 只作为旧版回退。
- 旧版移动端只认 `host/port/token`，走 LAN HTTP——**兼容承诺仅对已支持 link-crypto 的旧客户端成立**：桌面固定 `required` 后，不具备链加密能力的旧客户端会显性失败（§9.1 风险 9），不存在明文回退。

#### 连接串（file-transfer / 无摄像头场景）

把同样的 `peer` 信息编码成 `wasmnest://pair/<base64url(json)>` 或纯 JSON 文本，桌面「添加远程设备」/移动「扫码或粘贴」共用一套解析。连接串里**不放长期密钥**，只放 nodeId + relay addrs + 一次性票据。

#### 6 位码远程配对（另议）

6 位码只有约 20 bit 熵。如果由不可信 relay 做 rendezvous：

- 必须限速（每 IP/每码 5 次/分钟、每码 10 次上限、60s TTL）；
- 必须把码当作 PAKE（如 SPAKE2）的密码，或让 relay 只返回「加密的 peer 信息」，否则可被离线枚举；
- v1 建议：**6 位码只用于 LAN**；远程配对走 QR/连接串。若产品坚持远程 6 位码，单独开票据做 PAKE 评估。

#### 已配对设备的持久化

- 应用侧按 nodeId 存 `{deviceName, relayAddrs[], lastSeen}`；地址不是秘密，可放插件 storage。
- 不在宿主 trust store 里存 relay 地址（trust store 保持「谁可信」的单一语义）；寻址由调用方显式传入，延续 `dial-peer` 的 endpoint 语义。
- relay 地址变化时由应用更新；`peer:transport` 事件可帮助刷新。

### 4.4 穿透通道（`/wasmnest/tunnel/1`）

**服务端（被访问方）**：

1. 应用调 `host-tunnel.expose({ port, label, allowedPeers[] })`；宿主记录规则，默认不暴露任何端口。`expose` 幂等地确保全局 peer 节点已就绪（必要时 acquire `net.peer-node` / `net.tunnel` 租约）；relay reservation 的建立/释放由宿主隧道管理器统一引用计数（§4.8），`expose` 不直接管理 reservation。
2. 宿主校验（按 kind 区分端口语义）：`kind=http` 的 `port` 是**逻辑端口标识**（客户端首帧携带、与应用服务端口一致，如 bedcode 的 8765），实际后端恒为对等 HTTP/WS 面，不做回环可达探测；`kind=tcp` 的 `port` 必须是本机回环可达端口，且拒绝宿主管理端口（8765 网关、peer 端口、peer face、relay 控制端口等）。两种 kind 都要求应用有 `tunnel:serve` 权限。
3. 对端经 relay/LAN 拨入并完成准入后，客户端开 `/wasmnest/tunnel/1` 流。
4. 首帧：`u32be len | JSON {v:1, port, kind:"http"|"tcp", ticket?}`。
5. 服务端校验：peer **已匹配**（应用配对 + 传输信任）；`allowedPeers` 为空 = 所有已匹配 peer，非空 = 只允许列出的已匹配 peer；端口/kind 在规则内；票据有效（仅配对窗口；票据绑定目标端口，LAN/relay 均可用，一次性消费）；并发/字节配额。未匹配 peer 一律拒绝，只有 §4.1 的配对窗口例外。
6. 按 kind 选择后端：`http` → 连**对等 HTTP/WS 面**（不是 8765；配对态连接先登记 §4.1 的配对连接注册表）；`tcp` → 连 `127.0.0.1:<port>`（仅回环，且拒绝宿主管理端口）。回 `{ok:true, caller:"peer", peerNodeId}`，之后裸字节双向 pipe。
7. 空闲超时（WS 等长连接升级后不按短空闲回收，见 §4.8 保活要求）、单 peer 并发上限、单流字节上限；关闭即释放。

**客户端（访问方）**：

1. 应用调 `host-tunnel.connect({ nodeId, port, kind, addrs[] })`；宿主幂等地确保全局 peer 节点已启动（移动端首次使用会生成/加载节点身份）。
2. 宿主按 §4.9 选择地址（默认 LAN；只有明确不在内网才用 relay），开流、发首帧、等 `{ok:true}`。
3. 宿主在 `127.0.0.1:0` 起一个 TCP listener（**只绑 loopback**），返回 `{ addr:"127.0.0.1", port:<ephemeral>, handle }`。
4. 每个 accept 的连接开一条新的 tunnel 流；连接关闭即流关闭。
5. `close(handle)` 关 listener 与所有在飞流；应用 deactivate 时必须关闭。

**为什么每条 TCP 连接一条流**：Yamux 已经多路复用；每条流独立首帧，便于服务端按端口/票据/ACL 逐条裁决；避免在流内再实现一套多路复用。

**WIT 提案**（包归属**已裁定**：新开 `wasmnest:tunnel` 独立包独立演进，见 §9.2#8；T05 按下方形状落 `wasmnest:tunnel@0.0.1`）：

```wit
interface host-tunnel {
  record expose-config {
    port: u16,
    /// http = 走宿主对等 HTTP/WS 面（caller=peer），port 为逻辑端口标识（如 bedcode 8765）；
    /// tcp = 原样转发到 127.0.0.1:<port>，port 必须回环可达且非宿主管理端口
    kind: string,
    label: string,
    /// 空 = 所有已匹配 peer；否则只允许这些 node id
    allowed-peers: list<string>,
  }
  /// 服务端：暴露一个逻辑端口；返回规则 id
  expose: func(config: expose-config) -> result<string, string>;
  unexpose: func(rule-id: string) -> result<bool, string>;
  /// 客户端：把对端 <node-id>:<port> 映射到本机 127.0.0.1:<local-port>
  /// kind 必须与服务端 expose 规则一致；addrs-json = multiaddr 字符串数组
  /// pairing-ticket：仅首次配对传入（来自 QR/连接串），写入 tunnel 首帧；已匹配连接省略
  connect: func(node-id: string, port: u16, kind: string, addrs-json: string, pairing-ticket: option<string>) -> result<string, string>;
  close: func(handle: string) -> result<bool, string>;
  /// 首次配对：签发一次性传输票据（只开配对窗口，不建立应用信任）
  /// 票据绑定目标端口 + TTL（≤120s）+ 一次性；LAN 与 relay 均可使用，不绑定单一接入路径
  issue-pairing-ticket: func(port: u16, ttl-secs: u32) -> result<string, string>;
  /// 传输状态：direct / relay / relay-reserved / offline + addrs + rtt
  status: func() -> result<string, string>;
}
```

权限建议拆两位，避免「能连」等于「能暴露」：

- `tunnel:serve`：expose / unexpose / issue-pairing-ticket（桌面 bedcode、服务型应用）。
- `tunnel:connect`：connect / close（移动 bedcode、远程客户端）。
- 读 `status` 可以归入 `tunnel:connect` 或 `peer`。

### 4.5 bedcode 的对等 HTTP/WS 面（安全关键）

**问题重述**：如果隧道服务端直接连 `127.0.0.1:8765`，网关会把请求判为 `localhost`（`plugin_controller.rs:118-134`），从而让远端访问 `auth:none` 的桥接路由（`run/bridge/mod.rs:44-54`）。这不是理论风险，是权限提升。

**方案：新增「对等 HTTP/WS 面」**：

- 宿主在 `127.0.0.1:<ephemeral>` 起第二个 Actix listener，复用同一套路由表与鉴权中间件，但把该 listener 上的所有请求标记为 `HttpCaller::Peer`（新变体，线协议 `caller:"peer"`）。
- **关键实现细节**：peer face 的连接虽然来自 loopback，但分类**不得**再用 `req.peer_addr().is_loopback()`；由 listener 注入 `peer_face=true`，`classify` 在该标记下对未验签请求返回 `Peer`，而不是 `Localhost`。
- **环回豁免必须同步改判据（安全关键）**：桌面 link-crypto 现行豁免按**源 IP 环回**判定（`link_crypto.rs:968-981`），移动 WS 域对**环回目标**直接跳过链加密（`plugin/host_domains/ws.rs:210-239`）。本方案让全部隧道流量走 127.0.0.1，若不改判据，两端都会把隧道流量豁免/跳过，「固定 `required`」被静默绕过——正是 §4.10 禁止的降级。要求：豁免/跳过判据一律改为**面标记**（与 `peer_face=true` 同一注入机制；移动以本地代理句柄上下文区分隧道流量与真本机流量），peer face / 本地代理流量不享受环回豁免，`required` 下缺链路身份即拒绝（不变量 15；实施核查 2026-11-08 见附录 C）。
- 隧道服务端只连这个 peer face，不再连 8765。
- **caller 门禁的覆盖面（评审裁定 §0.4）**：`run::bridge::caller_allowed` 只接受 `localhost`，run-* 四条桥接路由对 `peer` 一律 403，不需要改 bedcode 桥接逻辑；但 `task-status` / `session-mode` / `terminal-bg` 三条免凭证路由**没有 caller 检查**，caller 标记保护不了它们——裁定为对已匹配远端保持可达（移动端真实依赖 `session-mode`），访问控制由隧道匹配校验承担；不得把「peer 一律 403」表述为覆盖全部 auth:none 路由。
- JWT 路由不受影响：移动端带 JWT 时，认证网关仍注入 `device`；`peer` 面只是不把未验签的隧道流量伪装成本机。
- WS 面同样处理：WS 升级请求在 peer face 上被标记为 `peer`；终端端点仍要求 JWT。
- peer face 只绑 loopback，不对 LAN 暴露；启动/关闭跟随 `tunnel:serve` 规则的生命周期。
- 宿主必须在 `expose` 时拒绝「把 peer face 端口或 8765 端口以 `kind=tcp` 裸暴露」的规则，防止回环套娃（`kind=http` 的 8765 是逻辑端口，不在此列，见 §4.4）。
- peer face 必须把**已验证的 `peerNodeId`** 作为请求上下文传给插件（与 `caller` 并列；配对态连接另附 pairing 标记，供 §4.1 路径白名单执行）；bedcode 在配对成功且 JWT 签发后用该 nodeId 写入 peer 信任，不能信任客户端自报值。LAN 直连的首次配对走配对窗口（票据经 tunnel 首帧），与 WAN 共用同一套准入；两条路径最终都落到「已匹配」判定。

**为什么不是改 bedcode 桥接门禁**：

- 把 `run-attach` 等改成每运行 bearer secret 是更彻底的应用侧修复，也值得做（作为纵深防御）；但它需要改 agent 注入脚本、扩展环境变量、改路由门禁，且其它 `auth:none` 路由（`task-status` / `session-mode` / `terminal-bg`）仍共享「环回即本机」假设。
- 对等面是平台级一次性修复，所有服务型应用受益；建议优先做。

**对移动端的影响**：

- `PrimaryTarget` 增加可选 `peer` 信息；**新版 bedcode 始终走 tunnel**：按 §4.9 选择底层 peer 连接（LAN 直连地址优先，明确不在内网才用 relay），`tunnel.connect` 成功后把 `127.0.0.1:<localPort>` 当作 `address:port`，其余代码不变——**唯一例外是链加密豁免判据**：本地代理目标虽是 127.0.0.1，必须按面标记正常协商 link-crypto，不得触发环回跳过（§4.5）。LAN 模式下不经过 relay，但同样经对等 HTTP/WS 面（caller=`peer`），因此传输信任与 `peerNodeId` 始终可得。
- 远端设备的 `address` 不再持久化为 LAN IP；持久化 nodeId + relay addrs + device name + 最近一次模式和原因，重启后重新判定。
- 断线重连：隧道断开 → 按 §4.9 重新判定或重连 → 现有 WS 重连逻辑继续；如果桌面离线，错误应显性为 `peer-offline`，不要退化成 30s 超时。
- 配对完成后：桌面把移动 node_id 写入 peer 信任列表；移动若被撤销，桌面同时 `revoke-trusted`。未匹配设备只能进入 §4.1 的配对窗口，不能打开业务隧道。

### 4.6 file-transfer 的多地址拨号

**WIT 扩展**（二选一，推荐 B）：

- A. 改 `dial-peer` 的 endpoint：`{ nodeId, addr, port }` → `{ nodeId, addrs: [multiaddr...] }`（破坏性，需重建所有旧产物）。
- B. 保留 `dial-peer`，新增 `dial-peer-addrs(endpoint-json)`：`{ nodeId, addrs: [multiaddr...] }`；旧路径不动，新路径显式多地址。

**拨号策略**：

1. 先试 LAN 地址（mDNS 缓存 / 上次直连地址），超时短（如 2-3s）。
2. **只有 §4.9 判定「明确不在内网」才试 relay multiaddr**；同网段超时 / `ECONNREFUSED` / 服务未启动不触发自动切 relay（保持 lan，给手动「尝试外网」）。
3. 成功后在 `PeerLink` 记录 `transport: lan | wan`（以及 `wan` 下的 relay 地址），供 UI/指标使用。
4. 会话句柄记忆**全部**候选地址（现在只记一个 endpoint），断线重拨按同样顺序 + §4.9 判定重试。
5. 数据面 `send/browse/pull` 的自动重拨复用同一策略；不再要求对端在 mDNS 发现缓存里。

**产品语义**：

- **内网默认**；跨网且明确不在内网才出现「外网中继」状态。不允许因为「mDNS 刚没发现」就立即烧中继。
- `allowWan` 控制**外网能力**：支持外网访问的业务默认具备 wan 能力（file-transfer 默认开；bedcode 的「远程访问」开关即包含此项），用户可关闭作为隐私/流量限制；关闭后不自动切 wan，只显示「外网访问已关闭」。**关闭 `allowWan` 是关闭外网通道，不是关闭加密**——加密仍永久强制，只是没有 WAN 流量可发。`relayMaxBytesPerTask` 可选中继单任务上限。大文件经 relay 时给一次提示「本次将经中继，可能较慢」，让用户取消或继续——提示不改变 §4.9 的模式判定。
- **应用层加密固定开启**：WAN 与 LAN 的批次都强制 `encrypt=true`，不依赖用户设置，也不提供关闭开关；界面显示「始终加密」而不是可切换项。传输状态栏显示 `内网直连` / `外网中继` / `内网不可达` / `已暂停`。
- 断点续传、暂停/恢复、并发闸门全部复用现有实现。

### 4.7 直连升级（P3）

目标：在 relay 已连通的前提下，尝试升级为直连，降低 relay 带宽与延迟。

候选路径：

1. **QUIC + DCUtR + identify**：体验最好，但先解决 `libp2p-quic` 的 aws-lc-rs 依赖（fork/patch 或自管 QUIC 传输），并重新评估 identify 与准入闸门的语义。
2. **TCP 同时打开（DCUtR over TCP）**：不引 QUIC，但成功率依赖 NAT 行为；Android 兼容性需实测。
3. **UPnP/NAT-PMP（仅桌面）**：用户显式开启才尝试；只对支持的路由器有效；不作为承诺。

无论哪条，直连/打洞失败都必须回退到 relay（而不是明文公网直连）；回退仍受匹配校验，不得导致功能或安全降级。

### 4.8 生命周期与后台

- 桌面：bedcode `backgroundTransport: true` 已保证 HTTP/WS 服务随运行期存活；新增 `net.tunnel` 服务租约（或复用 `net.peer-node`）。**relay reservation 由宿主隧道管理器单一引用计数所有**：计数来源 = 生效的 expose 规则（`allowWan=true` 时才计入）+ 客户端在飞 WAN 拨号需求；0→1 建立、1→0 释放。`expose`/`unexpose`、`allowWan` 开关、服务租约都只改计数，不各自直接管理 reservation。`allowWan=false` 时即使存在 expose 规则也不建立/保留 reservation（LAN 入口不受影响）；lan-active 期间 reservation 可保留（控制面，默认换取快速切换），但受同一计数与 `allowWan` 门控。界面关闭不影响。
- 移动：bedcode 作为拨号方，前台建立隧道；离开终端页关闭隧道（与现有「不在后台常拉」一致）。本地代理 handle 关闭后，现有重连逻辑的拨号失败必须映射为显性错误（`peer-offline` / `tunnel-closed`），不得对已关闭的 127.0.0.1 端口静默重试。
- file-transfer 移动：接收期间保持 peer 节点/前台服务；后台常驻接收需单独产品裁定。
- 节点重启/relay 重启：reservation 自动重连 + 指数退避；`peer:transport` 事件推送 `relay-lost` / `relay-reserved`。
- **长连接保活**：tunnel 空闲超时不得杀掉静默的终端 WS——流承载 WS 升级后按长连接处理（应用层 ping 或隧道层 keepalive），空闲回收只适用于短连接 HTTP 流。
- 所有「不可用」必须可见：relay 未配置、reservation 被拒、对端离线、端口未暴露、票据过期，分别给不同错误码。

### 4.9 传输模式：内网默认，明确不在内网才切外网

**定义**：

- **内网模式（lan）**：直连对端的 LAN 地址（mDNS 发现 / 上次 LAN 地址），数据不经过 relay。
- **外网模式（wan）**：经 relay 转发；P3 的打洞直连在逻辑上仍属 wan 模式（不依赖 LAN）。
- 模式是**每对端**的，不是全局开关：同一台手机可以对桌面 A 走 lan、对桌面 B 走 wan。
- 默认 lan；只有「明确不在内网」才自动切 wan；lan 恢复后自动切回。
- 外网模式是**能力**，不是默认：应用必须在 manifest 声明 `tunnel:serve` / `tunnel:connect`，且用户开启 `allowWan` 后才可用；未声明的应用永远 lan-only。
- 网络类型与接口子网判定由**宿主**完成（Android `ConnectivityManager` / 桌面接口枚举），不暴露给前端 JS；应用只读 `host-tunnel.status` 与 `peer:mode` 事件。

**「明确不在内网」的判据**：

| 判据 | 是否明确 | 动作 |
| --- | --- | --- |
| 移动端网络类型为蜂窝（无 Wi-Fi / Ethernet） | 是 | 直接进入 wan |
| 对端 LAN 候选 IP 不在本机任何接口子网内，且 mDNS 无对端记录 | 是 | 进入 wan |
| 没有任何 LAN 候选（无 mDNS、无上次 LAN 地址、连接串不含 LAN 提示） | 是（没有内网路径） | 进入 wan |
| 所有 LAN 候选返回 `EHOSTUNREACH` / `ENETUNREACH`（不是 timeout） | 是 | 进入 wan |
| 同网段连接超时 / `ECONNREFUSED` / 服务未启动 | **否** | 保持 lan，显示「内网不可达/服务未启动」，给手动「尝试外网」 |
| 认证失败 / 未匹配 / Noise 握手失败 | **否** | 保持当前模式，报安全错误；**不得**为了绕过失败而切 relay |
| mDNS 尚未发现、刚启动 / 刚换网 | **否** | 等一个发现窗口（建议 5s），不急着切 |
| 用户手动点「尝试外网」 | 是（用户裁定） | 进入 wan，本次网络会话内保持；换网后回到自动策略 |

**状态机**：

```text
pairing（仅未匹配 + 有效票据）
   │ 配对成功 → 写入匹配 ─────────────┐
   │ 票据过期/失败/取消 → offline     │
   ▼                                  │
lan-probing ──成功──▶ lan-active ◀────┘
   │  ▲                  │
   │  │ 换网/手动重试     │ 连接断开
   │  └──────────────────┘──▶ lan-probing
   │ 判据不明确（同网段 timeout / ECONNREFUSED / 服务未启动）
   ├──▶ lan-unreachable（显示「内网不可达」+ 手动「尝试外网」入口）
   │ 明确不在内网
   ▼
wan-connecting ──成功──▶ wan-active ──连接断开──▶ wan-connecting
   │                        │
   │                        │ 周期/换网探测 LAN 成功（连续两次）→ lan-active
   │ 失败 / 无 relay / allowWan=false
   ▼
wan-unavailable / offline
```

- `lan-probing` 的默认超时短（建议 2-3s）；失败后不立即切，先按上表判「是否明确」；判据不明确则停留在 `lan-unreachable`（与 §7.2 `peer:mode` 事件词表一致），不自动重试烧流量，换网或用户手动操作才回到 probing。
- `lan-active` 不产生任何 relay 数据流量；relay reservation 可以保留（控制面），但不在 lan 模式承载业务数据。若产品要求「内网时完全断开 relay」，可在 lan-active 释放 reservation、进入 wan 前再建立（代价是首连延迟）；默认保留以换取快速切换。
- `wan-active` 仍按周期（建议 30s）或在网络变化时探测 LAN；连续两次成功再切回，避免抖动。
- **relay 配额与大文件**：`max_circuit_bytes` / `max_circuit_duration` 达到上限会断开 circuit——大文件传输靠应用层断点续传重新拨号建新 circuit 继续，这是预期行为而非错误；relay 默认值建议与 P2 验收（1GB 跨 NAT）对齐（单 circuit 上限 ≥ 1GB 或显式文档化「续传重建」路径），部署方可调低。
- `wan-unavailable` 只在没有 relay 配置 / relay 不可达 / WAN 被用户关闭时出现；不允许静默降级成明文公网直连。
- **认证/信任失败不是模式切换理由**：否则攻击者只要阻断 LAN，就能把流量逼到 relay；且 relay 也绕不过匹配校验。

**两端接入方式**：

- **bedcode**：QR v2 同时带 `peer.addrs`（LAN 直连 + relay）与 `host/port`（仅旧版兼容）。新版移动始终走 tunnel：Wi-Fi 下先拨 `peer.addrs` 的 LAN 地址，蜂窝或明确不在内网才拨 relay；隧道建立后按 §4.5 的本地回环代理接入，现有 HTTP/WS 代码不变。这样 LAN 与 WAN 共用同一条 peer 流与 `caller=peer` 语义，不存在「LAN 直连 HTTP 绕过对等面」的第二条路径。
- **file-transfer**：mDNS 发现即 lan-active；未发现时检查已保存的 LAN 候选 + 当前网络类型；只有明确不在内网才 `dial-peer-addrs` 走 relay。同网段不可达保持 lan，显示「设备离线/服务未启动」，不自动烧中继带宽。
- **桌面作为服务端**：入站 LAN 连接照常；入站 WAN 连接只在「允许外网访问」开启且 peer 已匹配时接受。relay reservation 随宿主隧道管理器的引用计数建立/释放（§4.8，`allowWan` 门控）；关闭时立即停止 WAN 入口，但不影响 LAN。

**可观测性**：

- 设备卡/状态栏显示 `内网直连` / `外网中继` / `内网不可达` / `外网不可用`；切换时给一次轻提示，不弹模态。
- 日志记录切换原因：`mode.lan.selected`、`mode.wan.selected reason=cellular|different-subnet|host-unreachable|user`、`mode.lan.restored`。
- 设置项：`allowWan`（允许外网访问；支持外网访问的业务默认开，用户可关；bedcode 的「远程访问」开关即包含此项）、`relayAddrs`。`allowWan=false` 时不自动切 wan，只显示「外网访问已关闭」；模式仍默认 lan。**这不是加密开关**：加密始终强制，关闭的只是外网通道。

### 4.10 加密：永久强制，WAN 无明文路径

**分层**：

| 层 | 机制 | 默认 | 谁能解密 |
| --- | --- | --- | --- |
| peer / tunnel 传输 | libp2p Noise（X25519 握手 + AEAD，Yamux 多路复用） | **始终开启**；lan 与 wan 都不可关 | 只有两端 peer；relay 只看到密文 |
| bedcode HTTP/WS | link-crypto（X25519 ECDH + HKDF-SHA256 + AES-256-GCM，AAD 绑定路径/方向） | **固定 `required`**（WAN 与 LAN 都强制） | 只有桌面宿主与移动宿主；relay/中间人不可 |
| file-transfer 文件内容 | 应用层 AES-256-GCM（临时 X25519 + HKDF，AAD 绑定 file_index/offset） | **永久开启**（WAN 与 LAN 都强制；不提供关闭） | 只有收发两端；Noise 外的第二层 |
| relay 控制 / 配对 | libp2p Noise；QR token 走带外；6 位码若走 relay 必须 PAKE | 密钥/票据不以明文交给 relay | 目标端 + 用户设备 |
| 日志 / 指标 | 不记录 payload、文件名、路径、token、票据 | 始终 | 无 |

**覆盖范围**：

- **WAN**：整条 HTTP/WS 流（方法、路径、头、体）都在 Noise 内，relay 无法读取；应用层 link-crypto 是纵深防御，主要覆盖 body 与旧 LAN 直连路径。
- **file-transfer**：文件名/路径/控制帧在 Noise 内；文件内容再加应用层 AES-GCM。relay 只看到密文与字节数。
- **LAN**：peer 流同样强制 Noise；bedcode link-crypto 固定 `required`；file-transfer 应用层固定开启。**不提供明文开关**；旧客户端或缺少能力一律 fail-visible。
- **配对**：QR token 只出现在二维码/连接串的带外通道；relay 不接触 token。6 位码若由 relay 做 rendezvous，必须 PAKE（见 §4.3），v1 建议只用于 LAN。

**降级保护**：

- 协商失败 / 对端不支持 / 能力缺失 → `encryption-required` / `encryption-unsupported`，**直接失败**；不得静默回退明文。
- **不提供关闭开关**：bedcode 固定 `required`，file-transfer 固定 `encrypt=true`；配置层与 UI 都不暴露 `off`，宿主也不提供「全局关闭加密」后门。`required` 时缺少链路身份（`identityFingerprint=null`）必须拒绝。
- 旧客户端不支持 link-crypto：显性提示升级；WAN 不允许以「兼容」为由降级。
- WAN 模式与加密绑定：`allowWan=true` 但加密协商失败 → 该次连接失败，不回退到 LAN 明文或公网明文。
- **环回不构成豁免理由**：隧道流量在两端都呈现为 loopback（peer face 入站 / 本地代理出站），豁免判据必须是面标记（§4.5/不变量 15）；任何按源 IP/目标环回的豁免都会击穿 `required`。

**密钥与身份**：

- peer 身份 Ed25519（node_id）；Noise 会话密钥每连接临时生成；link-crypto 每请求/WS 握手临时 X25519；file-transfer 每批临时 X25519。具备前向保密。
- relay 身份在 multiaddr 中钉住 PeerId；客户端必须校验，不接受「同 IP 不同 PeerId」的替换。
- 身份/票据不落日志；relay 指标只聚合计数与字节数。

**现状差距**（需改）：

- file-transfer `TransferSettings::default().encryption = false`（`apps/file-transfer/rust/core/src/settings.rs:35,51`）→ **固定 `true`，移除关闭项**；WAN/LAN 都强制。
- 能力仓链加密配置是布尔组合 `LinkCryptoConfig { enabled, allow_plaintext_fallback, ... }`，默认 `enabled=false`；`required` 语义 = `enabled=true && allow_plaintext_fallback=false`（**非** `off/preferred/required` 三态枚举，实施核查 2026-11-08 见附录 C）。bedcode UI 默认 `off`（`apps/bedcode/desktop/src/composables/useLinkCrypto.ts`）→ **固定 `required`，移除关闭项**；移动宿主已支持 HTTP link-crypto（`../wasmnest/wasmnest-mobile/src-tauri/src/commands/http_proxy.rs:342-487`、`state.rs:151`）与 WS 域链加密（`plugin/host_domains/ws.rs`）；**两端的环回豁免/跳过判据必须按 §4.5 改为面标记**，否则隧道流量被静默豁免。
- 平台保留 `off / preferred / required` 词表供其他应用；bedcode 与 file-transfer 不使用 `off`/`preferred`，配置层拒绝关闭。
- 当前宿主 WS 升级期协商已接线（移动 WS link-crypto 在 `../wasmnest/wasmnest-mobile/src/plugin/host_domains/ws.rs:210-239`，注意其环回跳过逻辑需按 §4.5 改判据）；旧宿主不支持时 `required` 不可选，界面必须显性说明，不能把 WS 明文说成已加密。
- 宿主启动必须完成 link-crypto 身份初始化（桌面 `init_link_crypto_at_startup`；移动 `set_link_crypto_context`）；身份缺失时 `required` 拒绝并提示修复，不降级。

---

## 5. 契约与跨仓改动

### 5.1 WIT / 权限

| 变更 | 仓 | 说明 |
| --- | --- | --- |
| `peer-node-config` 增加 `relay-addrs: option<list<string>>`、`enable-relay: bool` | 能力仓 | 也可不改 WIT，由宿主设置驱动；推荐显式传入，便于 per-app 策略 |
| 新 interface `host-tunnel`（expose/unexpose/connect/close/issue-pairing-ticket/status） | 能力仓 | **已裁定**落新 `wasmnest:tunnel` 包（独立版本轴）；需 compose v2 + 版本 bump（基线漂移见附录 C） |
| 新流协议 `/wasmnest/tunnel/1` | 能力仓 | 追加，不改旧协议名 |
| 新权限 `tunnel:serve` / `tunnel:connect` | 平台仓 | 权限词汇真源 `permission.rs`；manifest 校验同步 |
| `HttpCaller::Peer` + 对等面 listener | 能力仓/平台仓 | 线协议 `caller:"peer"`；插件侧按字符串分派，新增档位需文档化；**双端链加密豁免/跳过判据同步改面标记**（§4.5/不变量 15） |
| `dial-peer-addrs`（或 endpoint 扩展） | 能力仓 | file-transfer 多地址拨号 |

**版本纪律**：任何 WIT 变更 → `compose-wit.mjs` 重拼 + `witSha256` 更新 + SDK/宿主 runtime lock 同步；应用按当前 SDK 全量重建（旧产物在实例化期显性失败）。跨仓用 tag 钉住（`lib-v*` / `apps-v*`），不把本地路径提交回仓库。

### 5.2 各仓改动清单

**能力仓（wasmnest-lib）**

- `wasmnest-p2p-engine`：relay client、reservation、多地址 dial、transport 状态；feature 默认关闭，宿主显式开启。
- `wasmnest-server-peer-net`：`host-tunnel` 绑定、tunnel 流、ACL、配额；与 `net.peer-node` 服务共享全局 `PeerCtx`。
- 新 `wasmnest-relay`：relay v2 server + 配额 + 指标 + 可选配对 rendezvous + Docker。
- `wasmnest-server-http/core`：`HttpCaller::Peer`、对等面 listener、路由表复用、WS 升级。
- 测试：relay 环回/跨网、ACL、票据一次性、peer face 拒绝 bridge 路由、**双端环回豁免判据（peer face / 本地代理流量不豁免，不变量 15）**、**配对态路径白名单（§4.1）**、Android 构建树无 aws-lc。

**平台仓（wasmnest）**

- 桌面/移动宿主装配 `net.tunnel` 服务、peer face、权限位、SDK 绑定、compose.json、release-manifest。
- 桌面测试：`hostAppBoundaryLock` 不受影响；新增隧道/对等面测试。
- 移动：前台服务协作、loopback 代理、`ws://` 规则不变。

**应用仓（wasmnest-apps）**

- bedcode desktop：远程访问开关、暴露 peer face（`kind=http` 逻辑端口 8765）、QR v2、状态 UI、配对后 peer 信任、撤销级联；**link-crypto 固定 `required`**，设置页改为只读「强制加密」，移除 off/preferred 选择；三条免凭证路由按 §0.4 裁定保持已匹配可达（测试锁锁定）。
- bedcode mobile：`PrimaryTarget.peer`、tunnel.connect（含 pairing-ticket）、重连、`peer-offline` 错误、状态 UI；初始化 link-crypto context；**本地代理流量不触发环回跳过**（§4.5）；能力不足时显性失败，不降级。
- auth-center：QR v2 载荷、配对票据透传、配对成功事件；配对记录保存 peerNodeId。
- file-transfer：远程设备连接串/QR、`dial-peer-addrs`、中继状态/限额、设置项；**应用层加密固定 `true`**，移除关闭项，WAN/LAN 都强制。
- relay 配套：`wasmnest-relay` 二进制/Docker/Compose/`install.sh`、`init`/`doctor`/`print-addrs`/`token`；桌面「中转服务器」卡片生成部署文本与导入地址。
- i18n / E2E 锚点 / 验证模板同步更新（双端 E2E 需新增跨网场景或至少模拟 relay 的集成用例；加密用例覆盖协商失败、无明文回退）。

---

## 6. 安全与隐私

### 6.1 威胁模型

| 威胁 | 缓解 |
| --- | --- |
| 恶意 relay 读取/篡改数据 | Noise 端到端加密；relay 只看到密文与元数据；relay PeerId 在 multiaddr 中钉住 |
| 未授权设备开隧道 | **仅已匹配设备**（应用配对 + 传输信任两层）+ 每端口 `allowedPeers` + 首次配对票据（一次性/TTL，只开配对端点）+ 应用层 JWT |
| 未匹配设备伪装成业务访问 | 传输层直接拒绝，不进入业务分派；只有配对窗口（trust-status/consent/`/api/auth/*`）例外 |
| 攻击者阻断 LAN 逼流量走 relay | **只有网络层「明确不在内网」证据才切 wan**；认证/信任/协议错误不触发切换；wan 仍要求匹配 |
| 同网段不可达被误判成「不在内网」 | 同网段 timeout / `ECONNREFUSED` / 服务未启动都算「不明确」，保持 lan，给手动「尝试外网」 |
| 明文外发 / 加密协商被降级 | WAN/LAN 强制 Noise；bedcode link-crypto `required`；file-transfer 应用层加密 WAN/LAN 都强制；失败即失败，无静默明文回退 |
| 旧客户端以「兼容」为由逼降级 | 显性 `encryption-unsupported` + 升级提示；WAN/LAN 均不允许明文；**不提供任何关闭开关** |
| 隧道流量借环回豁免绕过链加密 | 双端豁免/跳过判据改面标记（§4.5）；peer face / 本地代理流量不享受环回豁免（不变量 15） |
| 已匹配远端访问无 caller 门禁的免凭证路由 | §0.4 裁定：task-status / session-mode / terminal-bg 对已匹配远端可达（移动端依赖 session-mode）；隧道 ACL 强制匹配；run-* 桥接路由对 peer 一律 403 |
| 配对 token/票据被 relay 读取 | QR 走带外；relay 不接触 token/票据明文；6 位码远程 rendezvous 必须 PAKE |
| 远端经环回伪装本机 | **peer face，caller=`peer`**；禁止裸转发 8765；bridge 路由拒绝 `peer` |
| 端口暴露面过大 | 默认不暴露；`tunnel:serve` 权限；host 管理端口黑名单；显式用户开关 |
| 配对码暴力枚举 | QR 128-bit；6 位码仅 LAN；远程 rendezvous 限速 + PAKE（若要做） |
| relay 被滥用 | reservation 配额、circuit 字节/时长上限、每 IP/peer 连接上限、可选 allowlist/注册制 |
| 撤销不彻底 | 解配对 → 同时 revoke peer trust；隧道 ACL 立即生效 |
| 后台被静默拉起 | 移动端只在用户可见场景建立隧道；不做静默常驻 |

### 6.2 不变量（实现时必须机器判/测试锁）

1. 客户端代理 listener **只绑 127.0.0.1**，永不 `0.0.0.0`。
2. `kind=tcp` 的服务端 tunnel **只连 127.0.0.1**，且拒绝宿主管理端口（8765、peer 端口、peer face、relay 控制）；`kind=http` 只连对等 HTTP/WS 面，永不连 8765。
3. `caller=peer` 永不被当作 `localhost`；bridge 路由对 `peer` 返回 403。
4. 配对票据一次性、TTL ≤ 120s、绑定目标端口（LAN 与 relay 均可使用，不绑定单一接入路径），使用后立即失效。
5. relay 不记录 payload / 文件名 / 路径；指标只含计数与字节数。
6. 无 relay 时不静默降级为「公网明文直连」；失败必须可见。
7. 应用撤销设备时，peer 信任同步撤销。
8. **未匹配 peer 不能打开任何业务 tunnel/流**；只有配对窗口可放行，且窗口只放行配对端点。
9. **只有 §4.9 的明确判据能触发 lan→wan**；认证/信任/协议错误、同网段 timeout/`ECONNREFUSED` 都不触发自动切换。
10. **wan 不降低匹配/JWT 要求**；relay 不是授权点，relay allowlist 不能替代目标宿主的匹配校验。
11. **WAN 数据面必须经过 Noise**；没有任何明文 WAN 路径；relay 不得终止/解密 Noise。
12. bedcode 的 link-crypto 固定 `required`；file-transfer 的应用层加密固定开启（WAN/LAN 都强制）；**不提供关闭开关**；缺能力/协商失败即失败。
13. relay 不接触 token/票据明文；6 位码若走 relay 必须 PAKE；QR token 只走带外。
14. 加密策略只能按应用设置，宿主不得提供「全局关闭加密」后门；`required` 时缺少链路身份必须拒绝。
15. **双端链加密豁免/跳过判据必须是面标记，不得按源 IP / 目标环回**：peer face 入站与移动本地代理出站流量不享受环回豁免；`required` 下未协商即拒绝（桌面 `link_crypto.rs` 豁免与移动 `ws.rs` 环回跳过各一条测试锁）。
16. **无 caller 门禁的免凭证路由经 peer face 仅对已匹配 peer 可达**（§0.4）：匹配校验在隧道层强制执行并有测试锁；run-* 桥接路由对 `peer` 一律 403（与不变量 3 同锁）。

### 6.3 隐私

- relay 可见：node_id、IP、连接时间、流量大小/时长；不可见：文件内容、终端内容、HTTP 路径/头（Noise 内层）。
- 默认不做全局设备发现；远程地址只通过 QR/连接串/已配对记录获得。
- 自建 relay 是一等公民；官方 relay 只作为可选项，且应公布留存策略（建议零 payload 日志、短周期指标聚合）。
- 不在 QR/连接串里放长期密钥；票据短命且一次性。

---

## 7. 失败语义与可观测性

### 7.1 错误分类（fail-visible）

| 错误 | 触发 | 用户可见文案方向 |
| --- | --- | --- |
| `relay-unconfigured` | 未配置 relay 且无 LAN 地址 | 「未配置中继，无法从外网连接」 |
| `relay-unreachable` | relay 连接失败/超时 | 「中继不可达，请检查网络或 relay 地址」 |
| `relay-denied` | reservation 被拒/配额满 | 「中继拒绝预留（配额/白名单）」 |
| `peer-offline` | 对端无可用地址/拨号失败 | 「桌面端不在线」 |
| `tunnel-closed` | 本地代理 handle 已关闭（如离开终端页）后仍有拨号/重连 | 显性报错，不对已关闭的 127.0.0.1 端口静默重试（§4.8） |
| `port-not-exposed` | 端口未 expose 或 ACL 拒绝 | 「对端未开放该端口」 |
| `ticket-expired` | 配对票据过期/已用 | 「配对已过期，请重新生成二维码」 |
| `not-matched` | 应用配对或传输信任任一不成立，且无有效票据 | 「设备未匹配，请先配对」 |
| `lan-unreachable` | 同网段 LAN 不可达/服务未启动，判据不明确 | 「内网不可达，请检查设备/服务」+「尝试外网」入口 |
| `wan-disabled` | `allowWan=false` 或未配置 relay | 「外网访问已关闭」 |
| `encryption-required` | 策略 `required` 但协商失败/对端不支持/链路身份缺失 | 「需要加密连接，请升级对端或检查链路身份」 |
| `encryption-unsupported` | 旧客户端不具备 link-crypto/应用层加密能力 | 「对端不支持加密，请升级后重试」 |
| `tunnel-limit` | 并发/字节配额 | 「中继通道繁忙，请稍后重试」 |

### 7.2 事件与指标

- 事件：`peer:transport`（`lan-direct` / `wan-relay` / `relay-reserved` / `relay-lost`）、`peer:mode`（`lan-probing` / `lan-active` / `wan-connecting` / `wan-active` / `lan-unreachable` / `wan-unavailable`）、`peer:encryption`（`noise-active` / `link-crypto-active` / `encryption-failed`）、`tunnel:state`（`exposed` / `connected` / `closed`）、`tunnel:error`。
- 应用状态栏：`内网直连` / `外网中继` / `内网不可达` / `外网已关闭` / `离线` + `已加密` 标记；bedcode 设备页显示「互联网可达」、relay 延迟与加密状态。
- relay 指标：reservation 数、活跃 circuit 数、字节数、拒绝原因分布；不做 per-user 追踪。
- 日志：peer id 短指纹 + 事件 + 字节数；不打印票据、token、路径。

---

## 8. 落地阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0 可行性** | 独立 relay（relay v2）+ p2p-engine relay client + 两个节点的 echo/传输测试；Android 构建验证 relay 依赖无 rustls/aws-lc | 两台不同 NAT 后的机器经 relay 建立连接；file-transfer 帧协议在 relay 上跑通；`cargo test` + Android 构建绿 |
| **P1 宿主能力 + bedcode** | `host-tunnel` WIT/权限/绑定；peer face + `HttpCaller::Peer` + **双端豁免判据改面标记**；bedcode 桌面 expose、QR v2；移动本地代理 + 远程终端；§4.9 模式状态机；**link-crypto 固定 `required`（不可关闭）** | 双端 E2E：移动经 relay 打开桌面终端、JWT 登录、WS 重连；`run-attach` 对远端返回 403；**task-status/session-mode/terminal-bg 仅已匹配可达（§0.4 测试锁）**；票据一次性/过期测试（LAN 与 relay 两路径）；未匹配设备只能进配对窗口且路径白名单生效；Wi-Fi 先 LAN、蜂窝直切 WAN、同网段不可达不自动切；**加密协商失败可见且无明文回退；peer face / 本地代理流量不享受环回豁免（不变量 15 测试锁）** |
| **P2 file-transfer + 运维** | `dial-peer-addrs`、多地址重拨、远程设备连接串/QR、中继状态与限额；**`wasmnest-relay` 一键包（Linux 二进制/Docker/Compose/`init`/`doctor`/`print-addrs`/`token`）+ 桌面「中转服务器」卡片**；relay 配额/指标/自建文档；6 位码远程配对评估 | 跨 NAT 发送/接收 1GB 文件（可跨多个 circuit，断点续传重建为预期行为，§4.9），暂停/恢复/取消/断点续传；**LAN 默认，明确不在内网才 WAN**；未匹配拒绝；relay 限额生效；撤销设备后隧道立即失效；**全新 Linux VPS 一键起 relay → 应用导入 → 跨 NAT 可用；重启后 PeerId 不变；relay 侧抓包只有密文；file-transfer 应用层加密固定开启** |
| **P3 直连优化** | QUIC/DCUtR 或 TCP 打洞评估；identify 与准入语义；UPnP 可选；性能基准 | 直连成功率/吞吐对比 relay；失败自动回退；Android 构建仍无 aws-lc |

**P1 实施顺序（依赖先行，避免契约半落地）**：

1. 能力仓：`wasmnest-p2p-engine` relay feature + reservation + 多地址 dial + transport 事件（先不改 WIT，用测试夹具验证）。
2. 能力仓：`wasmnest-server-http/core` 的 `HttpCaller::Peer` + 对等面 listener（先写安全测试：bridge 路由对 `peer` 403）。
3. 能力仓：`wasmnest-server-peer-net` 的 `host-tunnel` WIT + `/wasmnest/tunnel/1` + ACL + 票据（含 native/集成测试）。
4. 平台仓：compose.json / 权限词汇 / SDK / 双端宿主装配 / release-manifest；跑平台桌面与移动全量测试。
5. 应用仓：bedcode desktop（expose、QR v2、link-crypto `required`、状态、撤销级联）→ auth-center（QR v2）→ bedcode mobile（tunnel.connect、重连、加密能力检查）→ 双端 E2E。
6. 最后才动 file-transfer 的多地址拨号与固定加密（P2），避免同时改两个应用的调用面；relay 一键包与桌面卡片同阶段交付。

**验证底线**：跨网测试必须真机/真网络（例如手机蜂窝 ↔ 家庭宽带），不能只用 loopback/同机双进程代替；安全用例（peer face 拒绝 bridge、票据一次性、ACL）必须有自动化测试。

---

## 9. 风险与未决问题

### 9.1 风险

1. **relay 带宽成本**：file-transfer 大文件经中继会消耗大量流量；需要配额、用户提示、自建优先。若成本不可接受，可把大文件限制为 LAN-only（小文件可中继），但不能改变「内网默认、明确不在内网才切外网」的判定。
2. **relay v2 吞吐**：单 circuit 的吞吐/延迟需实测；终端场景足够，大文件可能成为瓶颈。
3. **网络类型误判**：手机热点/VPN/双网卡下，「是否同网段」可能判断错；以「同网段不自动切、只给手动入口」兜底，并记录判定原因供排查。
4. **Android QUIC 依赖**：P3 前必须解决 aws-lc-rs；否则只能 relay/TCP 打洞。
5. **全局 peer 节点**：per-app 实例表（#5）未落地，所有应用共享一个身份/端口；ACL 与端口规则必须按 app 隔离，不能靠「每个 app 自己的节点」。
6. **对等面平台改动**：`HttpCaller::Peer` + 第二 listener 涉及网关核心；需要平台仓评审与回归。**双端环回豁免判据必须同步改面标记**（桌面 `link_crypto.rs:968-981` 按源 IP、移动 `ws.rs:210-239` 按环回目标跳过）——不改则隧道流量被静默豁免，「永久强制加密」失效（不变量 15）。
7. **契约面扩散**：WIT/权限/SDK/宿主/三仓版本同步，任何一处漏改都会导致旧产物实例化失败；必须按 tag 全量重建。
8. **移动后台**：接收方在后台被杀会导致传输中断；产品需明确「前台接收」还是「前台服务常驻」。
9. **强制加密破坏旧客户端**：bedcode link-crypto `required` 会让不支持链加密的旧移动端直接失败；这是有意的 fail-visible，但需要升级提示与灰度方案。
10. **file-transfer 应用层加密固定开**：X25519 + AES-GCM 对吞吐有影响（需实测）；旧对端不支持时直接失败，只能升级，不再有「LAN 明文」逃生口。
11. **relay 一键包维护成本**：二进制/Docker/Compose/systemd 多形态要跟 libp2p 版本同步；已裁定只覆盖 Linux（amd64/arm64）+ Docker，不做 Windows/macOS。
12. **存量 LAN 暴露（独立票据，待开）**：task-status / session-mode / terminal-bg 三条 `auth:none` 路由今天绑 `0.0.0.0:8765` 且无 caller 检查，LAN 内任意设备可调——先于本方案存在，不属穿透引入；§0.4 裁定只覆盖经隧道的已匹配远端。需独立 issue 评估是否收紧 LAN 面（`gh` 当前未认证，票据待开）。

### 9.2 需要用户裁定

> **已裁定（2026-11-07）**：加密永久强制、不可关闭；一键 relay 仅 Linux；relay 默认 open + 配额（目标端匹配是授权权威）。

1. **官方公共 relay**：自建一键包已覆盖；是否还要提供官方公共 relay？若提供，谁承担带宽与合规？
2. **匹配粒度与作用域**：按「设备」还是「用户账号」？匹配是全局（一次配对所有应用可用）还是 per-app（bedcode 配对不自动获得 file-transfer 信任）？当前宿主 peer 信任是全局的，若要求隔离需给信任条目加 app scope。
3. **同网段不可达的处理**：默认「不自动切、只给手动『尝试外网』入口」是否符合预期？还是允许在 N 次失败后自动切？
4. **大文件中继**：LAN-only 阈值/提示策略（例如 >1GB 默认不中继）需要产品给定。
5. **6 位码远程配对**：是否必须支持？若必须，接受 PAKE 的额外工期，还是限定 QR/连接串？
6. **bedcode 桌面是否也要作为客户端**访问另一台桌面（desktop↔desktop），还是只做「桌面服务端 + 移动客户端」？
7. **移动端后台接收**：file-transfer 是否要求应用退到后台仍可接收？这决定是否要前台服务常驻。
8. **WIT 归属**：**已裁定（2026-11-07）**：新开 `wasmnest:tunnel` 包独立演进（不与 `wasmnest:peer` 共用版本轴）；T05 的 `host-tunnel` interface 落在该包。

---

## 附录 A：最小 PoC 清单（P0）

1. 起一个 libp2p relay v2 节点（Rust 小二进制或 stock relay），固定 PeerId。
2. 在 `wasmnest-p2p-engine` 加 `relay` feature：`libp2p-relay` client + `listen_on(relay_addr/p2p-circuit)`；只做 reservation，不改 WIT。
3. 写两个 example/test：A 在 relay 上预留，B 经 relay multiaddr 拨 A；开 `/wasmnest/session/1` 流 echo 1MB。
4. 在引擎层把 relay multiaddr 传给 `RunningNode::dial`，跑一次真实 `send_files` 的线协议（当前 `DialEndpoint` 只解析 `{addr,port}`，多地址扩展见 §4.6；PoC 不改 app，只在测试夹具里直连引擎）。
5. 在 Android 目标上 `cargo check`，确认依赖树无 rustls/aws-lc/openssl-sys。
6. 记录：reservation 建立耗时、relay RTT、1MB/100MB 吞吐、断线重连行为。

## 附录 B：证据索引

| 事实 | 路径 |
| --- | --- |
| bedcode 桌面服务端 / 移动控制端 | `apps/bedcode/README.md` |
| 移动目标地址模型 | `apps/bedcode/mobile/rust/src/lib.rs:198-215` |
| 移动 HTTP / WS URL 拼接 | `apps/bedcode/mobile/rust/src/session.rs:102`、`link.rs:162` |
| QR 载荷 `{host,port,token}` | `apps/bedcode/mobile/src/host/qr.ts:13-17,38-60` |
| 桌面 HTTP/WS 监听 0.0.0.0:8765 | `../wasmnest-lib/wasmnest-server-base/src/constants.rs:362,407` |
| caller 分类（T03 后：面标记优先，新增 `Peer` 档） | `../wasmnest-lib/wasmnest-server-http/src/controllers/plugin_controller.rs::caller_identity` / `HttpCaller::classify` |
| bedcode 桥接路由仅接受 localhost | `apps/bedcode/desktop/rust/src/run/bridge/mod.rs:44-54` |
| 三条免凭证路由无 caller 门禁（§0.4 裁定对象） | `apps/bedcode/desktop/rust/src/http_routes.rs:115,121,316`、`task/mod.rs:1116-1122`（分派签名不含 caller） |
| 移动端依赖 session-mode（§0.4 裁定依据） | `apps/bedcode/mobile/src/task/api.ts:160` |
| p2p 引擎 feature / 无 QUIC | `../wasmnest-lib/wasmnest-p2p-engine/Cargo.toml:25-38` |
| P2 路线图（QUIC/relay/打洞）与 identify 纪律 | `../wasmnest-lib/wasmnest-p2p-engine/src/lib.rs:42-43`、`Cargo.toml:35-37` |
| host-peer WIT（dial / 传输 / 节点） | `../wasmnest-lib/wasmnest-server-peer-net/wit/peer.wit` |
| 全局 PeerCtx / per-app 未落地 | `../wasmnest-lib/wasmnest-server-peer-net/src/plugin_binding.rs:556-561` |
| 具名流协议 | `../wasmnest-lib/wasmnest-p2p-engine/src/stream_proto.rs` |
| file-transfer host-peer 调用 | `apps/file-transfer/rust/plugin/src/lib.rs:71-73`、`peer.rs` |
| host-http 允许 loopback 直连 | `../wasmnest-lib/wasmnest-server-http/src/plugin_binding/egress.rs:75-81` |
| link_crypto 环回豁免（T04 已改面标记） | `../wasmnest-lib/wasmnest-server-core/src/link_crypto.rs::is_exempt` |
| link-crypto 配置（布尔组合，默认 `enabled=false`） | `../wasmnest-lib/wasmnest-server-core/src/link_crypto.rs::LinkCryptoConfig` |
| bedcode link-crypto 默认 off | `apps/bedcode/desktop/src/composables/useLinkCrypto.ts` |
| file-transfer 应用层加密默认 false | `apps/file-transfer/rust/core/src/settings.rs:35,51` |
| 移动宿主 link-crypto 支持（HTTP） | `../wasmnest/wasmnest-mobile/src-tauri/src/commands/http_proxy.rs:342-487`、`state.rs:151` |
| 移动 WS 域（5 条原语薄转发，**无**环回跳过） | `../wasmnest/wasmnest-mobile/src-tauri/src/plugin/host_domains/ws.rs`；HTTP 加密判据在同端 `src-tauri/src/commands/http_proxy.rs::should_encrypt` |
| file-transfer 声明默认端口 47613 | `apps/file-transfer/rust/plugin/src/lib.rs:129`（生产租约装配用宿主全局端口，见 CHANGELOG） |
| `net.peer-node` 服务租约 | `../wasmnest-lib/wasmnest-server-peer-net/src/service.rs` |
| `backgroundTransport` 运行期租约 | `../wasmnest/wasmnest-desktop/src-tauri/src/plugin/services.rs:9-20` |

## 附录 C：实施核查（2026-11-08）证据漂移与口径修正

> 本文写于 2026-11-07 评审修订；以下证据按 2026-11-08 能力仓 `feat/nat-traversal` 与平台仓 `feat/file-transfer-refactor` 工作树逐条核实。裁定（§0.4、不变量 15、永久强制加密）**不变**，但落地形态按代码真源修正；附录 B 的指针已同步更新。

| 设计表述 | 核查结果 | 后续 ticket 口径 |
| --- | --- | --- |
| `link_crypto.rs:968-981` 按源 IP 环回豁免 | 判据在 `wasmnest-server-core/src/link_crypto.rs::is_exempt`（约 757-766 行），输入是 `FilterContext.peer`，由 `wasmnest-server-http/src/middleware/http_filter.rs` 从 `req.peer_addr()` 注入；968-981 是注册 / 启动装配 | T04 已按面标记改判据并补桌面侧测试锁 |
| 链加密策略是 `off/preferred/required` 三态枚举 | 实际为 `LinkCryptoConfig { enabled, encrypt_http, encrypt_ws_terminal, encrypt_ws_event, allow_plaintext_fallback }` 布尔组合；`required` = `enabled=true && allow_plaintext_fallback=false` | T07 固定 `required` 按布尔组合落，配置层拒绝关闭 |
| 移动 `ws.rs:210-239` 对环回目标跳过链加密 | 实际路径多 `src-tauri/`；该段是 5 条 WS 原语薄转发，全文无 crypto / 环回；`http_proxy.rs::should_encrypt` 只看开关 / pin / 路径；`TrafficChannel::WsPlugin` 帧恒不进链路加密 | 移动侧**没有可改的既有跳过判据**；T09 实现本地代理时不得引入按目标环回的跳过，并补该侧测试锁（T04 验收条件已改写） |
| `plugin_controller.rs:118-134` 的 loopback → localhost 分类 | 分类函数仍在该文件，但 T03 已新增第四档 `Peer` 并按 `RequestFace` 面标记优先判定，线协议 `caller:"peer"` | T05 / T07 按新线协议分派；§0.4 三条路由的可达性见下 |
| `wasmnest:tunnel` 独立包可按现有 compose 拼装 | nat 基线（`feat/file-transfer-refactor`）仍是单包 `wasmnest:plugin@0.0.2` + 平台 compose v1；各仓 `dev` 已是多包（`wasmnest:peer@0.0.1` / `wasmnest:plugin@0.1.0`）+ compose v2 | T05 分片先落能力仓真源；T06 前完成基线对齐 / compose 升级，否则契约不进端生成物 |
| tunnel 流按业务流 `require_admitted` 注册即可 | `start_with_protocols` 对所有非 `TRUST_STATUS` 协议强制 `Admitted`，未匹配 peer 的配对票据根本送不到服务端 | T06 接线须显式 `require_admitted=false`，匹配校验由 `TunnelPolicy` 逐条裁决（不变量 8/16） |
| 配对连接注册表「accept 时消费」 | T03 的 `PeerFaceResolver` 在 `app.rs` 每请求调用（`wrap_fn` 按 `req.peer_addr()` 解析），按请求消费会让 keep-alive 后续请求丢 face | 注册表默认非消费 `resolve`；`consume` / `clear` 由宿主按连接生命周期（配对成功 / 票据失效 / 连接关闭）调用 |

**T05 实施口径增补（2026-11-08）**：设计 §7.1 错误词表不是封闭集，通道层新增 `invalid-frame`（畸形首帧 / 响应）、`proxy-bind-failed`（回环代理绑定 / 接受失败）、`tunnel-idle`（短连接 HTTP 流空闲回收）；三者只回原因类别，不回显票据或请求内容。能力仓侧已落 40 条测试锁覆盖不变量 1/2/3/4/8/16 与 WS 保活 / 字节配额，服务端首帧裁决、客户端响应校验、pipe 限额均已落地；但 WIT provider 绑定、流接收器接线、引擎拨号与平台 compose 尚未落地，验收项不得提前勾选。face 登记安排在「首个请求字节写入后端之前」，与 §4.1「dial 对等面前登记」安全语义等价（本端连接四元组需 dial 后可得）。

**跨任务冲突（2026-11-08 已消解）**：原记录的风险是 T17 在途代码把 `task-status` 收紧为只认 `localhost`、`session-mode` 认 `localhost` + `device`，会拒绝 `caller=peer` 的已匹配隧道流量。核查当前代码（`apps/bedcode/desktop/rust/src/task/mod.rs::caller_allowed_for_none_auth` 及其测试锁）两条端点均显式放行 `CALLER_PEER`，T17 实施记录与 spec §5 进度一致，§0.4 裁定不再被门禁破坏。剩余联动在 T10 E2E 用真机跨网用例复核「已匹配 peer 可达 + run-\* 仍 403」，无需再裁定 §0.4。
