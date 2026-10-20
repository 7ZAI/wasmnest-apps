#!/usr/bin/env node
/**
 * 应用元信息 resolver（.github/workflows 与发布脚本共用）
 *
 * 单一事实来源 = 各 app 的 `plugin.json`（id / version / rustLibrary / pluginType）
 * 与 `package.json`（包名 / 版本）。本脚本只做**读取 + 一致性判据**，不改任何文件
 * （改版本走 `scripts/ci/set-app-version.mjs`）。
 *
 * 一致性判据（发布前必须成立，CI 失败即中止）：
 *  - 同一 app 的所有端，`plugin.json.version` 必须相同（= 该 app 的发布版本）；
 *  - 每端 `package.json.version` 若存在，也必须等于该版本；
 *  - 不一致时**列全**所有端与版本，并给出修法（set-app-version），不猜哪个是对的。
 *
 * 用法：
 *   node scripts/ci/app-info.mjs --list                 # 全部 app slug（每行一个）
 *   node scripts/ci/app-info.mjs --app <slug>           # JSON（含全部端）
 *   node scripts/ci/app-info.mjs --app <slug> --end desktop
 *   node scripts/ci/app-info.mjs --app <slug> --expect-version 0.0.2   # 版本不符即 exit 1
 *   node scripts/ci/app-info.mjs --app <slug> --field version|ends|plugin-ids|slug
 *
 * `--field` 是给 shell / workflow 取值的窄接口（避免在 YAML 里塞 jq）：
 *   ends → JSON 数组，如 ["desktop","mobile"]；plugin-ids → JSON 数组。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 应用仓根（本文件在 `<appsRoot>/scripts/ci/`） */
export const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const APPS_DIR = join(APPS_ROOT, 'apps')
const ENDS = ['desktop', 'mobile']
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** 读 JSON（失败即抛，带用途与路径，绝不静默返回空对象） */
export function readJson(path, what) {
  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    throw new Error(`[ci] 读取${what}失败（${path}）: ${e.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`[ci] 解析${what}失败（${path}）: ${e.message}`)
  }
}

/** 全部 app slug（`apps/<slug>/<end>/plugin.json` 存在的目录） */
export function listSlugs() {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((slug) => ENDS.some((end) => existsSync(join(APPS_DIR, slug, end, 'plugin.json'))))
    .sort()
}

/**
 * 解析单个 app 的元信息。
 *
 * @param {string} slug 应用目录名（`apps/<slug>`）
 * @returns {{slug: string, version: string, dir: string, ends: Array<object>}}
 * @throws 应用不存在 / 清单缺字段 / 端间版本不一致时抛错（含修法）
 */
export function appInfo(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`[ci] 非法 app slug: ${JSON.stringify(slug)}（只允许小写字母 / 数字 / 连字符）`)
  }
  const appDir = join(APPS_DIR, slug)
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    throw new Error(`[ci] 应用不存在: apps/${slug}（可选: ${listSlugs().join(' / ')}）`)
  }

  const ends = []
  for (const end of ENDS) {
    const dir = join(appDir, end)
    const manifestPath = join(dir, 'plugin.json')
    if (!existsSync(manifestPath)) continue

    const manifest = readJson(manifestPath, `插件清单 apps/${slug}/${end}/plugin.json`)
    for (const key of ['id', 'version']) {
      if (typeof manifest[key] !== 'string' || !manifest[key]) {
        throw new Error(`[ci] apps/${slug}/${end}/plugin.json 缺少字符串字段 ${key}`)
      }
    }

    const pkgPath = join(dir, 'package.json')
    const pkg = existsSync(pkgPath)
      ? readJson(pkgPath, `包清单 apps/${slug}/${end}/package.json`)
      : null

    ends.push({
      end,
      dir: relative(APPS_ROOT, dir).split('\\').join('/'),
      id: manifest.id,
      version: manifest.version,
      name: manifest.name ?? manifest.id,
      pluginType: manifest.pluginType ?? null,
      rustLibrary: manifest.rustLibrary ?? null,
      packageName: pkg?.name ?? null,
      packageVersion: pkg?.version ?? null,
    })
  }

  if (ends.length === 0) {
    throw new Error(`[ci] apps/${slug} 没有任何端含 plugin.json（期望 ${ENDS.join(' / ')} 之一）`)
  }

  // 版本一致性：发布语义要求双端同一版本（CI 用它决定 tag / 产物名）
  const observed = new Map()
  for (const e of ends) {
    observed.set(`${e.end}/plugin.json`, e.version)
    if (e.packageVersion) observed.set(`${e.end}/package.json`, e.packageVersion)
  }
  const versions = new Set(observed.values())
  if (versions.size > 1) {
    const detail = [...observed.entries()].map(([where, v]) => `  - ${where}: ${v}`).join('\n')
    throw new Error(
      `[ci] ${slug} 版本不一致（同一 app 的所有端 / 清单必须同版本）：\n${detail}\n` +
        `  修法：node scripts/ci/set-app-version.mjs ${slug} <x.y.z>（发布时一次性写入并提交）`,
    )
  }

  return {
    slug,
    version: ends[0].version,
    dir: relative(APPS_ROOT, appDir).split('\\').join('/'),
    ends,
  }
}

// ==================== CLI ====================

function flagValue(argv, flag) {
  const i = argv.indexOf(flag)
  if (i === -1) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) throw new Error(`[ci] 参数 ${flag} 缺少取值`)
  return v
}

function main(argv) {
  if (argv.includes('--list')) {
    const slugs = listSlugs()
    console.log(argv.includes('--json') ? JSON.stringify(slugs) : slugs.join('\n'))
    return
  }

  const slug = flagValue(argv, '--app')
  if (!slug) {
    throw new Error(
      '用法：node scripts/ci/app-info.mjs --list | --app <slug> [--end desktop|mobile] ' +
        '[--expect-version x.y.z] [--field version|ends|plugin-ids|slug] [--json]',
    )
  }

  const info = appInfo(slug)

  const end = flagValue(argv, '--end')
  if (end) {
    const hit = info.ends.find((e) => e.end === end)
    if (!hit) {
      throw new Error(
        `[ci] ${slug} 没有 ${end} 端（现有: ${info.ends.map((e) => e.end).join(', ')}）`,
      )
    }
    info.ends = [hit]
  }

  const expect = flagValue(argv, '--expect-version')
  if (expect && expect !== info.version) {
    throw new Error(
      `[ci] ${slug} 当前版本是 ${info.version}，期望 ${expect}。\n` +
        `  发布前先跑：node scripts/ci/set-app-version.mjs ${slug} ${expect}（并提交）`,
    )
  }

  const field = flagValue(argv, '--field')
  if (field) {
    if (field === 'ends') console.log(JSON.stringify(info.ends.map((e) => e.end)))
    else if (field === 'plugin-ids')
      console.log(JSON.stringify([...new Set(info.ends.map((e) => e.id))]))
    else if (field in info) {
      const value = info[field]
      console.log(typeof value === 'object' ? JSON.stringify(value) : String(value))
    } else
      throw new Error(`[ci] 未知字段 ${field}（可用: slug / version / dir / ends / plugin-ids）`)
    return
  }

  console.log(JSON.stringify(info, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
