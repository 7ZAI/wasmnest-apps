/**
 * E2E 运行计划（纯函数）—— `scripts/e2e.mjs` 与 `scripts/e2e-dual.mjs` 共用
 *
 * 为什么抽出来：宿主模式在四个维度上分叉——宿主来源、是否起宿主前端 dev server、
 * app 产物写到哪、要不要再复制一份 staging。这四条正是本票唯一的**假绿来源**
 * （packed 模式还连着平台 dev server，或 staging 写进平台工作树，"只拿应用仓也能验证"
 * 就成了空话）。做成纯函数才能逐档钉死，运行器只负责执行。
 *
 * 契约来源：`.scratch/2026-10-21-host-runtime-distribution/CONTRACT.md` §8.3（模式表）、
 * §3（解析优先级）、§7（版本轴）；spec D14。
 */

export const HOST_MODES = ['packed', 'cargo', 'runtime']

/** 默认 `packed`：G2 的验收形态（只有应用仓 + 联网也能跑完整前后端 E2E） */
export function resolveHostMode({ hostMode, env = process.env } = {}) {
  const raw = hostMode || env.WASMNEST_E2E_HOST_MODE
  if (!raw) return 'packed'
  if (!HOST_MODES.includes(raw)) {
    throw new Error(
      `[e2e] --host-mode 取值非法：${raw}（允许 ${HOST_MODES.join(' / ')}）\n` +
        '[e2e]   packed=解析器给的宿主产物；cargo=平台 src-tauri debug 二进制 + dev server；' +
        'runtime=L2 通用 runtime crate 装出来的二进制',
    )
  }
  return raw
}

/** 只有 cargo 模式需要宿主前端 dev server（packed / runtime 的前端已嵌进二进制） */
export function needsDevServer(mode) {
  return mode === 'cargo'
}

/** cargo 模式的宿主二进制 = 平台工程 `src-tauri/target/debug/wasmnest-desktop` */
export function cargoHostBin({ platformRoot, binaryName = 'wasmnest-desktop' }) {
  if (!platformRoot) {
    throw new Error(
      '[e2e] cargo 模式需要平台仓工作树，但没解析到平台根。\n' +
        '[e2e]   → 设 WASMNEST_PLATFORM_ROOT=<平台仓根>，或改用默认的 --host-mode packed' +
        '（下载 / 本机 host:pack 产物，不需要平台仓）。',
    )
  }
  return `${platformRoot}/wasmnest-desktop/src-tauri/target/debug/${binaryName}`
}

/**
 * 被测 app 的构建参数。
 *
 * packed / runtime：必须 `--out <staging plugins 根>` —— 不写平台宿主 resources，
 * 也不依赖各 app 的默认落点（默认落点属于开发者本机工作区，跑测试时不该互相踩）。
 * cargo：保持现状（产物写平台 resources，宿主读的就是那一份），因此**不传 --out**。
 */
export function planBuildArgs({ mode, full = false, pluginsDir }) {
  const args = full ? [] : ['--frontend-only']
  if (mode !== 'cargo') {
    if (!pluginsDir) {
      throw new Error(`[e2e] ${mode} 模式必须有 staging 产物目录（内部错误：pluginsDir 缺失）`)
    }
    args.push('--out', pluginsDir)
  }
  return args
}

/**
 * staging 目录方案。
 *
 * packed / runtime = 调用方给的**临时目录**（`mkdtemp`），跑完整体删除；
 * cargo = 平台工作树 `wasmnest-desktop/src-tauri/target/debug/resources/plugins/e2e`
 * （历史行为，该模式本来就是平台集成面）。
 */
export function planStaging({ mode, stagingDir, platformRoot }) {
  if (mode !== 'cargo') {
    if (!stagingDir) {
      throw new Error('[e2e] 非 cargo 模式需要临时 staging 目录（调用方未提供）')
    }
    return { pluginsDir: stagingDir, temp: true }
  }
  if (!platformRoot) {
    throw new Error(
      '[e2e] cargo 模式需要平台仓工作树（设 WASMNEST_PLATFORM_ROOT 或改用 packed）',
    )
  }
  return {
    pluginsDir: `${platformRoot}/wasmnest-desktop/src-tauri/target/debug/resources/plugins/e2e`,
    temp: false,
  }
}

/**
 * 用 staging 目录前是否要**整体清空**。
 *
 * packed / runtime 的 staging 是本次 `mkdtemp` 出来的空目录 ⇒ 不能清（一清就把刚构建
 * 出来的产物删掉——这条曾在真实 E2E 里把绿跑成红）；cargo 复用的是平台 target 下的固定
 * 目录 ⇒ 必须清，否则上一轮别的 app 的残留会被宿主一起装载（隔离判据失效）。
 */
export function planStagingCleanup({ mode }) {
  return mode === 'cargo'
}

/**
 * 产物进入 staging 的方式（逐 app）。
 *
 * - packed / runtime + 本次真构建了 ⇒ 构建已直接写进 staging，无需复制（`copy=false`）；
 * - packed / runtime + `--skip-build` ⇒ 从 app 的**默认产物目录** `.build/plugins/<id>`
 *   拷进 staging（缺就点名，让人去构建，而不是静默用上一份残留）；
 * - cargo ⇒ 从平台宿主 resources 拷进 staging（现状语义：宿主读的就是平台那一份）。
 */
export function planArtifactCopy({ mode, skipBuild, apps, pluginsDir, platformResourcesDir }) {
  if (mode === 'cargo') {
    if (!platformResourcesDir) {
      throw new Error('[e2e] cargo 模式需要平台宿主 resources 目录（内部错误）')
    }
    return apps.map((app) => ({
      pluginId: app.pluginId,
      src: `${platformResourcesDir}/${app.pluginId}`,
      dst: `${pluginsDir}/${app.pluginId}`,
      copy: true,
    }))
  }
  return apps.map((app) =>
    skipBuild
      ? {
          pluginId: app.pluginId,
          src: `${app.dir}/.build/plugins/${app.pluginId}`,
          dst: `${pluginsDir}/${app.pluginId}`,
          copy: true,
        }
      : {
          pluginId: app.pluginId,
          src: `${pluginsDir}/${app.pluginId}`,
          dst: `${pluginsDir}/${app.pluginId}`,
          copy: false,
        },
  )
}

/**
 * 启动前的版本事实比对（CONTRACT §7）：
 * `sdkVersion` 以本 app 实际安装的 SDK 为准，`witVersion` / `mountContract` 以 lock 为准。
 * 缺 lock = 无法校验 ⇒ 抛错（不猜默认版本号，猜了就是把错位静默放过去）。
 */
export function hostExpectations({ lock, sdkVersion }) {
  if (!lock) {
    throw new Error(
      '[e2e] 缺 host-runtime.lock.json：无法校验宿主的 witVersion / mountContract。\n' +
        '[e2e]   → node scripts/ci/sync-host-lock.mjs 从平台 release-manifest 同步该文件。',
    )
  }
  return {
    sdkVersion: sdkVersion || lock.sdkVersion,
    witVersion: lock.witVersion,
    mountContract: lock.mountContract,
  }
}
