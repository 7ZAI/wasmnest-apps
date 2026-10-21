#!/usr/bin/env node
/**
 * E2E 运行器（桌面端 · 应用仓层）
 *
 * 一条命令把「宿主 + 被测 app + 驱动链」拉起来，跑完收干净：
 *
 *   node scripts/e2e.mjs --app agent-hub                       # packed（默认，G2 形态）
 *   node scripts/e2e.mjs --app agent-hub --host-mode cargo     # 平台集成形态
 *
 * ## 为什么需要这个运行器（而不是直接 `wdio run`）
 *
 * 桌面 E2E 的前置条件散在两仓且**缺一即假绿**，必须由一个入口统一编排 + 预检：
 *
 * 1. **被测 app 的产物要就位且是新的**：app 构建产物落在平台仓宿主 resources 下，
 *    宿主读的是**自己那份**——不刷新就会用旧包测新代码（最常见的假绿）。
 * 2. **宿主只装被测 app**：`WASMNEST_PLUGINS_DIR` 指向一个只含被测 app 的隔离目录，
 *    主屏就只有一张卡，断言不受别的 app 影响。
 * 3. **宿主二进制**：wdio 插件只在 debug 注册（`tauri build --debug` 的产物含它）。
 * 4. **宿主前端**：`packed` / `runtime` 模式的前端**已嵌进二进制**（不启 dev server）；
 *    `cargo` 模式走 `devUrl`（1420），必须另起平台前端 dev server，否则页面是
 *    `about:blank` —— 所有 DOM 断言都会「元素不存在 → 失败」或更糟的假绿。
 * 5. **驱动**：`tauri-driver` + `WebKitWebDriver`（Linux）必须在位。
 *
 * ## 宿主模式（CONTRACT §8.3）
 *
 * | 模式 | 宿主来源 | dev server | app 产物 / staging |
 * | --- | --- | --- | --- |
 * | `packed`（默认） | `scripts/host-runtime.mjs`：显式 → 本机 host:pack → 下载缓存 | 不启 | `build.js --out <mkdtemp>`，就地使用 |
 * | `cargo` | `<平台仓>/wasmnest-desktop/src-tauri/target/debug/wasmnest-desktop` | 启 | 写平台宿主 resources（现状） |
 * | `runtime` | L2 通用 runtime crate 装出来的二进制（`WASMNEST_HOST_BIN` 等显式指定） | 不启 | 同 packed |
 *
 * packed / runtime 全程**不碰平台工作树**：这是「只拿到应用仓也能做完整前后端验证」的
 * 判据本体。任何一条不满足都**显性报错并给出修复指引**（fail-visible），不静默降级。
 *
 * ## 参数
 *
 *   --app <slug>       被测 app（目录 slug，如 agent-hub）；省略 = 跑全部已有用例的 app
 *   --skip-build       不重新构建被测 app（复用现有产物；改过前端就别用）
 *   --build-full       连 wasm 后端一起构建（默认只重建前端：E2E 关注交互层，
 *                      wasm 全量构建慢）
 *   --host-mode <m>    packed（默认）| cargo | runtime
 *   --host <路径>      packed/runtime：显式指定宿主二进制或产物目录
 *   --spec <path>      透传给 wdio 的 --spec（跑单条用例）
 *   --isolate          用临时 XDG_DATA_HOME 隔离宿主持久状态（默认用真实用户目录，
 *                      权限/设置态与日常使用一致）
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  APPS_ROOT,
  assertHostCompatible,
  detectPlatformRoot,
  hostRuntimeMissingHint,
  readHostRuntimeLock,
  resolveHostRuntime,
} from './host-runtime.mjs'
import {
  cargoHostBin,
  hostExpectations,
  needsDevServer,
  planArtifactCopy,
  planBuildArgs,
  planStaging,
  planStagingCleanup,
  resolveHostMode,
} from './e2e-plan.mjs'

const HOST_DEV_URL = 'http://localhost:1420/'

// ==================== 参数 ====================

function parseArgs(argv) {
  const args = {
    app: null,
    skipBuild: false,
    buildFull: false,
    spec: null,
    isolate: false,
    hostMode: null,
    host: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') args.app = argv[++i]
    else if (a === '--skip-build') args.skipBuild = true
    else if (a === '--build-full') args.buildFull = true
    else if (a === '--spec') args.spec = argv[++i]
    else if (a === '--isolate') args.isolate = true
    else if (a === '--host-mode') args.hostMode = argv[++i]
    else if (a === '--host') args.host = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`未知参数：${a}（--help 看用法）`)
  }
  return args
}

function usage() {
  console.log(
    [
      '用法：node scripts/e2e.mjs --app <slug> [选项]',
      '',
      '  --app <slug>    被测 app 目录 slug（agent-hub / ai-chatbox / bedcode / file-transfer / monitor）',
      '  --skip-build    不重建被测 app（复用现有产物）',
      '  --build-full    连 wasm 后端一起构建（默认只重建前端）',
      '  --spec <path>   透传给 wdio --spec',
      '  --host-mode     packed（默认，宿主来自解析器）| cargo（平台 dev 二进制 + dev server）| runtime（L2 通用 crate）',
      '  --host <路径>   packed/runtime 显式指定宿主二进制或产物目录',
      '  --isolate       用临时 XDG_DATA_HOME 隔离宿主持久状态',
    ].join('\n'),
  )
}

// ==================== 预检 ====================

function fail(msg, hint) {
  console.error(`\n[e2e] ✗ ${msg}`)
  if (hint) console.error(`[e2e]   ${hint}`)
  process.exit(1)
}

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf-8' })
  const p = (r.stdout || '').trim()
  return p || null
}

/** 驱动预检（Linux 需要 WebKitWebDriver；macOS/Windows 由各自 provider 负责） */
function preflightDrivers() {
  const tauriDriver =
    which('tauri-driver') ||
    (existsSync(join(process.env.HOME || '', '.cargo/bin/tauri-driver'))
      ? '~/.cargo/bin/tauri-driver'
      : null)
  if (!tauriDriver) {
    fail('未找到 tauri-driver', '安装：cargo install tauri-driver')
  }
  if (process.platform === 'linux' && !which('WebKitWebDriver')) {
    fail(
      '未找到 WebKitWebDriver（Linux 的 WebKit 驱动）',
      '安装：sudo apt install libwebkit2gtk-4.1-dev / webkit2gtk-driver（发行版包名可能不同）',
    )
  }
  console.log(`[e2e] 驱动就绪：tauri-driver=${tauriDriver}`)
}

