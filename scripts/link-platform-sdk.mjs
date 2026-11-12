#!/usr/bin/env node
// 把应用仓的桌面 SDK 依赖显式切到**本地平台源码**（默认走发布物，不生效）。
//
// 用法：
//   node scripts/link-platform-sdk.mjs               # link + 根与五个 app 的 pnpm install
//   node scripts/link-platform-sdk.mjs --status      # 只打印当前是 linked / published
//   node scripts/link-platform-sdk.mjs --no-install  # 只写依赖 / patch / marker
//
// 解析：
//   WASMNEST_PLATFORM_ROOT  平台仓根（默认：主工作树的兄弟目录 wasmnest）
//   WASMNEST_LIB_ROOT       能力仓根（默认：平台根 / 主工作树的兄弟 wasmnest-lib）
//
// 写入（均为工作区状态，**不可提交**）：
//   · 根 + 五个 app 的 package.json：SDK 依赖 → file:<relative>
//   · 根 .cargo/config.toml：[patch.crates-io] + [patch."...wasmnest-lib"] 追加块
//   · 根 .platform-sdk-link.json：marker（记录原始 spec，供 unlink 精确还原）
// 已知缺口：SDK 发布前 pnpm-lock.yaml 仍解析到 file:；提交前跑 unlink-platform-sdk.mjs，
// 否则 lock / package.json 的 link 状态会混进提交。
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyLinkPlan,
  createLinkPlan,
  desktopAppDirs,
  inspectLinkStatus,
  resolveLibRoot,
  resolvePlatformRoot,
  runPnpmInstalls,
} from './platform-sdk-link.mjs'

const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 主工作树根：worktree 下兄弟目录必须按主工作树算，不能按当前 worktree 算 */
function findMainWorktreeRoot(cwd = process.cwd()) {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
    }).trim()
    if (commonDir) return dirname(commonDir)
  } catch {
    // 非 git 环境 / git 不可用：交给 resolvePlatformRoot 的 fail-visible 提示
  }
  return null
}

function printStatus() {
  const { state, marker, reasons } = inspectLinkStatus({ appsRoot: APPS_ROOT })
  if (state === 'published') {
    console.log('[link-platform-sdk] 状态: published（依赖为发布版精确版本，未 link 本地平台源码）')
    return 0
  }
  if (state === 'linked') {
    console.log('[link-platform-sdk] 状态: linked（本地平台源码）')
    console.log(`  平台根: ${marker.platformRoot}`)
    if (marker.libRoot) console.log(`  能力仓: ${marker.libRoot}`)
    console.log(`  link 时间: ${marker.linkedAt}`)
    console.log(`  文件: ${Object.keys(marker.files).length} 个 package.json + .cargo/config.toml patch`)
    return 0
  }
  console.error('[link-platform-sdk] 状态: inconsistent（link 状态漂移，需要修复）')
  for (const reason of reasons) console.error(`  - ${reason}`)
  console.error('  修复：重跑 node scripts/link-platform-sdk.mjs，或 node scripts/unlink-platform-sdk.mjs 回到发布物。')
  return 1
}

const argv = process.argv.slice(2)

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    '用法: node scripts/link-platform-sdk.mjs [--status | --no-install]\n' +
      '  --status      只打印当前状态（linked / published / inconsistent）\n' +
      '  --no-install  只写依赖与 patch，不执行 pnpm install\n' +
      '环境: WASMNEST_PLATFORM_ROOT（平台仓根）、WASMNEST_LIB_ROOT（能力仓根）',
  )
  process.exit(0)
}

if (argv.includes('--status')) {
  process.exit(printStatus())
}

const mainWorktreeRoot = findMainWorktreeRoot(APPS_ROOT)
const platformRoot = resolvePlatformRoot({
  envRoot: process.env.WASMNEST_PLATFORM_ROOT,
  mainWorktreeRoot,
})
const lib = resolveLibRoot({
  envRoot: process.env.WASMNEST_LIB_ROOT,
  platformRoot,
  mainWorktreeRoot,
})

const plan = createLinkPlan({ appsRoot: APPS_ROOT, platformRoot, libRoot: lib?.root ?? null })
const marker = applyLinkPlan(plan)
for (const warning of plan.warnings) console.warn(`[link-platform-sdk] 注意: ${warning}`)
console.log(`[link-platform-sdk] 已 link 到本地平台源码: ${platformRoot}`)
if (lib) console.log(`[link-platform-sdk] 能力仓本地源码: ${lib.root}（${lib.source}）`)
console.log(
  `[link-platform-sdk] 已写入 ${Object.keys(marker.files).length} 个 package.json + ${plan.cargoConfigFile}` +
    `（marker: ${plan.markerFile}）`,
)

if (argv.includes('--no-install')) {
  console.log('[link-platform-sdk] 跳过 pnpm install（--no-install）；依赖已写入但 node_modules 未更新。')
} else {
  const dirs = [APPS_ROOT, ...desktopAppDirs(APPS_ROOT)]
  console.log(`[link-platform-sdk] pnpm install --no-frozen-lockfile（${dirs.length} 个目录）...`)
  runPnpmInstalls({ dirs, spawn: spawnSync })
  console.log('[link-platform-sdk] 依赖安装完成')
}

console.log(
  '[link-platform-sdk] 注意：file: 依赖、lock 更新、.cargo/config.toml patch 与 marker 都是 link 状态，' +
    '提交前必须执行 node scripts/unlink-platform-sdk.mjs 并核对 git status。',
)
