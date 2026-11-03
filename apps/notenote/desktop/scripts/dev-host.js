#!/usr/bin/env node
/**
 * dev-host —— 在**本应用工程目录内**跑真实桌面宿主
 *
 * 用法：
 * ```bash
 * cd apps/notenote/desktop
 * pnpm run dev:host
 * pnpm run dev:host -- --host <平台仓>/wasmnest-desktop/dist/host-desktop
 * pnpm run dev:host -- --plugins-dir .dev-host/plugins
 * pnpm run dev:host -- --skip-build
 * ```
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
    process.exit(1)
  }
}

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
  console.error('[dev-host] plugin.json 缺 id')
  process.exit(1)
}

const PLUGINS_DIR = resolve(
  APP_ROOT,
  pluginsDirArg || process.env.WASMNEST_PLUGINS_DIR || '.dev-host/plugins',
)
const APP_OUT_DIR = join(PLUGINS_DIR, pluginId)

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
console.log(`[dev-host] app 产物目录：${APP_OUT_DIR}`)

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

console.log('\n[dev-host] 启动宿主（WASMNEST_PLUGINS_DIR 指向 app 产物目录）')
console.log('[dev-host] 进入应用：宿主窗口 → 侧栏「NoteNote」')
console.log('[dev-host] Ctrl+C 结束')

const childEnv = { ...process.env, WASMNEST_PLUGINS_DIR: PLUGINS_DIR }
const hostProc = spawn(host.bin, [], { cwd: dirname(host.bin), stdio: 'inherit', env: childEnv })

let exiting = false
function shutdown(code) {
  if (exiting) return
  exiting = true
  try {
    hostProc.kill('SIGTERM')
  } catch {}
  process.exit(code)
}
hostProc.on('exit', (code) => {
  console.log(`[dev-host] 宿主退出（code=${code}）`)
  shutdown(code ?? 0)
})
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0))
}

function hostExpectations() {
  const lock = readHostRuntimeLock()
  if (!lock) {
    console.error('[dev-host] ✗ 无法校验宿主版本：缺 host-runtime.lock.json')
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
