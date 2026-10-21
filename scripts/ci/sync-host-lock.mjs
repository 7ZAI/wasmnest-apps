#!/usr/bin/env node

/**
 * sync-host-lock —— 从平台仓 `release-manifest.json` 同步应用仓 `host-runtime.lock.json`
 * （CONTRACT §2.3，票据 A5）
 *
 * lock 是应用仓消费宿主运行时的**版本 / sha256 唯一真源**；平台仓未发布时
 * `hostRuntime.artifacts` 为空对象（不伪造 sha），发布后由 CI / 开发者重跑本脚本。
 *
 * ```bash
 * node scripts/ci/sync-host-lock.mjs            # 写入 lock
 * node scripts/ci/sync-host-lock.mjs --check    # 只比对（漂移非零退出，CI 用）
 * ```
 *
 * 平台仓根解析：`--platform-root` → `WASMNEST_PLATFORM_ROOT` → 主工作树兄弟 `wasmnest`
 * （与 `scripts/host-runtime.mjs` 同一套定位，不 import `platform-paths.mjs`）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS_ROOT, detectPlatformRoot } from '../host-runtime.mjs'

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const ARTIFACT_KEY_RE = /^(linux|macos|windows)-(x86_64|arm64)$/
const SHA256_RE = /^[0-9a-f]{64}$/

/** lock 只保留 CONTRACT §2.3 的字段（manifest 的 `$comment` 等说明字段不复制） */
const LOCK_FIELDS = Object.freeze([
  'version',
  'sourceCommit',
  'libTag',
  'witVersion',
  'sdkVersion',
  'mountContract',
  'artifacts',
])

function fail(message) {
  throw new Error(`[sync-host-lock] ${message}`)
}

function assertArtifact(key, artifact, version) {
  if (!artifact || typeof artifact !== 'object') {
    fail(`artifacts.${key} 必须是对象（{ file, sha256 }）。`)
  }
  const [platform, arch] = key.split('-')
  const expectedFile = `host-desktop-${version}-${platform}-${arch}.tar.gz`
  if (artifact.file !== expectedFile) {
    fail(
      `artifacts.${key}.file 必须是 "${expectedFile}"（CONTRACT §1.2），` +
        `收到：${artifact.file}`,
    )
  }
  if (!SHA256_RE.test(artifact.sha256 ?? '')) {
    fail(`artifacts.${key}.sha256 必须是 64 位小写 hex，收到：${artifact.sha256}`)
  }
}

/**
 * 从平台 `release-manifest.json` 的 `hostRuntime` 段构造 lock（只做形状校验，不改值）。
 */
export function buildHostLock(manifest) {
  const hostRuntime = manifest?.hostRuntime
  if (!hostRuntime || typeof hostRuntime !== 'object') {
    fail('平台 release-manifest.json 缺少 hostRuntime 段（先合并平台 P2）。')
  }

  if (!SEMVER_RE.test(hostRuntime.version ?? '')) {
    fail(`hostRuntime.version 必须是 x.y.z，收到：${hostRuntime.version}`)
  }
  if (!COMMIT_RE.test(hostRuntime.sourceCommit ?? '')) {
    fail(`hostRuntime.sourceCommit 必须是 40 位 hex，收到：${hostRuntime.sourceCommit}`)
  }
  for (const field of ['libTag', 'witVersion', 'sdkVersion', 'mountContract']) {
    if (typeof hostRuntime[field] !== 'string' || !hostRuntime[field].trim()) {
      fail(`hostRuntime.${field} 缺失或为空。`)
    }
  }
  if (!hostRuntime.artifacts || typeof hostRuntime.artifacts !== 'object') {
    fail('hostRuntime.artifacts 必须是对象（未发布时为空对象）。')
  }
  for (const [key, artifact] of Object.entries(hostRuntime.artifacts)) {
    if (!ARTIFACT_KEY_RE.test(key)) {
      fail(`artifacts 的 key 必须是 <platform>-<arch>（收到：${key}）。`)
    }
    assertArtifact(key, artifact, hostRuntime.version)
  }

  const lock = { hostRuntime: {} }
  for (const field of LOCK_FIELDS) lock.hostRuntime[field] = hostRuntime[field]
  return lock
}

/** 固定格式：2 空格缩进 + 尾换行（与仓库其它 JSON 一致，避免无意义漂移） */
export function formatHostLock(lock) {
  return `${JSON.stringify(lock, null, 2)}\n`
}

/** 同步结果：written / unchanged / drift（不写文件） */
export function syncHostLock({
  platformRoot,
  appsRoot = APPS_ROOT,
  check = false,
} = {}) {
  const resolvedAppsRoot = resolve(appsRoot || APPS_ROOT)
  const actualPlatformRoot = resolve(
    platformRoot || process.env.WASMNEST_PLATFORM_ROOT || detectPlatformRoot({ appsRoot: resolvedAppsRoot }),
  )
  const manifestPath = join(actualPlatformRoot, 'release-manifest.json')
  if (!existsSync(manifestPath)) {
    fail(
      `找不到平台仓 manifest：${manifestPath}\n` +
        '[sync-host-lock]   → 设置 WASMNEST_PLATFORM_ROOT 指向平台仓，或传入 --platform-root <dir>。',
    )
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (e) {
    fail(`解析 ${manifestPath} 失败：${e.message}`)
  }

  const lock = buildHostLock(manifest)
  const lockPath = join(resolvedAppsRoot, 'host-runtime.lock.json')
  const nextText = formatHostLock(lock)
  const existingText = existsSync(lockPath) ? readFileSync(lockPath, 'utf-8') : null

  if (existingText === nextText) return { status: 'unchanged', lockPath, lock }
  if (check) return { status: 'drift', lockPath, lock, existingText }

  writeFileSync(lockPath, nextText)
  return { status: 'written', lockPath, lock }
}

const USAGE = `用法：node scripts/ci/sync-host-lock.mjs [选项]

  --check                 只比对 host-runtime.lock.json 与平台 manifest（漂移非零退出）
  --platform-root <dir>   平台仓根（默认 WASMNEST_PLATFORM_ROOT → 主工作树兄弟 wasmnest）
  --apps-root <dir>       应用仓根（默认本仓；测试 / 多工作树用）
  -h, --help              显示本帮助`

function parseArgs(argv) {
  const options = { check: false, platformRoot: null, appsRoot: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') options.check = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--platform-root' || arg === '--apps-root') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) fail(`${arg} 需要一个目录值。`)
      options[arg === '--platform-root' ? 'platformRoot' : 'appsRoot'] = value
      i += 1
    } else {
      fail(`未知参数：${arg}\n${USAGE}`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const result = syncHostLock(options)
  if (result.status === 'unchanged') {
    console.log(`[sync-host-lock] 无漂移：${result.lockPath}`)
    return
  }
  if (result.status === 'drift') {
    console.error(
      `[sync-host-lock] lock 与平台 manifest 不一致：${result.lockPath}\n` +
        '[sync-host-lock]   → 重跑 node scripts/ci/sync-host-lock.mjs 并提交 lock。',
    )
    process.exitCode = 1
    return
  }
  console.log(`[sync-host-lock] 已写入：${result.lockPath}`)
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
}
