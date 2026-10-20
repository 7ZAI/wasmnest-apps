#!/usr/bin/env node
/**
 * 双端 E2E 运行器（桌面真实宿主 + USB 真机）
 *
 * 一条命令把「桌面宿主 / 被测 app 产物 / adb 反向端口 / APK / 驱动链」拉起来，
 * 跑 `e2e/dual/**` 的双端用例，结束时收干净：
 *
 *   node scripts/e2e-dual.mjs --app bedcode
 *
 * ## 与单端 `scripts/e2e.mjs` 的关系
 *
 * 桌面侧的编排（构建 app → 隔离插件目录 → 起 dev server → wdio 驱动宿主）**完全同款**；
 * 新增的只有三件真机相关的事：
 *
 * 1. `adb devices` 预检（缺设备 fail-visible，不静默 skip）；
 * 2. `adb install` / `pm clear` / `adb reverse tcp:<port>`（手机侧 127.0.0.1 打到宿主）；
 * 3. 把 APK 路径 / serial / 服务器地址经环境变量交给 wdio（移动端 driver 在 spec 内启动应用）。
 *
 * 为什么不把安装放进 wdio：`adb install` 在慢设备上可达数分钟，超出 mocha 单条用例预算；
 * 编排层做长操作，spec 只做「启动 + 断言」。
 *
 * ## 前置（缺任一 → 显性失败 + 修复指引）
 *
 * - 桌面宿主 **debug** 二进制（wdio 插件只在 debug 注册）；
 * - `tauri-driver` + `WebKitWebDriver`；
 * - 真机在线且已授权（USB 调试）；
 * - **debug APK**（release 没有 WebView 调试套接字，CDP 连不上）。
 *
 * ## 参数
 *
 *   --app <slug>        被测 app（默认 bedcode；目前仅 bedcode 有双端用例）
 *   --apk <path>        指定 APK（缺省按平台仓构建产物路径探测）
 *   --serial <serial>   指定设备（缺省 ANDROID_SERIAL 或唯一在线设备）
 *   --skip-build        复用桌面 app 现有产物
 *   --skip-install      不重装 APK（设备上已有 debug 包时用）
 *   --keep-data         不清移动端应用数据（保留配对记录 / 历史，便于复现问题）
 *   --server-port <n>   桌面服务器端口（默认 8765，必须与宿主持久化设置一致）
 *   --spec <path>       透传 wdio --spec（跑单条用例）
 *   --no-isolate        不隔离桌面数据目录（默认用临时 XDG_DATA_HOME）
 *   --keep              保留失败现场与临时数据目录
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
  statSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { APPS_ROOT, desktopHostDir, platformRoot } from './platform-paths.mjs'

const HOST_DEV_URL = 'http://localhost:1420/'
const MOBILE_PACKAGE = 'com.wasmnest.mobile'

/** APK 探测顺序（Tauri Android 产物按 ABI 分目录） */
const APK_CANDIDATES = [
  'src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk',
  'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk',
  'src-tauri/gen/android/app/build/outputs/apk/x86_64/debug/app-x86_64-debug.apk',
]

// ==================== 参数 ====================

function parseArgs(argv) {
  const args = {
    app: 'bedcode',
    apk: null,
    serial: null,
    skipBuild: false,
    skipInstall: false,
    keepData: false,
    serverPort: Number(process.env.WASMNEST_E2E_SERVER_PORT || 8765),
    spec: null,
    isolate: true,
    keep: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') args.app = argv[++i]
    else if (a === '--apk') args.apk = argv[++i]
    else if (a === '--serial') args.serial = argv[++i]
    else if (a === '--skip-build') args.skipBuild = true
    else if (a === '--skip-install') args.skipInstall = true
    else if (a === '--keep-data') args.keepData = true
    else if (a === '--server-port') args.serverPort = Number(argv[++i])
    else if (a === '--spec') args.spec = argv[++i]
    else if (a === '--no-isolate') args.isolate = false
    else if (a === '--keep') args.keep = true
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`未知参数：${a}（--help 看用法）`)
  }
  if (!Number.isInteger(args.serverPort) || args.serverPort <= 0 || args.serverPort > 65535) {
    throw new Error(`--server-port 非法：${args.serverPort}`)
  }
  return args
}

