# [feat] T11 · `dial-peer-addrs`：多地址拨号契约与数据面地址记忆

- **落仓**：`7ZAI/wasmnest-lib`（WIT 真源仓；契约类）
- **标签**：`kind:contract`
- **阶段**：P2 ｜ **依赖**：T02 ｜ **状态**：实现已提交（能力仓 `8e21f9a` / 平台仓 `816e828b` / 应用仓 `f0c0ff2a`；文档 `c05cf69c`/`baee1bdd`）；GitHub issue 待提交（gh 未认证）
- **设计依据**：§4.6（方案 B）、§5.1

## 需求描述

让 file-transfer 的 peer 拨号接受多地址（LAN 直连 + relay multiaddr），数据面记住全部候选地址。采用**方案 B**：保留旧 `dial-peer` 不动，新增 `dial-peer-addrs(endpoint-json)`，避免破坏性变更与旧产物全量重建。

## 落点 app 与端

机制：`wasmnest-server-peer-net`（WIT + 绑定）+ `wasmnest-p2p-engine`（多地址 dial 已在 T02）；双端共用。

## 验收条件

- [x] 新 WIT 函数 `dial-peer-addrs(endpoint-json)`：`{nodeId, addrs:[multiaddr...]}`；旧 `dial-peer` 路径不回归。
- [x] 会话句柄记忆**全部**候选地址（现只记一个 endpoint）；断线重拨按调用方策略顺序重试。
- [x] 数据面 `send/browse/pull` 自动重拨复用同一策略；**不再要求对端在 mDNS 发现缓存里**。
- [x] 拨号策略语义留给应用层（T12）：先 LAN 短超时（2-3s），只有 §4.9 判定明确不在内网才试 relay；本层不擅自自动切换。
- [x] 契约测试 + native 测试 + 双端 app 构建绿（WIT 变更全量重建纪律）——桌面 file-transfer 全量构建绿；移动共享 wasm + 组件化绿（`--frontend-only` 受 app 内 SDK JS `dist` 缺失阻塞，属环境缺口，非本票引入）。

## 相关契约与锁

- WIT 变更：compose 重拼 + `witSha256` + SDK/lock 同步 + tag 钉住。
- `PeerLink` 记录 `transport: lan|wan`（wan 下含 relay 地址）供 UI/指标（T12 消费）。
- 寻址由调用方显式传入；宿主 trust store 不存 relay 地址（保持「谁可信」单一语义，§4.3）。

## 实施记录（2026-11-08）

**契约（能力仓 `8e21f9a`）**

- `wasmnest-server-peer-net/wit/peer.wit` 新增 `dial-peer-addrs(endpoint-json)`（方案 B），旧 `dial-peer` 函数与 `DialEndpoint` 形状**零改动**。`DialAddrsEndpoint` = `{ nodeId, addrs: [multiaddr...] }`；空列表 / 任一条非法 multiaddr 在触引擎前显性报错并点名（`parse_peer_addrs`，不静默丢候选）。
- 候选顺序 = 调用方顺序：引擎 `RunningNode::dial_addrs`（T02）逐候选结算、首成功即用；peer-net 层固定 `DIAL_PER_ADDR_TIMEOUT = 3s/候选`，**不排序、不自动切 relay**——§4.9 的「何时把 relay 放进候选表」仍归应用层（T12）。
- `PeerNetNode::dial_addrs_with` + `base::transport::dial_addrs` 复用既有信任握手 / 具名流开流；成功后 `Connection` 新增 `transport`（`lan-direct` / `wan-relay`，来自引擎 `DialOutcome`）。`p2p-engine::engine::multiaddr_to_socket_addr` 提升为公开（relay 命中地址无对端监听地址，`Connection.peer_addr` 取中继端点并留痕，不伪装成对端地址）。

**句柄与数据面**

