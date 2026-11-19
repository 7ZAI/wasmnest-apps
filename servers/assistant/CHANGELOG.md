# Nest 助手（servers/assistant）

系统级个人助手「Nest / 巢」：情感陪伴对话 + 应用调度执行，独立于 BedCode。
设计真源 = 平台仓 `.scratch/2026-11-11-personal-assistant/spec.md`（D1–D17 定稿），
票单 = `.scratch/2026-11-11-personal-assistant/issues/`。

## 结构（spec §5.1）

- `shared/` — TS 共享核（不单独发布）：双端同构的共享类型与共享 UI 组件（D3）。
- `rust/plugin/` — 共享 Rust crate（sharedRustManifest 模式，双端单产物，ADR 0050）。
- `desktop/` / `mobile/` — 双端工程：只写入口与宿主适配，构建产物随宿主分发。

## 变更记录

### 0.0.1（2026-11-13）— 票 15：应用工具接入（app.list / app.open / app.invoke.\<toolId\> / monitor.snapshot / system.info）

- **工具目录**：`shared/tools/app-tools.ts`。`app.list`（read）列应用与声明工具；`app.open`（ui）
  打开 / 切应用（卡片显示「正在打开」）；`app.invoke.<toolId>` 按桥目录快照动态构建——
  工具名、`parameters`（直接用声明方 argsSchema）、风险全部跟随目标应用声明（助手策略只升不降）；
  `monitor.snapshot`（read）调 monitor 声明的快照命令；`system.info`（read）本地平台 / 语言。
- **目录刷新**：`NestChatSession.refreshAppTools()` 在 agent 构建前拉桥快照重建 `app.invoke.*`；
  桥缺失 / 拉取失败只保留基础件（app.list 等执行时显性报错），不静默。
- **桥错误分流**：未声明命令（`tool.not_declared`）/ 未运行（`app.not_running`）/ 打开失败
  （`app.open_failed`）一律变成 `isError: true` 的 toolResult 交回模型，点名缺什么、给出路；
  执行失败也落审计行（用户已批准的调用，结果摘要记录失败原因）。
- **移动桥缺失降级**：桥未注入时 app 类工具仍注册但执行显性报错（点名缺 `apps:control` / 宿主不支持），
  该路径有单测（不静默）。
- **工具结果不入长期记忆**：每轮提取只从用户消息取（提取提示词明令禁止提取应用返回内容），
  app 作用域记忆不参与注入（票 14 口径）。
- **测试**：`app-tools.test.ts`（17 例）：目录构建 / 风险跟随 / 桥缺失降级 / 桥拒绝分流 / 运行时集成。

### 0.0.1（2026-11-13）— 票 14：记忆工具与记忆注入

- **记忆工具**（`shared/tools/memory-tools.ts`）：`memory.remember`（write，需确认）写 pending 收件箱
  （带来源会话 / 消息）；`memory.recall`（read）按 scope / 关键词取已确认事实，无命中点名；
  `memory.forget`（danger，二次确认）按 id 删除或按 scope 清空。
- **注入**（`shared/memory/extract.ts` + session）：每轮按 token 预算（默认 800）在已确认事实里取舍
  ——global 优先、关键词命中提权、最近使用排序；app 作用域不注入（应用数据只作临时上下文）。
  UI 可展开「本次会带上这些记忆」清单（`nest-memory-inject`），用户能看到实际发出的内容。
- **每轮轻量提取**：`agent_end` 后在前台触发一次（默认开、可关，`memory.extractEnabled`）；
  只从用户消息提取，结果进 pending 收件箱；失败不阻断对话，UI 显示「本轮未提取记忆」（不静默吞错）。
- **会话摘要**：票 09 留的 `resolveSummary` 钩子落地内置实现——超阈值时生成摘要、落库
  （`conversation.summary:<id>`）、随会话保留，只入 transcript 不进 UI 消息流。
- **端到端串测**：说「记住我不吃香菜」→ 收件箱 → 确认 → 新会话召回 → 删除后不召回（有可复跑用例）。
- **测试**：`memory-extract.test.ts`（解析 / 预算选择 / token 估算）、`memory-tools.test.ts`（工具行为 + 端到端串）。

