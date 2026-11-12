#!/usr/bin/env node
/**
 * 设置单个 app 的发布版本（**发布动作**的一部分，不是日常开发动作）。
 *
 * 写入点（同一 app 的所有端，保持一处版本语义）：
 *  - `apps/<slug>/<end>/plugin.json` 的 `version`（应用清单版本，也是产物里显示的版本）；
 *  - `apps/<slug>/<end>/package.json` 的 `version`（工程包版本）。
 *
 * 不写：Rust `Cargo.toml` 的 crate version（crate 版本与 app 发布版本解耦；
 * 改它还会牵动 Cargo.lock，见平台仓 `docs/public/versioning.md` §3）。
 *
 * 版本纪律（`../wasmnest/docs/public/versioning.md` §1）：只有发布时 bump，dev 日常不动。
 * 本脚本只负责「机械写入 + 输出 diff」，是否发布由人决定。
 *
 * 用法（在应用仓根执行）：
 *   node scripts/ci/set-app-version.mjs <slug> <x.y.z> [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { APPS_ROOT, appInfo } from './app-info.mjs'

const SEMVER_RE = /^\d+\.\d+\.\d+$/

function fail(msg) {
  console.error(`[set-app-version] ${msg}`)
  process.exit(1)
}

function main() {
  const argv = process.argv.slice(2)
  const positional = argv.filter((a) => !a.startsWith('--'))
  const dryRun = argv.includes('--dry-run')

  const [slug, version] = positional
  if (!slug || !version)
    fail('用法: node scripts/ci/set-app-version.mjs <slug> <x.y.z> [--dry-run]')
  if (!SEMVER_RE.test(version)) {
    fail(
      `版本号非法: ${JSON.stringify(version)}（只接受 x.y.z；预发布后缀当前不引入，见 versioning.md §6）`,
    )
  }

  const info = appInfo(slug)
  console.log(
    `[set-app-version] ${slug}: ${info.version} → ${version}${dryRun ? '（dry-run）' : ''}`,
  )

  const changed = []
  for (const end of info.ends) {
    for (const file of ['plugin.json', 'package.json']) {
      const path = join(APPS_ROOT, end.dir, file)
      let raw
      try {
        raw = readFileSync(path, 'utf-8')
      } catch {
        continue // package.json 可缺（如纯清单端），plugin.json 一定存在
      }
      const json = JSON.parse(raw)
      if (json.version === version) continue
      if (typeof json.version !== 'string') {
        fail(`${end.dir}/${file} 缺少字符串 version 字段，拒绝猜测写入`)
      }
      const next = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`)
      if (!dryRun) writeFileSync(path, next, 'utf-8')
      changed.push(`${end.dir}/${file}: ${json.version} → ${version}`)
    }
  }

  if (changed.length === 0) {
    console.log(`[set-app-version] 已是 ${version}，无需改动`)
  } else {
    for (const line of changed) console.log(`  ${line}`)
    console.log(
      dryRun
        ? '[set-app-version] dry-run 结束（未写盘）'
        : '[set-app-version] 已写入。发布时请把版本改动与 tag 放在同一组提交里（versioning.md §5）',
    )
  }
}

try {
  main()
} catch (e) {
  fail(e.message)
}
