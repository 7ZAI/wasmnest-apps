# FRONTEND —— 前端规范（双端）

> 适用范围：`apps/<slug>/desktop/src/**`、`apps/<slug>/mobile/src/**`（含 `.vue` / `.ts`）。
> 结构导航见 `docs/CODE-MAP.md`；跨端裁决与硬约束见 `AGENTS.md`；后端规范见 `docs/BACKEND.md`。
>
> **形态基准 = 本仓现有 app**，不是 SDK 的 README / `template/` / `dev-shell/`（平台仓桌面 SDK 仍是旧贡献面形态，属已知漂移，本仓不代为修复）。

双端前端**形态不同，不要互相套**：

| | 桌面 | 移动 |
| --- | --- | --- |
| 入口 | `src/entry.ts` → `mountApp(root, env)` | `src/index.ts` → `activate(context)` / `deactivate()` |
| 构建 | 独立挂载包，**自带全部依赖、无 externals** | SDK `wasmnestPlugin()`，共享模块**外置**为宿主全局 |
| 与宿主关系 | 运行时装载（宿主动态 `import('<dir>/<id>/index.js')`） | 运行期注册（宿主 loader 调 `activate`） |
| 预览 | 真实宿主 `pnpm run tauri:dev`（平台仓） | `pnpm run dev`（SDK dev-shell，HMR） |

---

## 1. 桌面端：独立挂载包（机制 B，ADR 0057）

### 1.1 三个文件的分工

| 文件 | 职责 | 禁止 |
| --- | --- | --- |
| `src/entry.ts` | 导出 `mountApp(root, env): Promise<AppMountHandle>`（+ 可选 `mountPreview(root, env): Promise<AppPreviewHandle>`）；建 Vue 实例、`app.provide('pluginContext', createAppContext(env))` | 放业务逻辑 |
| `src/appContext.ts` | 把 `AppMountEnv` 适配成 `PluginContext` 形状 | 自己拼 `plugin_invoke` 通道、碰令牌 |
| `src/index.ts` | **仅** dev-shell 兼容出口（导出 `devMock` 领域种子数据） | 加业务逻辑（主宿主不加载它） |

依赖口径：`package.json` 的桌面 SDK 是**已发布版本精确依赖**（`0.0.1`，不用 `file:` / `^`），`rust/Cargo.toml` 里 `wasmnest-plugin-api = { version = "=0.0.1" }`；要拿本地平台仓源码调试必须显式 `pnpm run link:platform`（`unlink:platform` 还原，`link:platform --status` 看状态），link 产生的 `file:` / lock 变更 / `.cargo/config.toml` 的 `[patch]` 一律不提交（AGENTS §2）。

三个产品应用（`ai-chatbox` / `bedcode` / `file-transfer`；agent-hub 已并入 bedcode 的 Agent 管理域）与 `servers/` 下的服务型 wasm（`auth-center` / `monitor`）都有 `entry.ts` 与 `appContext.ts`；`src/index.ts` 在 ai-chatbox / file-transfer 存在，**bedcode/desktop、monitor/desktop、auth-center/desktop 没有**。

### 1.2 挂载契约字段

与宿主 `../wasmnest/wasmnest-desktop/src/shell/mount/useAppMount.ts` 逐字同形（平台仓 `hostAppBoundaryLock.test.ts` 逐字校验六个 `entry.ts`，改字段必须两端同改）。

`AppMountEnv`：

| 字段 | 用途 |
| --- | --- |
| `appId` | 插件 id（= 应用 id） |
| `mountContract` | **挂载契约版本**（宿主 `MOUNT_CONTRACT` 同值，当前 `"1"`）：`entry.ts` 必须 `export const mountContract = '1'`，宿主装载时比对，不匹配 / 缺失 ⇒ **显性报错**（不是 mount 失败的白屏） |
| `invoke(command, args)` | 宿主面命令（无附加凭证，如 `get_app_settings`） |
| `appInvoke(command, ...args)` | 插件面命令（`plugin_invoke`，本 app 通道令牌已绑定） |
| `appStorageGet / Set / Delete` | 本 app 插件 KV 存储（凭证已绑定） |
| `locale` / `theme` / `platform?` | 挂载时快照；后续变更经 handle 通知 |
| `initialRoute` | 宿主路由传入的初始路径（应用以**内存路由**消化） |
| `onEvent?` | 宿主面事件出口：`navigate`（请求壳跳转）/ `route`（应用自报内部当前页） |

`AppMountHandle`：`unmount()` 必选；`setRoute?` / `setLocale?` / `setTheme?` 可选。

