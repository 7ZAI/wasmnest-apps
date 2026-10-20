# AGENTS.md

> **本文件是 wasmnest-apps（应用仓）的裁决口径与硬约束，以及文档入口。**
> 只给方向、判据与导航；结构细节、契约版本、历史与踩坑在各自真源里（子文档、代码本身、平台仓 SDK、能力仓 WIT、`release-manifest.json`），需要时按指针去读，不在本文件复制。

## 0. 先读哪份文档

| 你要做什么 | 去哪读 |
| --- | --- |
| 找文件 / 目录 / 跨仓真源 / 应用清单 / 产物流向 | **`docs/CODE-MAP.md`** |
| 写或改前端（桌面挂载包 / 移动壳运行面 / i18n / 样式 / 红线 / 测试） | **`docs/FRONTEND.md`** |
| 写或改 Rust 后端（crate / 命令面 / 权限 / 构建目标 / 日志错误 / 测试） | **`docs/BACKEND.md`** |
| 判断优先级、安全红线、提交与完成定义 | 本文件 |
| 通用规范：git 提交 / 注释命名 / 测试与验证 / 版本号管理 / issue 管理（四仓共享真源） | **`../wasmnest/docs/public/`**（`git.md` / `commenting.md` / `testing.md` / `versioning.md` / `issues.md`） |

三份子文档与本文件同仓同级维护；**公共规范（`../wasmnest/docs/public/`）与各仓硬约束同级，通用内容不在本仓复制**；本文件的机制描述若与子文档或真源冲突，以真源为准并回来修正**。

---

## 1. 定位与冲突裁决

**本仓定位**：三仓（应用仓 / 平台仓 / 能力仓）里唯一的**业务主场**。一切产品语义（会话、终端、文件传输、AI、Agent 管理……）都住本仓的 wasm 应用；平台仓只提供机制与闸门，能力仓只提供应用无关引擎。新增能力先问「这是机制还是产品语义」，产品语义落应用，别推给宿主。

冲突按下述优先级裁决（高者胜）：

1. **用户当前明确指令**
2. **安全与架构红线**（§4）——确需越线时停下向用户确认，禁止自行放松
3. **本文档与子文档的硬约束**（「必须 / 禁止」字样）
4. **跨仓真源**（平台仓 SDK / 能力仓 WIT / `release-manifest.json` / 代码自身）
5. **通用工程经验**

维护口径：

- **路径基准**：仓内路径相对应用仓根；跨仓路径与 resolver 见 `docs/CODE-MAP.md` §1。
- **文档字面 ≠ 事实**：引用任何路径 / 命令 / 锁名 / 版本前先用 `ls` / `rg` 核对；与实际不符先修文档再继续。（本仓已多次出现文档滞后于目录迁移的情况，file-transfer 的 rust 层尤甚。）
- **最小改动**：只改任务必要文件；禁止顺手重构相邻代码、擅自升级依赖；设计取舍不猜，先问用户。
- **项目阶段（研发起步期）**：无真实用户、无对外 ABI 兼容义务——破坏性变更可直接进行，但跨仓契约按 tag 钉住（§3），退役面必须 **fail-visible**（点名缺失 + 给出路），禁止静默降级成「查不到就返回空」。

---

## 2. 三仓边界（禁止反向引用）

- 应用只依赖**平台仓 SDK 包**：桌面 `@binblink/wasmnest-plugin-sdk-desktop`、移动 `@binblink/wasmnest-plugin-sdk-mobile`（开发期 `file:` 指向平台仓）。应用**零宿主源码 import**、零平台仓内部路径引用；宿主前端同样禁止 import 应用源码（运行时装载）。
- 平台仓读应用源码的**唯一入口**是两个 resolver（见 `docs/CODE-MAP.md` §1），禁止在调用方散落硬编码。
- **ABI / WIT 真源不在本仓**：核心 WIT 在能力仓，端组合与 SDK 生成物在平台仓（`rust/wit` 是生成物，禁止手改）。应用只是 SDK 绑定使用方——改契约不在本仓进行。
- 平台仓读本仓源码的**锁**（改本仓结构 / 文案前先看）：见 `docs/CODE-MAP.md` §5。关键三条：桌面边界锁（`hostAppBoundaryLock`，逐字校验四个桌面 `entry.ts`）、i18n drift 锁（宿主 ↔ `apps/bedcode/desktop/src/i18n/host-*` 逐字一致）、Tailwind content 覆盖锁。

