# wasmnest-apps

**WasmNest 应用仓 —— 业务语义的唯一主场。**

WasmNest 的桌面与 Android 宿主只提供机制与安全闸门；会话、终端、文件传输、AI、Agent 管理等产品能力全部住在这里，以 **wasm 应用** 的形式独立构建，再由宿主按权限装载。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-Component-654FF0?logo=webassembly&logoColor=white)](https://component-model.bytecodealliance.org)

简体中文 | [English](README_en.md)

## 应用一览

| 应用（目录） | 插件 id | 端 | 能力 |
| --- | --- | --- | --- |
| [BedCode](apps/bedcode/README.md)（`bedcode`） | `com.wasmnest.bedcode` | 桌面 + 移动 | 桌面为终端会话中心（配对 / 信任、会话编排、任务队列与 Agent 集成），移动为远程终端控制端 |
| [AI Chatbox](apps/ai-chatbox/README.md)（`ai-chatbox`） | `com.wasmnest.ai-chatbox` | 桌面 + 移动 | 多供应商 AI 对话：流式输出、多会话管理、JSONL 对话日志 |
| [File Transfer](apps/file-transfer/README.md)（`file-transfer`） | `com.wasmnest.file-transfer` | 桌面 + 移动 | 内网对端发现、双向文件传输、断点续传与共享目录；双端单 Rust 产物 |

> 插件 id 与目录 slug 同名（`com.wasmnest.<slug>`）：`bedcode` 目录对应 `com.wasmnest.bedcode`（2026-10-25 由历史 id `com.wasmnest.terminal-session` 改名归一）。新建应用一律使用 `com.wasmnest.<slug>`。

## 双端应用形态

双端前端形态不同，不能互相套用：

| | 桌面 | 移动 |
| --- | --- | --- |
| 入口 | `src/entry.ts` → `mountApp(root, env)`；可选 `mountPreview(root, env)` | `src/index.ts` → `activate(context)` / `deactivate()` |
| 构建 | 独立挂载包，**自带全部依赖、无 externals** | SDK `wasmnestPlugin()`，`vue` / `vue-i18n` / `pinia` 外置为宿主全局 |
| 宿主关系 | 运行时动态 `import` 单文件包 | 运行期注册到宿主壳（`UIRegistry` / surface） |
| 预览 | 真实桌面宿主 `tauri:dev`（平台仓） | SDK dev-shell（HMR） |
| Rust | 一般为 `wasm32-wasip3` 直出 Component | `wasm32-unknown-unknown` + 平台组件化工具 |

**File Transfer 是双端单产物**：`apps/file-transfer/{desktop,mobile}` 只有前端，Rust 全部在应用级 `apps/file-transfer/rust/`：

- `rust/core/`：共享业务核（端口 trait + 纯逻辑，零 SDK 依赖，可 native 单测）。
- `rust/plugin/`：双端同构 crate，不属任何一端；桌面与移动构建都指向它。

## 仓库结构

```text
wasmnest-apps/
├─ apps/<slug>/desktop/            # 桌面端应用工程（挂载包）
│  ├─ plugin.json                  # 应用清单：id / 权限 / 扩展点 / rustLibrary
│  ├─ src/entry.ts                 # mountApp + 可选 mountPreview
│  ├─ src/appContext.ts            # AppMountEnv → PluginContext 适配
│  ├─ src/preview/                 # 多任务卡片只读预览面（可选）
│  ├─ rust/                        # WASM 后端（file-transfer 例外）
│  └─ scripts/build.js             # vite → cargo → 写宿主 resources → 注入 wasmHash
├─ apps/<slug>/mobile/             # 移动端应用工程（宿主壳运行面）
│  ├─ plugin.json
│  ├─ src/index.ts                 # activate / deactivate
│  └─ rust/（或 sharedRustManifest）
├─ apps/file-transfer/rust/{core,plugin}/
├─ scripts/
│  ├─ run-apps.mjs                 # 逐 app 串行执行同一条脚本
│  ├─ package-plugins.mjs          # 构建 + 按插件打 zip
│  ├─ platform-paths.mjs           # 应用 → 平台 resolver（WASMNEST_PLATFORM_ROOT）
│  ├─ plugin-wasm-config.mjs       # wasip3 target / pinned nightly / 共享 target
│  └─ replace-console.mjs          # console.* → 统一 logger
├─ docs/                           # CODE-MAP / FRONTEND / BACKEND
├─ eslint.config.js                # 双端前端资源访问红线
└─ .cargo/config.toml              # 共享 target/wasm-apps + jobs=4 + sccache
```

每个 app 保留独立 pnpm workspace（各有 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`），不合并；根 `package.json` 只做编排。

## 快速开始

### 前置条件

- 四仓按 sibling 布局摆放；本仓默认从 `../wasmnest` 读取平台路径。WIT 契约真源在 `../wasmnest-lib`，应用只经平台 SDK 的生成物使用它。
- Node.js ≥ 22、pnpm `12.2.1`。
- Rust stable + `wasm32-wasip3` / `wasm32-unknown-unknown` 目标；`sccache` 必需（`.cargo/config.toml` 强制 `rustc-wrapper`）。
- 桌面真实运行需要平台仓桌面宿主；`file-transfer` 的 `dev:host` 还需要平台仓先跑过 `pnpm run host:pack`。

### 安装依赖

```bash
# 应用仓根依赖（eslint / prettier / husky）
pnpm install

# 每个 app 工程独立安装
for app in apps/*/desktop apps/*/mobile; do
  [ -f "$app/package.json" ] && (cd "$app" && pnpm install)
done
```

### 运行测试与构建

```bash
# 全仓逐 app 串行
pnpm run test:run
pnpm run build
pnpm run lint

# 单个 app（以 BedCode 桌面为例）
cd apps/bedcode/desktop
pnpm run test:run
pnpm run build
```

桌面 app 的 `build` 直接把产物写入平台宿主 `src-tauri/resources/plugins/desktop/<id>/`；移动 app 的 `build` 默认只产出自身 `dist/`，写入宿主 resources 由平台仓移动构建负责（`file-transfer/mobile` 例外：它的 `build` 直接走平台包装脚本）。

### 在真实宿主中调试

> 以下命令从应用仓根开始执行。

```bash
# 平台仓：构建可分发的宿主产物（不含平台源码依赖）
cd ../wasmnest/wasmnest-desktop
pnpm run host:pack

# 应用仓：用真实宿主加载本 app 产物（仅 file-transfer/desktop 提供）
cd ../../wasmnest-apps/apps/file-transfer/desktop
pnpm run dev:host
```

其它桌面 app 需要真实宿主时，到平台仓运行 `pnpm run tauri:dev`。移动 app 可先用 SDK dev-shell：`pnpm run dev`。

## 常用命令

### 应用仓根

| 命令 | 说明 |
| --- | --- |
| `pnpm run test:run` | 逐 app 串行跑 `test:run`（缺脚本打印 skip，不静默略过） |
| `pnpm run build` | 逐 app 串行构建 |
| `pnpm run lint` | 根 eslint（0 error 口径） |
| `pnpm run format` | prettier 写 `apps/**/src/**` |
| `node scripts/package-plugins.mjs --list` | 打印解析后的插件清单 |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>]` | 构建、收集产物并按插件打 zip |

### 单个 app

| 命令 | 说明 | 例外 |
| --- | --- | --- |
| `pnpm run test:run` | 该 app 的 vitest | `file-transfer/mobile` 无此脚本 |
| `pnpm run build` | 桌面 = `node scripts/build.js`；移动 = SDK CLI / 平台包装脚本 | — |
| `pnpm run build:frontend` / `build:rust` | 桌面分段构建 | 移动端无分段脚本 |
| `pnpm run dev` | 桌面 = watch 构建；移动 = SDK dev-shell | `bedcode/desktop` 无 `dev` |
| `pnpm run dev:host` | 应用工程内起真实桌面宿主 | 仅 `file-transfer/desktop` |
| `cargo test --manifest-path rust/Cargo.toml` | 该 app 的 Rust 单测（native） | `file-transfer` 改跑 `rust/core` / `rust/plugin` 的 manifest；`bedcode/desktop` 另有 `pnpm run test:rust` |

> **禁止运行 `pnpm run test`**（vitest watch 不退出），一律 `test:run`。

## 跨仓边界

- 应用只依赖平台仓 SDK 包（`@binblink/wasmnest-plugin-sdk-desktop` / `-mobile`），**零宿主源码 import**；宿主前端同样不 import 应用源码，只在运行时装载产物。
- WIT / ABI 真源不在本仓：核心 WIT 在能力仓，端组合与 SDK 生成物在平台仓。改契约不在本仓进行。
- 应用自己的业务真源（私有库 / KV / 登记表）由应用自持，不推给宿主内核。
- 前端不得直连网络 / 文件 / 导航原语；资源访问一律经 SDK 与宿主权限闸门。
- 新增 / 改名 / 停用应用时，除本仓提交外还必须同步平台仓的注册表、路由表、锁清单与 `release-manifest.json`（完整清单见 [`AGENTS.md`](AGENTS.md) §6）。
- 平台仓有锁读取本仓源码：`hostAppBoundaryLock`（逐字校验四个桌面 `entry.ts`）、`i18nDriftLock`（宿主 ↔ BedCode 桌面 i18n 逐字一致）、`tailwindContentCoverage`。改对应面之前先读锁。

## 文档

| 需求 | 入口 |
| --- | --- |
| 裁决口径、硬约束、命令与验证清单 | [`AGENTS.md`](AGENTS.md) |
| 结构 / 应用清单 / 产物流向 | [`docs/CODE-MAP.md`](docs/CODE-MAP.md) |
| 前端规范（双端 / 挂载契约 / 预览 / i18n） | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Rust 后端规范（crate / 命令面 / 权限 / 构建） | [`docs/BACKEND.md`](docs/BACKEND.md) |
| 平台仓（宿主 / SDK / release-manifest） | [github.com/7ZAI/wasmnest](https://github.com/7ZAI/wasmnest) |
| 能力仓（引擎 / WIT 真源） | [github.com/7ZAI/wasmnest-lib](https://github.com/7ZAI/wasmnest-lib) |
| 跨端真实互连测试 | [github.com/7ZAI/wasmnest-test](https://github.com/7ZAI/wasmnest-test) |
| 四仓通用规范（git / 注释 / 测试 / 版本 / issue） | 平台仓 `docs/public/` |

## 开发与贡献

1. 先读 [`AGENTS.md`](AGENTS.md) 与平台仓 [`docs/public/`](https://github.com/7ZAI/wasmnest/tree/main/docs/public)；业务语义留在应用，别推给宿主。
2. 小步提交，commit scope 使用 app slug；只提交源码，不提交产物。
3. 改前端跑该 app `test:run`，改 Rust 跑该 crate `cargo test`；涉及宏 / 互调 / 构建目标的改动必须补跑 wasm 目标构建。
4. 当前没有 CI：验证 = 本地命令实跑 + 平台仓侧锁，交付时说明「跑了什么 / 没跑什么 / 风险」。
5. 跨会话任务以 [GitHub Issues](https://github.com/7ZAI/wasmnest-apps/issues) 为真源。

## 项目状态

研发起步期，版本线 `0.0.1`。应用仓独立打 tag（`apps-vX.Y.Z`），平台仓 `release-manifest.json` 以精确 tag 取用；未打 tag 的本地改动不会进入发布装配。

## 许可证

[MIT](LICENSE) © 2026 7ZAI