> **`mountContract` 的 bump 规则**（G2 / CONTRACT §6）：只在 `AppMountEnv` / `AppMountHandle`
> 形状**破坏性**变化（删字段 / 改名 / 语义变）时 bump；新增可选字段不 bump。它不替代
> WIT 版本与 SDK 版本——分发化之后三者各自独立，宿主启动前按 `host-runtime.lock.json`
> 一并比对（`scripts/host-runtime.mjs` 的 `assertHostCompatible`）。

### 1.2.1 多任务卡片预览面（可选 `mountPreview`，2026-10-20）

平台仓多任务卡片的缩略区由应用**自绘**一张只读、点时刻的预览面（**不是截图**：后台应用离开应用面即被卸载，没有 DOM 可抓）。契约与 `AppMountEnv` 逐字同形住 `useAppMount.ts`，平台 `hostAppBoundaryLock.test.ts` 的 **L5** 逐字校验六个内置桌面 `entry.ts`（四个产品应用 + 两个服务）（`appId` / `lastRoute` / `appInvoke` / `appStorageGet` / `locale` / `theme` 关键字段）；第三方面向契约仍可选。

`AppPreviewEnv`（**收窄面**）：

| 字段 | 用途 |
| --- | --- |
| `appId` | 插件 id |
| `lastRoute?` | 应用上次自报的内部路径（宿主 `appSession` 记忆）；无记录 = undefined |
| `appInvoke(command, ...args)` | 插件面命令（与主界面同一令牌 / 权限）；**只读使用** |
| `appStorageGet(key)` | 本 app KV 只读访问 |
| `locale` / `theme` / `platform?` | 宿主事实快照 |

`AppPreviewHandle`：`unmount()` 必选。

应用侧义务（宿主无法运行期拦截，靠 code review + 各 app 测试）：

- 只读：不写 / 删存储、不启动 / 停止插件、不发通知 / toast、不发起连接 / 传输 / 模型请求；
- 不换发通道令牌（预览路径**禁止** `refreshChannelToken`）、不改身份绑定；
- 预览面先挂骨架 / 空态并**立即返回 handle**，再异步取数（平台 3s 超时只覆盖 handle 返回，慢命令不得把卡打成 fallback）；
- 预览 DOM **不得含可聚焦控件**（卡片本身是唯一动作层，预览是装饰层）；
- 不挂主 `App.vue` / 主 router / 主 pinia / 主 stores / 模块级可变单例（当前前台应用的卡也会挂预览，主实例可能在遮罩后同时运行）；
- 不留下活过 `unmount()` 的定时器 / 全局监听；数据拿不到时显示应用自己的诚实空态。

内容建议（应用自决）：bedcode 会话 / 连接状态摘要、ai-chatbox 最近对话摘要、file-transfer 对端 + 传输任务摘要、monitor 插件数 / 调用 / Trap / 内存峰值摘要。机制与边界完整说明见平台仓 `.scratch/2026-10-20-app-preview-contract/spec.md`。

### 1.3 页面取数

页面沿用 `inject('pluginContext')` 取数（旧调用点零改写）。命令 / 存储 / 令牌**全部由宿主经 env 注入**。

### 1.4 构建

- `vite.config.ts`：`build.lib` 单文件 `dist/index.js`（`formats: ['es']`、`inlineDynamicImports: true`）、`minify: 'terser'`；CSS 经 `vite-plugin-css-injected-by-js` 内联；**无 externals**。
- 各 app 自持 `tailwind.config.js` / `postcss.config.js`，类名自编译（宿主 Tailwind content 不再扫 app）。
- `scripts/build.js`：`vite build → cargo build → 复制 index.js / plugin.json / icon.svg / <rustLibrary>.wasm 到产物目录 → injectWasmHash`；支持 `--watch` / `--frontend-only` / `--rust-only`；`WASMNEST_PLUGIN_DEBUG=1` 出 debug wasm。
  - **产物目录默认 = 本 app 的 `.build/plugins/<appId>/`**（G2：构建链不依赖平台仓）。刻意不落 `dist/`：各 app 的 vite 配置都是 `outDir: dist` + `emptyOutDir: true`，落在 dist 里等于每次前端构建把自己清空。写平台宿主 resources 必须显式 `--out <平台仓>/wasmnest-desktop/src-tauri/resources/plugins/desktop`（平台集成/dev-run 用）。
  - 工具来自已发布 SDK 包，不走平台相对路径：`@binblink/wasmnest-plugin-sdk-desktop/bin/{wasm-hash.js,plugin-watch.js}`（`file-transfer` 另有 `tools/componentize`，见 `scripts/sdk-componentize.mjs`：从包内物化到 `.build/componentize/` 再 `cargo run`，node_modules 是 pnpm 只读仓库，cargo 要在那儿写 `Cargo.lock` 会失败）。
  - `--frontend-only` 的 wasm 复用靠 `preservePreviousWasm()`：**构建前**把上一份 wasm 挪到临时目录（否则 outDir 被清空后无处复用）。

