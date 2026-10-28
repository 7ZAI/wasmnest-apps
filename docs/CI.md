# CI —— GitHub Actions 构建与按 app 发布

> 本文件是 CI 的**唯一说明入口**（触发方式 / 版本纪律 / 跨仓装配 / 产物形态 / 排障）。
> 规则裁决看 `AGENTS.md`；结构与产物流向看 `docs/CODE-MAP.md`。
> 文档字面 ≠ 事实：改工作流或脚本后回来同步本文件。

---

## 1. 工作流一览

| 文件                                       | 触发                            | 作用                                         | 产物                           |
| ------------------------------------------ | ------------------------------- | -------------------------------------------- | ------------------------------ |
| `.github/workflows/ci.yml`                 | PR / push `dev`·`main` / 手动   | `eslint`（0 error，仓级一条）+ **逐工程** `test:run`（`test` 矩阵）+ 各 crate `cargo test`（native） | 无（只做校验）                 |
| `.github/workflows/app-build.yml`          | **手动**（选工程 + 端 + 版本）  | 单工程构建；勾 `publish` 则建 tag + Release  | workflow artifact（+ Release） |
| `.github/workflows/app-release.yml`        | **推 tag `<slug>-v<X.Y.Z>`**    | 该工程全端构建 + GitHub Release              | Release 附件                   |
| `.github/workflows/app-build-reusable.yml` | 仅被上面两个 `uses:` 调用       | 单工程单端：装配跨仓 → 构建 → 打包 → 上传   | artifact（30 天）              |

**每个工程（`apps/` 的应用与 `servers/` 的服务）独立触发、独立版本**：一次发布只构建
该工程、只用该工程的 tag / 版本，不牵动其它工程，也不要求整仓一起发。带 `servers/`
分组的工程走同一套流程（`app-release.yml` 按 tag 的 slug 反查，`app-build.yml` 的
`app` 输入不再维护固定下拉框）。

CI 与之一致：`ci.yml` 先用 `discover` 从唯一枚举点（`scripts/lib/projects.mjs`，经
`node scripts/ci/app-info.mjs --list` 暴露）生成矩阵，再**一个「工程 × 端」一个 `test` job**
（`fail-fast: false`）——谁红谁挂牌，新增 app / 服务（或新增一端）都不需要改工作流。
`eslint` 保持仓级一条（`eslint .`，0 error），Rust native 单测仍逐 crate 串行（共用
`target/wasm-apps`）。

测试步骤固定 `--maxWorkers=2` + `NODE_OPTIONS=--max-old-space-size=6144`：GitHub runner
只有 2 核，vitest 默认 `maxWorkers=1` 会把几十个测试文件挤进同一个 fork，模块缓存累积
（bedcode 桌面 39 个文件实测涨到 6GB 后整 job OOM，看起来像用例失败）；而 `4 worker ×
3G` 的堆上限太贴边（时绿时红）。2 worker × 6G 在 16G runner 上是稳定档位。

逐工程 job 的名字随工程增减而变，因此分支保护的必需检查指向**固定名的汇总门**：
`gate`（`lint + 单测`，`needs: [lint, test]` + `if: always()`，任一上游非 success 即失败）。
改本工作流时**不要改这个 job 的 `name`**——`dev` 分支保护的必需检查就是它；加了新
app 也不需要去 Settings → Branches 维护检查列表。

### 仓库设置前置（只做一次）