/**
 * 宿主来源解析（逐模式）
 *
 * packed / runtime：走 `scripts/host-runtime.mjs` 的单一优先级链（显式 → 本机 host:pack
 * → 已下载缓存），并在启动前用 lock 的版本事实比对（sdkVersion / witVersion /
 * mountContract）——分发化之后宿主与 app 不再天然同版本，错位必须点名。
 * cargo：平台工作树的 debug 二进制（平台集成面，保留历史行为）。
 */
function preflightHost({ mode, hostFlag }) {
  if (mode === 'cargo') {
    const platformRoot = detectPlatformRoot({ appsRoot: APPS_ROOT })
    const bin = process.env.WASMNEST_E2E_HOST_BIN || cargoHostBin({ platformRoot })
    if (!existsSync(bin)) {
      fail(
        `宿主 debug 二进制不存在：${bin}`,
        '构建：cd <平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml\n' +
          '  （wdio 插件只在 debug 构建注册，release 产物不能跑 E2E）\n' +
          '  或改用默认形态：--host-mode packed（宿主来自下载缓存 / 本机 host:pack 产物）',
      )
    }
    console.log(`[e2e] 宿主二进制（cargo）：${bin}`)
    return { bin, meta: null, source: 'cargo' }
  }

  let host = null
  try {
    host = resolveHostRuntime({ explicit: hostFlag })
  } catch (e) {
    fail(e.message)
  }
  if (!host) {
    console.error(hostRuntimeMissingHint())
    process.exit(1)
  }
  try {
    const lock = readHostRuntimeLock({ appsRoot: APPS_ROOT })
    assertHostCompatible(host.meta, hostExpectations({ lock, sdkVersion: null }))
  } catch (e) {
    fail(`宿主版本与 app 期望不匹配：\n${e.message}`)
  }
  console.log(
    `[e2e] 宿主产物（${host.source}）：${host.bin}\n` +
      `[e2e]   hostVersion=${host.meta.hostVersion} sdk=${host.meta.sdkVersion} ` +
      `wit=${host.meta.witVersion} mountContract=${host.meta.mountContract}`,
  )
  return host
}

