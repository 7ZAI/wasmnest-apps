# AGENTS.md

> **本文件是 wasmnest-apps（应用仓）的 wasm 应用开发导航与硬约束。**
> 只给方向、判据与导航；机制细节、契约版本、历史与踩坑在各自真源里（代码本身、平台仓 SDK、契约仓 WIT、`release-manifest.json`），需要时按指针去读，不在本文件复制。

## 0. 定位与冲突裁决

**本仓定位**：三仓（应用仓 / 平台仓 / 能力仓）里唯一的**业务主场**。一切产品语义（会话、终端、文件传输、AI、Agent 管理……）都住本仓的 wasm 应用；平台仓只提供机制与闸门，能力仓只提供应用无关引擎。新增能力先问「这是机制还是产品语义」，产品语义落应用，别推给宿主。

冲突按下述优先级裁决（高者胜）：

1. **用户当前明确指令**
2. **安全与架构红线**（§6）——确需越线时停下向用户确认，禁止自行放松
3. **本文档硬约束**（「必须 / 禁止」字样）
4. **跨仓真源**（平台仓 SDK / 契约仓 WIT / `release-manifest.json` / 代码自身）
5. **通用工程经验**

维护口径：

- **路径基准**：仓内路径相对应用仓根。跨仓按 R1 同场布局记为 `../wasmnest`（平台仓：宿主 + 双端 SDK + 构建工具）、`../wasmnest-lib`（能力仓：引擎 / 契约 / `contracts/`）、`../wasmnest-test`（跨端测试仓 `cross-end-tests/`）；布局不标准时用 `WASMNEST_PLATFORM_ROOT`（应用 → 平台）与 `WASMNEST_APPS_ROOT`（平台 → 应用）显式指定，两个 resolver 见 §2.1。
- **文档字面 ≠ 事实**：引用任何路径 / 命令 / 锁名 / 版本前先用 `ls` / `rg` 核对；与实际不符先修文档再继续。
- **最小改动**：只改任务必要文件；禁止顺手重构相邻代码、擅自升级依赖；设计取舍不猜，先问用户。
- **项目阶段（研发起步期）**：无真实用户、无对外 ABI 兼容义务——破坏性变更可直接进行，但跨仓契约按 tag 钉住（§2.3），退役面必须 **fail-visible**（点名缺失 + 给出路），禁止静默降级成「查不到就返回空」。

---

## 1. 仓速览

**内容**：双端业务 wasm 应用工程 + 仓级构建 / 打包 / 替换脚本 + 共享 lint 配置。**每个 app 保留独立 pnpm workspace**（各有自己的 `pnpm-lock.yaml` 与依赖图，不合并成单 workspace）；根 `package.json` 只做编排（`scripts/run-apps.mjs`），根 `node_modules` 只服务 lint / husky。

```text
wasmnest-apps/
├─ apps/<slug>/desktop/          # 桌面端应用工程（挂载包形态，§3.1）
│   ├─ plugin.json               # 应用清单（id / 权限 / 命令 / 配置贡献）
│   ├─ src/entry.ts              # 挂载契约入口：mountApp(root, env)
│   ├─ src/appContext.ts         # AppMountEnv → PluginContext 适配层
│   ├─ src/components/ ...       # 业务界面（Vue 3 SFC，inject('pluginContext') 取数）
│   ├─ src/i18n/                 # 自足 i18n（zh-CN / en，§6.3）
│   ├─ rust/                     # WASM 后端（cdylib；target 见 §3.3）
│   └─ scripts/build.js          # vite → cargo → 复制产物到平台宿主 resources → wasmHash
├─ apps/<slug>/mobile/           # 移动端应用工程（宿主壳运行面，§3.2）
│   ├─ plugin.json
│   ├─ src/index.ts              # activate(context) / deactivate()
│   ├─ rust/ 或 wasmnest.sharedRustManifest（共享 crate，§3.2）
│   └─ ...
├─ apps/file-transfer/rust/      # 双端共享业务核（端口 trait + 纯逻辑，无 SDK 依赖）
├─ scripts/
│   ├─ run-apps.mjs              # 仓编排：逐 app 串行跑同一条 package.json 脚本
│   ├─ platform-paths.mjs        # 应用 → 平台：宿主 resources / 平台脚本 / 组件化工具
│   ├─ plugin-wasm-config.mjs    # 桌面 wasip3 target / pinned nightly / 共享 target-dir
│   ├─ package-plugins.mjs       # 两端口构建 + 按插件打 zip（发布用）
│   └─ replace-console.mjs       # console.* → 统一 logger 的机械化替换（按需）
├─ .cargo/config.toml            # 全仓共享 target-dir（target/wasm-apps）+ jobs + sccache
├─ .husky/pre-commit             # 暂存前端文件 eslint --quiet（error 阻断）
└─ eslint.config.js              # 前端资源访问红线（双端共用，§6.4）
```

