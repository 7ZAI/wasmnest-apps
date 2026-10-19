# File Transfer（`com.wasmnest.file-transfer`）

内网文件传输应用：设备发现 / 首连确认 / 文件浏览 / 任务队列 / 断点续传。
**双端单产物**（ADR 0050）：同一份 wasm crate 编译出的组件同时跑桌面与移动宿主，两端目录下只有各自前端。

- 桌面：**挂载包形态**（机制 B，ADR 0057）——入口 `desktop/src/entry.ts` 的 `mountApp(root, env)`
- 移动：**壳运行面形态**——入口 `mobile/src/index.ts` 的 `activate(context)` / `deactivate()`

---

## 目录布局

```text
apps/file-transfer/
├─ rust/                     # 应用级 rust 层（双端同构，不属于任何一端）
│  ├─ core/                  #   共享业务核 wasmnest-file-transfer-core（端口 trait + 纯逻辑，无 SDK 依赖）
│  └─ plugin/                #   双端同构 wasm 产物源 wasmnest-plugin-file-transfer（宿主适配 + 命令面）
├─ desktop/                  # 桌面前端（挂载包，自带全部依赖，无 __WASMNEST_SHARED__ 外置）
│  ├─ src/entry.ts           #   挂载契约入口 mountApp(root, env)
│  ├─ scripts/build.js       #   vite → cargo → componentize → 复制产物 → wasmHash
│  └─ scripts/dev-host.js    #   应用工程内起真实桌面宿主（见「宿主整合运行」）
└─ mobile/                   # 移动前端（壳运行面）
```

> 桌面构建链与移动端 `package.json` 的 `wasmnest.sharedRustManifest` 都指向 `rust/plugin`；
> 移动端不再有自己的 `rust/`。

---

## 命令

### 桌面前端 / wasm 构建（`apps/file-transfer/desktop/`）

| 命令 | 说明 |
| --- | --- |
| `pnpm run build` | 全量：vite 前端 → cargo wasm（unknown-unknown + componentize）→ 复制到平台宿主 resources → 注入 `wasmHash` |
| `pnpm run build:frontend` / `build:rust` | 分段构建 |
| `pnpm run dev` | 只 watch 前端（重建 + 复制产物），**不起宿主** |
| `pnpm run dev:host` | **应用工程内起真实桌面宿主**（见下节） |
| `pnpm run test:run` | vitest（组件 / 逻辑契约） |
| `node scripts/build.js --out <dir>` | 产物目录参数化：写 `<dir>/<appId>/` 而非平台宿主 resources（也可用 env `WASMNEST_PLUGINS_DIR`）。默认行为不变 |

环境变量：`WASMNEST_PLUGIN_DEBUG=1` → wasm 以 debug profile 构建（保留 DWARF）。

### Rust 测试

```bash
cargo test --manifest-path apps/file-transfer/rust/core/Cargo.toml    # 共享业务核（native）
cargo test --manifest-path apps/file-transfer/rust/plugin/Cargo.toml # 双端同构 crate（native）
```

注意：native 测试**不展开** `#[plugin_api]` 宏，跨插件互调的 manifest 路径校验只在 wasm 构建时生效——改 Rust 后端至少跑一次 `pnpm run build:rust`。

### dev-shell（静态 mock，浏览器）

| 端 | 命令 | 状态 |
| --- | --- | --- |
| 移动 | `cd apps/file-transfer/mobile && pnpm run dev` | ✅ 可用（SDK dev-shell + HMR，Rust 命令由 devMock 种子 mock） |
| 桌面 | `cd apps/file-transfer/desktop && pnpm exec wasmnest-plugin-desktop dev` | ⚠️ **当前跑不起来**：桌面 dev-shell 仍按旧协议（`activate()` + 贡献面）加载 `src/index.ts`，而本应用是挂载包（`src/entry.ts` 的 `mountApp`），只会显示「入口模块未导出 activate()」，UI 不渲染。要 dev wasm app 请用下面的宿主整合运行 |

dev-shell 的 mock 边界（两端一致）：`commands.execute` 只跑前端 handler；Rust/WASM 命令、真实 HTTP 端点、系统文件选择均不可用；权限检查跳过。