// ==================== dev server ====================

async function isReachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 确保宿主前端 dev server 在跑（**仅 cargo 模式**：debug 二进制走 devUrl）
 *
 * packed / runtime 的前端已嵌进二进制，起 dev server 反而会让「测的是下载宿主」变成
 * 「测的是平台工作树前端」——那正是本票要消灭的假绿。
 * 已在跑 → 复用（不抢用户正在用的 dev 会话）；没在跑 → 起一个，结束前收掉。
 */
async function ensureDevServer(platformHostDir) {
  if (await isReachable(HOST_DEV_URL)) {
    console.log(`[e2e] 复用已在运行的宿主前端 dev server（${HOST_DEV_URL}）`)
    return null
  }
  console.log('[e2e] 启动宿主前端 dev server（vite）…')
  // detached：子进程独立进程组 → 收尾时能整组杀掉（pnpm 会再起 vite 子孙进程，
  // 只杀 pnpm 会留下 vite 继续持有 stdout 管道 → 父进程永远等不到 EOF → 不退出）。
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: platformHostDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let log = ''
  child.stdout.on('data', (d) => {
    log += String(d)
  })
  child.stderr.on('data', (d) => {
    log += String(d)
  })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail('宿主前端 dev server 启动失败', log.split('\n').slice(-15).join('\n'))
    }
    if (await isReachable(HOST_DEV_URL)) {
      console.log(`[e2e] dev server 就绪：${HOST_DEV_URL}`)
      return child
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  fail('宿主前端 dev server 120s 内未就绪', log.split('\n').slice(-15).join('\n'))
  return null
}

// ==================== 平台工程目录（仅 cargo 模式使用） ====================

/**
 * cargo 模式需要的两个平台路径：平台仓根 + 桌面宿主工程目录。
 * 平台不在场 ⇒ 点名并给出路（改用 packed），不返回可能无效的路径。
 */
function platformDirsOrDie() {
  const platformRoot = detectPlatformRoot({ appsRoot: APPS_ROOT })
  if (!platformRoot) {
    fail(
      'cargo 模式需要平台仓工作树，但没解析到平台根',
      '设 WASMNEST_PLATFORM_ROOT=<平台仓根>，或改用默认形态 --host-mode packed',
    )
  }
  const hostDir = `${platformRoot}/wasmnest-desktop`
  if (!existsSync(hostDir)) {
    fail(`平台宿主工程不存在：${hostDir}`, '改用 --host-mode packed（宿主来自下载缓存 / host:pack 产物）')
  }
  return { platformRoot, hostDir }
}

// ==================== 被测 app ====================