**应用清单**（真源 = 各 `plugin.json`；本表只是导航）：

| slug（目录） | 插件 id | 端 | 前端形态 | Rust 后端 |
| --- | --- | --- | --- | --- |
| agent-hub | `com.wasmnest.agent-hub` | desktop | 挂载包 | 自有 |
| ai-chatbox | `com.wasmnest.ai-chatbox` | desktop + mobile | 挂载包 / 壳运行面 | 双端各自一份 |
| bedcode（显示名 BedCode） | `com.wasmnest.terminal-session` | desktop + mobile | 挂载包 / 壳运行面 | 双端各自一份 |
| file-transfer | `com.wasmnest.file-transfer` | desktop + mobile | 挂载包 / 壳运行面 | 双端单产物：移动端经 `wasmnest.sharedRustManifest` 复用桌面 crate，共享业务核在 `apps/file-transfer/rust` |

**命名纪律**：目录 slug 与插件 id 不保证同形——`bedcode` 目录对应 `com.wasmnest.terminal-session`（仅显示名 / rustLib 名 / 目录 slug 豁免，id 不豁免，ADR 0056）。新建应用一律 `com.wasmnest.<slug>`；`plugin.json`、`package.json`、Cargo 包名、i18n 命名空间、`release-manifest.json` 五处同步改。

**产物流向**：

```text
apps/<slug>/<end>/ 源码
   │ 前端：desktop = vite 单文件包（全依赖打包）；mobile = SDK vite 插件（共享模块外置宿主全局）
   │ 后端：desktop = wasm32-wasip3 直出 Component；mobile = wasm32-unknown-unknown + 组件化
   ▼
平台仓宿主资源
   desktop: ../wasmnest/wasmnest-desktop/src-tauri/resources/plugins/desktop/<id>/
   mobile : ../wasmnest/wasmnest-mobile/src-tauri/resources/plugins/mobile/<id>/
   ├─ index.js        # 前端入口（desktop 宿主经 useAppMount 动态 import）
   ├─ plugin.json     # 构建期自动填充 contributes/permissions（桌面另注入 wasmHash）
   ├─ icon.svg
   └─ <rustLibrary>.wasm
```

---

## 2. 三仓边界与跨仓契约

### 2.1 依赖方向（禁止反向引用）

- 应用只依赖**平台仓 SDK 包**：桌面 `@binblink/wasmnest-plugin-sdk-desktop`、移动 `@binblink/wasmnest-plugin-sdk-mobile`（开发期 `file:` 指向 `../wasmnest/wasmnest-{desktop,mobile}/packages/plugin-sdk-*`；发布期用 npm 版本）。应用**零宿主源码 import**、零平台仓内部路径引用；宿主前端同样禁止 import 应用源码（运行时装载，见 §3.1）。
- 平台仓读应用源码的**唯一入口**是两个 resolver，禁止在调用方散落硬编码：
  - **平台 → 应用**：`../wasmnest/scripts/app-paths.mjs`（`WASMNEST_APPS_ROOT` / R1 兄弟布局；缺仓显性抛错，不静默跳过）与 `app-script.mjs`（转发单 app 脚本）。
  - **应用 → 平台**：`scripts/platform-paths.mjs`（`WASMNEST_PLATFORM_ROOT` / R1；宿主 resources 落点、`plugin-watch.js` / `wasm-hash.js`、组件化工具 manifest）。
- **ABI / WIT 真源不在本仓**：核心 WIT 在能力仓 `../wasmnest-lib/wasmnest-wasm-core/wit/core.wit` 与各能力域 `wit/<domain>.wit`；端组合与 SDK 生成物在平台仓（`rust/wit` 是生成物，禁止手改）。应用只是 SDK 绑定使用方——改契约不在本仓进行（§5「改 WIT / ABI」）。

