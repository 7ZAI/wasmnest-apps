#!/usr/bin/env node
/**
 * E2E 运行器（桌面端 · 应用仓层）
 *
 * 一条命令把「宿主 + 被测 app + 驱动链」拉起来，跑完收干净：
 *
 *   node scripts/e2e.mjs --app agent-hub
 *
 * ## 为什么需要这个运行器（而不是直接 `wdio run`）
 *
 * 桌面 E2E 的前置条件散在两仓且**缺一即假绿**，必须由一个入口统一编排 + 预检：
 *
 * 1. **被测 app 的产物要就位且是新的**：app 构建产物落在平台仓宿主 resources 下，
 *    宿主读的是**自己那份**——不刷新就会用旧包测新代码（最常见的假绿）。
 * 2. **宿主只装被测 app**：`WASMNEST_PLUGINS_DIR` 指向一个只含被测 app 的隔离目录，
 *    主屏就只有一张卡，断言不受别的 app 影响。
 * 3. **宿主 debug 二进制**：wdio 插件只在 debug 注册（release 不含）。
 * 4. **宿主前端 dev server**：debug 二进制走 `devUrl`（1420 端口），没起服务时页面是
 *    `about:blank` —— 此时所有 DOM 断言都会「元素不存在 → 失败」或更糟的假绿。
 * 5. **驱动**：`tauri-driver` + `WebKitWebDriver`（Linux）必须在位。
 *
 * 任何一条不满足都**显性报错并给出修复指引**（fail-visible），不静默降级。
 *
 * ## 参数
 *
 *   --app <slug>       被测 app（目录 slug，如 agent-hub）；省略 = 跑全部已有用例的 app
 *   --skip-build       不重新构建被测 app（复用现有产物；改过前端就别用）
 *   --build-full       连 wasm 后端一起构建（默认只重建前端：E2E 关注交互层，
 *                      wasm 全量构建慢）
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
import { APPS_ROOT, desktopHostDir } from './platform-paths.mjs'

const HOST_DEV_URL = 'http://localhost:1420/'

// ==================== 参数 ====================

function parseArgs(argv) {
  const args = {
    app: null,
    skipBuild: false,
    buildFull: false,
    spec: null,
    isolate: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') args.app = argv[++i]
    else if (a === '--skip-build') args.skipBuild = true
    else if (a === '--build-full') args.buildFull = true
    else if (a === '--spec') args.spec = argv[++i]
    else if (a === '--isolate') args.isolate = true
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

/** 宿主 debug 二进制预检 */
function preflightHost() {
  const hostDir = desktopHostDir()
  const bin =
    process.env.WASMNEST_E2E_HOST_BIN ||
    join(hostDir, 'src-tauri', 'target', 'debug', 'wasmnest-desktop')
  if (!existsSync(bin)) {
    fail(
      `宿主 debug 二进制不存在：${bin}`,
      '构建：cd <平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml\n' +
        '  （wdio 插件只在 debug 构建注册，release 产物不能跑 E2E）',
    )
  }
  console.log(`[e2e] 宿主二进制：${bin}`)
  return bin
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
 * 确保宿主前端 dev server 在跑（宿主 debug 二进制走 devUrl）
 *
 * 已在跑 → 复用（不抢用户正在用的 dev 会话）；没在跑 → 起一个，结束前收掉。
 */
async function ensureDevServer() {
  if (await isReachable(HOST_DEV_URL)) {
    console.log(`[e2e] 复用已在运行的宿主前端 dev server（${HOST_DEV_URL}）`)
    return null
  }
  const hostDir = desktopHostDir()
  console.log('[e2e] 启动宿主前端 dev server（vite）…')
  // detached：子进程独立进程组 → 收尾时能整组杀掉（pnpm 会再起 vite 子孙进程，
  // 只杀 pnpm 会留下 vite 继续持有 stdout 管道 → 父进程永远等不到 EOF → 不退出）。
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: hostDir,
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

/** 构建被测 app（默认只重建前端：E2E 关注交互层，wasm 全量构建慢） */
/**
 * 构建被测 app（默认只重建前端：E2E 关注交互层，wasm 全量构建慢）
 *
 * 前端-only 构建的 wasm 来源由**各 app 自己的构建脚本**决定（`--frontend-only` 的
 * 语义 =「只改前端，wasm 保持现状」，共享 wasm target 被 cargo clean 清掉时会复用
 * 上一份产物）——本运行器不介入产物解析，只管跑。
 */
function buildApp(app, { skip, full }) {
  if (skip) {
    console.log('[e2e] 跳过构建（--skip-build）：复用现有产物')
    return
  }
  const args = full ? [] : ['--frontend-only']
  console.log(`[e2e] 构建 ${app.slug}（${full ? '前端 + wasm' : '仅前端'}）…`)
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
 * 把被测 app 的产物复制到**宿主只装它一个**的隔离插件目录
 *
 * 宿主读的是平台仓 resources 下的那一份；不复制就会测到旧包（假绿）。
 * 隔离目录放在宿主 resource 基目录内（asset protocol 的 RESOURCE 通配作用域覆盖它）。
 */
function stagePlugins(apps) {
  const hostDir = desktopHostDir()
  const srcRoot = join(hostDir, 'src-tauri', 'resources', 'plugins', 'desktop')
  const stageDir = join(hostDir, 'src-tauri', 'target', 'debug', 'resources', 'plugins', 'e2e')
  rmSync(stageDir, { recursive: true, force: true })
  for (const app of apps) {
    const srcDir = join(srcRoot, app.pluginId)
    if (!existsSync(srcDir)) {
      fail(
        `app 产物缺失：${srcDir}`,
        `先构建：cd apps/${app.slug}/desktop && node scripts/build.js`,
      )
    }
    const target = join(stageDir, app.pluginId)
    mkdirSync(target, { recursive: true })
    cpSync(srcDir, target, { recursive: true })
    console.log(`[e2e] 产物已就位：${target}`)
  }
  return stageDir
}

// ==================== 主流程 ====================

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  // 未指定 --app → 全量模式：把所有有 E2E 用例的 app 都装进隔离目录，跑全部用例。
  const slugs = args.app ? [args.app] : listApps().filter(hasSpec)
  if (slugs.length === 0) {
    fail('没有可跑的 app', `e2e/specs/ 下有用例的 app：${listApps().filter(hasSpec).join(' / ')}`)
  }
  const apps = slugs.map(resolveApp)
  for (const app of apps) {
    console.log(`[e2e] 被测 app：${app.slug}（${app.name} / ${app.pluginId}）`)
  }

  for (const app of apps) {
    buildApp(app, { skip: args.skipBuild, full: args.buildFull })
  }
  const hostBin = preflightHost()
  preflightDrivers()

  const devServer = await ensureDevServer()

  const env = {
    ...process.env,
    WASMNEST_E2E_HOST_BIN: hostBin,
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
  for (const app of apps) {
    const stageDir = stagePlugins([app])
    const runEnv = { ...env, WASMNEST_PLUGINS_DIR: stageDir }

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
