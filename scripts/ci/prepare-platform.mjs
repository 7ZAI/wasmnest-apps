#!/usr/bin/env node
/**
 * 平台侧构建前置（CI 用）：WIT 拼装 + 双端 SDK 的 `dist` 构建。
 *
 * 为什么需要（fresh checkout 里这些都不在 git 里）：
 *  - 双端 SDK 的 `rust/wit/` 是**生成物**：平台仓 `scripts/compose-wit.mjs`
 *    从能力仓真源拼装（platform 的 `.gitignore` 管辖）。不拼装 → cargo 找不到 WIT。
 *  - 双端 SDK 的 `dist/` 同样不入库（`main` / `exports` 指向 `dist/*.js`）：
 *    桌面 app 前端有运行时 import（如 `PLUGIN_CONFIG_STORAGE_KEY`），移动 app 的
 *    `vite.config.ts` import `@binblink/wasmnest-plugin-sdk-mobile/vite`。
 *
 * 依赖关系：
 *  - 本脚本假定 `fetch-cross-repo.mjs` 已把平台仓 / 能力仓检出为兄弟目录（R1 布局）；
 *  - 平台仓走它自己的 pnpm workspace / lockfile，应用仓不复制其依赖图。
 *
 * 用法（在应用仓根执行）：
 *   node scripts/ci/prepare-platform.mjs [--ends all|desktop,mobile] [--skip-wit] [--force]
 *
 * 默认“dist 已就绪就跳过”（避免在本地开发机上重跑平台仓 install / 扰动其 node_modules）；
 * `--force` 强制重建。CI 是 fresh checkout（dist 不入库），所以总是会构建。
 *
 * 失败一律 exit 1 并点名缺哪一步（不静默跳过 SDK 构建——那会让 app 构建在 import 期炸）。
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { platformRoot } from '../platform-paths.mjs'

const DESKTOP_SDK = 'wasmnest-desktop/packages/plugin-sdk-desktop'
const MOBILE_SDK = 'wasmnest-mobile/packages/plugin-sdk-mobile'

function log(msg) {
  console.log(`[ci] ${msg}`)
}

function fail(msg) {
  console.error(`[ci] ${msg}`)
  process.exit(1)
}

function run(cmd, args, cwd) {
  log(`$ ${cmd} ${args.join(' ')}   (cwd=${cwd})`)
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (res.error) fail(`执行失败: ${cmd} ${args.join(' ')}: ${res.error.message}`)
  if (res.status !== 0) fail(`命令非零退出（${res.status}）: ${cmd} ${args.join(' ')}`)
}

/** 校验产物存在（SDK dist 缺失时给出「哪一步没跑」的判据） */
function verifyFiles(root, relPaths, label) {
  const missing = relPaths.filter((p) => !existsSync(join(root, p)))
  if (missing.length > 0) {
    fail(
      `${label} 产物缺失（${root}）：\n` +
        missing.map((p) => `  - ${p}`).join('\n') +
        `\n  用法：node scripts/ci/prepare-platform.mjs --ends all`,
    )
  }
}

function parseEnds(argv) {
  const i = argv.indexOf('--ends')
  if (i === -1) return ['desktop', 'mobile']
  const raw = argv[i + 1]
  if (!raw || raw.startsWith('--')) fail('--ends 缺少取值（all / desktop,mobile）')
  if (raw === 'all') return ['desktop', 'mobile']
  const ends = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const e of ends) {
    if (!['desktop', 'mobile'].includes(e))
      fail(`--ends 取值非法: ${e}（允许 desktop / mobile / all）`)
  }
  return ends
}

function main() {
  const argv = process.argv.slice(2)
  const ends = parseEnds(argv)
  const force = argv.includes('--force')
  const platform = platformRoot()
  log(`平台仓: ${platform}；目标端: ${ends.join(', ')}${force ? '；--force 重建' : ''}`)

  // 1. WIT 拼装：双端一起拼（幂等；--check 是漂移锁，CI 这里要的是写生成物）
  if (!argv.includes('--skip-wit')) {
    run(process.execPath, [join(platform, 'scripts', 'compose-wit.mjs'), '--all'], platform)
    verifyFiles(
      platform,
      [`${DESKTOP_SDK}/rust/wit/wasmnest.wit`, `${MOBILE_SDK}/rust/wit/wasmnest.wit`],
      'WIT 生成物',
    )
  } else {
    log('--skip-wit：跳过 WIT 拼装（假定生成物已就绪）')
  }

  // 2. 桌面 SDK dist：桌面 app 前端有运行时 import（不是 type-only，vite build 必须解析到 dist）
  if (ends.includes('desktop')) {
    const workspace = join(platform, 'wasmnest-desktop')
    const sdkDist = join(platform, DESKTOP_SDK, 'dist')
    if (
      !force &&
      existsSync(join(sdkDist, 'index.js')) &&
      existsSync(join(sdkDist, 'vite-plugin.js'))
    ) {
      log('桌面 SDK dist 已存在，跳过（--force 重建）')
    } else {
      // 只装 SDK 及其 workspace 依赖链中最少的一组：根工程（wasmnest-desktop）持有
      // tsup 的 optional peer `typescript`，SDK 的 `build` 靠它出 d.ts。
      run('pnpm', ['install', '--frozen-lockfile', '--filter', 'wasmnest-desktop'], workspace)
      run('pnpm', ['--filter', '@binblink/wasmnest-plugin-sdk-desktop', 'run', 'build'], workspace)
    }
    verifyFiles(
      join(platform, DESKTOP_SDK),
      ['dist/index.js', 'dist/index.d.ts', 'dist/vite-plugin.js'],
      '桌面 SDK dist',
    )
  }

  // 3. 移动 SDK dist：移动 app 的 vite.config.ts import `@binblink/wasmnest-plugin-sdk-mobile/vite`
  if (ends.includes('mobile')) {
    const sdkDir = join(platform, MOBILE_SDK)
    const sdkDist = join(sdkDir, 'dist')
    if (
      !force &&
      existsSync(join(sdkDist, 'index.js')) &&
      existsSync(join(sdkDist, 'vite-plugin.js'))
    ) {
      log('移动 SDK dist 已存在，跳过（--force 重建）')
    } else {
      run('pnpm', ['install', '--frozen-lockfile'], sdkDir)
      run('pnpm', ['run', 'build'], sdkDir)
    }
    verifyFiles(
      join(platform, MOBILE_SDK),
      ['dist/index.js', 'dist/vite-plugin.js'],
      '移动 SDK dist',
    )
    verifyFiles(join(platform, MOBILE_SDK), ['bin/cli.js'], '移动 SDK CLI')
  }

  log('平台侧前置就绪 ✅')
}

try {
  main()
} catch (e) {
  console.error(`[ci] ${e.message}`)
  process.exit(1)
}
