#!/usr/bin/env node
/**
 * 发布链路纯净锁（S7 / D8）
 *
 * 规则：**宿主运行时与通用 runtime crate 不进 app 发布产物**。应用仓发布链
 * （`scripts/ci/build-app.mjs` → `dist/release/<slug>-<end>-v<version>.zip`）里，桌面
 * app 包只应含应用自己的东西（`index.js` / `plugin.json` / `icon.svg` / `<rustLib>.wasm`
 * 及随包资源）。
 *
 * 为什么要一条机器判据：宿主运行时在 dev / 验证期被**合法**消费（`dev:host`、
 * `fetch-host` 缓存、runtime crate 都碰它）。一旦哪个环节把宿主产物当「app 的一部分」
 * 拷进产物目录或 stage，app 包就会带着宿主二进制发布出去——体积爆掉是小事，
 * 「谁拥有宿主版本」的归属被改写才是大事（AGENTS §2 三仓边界 / D8）。
 *
 * 判据形态：按名字黑名单命中，**全部列出**（不只报第一条）；命中即非零退出。
 *
 * 用法：
 *   node scripts/ci/check-release-purity.mjs --dir <产物目录> [--dir 更多]
 *   node scripts/ci/check-release-purity.mjs --list <每行一个相对路径的清单文件>
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 黑名单（顺序即报告顺序）。
 *
 * 命中口径刻意是**整段路径名**而不是子串：`wasmnest_plugin_agent_hub.wasm` 这类 app
 * 自身产物不能被误判成宿主二进制（误判 = 发布链自己不敢动）。
 */
export const RELEASE_PURITY_RULES = [
  {
    id: 'host-binary',
    reason: '桌面宿主二进制（宿主运行时属平台仓产物，不进 app 发布，D8）',
    match: (name, segments) =>
      name === 'wasmnest-desktop' || name === 'wasmnest-desktop.exe' || segments.includes('wasmnest-desktop'),
  },
  {
    id: 'host-binary-windows',
    reason: '桌面宿主二进制（Windows 形态）',
    match: (name) => name === 'wasmnest-desktop.exe',
  },
  {
    id: 'host-version',
    reason: '宿主版本事实（host-version.json 只随宿主产物分发）',
    match: (name) => name === 'host-version.json',
  },
  {
    id: 'host-lock',
    reason: '应用仓宿主 lock（host-runtime.lock.json 属消费侧配置，不随 app 发布）',
    match: (name) => name === 'host-runtime.lock.json',
  },
  {
    id: 'shell-dist',
    reason: '宿主壳前端目录（随包壳属宿主 runtime crate，不属 app）',
    match: (name, segments) => segments.includes('shell-dist'),
  },
  {
    id: 'runtime-crate',
    reason: 'L2 通用 runtime crate 痕迹（dev-only，不进 app 发布）',
    match: (name, segments) =>
      segments.some((s) => s === 'wasmnest-desktop-runtime' || s.startsWith('libwasmnest_desktop_lib.')),
  },
  {
    id: 'host-asset',
    reason: '宿主发布资产（tar.gz / sha256 属宿主产物，不属 app 包）',
    match: (name) => /^host-desktop-.+\.(tar\.gz|tar\.gz\.sha256|sha256)$/.test(name),
  },
]

/**
 * 从「相对路径列表」里挑出违规项（纯函数，供正反例单测与 build-app 复用）。
 *
 * @param {string[]} paths 相对路径（`/` 分隔）
 * @returns {{path: string, rule: string, reason: string}[]} 命中顺序与规则顺序无关，按输入顺序
 */
export function findReleasePurityViolations(paths) {
  const hits = []
  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    const name = segments[segments.length - 1] ?? ''
    const rule = RELEASE_PURITY_RULES.find((r) => r.match(name, segments))
    if (rule) hits.push({ path, rule: rule.id, reason: rule.reason })
  }
  return hits
}

/** 递归列出目录下所有条目相对路径（目录本身也列出，便于点名 `shell-dist/`） */
export function listReleaseEntries(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(rel)
      out.push(...listReleaseEntries(full, rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

/**
 * 校验一个产物目录：干净 ⇒ 返回空数组；脏 ⇒ 抛错并逐条点名（`[release-purity]` 前缀）。
 */
export function checkReleasePurity(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`[release-purity] ✗ 产物目录不存在：${dir}（先构建再检查，不允许空转）`)
  }
  const violations = findReleasePurityViolations(listReleaseEntries(dir))
  if (violations.length > 0) {
    throw new Error(
      `[release-purity] ✗ app 发布产物里出现宿主 / runtime crate 痕迹（${dir}）：\n` +
        violations.map((v) => `[release-purity]   - ${v.path} —— ${v.reason}`).join('\n') +
        `\n[release-purity]   → 宿主产物只用于 dev / 验证期（dev:host、fetch-host、install-runtime），` +
        `不得被拷进 app 产物目录；检查构建脚本与打包 stage 的来源。`,
    )
  }
  return violations
}

// ==================== CLI ====================

function parseArgs(argv) {
  const args = { dirs: [], list: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') args.dirs.push(resolve(argv[++i]))
    else if (a === '--list') args.list = resolve(argv[++i])
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`[release-purity] 未知参数：${a}（--dir <目录> / --list <清单文件>）`)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：node scripts/ci/check-release-purity.mjs [--dir <产物目录>]... [--list <路径清单文件>]')
    return
  }
  if (args.dirs.length === 0 && !args.list) {
    throw new Error('[release-purity] 至少要一个 --dir 或 --list（什么都不检查等于空转）')
  }
  for (const dir of args.dirs) {
    checkReleasePurity(dir)
    console.log(`[release-purity] ✓ 产物纯净：${dir}`)
  }
  if (args.list) {
    const paths = readFileSync(args.list, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const violations = findReleasePurityViolations(paths)
    if (violations.length > 0) {
      console.error(
        `[release-purity] ✗ 清单里出现宿主 / runtime crate 痕迹（${args.list}）：\n` +
          violations.map((v) => `[release-purity]   - ${v.path} —— ${v.reason}`).join('\n'),
      )
      process.exit(1)
    }
    console.log(`[release-purity] ✓ 清单通过（${paths.length} 条，宿主痕迹 0）：${args.list}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (e) {
    console.error(`[release-purity] ✗ ${e?.message ?? e}`)
    process.exit(1)
  }
}
