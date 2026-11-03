# AI Chatbox（`com.wasmnest.ai-chatbox`）

AI 大模型对话应用：接入任意 OpenAI 兼容供应商与 Anthropic / Gemini，流式输出、思考模式、多会话管理与 JSONL 对话日志落盘。双端形态独立——桌面是自带全部依赖的挂载包，移动是宿主壳里的独立页面。

| | 桌面 | 移动 |
| --- | --- | --- |
| 入口 | `src/entry.ts` → `mountApp(root, env)`（另导出 `mountPreview`） | `src/index.ts` → `activate(context)` / `deactivate()` |
| 插件形态 | `rust-ts`（前端挂载包 + WASM 后端） | `wasm`（`UIRegistry` 运行面） |
| 宿主位置 | 侧边栏「AI 对话」 | 宿主壳应用列表「AI Chatbox」独立页面 |
| 后端产物 | `wasmnest_plugin_ai_chatbox.wasm`（`wasm32-wasip3`） | 同名 `rustLibrary`，移动组件化产物 |

## 功能特性

- **多供应商**：内置 OpenAI / Anthropic / Gemini / 自定义（OpenAI 兼容）四种方言，Base URL、API Key、模型均可配置，支持从供应商拉取模型列表
- **流式对话**：SSE 增量渲染，思考内容（reasoning）可与正文分离展示，推理强度可调
- **限流自动重试**：429 / 503 / 529 与显式 rate limit 文本触发指数退避重试，最大次数与首/上限等待均可配（0 = 关闭）
- **会话管理**：多会话新建 / 切换 / 重命名 / 删除，消息与 token 用量随会话落盘
- **对话日志**：JSONL 追加写，首行 meta + 逐行消息，可追溯审计
- **渲染**：Markdown（流式未闭合围栏补偿）+ 代码高亮；代码字号、行距、高亮主题可调
- **双端差异**：桌面高亮用 highlight.js 同步渲染；移动用 Shiki 懒加载（首次高亮才载 WASM，失败降级纯文本，不白屏）

## 使用方式

**桌面**：侧边栏「AI 对话」→ 标题栏齿轮进「设置」→「已配置的供应商」可折叠查看，点「添加供应商」选模板（也可点已配置行编辑 / 删除）→ 新建对话提问。对话自动保存，会话列表可切换 / 删除；设置页下方可直接调整代码渲染、思考模式与限流重试。

**移动**：宿主壳应用列表打开「AI Chatbox」→ 首次先配置供应商与模型 → 返回会话页开始聊天。

## 实现结构

```text
apps/ai-chatbox/
├─ desktop/
│  ├─ src/entry.ts              挂载契约 + 预览契约（与宿主 useAppMount 同形）
│  ├─ src/appContext.ts         AppMountEnv → PluginContext 适配（不碰令牌）
│  ├─ src/index.ts              仅 dev-shell 兼容出口（导出 devMock）
│  ├─ src/components/           ChatView / ChatInput / ChatMessage / ConversationList
│  │                            ProviderConfigPage / ProviderForm / AppSettingsSection
│  ├─ src/composables/          useAiChat（会话编排 + 流式 + 重试）/ useAiConfig / usePluginConfig
│  ├─ src/adapters/             协议方言层：openai / anthropic / gemini / custom / registry
│  │                            sse（前端缓冲切包）/ usage（用量合并）
│  ├─ src/utils/                markdown（流式补偿）/ highlight / providerIcons / settingSlider
│  ├─ src/preview/              多任务卡片只读预览面
│  └─ rust/src/                 lib.rs（激活 + 命令分派）/ client.rs / commands.rs / store.rs
└─ mobile/
   ├─ src/index.ts              activate：注册 i18n → dev-shell mock（仅浏览器）→ registerSurface
   ├─ src/…                     与桌面同构的 adapters / composables / components（无预览面，多 appBack）
   └─ rust/src/                 同职责后端，数据目录取 AppDownloadsDir
```

**方言差异全部收敛在 `src/adapters/`**：请求构建与流式解析按供应商切换，Rust 只透传 `http_fetch` 载荷。流式统一走宿主 raw 模式（`sseFormat: ''` 字面量锁定），SSE 切包在前端 `SseBuffer`，JSON 语义解析在各 adapter——宿主与 SDK 零改动。

**命令面**（`plugin.json.contributes.commands`，八条，双端同名）：

| 命令 | 作用 |
| --- | --- |
| `ai-chatbox.chat-stream` / `chat-complete` | 流式 / 非流式对话 |
| `ai-chatbox.fetch-models` | 拉取供应商模型列表 |
| `ai-chatbox.list-conversations` / `get-messages` | 读会话索引 / 读单个会话消息 |
| `ai-chatbox.save-conversation` / `save-message` | 写会话 meta / 追加消息 |
| `ai-chatbox.delete-conversation` | 删会话文件并从索引剔除 |

## 数据与存储

对话真源是文件系统，供应商配置真源是插件 storage（两者不混）：

```text
# 桌面：{HomeDir}/.wasmnest/ai-chatbox/     移动：{AppDownloadsDir}/ai-chatbox/
├─ index.jsonl              # 会话索引：每行一条 meta，按 updatedAt 降序
├─ conversations/<id>.jsonl # 首行 meta + 逐行消息（append-only）
└─ providers.json           # 默认结构占位（{"providers":[],…}），不是配置真源
```

