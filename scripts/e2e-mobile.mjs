#!/usr/bin/env node
/**
 * 真机单端 E2E 运行器（移动宿主 + 一个应用）
 *
 * 一条命令把「真机 / debug APK / 驱动链」拉起来，跑 `e2e/mobile/**` 的用例：
 *
 *   node scripts/e2e-mobile.mjs --app file-transfer
 *
 * ## 与 `scripts/e2e-dual.mjs` 的分工
 *
 * - **双端 lane**（`e2e-dual.mjs`）：桌面真宿主 + 真机，两端同时在场（配对 / 跨端链路）；
 * - **真机单端 lane**（本脚本）：只有手机这一端，但宿主是真的——真 APK 内置真宿主、
 *   真 wasm 组件、真权限门、真壳路由。补的是移动端应用此前**完全空缺**的那条验证面
 *   （此前只有 vitest 单测 + SDK dev-shell 的 mock 壳；mock 壳不跑 WASM、权限全放行）。
 *
 * 为什么单独一套编排而不是复用双端：双端 lane 的重活是**桌面宿主**（构建 app 产物、
 * 隔离插件目录、起 dev server、wdio 驱动桌面），单端 lane 一件都不需要——
 * 桌面在场与否不影响手机侧断言，硬拉进来只会让「设备没接好」和「桌面没起好」两种失败混在一起。
 *
 * ## 前置（缺任一 → 显性失败 + 修复指引，不静默 skip）
 *
 * - 真机在线且已授权（`adb devices` 唯一 `device`）；
 * - **debug APK**（release 不开 WebView 调试套接字，CDP 连不上）。
 *
 * ## 参数
 *
 *   --app <slug>        被测应用（默认 file-transfer）
 *   --apk <path>        指定 APK（缺省按平台仓构建产物路径探测）
 *   --serial <serial>   指定设备（缺省 ANDROID_SERIAL 或唯一在线设备）
 *   --skip-install      不重装 APK（设备上已有 debug 包时用）
 *   --keep-data         不清移动端应用数据（保留配对记录 / 历史，便于复现问题）
 *   --spec <path>       透传 mocha --spec（跑单条用例）
 *   --keep              保留失败现场与临时目录
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { APPS_ROOT, platformRoot } from './platform-paths.mjs'

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
    app: 'file-transfer',
    apk: null,
    serial: null,
    skipInstall: false,
    keepData: false,
    spec: null,
    keep: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') args.app = argv[++i]
    else if (a === '--apk') args.apk = argv[++i]
    else if (a === '--serial') args.serial = argv[++i]
    else if (a === '--skip-install') args.skipInstall = true
    else if (a === '--keep-data') args.keepData = true
    else if (a === '--spec') args.spec = argv[++i]
    else if (a === '--keep') args.keep = true
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`未知参数：${a}（--help 看用法）`)
  }
  return args
}

function usage() {
  console.log(
    [
      '用法：node scripts/e2e-mobile.mjs --app file-transfer [选项]',
      '',
      '  --apk <path>       指定 debug APK（缺省自动探测平台仓构建产物）',
      '  --serial <serial>  指定设备（缺省 ANDROID_SERIAL / 唯一在线设备）',
      '  --skip-install     不重装 APK',
      '  --keep-data        不清移动端应用数据',
      '  --spec <path>      透传 mocha --spec',
      '  --keep             保留失败现场与临时目录',
    ].join('\n'),
  )
}

// ==================== 预检 ====================

function fail(msg, hint) {
  console.error(`\n[e2e-mobile] ✗ ${msg}`)
  if (hint) console.error(`[e2e-mobile]   ${hint}`)
  process.exit(1)
}

function adbBin() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdk) {
    const p = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(p)) return p
  }
  return 'adb'
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

// ==================== 被测应用 ====================

function resolveApp(slug) {
  const dir = resolve(APPS_ROOT, 'apps', slug, 'mobile')
  const manifestPath = join(dir, 'plugin.json')
  if (!existsSync(manifestPath)) fail(`应用不存在或缺 plugin.json：${dir}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  return { slug, dir, pluginId: manifest.id, name: manifest.name }
}

/** 该应用的用例文件（`e2e/mobile/<slug>-*.spec.ts`）；没有就是没写用例，不是「通过」 */
function resolveSpecs(slug, explicitSpec) {
  if (explicitSpec) return null
  const dir = join(APPS_ROOT, 'e2e', 'mobile')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${slug}-`) && f.endsWith('.spec.ts'))
    .map((f) => join(dir, f))
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
      `[e2e-mobile] ⚠ APK 比 ${app.slug}/mobile/src 旧：测的是旧前端。\n` +
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

// ==================== 主流程 ====================

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const app = resolveApp(args.app)
  const specs = resolveSpecs(args.app, args.spec)
  // 显式 --spec 时不要求该应用有默认用例（临时跑单条 / 跨 app 调试）
  if (!args.spec && specs.length === 0) {
    fail(
      `应用 ${args.app} 没有真机单端用例`,
      `已有：e2e/mobile/<slug>-*.spec.ts（跑法：node scripts/e2e-mobile.mjs --app ${args.app}）`,
    )
  }
  console.log(`[e2e-mobile] 被测应用：${app.slug}（${app.name} / ${app.pluginId}）`)

  const serial = pickSerial(args.serial)
  console.log(`[e2e-mobile] 设备：${serial}`)

  const apk = resolveApk(args.apk)
  console.log(`[e2e-mobile] APK：${apk}`)
  warnIfApkStale(apk, app)

  if (!args.skipInstall) {
    console.log('[e2e-mobile] 安装 debug APK（慢设备可达数分钟）…')
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
    console.log('[e2e-mobile] 已清空移动端应用数据')
  }
  adb(serial, ['shell', `am force-stop ${MOBILE_PACKAGE}`])

  const artifactsDir = join(APPS_ROOT, 'e2e', 'artifacts', `mobile-${timestamp()}`)
  mkdirSync(artifactsDir, { recursive: true })

  const env = {
    ...process.env,
    WASMNEST_E2E_APK: apk,
    WASMNEST_E2E_ARTIFACTS: artifactsDir,
    ANDROID_SERIAL: serial,
  }

  // 用例跑在 mocha 下（与桌面 lane 同框架同风格）；tsx 负责 TS + 无扩展名 import
  const mochaArgs = ['exec', 'mocha', '--require', 'tsx', '--timeout', '300000']
  if (args.spec) mochaArgs.push('--spec', args.spec)
  else mochaArgs.push(...specs)

  let status = 0
  console.log('[e2e-mobile] 启动 mocha（真机单端用例）…')
  const r = spawnSync('pnpm', mochaArgs, { cwd: APPS_ROOT, stdio: 'inherit', env })
  status = r.status ?? 1

  if (status !== 0) {
    console.error(`[e2e-mobile] ✗ 用例未全绿（退出码 ${status}）`)
    console.error(`[e2e-mobile]   现场目录：${artifactsDir}`)
    process.exit(status)
  }
  console.log(`[e2e-mobile] ✓ 用例全绿（现场目录：${artifactsDir}）`)
  if (args.keep) console.log('[e2e-mobile] 现场已保留')
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

main().catch((e) => {
  console.error(`[e2e-mobile] ✗ ${e?.message ?? e}`)
  process.exit(1)
})
