# Nest 助手（servers/assistant）

系统级个人助手「Nest / 巢」：情感陪伴对话 + 应用调度执行，独立于 BedCode。
设计真源 = 平台仓 `.scratch/2026-11-11-personal-assistant/spec.md`（D1–D17 定稿），
票单 = `.scratch/2026-11-11-personal-assistant/issues/`。

## 结构（spec §5.1）

- `shared/` — TS 共享核（不单独发布）：双端同构的共享类型与共享 UI 组件（D3）。
- `rust/plugin/` — 共享 Rust crate（sharedRustManifest 模式，双端单产物，ADR 0050）。
- `desktop/` / `mobile/` — 双端工程：只写入口与宿主适配，构建产物随宿主分发。

## 变更记录

### 0.0.1（2026-11-12）— 票 08：对话主链路（OpenAI 兼容 + 流式会话页）

- **对话流**：`assistant.chat-stream` 命令——前端构建 OpenAI 兼容请求，Rust
  校验（method / url / `stream:true` / `streamEvent` 与 `streamId` **精确匹配**）
  后经 `host.http_fetch` raw 流式透传；宿主逐 chunk 经 `assistant:stream:<id>`
  事件通道推送，SSE 语义由前端解析（spec §3.2 / §5.2）。
- **pi 核心**：嵌入 `@earendil-works/pi-agent-core@1.5.0` + `pi-ai` 类型/schema
  （精确版本，pnpm-lock 钉住，禁 `^` 漂移）。`StreamFn` 不抛异常——网络 / 鉴权/
  流中断 / 用户中止全部编码为协议 `error` 事件（`stopReason: error|aborted` +
  `errorMessage`）；中止经 `agent.abort()`，宿主是否可断流不可知时丢弃后续
  chunk 并如实记录（spec 风险 #3）。
- **provider 适配**：`shared/providers/` 自实现 OpenAI 兼容方言（请求构建 +
  SSE→pi 事件映射），**不引用 ai-chatbox 源码**（跨应用源码耦合禁止）。
  M1 仅 OpenAI 兼容（含自定义 baseURL / 本地端点，D17）；Anthropic / Gemini
  随票 10 在 `buildProviderRequest` 分派点扩展。
- **供应商与密钥**：设置页可增删改供应商（name / base_url / model），密钥写入
  保险库密钥槽（`assistant_secrets` 表，AEAD 密文，`provider:<id>` 键名，
  spec §5.8）；**密钥不进 provider 表**。新增 `providers-delete` 命令。
- **会话与落库**：多会话列表 + 全屏会话页（共享 `ChatView`，双端同构）；
  用户消息先落库再流式，助手消息成功后落库（中止落已生成部分）；重开应用
  加载历史并重建 agent transcript。错误卡可手动重试（移除失败消息后
  `continue()`，不重放副作用）。
- **界面**：消息流（流式光标 / 思考折叠 / 错误卡重试 / 中止卡）、输入区
  （发送 / 停止）、供应商设置面板、保险库门（未解锁先走 VaultView）。
  i18n zh-CN / en，文案住应用不污染宿主。
- **人格骨架**：`shared/prompt/system.ts` 八条骨架（身份 / 关系边界 / 模式
  自适应 / 记忆纪律 / 工具纪律 / 安全 / 隐私 / 语言），完整化与危机协议
  随票 11。
- **依赖解析**：pi 包裸导入经双端 vite / vitest / tsconfig 显式别名钉到本端
  node_modules（shared/ 在 vite root 之外，无法沿目录树解析）。
- **wasm 构建修复**：`getrandom` 0.2 在 `wasm32-unknown-unknown` 需 js 特性
  （wasm-bindgen），会破坏移动端 componentize 的 world 解码。Rust 侧从不调用
  getrandom（salt/nonce 由前端 `crypto.getRandomValues` 传入），故用本地
  `rust/getrandom-stub/`（`[patch.crates-io]`）提供 rand_core 编译所需的最小
  API 面，显式报错（fail-visible，不静默返回伪随机数）。
- 清单：补 `network:http` 权限与 `assistant.chat-stream` / `vault-*-secret` /
  `providers-delete` 命令。`assistant.chat-cancel` 未落地——M1 取消由前端
  `agent.abort()` 停消费完成，宿主无断流能力，Rust 侧 chat-cancel 无实际语义
  （spec 附录 A 为草案，§5.2 取消口径为准）。

### 0.0.1（2026-11-12）— 票 05：双端骨架

- 建立 `servers/assistant` 双端 wasm 应用骨架（`type: internal-business`，L2 系统服务）。
- 共享 Rust crate `wasmnest-plugin-assistant`：双端单产物，骨架阶段导出
  `assistant.ping` 一条命令，验证「前端调用 → 共享 crate 命令 → 宿主返回」链路。
- 共享 TS 核起步：`shared/types.ts` + 共享占位视图 `PlaceholderView.vue`（端无关，纯 props）。
- 双端占位页：挂载后自动跑一次 ping，链路状态显性呈现（fail-visible，spec §2.4）。
- manifest（spec 附录 A 草案的骨架子集）：
  - 权限 `storage` / `apps:control` / `ui:globalEntry`（`network:http` / `broadcast`
    随票 08 流式落地时补）；
  - `contributes.globalEntries` 注册全局入口「Nest」（order 10）；
  - 命令面只含 `assistant.ping`，真实命令（chat-stream / vault-* / memory-* /
    audit-list）随票 07–14 加入共享 crate 与清单。
- 平台接线：桌面 `PLUGINS` 注册表收录 `com.wasmnest.assistant`；
  `release-manifest.json` 增 `servers/assistant` 条目；边界锁
  `hostAppBoundaryLock.test.ts` 收录本应用 `entry.ts` 契约。
- 待办（后续票）：对话主链路（08）、多会话（09）、provider 适配（10）、
  人格与首次使用（11）、数据底座与保险库（07）、记忆（12）、工具运行时（13）、
  记忆工具与注入（14）、应用工具接入（15）、验收与文档（16）。