---

## 3. 发布与版本钉法

- 平台仓 `release-manifest.json` 是**跨仓版本唯一表达**：`repos.apps.tag` = 应用仓 HEAD 精确 tag（当前线 `apps-v0.0.x`），`apps` 段逐端列 `<rustLibrary>.wasm`。
- 判据由平台仓 `pnpm run check:manifest` 校验。**新增 / 改名 / 停用应用或变更 `rustLibrary` 时**，除本仓提交外必须在平台仓同步更新该 manifest，否则装配红。
- 应用仓独立打 tag：`apps-vX.Y.Z`（不与其他仓同号）。发布装配按该 tag 取应用仓；未打 tag 的本地改动不进发布。
- **版本号只在发布时设置**（dev 日常不改）：bump 号段 / 各仓设置点 / 发布动作见 `../wasmnest/docs/public/versioning.md`；应用版本号仅作显示语义，装配不读它。

---

## 4. 硬约束

### 4.1 安全

- 禁止提交密钥 / 凭据 / token；禁止进日志、进文档；凭据只记长度不落明文。
- 不新增旁路认证 / 静默降级；失败一律 fail-closed 或 fail-visible。
- 应用自己的业务真源（私有库 / KV / 登记表）由应用自持；不推给宿主内核（宿主加业务状态即越线）。
- 前端不得直连网络 / 文件 / 导航原语（静态锁与放行清单见 `docs/FRONTEND.md` §4）。

### 4.2 测试

> **通用测试规范（两种形态 / 禁止交付 / 测试数据临时目录 / Seam 3 锁纪律 / 验证底线）真源 = `../wasmnest/docs/public/testing.md`**（不复制）。本段只保留本仓特有规则：

- 每 app 至少覆盖：契约（`mountApp` / `activate` 行为）、关键逻辑（纯函数 / composable）、边界与错误路径（禁止交付类型见 public/testing.md §2）。
- 运行位置与差异（含「哪些 app 没有哪些脚本」）见 `docs/FRONTEND.md` §6 与 `docs/BACKEND.md` §7。
- native 测试不展开 `#[plugin_api]` 宏、不产 wasm 产物：涉及宏路径 / 互调面 / 构建目标的改动，必须补跑一次 wasm 目标构建才算验证。

### 4.3 注释、命名与提交

> **通用注释 / 命名规范真源 = `../wasmnest/docs/public/commenting.md`；通用 git 提交规范真源 = `../wasmnest/docs/public/git.md`**（不复制）。本段只保留本仓特有补充：

- Commit scope 用 app slug（如 `(file-transfer)`）；commit 格式、禁止 AI 标记、--force 禁令、开工自检、在途改动不碰、只提交源码、锁文件只经包管理器变更等**全部通用于 `../wasmnest/docs/public/git.md`**。
- 组件 PascalCase、composable `use` 前缀 camelCase、文件名与导出一致（命名通则见 public/commenting.md §2）。

---

## 5. 命令

> **包管理器一律 pnpm（禁止 npm）**；各 app 目录独立 `pnpm install`。**禁止 `pnpm run test`**（vitest watch 不退出）——一律 `test:run`。

### 本仓（应用仓根）

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装根依赖（eslint / prettier / husky）；各 app 依赖仍需进各自目录装 |
| `pnpm run test:run` | 逐 app 串行跑 `test:run`（`scripts/run-apps.mjs`；缺脚本打印 skip，不静默略过） |
| `pnpm run build` | 逐 app 串行跑 `build` |
| `pnpm run lint` | 根 eslint（0 error 口径；warning 不阻断） |
| `pnpm run format` | prettier 写 `apps/**/src/**` |

### 单个 app（`apps/<slug>/<end>/` 内）