### 0.0.1（2026-11-13）— 票 13：工具运行时与确认 UX

- **运行时**（`shared/tools/runtime.ts` + `risk.ts` + `types.ts`）：声明式工具目录装配成 pi
  `AgentTool`（`parameters` 直接用声明方 JSON Schema；`execute` 走本地执行器或 `apps.invoke` 桥）。
- **四档风险实测**（真实 pi 循环驱动，非 UI mock）：`read` 自动；`ui` 自动 + 可见卡；`write` 暂停等
  内联批准；`danger` 二次确认（第二次展示影响范围）。风险只升不降（`elevateRisk`：应用声明 + 助手策略）。
- **拒绝 / 失败不中断**：被 block 的调用由 pi 合成 `isError` toolResult；执行失败返回 `isError: true`，
  模型能看懂失败原因，循环继续。
- **急停**：常驻「停止」+「停止并锁定保险库」；`abortPending` 把在途确认按拒绝结算——停止后队列中
  未执行的工具不再执行。
- **审计**：每次调用一行（tool / app / command / risk / decision / 参数与结果摘要 sha256+长度），
  **不落参数与结果原文**（spec §6 日志红线）；新增 Rust 命令 `assistant.audit-record` / `assistant.audit-clear`，
  设置内审计页可查看 / 清空（二次确认）。
- **核心工具**：`time.now`（read）先行落地（票面要求用它加测试 write / danger 工具证明四档与急停）。
- **测试**：`tool-runtime.test.ts`（13 例，真实 Agent 循环）：四档、拒绝、急停、风险升档、未声明工具、
  审计摘要红线。

### 0.0.1（2026-11-13）— 票 12：记忆存储与管理面

- **Rust 命令面**：新增 `assistant.memory-clear`（scope 缺省 / `*` = 全部）、`assistant.memory-set-status`
  （收件箱确认 / 拒绝只改 status 列，拒绝过的条目不会被后续提取复活）、`assistant.audit-clear`。
  `store` 增 `clear_memory_all` / `set_memory_status` / `clear_audit` 与 `ts_now()` 辅助。
- **管理页**（`shared/components/MemoryView.vue`，侧栏入口）：三视图（已确认 / 待确认 / 已拒绝）；
  逐条编辑、删除（「忘记这条」立即删）、按应用 / 作用域过滤；收件箱逐条确认 / 拒绝；
  「清空全部记忆」二次确认；记忆总开关与每轮提取开关（关闭后不再写入 / 检索，数据保留）。
- **来源追溯**：每条记忆带来源会话 / 消息与时间（`MemoryFact` 既有列，管理页展示）。
- **未解锁不可见**：记忆正文为 AEAD 密文，Rust 命令未解锁显性报错（沿用票 07 口径）。
- **测试**：`memory-manager.test.ts`（11 例）：三态分类 / 确认只走 set-status / 清空 / 开关默认值 / 摘要存取键。

### 0.0.1（2026-11-13）— 票 11：人格与首次使用

- **提示词**：边界文案改为语义描述（禁语不以原样出现在提示词里，避免被模型照抄示例）；
  导出 `FORBIDDEN_PHRASES` 清单供可复跑检查。
- **可复跑用例**（`prompt.test.ts`，17 例）：八条骨架按序齐全（双语）、身份条款明确非人、
  危机协议要素（共情 + 询问安全 + 紧急 / 危机资源 + 不诊断）、禁语不原样出现、隐私条款、
  工具纪律、模式自适应、中英互不混入、首次使用声明文案非人表述。
- **首次使用声明**：`FirstRunNotice.vue`——进入对话后未阅时展示非人声明（系统助手、不是人、
  不替代真实关系与专业帮助），阅后写 `firstRun.noticeShown` 设置不再弹出；读取失败按未阅处理（不静默跳过）。

### 0.0.1（2026-11-13）— 票 10：Anthropic + Gemini 适配

