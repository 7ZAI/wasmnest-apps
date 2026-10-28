# CODE-MAP —— 应用仓结构与文件导航

> **本文件是「东西在哪」的导航，不是规则**。规则在 `AGENTS.md`（裁决与硬约束）、`docs/FRONTEND.md`（前端规范）、`docs/BACKEND.md`（后端规范）。
>
> **文档字面 ≠ 事实**：本文件的路径表按 2026-10-19 实测登记。引用任何路径前先 `ls` / `rg` 核对；与实际不符**先修本文件再继续**。

---

## 1. 三仓布局

本仓（应用仓）是三仓里唯一的**业务主场**。四仓按 R1 同场布局互为兄弟目录：

```text
<dev-root>/
├─ wasmnest/       平台仓：双端宿主 + 双端 SDK + 构建工具 + release-manifest.json
├─ wasmnest-apps/  应用仓（本仓）：业务 wasm 应用
├─ wasmnest-lib/   能力仓：应用无关引擎 / 契约（`contracts/`、`wasmnest-wasm-core/wit/`）
└─ wasmnest-test/  跨端测试仓（`cross-end-tests/`）
```

跨仓路径**必须**经 resolver 解析，禁止在调用方硬编码：

| 方向 | resolver | 环境变量覆盖 |
| --- | --- | --- |
| 应用 → 平台（仅 CI / 平台集成脚本） | `scripts/platform-paths.mjs`（宿主 resources 落点等） | `WASMNEST_PLATFORM_ROOT` |
| 应用 → 宿主运行时 | `scripts/host-runtime.mjs`（解析：显式 → 本机 `host:pack` → 缓存）、`scripts/fetch-host.mjs`（下载 + sha256 校验 + 解包）、`scripts/install-runtime.mjs`（L2 通用 runtime crate）、`host-runtime.lock.json`（版本真源镜像） | `WASMNEST_HOST_BIN` / `WASMNEST_HOST_APP` / `WASMNEST_HOST_VERSION` / `WASMNEST_HOST_CACHE` / `WASMNEST_HOST_PREFER` / `WASMNEST_HOST_BASE_URL` |
| 平台 → 应用 | `../wasmnest/scripts/app-paths.mjs`（读本仓源码；`app-script.mjs` 转发单 app 脚本） | `WASMNEST_APPS_ROOT` |

两个 resolver 都 fail-visible：目录缺失**抛错**，不返回可能无效的路径。

---

## 2. 仓内结构（实测）

