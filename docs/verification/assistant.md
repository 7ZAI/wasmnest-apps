# Nest 助手端到端功能验证（M1）

> **适用对象**：`com.wasmnest.assistant`（`servers/assistant/desktop` + `servers/assistant/mobile`）
> **定位**：系统级个人助手（`internal-business`，L2 系统服务），随宿主分发；独立于 BedCode。
> 设计真源 = 平台仓 `.scratch/2026-11-11-personal-assistant/spec.md`；票单 = 同目录 `issues/`。
> **报告用法**：本文件同时是模板与本轮（2026-11-13，票 05–16）实测记录；后续复验按 §4 更新。

---

## 0. 应用信息

| 项 | 值 |
| --- | --- |
| 应用 / 插件 id | Nest（巢）/ `com.wasmnest.assistant` |
| 支持端 | 桌面 + 移动（双端单产物：共享 Rust crate + TS 共享核） |
| 桌面入口 | 全局入口（工具栏 / 状态栏，`ui:globalEntry` 门控）→ `/assistant` |
| 移动入口 | 胶囊菜单全局入口 → 运行面（`ui.registerSurface`） |
| 类型 / 权限 | `internal-business` / `apps:control`、`ui:globalEntry`、`network:http`、`storage`（随包信任域自动授予） |
| 宿主机制 | 应用调用桥 `AppControlAPI`（白名单 + 审计）+ 全局入口（平台仓 `docs/architecture.md` §5.1） |

### 自动化基线（2026-11-13 实测）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 桌面单测 | `pnpm --dir servers/assistant/desktop run test:run` | **165 passed**（10 文件：入口契约 / 流式 / 三家 provider / 多会话 / 会话切换 / 提示词 / 记忆管理 / 记忆工具与提取 / 工具运行时 / 应用工具） |
| 移动单测 | `pnpm --dir servers/assistant/mobile run test:run` | **5 passed**（激活 / 运行面） |
| 共享 Rust | `cargo test --manifest-path servers/assistant/rust/plugin/Cargo.toml` | **16 passed**（保险库 / 记忆 / 审计 / 会话守卫 / 命令面） |
| 桌面构建 | `node scripts/build.js`（前端 + wasm + componentize） | **绿** |
| 移动构建 | `WASMNEST_APPS_ROOT=<应用仓> node wasmnest-mobile/scripts/plugin-build.js --plugin com.wasmnest.assistant` | **绿**（产物入 `resources/plugins/mobile/com.wasmnest.assistant/`） |
| 类型检查 | 双端 `vue-tsc --noEmit` | **0 error** |
| lint | `eslint servers/assistant --ext .ts,.vue` | **0 error** |
| 平台侧 | 桌面/移动宿主 `test:run`、`check:wit`、权限词汇跨端锁 | 见 §5（Nest 相关全绿；存在与本应用无关的并发在途漂移，见 §5.3） |

---

## 1. 功能清单（M1 交付面）

| 能力 | 端 | 说明 | 票 |
| --- | --- | --- | --- |
| 对话流式 | 双端 | BYOK 多供应商（OpenAI 兼容含自定义 baseURL / Anthropic / Gemini）；SSE 流式；中止 / 错误编码不崩 | 08 / 10 |
| 多会话 | 双端 | 默认长期陪伴会话（不可归档）+ 任务会话；最近 N 条 + 摘要恢复上下文 | 09 |
| 人格与首次使用 | 双端 | 八条骨架提示词（身份 / 边界 / 模式 / 记忆 / 工具 / 安全 / 隐私 / 语言）；首次使用非人声明；禁语可复跑检查 | 11 |
| 保险库 | 双端 | Argon2id + XChaCha20-Poly1305；密钥只存密文；未解锁不可见；自动锁定 | 07 |
| 记忆管理 | 双端 | 已确认 / 待确认收件箱 / 已拒绝三视图；编辑 / 删除 / 过滤；清空二次确认；记忆开关 | 12 |
| 记忆工具与注入 | 双端 | memory.remember（write）/ recall（read）/ forget（danger）；token 预算注入 + 「本次会带上这些记忆」可展开清单；每轮轻量提取（默认开可关，失败用户可见） | 14 |
| 工具运行时 | 双端 | 四档风险（read / ui / write / danger 二次确认）；拒绝不中断循环；急停 + 停止并锁库；审计每调用一行（只存摘要） | 13 |
| 应用工具 | 双端 | app.list / app.open / app.invoke.\<toolId\>（风险跟随声明）/ monitor.snapshot / system.info / time.now；桥缺失显性降级 | 15 |
| 审计 | 双端 | 设置内可查看 / 清空（二次确认）；导出走应用级导出（密钥不导出） | 13 |