### 2.2 跨仓锁（平台仓测试读本仓源码；改本仓结构 / 文案前先看它们）

| 锁 | 钉住什么 |
| --- | --- |
| `wasmnest-desktop/src/__tests__/hostAppBoundaryLock.test.ts` | 宿主零 app 源码 import、零 `__WASMNEST_SHARED__`、零旧贡献面；并逐字校验四个桌面 `entry.ts` 的 `mountApp` 契约（**新增 / 改名桌面应用必须同步该清单**） |
| `wasmnest-desktop/src/__tests__/i18nDriftLock.test.ts` | 宿主 `src/i18n/host-{zh-CN,en}.ts` ↔ `apps/bedcode/desktop/src/i18n/host-{zh-CN,en}.ts` **逐字一致**（改任一边必须同改另一边） |
| `wasmnest-desktop/src/__tests__/tailwindContentCoverage.test.ts` | 宿主 Tailwind content 不得残留 app 路径（app 类各自编译） |
| 平台仓 `.../support/appPaths.ts` 派生的锁（mobile 会话流、壳运行面、挂载槽 chrome 等） | 以 `WASMNEST_APPS_ROOT` / `appPath(slug, end, ...)` 读本仓源码；改动对应 app 结构 / 文案前先跑平台侧相关套件 |

### 2.3 发布与版本钉法

- 平台仓 `release-manifest.json` 是**跨仓版本唯一表达**：`repos.apps.tag` = 应用仓 HEAD 精确 tag（当前线 `apps-v0.0.x`），`apps` 段逐端列 `<rustLibrary>.wasm`（同一 id 可双端各一份）。
- 判据由平台仓 `pnpm run check:manifest` 校验。**新增 / 改名 / 停用应用或变更 `rustLibrary` 时**，除本仓提交外必须在平台仓同步更新该 manifest，否则装配红。
- 应用仓独立打 tag：`apps-vX.Y.Z`（不与其他两仓同号）。发布装配按该 tag 取应用仓；未打 tag 的本地改动不进发布。

---

## 3. 应用工程形态

### 3.1 桌面端：独立挂载包（机制 B，ADR 0057）

每个桌面 app 前端是**独立构建、自带全部依赖**的挂载包；宿主壳与 app 是**运行时装载**关系，禁止构建期源码耦合。

- **入口契约**：`src/entry.ts` 导出 `mountApp(root, env): Promise<AppMountHandle>`，类型与宿主 `../wasmnest/wasmnest-desktop/src/composables/useAppMount.ts` 逐字同形（drift 锁钉关键字段）。宿主经 `plugin_get_asset_dir` 拿到产物根目录后动态 import `<dir>/<appId>/index.js`，把 handle 用于卸载 / 路由 / 语言 / 主题同步。

  | `AppMountEnv` 字段 | 用途 |
  | --- | --- |
  | `appId` | 插件 id（= 应用 id） |
  | `invoke(command, args)` | 宿主面命令（无附加凭证，如 `get_app_settings`） |
  | `appInvoke(command, ...args)` | 插件面命令（`plugin_invoke`，本 app 通道令牌已绑定） |
  | `appStorageGet / Set / Delete` | 本 app 插件 KV 存储（凭证已绑定） |
  | `locale` / `theme` / `platform` | 挂载时快照；变更经 handle 通知 |
  | `initialRoute` | 宿主路由传入的初始路径（应用以内存路由消化） |
  | `onEvent?` | 宿主面事件出口：`navigate`（请求壳跳转）/ `route`（应用自报内部当前页） |

  `AppMountHandle`：`unmount()` 必选；`setRoute?` / `setLocale?` / `setTheme?` 可选。

