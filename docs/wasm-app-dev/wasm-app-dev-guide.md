# WasmNest wasm 应用开发指南（桌面端 API 参考）

> 迁自冻结旧仓 BedCode（2026-10-24），2026-11-11 按三仓现行代码核对更新。
> **形态说明**：桌面现行形态为**挂载包**（`src/entry.ts` 导出 `mountApp(root, env)`，
> 自足打包，机制 B / ADR 0057，见平台仓 `docs/contracts.md` §5.2）；本文档 §6–§9 的
> `activate(context)` + `registerSidebarPanel` 等贡献面为**旧形态**——SDK 仍支持、
> 模板 `create` 默认生成此形态，但现行应用（bedcode / ai-chatbox / lanbitou /
> file-transfer）均不使用。新应用请以 [`wasm-app-dev-desktop.md`](wasm-app-dev-desktop.md)
> §3.1 的挂载包入口为准。

本文档面向第三方开发者，介绍如何为 WasmNest 桌面端开发 wasm 应用（工程目录住应用仓
`../wasmnest-apps/apps/<slug>/desktop/`）——侧重 **plugin.json 字段、PluginContext API 与扩展点的完整参考**。

> **先读这两个**：
> - [`wasm-app-dev-desktop.md`](wasm-app-dev-desktop.md) —— 从零创建、构建、验证的
>   主流程与 Dev Shell 用法（**首选入口**）
> - [`wasm-app-development-checklist.md`](wasm-app-development-checklist.md)
>   —— 权限 / 存储 / 事件 / 认证中心 / HTTP 面等红线（与 AGENTS.md 同级）
>
> 术语：机制内核与运行时仍把加载单元称为「插件」（`plugin.json`、`PluginManager`、
> `host-*` 原语等标识符不变）；本仓对**业务型 wasm 应用**统一用 wasm-app 一词。

---

## 目录