```text
wasmnest-apps/
├─ apps/<slug>/desktop/            桌面端应用工程（挂载包形态）
│   ├─ plugin.json                 应用清单（id / platform / pluginType / rustLibrary / permissions / contributes）
│   ├─ src/entry.ts                挂载契约入口：mountApp(root, env)（可选 mountPreview(root, env)）
│   ├─ src/preview/                多任务卡片只读预览面（可选能力；见 FRONTEND.md §1.2.1）
│   ├─ src/appContext.ts           AppMountEnv → PluginContext 适配层
│   ├─ src/index.ts                dev-shell 兼容出口（仅导出 devMock；主宿主不加载）
│   ├─ src/components|composables|utils|i18n|__tests__/
│   ├─ rust/                       WASM 后端（file-transfer 例外：无本端 rust）
│   ├─ scripts/build.js            vite → cargo → 复制产物到 .build/plugins/<id> → injectWasmHash
│   ├─ vite.config.ts / vitest.config.ts / tailwind.config.js / postcss.config.js
│   ├─ package.json + pnpm-lock.yaml + pnpm-workspace.yaml    ← 独立 workspace
│   └─ icon.svg
├─ apps/<slug>/mobile/             移动端应用工程（宿主壳运行面）
│   ├─ plugin.json
│   ├─ src/index.ts                activate(context) / deactivate()
│   ├─ src/<domain>/               按域组织（bedcode 尤其明显：app / host / terminal / task / settings）
│   ├─ rust/ 或 wasmnest.sharedRustManifest（file-transfer）
│   └─ vite.config.ts（经 SDK wasmnestPlugin()）
├─ servers/<slug>/{desktop,mobile}/  服务型 wasm（L1 基础服务 / L2 内部业务；结构与应用**完全一致**）
├─ apps/file-transfer/rust/
│   ├─ core/                       双端共享业务核（端口 trait + 纯逻辑，**不依赖任何 SDK**）
│   └─ plugin/                     双端同构 wasm 产物源（宿主适配 + 命令面；不属于任何一端）
├─ scripts/
│   ├─ lib/projects.mjs            **唯一工程枚举点**：<group>/<slug>/<end>（group ∈ apps / servers）
│   ├─ run-apps.mjs                仓编排：逐工程串行跑同一条 package.json 脚本
│   ├─ e2e.mjs                     桌面端 E2E 运行器（构建 → 隔离插件目录 → 起 dev server → 跑 wdio）
│   ├─ e2e-dual.mjs                双端 E2E 运行器（桌面真宿主 + USB 真机；见 docs/E2E.md §10）
│   ├─ e2e-mobile.mjs              真机单端 E2E 运行器（真机 + 真移动宿主；见 docs/E2E.md §11）
│   ├─ platform-paths.mjs          应用 → 平台 resolver
│   ├─ plugin-wasm-config.mjs      桌面 wasip3 target / pinned nightly / 共享 target-dir
│   ├─ package-plugins.mjs         两端口构建 + 按插件打 zip（发布用）
│   ├─ replace-console.mjs         console.* → 统一 logger 的机械化替换
│   └─ ci/                         CI / 按 app 发布脚本（见 docs/CI.md）
│       ├─ app-info.mjs            解析 app 的端 / 插件 id / 版本（双端版本不一致即失败）
│       ├─ build-app.mjs           单 app 单端构建 + 打包到 dist/release
│       ├─ set-app-version.mjs     发布时写版本（plugin.json + package.json，全端同版本）
│       ├─ fetch-cross-repo.mjs    按 R1 布局检出平台仓 / 能力仓（只新建，不覆盖）
│       └─ prepare-platform.mjs    补齐 WIT 生成物 + 双端 SDK dist
├─ e2e/                           E2E 三条 lane（真实宿主内挂载真实 wasm app，脚本点击界面）
│   ├─ wdio.conf.ts                WDIO 配置（tauri-driver + WebKitWebDriver 驱动链）
│   ├─ wdio.dual.conf.ts           双端 lane 的 WDIO 配置（spec 集切到 e2e/dual/**）
│   ├─ harness/                    跨 app 通用层：driver.ts（桌面 DOM 原语）/ shell.ts（宿主壳）
│   │                              / expect.ts（webdriverio 断言）/ adb.ts + cdp.ts + mobile.ts（真机）
│   │                              / expect-node.ts（无浏览器会话的断言，真机 lane 用）
│   ├─ pages/<slug>.ts             该 app 的页面对象（app 语义，不碰组件内部结构）
│   ├─ specs/<slug>.spec.ts        桌面单端用例（一 app 一文件）
│   ├─ dual/<slug>-<场景>.spec.ts  双端用例（桌面真宿主 + 真机，见 docs/E2E.md §10）
│   └─ mobile/<slug>-<场景>.spec.ts 真机单端用例（真机 + 真移动宿主，见 docs/E2E.md §11）
├─ .github/workflows/
│   ├─ ci.yml                      PR / push：eslint + 各 app 单测
│   ├─ app-build-reusable.yml      可复用：单 app 单端装配 → 构建 → 打包 → 上传 artifact
│   ├─ app-build.yml               手动：按 app 触发构建（可勾选发布 tag + Release）
│   └─ app-release.yml             推 tag `<slug>-v<X.Y.Z>`：该 app 全端构建 + Release
├─ .cargo/config.toml              共享 target-dir（target/wasm-apps）+ jobs=4 + sccache
├─ .husky/pre-commit               暂存前端文件 eslint --quiet（error 阻断）
├─ eslint.config.js                前端资源访问红线（双端共用一份）
└─ docs/                           CODE-MAP.md / FRONTEND.md / BACKEND.md / E2E.md / CI.md
```