- **`src/appContext.ts`**：把 `AppMountEnv` 适配成 `PluginContext` 形状，`entry.ts` 里 `app.provide('pluginContext', createAppContext(env))`；页面沿用 `inject('pluginContext')` 取数（旧调用点零改写）。命令 / 存储 / 令牌全部由宿主经 env 注入——**应用前端不自己拼 `plugin_invoke` 通道、不碰令牌**。
- **`src/index.ts`**（若存在）：仅 dev-shell 兼容出口（导出 `devMock` 领域种子数据），主宿主不加载它；不要往里加业务逻辑。
- **禁止复活旧形态**：`activate(context)` + 贡献面（`registerSidebarPanel` 等）、`window.__WASMNEST_SHARED__` 外部化、宿主共享实例复用——桌面边界锁会直接测红，且新形态自带全部依赖（vue / router / pinia / i18n / tailwind 编译产物）。
- **vite**：`build.lib` 单文件 `dist/index.js`（`formats: ['es']`、`inlineDynamicImports`），CSS inline（`vite-plugin-css-injected-by-js` 或等价插件），**无 externals**。各 app 自持 tailwind 配置，类名自编译（宿主的 Tailwind content 不再扫 app）。
- **`scripts/build.js`**：`vite build → cargo build → 复制 index.js / plugin.json / icon.svg / <rustLibrary>.wasm 到平台宿主 resources → injectWasmHash`；`--watch`（dev 用）、`--frontend-only` / `--rust-only` 分段；`WASMNEST_PLUGIN_DEBUG=1` 出 debug wasm（保留 DWARF）。
- **UI 迭代路径**：桌面 SDK 的 `dev-shell` / `create` 模板**尚未跟进挂载包形态**（仍按旧 `activate` + 贡献面协议读 `src/index.ts`）——不要以 SDK README / 模板为准写新代码，以本仓现有 app 为形态基准。日常迭代走真实宿主（平台仓 `pnpm run tauri:dev`，自动补建 wasm / 重建陈旧挂载包 / 起 watch）+ 组件级 vitest；`bedcode` 前端最重，dev 期不参与 watch，改了它的 UI 单独重建（见平台仓 `wasmnest-desktop/scripts/dev-run.js` 注释）。
- **宿主路由表**：平台仓 `wasmnest-desktop/src/shell/useShellApps.ts` 的 `SURFACE_ROUTES` + 路由前缀集是「应用 → 宿主路径」真源；新增桌面应用必须同步平台仓（§5「新增应用」）。

### 3.2 移动端：宿主壳运行面

- 入口 `src/index.ts` 导出 `activate(context: PluginContext)` / `deactivate()`：注册 i18n（`context.i18n.registerMessages`，自动加插件前缀）、注入插件样式（`import styles from './styles.css?inline'` + 一次性插 `<style>`，宿主不加载插件 CSS）、`context.ui.registerSurface({ component })` 注册壳运行面（`/mobile/shell` 应用屏，appId 宿主代填）。
- 移动端贡献面已收拢为**单一运行面** `registerSurface`（部分应用另有 `registerSlot` / `registerCapsuleItem` / `registerSettingsEntry` / `registerRoute`）；已退役方法调用即显性报错（fail-visible）。类型与语义真源 = 平台仓 `wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`（`UIRegistry`），宿主注册表在 `wasmnest-mobile/src/shell/registry.ts`。
- **vite**：经 SDK `wasmnestPlugin()`——共享模块 `vue` / `vue-i18n` / `pinia` 外置为宿主全局 `window.__WASMNEST_SHARED__`（**移动端仍是外置形态，与桌面挂载包不同**）。产物入口 `src/index.ts`、`main` 指向 `index.js`。
- **浏览器 dev-shell 可用**：`pnpm run dev`（SDK CLI，HMR）；`devMock` 出口提供领域种子数据（真实宿主忽略）。**具体业务 mock / 种子数据归各 app 工程**，不要写进 SDK dev-shell。
- **Rust 两种形态**：自有 `rust/`（ai-chatbox / bedcode）；或 `package.json` 的 `wasmnest.sharedRustManifest` 指向桌面共享 crate（file-transfer 双端单产物：CLI 只做前端 / 清单 / 图标，wasm 由平台包装脚本复制）。
- **清单扩展**：移动端可声明 `preauthDirs`（预授权目录，支持 `${downloads}` 等占位）/ `preauthUrls`（预授权出站 URL 白名单），宿主在 preauthorize 阶段收齐后一次弹窗；这两个键桌面上无效。

### 3.3 Rust 后端