1. [插件架构概览](#1-插件架构概览)
2. [插件类型](#2-插件类型)
3. [插件目录结构](#3-插件目录结构)
4. [plugin.json 清单文件](#4-pluginjson-清单文件)
5. [权限系统](#5-权限系统)
6. [TS-only 插件开发](#6-ts-only-插件开发)
7. [Rust+TS 插件开发（WASM）](#7-rustts-插件开发wasm)
8. [PluginContext API 参考](#8-plugincontext-api-参考)
9. [扩展点详解](#9-扩展点详解)
10. [配置系统](#10-配置系统)
11. [测试与调试](#11-测试与调试)
12. [构建与打包](#12-构建与打包)
13. [常见问题](#13-常见问题)

---

## 1. 插件架构概览

WasmNest 插件系统采用 **Rust + TypeScript 双层架构**：

- **Rust 层**：处理计算密集型任务、系统 API 访问、数据库操作、网络请求等
- **TypeScript 层**：负责 UI 组件渲染、用户交互、事件响应

两层通过 `PluginContext` API 和 Tauri 事件系统通信：

```
┌─────────────────────────────────────────┐
│            WasmNest 宿主应用               │
│  ┌─────────────┐   ┌─────────────────┐  │
│  │ PluginHost   │   │ PluginLoader    │  │
│  │ (Rust 生命周期)│   │ (TS 动态导入)   │  │
│  └──────┬───────┘   └────────┬────────┘  │
│         │                    │            │
│  ┌──────┴────────────────────┴────────┐  │
│  │         PluginContext              │  │
│  │  commands / terminal / session /   │  │
│  │  storage / events / ui / http      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 插件生命周期

```
扫描 plugin.json → 加载(Loaded) → 激活(Activated) → 停用(Deactivated)
                                        ↕
                                    错误(Error)
```

- **Loaded**：manifest 解析完成，权限已授予，但尚未执行初始化逻辑
- **Activated**：插件 activate() 调用成功，可正常使用所有 API
- **Deactivated**：插件 deactivate() 调用后，权限收回，注册表清理
- **Error**：激活失败或运行时异常，可重新激活

---

## 2. 插件类型

产物形态（`pluginType`，语言无关三档，2026-10-26 重定义；真源
`packages/plugin-sdk-desktop/rust/src/types/state.rs::PluginType`）：

| 类型 | pluginType | Rust 端 | TS 端 | 适用场景 |
|------|-----------|---------|-------|---------|
| **纯前端** | `frontend` | 无 | 完整 | 纯 UI 扩展、简单工具 |
| **纯后端** | `backend` | WASM 组件（无页面） | 无 | 纯后端处理 / worker |
| **前后端** | `full` | WASM 组件 | 完整 | 需要后端计算/数据库/网络的完整插件（内置应用一律此档） |

> 旧值 `ts-only` / `rust` / `rust-ts` 已退役（宿主按别名接受旧值只告警不拦）。
> 另有 `type` 角色字段（L1 `basic-service` / L2 `internal-business` / L3 `business-app`，
> ADR 0032，见检查清单）与 `lifecycle: ephemeral`（本期只预留类型，声明即双侧拒绝）。

---

## 3. 插件目录结构

### TS-only 插件

```
apps/my-app/desktop/
├── plugin.json           # 清单文件（必需）
├── src/index.ts          # 入口文件（必需，与 plugin.json main 字段对应）
├── components/           # Vue 组件
│   └── MyView.vue
├── composables/          # 业务逻辑
│   └── useMyFeature.ts
├── types.ts              # 类型定义
└── vite.config.ts        # 独立构建配置
```

### Rust+TS 插件

```
apps/my-app/desktop/
├── plugin.json                          # 清单文件
├── index.ts                             # TS 入口（旧形态；现行挂载包为 src/entry.ts）
├── components/                          # Vue 组件
├── composables/                         # 业务逻辑
├── vite.config.ts                       # TS 构建配置
└── rust/                                # Rust 源码目录
    ├── Cargo.toml
    └── src/
        ├── lib.rs                       # WASM 组件入口（WasmPlugin trait 实现）
        └── ...
```

> 现行应用（挂载包形态）的实际目录参照 `../wasmnest-apps/apps/file-transfer/desktop/`：
> 入口 `src/entry.ts`（`mountApp`）、vite `outDir: dist`、vue 等依赖自足打包（不外部化）。

> Rust+TS 插件的 WASM 编译产物（`{rustLibrary}.wasm`）需放在插件目录，文件名与 `plugin.json` 的 `rustLibrary` 字段一致。

### 插件目录约定

- **插件根目录**：应用仓 `apps/<slug>/desktop/`（产物目录形态 `resources/plugins/desktop/{plugin-id}/`）
- **plugin-id 格式**：反向域名，如 `com.example.my-plugin`
- **入口文件**：由 `plugin.json` 的 `main` 字段指定，TS-only 默认为 `index.ts`

---

## 4. plugin.json 清单文件

`plugin.json` 是插件的唯一入口描述，放在插件根目录。

### 完整字段说明

```jsonc
{
  // ==================== 必填字段 ====================
  "id": "com.example.my-plugin",       // 反向域名格式，全局唯一
  "name": "My Plugin",                 // 显示名称
  "version": "1.0.0",                  // 语义化版本号
  "platform": "desktop",               // 适配平台：desktop | mobile | both（按工程所在端；见下）

  // ==================== 可选字段 ====================
  "description": "插件描述文本",         // 插件功能说明
  "author": "Author Name",             // 作者
  "icon": "icon.svg",                  // 列表图标（SVG path 或图标文件路径）
  "main": "index.js",                  // TS 入口文件（编译后），TS-only 必填
  "pluginType": "frontend",           // 产物形态三档：frontend | backend | full（语言无关，wasmnest-apps#21）
  "rustLibrary": "",                   // WASM 库文件名（仅 full 需要，不含 .wasm 后缀）
  "permissions": ["storage", "ui:sidebar"],  // 请求的权限列表（桌面无默认授予，storage 也需显式声明）

  // ==================== 角色与行为（ADR 0032，type 缺省 = L3 business-app） ====================
  "type": "business-app",              // L1 basic-service | L2 internal-business | L3 business-app（缺省）
  "lifecycle": null,                    // 生命周期钩子声明（ephemeral 本期只预留类型，声明即双侧拒绝）
  "update": { "provider": "github-release" },  // 更新通道（内置应用声明）
  "backgroundTransport": true,          // 后台传输（如文件传输类应用）
  "dependencies": ["host-pty"],        // 能力依赖（如 PTY：声明 host-pty 且配 ptyQuota）
  "ptyQuota": 8,                        // PTY 并发条数自我声明（构建期校正整数，加载期 0 或 >64 拒 manifest）
  "api": ["com.example.my-plugin.hello"],  // 对外可调 API（经 #[plugin_api] 宏 + JSON-RPC 2.0；未声明不可调，ADR 0017）

  // ==================== 扩展点声明 ====================
  "contributes": {
    "commands": [],                     // 命令注册
    "views": [],                        // 视图注册
    "terminal": null,                   // 终端扩展
    "fileHandlers": [],                 // 文件处理器
    "configuration": null,              // 配置声明
    "lifecycle": null,                  // 生命周期钩子
    "provides": [],                     // 总线能力提供（激活期订阅，见 host/activation.rs）
    "wsEndpoints": [                    // WS 端点声明（生命周期随激活；见下）
      { "path": "session-control", "auth": "jwt" }
    ]
    // 注意：httpEndpoints（静态声明）与 toolProviders 已随 ABI v29 退役（见下文）
  }
}
```

### sandbox 字段（已退役，勿声明）

`sandbox` 已从 manifest 退役（审计票 06 裁决 2：前端不做隔离，插件代码始终在宿主进程内运行）。
Rust 端 `PluginManifest` 不声明该字段，反序列化会直接丢弃——写进清单无任何效果，请从工程里删掉。
校验器 `manifest-validate.js` 仅为兼容旧产物仍接受 `inline` / `isolated` 两个取值。

### platform 字段（必填）

插件适配平台，三值：`desktop`（仅桌面）/ `mobile`（仅移动）/ `both`（双端适配）。
按工程所在端取对应值（桌面工程写 `desktop`、移动工程写 `mobile`），只有真正的
双端适配工程写 `both`。

宿主在**加载（目录扫描）与 zip 安装**两条入口做端匹配校验：桌面拒 `mobile`、
移动拒 `desktop`，不匹配即显性拒绝装载（错误点名声明值与出路 `both`）——把一端的
分发包装到另一端「装了却不工作」比一次显性拒绝难排查得多。字段缺失或取值不在
词汇内时反序列化即失败（wire 无缺省）；构建链 `manifest-validate.js` 在打包前
先拦拼写错误。

### rustLibrary 字段（仅 rust-ts）

指定 WASM 库文件名（WASM 组件产物），**不含 `.wasm` 后缀**，宿主按 `{rustLibrary}.wasm` 查找。

例如 `rustLibrary: "wasmnest_plugin_ai_chatbox"`，宿主查找 `wasmnest_plugin_ai_chatbox.wasm`。

> **重要**：`rustLibrary` 不得包含路径分隔符（`/` 或 `\`）或父目录引用（`..`），否则加载会被拒绝。

### contributes 字段

#### commands — 命令注册

```json
"commands": [
  { "id": "my-plugin.hello", "title": "Say Hello" },
  { "id": "my-plugin.calc", "title": "Calculate", "icon": "🧮" }
]
```

#### views — 视图注册

```json
"views": [
  {
    "id": "my-plugin.sidebar",
    "type": "sidebar",           // sidebar | toolbox | statusbar
    "title": "My Panel",
    "component": "MyView"        // Vue 组件名（在 index.ts 中注册）
  }
]
```

#### terminal — 终端扩展

```json
"terminal": {
  "inputHandlers": ["on_input"],     // 输入处理器名称
  "outputParsers": []                // 输出解析器名称
}
```

#### toolProviders — 外部工具端点（**已退役**）

ABI v29 起随 http 端点声明面一并退役（声明面从未落地消费实现）。插件对外提供 HTTP 面
改用运行时注册（见下「HTTP 端点」节）。

#### httpEndpoints — 插件 HTTP 端点清单（**已退役，ABI v29**）

ABI v29（HTTP 路由代码注册下沉）：`httpEndpoints` 静态声明面退役——不通过声明配置路由，
插件代码运行时经 `host-http.register-endpoint` / `unregister-endpoint` 注册。宿主不再从
manifest 读路由，`toolProviders` 声明面随同退役（wasm-core `manager/host/register.rs`
「ABI v29」注）。旧「只认声明 / 未声明即 404」口径已失效，本文保留此节仅作历史索引。

#### wsEndpoints — WS 端点声明（现行）

插件实现 WS 服务面时用本字段声明端点，宿主登记为 `/ws/plugin/{plugin-id}/{path}`：

```json
"wsEndpoints": [
  { "path": "session-control", "auth": "jwt" },
  { "path": "terminal", "auth": "jwt" }
]
```

- **生命周期随激活**（与 HTTP 端点 load 期一次性登记不同）：deactivate 回收该插件全部
  WS 端点（`wasmnest_server_websocket::endpoint` 表），激活成功时重登记（
  `register_declared_ws_endpoints`，调用方为激活成功分支）；
- 路径校验与运行时 `ws_register_endpoint` 同口径（非空、不含 `/` 与 `.`、不超长）；
- 认证档位缺省 = `none`（WS 面历史行为）；非法条目 → warn + 跳过（不致命，该端点不可达）。

#### fileHandlers — 文件处理器

```json
"fileHandlers": [
  {
    "id": "my-plugin.json-viewer",
    "extensions": [".json", ".jsonc"],
    "viewer": "JsonViewer",          // Vue 组件名
    "icon": "📄"
  }
]
```

#### configuration — 配置声明

```json
"configuration": {
  "title": "My Plugin Settings",
  "properties": {
    "apiKey": {
      "type": "string",
      "title": "API Key",
      "description": "Your API key for the service",
      "default": ""
    },
    "maxResults": {
      "type": "number",
      "title": "Max Results",
      "default": 10
    },
    "autoRefresh": {
      "type": "boolean",
      "title": "Auto Refresh",
      "default": false
    },
    "theme": {
      "type": "string",
      "title": "Theme",
      "enum": ["light", "dark", "auto"],
      "default": "auto"
    }
  }
}
```

#### lifecycle — 生命周期钩子

```json
"lifecycle": {
  "onStartup": true,
  "onShutdown": true
}
```

TS-only 插件通过监听 `lifecycle:startup` / `lifecycle:shutdown` Tauri 事件接收回调。

---

## 5. 权限系统

插件采用 **双重权限校验**：前端快速失败 + Rust 端最终仲裁。

### 权限列表

**权限词汇双端唯一真源 = 能力仓** `../wasmnest-lib/wasmnest-wasm-core/src/permission.rs`
的 `PERMISSION_VOCABULARY` / `VALID_PERMISSIONS`（2026-10-14 移动权限面收口：双端唯一
真源、机制层零 SDK 依赖；两端 SDK 的 `rust/src/permission.rs` 只是 guest 面拷贝，宿主
权限门读 core 真源）。桌面 SDK 生成物 `bin/permission-vocabulary.json` 由
`pnpm run gen:permissions`（= `cargo run --example gen_permission_vocabulary`）重出，
manifest-gen / manifest-validate / 打包 CLI 为消费方，**禁止手抄**（旧
`src/plugin/permission-vocabulary.ts` 已不存在）。

| 权限 | 前端 context API 方法 | 说明 |
|------|----------------------|------|
| `terminal:input` | `terminal.onInput` | |
| `terminal:output` | `terminal.onOutput` | |
| `session:read` | `session.predictTerminalSize` / `openTerminal` / `closeTerminal` / `isTerminalOpen` | |
| `connection:read` | （WASM-only，读在册连接清单） | |
| `ui:sidebar` | `ui.registerSidebarPanel` / `registerPage` | |
| `ui:toolbox` | `ui.registerToolboxPage` | |
| `ui:statusbar` | `ui.registerStatusBarItem` / `registerTitleBarItem` | |
| `ui:dialog` | `ui.showDialog` | |
| `ui:pageToolbar` | `ui.registerPageToolbarItem` | |
| `ui:settings` | `ui.registerSettingsSection`（组件只渲染卡片正文，标题与外层容器由宿主渲染） | |
| `ui:input` | `ui.registerInputExtension` / `registerTerminalToolbarItem` | |
| `ui:fileHandler` | `ui.registerFileHandler` | |
| `network:http` | `http.registerEndpoint` | |
| `storage` | `storage.get` / `set` / `delete` / `flush` | |
| `fs:read` / `fs:write` | `fs.read` / `fs.write` / `fs.copy` | |
| `fs:pick` | `platform.pickFiles` / `pickFolder` / `pickFolders` | 系统原生选择器（单独声明位，见检查清单） |
| `broadcast` | （WASM-only，消息总线） | |
| `timer:schedule` | `timer.register` | |
| `process:run` | `process.run` / `process.kill` | |
| `app:cli` | `app.cliInstall` / `cliUninstall` | |
| `app:path` | （WASM-only，应用数据目录） | |
| `peer` | `peer.*`（对等网络发现 / 拨号 / 传输 / 共享目录 / 接收策略全套） | |
| `mdns` | `mdns.browse` / `advertise` 及对应 stop | |
| `ws:client` | `ws.connect` / `sendText` / `sendBinary` / `close` / `isConnected` | |
| `ws:server` | `ws.registerEndpoint` / `broadcast*` / `listClients` 等全套 | |
| `auth` | （WASM-only，认证中心） | |
| `pty:spawn` / `pty:io` | `pty.spawn` / `kill`、`pty.write` / `resize` / `ringFetch` / `isRunning` | |
| `task:run` | （WASM-only，并发任务域） | |
| `worker:run` | （WASM-only，host-worker） | |
| `crypto:aead` / `crypto:asym` / `crypto:kdf` | `crypto.*` 对应子集 | |
| `metrics:read` | （WASM-only，host-metrics 快照） | |
| `notify` | （WASM-only，系统通知） | |
| `clipboard:read` / `clipboard:write` | `clipboard.*` | |
| `tunnel:serve` / `tunnel:connect` / `tunnel:probe` | 隧道服务端 / 客户端 / 探测 | |

### 权限规则

1. **桌面端没有默认授予**（wasm-core `permission.rs::grant_permissions` 只授予
   manifest 声明且在本表内的权限；被过滤项由激活路径 `warn` 留痕）。`storage` 也需
   **显式声明**（内置 wasm 应用均声明了它）——只有**移动端**把 `storage` 设为
   恒授予且不可关闭（宿主壳 `wasmnest-mobile/src/shell/permissions.ts::SHELL_LOCKED_PERMISSIONS`）
2. 未在 `permissions` 中声明的权限无法使用对应 API
3. 非法权限字符串会被过滤并 `warn` 留痕（不报错也不静默忽略）
4. 权限在插件停用时全部收回，再次激活时重新授予
5. **移动端退役位**：`ui:toolbox` / `ui:navtab` / `ui:input` 装载期显性拒绝
   （`check_retired_permissions`），迁移出路 `registerSurface` + `registerRoute` /
   `openPage`（详见移动指南 §6 与检查清单）

---

## 6. TS-only 插件开发

> **本节及 §7–§9 为旧贡献面形态**（`activate(context)` + 注册面）：SDK 仍支持、
> 模板 `create` 默认生成此形态；现行应用均使用挂载包形态（见
> [`wasm-app-dev-desktop.md`](wasm-app-dev-desktop.md) §3.1）。

### 入口文件约定

入口文件必须导出 `activate` 函数，可选导出 `deactivate` 函数：

```typescript
// index.ts
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import MyView from './components/MyView.vue'

export async function activate(context: PluginContext): Promise<void> {
  // 注册侧边栏面板
  context.ui.registerSidebarPanel({
    id: 'my-plugin.sidebar',
    title: 'My Panel',
    component: MyView,
  })

  // 注册命令
  context.commands.register('my-plugin.hello', () => {
    console.log('Hello from my plugin!')
  })

  // 注册插件翻译（可选）
  context.i18n.registerMessages('zh-CN', { hello: '你好' })
  context.i18n.registerMessages('en', { hello: 'Hello' })
}

export async function deactivate(): Promise<void> {
  // 清理资源
}
```

### Vue 组件中获取 PluginContext

在 `PluginViewHost` 渲染的组件中，通过 `inject` 获取上下文：

```vue
<script setup lang="ts">
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

const context = inject<PluginContext>('pluginContext')!
</script>
```

### 国际化（i18n）

插件通过 `context.i18n` API 访问宿主 i18n 能力：

```typescript
// 1. 在 activate() 中注册插件翻译
context.i18n.registerMessages('zh-CN', {
  hello: '你好',
  configTitle: '配置',
})
context.i18n.registerMessages('en', {
  hello: 'Hello',
  configTitle: 'Configuration',
})

// 2. 组件内使用 useI18n()（共享宿主 vue-i18n 实例）
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

// 3. 模块级代码使用 SDK 代理
import { getI18n } from '@binblink/wasmnest-plugin-sdk-desktop'
const i18n = getI18n()
i18n.global.t('my-plugin.key')  // 完整 i18n 实例

// 4. 使用 context.i18n.t() 快捷方法（自动添加插件 ID 前缀）
context.i18n.t('hello')  // 等同于 i18n.global.t('com.example.my-plugin.hello')
```

> **注意**：插件翻译 key 会自动添加 `插件ID.` 前缀隔离。注册 `{ hello: '你好' }` 实际存储为 `{ 'com.example.my-plugin.hello': '你好' }`。

### 事件通信

```typescript
// 监听事件（返回 Disposable）
const disposable = context.events.on('my-event', (payload) => {
  console.log('Received:', payload)
})

// 发射事件
context.events.emit('my-event', { data: 'hello' })

// 清理（deactivate 时自动清理，也可手动 dispose）
disposable.dispose()
```

---

## 7. Rust+TS 插件开发（WASM）

Rust+TS 插件将 Rust 代码编译为 **WASM 组件**（Component Model），由宿主 wasmtime 沙箱加载运行，TS 前端通过 invoke 调用 WASM 命令。

### 7.1 Rust 项目配置

**Cargo.toml**：

```toml
[lib]
crate-type = ["cdylib", "rlib"]
```

> `cdylib` 是 wasm32 目标的产物类型，与传统动态库无关。

```bash
# 编译 WASM 组件（release）
cargo build --target wasm32-unknown-unknown --no-default-features --features wasm --release
```

### 7.2 WASM 入口

实现 `WasmPlugin` trait（`wasmnest_plugin_api`），通过 `wasm_entry!` 宏生成导出：

```rust
use wasmnest_plugin_api::host::{HostConfig, HostFs, HostLog};
use wasmnest_plugin_api::types::PluginManifest;
use wasmnest_plugin_api::{WasmHost, WasmPlugin};

struct MyPlugin;

impl WasmPlugin for MyPlugin {
    const ID: &'static str = "com.example.my-plugin";

    fn manifest() -> PluginManifest {
        serde_json::from_str(include_str!("../../plugin.json"))
            .expect("plugin.json must be valid PluginManifest")
    }

    fn activate() -> anyhow::Result<()> {
        // 初始化（数据目录授权、注册监听器等）
        Ok(())
    }

    fn invoke_command(name: &str, args: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        // 命令路由
        Ok(serde_json::Value::Null)
    }
}

wasmnest_plugin_api::wasm_entry!(MyPlugin);
```

### 7.3 宿主 API（沙箱内能力边界）

| 能力 | 宿主接口 |
|------|---------|
| HTTP 请求 | `WasmHost::http_fetch()`（沙箱内无法直连网络，必须经宿主代理） |
| HTTP 路由 | `host-http.register-endpoint` / `unregister-endpoint`（ABI v29 起运行时注册，静态声明面已退役） |
| 文件读写 | `fs_read` / `fs_write` / `fs_copy` Host Function |
| 数据库 | `plugin_db_execute` / `plugin_db_query`（独立 SQLite） |
| 配置 | `config_get` |
| 事件 | `emit_event` + `host-bus.publish`（属主私有 topic，跨插件用 public topic；`broadcast_sync` 同步广播面已随 v28 退役） |

> 完整示例参考内置应用：`../wasmnest-apps/apps/bedcode`、`apps/ai-chatbox`、`apps/file-transfer`（各自 `desktop/rust/src/`）。

## 8. PluginContext API 参考

`PluginContext` 是插件访问宿主能力的唯一通道，在 `activate(context)` 时获取。

### context.commands — 命令注册表

```typescript
// 注册前端命令
const disposable = context.commands.register('my-cmd', (args) => { /* ... */ })

// 执行命令（先查前端注册，再查 Rust 插件命令）
const result = await context.commands.execute('my-plugin.hello', { name: 'world' })
```

### context.terminal — 终端 API

```typescript
// 发送输入到指定会话（需 terminal:input 权限）
await context.terminal.sendInput('session-id', 'ls -la\n')

// 监听终端输出（需 terminal:output 权限）
const disposable = context.terminal.onOutput((sessionId, data) => {
  console.log(`Output from ${sessionId}:`, data)
})

// 监听终端输入（需 terminal:input 权限）
const disposable = context.terminal.onInput((sessionId, text) => {
  return text.toUpperCase() // 返回修改后的文本，或 null 不修改
})
```

### context.session — 会话 API

```typescript
// 列出所有会话（需 session:read 权限）
const sessions = await context.session.list()

// 获取单个会话（需 session:read 权限）
const session = await context.session.get('session-id')

// 监听会话状态变化（需 session:read 权限）
const disposable = context.session.onStatusChange((event) => { /* ... */ })
```

### context.ui — UI 注册表

```typescript
// 侧边栏面板（需 ui:sidebar 权限）
context.ui.registerSidebarPanel({ id, title, component })

// 工具箱页面（需 ui:toolbox 权限）
context.ui.registerToolboxPage({ id, title, component })

// 状态栏项（需 ui:statusbar 权限）
context.ui.registerStatusBarItem({ id, label, icon?, onClick? })

// 输入扩展（需 ui:input 权限）
context.ui.registerInputExtension({ id, label, icon?, onActivate? })

// 终端工具栏项（需 ui:input 权限）
context.ui.registerTerminalToolbarItem({ id, label, icon?, onClick? })

// 标题栏项（需 ui:statusbar 权限）
context.ui.registerTitleBarItem({ id, label, icon?, onClick? })

// 文件处理器（需 ui:fileHandler 权限）
context.ui.registerFileHandler({ id, extensions, component })
```

### context.events — 事件 API

```typescript
// 监听事件
const disposable = context.events.on('my-event', (payload) => { /* ... */ })

// 发射事件
context.events.emit('my-event', { data: 'hello' })
```

### context.storage — 存储 API

```typescript
// 读取（需声明 storage 权限——桌面端无默认授予）
const value = await context.storage.get<string>('my-key')

// 写入
await context.storage.set('my-key', { foo: 'bar' })

// 删除
await context.storage.delete('my-key')

// 刷盘（当前为 no-op，存储即时写入）
await context.storage.flush()
```

### context.http — HTTP API

```typescript
// 注册 HTTP 端点（需 network:http 权限）
const disposable = context.http.registerEndpoint('/my-endpoint', async (req) => {
  return { status: 200, body: { message: 'ok' } }
})
```

### context.i18n — 国际化 API

```typescript
// 获取宿主 i18n 实例（vue-i18n I18n 对象）
const i18n = context.i18n.getI18n()
i18n.global.t('some.key')  // 翻译任意宿主 key

// 注册插件翻译（自动添加插件 ID 前缀隔离）
context.i18n.registerMessages('zh-CN', {
  hello: '你好',
  config: '配置',
})
context.i18n.registerMessages('en', {
  hello: 'Hello',
  config: 'Configuration',
})

// 快捷翻译（自动添加插件 ID 前缀）
context.i18n.t('hello')           // 等同于 i18n.global.t('com.example.my-plugin.hello')
context.i18n.t('hello', { name: 'World' })  // 带参数
```

---

## 9. 扩展点详解

### 9.1 侧边栏面板

侧边栏面板显示在桌面端左侧边栏，点击图标切换显示：

```typescript
context.ui.registerSidebarPanel({
  id: 'my-plugin.sidebar',    // 唯一标识
  title: 'My Panel',           // 面板标题
  component: MyViewComponent,  // Vue 组件
})
```

Vue 组件通过 `inject('pluginContext')` 获取 `PluginContext`。

### 9.2 终端工具栏

在终端视图底部工具栏添加按钮：

```typescript
context.ui.registerTerminalToolbarItem({
  id: 'my-plugin.toolbar-action',
  label: 'Action',
  icon: '⚡',
  onClick: () => { /* 触发动作 */ },
})
```

### 9.3 命令面板

声明了 `contributes.commands` 的插件，其命令会出现在命令面板中。前端注册的命令 handler 优先于 Rust 端命令。

### 9.4 终端输入/输出处理

> **已退役（v27）**：terminal handler 挂钩面已随会话观察面退役（见检查清单「插件导出」条），
> 本节仅作历史参考，现行 SDK 不再导出这两个符号。

Rust+TS 插件可通过 WASM 命令注册 terminal handler 拦截/修改终端数据：

- `wasmnest_plugin_on_terminal_input`：接收 JSON 字符串 `{"sessionId": "...", "text": "..."}`，返回修改后的文本或 `null`
- `wasmnest_plugin_on_terminal_output`：同上

> **注意**：当前 terminal handler 签名只接收文本，不含 session_id 上下文。若需会话级区分，建议通过 `session_list` API 获取当前活跃会话。

### 9.5 HTTP 端点

插件可注册 HTTP 端点，外部可通过 `/api/plugin/{plugin-id}/{path}` 访问：

```typescript
context.http.registerEndpoint('/query', async (req) => {
  return { status: 200, body: { result: 'ok' } }
})
```

> **ABI v29 起**：HTTP 路由由插件代码**运行时注册**（Rust 侧 `host-http.register-endpoint`
> / `unregister-endpoint`），manifest 静态声明面（`httpEndpoints`）已退役。

认证方式：plugin token 或 JWT Bearer token（档位 `none | jwt`，HTTP 面缺省 `jwt` 最严）。

---

## 10. 配置系统

插件通过 `contributes.configuration` 声明配置 schema，WasmNest 自动生成配置表单。

### 配置存储

配置值存储在插件 storage 的 `config` key 下：

```typescript
// 读取配置
const config = await context.storage.get('config')

// 保存配置
await context.storage.set('config', { apiKey: '...', maxResults: 10 })
```

### 配置页面

已激活的插件在应用管理页会显示"配置"链接（桌面系统页 `/sys/`），自动渲染配置表单。

---

## 11. 测试与调试

### 前端调试

1. 插件通过 `convertFileSrc()` 从 `resources/plugins/desktop/` 加载**编译后的** `index.js`，修改源码后必须先 `vite build` 再刷新页面才能看到变化
2. 可使用 `pnpm exec vite build --watch` 监听源码变更自动重新构建，减少手动 build 步骤
3. 浏览器 DevTools 中查看 `console.log` / `console.error`
4. 插件加载错误会标记为 Error 状态，在管理页面查看详情

### Rust 调试

1. 使用 `tracing::info!` / `tracing::error!` 输出日志
2. 日志通过 Tauri stderr 输出，开发模式下可见
3. WASM 沙箱内 panic 会被宿主捕获，不会崩溃宿主
4. WASM 编译产物需手动复制到 `resources/plugins/desktop/{plugin-id}/` 目录（或使用统一构建脚本）

### 常见调试技巧

- 检查插件是否出现在应用管理页（桌面系统页 `/sys/`）
- 查看插件状态是否为 Activated
- 查看浏览器 DevTools 和终端日志
- 使用 `plugin_get_info` 命令检查插件信息

---

## 12. 构建与打包

> 首选走 SDK CLI（`wasmnest-plugin-desktop build`），它已封装 vite + cargo wasm32 +
> componentize + wasmHash 注入 + `--resources-dir` 复制。下方手写流程仅作参考。

### ts-only 应用构建

```bash
# 在 wasm 应用目录下构建（应用仓）
cd ../wasmnest-apps/apps/my-app/desktop
pnpm run build                 # = wasmnest-plugin-desktop build
pnpm run build -- --frontend-only

# 产物输出到 dist/（由构建链 --resources-dir 复制到宿主资源目录，或打包 zip 分发）
```

**挂载包形态（现行）vite.config.ts 示例**（参照 `../wasmnest-apps/apps/file-transfer/desktop/vite.config.ts`）：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const pluginId = 'com.example.my-app'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
```

> 挂载包**自足打包**：vue / pinia / vue-router / vue-i18n / vue-sonner 等全部内联进产物，
> 不使用 `wasmnestPlugin()` 外部化，不依赖 `window.__WASMNEST_SHARED__`。

**旧贡献面形态（模板默认）vite.config.ts 示例**：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-desktop/vite'

const pluginId = 'com.example.my-app'

export default defineConfig({
  plugins: [vue(), wasmnestPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
  },
})
```

> **注意**：`wasmnestPlugin()` 会把 `vue`、`vue-i18n`、`pinia`、`vue-sonner` 标记为 rollup
> external，并在构建后把 import 语句替换为从 `window.__WASMNEST_SHARED__` 读取
> （真源 `packages/plugin-sdk-desktop/src/vite-plugin.ts::SHARED_MODULES`）。
> **不要**在应用 vite 配置中手动内联这些模块，否则 `provide`/`inject` 会跨 Vue 实例失效
> （`vue-sonner` 自带第二份则 toast 入自家队列、宿主 `<Toaster>` 收不到）。

### rust-ts 应用构建

```bash
# 1. 编译 Rust WASM 组件
cd rust/
cargo build --target wasm32-unknown-unknown --no-default-features --features wasm --release

# 2. 组件化编码（core module → Component Model 组件）
# 统一用 packages/plugin-sdk-desktop/tools/componentize（wasmnest-componentize），或交给 SDK CLI 代劳

# 3. 编译 TS 前端
cd ..
pnpm exec vite build
```

> 宿主只接受 **Component Model 组件**（字节头 `00 61 73 6d 0d 00 01 00`）。
> 裸 `cargo build --target wasm32` 产物是 core module，加载会被拒——
> 重编后必须重跑 `wasmnest-plugin-desktop build`。

### 应用分发

两个通道：

1. **内置应用**（随安装包分发）：源码住应用仓 `apps/<slug>/desktop/`，产物由平台仓统一构建
   （`wasmnest-desktop && pnpm run plugins:build`，经 resolver 读应用仓源码；或单 app
   `wasmnest-plugin-desktop build --resources-dir <宿主resources/plugins父目录>`）复制到
   宿主 `resources/plugins/desktop/<id>/`
2. **用户安装**：产物打包为 zip，桌面端「插件」页选文件安装，
   落盘 `app_data_dir/plugins/<id>/`

---

## 13. 常见问题

### Q: 插件加载后状态一直是 Loaded，没有变为 Activated？

挂载包形态（现行）：业务应用（L3）按持久化激活状态在 boot 自动激活
（`auto_activate_from_persisted_state`，桌面端；移动端只按 `plugin.autostart.{id}`
偏好自动激活，缺省关）。未激活时检查：清单 `platform` / `pluginType` 是否合法、
WASM 组件是否按 `rustLibrary` 找到、activate 是否报错（管理页看 Error 详情）。
旧贡献面形态：有 `views` 的插件会自动激活；只有 `commands` / `terminal` 的插件会懒激活（按需激活）。

### Q: 权限检查失败？

确保 `plugin.json` 的 `permissions` 数组包含所需权限。前端和 Rust 端都会校验。

### Q: TS-only 插件如何做网络请求？

出站请求经宿主出站闸门（三层判定：目标白名单 → 声明 URL → 记忆 + 未命中一次授权；见平台仓 `docs/security.md`）。如果需要暴露 HTTP 端点供外部访问，则需 `network:http` 权限。

### Q: 插件如何与 Claude Code 交互？

通过 `context.terminal.sendInput()` 向终端发送命令。插件可通过 `terminal:output` 监听输出，解析 Claude Code 的状态。

### Q: 插件按钮点击无反应 / provide/inject 不工作？

旧贡献面形态：确保插件 vite.config.ts 使用了 `wasmnestPlugin()`（来自 `@binblink/wasmnest-plugin-sdk-desktop/vite`）。如果 Vue 运行时被内联到插件产物中，`provide`/`inject` 会跨 Vue 实例失效。检查构建产物大小 — 正常应小于 100KB（不含 Vue 运行时），如果超过 200KB 说明 Vue 被内联了。
挂载包形态（现行）：不存在此问题——vue 运行时自足打包，宿主只传 `root` 与 `env`，不跨实例注入。

### Q: 插件如何使用国际化？

挂载包形态（现行）：应用自带 vue-i18n 实例（`src/i18n/`），宿主经 `setLocale` 同步语言；
旧贡献面形态：① 组件内使用 `useI18n()`（与宿主共享 vue-i18n 实例）
② 模块级代码使用 `import { getI18n } from '@binblink/wasmnest-plugin-sdk-desktop'`
③ 注册插件翻译使用 `context.i18n.registerMessages(locale, messages)`
④ 类型引用使用 `import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'`
