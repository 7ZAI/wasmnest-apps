#!/usr/bin/env node
/**
 * 跨仓依赖装配：把平台仓（wasmnest）/ 能力仓（wasmnest-lib）按 R1 兄弟布局检出到应用仓旁边。
 *
 * 为什么 CI 需要它：应用仓的构建**不是**自足的——
 *  - `package.json` 以 `file:../../../../wasmnest/...` 引用双端 SDK（应用只依赖 SDK 包）；
 *  - 各 `scripts/build.js` 直接 import 平台仓的 `plugin-watch.js` / `wasm-hash.js`；
 *  - `scripts/platform-paths.mjs` 默认取兄弟目录 `../wasmnest`（`WASMNEST_PLATFORM_ROOT` 可覆盖）；
 *  - WIT 是**生成物**（平台仓 `scripts/compose-wit.mjs` 拼装），真源在能力仓。
 *
 * 因此三者必须同场、目录名固定：
 *   <root>/wasmnest-apps   （本仓，由 workflow 的 actions/checkout 检出）
 *   <root>/wasmnest        （平台仓，本脚本检出）
 *   <root>/wasmnest-lib    （能力仓，本脚本检出）
 *
 * 纪律：
 *  - **只创建、不覆盖**既有检出（本机存在脏工作树时绝不 `checkout --force` / `clean`）；
 *    目录已存在即显性报错，交给用户决定。
 *  - `--lib-ref auto`（默认）= 读平台仓 `release-manifest.json` 的 `repos.lib.tag`，
 *    与平台固定的能力仓 tag 一致（跨仓版本唯一表达）。
 *  - 目录 / 文件缺失一律 fail-visible（点名缺哪个、该设什么），不静默降级。
 *
 * 用法（在应用仓根执行）：
 *   node scripts/ci/fetch-cross-repo.mjs [--platform-ref dev] [--lib-ref auto]
 *                                        [--root <dir>] [--platform-repo 7ZAI/wasmnest]
 *                                        [--lib-repo 7ZAI/wasmnest-lib] [--depth 1]
 *
 * 鉴权：私有仓 / 需要跨仓读权限时设 `CROSS_REPO_TOKEN`（PAT）；公开仓可匿名检出。
 * 令牌只经 `git -c http.extraheader=...` 传给单次命令，不写进 remote URL，也不打印。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 应用仓根（本文件在 `<appsRoot>/scripts/ci/`） */
const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const DEFAULTS = {
  platformRepo: '7ZAI/wasmnest',
  libRepo: '7ZAI/wasmnest-lib',
  platformRef: 'dev',
  libRef: 'auto',
  depth: '1',
}

/** 平台仓检出后必须存在的路径（缺一个就说明 ref 不对 / 仓结构变了） */
const PLATFORM_REQUIRED = [
  'release-manifest.json',
  'scripts/compose-wit.mjs',
  'scripts/wasip3-toolchain.sh',
  // componentize 自 54fe8d3 起随桌面 SDK 发布（平台仓根 tools/ 已删除）：
  // 应用构建链经 SDK 包名定位（apps/*/desktop/scripts/sdk-componentize.mjs），
  // 这里校验平台仓检出里 SDK 包内的随包副本。
  'wasmnest-desktop/packages/plugin-sdk-desktop/tools/componentize/Cargo.toml',
  'wasmnest-desktop/packages/plugin-sdk-desktop/package.json',
  'wasmnest-mobile/packages/plugin-sdk-mobile/package.json',
  'wasmnest-mobile/scripts/plugin-build.js',
]

/** 能力仓检出后必须存在的路径（WIT 拼装真源） */
const LIB_REQUIRED = ['wasmnest-contract/src/lib.rs', 'wasmnest-wasm-core/wit/core.wit']

function log(msg) {
  console.log(`[ci] ${msg}`)
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, root: resolve(APPS_ROOT, '..') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`[ci] 意外的位置参数: ${a}`)
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const val = argv[i + 1]
    if (!val || val.startsWith('--')) throw new Error(`[ci] 参数 ${a} 缺少取值`)
    args[key] = val
    i++
  }
  return args
}

