# WasmNest Desktop wasm 应用开发指南

> 迁自冻结旧仓 BedCode（2026-10-24），2026-11-11 按三仓现行代码核对更新。
> 桌面现行形态为**挂载包**（`src/entry.ts` 导出 `mountApp(root, env)`，自足打包，
> 机制 B / ADR 0057，见平台仓 `docs/contracts.md` §5.2）；SDK 仍保留旧贡献面形态
> （`activate(context)` + `registerSidebarPanel` 等注册面，模板 `create` 默认生成此形态），
> 本文 §3 / §9 以「现行 / 旧形态」分节标注，避免混用。

本文档说明如何为 WasmNest Desktop 开发 **wasm 应用**（工程目录住应用仓
`../wasmnest-apps/apps/<slug>/desktop/`），
以及如何使用浏览器开发环境（Dev Shell）快速迭代应用前端。
开发工具包为 `@binblink/wasmnest-plugin-sdk-desktop`（SDK），命令行为 `wasmnest-plugin-desktop`。

> **术语**：机制内核与运行时仍把加载单元称为「插件」（`plugin.json`、`PluginManager`、
> `host-*` 原语等标识符不变）；应用仓对**业务型 wasm 应用**统一用 wasm-app 一词。
> 代码标识符、清单字段、WIT 契约保持原样，只有文档与工程目录命名改口。

---

## 1. 整体架构

```
┌──────────────────────────── 应用工程（开发期）────────────────────────────┐
│  src/entry.ts (挂载包入口，导出 mountApp) + rust/src/lib.rs (WASM 后端，   │
│  可选) + plugin.json                                                       │
└───────────────┬──────────────────────────────────────┬────────────────────┘
                │ vite build                            │ cargo build (wasm32)
                ▼                                       ▼
           dist/index.js                          {rustLibrary}.wasm
                └──────────────┬───────────────────────┘
                               ▼
                   插件目录（宿主 resources/plugins/desktop/{id}/ 或安装目录）
```

桌面端产物形态（`plugin.json` 的 `pluginType`，语言无关三档，2026-10-26 重定义，
词汇真源 `packages/plugin-sdk-desktop/rust/src/types/state.rs::PluginType`）：
`frontend`（纯前端）、`backend`（纯后端 worker）、`full`（前端 + wasm 后端——Rust 或 Go，
内置 wasm 应用一律用它）。旧值 `ts-only` / `rust-ts` / `rust` 已退役（宿主按别名接受旧值
只告警不拦）。`plugin.json` 声明权限与扩展点（permissions / contributes）。

**前端形态两代**：

- **挂载包（现行）**：应用自带 vue / pinia / vue-router / vue-i18n / vue-sonner / xterm
  全部依赖（**不**外部化到 `__WASMNEST_SHARED__`），`mountApp(root, env)` 在应用自己的
  Vue 实例上渲染独立界面；宿主经 `unmount` / `setRoute` / `setLocale` 同步卸载与路由、
  语言。契约与宿主 `src/composables/useAppMount.ts` 逐字同形（drift 锁钉住）。
  现行应用（bedcode / ai-chatbox / lanbitou / file-transfer）均为此形态。
- **旧贡献面（SDK 仍支持，模板默认生成）**：`activate(context: PluginContext)` +
  `registerSidebarPanel` 等注册面，vue 等外部化到宿主共享运行时。详见
  [`wasm-app-dev-guide.md`](wasm-app-dev-guide.md) §6–§9（该部分 API 面仍有效，
  但现行应用不使用）。

**关键概念**：

- **扩展点**：`views`（sidebar / toolbox / statusbar）、`terminal`、`fileHandlers`、
  `commands`、`configuration`、`lifecycle`、`provides` / `subscribes`（总线订阅）、
  `wsEndpoints`（WS 端点声明）。旧形态另有 `toolProviders` / `httpEndpoints`
  （ABI v29 退役：HTTP 路由改由插件代码运行时经 `host-http.register-endpoint` 注册）
- **PluginContext**：旧贡献面形态下插件访问宿主能力的唯一通道（commands / terminal /
  session / ui / events / storage / http / i18n / appUpdate）
- **共享运行时**：旧形态经 `getVue()` / `getI18n()` 等复用宿主实例（SDK 构建时由
  vite 插件外部化）；挂载包形态不依赖它

内置 wasm 应用（住应用仓 `../wasmnest-apps/`）：

| 工程 | 端 | 插件 id | 说明 |
|---|---|---|---|
| `apps/bedcode` | desktop + mobile | `com.wasmnest.bedcode` | 会话中心：配对信任 / 会话编排 / 任务队列 |
| `apps/ai-chatbox` | desktop + mobile | `com.wasmnest.ai-chatbox` | AI 面板 |
| `apps/file-transfer` | desktop + mobile | `com.wasmnest.file-transfer` | 局域网文件传输（双端单产物） |
| `apps/lanbitou` | desktop | `com.wasmnest.lanbitou` | 轻量 Markdown 记事本 |
| `servers/auth-center` | desktop | `com.wasmnest.auth-center` | 认证中心（L2 裁决依赖方） |
| `servers/net-config` | desktop | `com.wasmnest.net-config` | 网络配置（L2） |
| `servers/monitor` | desktop + mobile | `com.wasmnest.monitor` | 运行指标（L2） |

