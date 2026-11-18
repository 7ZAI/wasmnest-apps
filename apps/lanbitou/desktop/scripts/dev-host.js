#!/usr/bin/env node
/**
 * dev-host —— 在**本应用工程目录内**跑真实桌面宿主（真 wasm / 真命令 / 真权限门）
 *
 * 宿主由平台仓 `pnpm run host:pack`（`wasmnest-desktop/scripts/package-host.mjs`）
 * 打成可运行产物目录；本脚本把本 app 的产物写进 `--plugins-dir`，再用
 * `WASMNEST_PLUGINS_DIR` 递给宿主二进制——宿主读它装载本 app，其
 * PluginDevWatcher 监听同一目录，改代码 → build.js --watch 重建 → 前端热重载。
 *
 * 用法：
 * ```bash
 * cd apps/lanbitou/desktop
 * pnpm run dev:host
 * pnpm run dev:host -- --host <平台仓>/wasmnest-desktop/dist/host-desktop
 * pnpm run dev:host -- --plugins-dir .dev-host/plugins
 * pnpm run dev:host -- --skip-build
 * ```
 *
 * 宿主产物缺失时 fail-visible（提示先跑平台仓 host:pack），不保留平台仓
 * `dev-run.js` 回退分支。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertHostCompatible,
  hostRuntimeMissingHint,
  readHostRuntimeLock,
  resolveHostRuntime,
} from '../../../../scripts/host-runtime.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(__dirname, '..')

// ==================== 参数 ====================

const argv = process.argv.slice(2)
function flagValue(flag) {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const hostArg = flagValue('--host')
const pluginsDirArg = flagValue('--plugins-dir')
const skipBuild = argv.includes('--skip-build')

for (const removed of ['--dev-run', '--solo']) {
  if (argv.includes(removed)) {
    console.error(`[dev-host] ✗ ${removed} 已移除：dev-host 只走宿主构建产物一条路径。`)
    console.error(
      '[dev-host]   需要真宿主请先打包：cd <平台仓>/wasmnest-desktop && pnpm run host:pack',
    )
    process.exit(1)
  }
}

// ==================== 本 app 身份（真源 = plugin.json） ====================

const manifestPath = join(APP_ROOT, 'plugin.json')
if (!existsSync(manifestPath)) {
  console.error(`[dev-host] 缺 plugin.json：${manifestPath}`)
  process.exit(1)
}
let pluginId = null
try {
  pluginId = JSON.parse(readFileSync(manifestPath, 'utf-8')).id
} catch (e) {
  console.error(`[dev-host] 解析 plugin.json 失败：${e.message}`)
  process.exit(1)
}
if (!pluginId) {
  console.error('[dev-host] plugin.json 缺 id —— 无法定位本 app 的产物目录')
  process.exit(1)
}

const PLUGINS_DIR = resolve(
  APP_ROOT,
  pluginsDirArg || process.env.WASMNEST_PLUGINS_DIR || '.dev-host/plugins',
)
const APP_OUT_DIR = join(PLUGINS_DIR, pluginId)

// ==================== 宿主运行时解析（单一入口：scripts/host-runtime.mjs） ====================

const host = resolveHostRuntime({ explicit: hostArg })
if (!host) {
  console.error(hostRuntimeMissingHint())
  process.exit(1)
}

try {
  assertHostCompatible(host.meta, hostExpectations())
} catch (e) {
  console.error(`[dev-host] ✗ ${e.message.split('\n').join('\n[dev-host] ')}`)
  process.exit(1)
}

console.log(`[dev-host] 应用：${pluginId}`)
console.log(`[dev-host] 宿主产物：${host.bin}（来源=${host.source}）`)
console.log(
  `[dev-host] 宿主版本：${host.meta.hostVersion}（sdk=${host.meta.sdkVersion}, ` +
    `wit=${host.meta.witVersion}, mountContract=${host.meta.mountContract}, builtAt=${host.meta.builtAt}）`,
)
console.log(`[dev-host] app 产物目录：${APP_OUT_DIR}`)

// ==================== 1. 构建本 app 到产物目录 ====================

if (skipBuild) {
  console.log('\n[dev-host] --skip-build：跳过预构建')
} else {
  console.log('\n[dev-host] ====== 预构建本 app ======')
  const res = spawnSync(process.execPath, ['scripts/build.js', '--out', PLUGINS_DIR], {
    cwd: APP_ROOT,
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    console.error(`[dev-host] ✗ 预构建失败（exit=${res.status}）`)
    process.exit(res.status ?? 1)
  }
}

// ==================== 2. 起宿主（插件目录经 env 递入） ====================

console.log('\n[dev-host] 启动宿主（WASMNEST_PLUGINS_DIR 指向 app 产物目录）')
console.log('[dev-host] 进入应用：宿主侧栏「记事本」')
console.log('[dev-host] Ctrl+C 结束（宿主与 watch 一并回收）')

const childEnv = { ...process.env, WASMNEST_PLUGINS_DIR: PLUGINS_DIR }
const hostProc = spawn(host.bin, [], { cwd: dirname(host.bin), stdio: 'inherit', env: childEnv })

// ==================== 3. 起本 app 前端 watch ====================

const watchProc = spawn(process.execPath, ['scripts/build.js', '--watch', '--out', PLUGINS_DIR], {
  cwd: APP_ROOT,
  stdio: 'inherit',
  env: childEnv,
})

let exiting = false
function shutdown(code) {
  if (exiting) return
  exiting = true
  for (const p of [watchProc, hostProc]) {
    try {
      p.kill('SIGTERM')
    } catch {}
  }
  process.exit(code)
}
hostProc.on('exit', (code) => {
  console.log(`[dev-host] 宿主退出（code=${code}）`)
  shutdown(code ?? 0)
})
watchProc.on('exit', (code) => {
  console.error(`[dev-host] 本 app watch 退出（code=${code}）`)
  shutdown(code ?? 1)
})
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0))
}

/**
 * 期望的宿主版本事实：sdkVersion = 本 app 实际安装的 SDK 版本；
 * witVersion / mountContract = 应用仓 host-runtime.lock.json（缺 lock 即退出）。
 */
function hostExpectations() {
  const lock = readHostRuntimeLock()
  if (!lock) {
    console.error('[dev-host] ✗ 无法校验宿主版本：缺 host-runtime.lock.json')
    console.error('[dev-host]   → 由平台 manifest 同步：node scripts/ci/sync-host-lock.mjs')
    process.exit(1)
  }
  return {
    sdkVersion: installedSdkVersion() || lock.sdkVersion,
    witVersion: lock.witVersion,
    mountContract: lock.mountContract,
  }
}

function installedSdkVersion() {
  try {
    const pkg = join(
      APP_ROOT,
      'node_modules',
      '@binblink',
      'wasmnest-plugin-sdk-desktop',
      'package.json',
    )
    return JSON.parse(readFileSync(pkg, 'utf-8')).version
  } catch {
    return null
  }
}