| 命令 | 说明 | 例外 |
| --- | --- | --- |
| `pnpm run test:run` | 该 app 的 vitest | `file-transfer/mobile` 无此脚本（也无 `vitest.config.ts`） |
| `pnpm run build` | 桌面 = `node scripts/build.js`；移动 = SDK CLI / 平台包装脚本 | `file-transfer/mobile` 的 build 直接指向 `wasmnest-mobile/scripts/plugin-build.js` |
| `pnpm run build:frontend` / `build:rust` | 桌面分段构建 | `bedcode/desktop` 的 `build:rust` = `build.js --rust-only`；移动端无分段脚本 |
| `pnpm run dev` | 桌面 = `build.js --watch`；移动 = SDK dev-shell（HMR） | **`bedcode/desktop` 无 dev 脚本**（前端最重，dev 期不参与 watch） |
| `pnpm run dev:host`（`file-transfer/desktop`） | **应用工程内起真实桌面宿主**：默认用**宿主构建产物**（平台仓 `pnpm run host:pack` 产出，debug profile 二进制 + 已嵌入的宿主前端 dist），本 app 产物写 `--plugins-dir`（默认 `.dev-host/plugins`），经 `WASMNEST_PLUGINS_DIR` 递给宿主 → 宿主 watcher 触发前端热重载，**不依赖平台仓源码**。宿主产物缺失 fail-visible（提示先 `pnpm run host:pack`）；**无平台仓 dev-run 回退分支**（单路径） | 桌面其余 app 暂未装该脚本，需真宿主时到平台仓跑 `tauri:dev` |
| `node scripts/build.js --out <dir>` | 产物目录参数化：写 `<dir>/<appId>/` 而非平台仓宿主 resources（也可用 env `WASMNEST_PLUGINS_DIR`）。默认行为不变 | 仅 `file-transfer/desktop` 支持 |
| `cargo test --manifest-path <crate>/Cargo.toml` | 该 crate 的 Rust 单测（native） | `bedcode/desktop` 另有 `pnpm run test:rust` |

> 桌面 app 的 `build` 直接把产物写平台宿主 resources；移动 app 的 `build` 默认只产出自身 `dist/`，**写进宿主 resources 以平台仓移动构建为准**。

### 平台仓（跨仓操作；命令在平台仓执行）

| 命令 | 说明 |
| --- | --- |
| `pnpm run tauri:dev`（`wasmnest-desktop/`） | 桌面宿主 dev：自动补建缺失 / 陈旧 wasm、重建陈旧挂载包、起插件 watch |
| `pnpm run plugins:build`（`wasmnest-desktop/`） | 桌面全量应用构建（经 `app-script.mjs` 调本仓各 app `build`） |
| `node scripts/app-script.mjs <slug> desktop <script>` | 平台侧转发单 app 脚本 |
| `pnpm run plugins:build` / `tauri:android:dev`（`wasmnest-mobile/`） | 移动端构建（扫描 `apps/*/mobile`）/ Android dev |
| `pnpm run check:manifest` | `release-manifest.json` 一致性 |
| `pnpm run check:wit` | WIT 拼装漂移锁（仅改了契约真源后需要） |

### 仓级工具（应用仓根）

| 命令 | 说明 |
| --- | --- |
| `node scripts/package-plugins.mjs --list` | 打印解析后的插件清单（不构建不打包） |
| `node scripts/package-plugins.mjs --target <desktop\|mobile\|all> [--plugin <id>] [--only/--exclude]` | 构建并收集产物、按插件打 zip |
| `node scripts/ci/build-app.mjs --app <slug> --end <desktop\|mobile>` | 单 app 单端构建 + 打包到 `dist/release/<slug>-<end>-v<version>.zip`（+ 元数据 JSON；CI 与本机同一条链） |
| `node scripts/ci/app-info.mjs --app <slug>` | 解析 app 的端 / 插件 id / 版本；双端版本不一致即失败（发布判据） |
| `node scripts/ci/set-app-version.mjs <slug> <x.y.z>` | **发布时**写 app 版本（`plugin.json` + `package.json`，全端同版本） |
| `node scripts/ci/fetch-cross-repo.mjs` / `node scripts/ci/prepare-platform.mjs` | CI 用：按 R1 布局检出平台仓 / 能力仓；补齐 WIT 生成物与双端 SDK `dist`（只新建，不覆盖既有检出） |
| `node scripts/replace-console.mjs <desktop\|mobile> [appDirName]` | `console.*` → 统一 `logger`（仅处理自带 `src/utils/frontendLogger.ts` 的 app，当前只有 `bedcode/desktop`） |