| 设置                                                 | 位置                                                | 作用                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Actions 默认权限                                     | Settings → Actions → General → Workflow permissions | 需为 **Read and write**（否则 `publish` / Release 建 tag 会 403）                                |
| `CROSS_REPO_TOKEN`（可选）                           | Settings → Secrets and variables → Actions          | 兄弟仓私有 / 需要跨仓读时的 PAT；公开仓可匿名检出，不配也能跑                                    |
| `WASMNEST_PLATFORM_REF` / `WASMNEST_LIB_REF`（可选） | 同上 → Variables                                    | 钉住 CI / 手动构建跟的平台仓 / 能力仓 ref。**当前设为 `WASMNEST_PLATFORM_REF=uat`**：平台仓 `origin/dev` 的 `release-manifest.json` 仍钉能力仓 `lib-v0.0.2`（该 tag 已从远端删除），跟 `dev` 会在跨仓装配就红。解析顺序恒为「workflow 输入 → 仓库变量 → 缺省」（`ci.yml` 缺省 `dev`，`app-build.yml` 缺省 `dev` / `auto`） |

---

## 2. 版本纪律（发布动作）

版本真源在应用仓内（`plugin.json` 的 `version`），双端必须一致：

| 写入点                                                       | 谁写                                       |
| ------------------------------------------------------------ | ------------------------------------------ |
| `<group>/<slug>/<end>/plugin.json` → `version`（`group` = `apps` / `servers`） | `scripts/ci/set-app-version.mjs`（发布时） |
| `<group>/<slug>/<end>/package.json` → `version`              | 同上                                       |

- **日常开发不动版本号**（平台仓 `docs/public/versioning.md` §1）；bump 只在发布时做。
- **工作流不写版本文件**：`version` 输入 / tag 里的版本必须等于已提交的清单版本，否则
  在 `resolve` 阶段直接失败（防止发出错版本的包）。判据实现：`scripts/ci/app-info.mjs`。
- 发布动作顺序（本地）：

  ```bash
  node scripts/ci/set-app-version.mjs bedcode 0.0.2     # 写 plugin.json + package.json
  git add apps/bedcode && git commit -m "chore(bedcode): 发布 v0.0.2"
  git tag bedcode-v0.0.2 && git push origin dev bedcode-v0.0.2
  ```

  tag 推到 origin 后 `app-release.yml` 自动构建 + 发布。

### tag 命名分工

| tag                                        | 语义                                                            | 是否触发 app 发布            |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| `<slug>-v<X.Y.Z>`（如 `bedcode-v0.0.2`） | **单个 app 的分发版本**                                         | ✅ `app-release.yml`         |
| `apps-v<X.Y.Z>`                            | 应用仓**整仓** tag（平台仓 `release-manifest.json` 的装配口径） | ❌ 被 `resolve` 的 `if` 排除 |

`apps-vX.Y.Z` 仍是「平台装配取应用仓哪一版」的唯一表达（见 `AGENTS.md` §3）；
per-app tag 只是**分发版本**，二者互不影响。

### 只想构建、暂不发布

用 `app-build.yml`（手动）：填工程 slug（`apps/` 应用或 `servers/` 服务，可选值见
`node scripts/ci/app-info.mjs --list`）+ 端，跑完从 run 页面下载 artifact。
`platform-ref` / `lib-ref` 留空即取仓库变量（当前平台仓 = `uat`），`resolve` 步骤会把
**实际使用的跨仓 ref 打进日志**，每次 run 自证。
勾 `publish` 等价于「构建 + 建 tag + 发 Release」，tag 已存在时**失败**（不覆盖）。

---

## 3. 跨仓装配（CI 什么时候需要检出兄弟仓）

**是否需要兄弟仓由依赖声明自己说话**，不靠分支名：`ci.yml` 的 `discover` 会读
`package.json`（`file:`）与各 `Cargo.toml`（`path = "../../../../../wasmnest/..."`）算出
仓库级开关 `repoNeedsPlatform` ——
`uat` / 发布线写发布物版本 ⇒ `false`（不需要任何 `[patch]`，也不需要为依赖检兄弟仓）；
`dev` / 联调线写本地相对路径 ⇒ `true`（每个 job 都先装配）。同一份 workflow 两条线通用。

即使 `false`，仍会用到兄弟仓的有三类：

1. **构建链读平台仓真源**：`file-transfer/mobile` 的 build 脚本、WIT 拼装、移动端产物落点
   （→ `app-build*` / `app-release` 必跑 `fetch-cross-repo.mjs` + `prepare-platform.mjs`）；
