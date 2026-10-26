#!/usr/bin/env node
/**
 * dev-host —— 在**本应用工程目录内**跑真实桌面宿主（真 wasm / 真命令 / 真权限门）
 *
 * ## 运行面：宿主构建产物（唯一路径，不依赖平台仓源码）
 *
 * 宿主由平台仓 `pnpm run host:pack`（`wasmnest-desktop/scripts/package-host.mjs`）打成
 * **可运行产物目录**（debug profile 二进制 + 已嵌入的宿主前端 dist + `host-version.json`）。
 * 本脚本把本 app 的产物写进 `--plugins-dir`，再用 `WASMNEST_PLUGINS_DIR` 把该目录递给
 * 宿主二进制——宿主读它装载本 app，其 PluginDevWatcher 监听同一目录，故：
 *
 *   改代码 → build.js --watch 重建 → 宿主 emit plugin:dev-reload → 前端热重载（不重启宿主）
 *
 * 宿主产物缺失时 **fail-visible**：打印「先执行平台仓 `pnpm run host:pack`」并退出。
 * 不设平台仓 `dev-run.js`（tauri dev 源码流程）回退分支——只维护一条路径，避免双轨。
 *
 * ## 用法
 *
 * ```bash
 * cd apps/ai-chatbox/desktop
 * pnpm run dev:host                                     # 用默认宿主产物目录（若已打包）
 * pnpm run dev:host -- --host <平台仓>/wasmnest-desktop/dist/host-desktop
 * pnpm run dev:host -- --plugins-dir .dev-host/plugins   # 自定义 app 产物目录
 * pnpm run dev:host -- --skip-build                      # 产物已最新，只起宿主 + watch
 * ```
 *
 * 宿主窗口起来后进入本 app：侧栏「AI Chatbox」（宿主路由 `/chat`，见宿主
 * `useShellApps.ts` SURFACE_ROUTES）。
 *
 * ## 约定
 *
 * - 产物目录形如 `<plugins-dir>/<appId>/{index.js,plugin.json,icon.svg,<rustLib>.wasm}`，
 *   `build.js --out <plugins-dir>` 只写自己那层，多个 app 可共用同一 plugins 目录。
 * - 宿主产物固定 debug profile：`PluginDevWatcher` 被 `#[cfg(debug_assertions)]` 包住，
 *   release 宿主没有热重载。
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
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// ==================== 参数 ====================

const argv = process.argv.slice(2)
function flagValue(flag) {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const hostArg = flagValue('--host')  // WASMNEST_HOST_BIN / WASMNEST_HOST_APP 由解析器统一读
const pluginsDirArg = flagValue('--plugins-dir')
const skipBuild = argv.includes('--skip-build')

// 已移除的开关：不再保留平台仓 dev-run.js 回退（`--dev-run`）与其专属的 `--solo`。
// 传了就报错，避免被静默忽略后用户以为生效。
for (const removed of ['--dev-run', '--solo']) {
  if (argv.includes(removed)) {
    console.error(`[dev-host] ✗ ${removed} 已移除：dev-host 只走宿主构建产物一条路径。`)
    console.error('[dev-host]   需要真宿主请先打包：cd <平台仓>/wasmnest-desktop && pnpm run host:pack')
    process.exit(1)
  }
}

// ==================== 本 app 身份（真源 = plugin.json） ====================

const manifestPath = join(APP_ROOT, 'plugin.json')
if (!existsSync(manifestPath)) {
  console.error(`[dev-host] 缺 plugin.json：${manifestPath}（应在 apps/ai-chatbox/desktop 下运行）`)
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

/** app 产物目录：`<plugins-dir>/<appId>` */
const PLUGINS_DIR = resolve(
  APP_ROOT,
  pluginsDirArg || process.env.WASMNEST_PLUGINS_DIR || '.dev-host/plugins',
)
const APP_OUT_DIR = join(PLUGINS_DIR, pluginId)

// ==================== 宿主运行时解析（单一入口：scripts/host-runtime.mjs） ====================

/**
 * 宿主来源只有解析器一条路：显式（--host / WASMNEST_HOST_BIN / WASMNEST_HOST_APP）
 * → 本机平台仓 host:pack 产物 → 已下载缓存 → 都没有则打印可执行指引退出。
 * 本脚本**不再自己拼平台仓路径 / 扫宿主目录**（G2 票 D2：六份重复解析收敛为一份）。
 */
const host = resolveHostRuntime({ explicit: hostArg })
if (!host) {
  console.error(hostRuntimeMissingHint())
  process.exit(1)
}

// 版本兼容检查：此前只是 warning，且提示语（「重新 host:pack」）对下载来的宿主是错的。
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
console.log('[dev-host] 进入应用：宿主窗口 → 侧栏「AI Chatbox」（路由 /chat）')
console.log('[dev-host] Ctrl+C 结束（宿主与 watch 一并回收）')

const childEnv = { ...process.env, WASMNEST_PLUGINS_DIR: PLUGINS_DIR }
const hostProc = spawn(host.bin, [], { cwd: dirname(host.bin), stdio: 'inherit', env: childEnv })

// ==================== 3. 起本 app 前端 watch ====================
// 重建 → 宿主 PluginDevWatcher → plugin:dev-reload → 前端热重载。宿主是构建产物
// （非 tauri dev），写产物不会再触发宿主重建，故无需等待门控，直接起。
const watchProc = spawn(
  process.execPath,
  ['scripts/build.js', '--watch', '--out', PLUGINS_DIR],
  { cwd: APP_ROOT, stdio: 'inherit', env: childEnv },
)

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
 * 期望的宿主版本事实（D15）：
 * - `sdkVersion` = 本 app 工程里**实际装着**的桌面 SDK 版本（wasm / 前端产物就是按它生成的）；
 * - `witVersion` / `mountContract` = 应用仓 `host-runtime.lock.json`（缺 lock 即退出，
 *   不猜默认值——猜出来的版本号会让真正的错位静默通过）。
 */
function hostExpectations() {
  const lock = readHostRuntimeLock()
  if (!lock) {
    console.error('[dev-host] ✗ 无法校验宿主版本：缺 host-runtime.lock.json（平台 manifest 也不在场）')
    console.error('[dev-host]   → 由平台 manifest 同步：node scripts/ci/sync-host-lock.mjs')
    console.error('[dev-host]   → 或临时指定版本事实：WASMNEST_HOST_VERSION=<version>（仍建议签入 lock）')
    process.exit(1)
  }
  return {
    sdkVersion: installedSdkVersion() || lock.sdkVersion,
    witVersion: lock.witVersion,
    mountContract: lock.mountContract,
  }
}

/** 本 app 依赖里实际安装的桌面 SDK 版本（未装依赖 = 拿不到，退回 lock 的期望值） */
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