function usage() {
  console.log(
    [
      '用法：node scripts/e2e-dual.mjs --app bedcode [选项]',
      '',
      '  --apk <path>       指定 debug APK（缺省自动探测平台仓构建产物）',
      '  --serial <serial>  指定设备（缺省 ANDROID_SERIAL / 唯一在线设备）',
      '  --skip-build       复用桌面 app 现有产物',
      '  --skip-install     不重装 APK',
      '  --keep-data        不清移动端应用数据',
      '  --server-port <n>  桌面服务器端口（默认 8765）',
      '  --spec <path>      透传 wdio --spec',
      '  --no-isolate       不隔离桌面数据目录',
      '  --keep             保留失败现场与临时目录',
    ].join('\n'),
  )
}

// ==================== 预检 ====================

function fail(msg, hint) {
  console.error(`\n[e2e-dual] ✗ ${msg}`)
  if (hint) console.error(`[e2e-dual]   ${hint}`)
  process.exit(1)
}

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf-8' })
  return (r.stdout || '').trim() || null
}

function preflightDrivers() {
  const tauriDriver =
    which('tauri-driver') ||
    (existsSync(join(process.env.HOME || '', '.cargo/bin/tauri-driver')) ? '~/.cargo/bin/tauri-driver' : null)
  if (!tauriDriver) fail('未找到 tauri-driver', '安装：cargo install tauri-driver')
  if (process.platform === 'linux' && !which('WebKitWebDriver')) {
    fail('未找到 WebKitWebDriver（Linux 的 WebKit 驱动）', '安装：sudo apt install webkit2gtk-driver')
  }
  console.log(`[e2e-dual] 驱动就绪：tauri-driver=${tauriDriver}`)
}

function preflightHost() {
  const hostDir = desktopHostDir()
  const bin = process.env.WASMNEST_E2E_HOST_BIN || join(hostDir, 'src-tauri', 'target', 'debug', 'wasmnest-desktop')
  if (!existsSync(bin)) {
    fail(
      `宿主 debug 二进制不存在：${bin}`,
      '构建：cd <平台仓>/wasmnest-desktop && cargo build --manifest-path src-tauri/Cargo.toml\n' +
        '  （wdio 插件只在 debug 构建注册，release 产物不能跑 E2E）',
    )
  }
  console.log(`[e2e-dual] 宿主二进制：${bin}`)
  return bin
}

function adbBin() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdk) {
    const p = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(p)) return p
  }
  return 'adb'
}

// ==================== 端口 / 设备 ====================

/** 端口占用预检：桌面宿主起不来时表现为 wdio 超时，提前判更省时间 */
function assertPortFree(port) {
  return new Promise((resolvePromise) => {
    const srv = createServer()
    srv.once('error', () => {
      fail(
        `端口 ${port} 已被占用（桌面宿主无法监听）`,
        '关掉正在运行的 WasmNest / 上次残留进程，或用 --server-port 指定其他端口（需与宿主设置一致）',
      )
    })
    srv.once('listening', () => srv.close(() => resolvePromise()))
    srv.listen(port, '127.0.0.1')
  })
}

function listDevices() {
  const r = spawnSync(adbBin(), ['devices'], { encoding: 'utf-8' })
  if (r.error) {
    fail('adb 不可用', '安装 Android platform-tools 或设置 ANDROID_HOME / ANDROID_SDK_ROOT')
  }
  return (r.stdout || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/)
      return { serial, state }
    })
}

function pickSerial(explicit) {
  const devices = listDevices()
  if (explicit) {
    const hit = devices.find((d) => d.serial === explicit)
    if (!hit) fail(`指定设备不在线：${explicit}`, `当前设备：${JSON.stringify(devices)}`)
    if (hit.state !== 'device') fail(`设备 ${explicit} 状态为 ${hit.state}`, '手机上确认 USB 调试授权')
    return explicit
  }
  const online = devices.filter((d) => d.state === 'device')
  if (online.length === 0) {
    fail(
      `没有可用真机（${devices.length ? JSON.stringify(devices) : 'adb devices 为空'}）`,
      'USB 连接手机 → 开发者选项开 USB 调试 → 手机上确认授权',
    )
  }
  if (online.length > 1) {
    fail(
      `检测到多台在线设备：${online.map((d) => d.serial).join(', ')}`,
      '用 --serial 或 ANDROID_SERIAL 指定目标设备',
    )
  }
  return online[0].serial
}

function adb(serial, args, { inherit = false, timeout = 120_000 } = {}) {
  const r = spawnSync(adbBin(), ['-s', serial, ...args], {
    encoding: 'utf-8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout,
  })
  if (r.error) fail(`adb 命令失败：adb ${args.join(' ')}`, r.error.message)
  if (r.status !== 0) {
    fail(
      `adb 退出码 ${r.status}：adb ${args.join(' ')}`,
      ((r.stderr || '') + (r.stdout || '')).trim().slice(0, 1500),
    )
  }
  return (r.stdout || '').trim()
}