- **crate**：`rust/Cargo.toml`，`[lib] crate-type = ["cdylib"]`，feature `wasm`（构建目标）+ `default`/`native`（跑测试）。包名（`rustLibrary`）与 `plugin.json` 一致；SDK 依赖：
  - 桌面：`wasmnest-plugin-api = { path = "../…/wasmnest-desktop/packages/plugin-sdk-desktop/rust", features = ["wasm"] }`
  - 移动：`wasmnest-plugin-api-mobile = { path = "../…/wasmnest-mobile/packages/plugin-sdk-mobile/rust", features = ["wasm"] }`
- **实现面**：`WasmPlugin` trait + `wasm_entry!`；命令经 `#[plugin_api]` 暴露，`plugin.json.contributes.commands` / `api` 声明同步（manifest-gen 可按源码自动补命令面）。跨插件互调经 `host-api-call` + JSON-RPC 2.0，**未在 `api` 声明不可调**（如 bedcode 声明 `com.wasmnest.terminal-session.*` 供其他应用组合）。
- **构建目标（两类，别混）**：
  - **一般桌面应用**：`wasm32-wasip3`（cdylib 直出 Component），pinned nightly 由 `scripts/plugin-wasm-config.mjs` 指定（单一事实源对齐平台 `scripts/wasip3-toolchain.sh`）。
  - **移动端 + 双端共享业务核应用（file-transfer）**：`wasm32-unknown-unknown` + 平台组件化工具 `../wasmnest/tools/componentize`（SDK CLI / 平台脚本负责调用）。
- **测试**：`cargo test --manifest-path rust/Cargo.toml`（native；bedcode 另有 `pnpm run test:rust`）；共享纯逻辑核（`apps/file-transfer/rust`）在自身 crate 根测，不依赖 SDK。
- **日志与错误**：日志经 SDK `HostLog`（target / 前缀由宿主机制统一）；跨边界失败走错误信封（`bail_with_code(code, params)`，ADR 0030），**code 即前端 i18n key**，技术细节（错误原文 / 堆栈）不出产生方，UI 不显示错误码；权限请求用 SDK 原语，不要在应用里自建安全机制。

---

## 4. 命令

> **包管理器一律 pnpm（禁止 npm）**；各 app 目录独立 `pnpm install`。**禁止 `pnpm run test`**（vitest watch 不退出）——一律 `test:run`。

### 本仓（应用仓根）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装根依赖（eslint / prettier / husky）；各 app 依赖仍需进各自目录装 |
| `pnpm run test:run` | 逐 app 串行跑 `test:run`（`scripts/run-apps.mjs`；缺脚本打印 skip） |
| `pnpm run build` | 逐 app 串行跑 `build` |
| `pnpm run lint` | 根 eslint（0 error 口径；warning 不阻断） |
| `pnpm run format` | prettier 写 `apps/**/src/**` |

### 单个 app（`apps/<slug>/<end>/` 内）

| 命令 | 说明 |
| --- | --- |
| `pnpm run test:run` | 该 app 的 vitest（组件 / 逻辑契约） |
| `pnpm run build` | 桌面 = `node scripts/build.js`（前端 + wasm + 复制平台宿主 resources + wasmHash）；移动 = SDK CLI / 平台包装脚本 |
| `pnpm run build:frontend` / `build:rust` | 桌面分段构建（按需） |
| `pnpm run dev` | 桌面 = `build.js --watch`；移动 = SDK dev-shell（HMR） |
| `cargo test --manifest-path rust/Cargo.toml` | 该 app 的 Rust 单测（native） |

> 桌面 app 的 `build` 直接把产物写平台宿主 resources；移动 app 的 `build`（SDK CLI）默认只产出自身 `dist/`，**写进宿主 resources 以平台仓移动构建为准**（`wasmnest-mobile/scripts/plugin-build.js`，file-transfer 的包装脚本已内含）。

### 平台仓（跨仓操作；命令在平台仓执行）

| 命令 | 说明 |
| --- | --- |
| `pnpm run tauri:dev`（在 `wasmnest-desktop/`） | 桌面宿主 dev：自动补建缺失 / 陈旧 wasm、重建陈旧挂载包、起插件 watch |
| `pnpm run plugins:build`（在 `wasmnest-desktop/`） | 桌面全量应用构建（经 `app-script.mjs` 调本仓各 app `build`；`PLUGINS` 注册表） |
| `node scripts/app-script.mjs <slug> desktop <script>` | 平台侧转发单 app 脚本（如 `build:frontend`） |
| `pnpm run plugins:build` / `pnpm run tauri:android:dev`（在 `wasmnest-mobile/`） | 移动端构建（扫描 `apps/*/mobile`）/ Android dev（含插件 watch） |
| `pnpm run check:manifest` | `release-manifest.json` 一致性：apps tag + 各端 `<rustLibrary>.wasm` 覆盖 |
| `pnpm run check:wit` | WIT 拼装漂移锁（仅改了契约真源后需要） |

