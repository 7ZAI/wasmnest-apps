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