**构建环境约定**：`.cargo/config.toml` 强制 `rustc-wrapper = "sccache"`（未装则 cargo 直接失败，这是显性设计，不要绕过）；**绝不要设 `CARGO_INCREMENTAL=1`**（sccache 会拒绝执行，一切 cargo 命令成批失败）；全仓共享 `target/wasm-apps`（不要用 `cargo clean` 清平台仓目录）；`jobs = 4` 可用 `CARGO_BUILD_JOBS` 覆盖（内存吃紧时调小）。

---

## 6. 任务路由：改 X 先读 Y

| 任务 | 动手前必读 |
| --- | --- |
| 改桌面应用界面 / 交互 | `docs/FRONTEND.md` §1 + 该 app `entry.ts` / `appContext.ts` + 平台 `src/shell/mount/useAppMount.ts`；多任务卡片预览面另读 `docs/FRONTEND.md` §1.2.1（可选 `mountPreview`，平台 L5 锁钉契约）；跑该 app vitest + 真实宿主目验 |
| 改移动应用界面 / 运行面 | `docs/FRONTEND.md` §2 + 平台 `plugin-sdk-mobile/src/types.ts`（`UIRegistry`）+ `wasmnest-mobile/src/shell/registry.ts`；优先 dev-shell 预览 |
| 写 / 改 Rust 后端 / 新增命令 | `docs/BACKEND.md`（尤其 §8 检查清单）+ 该 crate + SDK rust crate；命令面与 `plugin.json` 同步 |
| 改 manifest / 权限 | `docs/BACKEND.md` §5 + SDK `rust/src/permission.rs`（唯一词汇真源）——**不得自造词汇表外的权限字符串** |
| 改 i18n | `docs/FRONTEND.md` §3（注意 `bedcode/mobile` 按域分散、bedcode desktop 有宿主副本 drift 锁） |
| 改 WIT / ABI / 契约 | **不在本仓改**：去能力仓（WIT 真源）与平台仓（端组合 / SDK 生成物）；改完重拼并按当前 SDK **全量重建**本仓相关 app 产物（版本进入 import 名，旧产物实例化期被点名） |
| 新增桌面应用 | 复制现有桌面 app 骨架（改五处命名，见 `docs/CODE-MAP.md` §3）→ 平台仓：`useShellApps.ts` 路由表 + `hostAppBoundaryLock.test.ts` 清单 + `plugin-build.js` 的 `PLUGINS` + `dev-run.js` 的 `PLUGIN_WATCH_CMDS` + `release-manifest.json` |
| 新增移动应用 | 复制现有移动 app 骨架；平台移动构建脚本自动扫描 `apps/*/mobile` → 更新 `release-manifest.json` |
| 跨应用互调 | `docs/BACKEND.md` §3（平台 `host-api-call` + 被调方 `plugin.json.api` 声明 + `#[plugin_api]`）；**禁止跨应用直接耦合源码** |
| 发布 / 版本 | §3 + `docs/CI.md`（按 app 独立发版：`<slug>-v<X.Y.Z>` tag / 手动构建）+ `scripts/package-plugins.mjs` |
| 排查「改了没生效」/ 产物路径 | `docs/CODE-MAP.md` §4 + 平台 `scripts/app-paths.mjs`、`wasmnest-desktop/scripts/{dev-run.js,plugin-watch.js}`；确认产物是否真写进了平台宿主 resources |

---

## 7. 完成定义与验证

**本仓 CI = GitHub Actions**（`.github/workflows/`：`ci.yml` = eslint + 各 app 单测；`app-build.yml` / `app-release.yml` / `app-build-reusable.yml` = 按 app 独立构建与发布，说明与排障见 `docs/CI.md`）。CI 不替代本地验证；验证 = 本地命令实跑 + 平台仓侧锁 + CI 绿。（通用验证底线——实跑贴结果 / 钩子跳过 ≠ 通过 / 禁止假绿——见 `../wasmnest/docs/public/testing.md` §5。）**当前迁移期口径（用户 2026-10-18）**：不逐项跑集成 / 全量回归，收口后统一跑；日常改动至少跑针对性单测与所在 app 测试。以下为收口后的标准清单，按改动类型执行，**必须实际运行并贴出结果**，无法运行要说明原因与风险：