### 1.5 迭代路径

- 走真实宿主：平台仓 `pnpm run tauri:dev`（自动补建缺失 / 陈旧 wasm、重建陈旧挂载包、起插件 watch）。
- **`bedcode/desktop` 没有 `dev` 脚本**（前端最重，dev 期不参与 watch）：改了它的 UI 要单独 `pnpm run build` 或 `build:frontend`，依据见平台仓 `wasmnest-desktop/scripts/dev-run.js`。
- 组件级验证走 vitest（`pnpm run test:run`）。

### 1.6 禁止复活旧形态

`activate(context)` + 贡献面（`registerSidebarPanel` 等）、`window.__WASMNEST_SHARED__` 外部化、宿主共享实例复用 —— 桌面边界锁直接测红。新形态自带全部依赖（vue / router / pinia / i18n / tailwind 编译产物）。

---

## 2. 移动端：宿主壳运行面

### 2.1 入口契约

`src/index.ts` 导出 `activate(context: PluginContext)` 与 `deactivate()`，典型顺序：

1. 注册 i18n：`context.i18n.registerMessages(locale, msgs)`（key 自动加插件 id 前缀）
2. 注入插件样式：`import styles from './styles.css?inline'` + 一次性插 `<style>`（**宿主不加载插件 CSS**），用固定 `id` 保证幂等
3. `context.ui.registerSurface({ component, accent? })` 注册壳运行面（`/mobile/shell` 应用屏，appId 宿主代填）
4. 可选：`registerRoute` / `registerSettingsEntry` / `registerSlot` / `registerCapsuleItem`（二级页与设置入口）

贡献面已收拢为**单一运行面** `registerSurface`；已退役方法调用即显性报错（fail-visible）。类型与语义真源 = 平台仓 `wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`（`UIRegistry`），宿主注册表 = `wasmnest-mobile/src/shell/registry.ts`。

`deactivate()` 对称停止激活期常驻的订阅 / 控制器；样式保留（幂等），注册表与事件由宿主 loader 依 `context._disposables` 统一摘除。

### 2.2 构建与预览

- `vite.config.ts`：经 `wasmnestPlugin()`，`vue` / `vue-i18n` / `pinia` 外置为宿主全局 `window.__WASMNEST_SHARED__`（**移动端仍是外置形态，与桌面挂载包不同**）。产物入口 `src/index.ts`，`main` 指向 `index.js`。
- 库模式下 Vite 不把提取的 CSS 注入 JS，宿主只 import `index.js` → 样式会整体失效。需要 CSS 的应用自行加内联插件（`ai-chatbox/mobile/vite.config.ts` 的 `inlinePluginCss()` 是现成范例，`data-plugin-css` 标记保证重载时先移除旧样式）。
- `pnpm run dev` 起 SDK dev-shell（浏览器 HMR）；`devMock` 出口提供领域种子数据（真实宿主忽略）。**具体业务 mock / 种子数据归各 app 工程**，不要写进 SDK dev-shell。

### 2.3 域组织

移动端 app 按域分子目录，各域自带 `activate` / `i18n.ts`。`bedcode/mobile` 是最完整的范例：

```text
src/
├─ app/        应用壳域（底部导航 + 页签容器 + 终端沉浸运行面）
├─ host/       设备 / 会话 / 连接态内容面
├─ terminal/   终端消费 UI 域（TerminalView / terminalBuffer store / 输入助手）
├─ task/       任务域（桌面任务域的**只读投影**）
├─ settings/   设置域
└─ index.ts    按域顺序激活（内容域先于壳域：运行面 setup 时要能取到各域文案）
```

---

## 3. i18n

- 每个 app **自足** i18n：桌面挂载包不依赖宿主实例，语言由 `env.locale` / `setLocale` 传入。
- 新增 / 修改文案**必须 zh-CN 与 en 同步**；用户可见文案禁止硬编码。
- 桌面：集中式 `src/i18n/{index,zh-CN,en,messages}.ts`，`appContext.ts` 里 `t()` 按扁平命名空间补前缀（如 `com.wasmnest.bedcode.*`）。
- 移动：除 `file-transfer/mobile`（集中式 `src/i18n/`）外，**`bedcode/mobile` 按域分散**（`src/<domain>/i18n.ts`，在各自 `activate` 里注册）。改文案前先 `rg` 定位，不要假设集中目录。
- **宿主不装应用文案**：应用可见文案一律归本仓自持（2026-10-27 迁移）。
  - 桌面 `bedcode` 不再维护宿主消息集副本：业务 / 设置 / 服务器 / 侧边栏 / 配色等文案在 `src/i18n/{zh-CN,en}.ts`，错误信封 `errors.*` 的机制副本在 `src/i18n/mechanism.ts`（宿主机制契约，code 即 key）。
  - 引用宿主壳命名空间（`desktop.*` / `shell.*` / `common.*`）即取不到文案、界面上回显 key 原文——`i18nPrefixDiscipline.test.ts` L4 机器判。
  - 移动端同理：`wasmnest-mobile/src/locales/**` 只剩宿主壳 / 机制文案；应用 domain 文案（bedcode `hub.*` / `terminal.*` / `task.*` 等、ai-chatbox `chat.*`）由各自 app 注册。

