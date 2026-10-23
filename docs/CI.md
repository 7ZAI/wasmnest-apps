# CI —— GitHub Actions 构建与按 app 发布

> 本文件是 CI 的**唯一说明入口**（触发方式 / 版本纪律 / 跨仓装配 / 产物形态 / 排障）。
> 规则裁决看 `AGENTS.md`；结构与产物流向看 `docs/CODE-MAP.md`。
> 文档字面 ≠ 事实：改工作流或脚本后回来同步本文件。

---

## 1. 工作流一览

| 文件                                       | 触发                            | 作用                                         | 产物                           |
| ------------------------------------------ | ------------------------------- | -------------------------------------------- | ------------------------------ |
| `.github/workflows/ci.yml`                 | PR / push `dev`·`main` / 手动   | `eslint`（0 error）+ 各 app `test:run` + 各 crate `cargo test`（native） | 无（只做校验）                 |
| `.github/workflows/app-build.yml`          | **手动**（按 app 选择端与版本） | 单 app 构建；勾 `publish` 则建 tag + Release | workflow artifact（+ Release） |
| `.github/workflows/app-release.yml`        | **推 tag `<slug>-v<X.Y.Z>`**    | 该 app 全端构建 + GitHub Release             | Release 附件                   |
| `.github/workflows/app-build-reusable.yml` | 仅被上面两个 `uses:` 调用       | 单 app 单端：装配跨仓 → 构建 → 打包 → 上传   | artifact（30 天）              |

**每个 app 独立触发、独立版本**：一次 app 发布只构建该 app、只用该 app 的 tag / 版本，
不牵动其它 app，也不要求整仓一起发。

### 仓库设置前置（只做一次）

| 设置                                                 | 位置                                                | 作用                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Actions 默认权限                                     | Settings → Actions → General → Workflow permissions | 需为 **Read and write**（否则 `publish` / Release 建 tag 会 403）                                |
| `CROSS_REPO_TOKEN`（可选）                           | Settings → Secrets and variables → Actions          | 兄弟仓私有 / 需要跨仓读时的 PAT；公开仓可匿名检出，不配也能跑                                    |
| `WASMNEST_PLATFORM_REF` / `WASMNEST_LIB_REF`（可选） | 同上 → Variables                                    | 钉住 CI 跟的平台仓 / 能力仓 ref；未设时 CI 用 `dev`，发布用 `auto`（= 平台 manifest 的 lib tag） |

---

## 2. 版本纪律（发布动作）

版本真源在应用仓内（`plugin.json` 的 `version`），双端必须一致：

| 写入点                                       | 谁写                                       |
| -------------------------------------------- | ------------------------------------------ |
| `apps/<slug>/<end>/plugin.json` → `version`  | `scripts/ci/set-app-version.mjs`（发布时） |
| `apps/<slug>/<end>/package.json` → `version` | 同上                                       |

- **日常开发不动版本号**（平台仓 `docs/public/versioning.md` §1）；bump 只在发布时做。
- **工作流不写版本文件**：`version` 输入 / tag 里的版本必须等于已提交的清单版本，否则
  在 `resolve` 阶段直接失败（防止发出错版本的包）。判据实现：`scripts/ci/app-info.mjs`。
- 发布动作顺序（本地）：

  ```bash
  node scripts/ci/set-app-version.mjs agent-hub 0.0.2   # 写 plugin.json + package.json
  git add apps/agent-hub && git commit -m "chore(agent-hub): 发布 v0.0.2"
  git tag agent-hub-v0.0.2 && git push origin dev agent-hub-v0.0.2
  ```

  tag 推到 origin 后 `app-release.yml` 自动构建 + 发布。

### tag 命名分工

| tag                                        | 语义                                                            | 是否触发 app 发布            |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| `<slug>-v<X.Y.Z>`（如 `agent-hub-v0.0.2`） | **单个 app 的分发版本**                                         | ✅ `app-release.yml`         |
| `apps-v<X.Y.Z>`                            | 应用仓**整仓** tag（平台仓 `release-manifest.json` 的装配口径） | ❌ 被 `resolve` 的 `if` 排除 |

`apps-vX.Y.Z` 仍是「平台装配取应用仓哪一版」的唯一表达（见 `AGENTS.md` §3）；
per-app tag 只是**分发版本**，二者互不影响。

### 只想构建、暂不发布

用 `app-build.yml`（手动）：选 app / 端，跑完从 run 页面下载 artifact。
勾 `publish` 等价于「构建 + 建 tag + 发 Release」，tag 已存在时**失败**（不覆盖）。

---

## 3. 跨仓装配（CI 为什么要检出三个仓）

应用仓**不自足**，ci 必须在同一 workspace 里按 R1 兄弟布局摆好三个仓：

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
- **元数据**：`plugin`（id / version / rustLibrary）、`artifact`（大小 / sha256）、
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
(cd apps/agent-hub/desktop && pnpm install --frozen-lockfile)
node scripts/ci/build-app.mjs --app agent-hub --end desktop
# → dist/release/agent-hub-desktop-v0.0.1.zip / .json

# 3) 只算/校验版本，不构建
node scripts/ci/app-info.mjs --app agent-hub
node scripts/ci/set-app-version.mjs agent-hub 0.0.2 --dry-run
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

### 新增 app 时

本目录不需要新建 workflow：`ci.yml` 自动扫 `apps/*/{desktop,mobile}/package.json`，
`app-release.yml` 按 tag 里的 slug 反查。需要补的只有两处：

1. `.github/workflows/app-build.yml` 的 `app` 选项列表（手动触发的下拉框）；
2. 平台仓 `release-manifest.json` 的 `apps` 段（跨仓装配判据，不属本仓改动）。