/** git 调用：令牌只经 extraheader 传入单次命令（不落 remote、不进日志） */
function git(cwd, args) {
  const token = process.env.CROSS_REPO_TOKEN
  const auth = token
    ? [
        '-c',
        `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
      ]
    : []
  const res = spawnSync('git', [...auth, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (res.error) throw new Error(`[ci] 执行 git 失败（cwd=${cwd}）: ${res.error.message}`)
  if (res.status !== 0) {
    throw new Error(
      `[ci] git ${args.join(' ')} 失败（cwd=${cwd}）:\n  ${(res.stderr || res.stdout || '').trim()}`,
    )
  }
  return (res.stdout || '').trim()
}

/** 检出单个仓到 dest（只允许新建；已存在即报错） */
function checkoutRepo({ dest, repo, ref, label, depth }) {
  if (existsSync(dest)) {
    const entries = existsSync(dest) ? readdirSync(dest) : []
    if (entries.length > 0) {
      throw new Error(
        `[ci] ${label} 目标目录已存在且非空: ${dest}\n` +
          `  本脚本只做“新建检出”，不会覆盖既有工作树（防止误删本地改动）。\n` +
          `  清掉该目录后重跑，或用已有的 R1 布局 / WASMNEST_PLATFORM_ROOT 指向它。`,
      )
    }
  }
  mkdirSync(dest, { recursive: true })
  log(`${label}: 检出 ${repo}@${ref} → ${dest}`)
  git(dest, ['init', '--quiet'])
  git(dest, ['remote', 'add', 'origin', `https://github.com/${repo}.git`])
  git(dest, ['fetch', '--quiet', '--depth', String(depth), '--tags', 'origin', ref])
  git(dest, ['checkout', '--quiet', '--force', 'FETCH_HEAD'])
}

/** 校验检出结果（缺文件即报错，绝不带着半成品继续构建） */
function verifyLayout(root, relPaths, label) {
  const missing = relPaths.filter((p) => !existsSync(join(root, p)))
  if (missing.length > 0) {
    throw new Error(
      `[ci] ${label} 检出内容不完整（${root}）：\n` +
        missing.map((p) => `  - 缺少 ${p}`).join('\n') +
        `\n  多半是 ref 选错（仓结构已变）或检出了错误的仓。`,
    )
  }
}

/** 把解析结果写进 `GITHUB_ENV`（workflow 后续步骤可见；本机运行时静默跳过） */
function exportEnv(pairs) {
  const file = process.env.GITHUB_ENV
  if (!file) return
  appendFileSync(
    file,
    Object.entries(pairs)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root)
  const platformDir = join(root, 'wasmnest')
  const libDir = join(root, 'wasmnest-lib')

  if (!existsSync(join(root, 'wasmnest-apps'))) {
    log(
      `提示: ${join(root, 'wasmnest-apps')} 不存在（本机布局可不叫这个名字；CI 里由 actions/checkout 提供）`,
    )
  }

  checkoutRepo({
    dest: platformDir,
    repo: args.platformRepo,
    ref: args.platformRef,
    label: '平台仓',
    depth: args.depth,
  })
  verifyLayout(platformDir, PLATFORM_REQUIRED, '平台仓')

  // 能力仓 ref：auto = 平台仓 release-manifest.json 固定的精确 tag（跨仓版本唯一表达）
  let libRef = args.libRef
  if (libRef === 'auto') {
    const manifest = JSON.parse(readFileSync(join(platformDir, 'release-manifest.json'), 'utf-8'))
    libRef = manifest?.repos?.lib?.tag
    if (!libRef) {
      throw new Error(
        `[ci] 无法从 ${join(platformDir, 'release-manifest.json')} 读出 repos.lib.tag；` +
          `请显式传 --lib-ref <tag>`,
      )
    }
    log(`能力仓 ref = release-manifest.json repos.lib.tag = ${libRef}`)
  }

  try {
    checkoutRepo({
      dest: libDir,
      repo: args.libRepo,
      ref: libRef,
      label: '能力仓',
      depth: args.depth,
    })
  } catch (e) {
    throw new Error(
      `${e.message}\n` +
        `  若 ref 来自 release-manifest.json 的 tag：确认该 tag 已推到 origin（git push origin ${libRef}）；\n` +
        `  或显式传 --lib-ref dev 临时指向分支。`,
    )
  }
  verifyLayout(libDir, LIB_REQUIRED, '能力仓')

  const platformSha = git(platformDir, ['rev-parse', 'HEAD'])
  const libSha = git(libDir, ['rev-parse', 'HEAD'])
  const appsSha = existsSync(join(APPS_ROOT, '.git'))
    ? git(APPS_ROOT, ['rev-parse', 'HEAD'])
    : '(非 git 检出)'

  exportEnv({
    WASMNEST_PLATFORM_REF: args.platformRef,
    WASMNEST_PLATFORM_SHA: platformSha,
    WASMNEST_LIB_REF: libRef,
    WASMNEST_LIB_SHA: libSha,
    WASMNEST_APPS_SHA: appsSha,
  })

  log('跨仓装配完成：')
  log(`  apps      ${appsSha}  (${APPS_ROOT})`)
  log(`  platform  ${platformSha}  (ref ${args.platformRef})`)
  log(`  lib       ${libSha}  (ref ${libRef})`)
}

try {
  main()
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