**每个 app 保留独立 pnpm workspace**（各有 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`，不合并）；根 `package.json` 只做编排，根 `node_modules` 只服务 lint / husky。

---

## 3. 应用清单

真源 = 各 `plugin.json`。下表的 `rustLibrary` 是**产物名**（`<rustLibrary>.wasm`）。

| 目录 slug | 插件 id | 端 | 前端入口 | pluginType | rustLibrary | Rust crate（包名 / 位置） |
| --- | --- | --- | --- | --- | --- | --- |
| ai-chatbox | `com.wasmnest.ai-chatbox` | desktop + mobile | `entry.ts` / `index.ts` | 桌面 `rust-ts`；移动 `wasm` | `wasmnest_plugin_ai_chatbox`（两端同名） | `wasmnest-plugin-ai-chatbox` @ `desktop/rust`；`wasmnest_plugin_ai_chatbox` @ `mobile/rust` |
| bedcode（显示名 BedCode） | `com.wasmnest.bedcode` | desktop + mobile | `entry.ts` / `index.ts` | 桌面 `rust-ts`；移动 `wasm` | `bedcode_plugin_terminal_session`（两端同名） | `bedcode-plugin-terminal-session` @ `desktop/rust`；`bedcode_plugin_terminal_session` @ `mobile/rust` |
| file-transfer | `com.wasmnest.file-transfer` | desktop + mobile（`platform: "both"`） | `entry.ts` / `index.ts` | 桌面 `rust-ts`；移动 `wasm` | `wasmnest_plugin_file_transfer`（两端同名） | 单产物 `wasmnest-plugin-file-transfer` @ `apps/file-transfer/rust/plugin`；共享核 `wasmnest-file-transfer-core` @ `apps/file-transfer/rust/core` |
| monitor（**`servers/` 分组**） | `com.wasmnest.monitor` | desktop + mobile | `entry.ts` / `index.ts` | 桌面 `rust-ts`；移动 `wasm` | `wasmnest_plugin_monitor`（两端同名） | `wasmnest-plugin-monitor` @ `servers/monitor/desktop/rust`；`wasmnest_plugin_monitor` @ `servers/monitor/mobile/rust` |
| auth-center（**`servers/` 分组**） | `com.wasmnest.auth-center` | desktop | `servers/auth-center/desktop/src/entry.ts` | `rust-ts` | `wasmnest_plugin_auth_center` | `wasmnest-plugin-auth-center` @ `servers/auth-center/desktop/rust` |

> **auth-center 现状（issue #6，已注册接管）**：六域全部就位——
> `rust/src/{pairing,policy,trust,consent,auth_records,auth_http}`（用例自 bedcode 逐字
> 搬入做行为等价）+ `http_routes`（七端点动态路由表）+ **互调 api 面**
> （`plugin.json.api` ↔ `#[plugin_api] AuthCenterApi`，19 条，含宿主
> `auth-method-invoke` 的 `auth-grant`）+ 认证记录库（`auth_pairings` /
> `auth_biometric_keys` / `auth_connection_history`，插件私有库 = 唯一真源）。
> 页面数据面只保留密钥代次；配对码 / QR、可信设备、连接历史**不设页面**（命令与
> 互调 api 面保留，由 BedCode 设备中心等消费方经互调取用——2026-10-25 用户裁定
> 页面收敛）；「接入应用」卡展示
> 消费方（bedcode / file-transfer）与宿主运行态（`plugin_list_loaded`），清单在
> `src/consumers.ts` 声明式登记。原「决策计数」占位已按用户裁定删除。
>
> **注册切换已落地**（K4 原子替换，issue #6 切换票）：
> - `activate` 末尾调 `auth_center_register`（排在 api dispatcher / 密钥环两个硬失败
>   步骤之后），并按注册结果登记 `/api/auth/*` 七端点——注册失败时一条都不登记，
>   页面如实显示 `not_ready` + 原因（fail-closed，入站全拒）；
> - `deactivate` 注销中心角色并清空注册记录；
> - bedcode **已去注册**：`activate` / `deactivate` 不再调 `auth-center-*`，路由表删除
>   认证七条，结构锁 `bedcode_does_not_register_or_unregister_auth_center` 守着；
> - 消费方改指：bedcode 设备中心命令 / consent / 信任 / 密钥轮换 / 连接记录经
>   `auth_center_client.rs` 互调；file-transfer `auth_center.rs` 的目标常量与
>   `#[plugin_api]` manifest 均指向 `com.wasmnest.auth-center`；
> - 数据冷启动：认证记录库是**新库**，旧配对记录不迁移（D5）——升级后既有移动端
>   需要重新配对（旧 token 由旧密钥签发，注册切换后不再被本中心接受）。
>
> 排障口径（`enforce_connection_policy` 的 `deny_kind`）：`no_center` = 本插件未注册
> （看注册失败日志）；`unavailable` = 中心实例不可调（trap / 超时）；`policy` = 本中心
> 验签或策略拒绝（撤销 / 过期 / 结构非法）。
>
> **SDK 依赖 = registry 发布物**（uat / 发布线）：npm `@binblink/wasmnest-plugin-sdk-*`
> `0.0.1` + crate `wasmnest-plugin-api` / `wasmnest-plugin-api-mobile` `=0.0.1`，
> `pnpm-lock.yaml` 按 registry 解析（带 integrity）、`Cargo.lock` 带 `source` + `checksum`。
> `file:` / `[patch]` 只属本机 link 态（`pnpm run link:platform` 写入，状态不得提交），`dev`
> 线才是内部依赖相对路径的联调口径。