### 宿主整合运行（真 wasm / 真命令 / 真权限门）

```bash
# 一次性：在平台仓打宿主构建产物（debug profile 二进制 + 已嵌入的宿主前端 dist）
cd wasmnest/wasmnest-desktop && pnpm run host:pack
#   npm↔crate 版本漂移报错时：pnpm run host:pack -- --via-cargo

# 日常：应用工程内一条命令
cd wasmnest-apps/apps/file-transfer/desktop && pnpm run dev:host
```

链路：`build.js --out .dev-host/plugins` 预构建 → 以 `WASMNEST_PLUGINS_DIR` 起宿主产物 → `build.js --watch` 持续重建 → 宿主 `PluginDevWatcher` emit `plugin:dev-reload` → 前端热重载（不重启宿主）。

| 参数 | 说明 |
| --- | --- |
| `--host <dir\|file>` | 宿主产物目录或二进制；默认探测 `<平台仓>/wasmnest-desktop/dist/host-desktop`；也支持 env `WASMNEST_HOST_APP` |
| `--plugins-dir <dir>` | app 产物目录，默认 `.dev-host/plugins`（env `WASMNEST_PLUGINS_DIR` 亦可） |
| `--skip-build` | 产物已最新，跳过预构建 |

宿主窗口起来后：侧栏「文件传输」（宿主路由 `/transfer`）。

> 宿主产物必须 debug profile——热重载源 `PluginDevWatcher` 在宿主侧被 `#[cfg(debug_assertions)]` 包住，release 没有热重载。
> `dev-host` **不依赖平台仓源码**；宿主产物缺失时 fail-visible 并提示先 `host:pack`。

### 平台仓侧（跨仓，需平台仓源码）

| 命令 | 说明 |
| --- | --- |
| `pnpm run tauri:dev`（`wasmnest-desktop/`） | 全量桌面 dev：补建 wasm / 重建陈旧挂载包 / 起四个插件 watch |
| `pnpm run plugins:build`（`wasmnest-desktop/`） | 桌面全量应用构建 |
| `pnpm run plugins:build`（`wasmnest-mobile/`） | 移动端构建（扫描 `apps/*/mobile`） |
| `pnpm run check:manifest` | `release-manifest.json` 一致性（改 id / rustLibrary / 端时必须） |

### 发布打包（应用仓根）

```bash
node scripts/package-plugins.mjs --list                                  # 看清单
node scripts/package-plugins.mjs --target all --plugin com.wasmnest.file-transfer   # 构建 + 打 zip
```

发布 tag：`apps-vX.Y.Z`（应用仓独立打 tag，不与平台/能力仓同号）。

---

## 排障

| 现象 | 原因 / 处理 |
| --- | --- |
| `dev:host` 报「未找到宿主构建产物」 | 先在平台仓 `pnpm run host:pack` |
| `host:pack` 报 `Found version mismatched Tauri packages` | 宿主工程 npm 包与 Rust crate minor 漂移：临时用 `--via-cargo`；根治是升 npm 侧版本（已修，重跑 `pnpm install`） |
| 宿主起应用报 wasm 加载失败 / ABI 不匹配 | 宿主产物与当前 SDK 不同版本：重跑 `host:pack`；`dev:host` 启动时会 warn 版本差 |
| 改了前端「没生效」 | 产物写去了别的目录：确认 `--out` / `WASMNEST_PLUGINS_DIR` 与宿主读的是同一个 |
| `pnpm run test` 卡住 | 用 `test:run`（watch 模式不退出） |
| 应用仓路径解析失败 | 平台仓须与应用仓同级（R1 布局），或设 `WASMNEST_PLATFORM_ROOT` |

## 相关真源

- 宿主任意挂载契约：`../wasmnest/wasmnest-desktop/src/shell/mount/useAppMount.ts`（`AppMountEnv` / `AppMountHandle`）
- 宿主应用路由表：同仓 `src/shell/composables/useShellApps.ts`（`SURFACE_ROUTES`，file-transfer = `/transfer`）
- 移动运行面契约：`../wasmnest/wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`（`UIRegistry`）
- 本仓导航与硬约束：`../../AGENTS.md`