- `plugin_binding::SessionEntry` 由 `{node_id, addr, port}` 改为 `{node_id, addrs: Vec<String>, owner}`：多地址拨号记忆**全部**候选；旧单地址路径把 endpoint 规范成一条候选，句柄形状统一。
- 删除 `with_auto_redial`（旧实现靠「发现缓存缺失」错误触发、以单 endpoint 重拨）：数据面 `send-files` / `list-shared-roots` / `browse-directory` / `pull-files` 现在由 `session_target` 解析句柄 → `(node_id, addrs)`，每次操作按同一候选表重新拨号，**不查 mDNS 发现缓存**；属主与候选表校验仍先于载荷解析。
- 发送会话 `SendSessionHandle` 记忆候选表：`resume` 的会话已死分支按同一顺序重拨，不再依赖缓存（无候选时显性 failed，不猜地址）。
- 拨号结果与事件供 T12：`DialPeerResultDto` 增 `transport`（denied/unreachable 省略）；`peer-connected` 载荷在已知时带 `transport`。`PeerLink.transport` 由 T02 已记录，本票补上 WIT 调用方可见通路。

**跨仓同步（平台仓 `816e828b`）**

- `compose-wit --all` 重拼双端生成物（`wit/deps/peer/peer.wit` 含新函数）；`--check` 绿。
- 双端 SDK `HostPeer` trait + `WasmHost` 增 `peer_dial_addrs`（`{nodeId, addrs}` JSON）；双端 `cargo check --features wasm --target wasm32-wasip2` 绿。
- `release-manifest.json` 的 `contract.witSha256` 更新为 `fda83423…599ff`（37 文件）；`check-release-manifest` 仅剩 3 项环境失败（工作树无精确 tag / manifest 多写 `com.wasmnest.lanbitou`）。

**验证实跑**

- 能力仓提交面（干净检出 `8e21f9a`）：peer-net `cargo test --lib` **247 passed**；`--features common-host` **248**；`--features common-host,relay` **248**；`cargo fmt --check` 绿。p2p-engine `cargo test --lib` **42**、`--features relay` **45 + 1 ignored**、`fmt --check` 绿。
- 新增锁：候选表顺序/空表/非法项点名（3）、`peer-connected` 事件 transport 携带/未知省略（2）、句柄多候选顺序记忆（1）、双节点「首候选不可达 → 次候选连通 + `lan-direct`」真实拨号（1）、绑定层权限/JSON/空表/非法候选/顺序保留（5）、resume 句柄候选表断言。
- 双端 app：file-transfer 桌面 `pnpm run build` 全量绿（wasmHash `2518753d…d79f`）；移动共享 rust + 组件化 + 复制进资源目录绿（同一 wasm 产物）。移动 `--frontend-only` 因 app 内 `@binblink/wasmnest-plugin-sdk-mobile/dist` 未构建而失败（`vite-plugin.js` 缺失，环境缺口）；WIT/ABI 判据以共享 wasm 构建为准，桌面 full build 已覆盖前端链。
- 测试替身同步（应用仓 `f0c0ff2a`）：双端 SDK `HostPeer` 新增方法后，file-transfer 4 处与 auth-center 2 处 native mock 补 `peer_dial_addrs` 占位；file-transfer `cargo test` **93 passed**（native）。bedcode 两处 mock 由并行 T06 会话同步。auth-center 的 native 测试**本就编译不过**（mock 的 `peer_start_node` 仍是无参旧签名、缺 `peer_collect_outgoing`，与 T11 无关），本票只补新方法，不代修旧漂移。
- 双端宿主装配：平台桌面 `cargo check --lib` 与移动 `cargo check --lib` 均绿（移动 1 条既有 warning）——证明 compose 重拼后的 WIT 与宿主装配一致。
- 组件导入面：`dial-peer-addrs` 未被 file-transfer 调用，组件化后按 Component Model import 子集被裁剪（旧产物可继续实例化）；T12 接入后自动进入 import 面，须按当时 SDK 重建。

**未做 / 风险**

- 真实 relay 跨 NAT 的多地址拨号验收归 T15（本票只锁顺序/回退/记忆/错误可见；relay 候选与 LAN 同为 3s 窗口，若实测 relay 握手偏慢需在 T12/T15 评估专用窗口）。
- 跨仓 tag 未打（dev 工作树无精确 tag）：`release-manifest` 的 `repos.lib/apps.tag` 与 apps 产物仍指向旧线，发布装配时统一按 §3 打 tag / 重建。
- `dial-peer` 旧路径未新增专属用例，但代码路径逐字未改且全量既有用例（247/248）绿。
