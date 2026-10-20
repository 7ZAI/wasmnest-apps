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
 *   注意：本 app 前端不参与 watch（既有的「前端最重，dev 期不参与 watch」口径，build.js
 *   拒绝 --watch）；改前端后重跑 `pnpm run dev:host`（不带 --skip-build）重新构建。
 *
 * 宿主产物缺失时 **fail-visible**：打印「先执行平台仓 `pnpm run host:pack`」并退出。
 * 不设平台仓 `dev-run.js`（tauri dev 源码流程）回退分支——只维护一条路径，避免双轨。
 *
 * ## 用法
 *
 * ```bash
 * cd apps/bedcode/desktop
 * pnpm run dev:host                                     # 用默认宿主产物目录（若已打包）
 * pnpm run dev:host -- --host <平台仓>/wasmnest-desktop/dist/host-desktop
 * pnpm run dev:host -- --plugins-dir .dev-host/plugins   # 自定义 app 产物目录
 * pnpm run dev:host -- --skip-build                      # 产物已最新，只起宿主
 * ```
 *
 * 宿主窗口起来后进入本 app：侧栏「BedCode」（宿主路由 `/sessions`，见宿主
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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopHostDir } from '../../../../scripts/platform-paths.mjs'

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
const hostArg = flagValue('--host') || process.env.WASMNEST_HOST_APP || null
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
  console.error(`[dev-host] 缺 plugin.json：${manifestPath}（应在 apps/bedcode/desktop 下运行）`)
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

// ==================== 宿主产物解析（fail-visible） ====================

/** 默认宿主产物目录：平台仓 `wasmnest-desktop/dist/host-desktop`（host:pack 的落点） */
function defaultHostDir() {
  try {
    return join(desktopHostDir(), 'dist', 'host-desktop')
  } catch {
    return null
  }
}

/** 从宿主产物目录里找出可执行：host-version.json 的 binary 优先，其次按平台扩展名扫 */
function resolveHostBinary(dir) {
  let meta = null
  const metaPath = join(dir, 'host-version.json')
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    } catch (e) {
      console.warn(`[dev-host] 解析 host-version.json 失败：${e.message}`)
    }
  }
  if (meta?.binary) {
    const hit = join(dir, meta.binary)
    if (existsSync(hit)) return { bin: hit, meta }
  }
  // 兜底扫描：无 host-version.json（手工拷产物）时按平台形态挑
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (IS_WIN) {
      if (name.endsWith('.exe')) return { bin: full, meta }
    } else if (IS_MAC) {
      if (name.endsWith('.app')) {
        return { bin: join(full, 'Contents', 'MacOS', name.replace(/\.app$/, '')), meta }
      }
    } else if (statSync(full).isFile() && (name.endsWith('.AppImage') || !name.includes('.'))) {
      return { bin: full, meta }
    }
  }
  return null
}

function resolveHost() {
  if (hostArg) {
    const explicit = resolve(APP_ROOT, hostArg)
    if (!existsSync(explicit)) {
      console.error(`[dev-host] --host 指向的路径不存在：${explicit}`)
      process.exit(1)
    }
    if (statSync(explicit).isDirectory()) {
      const hit = resolveHostBinary(explicit)
      if (!hit) {
        console.error(`[dev-host] 宿主产物目录里找不到可执行文件：${explicit}`)
        process.exit(1)
      }
      return hit
    }
    return { bin: explicit, meta: null }
  }
  const fallbackDir = defaultHostDir()
  if (fallbackDir && existsSync(fallbackDir)) {
    const hit = resolveHostBinary(fallbackDir)
    if (hit) {
      console.log(`[dev-host] 使用默认宿主产物目录：${fallbackDir}`)
      return hit
    }
  }
  return null
}

const host = resolveHost()
if (!host) {
  console.error('[dev-host] ✗ 未找到宿主构建产物（运行真实宿主需要它，本脚本不依赖平台仓源码）')
  console.error('[dev-host]   先在平台仓打一次宿主产物：')
  console.error('[dev-host]     cd <平台仓>/wasmnest-desktop && pnpm run host:pack')
  console.error('[dev-host]   产物落点：<平台仓>/wasmnest-desktop/dist/host-desktop（可用 --host 显式指定）')
  process.exit(1)
}

console.log(`[dev-host] 应用：${pluginId}`)
console.log(`[dev-host] 宿主产物：${host.bin}`)
if (host.meta) {
  console.log(
    `[dev-host] 宿主版本：${host.meta.hostVersion}（profile=${host.meta.profile}, sdk=${host.meta.sdkVersion}, builtAt=${host.meta.builtAt}）`,
  )
  checkSdkVersion(host.meta.sdkVersion)
}
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
console.log('[dev-host] 进入应用：宿主窗口 → 侧栏「BedCode」（路由 /sessions）')
console.log('[dev-host] Ctrl+C 结束（宿主一并回收；本 app 不接 watch，改前端需重跑 dev:host）')

const childEnv = { ...process.env, WASMNEST_PLUGINS_DIR: PLUGINS_DIR }
const hostProc = spawn(host.bin, [], { cwd: dirname(host.bin), stdio: 'inherit', env: childEnv })

// ==================== 3. 无 watch（bedcode 口径） ====================
// 本 app 前端不参与 watch（build.js 拒绝 --watch）：改前端后重跑 `pnpm run dev:host`
// （不带 --skip-build）重新构建。宿主是构建产物（非 tauri dev），写产物不会触发宿主重建。

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

/** SDK 版本提示（不阻断：版本规则尚未定义，但错配要看得见） */
function checkSdkVersion(hostSdk) {
  if (!hostSdk) return
  let appSdk = null
  try {
    const pkg = join(
      APP_ROOT,
      'node_modules',
      '@binblink',
      'wasmnest-plugin-sdk-desktop',
      'package.json',
    )
    appSdk = JSON.parse(readFileSync(pkg, 'utf-8')).version
  } catch {
    return
  }
  if (appSdk && appSdk !== hostSdk) {
    console.warn(
      `[dev-host] ⚠ 宿主产物的 SDK 版本（${hostSdk}）与本 app 依赖的 SDK（${appSdk}）不一致；` +
        `若插件加载失败（ABI/契约不匹配），请在平台仓重跑 pnpm run host:pack`,
    )
  }
}