### 仓级工具（应用仓根）

| 命令 | 说明 |
| --- | --- |
| `node scripts/package-plugins.mjs --list` | 打印解析后的插件清单（不构建不打包） |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>] [--only/--exclude]` | 构建并收集产物、按插件打 zip（发布 / 单插件调试） |
| `node scripts/replace-console.mjs <desktop\|mobile> [appDirName]` | `console.*` → 统一 `logger` 的机械化替换（仅处理自带 `src/utils/frontendLogger.ts` 的 app） |

**构建环境约定**：`.cargo/config.toml` 强制 `rustc-wrapper = "sccache"`（未装则 cargo 直接失败，这是显性设计，不要绕过）；全仓共享 `target/wasm-apps`（不要用 `cargo clean` 清平台仓目录）；`jobs = 4` 可按需用 `CARGO_BUILD_JOBS` 覆盖（内存吃紧时调小）；`Cargo.lock` / `pnpm-lock.yaml` **只经包管理器变更，禁止手编**。

---

## 5. 任务路由：改 X 先读 Y

| 任务 | 动手前必读 |
| --- | --- |
| 改桌面应用界面 / 交互 | §3.1 挂载契约 + 该 app `entry.ts` / `appContext.ts` + 平台 `useAppMount.ts`；跑该 app vitest + 真实宿主目验 |
| 改移动应用界面 / 运行面 | §3.2 + 平台 `plugin-sdk-mobile/src/types.ts`（`UIRegistry`）+ 移动壳 `registry.ts`；优先 dev-shell 预览 |
| 改 manifest / 权限 | `plugin.json` 现状 + 平台 SDK 权限词汇真源 `plugin-sdk-desktop/rust/src/permission.rs`（生成物 `bin/permission-vocabulary.json` / `src/plugin/permission-vocabulary.ts`）——**不得自造词汇表外的权限字符串**；构建链映射表在 `bin/manifest-gen.js` |
| 改 Rust 后端 / 新增命令 | 该 app `rust/` + SDK rust crate 的 API / 类型 + §3.3；命令面与 `plugin.json` 同步 |
| 改 WIT / ABI / 契约 | **不在本仓改**：去能力仓（WIT 真源）与平台仓（端组合 / SDK 生成物）；改完重拼并重建本仓相关 app 产物（版本进入 import 名，旧产物实例化期被点名，须按当前 SDK 全量重建） |
| 新增桌面应用 | 复制现有桌面 app 骨架（改 §1 五处命名）→ 平台仓：`useShellApps.ts` 路由表 + `hostAppBoundaryLock.test.ts` 清单 + `wasmnest-desktop/scripts/plugin-build.js` 的 `PLUGINS` + `scripts/dev-run.js` 的 `PLUGIN_WATCH_CMDS` + `release-manifest.json` |
| 新增移动应用 | 复制现有移动 app 骨架；平台移动构建脚本自动扫描 `apps/*/mobile`（无需改宿主注册表）→ 更新 `release-manifest.json` |
| 跨应用互调 | 平台 `host-api-call` 机制 + 被调方 `plugin.json.api` 声明 + `#[plugin_api]`（ADR 0017）；**禁止跨应用直接耦合源码** |
| 发布 / 版本 | §2.3 `release-manifest.json` + 三仓 tag；打包用 `scripts/package-plugins.mjs` |
| 排查「改了没生效」/ 产物路径 | 平台 `scripts/app-paths.mjs`、`wasmnest-desktop/scripts/{dev-run.js,plugin-watch.js}`；确认产物是否真的写进了平台宿主 resources |

---

## 6. 硬约束

### 6.1 清单（manifest）

- `plugin.json` 必填字段：`name` / `version` / `platform` / `main` / `pluginType` / `permissions` / `contributes`（校验真源 = SDK `bin/manifest-validate.js`；宿主反序列化无缺省，缺失即拒装）。
- `platform` 按工程所在端取 `desktop` / `mobile`；仅真正的双端单产物工程（file-transfer）写 `both`。写错会被两端宿主在扫描与 zip 安装两条入口 fail-visible 拒绝。
- `pluginType`：桌面内置应用用 `rust-ts`（必须给 `rustLibrary`，与 Cargo 包名一致）；移动应用用 `wasm`。
- `contributes` / `permissions` 支持按源码自动填充：桌面构建链 `bin/manifest-gen.js`、移动 SDK `manifest` 命令。**自动填充是便利不是真源**，声明仍须与实际调用一致；改动后跑一次 `manifest --check`（或构建）确认无漂移。
- `wasmHash`（产物摘要）由构建链注入**产物目录**的 `plugin.json`（`bin/wasm-hash.js` 按 `<rustLibrary>.wasm` 现算 SHA-256）；**源清单不写该键**，手写会被 `manifest-validate` 告警且发布打包复核不一致即失败。

### 6.2 权限

- **无默认授予**：权限位必须在 `plugin.json.permissions` 显式声明（`storage` 也一样），未声明即被拒。
- 权限词汇唯一真源 = 平台 SDK `permission.rs`；`manifest-gen` 的映射表（`RUST_PERMISSION_RULES` / `FRONTEND_PERMISSION_RULES`）是消费方——词汇表没有的位，加载即抛错。
- 高风险面按域拆分（如 `pty:spawn` / `pty:io`、`ws:client` / `ws:server`、`task:run`），需要多少声明多少；文件系统走宿主授权链（预授权目录 → 已授权前缀 → 弹窗），**不要试图绕过**。

### 6.3 i18n

- 每个 app **自足** i18n（`src/i18n/{index,zh-CN,en}.ts` 或同类）；桌面挂载包不依赖宿主实例，语言由 `env.locale` / `setLocale` 传入。
- 新增 / 修改文案**必须 zh-CN 与 en 同步**；用户可见文案禁止硬编码。
- **`apps/bedcode/desktop/src/i18n/host-{zh-CN,en}.ts` 是宿主消息集的逐字副本**（drift 锁）：改平台宿主 `src/i18n/host-*.ts` 必须同批改本仓副本，反之亦然。

### 6.4 前端红线（静态锁见 `eslint.config.js`）

- 前端只做 UI：**禁止** `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `navigator.sendBeacon`，禁止 `window.open` / `location.href=` 等导航原语，禁止裸 `__TAURI__`，禁止 import `@tauri-apps/plugin-{http,fs,shell,updater,opener}`。
- 一切 HTTP / WS / 文件访问由 Rust 端发起并经权限仲裁：走 `invoke(...)` → 宿主命令，或 `env.appInvoke(...)` → 插件命令面。允许 `convertFileSrc`（既定产物 / 图标加载路径）与 `invoke` / `listen`。
- 确需豁免时在违规行写 `eslint-disable-next-line` 并注明理由（豁免在 code review 可见，不静默放行）。

### 6.5 安全

- 禁止提交密钥 / 凭据 / token；禁止进日志、进文档；凭据只记长度不落明文。
- 不新增旁路认证 / 静默降级；失败一律 fail-closed 或 fail-visible。
- 应用自己的业务真源（私有库 / KV / 登记表）由应用自持；不推给宿主内核（宿主加业务状态即越线）。

### 6.6 测试

- 每 app 至少覆盖：契约（`mountApp` / `activate` 行为）、关键逻辑（纯函数 / composable）、边界与错误路径。**禁止**无断言 / 恒真断言 / 只测 mock / 快照替代行为断言。
- 运行位置：app 目录 `pnpm run test:run`（vitest，happy-dom）；Rust 侧 `cargo test --manifest-path rust/Cargo.toml`。跨端真实互连测试在 `../wasmnest-test/cross-end-tests`（本仓改动涉及传输 / 认证面时去那边跑）。
- 测试夹具构造 SDK 结构体时只列本用例断言字段 + `..Default::default()`——逐字段列全会把 SDK 追加可选字段变成批红。

### 6.7 注释、命名与提交

- 注释解释**为什么**，中文（技术术语保留英文）；禁止用 spec / 票号引用替代自解释；改代码必须同步修正相关注释（含路径 / 符号名 / 计数声明）。
- 组件 PascalCase、composable `use` 前缀 camelCase、文件名与导出一致。
- Commit：conventional commits `<type>(<scope>): <subject>`；**禁止 AI 协作者标记**（Co-Authored-By 等）；分支 / 推送遵循各仓现有口径，**禁止 `--force` 覆盖远端**；开工先 `git status`，非本任务的在途改动一律不碰。
- 只提交源码：`node_modules/`、`dist/`、`target/`、`resources` 产物一律不入库（`.gitignore` 已覆盖）。

---

## 7. 完成定义与验证

**本仓当前无 CI**（CI 重建票明确不做）；验证 = 本地命令实跑 + 平台仓侧锁。**当前迁移期口径（用户 2026-10-18）**：不逐项跑集成 / 全量回归，收口后统一跑；日常改动至少跑针对性单测与所在 app 测试。以下为收口后的标准清单，按改动类型执行，**必须实际运行并贴出结果**，无法运行要说明原因与风险：

- 改前端（任一 app）→ 该 app `pnpm run test:run` 全绿；应用仓根 `pnpm run lint`（0 error）；UI 改动至少在一个真实环境目验（桌面：平台 `tauri:dev` 打开应用；移动：dev-shell 或 Android dev）。
- 改 Rust 后端 → 该 crate `cargo test` 全绿；确认 `plugin.json` 命令 / 权限与实现一致；构建产物成功写出（`pnpm run build` 或平台 `plugins:build`）。
- 改 manifest / 权限 / 应用清单 → 构建链 `manifest --check` 通过；平台仓 `pnpm run check:manifest` 通过（涉及 id / rustLibrary / 端变化时）。
- 改桌面 `entry.ts` / appContext → 平台仓桌面测试全量（含 `hostAppBoundaryLock` / `i18nDriftLock`）；真实宿主装载目验。
- 改移动运行面 / 壳交互 → 平台仓移动测试全量（含以 `appPath` 读本仓的锁）；Android dev 目验。
- 改共享业务核（`apps/file-transfer/rust`）→ 该 crate `cargo test` + 双端 app 各自构建成功。
- 新增 / 删除应用 → §5 对应跨仓清单逐项核对（平台路由表、边界锁、构建注册表、dev watch、`release-manifest.json`），并在平台仓跑对应测试。

**注意一处已知漂移**：平台仓桌面 SDK 的 `README.md` / `template/` / `dev-shell/` 仍是旧贡献面形态（`activate(context)` + `__WASMNEST_SHARED__` 外置），与 ADR 0057 后的挂载包形态不一致。写新代码以本仓现有 app 为准；该漂移的修复在平台仓侧，本仓不代为修改。

---

## 8. 文档索引

| 需求 | 入口 |
| --- | --- |
| 桌面挂载契约（宿主侧真源） | `../wasmnest/wasmnest-desktop/src/composables/useAppMount.ts`、`src/components/AppMountSlot.vue`、`src/shell/useShellApps.ts`、`src-tauri/src/plugin/assets.rs` |
| 移动运行面契约 | `../wasmnest/wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`（`UIRegistry`）、`../wasmnest/wasmnest-mobile/src/shell/registry.ts` |
| 权限词汇 / manifest 校验 | `../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`、同 SDK `bin/manifest-gen.js` / `bin/manifest-validate.js` / `bin/wasm-hash.js` |
| 跨仓版本 / 发布 | `../wasmnest/release-manifest.json`、`../wasmnest/scripts/check-release-manifest.mjs` |
| 契约包名与版本真源 | `../wasmnest-lib/contracts/wasmnest-plugin-package.rs`、`../wasmnest-lib/wasmnest-wasm-core/wit/core.wit` |
| 跨端互连测试 | `../wasmnest-test/cross-end-tests/` |
| 应用 → 平台路径 / 构建工具 | `scripts/platform-paths.mjs`、`scripts/plugin-wasm-config.mjs`、`../wasmnest/wasmnest-desktop/scripts/{dev-run.js,plugin-watch.js,plugin-build.js}`、`../wasmnest/wasmnest-mobile/scripts/plugin-build.js` |

> 本文件的机制描述若与上述真源冲突，以真源 + 平台仓锁为准，并回来修正本文件。