- 改前端（任一 app）→ 该 app `pnpm run test:run` 全绿；应用仓根 `pnpm run lint`（0 error）；UI 改动至少在一个真实环境目验（桌面：平台 `tauri:dev`；移动：dev-shell 或 Android dev）。
- 改 Rust 后端 → 该 crate `cargo test` 全绿；确认 `plugin.json` 命令 / 权限与实现一致；构建产物成功写出（`pnpm run build` 或平台 `plugins:build`）。
- 改 manifest / 权限 / 应用清单 → 构建链 `manifest --check` 通过；平台仓 `pnpm run check:manifest` 通过（涉及 id / rustLibrary / 端变化时）。
- 改桌面 `entry.ts` / `appContext.ts` → 平台仓桌面测试全量（含 `hostAppBoundaryLock` / `i18nDriftLock`）；真实宿主装载目验。
- 改桌面多任务预览面（`mountPreview` / `src/preview/**`）→ 该 app `pnpm run test:run` + `build:frontend`（证明预览被包含进单文件包）；平台仓桌面测试全量（含 **L5** 预览契约锁）；真实宿主从多任务层目验四张卡（预览 / 回退 / 布局不跳 / Esc 无残留）。预览只读且无副作用（不启动通知 / 轮询 / 连接 / 模型请求），不得为预览新增写命令或放宽权限。
- 改移动运行面 / 壳交互 → 平台仓移动测试全量；Android dev 目验。
- 改共享业务核（`apps/file-transfer/rust/core`）或双端同构 crate（`rust/plugin`）→ 该 crate `cargo test` + **双端 app 各自构建成功**（native 测试不覆盖宏路径）。
- 新增 / 删除应用 → §6 对应跨仓清单逐项核对，并在平台仓跑对应测试。

**已知漂移（本仓不代为修复，写新代码以本仓现有 app 为准）**：平台仓桌面 SDK 的 `README.md` / `template/` / `dev-shell/` 仍是旧贡献面形态（`activate(context)` + `__WASMNEST_SHARED__` 外置），与 ADR 0057 后的挂载包形态不一致。

---

## 8. 文档索引

| 需求 | 入口 |
| --- | --- |
| 结构 / 导航 / 应用清单 / 产物流向 | 本仓 `docs/CODE-MAP.md` |
| 前端规范（双端） | 本仓 `docs/FRONTEND.md` |
| 后端规范（Rust / WASM） | 本仓 `docs/BACKEND.md` |
| CI / 按 app 独立构建与发布（触发方式 / tag / 跨仓装配 / 排障） | 本仓 `docs/CI.md`、`.github/workflows/`、`scripts/ci/` |
| 桌面挂载契约（宿主侧真源） | `../wasmnest/wasmnest-desktop/src/shell/mount/useAppMount.ts`（`mountApp` + 可选 `mountPreview`）、`src/shell/mount/{AppMountSlot,AppPreviewTile}.vue`、`src/shell/composables/useShellApps.ts`；预览机制票 `../wasmnest/.scratch/2026-10-20-app-preview-contract/spec.md` |
| 移动运行面契约 | `../wasmnest/wasmnest-mobile/packages/plugin-sdk-mobile/src/types.ts`、`../wasmnest/wasmnest-mobile/src/shell/registry.ts` |
| 权限词汇 / manifest 校验 | `../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/rust/src/permission.rs`、同 SDK `bin/{manifest-gen.js,manifest-validate.js,wasm-hash.js}` |
| 跨仓版本 / 发布 | `../wasmnest/release-manifest.json`、`../wasmnest/scripts/check-release-manifest.mjs` |
| 四仓通用规范（git 提交 / 注释命名 / 测试验证 / 版本号管理 / issue 管理） | `../wasmnest/docs/public/{git,commenting,testing,versioning,issues}.md` |
| 契约包名与版本真源 | `../wasmnest-lib/contracts/wasmnest-plugin-package.rs`、`../wasmnest-lib/wasmnest-wasm-core/wit/core.wit` |
| 跨端互连测试 | `../wasmnest-test/cross-end-tests/` |