**M1 明确不做**（spec §2.3）：后台 agent / 定时任务 / 主动推送；紧凑面板（M2）；语音 / 跨设备同步；任意 shell / 文件写入；向量记忆；BedCode 适配。

---

## 2. 手工验收脚本（spec §8.2 口径）

> 本轮状态：脚本已按自动化与单测等价覆盖（括号内为对应自动化）；**真机 / 真实模型全链路未跑**（见 §3 未跑项）。

| # | 脚本 | 覆盖方式 | 状态 |
| --- | --- | --- | --- |
| 1 | 首次打开：设口令 → 配 provider → 发一句话 → 逐字流式；重启后要求解锁 | VaultView 门 + StreamFn 流式单测；重启解锁 = vault 状态机 | ✅ 自动化等价 |
| 2 | 问「你是谁」非人回答；「记住我不吃香菜」→ 收件箱 → 确认 → 新会话召回 → 删除后不召回 | prompt.test.ts（非人声明）；memory-tools.test.ts 端到端串（记住→收件箱→确认→召回→删除） | ✅ 自动化等价 |
| 3 | 「现在哪个应用占内存最多」→ monitor 快照 → 有数据依据；审计有记录 | app-tools.test.ts（monitor.snapshot 经桥）+ 审计摘要断言 | ✅ 自动化等价（真实 monitor 数据未跑） |
| 4 | 让助手打开 monitor：工具卡「正在打开」；应用切前台 | app.open 桥调用单测；「正在打开」文案 i18n | ✅ 自动化等价（切前台需真宿主） |
| 5 | 未声明命令调用被桥拒绝并点名，不静默 | app-tools.test.ts（tool.not_declared → isError toolResult） | ✅ 自动化等价 |
| 6 | 断网 / 错误密钥：错误卡可重试；不崩、不泄露密钥 | stream-fn.test.ts（错误编码）；密钥不落明文由保险库单测覆盖 | ✅ 自动化等价 |
| 7 | 停用助手：全局入口消失；再启用数据仍在 | 平台侧 useGlobalEntries 状态过滤（state=error 不渲染）；数据在应用私有库 | ✅ 平台机制单测等价 |
| 8 | 移动端重复 1、3、4；双端同一套 core 与记忆 | 移动 activate/surface 单测 + 共享核双端同构（D3） | ✅ 自动化等价（真机未跑） |

---

## 3. 未跑项与风险（诚实清单）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 桌面 E2E smoke（`node scripts/e2e.mjs --app assistant`） | ⏭ 未跑 | 本机 packed 宿主与 `host-runtime.lock.json` 不匹配（既有环境缺口，见 scratchpad）；真实模型调用不进 CI 必跑，E2E 需 mock provider 或本地 SSE 服务 |
| 移动真机 E2E | ⏭ 未跑 | 需重编移动宿主 + 重装 APK（设备上为旧 bundle） |
| 真实模型全链路 | ⏭ 未跑 | 需用户 BYOK 密钥；自动化用 stub 流式驱动 |
| 移动 Argon2 性能 | ⏭ 未实测 | 移动建库已显式降档 32 MiB（票 07 修复提交）；低端机实测待真机 |
| host-http 断流能力 | ⏭ 未核实 | 取消 = 前端停消费 + 丢弃后续 chunk，宿主是否可断流不可知（spec 风险 #3，UI 与日志如实说明） |
| 移动桥实测结论 | ⏭ 未真机验证 | 桥走前端 `plugin_invoke`（双端同构），真机注入点 `PluginContext.apps` 需实测（spec 风险 #4）；缺失时应用显性降级且有单测 |
| 全局入口视觉定稿 | ⏭ 待产品确认 | 工具栏 vs 状态栏 vs 胶囊按 `docs/frontend.md` UI 前置流程定稿（spec 风险 #7） |

---

## 4. 复验口径

- 自动化：§0 表格命令重跑，结果更新到表格。
- 手工：§2 脚本在真机 / 真宿主执行后逐条打勾，未跑项留在 §3 并写明阻塞原因。
- 跨仓联动：平台 `release-manifest.json`、构建注册表、`hostAppBoundaryLock`、权限词汇锁随应用仓变更同步（锁红先查清单同步，再查代码）。
---