/** 解析被测 app：目录 slug → 插件 id */
function resolveApp(slug) {
  const dir = resolve(APPS_ROOT, 'apps', slug, 'desktop')
  const manifestPath = join(dir, 'plugin.json')
  if (!existsSync(manifestPath)) {
    fail(`app 不存在或缺 plugin.json：${dir}`, `可用 app：${listApps().join(' / ')}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  return {
    slug,
    dir,
    pluginId: manifest.id,
    name: manifest.name,
    rustLibrary: manifest.rustLibrary,
  }
}

function listApps() {
  const appsDir = resolve(APPS_ROOT, 'apps')
  if (!existsSync(appsDir)) return []
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(appsDir, e.name, 'desktop')))
    .map((e) => e.name)
}

/** 该 app 是否已有 E2E 用例（`e2e/specs/<slug>.spec.ts`） */
function hasSpec(slug) {
  return existsSync(resolve(APPS_ROOT, 'e2e', 'specs', `${slug}.spec.ts`))
}

/**
 * 构建被测 app（默认只重建前端：E2E 关注交互层，wasm 全量构建慢）
 *
 * 产物落点由 `planBuildArgs` 决定：packed / runtime 一律 `--out <临时 staging>`
 * （**不写平台宿主 resources**，也不依赖 app 的本机默认落点）；cargo 保持写平台 resources。
 * 前端-only 的 wasm 来源由各 app 构建脚本自己决定（`--frontend-only` = 「只改前端」）。
 */
function buildApp(app, { mode, skip, full, pluginsDir }) {
  if (skip) {
    console.log('[e2e] 跳过构建（--skip-build）：从 app 默认产物目录搬进 staging')
    return
  }
  const args = planBuildArgs({ mode, full, pluginsDir })
  console.log(`[e2e] 构建 ${app.slug}（${full ? '前端 + wasm' : '仅前端'}${mode === 'cargo' ? '' : ` → ${pluginsDir}`}）…`)
  const r = spawnSync('node', ['scripts/build.js', ...args], {
    cwd: app.dir,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    fail(
      `app 构建失败：${app.slug}`,
      `手工复现：cd apps/${app.slug}/desktop && node scripts/build.js ${args.join(' ')}`,
    )
  }
}

/**
 * 把被测 app 的产物摆进**宿主只装它一个**的隔离插件目录
 *
 * 目录与复制方式由 `planArtifactCopy` / `planStaging` 决定（纯函数，已单测）：
 * - packed / runtime 且本次真构建 ⇒ 产物已在临时 staging，就地使用（不复制 = 不会拿到陈旧副本）；
 * - packed / runtime 且 --skip-build ⇒ 从 app 的 `.build/plugins/<id>` 搬进 staging，缺失点名；
 * - cargo ⇒ 从平台宿主 resources 搬进 `target/debug/resources/plugins/e2e`（历史行为）。
 */
function stagePlugins(apps, { mode, skipBuild, pluginsDir, platformResourcesDir }) {
  if (planStagingCleanup({ mode })) rmSync(pluginsDir, { recursive: true, force: true })
  mkdirSync(pluginsDir, { recursive: true })
  const plans = planArtifactCopy({ mode, skipBuild, apps, pluginsDir, platformResourcesDir })
  for (const plan of plans) {
    if (plan.copy) {
      if (!existsSync(plan.src)) {
        fail(
          `app 产物缺失：${plan.src}`,
          `先构建：cd ${plan.src.includes('.build') ? plan.src.split('/.build/')[0] : appHintDir(apps, plan.pluginId)} && node scripts/build.js` +
            `\n  （或去掉 --skip-build 让本运行器构建到 ${pluginsDir}）`,
        )
      }
      rmSync(plan.dst, { recursive: true, force: true })
      mkdirSync(plan.dst, { recursive: true })
      cpSync(plan.src, plan.dst, { recursive: true })
      console.log(`[e2e] 产物已就位：${plan.dst}`)
    } else {
      if (!existsSync(`${plan.dst}/plugin.json`)) {
        fail(`构建后 staging 里没有该 app 的产物：${plan.dst}`, '检查 build.js 的 --out 行为')
      }
      console.log(`[e2e] 产物就地使用：${plan.dst}`)
    }
  }
  return pluginsDir
}

function appHintDir(apps, pluginId) {
  const hit = apps.find((a) => a.pluginId === pluginId)
  return hit ? hit.dir : '<app 工程目录>'
}

// ==================== 主流程 ====================

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  let mode
  try {
    mode = resolveHostMode({ hostMode: args.hostMode })
  } catch (e) {
    fail(e.message)
  }

  // 未指定 --app → 全量模式：把所有有 E2E 用例的 app 都装进隔离目录，跑全部用例。
  const slugs = args.app ? [args.app] : listApps().filter(hasSpec)
  if (slugs.length === 0) {
    fail('没有可跑的 app', `e2e/specs/ 下有用例的 app：${listApps().filter(hasSpec).join(' / ')}`)
  }
  const apps = slugs.map(resolveApp)
  const host = preflightHost({ mode, hostFlag: args.host })
  console.log(`[e2e] 宿主模式：${mode}${needsDevServer(mode) ? '（需要平台前端 dev server）' : '（不启 dev server，前端已嵌入宿主二进制）'}`)
  for (const app of apps) {
    console.log(`[e2e] 被测 app：${app.slug}（${app.name} / ${app.pluginId}）`)
  }

  // staging 方案先定：packed / runtime 用临时目录（跑完整体删除，平台工作树零写入），
  // cargo 用平台 target 下的 e2e 目录（历史行为）。
  const platform = needsDevServer(mode) ? platformDirsOrDie() : null
  const stagingDir =
    mode === 'cargo' ? null : mkdtempSync(join(tmpdir(), 'wasmnest-e2e-plugins-'))
  const staging = planStaging({ mode, stagingDir, platformRoot: platform?.platformRoot })
  const platformResourcesDir =
    mode === 'cargo' ? `${platform.hostDir}/src-tauri/resources/plugins/desktop` : null

  for (const app of apps) {
    buildApp(app, {
      mode,
      skip: args.skipBuild,
      full: args.buildFull,
      pluginsDir: staging.pluginsDir,
    })
  }
  preflightDrivers()

  const devServer = needsDevServer(mode) ? await ensureDevServer(platform.hostDir) : null

  const env = {
    ...process.env,
    WASMNEST_E2E_HOST_BIN: host.bin,
  }
  if (args.isolate) {
    const dataHome = mkdtempSync(join(tmpdir(), 'wasmnest-e2e-data-'))
    env.XDG_DATA_HOME = dataHome
    env.XDG_CONFIG_HOME = join(dataHome, 'config')
    console.log(`[e2e] 宿主状态隔离：XDG_DATA_HOME=${dataHome}`)
  }

  // **逐 app 跑一次 wdio**：桌面宿主是**单实例**资源（端口 + 应用数据目录 + 窗口），
  // 同一个 wdio run 里多个 spec 文件会各自起一个 worker → 各自起一个宿主实例 →
  // 第二个实例起不来（表现为「宿主 webview 未就绪」超时）。
  // 故：每个 app 单独一次 wdio（该次宿主里只装了这一个 app）。
  let failed = 0
  try {
    for (const app of apps) {
      stagePlugins([app], {
        mode,
        skipBuild: args.skipBuild,
        pluginsDir: staging.pluginsDir,
        platformResourcesDir,
      })
      const runEnv = { ...env, WASMNEST_PLUGINS_DIR: staging.pluginsDir }

      const wdioArgs = ['exec', 'wdio', 'run', 'e2e/wdio.conf.ts']
      // 用例按 app 分文件；传了 --spec 则以调用方的为准。
      if (args.spec) {
        wdioArgs.push('--spec', args.spec)
      } else {
        wdioArgs.push('--spec', `e2e/specs/${app.slug}.spec.ts`)
      }

      console.log(`[e2e] 启动 wdio：${app.slug}`)
      const r = spawnSync('pnpm', wdioArgs, {
        cwd: APPS_ROOT,
        stdio: 'inherit',
        env: runEnv,
      })
      if (r.status !== 0) {
        failed += 1
        console.error(`[e2e] ✗ ${app.slug} 用例未全绿`)
      }
    }
  } finally {
    // 临时 staging 无论成败都收（失败现场是 wdio 自己的 artifacts 目录，不在这里）
    if (staging.temp) rmSync(staging.pluginsDir, { recursive: true, force: true })
  }

  if (devServer) {
    console.log('[e2e] 收掉本次起的 dev server')
    try {
      // 杀整组（pnpm → vite），再摘掉管道引用：否则父进程会被子进程的 stdout 管道吊住不退出
      process.kill(-devServer.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(devServer.pid, 'SIGTERM')
      } catch {
        /* 已退出 */
      }
    }
    devServer.stdout?.destroy()
    devServer.stderr?.destroy()
    devServer.unref()
  }

  if (failed > 0) {
    console.error(`[e2e] ✗ ${failed} / ${apps.length} 个 app 的用例未全绿`)
    process.exit(1)
  }
  console.log(`[e2e] ✓ ${apps.length} 个 app 的用例全绿`)
}

main().catch((e) => {
  console.error(`[e2e] ✗ ${e?.message ?? e}`)
  process.exit(1)
})