---

## 4. 资源访问红线（静态锁）

真源 = 仓根 `eslint.config.js`（`wasmnest/frontend-no-resource-access`，双端共用一份）。前端只做 UI，一切 HTTP / WS / 文件访问由 Rust 端发起并经权限仲裁。

**禁止**：

- 网络原语：`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `navigator.sendBeacon`（裸调用、`new`、经 `window` / `globalThis` / `self` 取用四种写法都拦）
- 导航原语：`window.open` / `location.assign` / `location.replace` / `location.href =`（「打开外部链接」已收归宿主命令 `open_external_url`）
- 裸 `__TAURI__`（含 `window.__TAURI__`、`window['__TAURI__']`）
- import `@tauri-apps/plugin-{http,fs,shell,updater,opener}`

**放行**：`convertFileSrc`（既定产物 / 图标加载路径）、`invoke` / `listen`、经 `env.appInvoke(...)` / `context.commands.execute(...)` 走插件命令面。

确需豁免时在违规行写 `eslint-disable-next-line` 并注明理由 —— 豁免随 code review 可见，不静默放行。

门禁：仓根 `pnpm run lint`（0 error 口径）；`.husky/pre-commit` 对暂存前端文件跑 `eslint --quiet`（error 阻断，warning 不卡）。

---

## 5. 日志

统一 logger 目前**只有 `bedcode/desktop` 接入**（`src/utils/frontendLogger.ts`）。批量迁移用仓根脚本：

```bash
node scripts/replace-console.mjs <desktop|mobile> [appDirName]
```

它只处理**自带** `src/utils/frontendLogger.ts` 的 app（没有该模块的 app 打 skip —— 不能机械插入不存在的导入）。新接入 logger 的 app 按 bedcode 的模块形态自建后再跑脚本。

---

## 6. 测试

- 运行位置：app 目录 `pnpm run test:run`（vitest + happy-dom + `@vue/test-utils`）。**禁止 `pnpm run test`**（watch 不退出）。
- 每 app 至少覆盖：契约（`mountApp` / `activate` 行为）、关键逻辑（纯函数 / composable）、边界与错误路径。
- 有预览面的桌面 app 另需覆盖：正常数据渲染、空态 / 命令失败、无副作用（不启动通知 / 轮询）、`unmount` 清理、预览 DOM 内无可聚焦控件。预览内容裁决归各 app owner；平台只钉契约与回退（L5 + `AppPreviewTile` 行为测试）。
- **禁止**：无断言 / 恒真断言 / 只测 mock / 快照替代行为断言。
- 现状：`file-transfer/mobile` **没有** `test:run`、没有 `vitest.config.ts`（只有 `build` 与 `dev`）。给它加测试时须同步补 `vitest.config.ts` 与 devDependencies。

---

## 7. 各 app 前端差异速查

| app | 端 | 入口 | 状态管理 | 路由 | 测试 | dev |
| --- | --- | --- | --- | --- | --- | --- |
| ai-chatbox | desktop | `entry.ts` | 组件内 | 无 | ✅ | ✅ |
| bedcode | desktop | `entry.ts` | pinia | vue-router（内存路由 + `onEvent('route')` 自报） | ✅ | ❌ 无 dev 脚本 |
| file-transfer | desktop | `entry.ts` | 组件内 | 无 | ✅ | ✅ |
| monitor | servers/desktop | `entry.ts` | 组件内 | 无 | ✅ | ✅ |
| ai-chatbox | mobile | `index.ts` | 组件内 | 宿主路由 | ✅ | ✅ dev-shell |
| bedcode | mobile | `index.ts` | pinia | 宿主路由 | ✅ | ✅ dev-shell |
| file-transfer | mobile | `index.ts` | 组件内 | 宿主路由 + `registerRoute` | ❌ | ✅ dev-shell |
| monitor | servers/mobile | `index.ts` | 组件内（composable） | 宿主运行面 | ✅ | ✅ dev-shell |