2. **少数测试读平台仓源码**（宿主 i18n 目录 / 主题 CSS 不在 npm 包里）：`discover` 会按
   源码算出逐工程 `needsPlatform`（与上面的仓库级开关取 OR），只给需要的工程做跨仓检出；
3. 平台仓 / 能力仓版本真源（`release-manifest.json`、`host-runtime.lock.json`）。

> 两句口径别混：`dev` 与内部依赖版本号是互斥的（dev 只写 path / `file:`，版本号只在 uat
> 与发布 tag 上出现）；合并 uat → dev 时保留 dev 的依赖声明，其余按 uat 落地。

当需要装配时，布局固定为 R1 兄弟目录：

```text
$GITHUB_WORKSPACE/
├─ wasmnest-apps/   本仓（actions/checkout）
├─ wasmnest/        平台仓（scripts/ci/fetch-cross-repo.mjs）
└─ wasmnest-lib/    能力仓（同上）
```

| 依赖                                                   | 来自                                                     | 说明                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 双端 SDK 包                                            | 平台仓 `wasmnest-{desktop,mobile}/packages/plugin-sdk-*` | **默认按已发布版本精确依赖**（npm `0.0.1` / crate `=0.0.1`）；本地平台开发才 `pnpm run link:platform`（改 `file:` + `.cargo/config.toml` 的 `[patch]`，不提交）。SDK 发布 = 平台仓 `.github/workflows/sdk-publish.yml`（tag `sdk-v*`） |
| 宿主运行时（dev / 验证期）                             | 平台仓 `host-v*` release 资产 + `release-manifest.hostRuntime` | 应用仓 `host-runtime.lock.json` 钉版本，`scripts/fetch-host.mjs` 下载校验；`scripts/ci/sync-host-lock.mjs --check` 校验 lock↔manifest 漂移；**不进 app 发布产物**（`scripts/ci/check-release-purity.mjs`） |
| 组件化工具                                             | 桌面 SDK 包自带 `tools/componentize`（真源平台仓 `wasmnest-desktop/packages/plugin-sdk-desktop/tools/componentize`） | 移动端与 file-transfer 的 core module → Component；构建链经 SDK 包名定位（`sdk-componentize.mjs`）                       |
| 桌面 app 产物落点                                      | 应用仓 `apps/<slug>/desktop/.build/plugins/`（默认）、CI staging `dist/ci-plugins/` | `build.js --out` 决定；`package-plugins.mjs` 的 `--plugins-dir` 与 build 同源，不再从平台 resources 取桌面产物 |
| 移动 app 产物落点                                      | 平台仓 `wasmnest-mobile/src-tauri/resources/plugins/**`  | 移动端构建链本轮不变（写 resources 仍由平台移动构建负责）                                                              |
| WIT 生成物                                             | 平台仓 `scripts/compose-wit.mjs`（真源在能力仓）         | `rust/wit/` 不入库，必须现场拼装                                                                                        |
| `plugin-watch.js` / `wasm-hash.js` / `manifest-gen.js` | 平台仓 SDK                                               | 桌面 build 脚本直接 import                                                                                              |

检出规则（`scripts/ci/fetch-cross-repo.mjs`）：

- 平台仓 ref = 输入（默认 `dev`；发布建议填精确 tag）；能力仓 ref 默认 `auto` =
  读平台仓 `release-manifest.json` 的 `repos.lib.tag`（跨仓版本唯一表达）；
- **只新建、不覆盖**：目标目录非空即报错（防止 CI 脚本清掉本地改动）；
- 私有仓 / 需要跨仓读权限时配 repo secret **`CROSS_REPO_TOKEN`**（PAT）。公开仓可匿名检出。

> ⚠ **tag 必须推到 origin**：`repos.lib.tag`（如 `lib-v0.0.2`）若只在本地存在，
> `--lib-ref auto` 会失败并提示「tag 未推送」。临时可用 `--lib-ref dev` 指定分支。

