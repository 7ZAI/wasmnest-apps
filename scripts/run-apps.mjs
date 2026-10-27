#!/usr/bin/env node
/**
 * 应用仓命令编排：在全部 app 工程目录里跑同一条 package.json 脚本。
 *
 * 用法：`node scripts/run-apps.mjs <script> [--only=<group>/<slug>] [args...]`
 *
 * 口径：
 * - 目标 = `<group>/<slug>/{desktop,mobile}`（group ∈ apps / servers，见
 *   `scripts/lib/projects.mjs` 这个唯一枚举点）；目录内含 `package.json` 且声明了
 *   该脚本才跑，缺脚本时打印 skip 而不是静默略过；
 * - `--only=<group>/<slug>`（该工程全部端）或 `--only=<group>/<slug>/<end>`（单端）：
 *   只跑一个工程（CI 里每工程一个 job，见 `.github/workflows/ci.yml` 的 `test` 矩阵）；
 *   不匹配任何工程时**显性失败**并列出可选值；
 * - 其余参数原样透传给工程脚本；
 * - **串行执行**：各 app 共用应用仓 `target/wasm-apps` 与磁盘，并发会互相争抢；
 * - 任一失败即最终 exit 1（汇总打印，不吞错误）。
 *
 * 为什么需要它：应用仓各 app 保留独立 pnpm workspace（各有自己的 lock 与依赖图，
 * 不合并成单 workspace——SDK 在平台仓、经 `file:` 依赖跨仓引用），因此需要一层
 * 编排把「全部 app」跑成一条命令。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APPS_ROOT, listProjects } from './lib/projects.mjs'

const [, , script, ...rawArgs] = process.argv
if (!script) {
  console.error(
    '用法：node scripts/run-apps.mjs <script> [--only=<group>/<slug>] [args...]（如 test:run / build）',
  )
  process.exit(2)
}

/** `--only=<group>/<slug>`：只跑一个工程（消费方 = CI 的每工程一个 job）；其余参数透传给脚本 */
let only = null
const extra = []
for (const a of rawArgs) {
  if (a.startsWith('--only=')) only = a.slice('--only='.length)
  else extra.push(a)
}

/** 全部工程目录（apps/servers × <slug> × {desktop,mobile}，按 package.json 存在与否筛选） */
function appProjects() {
  const all = listProjects({ requirePackage: true }).map((p) => p.dir)
  if (only === null) return all
  const target = join(APPS_ROOT, only)
  // `--only=<group>/<slug>`（该工程全部端）或 `--only=<group>/<slug>/<end>`（单端）
  const hit = all.filter((dir) => dir === target || dirname(dir) === target)
  if (hit.length === 0) {
    console.error(
      `[run-apps] --only=${only} 未匹配任何工程（需 <group>/<slug>，如 apps/bedcode）；可选：`,
    )
    for (const dir of all) console.error(`  ${dir.slice(APPS_ROOT.length + 1)}`)
    process.exit(2)
  }
  return hit
}

const results = []
for (const dir of appProjects()) {
  const rel = dir.slice(APPS_ROOT.length + 1)
  let scripts = {}
  try {
    scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).scripts ?? {}
  } catch (e) {
    console.error(`[run-apps] ${rel} 的 package.json 解析失败：${e.message}`)
    results.push({ rel, status: 'fail' })
    continue
  }
  if (!scripts[script]) {
    console.log(`[run-apps] skip ${rel}（未声明脚本 ${script}）`)
    results.push({ rel, status: 'skip' })
    continue
  }
  console.log(`\n[run-apps] ====== ${rel} :: pnpm run ${script} ======`)
  const res = spawnSync('pnpm', ['run', script, ...extra], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  results.push({ rel, status: res.status === 0 ? 'ok' : 'fail' })
}

console.log('\n[run-apps] ====== 汇总 ======')
for (const r of results) console.log(`  ${r.status.padEnd(4)} ${r.rel}`)
const failed = results.filter((r) => r.status === 'fail')
if (failed.length > 0) {
  console.error(`[run-apps] ${failed.length} 个 app 失败：${failed.map((r) => r.rel).join(', ')}`)
  process.exit(1)
}
console.log('[run-apps] 全部通过')
