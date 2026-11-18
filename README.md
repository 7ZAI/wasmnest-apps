# wasmnest-apps

**WasmNest 应用仓 —— 业务语义的唯一主场。**

WasmNest 的桌面与 Android 宿主只提供机制与安全闸门；会话、终端、文件传输、AI、Agent 管理等产品能力全部住在这里，以 **wasm 应用** 的形式独立构建，再由宿主按权限装载。产品应用（`apps/`）与服务型 wasm（`servers/`：认证中心、运行监控、网络配置等内部业务）同构共存于本仓，由同一套工程枚举与构建编排覆盖。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-Component-654FF0?logo=webassembly&logoColor=white)](https://component-model.bytecodealliance.org)

简体中文 | [English](README_en.md)

## 特性亮点

- **wasm 应用模型**：业务语义全部住进 wasm 应用，宿主只提供机制与权限闸门，按权限按需装载，应用与宿主之间**零源码 import**。
- **桌面 + 移动双端同构**：产品应用与服务型 wasm 共用一套工程结构，一套构建编排覆盖 `apps/` 与 `servers/`。
- **逐工程独立版本与发布**：推 tag `<slug>-v<X.Y.Z>` 即触发该工程的 CI 构建与发布；每个工程是独立 pnpm workspace，互不阻塞。
- **真实宿主 E2E**：三档运行器（桌面 / 双端 / 真机单端）一条命令拉起「宿主 + 被测工程 + 驱动链」，跑完收干净。
- **跨仓边界清晰**：WIT / ABI 真源在能力仓与平台仓，本仓只依赖平台 SDK 生成物，契约改动不在本仓进行。

## 应用一览（apps/）

| 应用（目录） | 插件 id | 端 | 能力 |
| --- | --- | --- | --- |
| [BedCode](apps/bedcode/README.md)（`bedcode`） | `com.wasmnest.bedcode` | 桌面 + 移动 | 桌面为终端会话中心（配对 / 信任、会话编排、任务队列与 Agent 集成），移动为远程终端控制端 |
| [AI Chatbox](apps/ai-chatbox/README.md)（`ai-chatbox`） | `com.wasmnest.ai-chatbox` | 桌面 + 移动 | 多供应商 AI 对话：流式输出、多会话管理、JSONL 对话日志 |
| [File Transfer](apps/file-transfer/README.md)（`file-transfer`） | `com.wasmnest.file-transfer` | 桌面 + 移动 | 内网对端发现、双向文件传输、断点续传与共享目录；双端单 Rust 产物 |
| [Lanbitou](apps/lanbitou/CHANGELOG.md)（`lanbitou`） | `com.wasmnest.lanbitou` | 桌面 | 烂笔头：轻量级 Markdown 记事本，纯文本编辑 + 实时预览、自动保存、归档与剪贴板集成 |

> 插件 id 与目录 slug 同名（`com.wasmnest.<slug>`）：`bedcode` 目录对应 `com.wasmnest.bedcode`（2026-10-25 由历史 id `com.wasmnest.terminal-session` 改名归一）。新建应用一律使用 `com.wasmnest.<slug>`。

## 服务一览（servers/）

服务型 wasm：为产品应用提供共享的基础能力，装配角色为 L1 基础服务 / L2 内部业务（`plugin.json` 的 `type: internal-business`），工程结构与应用完全同构。

| 服务（目录） | 插件 id | 端 | 能力 |
| --- | --- | --- | --- |
| [Auth Center](servers/auth-center/CHANGELOG.md)（`auth-center`） | `com.wasmnest.auth-center` | 桌面 | 认证中心：本机入站连接的唯一裁决者（fail-closed），配对码 / QR / 信任 / 首连确认 / 认证策略 / 生物凭证 + 认证记录库 + 互调 api 面，供 BedCode、file-transfer 等消费方经互调取用 |
| [Monitor](servers/monitor/CHANGELOG.md)（`monitor`） | `com.wasmnest.monitor` | 桌面 + 移动 | 运行监控：只读查看全部已加载 wasm 应用的运行时指标（内存 / 调用 / 燃料 / Trap / 授权 / 背压）+ 平台总览与阈值预警 |
| [Net Config](servers/net-config/CHANGELOG.md)（`net-config`） | `com.wasmnest.net-config` | 桌面 | 网络配置中心：穿透配置的跨应用唯一真源，中继地址导入 / 外网注册表 / 部署文本生成与地址校验 |

## 工作原理

### wasm 应用模型

宿主（桌面 / Android）只承载机制与安全闸门：会话、终端、文件传输、AI、Agent 管理等**产品能力全部在应用仓**，以 wasm 应用形式独立构建，由宿主按权限装载。应用只依赖平台仓 SDK 包，**零宿主源码 import**；宿主前端同样不 import 应用源码，只在运行时装载产物。

### 双端应用形态

双端前端形态不同，不能互相套用（`servers/` 工程同样遵循）：

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

### 仓库布局

| 目录 / 文件 | 职责 |
| --- | --- |
| `apps/<slug>/{desktop,mobile}` | 产品应用工程：桌面为独立挂载包，移动为宿主壳运行面；各含 `plugin.json`、前端 `src/` 与 WASM 后端 `rust/` |
| `servers/<slug>/{desktop,mobile}` | 服务型 wasm 工程（L1 基础服务 / L2 内部业务），结构与应用同构 |
| `apps/file-transfer/rust/{core,plugin}` | File Transfer 共享业务核与双端同构 crate（双端单产物的例外） |
| `e2e/` | wdio E2E：harness / pages / specs / dual / mobile |
| `scripts/` | 构建编排、发布、E2E 运行器与 CI 装配；工程枚举唯一真源为 `scripts/lib/projects.mjs` |
| `docs/` | CODE-MAP / FRONTEND / BACKEND / CI / E2E / wasm-app-dev / ADR / agents / design / verification 等文档 |
| `.github/workflows/` | CI：`ci.yml` + app-build / app-release / app-build-reusable |

每个工程（`apps/` 与 `servers/`）保留独立 pnpm workspace（各有 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`），不合并；根 `package.json` 只做编排。工程枚举的唯一真源是 `scripts/lib/projects.mjs`——**新增应用或服务无需改任何脚本**。

## 快速开始

### 前置条件

- 四仓按 sibling 布局摆放；本仓默认从 `../wasmnest` 读取平台路径。WIT 契约真源在 `../wasmnest-lib`，应用只经平台 SDK 的生成物使用它。
- Node.js ≥ 22、pnpm `12.2.1`。
- Rust stable + `wasm32-wasip3` / `wasm32-unknown-unknown` 目标；`sccache` 必需（`.cargo/config.toml` 强制 `rustc-wrapper`）。
- 桌面真实运行需要平台仓桌面宿主。
- E2E 前置：桌面 E2E 需 `tauri-driver` + `WebKitWebDriver`；双端 / 真机单端 E2E 需 adb + debug APK（详见 [`docs/E2E.md`](docs/E2E.md)）。
- 本地 SDK 默认走发布物；要直接联调平台仓源码时用 `pnpm run link:platform`（工作区状态，提交前必须 `pnpm run unlink:platform` 还原）。

### 安装依赖

```bash
# 应用仓根依赖（eslint / prettier / husky）
pnpm install

# 每个工程（apps + servers，双端）独立安装
for app in apps/*/desktop apps/*/mobile servers/*/desktop servers/*/mobile; do
  [ -f "$app/package.json" ] && (cd "$app" && pnpm install)
done
```

### 运行测试与构建

```bash
# 全仓逐工程串行（apps + servers）
pnpm run test:run
pnpm run build
pnpm run lint
pnpm run test:scripts        # scripts/ 自身单测（node --test）

# 单个工程（以 BedCode 桌面为例）
cd apps/bedcode/desktop
pnpm run test:run
pnpm run build
```

桌面工程的 `build` 直接把产物写入平台宿主 `src-tauri/resources/plugins/desktop/<id>/`；移动工程的 `build` 默认只产出自身 `dist/`，写入宿主 resources 由平台仓移动构建负责（`file-transfer/mobile` 例外：它的 `build` 直接走平台包装脚本）。

### E2E（真实宿主内自动化测试）

三档运行器一条命令拉起「宿主 + 被测工程 + 驱动链」，跑完收干净：

```bash
# 桌面端：真实宿主挂载真实 wasm app，脚本点击界面断言（默认 packed 宿主模式）
node scripts/e2e.mjs --app bedcode

# 双端：桌面宿主 + USB 真机同时在场（配对 / 跨端链路）
node scripts/e2e-dual.mjs --app bedcode

# 真机单端：真机 + 真移动宿主，桌面不在场
node scripts/e2e-mobile.mjs --app file-transfer
```

写法、判据纪律与排障见 [`docs/E2E.md`](docs/E2E.md)；功能验收模板见 [`docs/verification/`](docs/verification/README.md)（两者不可互相替代）。

### 在真实宿主中调试

> 以下命令从应用仓根开始执行。

```bash
# 平台仓：构建可分发的宿主产物（不含平台源码依赖）
cd ../wasmnest/wasmnest-desktop
pnpm run host:pack

# 应用仓：用真实宿主加载本工程产物（所有桌面工程均有 dev:host）
cd ../../wasmnest-apps/apps/bedcode/desktop
pnpm run dev:host
```

其它桌面工程需要真实宿主时，同样在各自工程内跑 `pnpm run dev:host`。移动工程可先用 SDK dev-shell：`pnpm run dev`。

## 常用命令

### 应用仓根

| 命令 | 说明 |
| --- | --- |
| `pnpm run test:run` | 逐工程串行跑 `test:run`（apps + servers；缺脚本打印 skip，不静默略过） |
| `pnpm run build` | 逐工程串行构建 |
| `pnpm run test:scripts` | `scripts/` 自身单测（node --test） |
| `pnpm run lint` | 根 eslint（0 error 口径） |
| `pnpm run format` | prettier 写 `apps/**/src/**` 与 `servers/**/src/**` |
| `pnpm run e2e` | 桌面端 E2E（`node scripts/e2e.mjs`，说明见 `docs/E2E.md`） |
| `pnpm run e2e:dual` / `e2e:mobile` | 双端 / 真机单端 E2E（需真机，见 `docs/E2E.md` §10–§11） |
| `pnpm run link:platform` / `unlink:platform` | SDK 依赖切本地平台源码 / 精确还原（工作区状态，不可提交） |
| `pnpm run bench:qr` | 扫码解码基准 |
| `node scripts/run-apps.mjs <script> [--only=<group>/<slug>[/<end>]]` | 对全部工程跑一条脚本，可按工程 / 端过滤（CI 矩阵同款入口） |
| `node scripts/package-plugins.mjs --list` | 打印解析后的插件清单 |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>]` | 构建、收集产物并按插件打 zip |

### 单个工程

| 命令 | 说明 | 例外 |
| --- | --- | --- |
| `pnpm run test:run` | 该工程的 vitest | — |
| `pnpm run build` | 桌面 = `node scripts/build.js`；移动 = SDK CLI / 平台包装脚本 | — |
| `pnpm run build:frontend` / `build:rust` | 桌面分段构建（`ai-chatbox/desktop` 另有 `build:go` / `build:both`） | 移动端无分段脚本 |
| `pnpm run dev` | 桌面 = watch 构建；移动 = SDK dev-shell | `bedcode/desktop` 无 `dev` |
| `pnpm run dev:host` | 工程内起真实桌面宿主 | 所有桌面工程均有 |
| `cargo test --manifest-path rust/Cargo.toml` | 该工程的 Rust 单测（native） | `file-transfer` 改跑 `rust/core` / `rust/plugin` 的 manifest；`bedcode/desktop` 另有 `pnpm run test:rust` |

> **禁止运行 `pnpm run test`**（vitest watch 不退出），一律 `test:run`。

## 跨仓边界

- 应用只依赖平台仓 SDK 包（`@binblink/wasmnest-plugin-sdk-desktop` / `-mobile`），**零宿主源码 import**；宿主前端同样不 import 应用源码，只在运行时装载产物。
- WIT / ABI 真源不在本仓：核心 WIT 在能力仓，端组合与 SDK 生成物在平台仓。改契约不在本仓进行。
- 应用自己的业务真源（私有库 / KV / 登记表）由应用自持，不推给宿主内核。
- 前端不得直连网络 / 文件 / 导航原语；资源访问一律经 SDK 与宿主权限闸门。
- 新增 / 改名 / 停用应用或服务时，除本仓提交外还必须同步平台仓的注册表、路由表、锁清单与 `release-manifest.json`（`servers/` 工程的条目带 `group: 'servers'`；完整清单见 [`AGENTS.md`](AGENTS.md) §6）。
- 平台仓有锁读取本仓源码：`hostAppBoundaryLock`（逐字校验六个桌面 `entry.ts`，含 `servers/auth-center`）、`tailwindContentCoverage`（原 i18n drift 锁已于 2026-10-27 退役）。改对应面之前先读锁。

## 文档

| 需求 | 入口 |
| --- | --- |
| 裁决口径、硬约束、命令与验证清单 | [`AGENTS.md`](AGENTS.md) |
| 结构 / 工程清单 / 产物流向 | [`docs/CODE-MAP.md`](docs/CODE-MAP.md) |
| 前端规范（双端 / 挂载契约 / 预览 / i18n） | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Rust 后端规范（crate / 命令面 / 权限 / 构建） | [`docs/BACKEND.md`](docs/BACKEND.md) |
| wasm 应用开发指南（桌面 / 移动 / 清单 / 红线） | [`docs/wasm-app-dev/`](docs/wasm-app-dev/) |
| CI（构建、按工程独立发布、tag 纪律） | [`docs/CI.md`](docs/CI.md) |
| E2E（三档运行器 / 锚点 / 判据纪律） | [`docs/E2E.md`](docs/E2E.md) |
| 按工程功能验收模板与报告口径 | [`docs/verification/README.md`](docs/verification/README.md) |
| 决策记录（ADR） | [`docs/adr/`](docs/adr/) |
| Agent 协作约定（领域 / issue / triage） | [`docs/agents/`](docs/agents/) |
| 设计文档（NAT 穿透等） | [`docs/design/`](docs/design/) |
| 中继服务器构建教程（内网穿透） | [`docs/design/nat-traversal/build-relay-server.md`](docs/design/nat-traversal/build-relay-server.md) |
| 领域词汇 | [`GLOSSARY.md`](GLOSSARY.md) |
| 平台仓（宿主 / SDK / release-manifest） | [github.com/7ZAI/wasmnest](https://github.com/7ZAI/wasmnest) |
| 能力仓（引擎 / WIT 真源） | [github.com/7ZAI/wasmnest-lib](https://github.com/7ZAI/wasmnest-lib) |
| 跨端真实互连测试 | [github.com/7ZAI/wasmnest-test](https://github.com/7ZAI/wasmnest-test) |
| 四仓通用规范（git / 注释 / 测试 / 版本 / issue） | 平台仓 `docs/public/` |

## 开发与贡献

1. 先读 [`AGENTS.md`](AGENTS.md) 与平台仓 [`docs/public/`](https://github.com/7ZAI/wasmnest/tree/main/docs/public)；业务语义留在应用，别推给宿主。
2. 小步提交，commit scope 使用工程 slug；只提交源码，不提交产物。
3. 改前端跑该工程 `test:run`，改 Rust 跑该 crate `cargo test`；涉及宏 / 互调 / 构建目标的改动必须补跑 wasm 目标构建；改动交互面补跑该工程 E2E（锚点改名 = 用例红，需一起改）。
4. CI 为 GitHub Actions（`.github/workflows/`，说明见 [`docs/CI.md`](docs/CI.md)）：验证 = 本地命令实跑 + 平台仓侧锁 + CI 绿，三者不互相替代；交付时说明「跑了什么 / 没跑什么 / 风险」。
5. 跨会话任务以 [GitHub Issues](https://github.com/7ZAI/wasmnest-apps/issues) 为真源。

## 项目状态

研发起步期，版本线 `0.0.1`。**每个工程独立版本、独立发布**：推 tag `<slug>-v<X.Y.Z>` 触发该工程的 CI 构建与发布（版本纪律见 [`docs/CI.md`](docs/CI.md) §2）；整仓 tag `apps-vX.Y.Z` 是平台仓 `release-manifest.json` 装配应用仓的口径。未打 tag 的本地改动不会进入发布装配。

## 许可证

[MIT](LICENSE) © 2026 7ZAI