插件 storage 键：`apiProviders`（供应商数组）、`activeProvider`、`activeModel`、`config`（`PluginConfig`：思考模式 / 代码渲染 / 重试参数）。

- 所有文件 IO 走宿主 `host-fs` 原语，**不经 WASI**：wasip3 的 filesystem 方法是 async，而插件导出是 sync-lifted，guest 在 sync 导出里等 async import 会 trap `CannotBlockSyncTask`。
- `index.jsonl` 损坏行跳过并记日志（不整表失败）；文件缺失视为空列表。
- `providers.json` 由 Rust `init` 建占位——**改它不会改配置**，供应商请走应用内设置页。

## 权限

| 端 | 权限 | 用途 |
| --- | --- | --- |
| 桌面 | `fs:read` / `fs:write` | JSONL 会话日志读写 |
| 桌面 | `network:http` | 供应商 API 请求（含流式） |
| 桌面 | `storage` | 供应商 / 应用配置 |
| 桌面 | `broadcast` | 流式事件 `ai-chatbox:stream:<id>` 收发 |
| 桌面 | `ui:sidebar` | 侧边栏入口 |
| 移动 | `fs:read` / `fs:write` / `network:http` / `storage` / `ui:back` | 同上 + 返回键 |

移动端另声明预授权面，减少运行期逐次弹窗：

- `preauthDirs`：`${downloads}/ai-chatbox`
- `preauthUrls`：`api.deepseek.com` / `dashscope.aliyuncs.com` / `*.openai.com` / `api.anthropic.com` / `generativelanguage.googleapis.com`

激活时对数据目录集中申请一次 `fs_request_auth`：同意后宿主持久化记住，后续调用免弹窗；**拒绝或超时即激活失败**（fail-closed，应用显示 Error，重新启用可再次弹窗）。

## 开发与构建

> 包管理器一律 pnpm；`test:run` 而非 `test`（后者是 watch，不退出）。

### 桌面（`apps/ai-chatbox/desktop/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装本工程依赖（每个端工程各自独立 workspace） |
| `pnpm run dev` | `build.js --watch`：改前端自动重建产物 |
| `pnpm run dev:host` | 起真实桌面宿主：宿主按 `host-runtime.lock.json` 解析并校验契约版本，产物写 `.dev-host/plugins` 供宿主 watcher 热重载 |
| `pnpm run build` | 全量构建：vite → cargo → 产物落 `apps/ai-chatbox/desktop/.build/plugins/com.wasmnest.ai-chatbox/` → 注入 wasmHash |
| `pnpm run build:frontend` / `build:rust` | 分段构建（只重建前端 / 只重建 wasm） |
| `pnpm run test:run` | vitest 单测 |
| `cargo test --manifest-path rust/Cargo.toml` | 后端 native 单测（store / client） |

### 移动（`apps/ai-chatbox/mobile/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run dev` | SDK dev-shell（浏览器 mock：命令走前端 handler，不跑 WASM） |
| `pnpm run build` / `package` | `wasmnest-plugin build` 产 `dist/`；写进宿主 resources 由平台仓移动构建负责 |
| `pnpm run test:run` | vitest 单测 |

### 端到端（应用仓根）

```bash
node scripts/e2e.mjs --app ai-chatbox    # 真实桌面宿主内挂载真实 wasm，脚本点界面
```

需 tauri-driver + WebKitWebDriver；判据纪律见 `docs/E2E.md`。

## 测试

- **桌面单测**（`src/__tests__/`，11 个文件）：适配层请求/解析、SSE 切包、会话编排与重试、配置持久化与默认值回退、Markdown 流式补偿、设置面板滑杆、预览面只读约束。
- **移动单测**（8 个文件）：与桌面同构的适配/会话/配置用例，另有 `appBack`（物理返回）与 Shiki 高亮用例。
- **桌面 E2E**：`e2e/specs/ai-chatbox.spec.ts` —— 断言不依赖本机是否配过供应商、是否有历史会话；文案断言取各语言并集；等状态不 sleep。

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 应用显示 Error、命令全部失败 | 数据目录授权被拒或超时未响应（移动端弹窗 30s 超时）。在插件设置里停用再启用，重新授权 |
| 桌面对话正常、移动端不落盘 | dev-shell 才会注册命令 mock；真实宿主必须走 WASM 后端。确认不是在浏览器 dev-shell 里验证落盘 |
| 流式输出卡住不动 | 宿主 raw 模式下 SSE 由前端切包，检查供应商是否返回非标准分隔；`sseFormat` 必须为空串 |
| 换了 `providers.json` 没生效 | 配置真源在插件 storage（`apiProviders`），该文件只是占位 |

## 相关文档

- 应用仓裁决与硬约束：`AGENTS.md`
- 结构导航 / 双端形态 / 产物流向：`docs/CODE-MAP.md`、`docs/FRONTEND.md`、`docs/BACKEND.md`
- 挂载契约宿主侧真源：平台仓 `wasmnest-desktop/src/shell/mount/useAppMount.ts`