### 命名纪律

- **插件 id = 目录 slug**（`com.wasmnest.<slug>`）：2026-10-25 起唯一历史例外已归一——`bedcode` 由 `com.wasmnest.terminal-session` 改名 `com.wasmnest.bedcode`。仅显示名 / rustLib 名豁免（ADR 0056）。新建应用一律 `com.wasmnest.<slug>`。
- **`rustLibrary` = Cargo 包名的下划线归一化**：cargo 把包名里的 `-` 归一化成 `_` 生成产物。例：Cargo `bedcode-plugin-terminal-session` → 产物 `bedcode_plugin_terminal_session.wasm` → `rustLibrary` 填后者。**填连字符形式会找不到产物**。
- 新增 / 改名应用时同步五处：`plugin.json`、`package.json`、Cargo 包名、`rustLibrary`、i18n 命名空间，外加平台仓 `release-manifest.json`。

### file-transfer 双端单产物（ADR 0050）

`apps/file-transfer/{desktop,mobile}` 下**只有前端**，Rust 全在应用级 `apps/file-transfer/rust/`：

- `rust/core/` —— 共享业务核（端口 trait + 纯逻辑，零 SDK 依赖，可 native 单测）
- `rust/plugin/` —— 双端同构 crate，**不属任何一端**；桌面 `desktop/scripts/build.js` 的 `--manifest-path ../rust/plugin/Cargo.toml` 与移动 `package.json` 的 `wasmnest.sharedRustManifest: "../rust/plugin/Cargo.toml"` 都指向它

crate 内引用端侧文件按 `apps/file-transfer/rust/plugin/` 起算（**上溯三级**到应用根）：

```rust
// rust/plugin/src/lib.rs
include_str!("../../../desktop/plugin.json")            // 内嵌桌面侧清单副本
// rust/plugin/src/auth_center.rs
#[plugin_api(manifest = "../../../bedcode/desktop/plugin.json")]   // 对侧清单，宏按 CARGO_MANIFEST_DIR 解析
```

> ⚠ 该 rust 层目录深度历史上变过两次（`desktop/rust` → `rust-plugin` → `rust/plugin`）。**移动这些目录时，上面两处相对路径必须同改**，且必须跑一次 wasm 目标构建才算验证（native `cargo test` 不展开 `#[plugin_api]` 宏）。

---

## 4. 产物流向

