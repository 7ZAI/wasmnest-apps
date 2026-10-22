#!/usr/bin/env node
/**
 * 业务代码 console.* → logger.* 机械化替换（应用仓）
 *
 * 三仓拆分前本脚本在旧仓根、扫描 `wasmnest-desktop/wasm-apps/bedcode/src`（桌面产品
 * 前端已整体下沉该 app）与 `wasmnest-mobile/src`（移动宿主业务页）。拆分后业务源码
 * 全部住应用仓，脚本随业务代码迁到本仓，目标改为：
 *   - desktop：`<group>/<slug>/desktop/src/**`（逐工程扫描；group ∈ apps / servers）
 *   - mobile ：`<group>/<slug>/mobile/src/**`
 *
 * 规则：
 * - 导入 `import { logger } from '@/utils/frontendLogger'`（或相对路径）
 * - console.log/debug/info/warn/error( → logger.log/debug/info/warn/error(
 * - 跳过：测试文件、devConsoleRelay.ts、frontendLogger.ts 自身、已 import logger 的文件
 * - 只处理**自带** `src/utils/frontendLogger.ts` 的 app：没有该模块的 app 打 skip
 *   （说明其日志口径尚未接入统一 logger，不能机械插入不存在的导入）
 *
 * 用法：node scripts/replace-console.mjs <desktop|mobile> [appDirName]
 *   appDirName 可选：只处理该 slug（默认处理该端全部工程）。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listProjects } from './lib/projects.mjs'

const target = process.argv[2]
const onlyApp = process.argv[3]
if (target !== 'desktop' && target !== 'mobile') {
  console.error('用法: node scripts/replace-console.mjs <desktop|mobile> [appDirName]')
  process.exit(1)
}

/** 递归收集目录下需要处理的源码（跳过 node_modules / dist / 测试） */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collect(p, out)
    else if (/\.(ts|vue)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p)
  }
  return out
}

const LEVELS = ['log', 'debug', 'info', 'warn', 'error']
const re = new RegExp(`\\bconsole\\.(${LEVELS.join('|')})\\(`, 'g')
const importRe = /import\s*\{[^}]*logger[^}]*\}\s*from\s*['"]@\/utils\/frontendLogger['"]/

let changedFiles = 0
let replacedCalls = 0

const appProjects = listProjects({ ends: [target] })
  .filter((p) => !onlyApp || p.slug === onlyApp)
  .sort((a, b) => a.rel.localeCompare(b.rel))

for (const project of appProjects) {
  const srcDir = join(project.dir, 'src')
  if (!existsSync(srcDir)) continue
  // 没有统一 logger 模块的 app 不机械插入导入（会产出坏引用）
  if (!existsSync(join(srcDir, 'utils', 'frontendLogger.ts'))) {
    console.log(`[跳过] ${project.rel}: 无 src/utils/frontendLogger.ts`)
    continue
  }

  for (const file of collect(srcDir)) {
    if (file.endsWith('devConsoleRelay.ts') || file.endsWith('frontendLogger.ts')) continue
    let src = readFileSync(file, 'utf8')
    if (importRe.test(src)) continue // 已接入 logger，跳过（幂等）

    const callCount = (src.match(re) || []).length
    if (callCount === 0) continue

    const importLine = `import { logger } from '@/utils/frontendLogger'`

    if (file.endsWith('.ts')) {
      const lines = src.split('\n')
      const firstImport = lines.findIndex((l) => /^\s*import\b/.test(l))
      const insertAt = firstImport !== -1 ? firstImport + 1 : 0
      lines.splice(insertAt, 0, importLine)
      src = lines.join('\n')
    } else {
      const scriptMatch = src.match(/<script[^>]*>([\s\S]*?)<\/script>/)
      if (!scriptMatch) {
        console.warn(`[跳过] ${file}: 未找到 <script> 块`)
        continue
      }
      const block = scriptMatch[1]
      const blockLines = block.split('\n')
      const firstImport = blockLines.findIndex((l) => /^\s*import\b/.test(l))
      if (firstImport !== -1) blockLines.splice(firstImport + 1, 0, importLine)
      else {
        const firstCode = blockLines.findIndex((l) => /^\S/.test(l))
        blockLines.splice(firstCode === -1 ? 0 : firstCode, 0, importLine)
      }
      src = src.replace(scriptMatch[1], blockLines.join('\n'))
    }

    src = src.replace(re, (m, lv) => `logger.${lv}(`)
    writeFileSync(file, src)
    changedFiles++
    replacedCalls += callCount
  }
}

console.log(`完成: ${changedFiles} 文件, ${replacedCalls} 处 console.* → logger.* (${target})`)