- **三家方言并存**：`ProviderApiStyle = openai-compatible | anthropic | gemini`；
  设置页新增接口方言选择，请求构造与 SSE 事件映射落在 `shared/providers/`
  （`anthropic.ts` / `gemini.ts`，与 OpenAI 兼容路径同形协议、自实现，
  不引用其它应用源码，spec §5.2 / D17）。
- **同一 StreamFn 契约**：新增统一 `StreamMapper` 接口与 `createStreamMapper`
  工厂；`buildProviderRequest` 按方言分派（导出供单测）。三家共用同一错误
  编码——映射错误统一走 `StreamMapError` 基类（各方言子类保留语境），
  StreamFn 不感知方言，**UI 无供应商分支**。
- **Anthropic（Messages API）**：`x-api-key` + `anthropic-version` 头；
  system 提取为顶层参数；连续同角色消息合并（协议要求交替）；
  tool_use / tool_result 块映射；SSE `event:` 字段事件类型
  （message_start / content_block_* / message_delta / message_stop，
  ping 忽略、error 事件点名抛出）；stop_reason 映射
  （end_turn→stop / max_tokens→length / tool_use→toolUse）。
- **Gemini（streamGenerateContent?alt=sse）**：`x-goog-api-key` 头；
  systemInstruction 顶层参数；assistant → `model` 角色；functionCall /
  functionResponse 块映射；每条 data 为响应 JSON：文本 / 思考
  （thought 标记）/ 函数调用 part 映射到同一事件形状；finishReason
  （STOP / MAX_TOKENS / TOOL_CALLS）与 usageMetadata 入协议。
- **重建 transcript 的 api 字段**随方言映射（`providers/styles.ts`：
  openai-compatible→openai-completions / anthropic→anthropic-messages /
  gemini→google-generative-ai）。
- **无 node: 依赖**：provider 适配为纯 TS（JSON 处理），不引入 pi-ai 的
  Node 入口（spec 风险 #1 口径不变）；依赖版本不变（pi 包精确钉 1.5.0）。
- **测试**：新增 `anthropic.test.ts` / `gemini.test.ts`（请求形状、消息映射、
  SSE 事件映射、与 SseParser 的分片边界集成——半包 / 多事件一包 / 心跳 /
  错误事件）；`stream-fn.test.ts` 扩三家分派与 Anthropic 全链路 event 透传。

### 0.0.1（2026-11-12）— 票 09：多会话

- **默认陪伴会话**：固定 id `nest-companion`，Rust 激活时幂等建立（前端
  `ensureDefaultCompanion` 双保险核对，脏数据自愈）；`conversations-archive`
  带守卫——默认陪伴会话**归档点名拒绝**（恢复放行，留自愈出口），不静默。
- **多会话管理**：新建任务会话（`kind = task`）、切换、改名（用户可改）、
  归档 / 恢复；归档会话不进默认列表，侧栏归档区可查可恢复；首条用户消息
  自动命名（只认创建期默认标题字面量，不误改用户自设标题）。
- **冷启动上下文恢复**：按最近 N 条消息重建 transcript（N 可配，
  `conversation.contextLimit`，**默认 20**）；总消息数超过摘要阈值
  （`conversation.summaryThreshold`，**默认 40**）时才请求会话摘要补上下文
  ——摘要生成归票 12，本票留 `resolveSummary` 钩子；跨会话共享记忆读钩子
  `resolveMemoryContext` 同留接口，注入归票 14。摘要 / 记忆只入 transcript，
  不进 UI 消息流。
- **命令面**：新增 `assistant.messages-count`（只读计数，摘要阈值判定用，
  双端清单同步声明）；`conversations-archive` 命令接入守卫。
- **界面**：侧栏会话列表（陪伴会话 🔒 保护标记、活跃会话改名、归档 ✕）、
  可折叠归档区（恢复）；i18n zh-CN / en 同步。
- **测试**：Rust 归档守卫单测（拒绝 / 恢复 / 前缀相似不误伤）；桌面 vitest
  覆盖默认陪伴建立与自愈、归档 / 恢复 / 改名、最近 N 条加载、摘要阈值门控、
  transcript 注入顺序、创建期标题判据。

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