```text
apps/<slug>/<end>/ 源码
   │ 前端：desktop = vite 单文件包（全依赖打包，无 externals）
   │       mobile  = SDK vite 插件（vue / vue-i18n / pinia 外置为宿主全局 __WASMNEST_SHARED__）
   │ 后端：desktop（一般应用）= wasm32-wasip3 直出 Component
   │       mobile + file-transfer = wasm32-unknown-unknown + 平台组件化工具
   ▼
平台仓宿主资源（dev 期直接写入，宿主读同一目录）
   desktop: ../wasmnest/wasmnest-desktop/src-tauri/resources/plugins/desktop/<id>/
   mobile : ../wasmnest/wasmnest-mobile/src-tauri/resources/plugins/mobile/<id>/
   ├─ index.js        前端入口（桌面宿主经 useAppMount 动态 import）
   ├─ plugin.json     构建期填充 contributes/permissions，桌面另注入 wasmHash
   ├─ icon.svg
   └─ <rustLibrary>.wasm
```

桌面 app 的 `pnpm run build` 默认写**本仓** `apps/<slug>/desktop/.build/plugins/<appId>/`（CI 打包经 `scripts/ci/build-app.mjs` 的 `--out` staging 收集，`scripts/ci/check-release-purity.mjs` 保证产物里不含宿主痕迹）；平台 `tauri:dev` / `dev-run.js` 需要产物进宿主 resources 时显式 `--out`；移动 app 的 `wasmnest-plugin build` 只产自身 `dist/`，**写进宿主 resources 由平台仓移动构建负责**（`wasmnest-mobile/scripts/plugin-build.js`；file-transfer/mobile 的 `build` 已直接指向该包装脚本）。

**发布产物（CI）**：`scripts/ci/build-app.mjs` 在上述构建链之后经 `package-plugins.mjs --skip-build` 打包为
`dist/release/<slug>-<end>-v<version>.zip` + 同名元数据 JSON（详见 `docs/CI.md` §5）。

共享 Cargo target 目录 = `<appsRoot>/target/wasm-apps`（`.cargo/config.toml` 的 `build.target-dir` + 各 `build.js` 显式 `--target-dir`，两处注释互相指认）。

---

## 5. 跨仓真源索引

改任何跨仓语义前，去真源读，不要凭本仓推测。**以下路径均已实测存在**。

### 平台仓 `../wasmnest`

| 需求 | 路径 |
| --- | --- |
| 桌面挂载契约（宿主侧真源） | `wasmnest-desktop/src/shell/mount/useAppMount.ts`（`mountApp` + 可选 `mountPreview`）、`wasmnest-desktop/src/shell/mount/AppMountSlot.vue`；预览面装载 = 同目录 `AppPreviewTile.vue`；机制票 `.scratch/2026-10-20-app-preview-contract/spec.md` |
| 桌面应用 → 宿主路由表 | `wasmnest-desktop/src/shell/composables/useShellApps.ts`（`SURFACE_ROUTES`） |
| 移动运行面契约（类型真源） | `wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`（`UIRegistry`） |
| 移动宿主注册表 | `wasmnest-mobile/src/shell/registry.ts` |
| manifest 校验 / 生成 / wasmHash | `wasmnest-desktop/packages/plugin-sdk-desktop/bin/{manifest-validate.js,manifest-gen.js,wasm-hash.js}` |
| 宿主运行时版本真源（平台 ↔ 应用） | 平台 `release-manifest.json` 的 `hostRuntime` ↔ 应用仓 `host-runtime.lock.json`（`scripts/ci/sync-host-lock.mjs` 同步；应用侧解析 `scripts/host-runtime.mjs`、下载 `scripts/fetch-host.mjs`）；口径 `wasmnest-apps/.scratch/2026-10-21-host-runtime-distribution/CONTRACT.md` |
| 权限词汇真源 | `wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`（生成物：同 SDK `bin/permission-vocabulary.json`） |
| 跨仓版本 / 发布 | `release-manifest.json`、`scripts/check-release-manifest.mjs` |
| wasip3 工具链 | `scripts/wasip3-toolchain.sh`（`WASIP3_NIGHTLY` 单一事实源） |
| 构建 / dev 编排 | `wasmnest-desktop/scripts/{plugin-build.js,dev-run.js}`、`wasmnest-mobile/scripts/plugin-build.js`；**`plugin-watch.js` 已随 SDK 发布**（`wasmnest-desktop/packages/plugin-sdk-desktop/bin/plugin-watch.js`，应用侧经包名导入） |
| 宿主产物与运行时发布 | `wasmnest-desktop/scripts/package-host.mjs`（`dist-host/` + tar.gz + sha256 + `host-version.json`）、`.github/workflows/host-release.yml`、`scripts/{set-host-version.mjs,update-host-runtime-artifacts.mjs}` |
| SDK 发布物 | `wasmnest-desktop/packages/plugin-sdk-desktop/{bin/plugin-watch.js,tools/componentize/**}`、`scripts/package-sdks.mjs`（含发布内容断言）、`.github/workflows/sdk-publish.yml` |
| L2 通用 runtime crate | `wasmnest-desktop/src-tauri/`（包名 `wasmnest-desktop-runtime`、`[[bin]] wasmnest-desktop`、随包 `shell-dist/`、`run_with(plugins_dir)`）；门禁 `wasmnest-desktop/scripts/{sync-shell-dist.mjs,check-runtime-crate.mjs}` |

