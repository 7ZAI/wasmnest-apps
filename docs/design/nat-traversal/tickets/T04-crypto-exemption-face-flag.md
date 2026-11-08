# [feat] T04 · 双端链加密豁免/跳过判据改面标记（不变量 15）

- **落仓**：`7ZAI/wasmnest-lib`（主体）；平台仓移动 `ws.rs` 联动子任务在正文点名
- **标签**：`kind:bug`、`cross-repo`（安全判据修复：不改则「永久强制加密」被静默击穿）
- **阶段**：P1 ｜ **依赖**：T03（面标记注入机制）｜ **状态**：**能力仓（桌面侧）已落地**（2026-11-08）；移动侧按事实核查转为 T09 测试锁；待提交 GitHub（gh 未认证）
- **设计依据**：§4.5、§4.10、不变量 15、§9.1 风险 6

## 需求描述

穿透方案让全部隧道流量走 127.0.0.1（桌面 peer face 入站 / 移动本地代理出站）。现行豁免判据按环回 IP 判定，会把隧道流量静默豁免/跳过链加密，使 bedcode 固定 `required` 失效。两端判据必须改为**面标记**：peer face / 本地代理流量不享受环回豁免，`required` 下缺链路身份即拒绝。

## 落点 app 与端

机制，双端：

- 能力仓：`wasmnest-server-core/src/link_crypto.rs` 的 `is_exempt`（实际位置见「事实核查」）。
- 平台仓（联动）：移动侧本地代理接入后的加密判据（T09 接线时补锁）。

## 验收条件

- [x] 桌面豁免判据改为面标记（`FilterContext.face`）：`is_exempt` 先看 `ctx.face.is_peer()`，peer 面直接跳过 `parse_peer(ctx.peer)` 环回分支；HTTP 面由 `http_filter.rs` 从请求扩展注入，WS 面由 `ConnSpec.face` 注入。
- [x] peer face 入站流量在 `required`（`allow_plaintext_fallback=false`）下未协商即 `Verdict::Reject`，无明文放行。
- [x] **桌面侧测试锁（3 条）**：`link_crypto::tests::peer_face_loopback_is_never_exempt`（正反例 + required 拒绝）、`link_crypto::tests::peer_face_exempts_pairing_endpoint_only`（白名单与路径穿越边界）、`http_filter::tests::peer_face_marker_reaches_filter_context`（service 级：面标记真进 `FilterContext`）。
- [x] 真本机流量（普通面）既有环回豁免不回归：已有 `loopback_peer_always_exempt` / `loopback_peers_exempt_ipv4_and_ipv6` 全绿，新用例含同一地址的反例。
- [x] `/api/auth/` 白名单豁免保留（配对引导入口，Noise 内明文 HTTP 是有意设计），但判据同样按面标记；顺带拒绝借 `/api/auth/../` 或 `%2e%2e` 路径穿越骗取白名单。
- [ ] **移动侧测试锁**：当前移动宿主既无「环回目标跳过链加密」逻辑、也无本地代理实现（见事实核查），无法构造该流量；归 T09 实现本地代理后补锁，不能用「不适用」冒充完成。
- [x] 能力仓 `cargo test` 全绿（39 / 48 / 90 / 49 passed）；平台仓测试**未跑**（本次平台仓零代码改动，改动的验证在 T09 一并做）。

## 事实核查（2026-11-08，文档字面 ≠ 事实）

设计文档多处「现状证据」与能力仓 / 平台仓当前代码不符，逐条核实如下（引用以 2026-11-08 分支 `feat/nat-traversal` / `feat/file-transfer-refactor` 为准）：

| 设计文档表述 | 实际代码 | 对 T04 的影响 |
| --- | --- | --- |
| 桌面 `link_crypto.rs:968-981` 按源 IP 环回豁免 | 环回豁免在 `wasmnest-server-core/src/link_crypto.rs::is_exempt`（约 757-766 行），`ctx.peer` 由 `http_filter.rs` 从 `req.peer_addr()` 注入；968-981 是注册/启动装配 | 判据已按实际位置改面标记 |
| 链加密策略是 `off/preferred/required` 三态枚举 | 实际为 `LinkCryptoConfig { enabled, encrypt_http, encrypt_ws_terminal, encrypt_ws_event, allow_plaintext_fallback }` 布尔组合；`enabled=true && allow_plaintext_fallback=false` 才是 `required` 语义 | T07 固定 `required` 时按布尔组合落，不要找枚举 |
| 移动 `wasmnest-mobile/src/plugin/host_domains/ws.rs:210-239` 对环回目标跳过链加密 | 实际路径是 `wasmnest-mobile/src-tauri/src/plugin/host_domains/ws.rs`；该段是 5 条 WS 原语薄转发，全文零 `crypto`/`loopback`/环回；`src-tauri/src/commands/http_proxy.rs::should_encrypt` 只看开关/pin/路径，不看目标是否环回；WS 插件端点帧在 `link_crypto.rs` 里恒不加密（`TrafficChannel::WsPlugin => false`） | **移动侧没有可改的「环回跳过」判据**；T09 实现本地代理时须保证新代理不引入按目标环回的跳过，并补该侧测试锁 |

结论：裁定本身（不变量 15「判据必须是面标记」）仍成立，落地形态从「改两处既有分支」变为「桌面改判据 + 移动侧在新增代理时以面标记写入并加锁」。

## 实施记录（2026-11-08）

落点：`wasmnest-lib` 分支 `feat/nat-traversal`，**已提交 `d8b1532`（2026-11-08）**；下方 `FilterContext.face` 字段与注入链随 T03 的 `de87213` 一并提交（否则 T03 不可编译），T04 提交只含豁免判据。

**代码**

- `wasmnest-server-core/src/filter.rs`：`FilterContext` 新增 `pub face: RequestFace`（listener 注入的面标记）。
- `wasmnest-server-core/src/link_crypto.rs`：`is_exempt` 面标记优先；`is_plaintext_whitelisted` 拒路径穿越；新增夹具 `mk_peer_ctx` 与两条不变量 15 测试锁。
- `wasmnest-server-http/src/middleware/http_filter.rs`：从 `ServiceRequest.extensions` 读 `RequestFace` 并传入入站/出站 `FilterContext`；新增 service 级注入链路测试锁。
- `wasmnest-server-websocket/src/{conn.rs,routes.rs}`：`ConnSpec.face` → `WsConnBase.face` → 帧级 `FilterContext.face`，WS 面同样按面标记判定（当前 `WsPlugin` 通道恒不进链路加密，属既有语义）。
- 全仓 16 处 `FilterContext {` 构造点同步补字段；跨仓 grep 确认平台仓 / 应用仓 / 测试仓无其它构造点。

**验证**：与 T03 同一批命令（四个 crate `cargo test --offline` 全绿、`cargo fmt --check` 干净、`common-host` 两形态 `cargo check` 绿）。`link_crypto.rs` 顶层 `RequestFace` import 已置于 `#[cfg(test)]`，生产构建 0 warning。

## 相关契约与锁

- 不变量 12/14/15；§4.10 降级保护。
- 与 T09（移动本地代理接入）联调；T10 E2E 覆盖「加密协商失败可见且无明文回退」。
- 平台仓子任务提交时开平台仓 issue 并以 `7ZAI/wasmnest-lib#n` 交叉引用（落仓规则：主体在 lib）。