## 2. 创建插件工程

开发工具包为 `@binblink/wasmnest-plugin-sdk-desktop`，命令行为 `wasmnest-plugin-desktop`。

```bash
wasmnest-plugin-desktop create com.example.my-plugin "My Plugin" --author "you"
cd my-plugin
pnpm install
```

- 默认生成**纯前端**（`pluginType: frontend`）插件；`--rust` 附带 WASM 后端脚手架（`pluginType: full`；形态三档 frontend / backend / full，语言无关，2026-10-26 重定义——旧值 rust / rust-ts / ts-only 已退役）
- `create` 从 SDK 内置模板生成：`plugin.json` / `vite.config.ts`（vue 等外部化到宿主）/ `src/index.ts` / 可选 `rust/`（WasmPlugin 实现 + `wasm_entry!`）；`--dir <dir>` 指定生成目录，`--registry` 改为引用已发布 SDK 版本（npm + crates.io，默认引用本地 SDK 相对路径）
- **注意**：模板当前仍生成**旧贡献面形态**（`activate(context)` + 侧边栏面板注册）；
  现行应用的挂载包形态（`src/entry.ts` + `mountApp`）请参照
  `../wasmnest-apps/apps/file-transfer/desktop/` 或平台仓 `docs/contracts.md` §5.2
  （模板更新是平台侧立项项，见应用仓 scratchpad 2026-10-18 记录）

构建与分发：

```bash
pnpm run build    # = wasmnest-plugin-desktop build：vite（+ full 形态时 cargo wasm32）
pnpm run build -- --resources-dir <宿主resources/plugins父目录>   # 复制产物到宿主（内置插件分发方式）
pnpm run build -- --frontend-only / --rust-only   # 只构建一半（full 形态插件）
```

## 3. 前端入口

### 3.1 挂载包入口（现行）

`src/entry.ts` 导出挂载契约（与宿主 `useAppMount` 同形）：

```ts
export function mountApp(root: HTMLElement, env: AppMountEnv): { unmount: () => void }
// 可选：export function mountPreview(root: HTMLElement, env: AppMountEnv): ...
```

应用自足打包（vue / pinia / router / i18n 全部内联，不用 `wasmnestPlugin()` 外部化），
`vite.config.ts` 的 `outDir` 指向 `dist`（产物由构建链复制到宿主资源目录或打包 zip）。

### 3.2 旧贡献面（SDK 仍支持，模板默认形态）

`activate(context: PluginContext)` 提供（完整方法参考见
[`wasm-app-dev-guide.md`](wasm-app-dev-guide.md) §8）：

| 子 API | 说明 |
|---|---|
| `context.ui` | 注册侧边栏面板 / 工具箱页 / 状态栏项 / 输入扩展 / 终端工具栏项 / 标题栏项 / 页面工具栏项 / 文件处理器 / 设置区 |
| `context.commands` | 调用宿主命令（前端 handler 优先，未注册时回退 Rust 后端） |
| `context.events` | 事件订阅与发射 |
| `context.storage` | 插件键值存储（宿主 SQLite，dev-shell 中为 localStorage） |
| `context.http` | 注册 HTTP 端点（宿主 Rust 服务端挂载，插件经 `/api/plugin/{pluginId}/...` 访问） |
| `context.terminal` / `context.session` | 终端输入输出 / 会话能力 |
| `context.i18n` | `getI18n()` 取宿主 i18n 实例；`registerMessages` / `t` 自动加插件 ID 前缀 |
| `context.appUpdate?` | 应用更新检查（可选） |

> `context.fileService`（文件服务挂载）与 `context.system.revealInDir` 已随 SDK 收敛移除
> （现行文件访问走 `host-fs` 授权机制，声明 `fs:read` / `fs:write`；系统选择器走
> `fs:pick` 权限位）。

## 4. 浏览器开发环境（Dev Shell）

SDK 内置空壳宿主（`dev-shell/`）：**加载应用的挂载包入口源码**（与桌面宿主同一条
装载路径——app 的 `src/entry.ts` 导出 `mountApp(root, env)`，dev-shell 挂载槽按同一份
契约调用），支持 HMR，无需构建、打包、安装。2026-10-21 按桌面宿主前端重写（此前为
旧贡献面形态，现行 app 预览不了）。

```bash
pnpm exec wasmnest-plugin-desktop dev            # 在当前应用工程目录启动（Windows 必需 pnpm exec）
pnpm exec wasmnest-plugin-desktop dev ../my-app --port 5173 --open
pnpm exec wasmnest-plugin-desktop dev --entry src/custom-entry.ts
pnpm exec wasmnest-plugin-desktop dev --host     # 监听局域网（平板/其他设备浏览器访问）
```