### 平台侧生成物

`scripts/ci/prepare-platform.mjs` 在构建前补齐两样**不入库**的东西：

1. **WIT**：`node <platform>/scripts/compose-wit.mjs --all`（双端 `rust/wit/` 生成物）；
2. **SDK `dist/`**：桌面 SDK 走 `wasmnest-desktop` workspace，install 必须**同时选中两个工程**
   （`--filter wasmnest-desktop --filter "@binblink/wasmnest-plugin-sdk-desktop..."`）：根工程提供
   tsup 的 optional peer `typescript`，SDK 工程自带 `tsup`——只 filter 根工程会 `tsup: not found`。
   移动 SDK 在自己的 workspace 里 `pnpm install && pnpm run build`。
   缺失时 app 构建会在 `import` 期炸，故这里 fail-visible。
   已存在则跳过（CI 是 fresh checkout，dist 不入库，所以必然构建；本机跑时不想重建就自动跳过，
   `--force` 强制重建）。

---

## 4. 工具链与缓存

| 项           | CI 取值                                                     | 说明                                                                       |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Node         | 22                                                          | 工作流显式钉版本（不跟随 runner 默认）                                     |
| pnpm         | 读根 `packageManager`（`pnpm/action-setup@v4`）             | 一律 pnpm，禁止 npm                                                        |
| Rust stable  | `wasm32-unknown-unknown`                                    | 移动端 / file-transfer / 组件化工具                                        |
| Rust nightly | 值取自 `scripts/plugin-wasm-config.mjs` 的 `WASIP3_NIGHTLY` | `wasm32-wasip3`（桌面 non-file-transfer）；workflow 现场读取，不复制字面量 |
| sccache      | `mozilla-actions/sccache-action` + GHA 后端                 | `.cargo/config.toml` 强制 `rustc-wrapper = sccache`，CI 必须装（不绕过）   |
| cargo 并发   | `.cargo/config.toml` 的 `jobs = 4`                          | 与 4 vCPU runner 匹配；不支持 `CARGO_INCREMENTAL=1`（sccache 会拒绝）      |
| 共享 target  | `target/wasm-apps`（应用仓根）                              | 各 app 共用一份依赖图                                                      |

缓存：pnpm store（按 lockfile 哈希）+ sccache GHA 后端。fork PR 无缓存写权限，首次会慢。

---

## 5. 产物形态

```text
dist/release/<slug>-<end>-v<version>.zip   插件包（zip 根 = 插件文件）
dist/release/<slug>-<end>-v<version>.json  元数据
```

- **zip**：由 `scripts/package-plugins.mjs --skip-build` 生成（桌面产物另做 `wasmHash` 复核；
  移动端该字段无生产者，见该脚本头注）。zip 根含 `index.js` / `plugin.json` / `icon.svg` / `<rustLibrary>.wasm`。
- **元数据**：`plugin`（id / version / rustLibrary）、`compat`（宿主兼容声明，
  构建时从仓根 `host-runtime.lock.json` 盖章：hostRuntime / mountContract / sdkVersion /
  witVersion——宿主更新检查据此判断「这个包能否装进当前平台」，缺段即判不兼容，
  生产者见 `scripts/lib/host-compat.mjs`）、`artifact`（大小 / sha256）、
  `wasm`（大小 / sha256；桌面带构建期注入的 `wasmHash`）、`source`（三仓 ref + commit + 构建时间）。
- GitHub Release 附件 = 该 app 各端的 zip + json；Release 说明里的 sha256 直接来自元数据。
- **可复现**：CI 把 `SOURCE_DATE_EPOCH` 设为本次提交时间（`package-plugins.mjs` 用它固定 zip
  条目时间戳），因此同一源码重跑得到**同一份 zip 字节**，发布说明里的 sha256 可被第三方复核。

