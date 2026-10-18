#!/usr/bin/env node
/**
 * 应用仓命令编排：在全部 app 工程目录里跑同一条 package.json 脚本。
 *
 * 用法：`node scripts/run-apps.mjs <script> [args...]`
 *
 * 口径：
 * - 目标 = `apps/<slug>/{desktop,mobile}`（目录内含 `package.json` 且声明了该脚本才跑，
 *   缺脚本时打印 skip 而不是静默略过）；
 * - **串行执行**：各 app 共用应用仓 `target/wasm-apps` 与磁盘，并发会互相争抢；
 * - 任一失败即最终 exit 1（汇总打印，不吞错误）。
 *
 * 为什么需要它：应用仓各 app 保留独立 pnpm workspace（各有自己的 lock 与依赖图，
 * 不合并成单 workspace——SDK 在平台仓、经 `file:` 依赖跨仓引用），因此需要一层
 * 编排把「全部 app」跑成一条命令。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [, , script, ...extra] = process.argv
if (!script) {
  console.error('用法：node scripts/run-apps.mjs <script> [args...]（如 test:run / build）')
  process.exit(2)
}

/** 全部 app 工程目录（apps/<slug>/{desktop,mobile}） */
function appProjects() {
  const appsDir = join(APPS_ROOT, 'apps')
  const out = []
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const end of ['desktop', 'mobile']) {
      const dir = join(appsDir, entry.name, end)
      if (existsSync(join(dir, 'package.json'))) out.push(dir)
    }
  }
  out.sort()
  return out
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