## 5. 2026-11-20 界面与浮窗重构（本地预览实测）

### 5.1 变更范围

- 主题：新增 `shared/theme/nest-tokens.css`，只在 `.nest-app` 内把宿主 token 映射为 `--nest-*`；组件内暗色兜底字面量全部移除。
- 消息区：内容列限宽 800px 居中；助手消息改为文本流 + 轻量 Markdown（标题 / 列表 / 粗体 / 行内代码 / 代码块，自研解析、无 `v-html`）；用户消息保留右对齐气泡。
- 侧栏 / 输入区：新建按钮实心、底部入口 32px 命中区、窄窗口抽屉；输入框胶囊化（22px 圆角）、聚焦描边、自适应高度、发送按钮图标化。
- 形象：`NestMascot` 六态（空闲 / 思考 / 流式 / 工具 / 错误 / 锁定），纯内联 SVG；动效可关并尊重减少动态效果。
- 浮球与小窗：桌面启用（`interactiveFloat`），应用内浮球可拖拽、夹紧、持久化；小窗只承载当前会话，管理页留整页；整页可收起为浮球。
- 预览工具：`servers/assistant/desktop/src/preview/` + `preview.vite.config.ts` + `scripts/capture-preview.mjs`，不进入产品产物、不改平台仓。

### 5.2 本地预览截图基线（1440×900，宿主 token）

| 状态 | 截图 | 关键实测 |
| --- | --- | --- |
| 对话页 · 浅色 | `s3-sidebar-light.png` | 侧栏 220px / 背景 `#efede7`；消息列 800px 居中；新建按钮实心 `#1d1a14` |
| 对话页 · 深色 | `s1-tokens-dark.png` | `.nest-app` 背景 `#15130f`、正文 `#ece8dc`；无浅色残留 |
| 锁定页 · 浅 / 深 | `s1-locked-light.png` / `s1-locked-dark.png` | 锁定卡片使用同一 token 层，深色下不再恒浅 |
| 窄窗口 720×600 | `s3-narrow-light.png` | 侧栏抽屉默认移出（x=-260），主区 720px |
| 浮球 | `s5-floatball-light.png` | 浮球 52px，右下角默认位；无整页 DOM |
| 小窗 | `s5-panel-light.png` | 380×520，Markdown 块 7 个，消息 4 条，输入区可聚焦 |
| 形象六态 | `s4-mascot-light.png` | 六态并排；锁定态使用盖子 + 方形光点，与空闲态结构不同 |

截图与探针 JSON 位于 `.scratch/2026-11-20-assistant-floating-ui/shots/`（本地未跟踪）。

### 5.3 本轮已跑命令

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 桌面单测 | `pnpm run test:run`（`servers/assistant/desktop`） | **195 passed**（16 文件；新增 Markdown / 形象状态 / 浮球夹紧 / 形象组件） |
| 前端构建 | `pnpm run build:frontend` | **绿**，`dist/index.js` 364.00 kB（gzip 106.50 kB） |
| 应用仓 lint | `pnpm run lint`（worktree 根） | **0 error**（43 warning，均为既有或风格类） |
| 预览截图 | `node scripts/capture-preview.mjs --state ...` | **绿**，见 §5.2 |

### 5.4 未跑项与风险

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 真实宿主目验（`pnpm run dev:host`） | ⏭ 未跑 | 需要与 `host-runtime.lock.json` 匹配的宿主产物；本机 lock 与平台 SDK/WIT 版本存在既有漂移风险 |
| 桌面 E2E（`node scripts/e2e.mjs --app assistant`） | ⏭ 未跑 | 仓库此前没有 `assistant.spec.ts`；真实宿主前置未满足。新增锚点已就绪（`nest-floatball`、`nest-quickpanel`、`nest-quickpanel-close`、`nest-quickpanel-expand`、`nest-collapse-to-float`、`nest-mascot`） |
| 移动端真机 | ⏭ 未跑 | 移动端本期不启用浮球（`interactiveFloat` 缺省 false），共享组件改动需真机回归 |
| 动效与真实流式 | ⏭ 未验 | 预览用 mock 流式与静态状态；真实 provider / 权限 / 加密链路需真实宿主 |
| 图片 / 语音 / 附件 | ⏭ 不做 | 本期非目标，未引入 |