构建链**复用各 app 自己的脚本**（`scripts/ci/build-app.mjs` 头注）：

| 端      | 构建命令                                                       | 落点               |
| ------- | -------------------------------------------------------------- | ------------------ |
| desktop | `apps/<slug>/desktop` 的 `pnpm run build`                      | 平台桌面 resources |
| mobile  | 平台仓 `wasmnest-mobile/scripts/plugin-build.js --plugin <id>` | 平台移动 resources |

---

## 6. 本机复现 CI

```bash
# 0) 三个仓按 R1 摆在同级目录（已有布局可跳过 fetch，直接用现有目录）
node scripts/ci/fetch-cross-repo.mjs --platform-ref dev --lib-ref dev

# 1) 根依赖 + 平台侧生成物（WIT + SDK dist）
pnpm install --frozen-lockfile
node scripts/ci/prepare-platform.mjs --ends all

# 2) 单 app 单端依赖 + 构建 + 打包
(cd apps/bedcode/desktop && pnpm install --frozen-lockfile)
node scripts/ci/build-app.mjs --app bedcode --end desktop
# → dist/release/bedcode-desktop-v0.0.1.zip / .json

# 3) 只算/校验版本，不构建
node scripts/ci/app-info.mjs --app bedcode
node scripts/ci/set-app-version.mjs bedcode 0.0.2 --dry-run
```

> `fetch-cross-repo.mjs` **不会覆盖**已存在的 `../wasmnest`、`../wasmnest-lib`（保护本地改动）。
> 本机已有这两个仓时跳过它，改为直接跑第 1 步。

---

## 7. 已知限制与排障

| 现象                                                   | 原因 / 处理                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `platform-paths` 报「平台仓缺失」                      | 三仓不在同一父目录：设 `WASMNEST_PLATFORM_ROOT`，或让目录名恒为 `wasmnest`                              |
| `--lib-ref auto` 报找不到 ref                          | `repos.lib.tag` 没推到 origin：`git -C ../wasmnest-lib push origin <tag>`，或临时 `--lib-ref dev`       |
| `sccache` 报 `incremental compilation is prohibited`   | 环境里设了 `CARGO_INCREMENTAL=1`，删掉该变量（sccache 会拒绝执行）                                      |
| app 构建报 `Cannot find module @binblink/.../dist/...` | `prepare-platform.mjs` 没跑（或平台 SDK build 失败），先补齐 SDK dist                                   |
| 打包报「产物缺失」                                     | 桌面：确认 `package-plugins.mjs --plugins-dir` 与构建的 `--out` 同源；移动：确认走平台移动构建（不是只产 `dist/` 的 `wasmnest-plugin build`） |
| `pnpm install --frozen-lockfile` 404 找不到 SDK        | SDK 还没发布（`0.0.1` 未上 npm）：本地开发跑 `pnpm run link:platform`（会改 lock，别提交）；发布 SDK 后重跑 install 生成 registry 解析的 lock 并提交 |
| artifact 里版本不是刚改的版本                          | 版本改动没提交 / 构建缓存了旧产物：`app-info --expect-version` 会先挡；必要时清对应 resources 目录重建  |
| Release 创建失败「tag 已存在」                         | 手动 `publish` 不会覆盖既有 tag；发布新版本请 bump + 重新打 tag                                         |

不在 CI 范围内：Linux 桌面宿主打包（deb）、Android APK 打包、跨端互连测试
（分别属于平台仓 / 测试仓）。

### 新增 app / 服务时

本目录不需要新建 workflow：`ci.yml` 的 `test` 矩阵由 resolver 现算（`apps/*` 与
`servers/*` 都覆盖），`app-release.yml` 按 tag 里的 slug 反查，`app-build.yml` 的
`app` 是自由文本、由 `scripts/ci/app-info.mjs` 校验。需要补的只有一处：

1. 平台仓 `release-manifest.json` 的 `apps` 段（跨仓装配判据，不属本仓改动）。