// ==================== 被测 app ====================

function resolveApp(slug) {
  const dir = resolve(APPS_ROOT, 'apps', slug, 'desktop')
  const manifestPath = join(dir, 'plugin.json')
  if (!existsSync(manifestPath)) fail(`app 不存在或缺 plugin.json：${dir}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  return { slug, dir, pluginId: manifest.id, name: manifest.name }
}

function hasDualSpec(slug) {
  return existsSync(resolve(APPS_ROOT, 'e2e', 'dual', `${slug}-pairing.spec.ts`))
}

function buildApp(app, { skip }) {
  if (skip) {
    console.log('[e2e-dual] 跳过桌面 app 构建（--skip-build）')
    return
  }
  console.log(`[e2e-dual] 构建 ${app.slug}（前端 + wasm）…`)
  const r = spawnSync('node', ['scripts/build.js'], { cwd: app.dir, stdio: 'inherit' })
  if (r.status !== 0) fail(`app 构建失败：${app.slug}`, `手工复现：cd apps/${app.slug}/desktop && node scripts/build.js`)
}

/** 被测 app 的桌面产物复制到「只装它一个」的隔离目录（与 e2e.mjs 同口径） */
function stagePlugins(app) {
  const hostDir = desktopHostDir()
  const srcRoot = join(hostDir, 'src-tauri', 'resources', 'plugins', 'desktop')
  const stageDir = join(hostDir, 'src-tauri', 'target', 'debug', 'resources', 'plugins', 'e2e-dual')
  rmSync(stageDir, { recursive: true, force: true })
  const srcDir = join(srcRoot, app.pluginId)
  if (!existsSync(srcDir)) {
    fail(`app 产物缺失：${srcDir}`, `先构建：cd apps/${app.slug}/desktop && node scripts/build.js`)
  }
  const target = join(stageDir, app.pluginId)
  mkdirSync(target, { recursive: true })
  cpSync(srcDir, target, { recursive: true })
  console.log(`[e2e-dual] 桌面产物已就位：${target}`)
  return stageDir
}

function resolveApk(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) fail(`APK 不存在：${explicit}`)
    return resolve(explicit)
  }
  const mobileRoot = join(platformRoot(), 'wasmnest-mobile')
  // 取**最新**的那个候选，不是第一个存在的：各 ABI 目录的 APK 是分次构建留下的，
  // 按固定顺序取会拿到陈旧产物（arm64 旧、universal 新）→ 测的是旧代码，
  // 失败表现像「改了没生效」。
  const found = APK_CANDIDATES.map((rel) => join(mobileRoot, rel))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (found.length > 0) return found[0]
  fail(
    '未找到 debug APK',
    '构建：cd <平台仓>/wasmnest-mobile && pnpm run tauri:android:build:fast\n' +
      '  或用 --apk 指定现成产物（必须是 debug 包，release 无 WebView 调试套接字）',
  )
}

/** APK 是否比移动端源码新（陈旧产物会把「改了没生效」伪装成用例失败） */
function warnIfApkStale(apk, app) {
  const srcDir = resolve(APPS_ROOT, 'apps', app.slug, 'mobile', 'src')
  if (!existsSync(srcDir)) return
  const apkTime = statSync(apk).mtimeMs
  const newest = newestMtime(srcDir)
  if (newest > apkTime) {
    console.warn(
      `[e2e-dual] ⚠ APK 比 ${app.slug}/mobile/src 旧：测的是旧前端。\n` +
        '  重构建：cd <平台仓>/wasmnest-mobile && pnpm run tauri:android:build:fast',
    )
  }
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p))
    else newest = Math.max(newest, statSync(p).mtimeMs)
  }
  return newest
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

async function ensureDevServer() {
  if (await isReachable(HOST_DEV_URL)) {
    console.log(`[e2e-dual] 复用已在运行的宿主前端 dev server（${HOST_DEV_URL}）`)
    return null
  }
  console.log('[e2e-dual] 启动宿主前端 dev server（vite）…')
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: desktopHostDir(),
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
    if (child.exitCode !== null) fail('宿主前端 dev server 启动失败', log.split('\n').slice(-15).join('\n'))
    if (await isReachable(HOST_DEV_URL)) {
      console.log(`[e2e-dual] dev server 就绪：${HOST_DEV_URL}`)
      return child
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  fail('宿主前端 dev server 120s 内未就绪', log.split('\n').slice(-15).join('\n'))
  return null
}

function stopDevServer(child) {
  if (!child) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.unref()
}

// ==================== 主流程 ====================

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const app = resolveApp(args.app)
  if (!hasDualSpec(args.app)) {
    fail(`app ${args.app} 没有双端用例`, `已有：e2e/dual/<slug>-pairing.spec.ts`)
  }
  console.log(`[e2e-dual] 被测 app：${app.slug}（${app.name} / ${app.pluginId}）`)

  await assertPortFree(args.serverPort)
  const serial = pickSerial(args.serial)
  console.log(`[e2e-dual] 设备：${serial}`)

  const apk = resolveApk(args.apk)
  console.log(`[e2e-dual] APK：${apk}`)
  warnIfApkStale(apk, app)

  const hostBin = preflightHost()
  preflightDrivers()

  buildApp(app, { skip: args.skipBuild })
  const stageDir = stagePlugins(app)
  const devServer = await ensureDevServer()

  // USB 反向端口：设备侧 127.0.0.1:<port> → 宿主 127.0.0.1:<port>
  adb(serial, ['reverse', `tcp:${args.serverPort}`, `tcp:${args.serverPort}`])
  console.log(`[e2e-dual] adb reverse：设备 127.0.0.1:${args.serverPort} → 宿主 127.0.0.1:${args.serverPort}`)

  if (!args.skipInstall) {
    console.log('[e2e-dual] 安装 debug APK（慢设备可达数分钟）…')
    adb(serial, ['install', '-r', '-t', apk], { inherit: true, timeout: 300_000 })
  }
  const installed = adb(serial, ['shell', `pm path ${MOBILE_PACKAGE}`])
  if (!installed.includes('package:')) {
    fail(
      `设备上未安装 ${MOBILE_PACKAGE}（--skip-install 时要求已安装）`,
      '去掉 --skip-install 让编排器安装，或先手动 adb install -r -t <apk>',
    )
  }
  if (!args.keepData) {
    adb(serial, ['shell', `pm clear ${MOBILE_PACKAGE}`])
    console.log('[e2e-dual] 已清空移动端应用数据')
  }
  adb(serial, ['shell', `am force-stop ${MOBILE_PACKAGE}`])

  const artifactsDir = join(APPS_ROOT, 'e2e', 'artifacts', `dual-${timestamp()}`)
  mkdirSync(artifactsDir, { recursive: true })

  const env = {
    ...process.env,
    WASMNEST_E2E_DUAL: '1',
    WASMNEST_E2E_HOST_BIN: hostBin,
    WASMNEST_E2E_APK: apk,
    WASMNEST_E2E_SERVER: `127.0.0.1:${args.serverPort}`,
    WASMNEST_E2E_ARTIFACTS: artifactsDir,
    WASMNEST_PLUGINS_DIR: stageDir,
    ANDROID_SERIAL: serial,
  }

  let dataHome = null
  if (args.isolate) {
    dataHome = mkdtempSync(join(tmpdir(), 'wasmnest-e2e-dual-data-'))
    env.XDG_DATA_HOME = dataHome
    env.XDG_CONFIG_HOME = join(dataHome, 'config')
    console.log(`[e2e-dual] 桌面状态隔离：XDG_DATA_HOME=${dataHome}`)
  }

  const wdioArgs = ['exec', 'wdio', 'run', 'e2e/wdio.dual.conf.ts']
  if (args.spec) wdioArgs.push('--spec', args.spec)

  let status = 0
  try {
    console.log('[e2e-dual] 启动 wdio（双端用例）…')
    const r = spawnSync('pnpm', wdioArgs, { cwd: APPS_ROOT, stdio: 'inherit', env })
    status = r.status ?? 1
  } finally {
    // 收尾顺序：先摘反向端口（否则设备仍打到即将关掉的宿主），再杀 dev server
    try {
      adb(serial, ['reverse', '--remove', `tcp:${args.serverPort}`])
    } catch {
      /* 设备可能已断开 */
    }
    stopDevServer(devServer)
    if (args.keep || status !== 0) {
      console.error(`[e2e-dual] 现场保留：${artifactsDir}`)
      if (dataHome) console.error(`[e2e-dual] 桌面数据目录保留：${dataHome}`)
    } else if (dataHome) {
      rmSync(dataHome, { recursive: true, force: true })
    }
  }

  if (status !== 0) {
    console.error(`[e2e-dual] ✗ 双端用例未全绿（退出码 ${status}）`)
    process.exit(status)
  }
  console.log('[e2e-dual] ✓ 双端用例全绿')
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

main().catch((e) => {
  console.error(`[e2e-dual] ✗ ${e?.message ?? e}`)
  process.exit(1)
})