### 能力仓 `../wasmnest-lib`

| 需求 | 路径 |
| --- | --- |
| 契约包名与版本真源 | `contracts/wasmnest-plugin-package.rs` |
| 核心 WIT | `wasmnest-wasm-core/wit/core.wit`（各能力域另见 `wit/<domain>.wit`） |
| 跨端互连测试 | `../wasmnest-test/cross-end-tests/` |

### 平台仓锁（读本仓源码的测试；改本仓结构 / 文案前先看）

| 锁 | 钉住什么 |
| --- | --- |
| `wasmnest-desktop/src/__tests__/hostAppBoundaryLock.test.ts` | 宿主零 app 源码 import、零 `__WASMNEST_SHARED__`、零旧贡献面；逐字校验**六个**桌面 `entry.ts`（5 个 `apps/` + `servers/auth-center`）的 `mountApp` 契约；**L5** 预览契约锁（六个 entry 必须导出 `mountPreview` + 关键字段；预览路径禁 `refreshChannelToken` / 写存储） |
| `wasmnest-desktop/src/__tests__/shell/appPreviewTile.test.ts` | 多任务预览面行为（缺失 / 成功 / 抛错 / 超时 / 卸载 / 晚到结果 / 不换发令牌 / 装饰层属性） |
| `wasmnest-desktop/src/__tests__/shell/recentsWiring.test.ts` | 多任务接线：app 卡用 `AppPreviewTile`、system 卡保留 glyph、预览不在动作按钮内 |
| `wasmnest-desktop/src/__tests__/i18nDriftLock.test.ts` | 宿主 `src/i18n/host-{zh-CN,en}.ts` ↔ `apps/bedcode/desktop/src/i18n/host-{zh-CN,en}.ts` **逐字一致** |
| `wasmnest-desktop/src/__tests__/tailwindContentCoverage.test.ts` | 宿主 Tailwind content 不得残留 app 路径 |
| 平台仓 `support/appPaths.ts` 派生的移动侧锁 | 经 `WASMNEST_APPS_ROOT` / `appPath(slug, end, ...)` 读本仓源码 |

---

## 6. 常用核对命令

```bash
# 全仓 crate 清单（排除 node_modules / target）
find . -name Cargo.toml -not -path "*/node_modules/*" -not -path "*/target/*" | sort

# 某 app 的脚本能力（不要凭记忆假设存在 dev / test:run）
cat apps/<slug>/<end>/package.json | head -20

# 共享 target-dir 是否生效（应输出 <appsRoot>/target/wasm-apps）
cd apps/<slug>/<end>/rust && cargo metadata --no-deps --format-version 1 | grep target_directory

# crate 内路径引用（file-transfer rust 层移动后必查）
rg -n 'include_str!|plugin_api\(manifest' apps/file-transfer/rust
```

> 本文件若与代码 / 平台仓真源冲突，**以真源为准并回来修正本文件**。