| 参数 | 说明 |
|---|---|
| `[pluginDir]` | 应用工程目录，默认当前目录（须含 `plugin.json` 或入口文件） |
| `--entry <file>` | 应用入口文件，默认 `src/entry.ts`（无则回落 `src/index.ts`） |
| `--port <port>` | dev server 端口，默认 **5173** |
| `--host [addr]` | 监听局域网（默认 `0.0.0.0`），访问 `http://<电脑IP>:<port>/` |
| `--open` | 启动后自动打开浏览器 |

浏览器打开 `http://localhost:5173`（`--open` 自动打开）。首次运行自动安装 dev-shell
自身依赖（vue / vite / tailwind 等，仅一次）；未构建 SDK 时先在 SDK 目录
`pnpm install && pnpm run build`（报找不到模块多半是这一步没做）。

> **Windows 注意**：直接在 cmd / PowerShell 输入 `wasmnest-plugin-desktop` 会提示
> 「不是内部或外部命令」——Windows 不自动把 `node_modules/.bin` 加入 PATH。
> 请用 `pnpm run dev`（模板与内置插件已内置该脚本）或 `pnpm exec wasmnest-plugin-desktop dev`。

**Mock 边界**：dev-shell 只跑前端挂载包源码；Rust 后端（WASM）不在浏览器运行，
真实 HTTP 端点 / 系统文件选择等需在真实宿主验证。

详见 `packages/plugin-sdk-desktop/dev-shell/README.md`。

## 5. CLI 其他命令

| 命令 | 说明 |
|---|---|
| `wasmnest-plugin-desktop manifest [--check]` | 按源码自动填充 plugin.json 的 contributes/permissions；`--check` 只检查（CI） |
| `wasmnest-plugin-desktop validate [--dir]` | 校验 plugin.json（id 格式、必填字段、platform/pluginType、权限白名单、产物存在性） |
| `wasmnest-plugin-desktop doctor` | 环境自检：Node ≥ 20 / Rust / wasm32 target / dev-shell 依赖 / SDK 构建产物 |
| `wasmnest-plugin-desktop --version` / `-v` | 打印 SDK 版本 |
| `wasmnest-plugin-desktop --help` | 打印用法 |

## 6. 验证清单

1. 应用在宿主侧边栏/工具箱出现，状态「已激活」
2. 挂载包界面正确渲染（dev-shell 先验，再真宿主验）
3. i18n：中英文切换文案更新（应用自持 i18n 实例）
4. WASM 后端命令：真宿主验证（dev-shell 不跑 Rust 后端）
5. 停用/激活：unmount 清理、重新 activate 正常

## 7. 相关代码入口

| 模块 | 位置 |
|---|---|
| SDK 命令行 | `wasmnest-desktop/packages/plugin-sdk-desktop/bin/cli.js` |
| SDK 模板 | `wasmnest-desktop/packages/plugin-sdk-desktop/template/`（旧贡献面形态，见 §2 注意） |
| SDK 浏览器开发环境 | `wasmnest-desktop/packages/plugin-sdk-desktop/dev-shell/`（挂载包形态） |
| 插件宿主（Rust） | `wasmnest-desktop/src-tauri/src/plugin/`（端差异域的 WIT 绑定 + Host impl：api_call / app / assets / auth / bindings / clipboard / connection / crypto / fs / guest_events / host_facts / http / install_picker / lifecycle / mdns / notify / peer / platform_picker / platform / process / pty / services / task / timer / tunnel / ws；机制整核在 `../wasmnest-lib/wasmnest-wasm-core`） |
| 前端插件运行时 | 旧仓 `src/plugin/`（context / registry / loader / contributionKinds 等贡献面）——已随桌面挂载包形态退役，宿主壳经 `src/shell/` 运行时装载（见头部说明） |
| 内置 wasm 应用 | 应用仓 `../wasmnest-apps/apps/{ai-chatbox,bedcode,file-transfer,lanbitou}` + `servers/{auth-center,net-config,monitor}`（见 §1 表） |
| 机制整核与能力域 crate | 能力仓 `../wasmnest-lib/wasmnest-wasm-core`（机制内核）与 `../wasmnest-lib/wasmnest-*`（能力域 / 传输面 / 引擎） |
| WIT 契约真源 | `../wasmnest-lib/wasmnest-wasm-core/wit/core.wit`（10 import + 3 必选导出；events-binary / events-worker 为可选导出面）+ 能力域 `../wasmnest-lib/wasmnest-*/wit/<domain>.wit` + 端 `rust/wit-src/cap-*.wit`；端 `rust/wit/` 是生成物（`world plugin` 只 `include` 各包），改契约跑 `pnpm run check:wit`（平台仓根 `node scripts/compose-wit.mjs --all --check`） |
| 开发约束清单 | [`wasm-app-development-checklist.md`](wasm-app-development-checklist.md)（API / 权限 / 存储 / 事件 / 认证中心等红线） |
| API 参考（长篇） | [`wasm-app-dev-guide.md`](wasm-app-dev-guide.md) |
