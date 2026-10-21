/**
 * host-runtime resolver 单测（票据 A4 / CONTRACT §3）
 *
 * 全部用临时目录与临时 env，不碰真实缓存、不碰平台仓工作树。
 * 运行：node --test scripts/__tests__/host-runtime.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertHostCompatible,
  hostRuntimeMissingHint,
  normalizeArch,
  normalizePlatform,
  platformArch,
  resolveCacheRoot,
  resolveHostRuntime,
  resolveHostVersion,
} from '../host-runtime.mjs'

// ==================== 夹具 ====================

/** 临时根目录（用后即删） */
function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-host-runtime-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 临时 env（用后还原） */
function withEnv(t, vars) {
  const saved = new Map()
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

/** 写 host-version.json */
function writeMeta(dir, overrides = {}) {
  const meta = {
    hostVersion: '0.0.1',
    platform: platformArch().platform,
    arch: platformArch().arch,
    sourceCommit: 'a'.repeat(40),
    libTag: 'lib-v0.0.2',
    witVersion: '0.0.1',
    sdkVersion: '0.0.1',
    mountContract: '1',
    binary: 'wasmnest-desktop',
    builtBy: 'fixture',
    builtAt: '2026-10-21T00:00:00.000Z',
    pluginsEnv: 'WASMNEST_PLUGINS_DIR',
    note: 'fixture',
    ...overrides,
  }
  writeFileSync(join(dir, 'host-version.json'), JSON.stringify(meta, null, 2))
  return meta
}

// ==================== 平台 / 架构归一化 ====================

test('normalizePlatform：win32→windows、darwin→macos、linux 保持', () => {
  assert.equal(normalizePlatform('win32'), 'windows')
  assert.equal(normalizePlatform('darwin'), 'macos')
  assert.equal(normalizePlatform('linux'), 'linux')
})

test('normalizePlatform：未知平台 fail-visible', () => {
  assert.throws(() => normalizePlatform('freebsd'), /\[host-runtime\].*不支持的平台.*freebsd/)
})

test('normalizeArch：x64→x86_64、arm64→arm64', () => {
  assert.equal(normalizeArch('x64'), 'x86_64')
  assert.equal(normalizeArch('arm64'), 'arm64')
})

test('normalizeArch：未知架构 fail-visible', () => {
  assert.throws(() => normalizeArch('ia32'), /\[host-runtime\].*不支持的架构.*ia32/)
})

test('platformArch：返回资产/缓存键 <platform>-<arch>', () => {
  const got = platformArch()
  const expectedPlatform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]
  const expectedArch = { x64: 'x86_64', arm64: 'arm64' }[process.arch]
  assert.equal(got.platform, expectedPlatform)
  assert.equal(got.arch, expectedArch)
  assert.equal(got.key, `${expectedPlatform}-${expectedArch}`)
})

// ==================== 缓存根解析 ====================

test('resolveCacheRoot：WASMNEST_HOST_CACHE 优先于平台默认', (t) => {
  const root = tempRoot(t)
  const custom = join(root, 'custom-cache')
  withEnv(t, { WASMNEST_HOST_CACHE: custom, XDG_CACHE_HOME: join(root, 'xdg') })
  assert.equal(resolveCacheRoot(), custom)
})

test('resolveCacheRoot：Linux 用 $XDG_CACHE_HOME/wasmnest/host', (t) => {
  if (process.platform !== 'linux') return
  const root = tempRoot(t)
  const xdg = join(root, 'xdg')
  withEnv(t, { WASMNEST_HOST_CACHE: undefined, XDG_CACHE_HOME: xdg })
  assert.equal(resolveCacheRoot(), join(xdg, 'wasmnest', 'host'))
})

test('resolveCacheRoot：Linux 无 XDG 时用 ~/.cache/wasmnest/host', (t) => {
  if (process.platform !== 'linux') return
  const home = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_CACHE: undefined, XDG_CACHE_HOME: undefined, HOME: home })
  assert.equal(resolveCacheRoot(), join(home, '.cache', 'wasmnest', 'host'))
})

// ==================== 显式指定（档 1） ====================

/** 当前平台的可执行文件名（测试夹具） */
function binaryName() {
  return platformArch().platform === 'windows' ? 'wasmnest-desktop.exe' : 'wasmnest-desktop'
}

/** 造一份宿主产物目录（host:pack 目录形态） */
function makeHostDir(dir, { metaOverrides = {}, binary = binaryName() } = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, binary), '#!/bin/sh\n', { mode: 0o755 })
  writeFileSync(join(dir, 'config.properties'), '')
  const meta = writeMeta(dir, { binary, ...metaOverrides })
  return { dir, bin: join(dir, binary), meta }
}

test('resolveHostRuntime({ explicit: 目录 })：按 host-version.json.binary 找可执行', (t) => {
  const root = tempRoot(t)
  const { dir, bin, meta } = makeHostDir(join(root, 'host-desktop'))
  const got = resolveHostRuntime({ explicit: dir, platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.ok(got)
  assert.equal(got.source, 'explicit')
  assert.equal(got.bin, bin)
  assert.equal(got.dir, dir)
  assert.equal(got.meta.hostVersion, meta.hostVersion)
})

test('resolveHostRuntime({ explicit: 目录 })：缺 binary 字段时按平台形态扫描', (t) => {
  const root = tempRoot(t)
  const dir = join(root, 'host-desktop')
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, binaryName())
  writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
  writeFileSync(join(dir, 'config.properties'), '')
  const got = resolveHostRuntime({ explicit: dir, platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.ok(got)
  assert.equal(got.bin, bin)
  assert.equal(got.dir, dir)
})

test('resolveHostRuntime({ explicit: 文件 })：bin=文件、dir=dirname，meta 取自同目录', (t) => {
  const root = tempRoot(t)
  const { dir, bin } = makeHostDir(join(root, 'host-desktop'))
  const got = resolveHostRuntime({ explicit: bin, platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.ok(got)
  assert.equal(got.source, 'explicit')
  assert.equal(got.bin, bin)
  assert.equal(got.dir, dir)
  assert.equal(got.meta.binary, binaryName())
})

test('resolveHostRuntime({ explicit })：路径不存在 ⇒ 抛错（不静默回退）', (t) => {
  const root = tempRoot(t)
  assert.throws(
    () => resolveHostRuntime({ explicit: join(root, 'nope'), platformRoot: null, cacheRoot: join(root, 'cache') }),
    /\[host-runtime\].*显式指定的宿主路径不存在/,
  )
})

test('resolveHostRuntime({ explicit })：目录里找不到可执行 ⇒ 抛错', (t) => {
  const root = tempRoot(t)
  const dir = join(root, 'empty-host')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.properties'), '')
  assert.throws(
    () => resolveHostRuntime({ explicit: dir, platformRoot: null, cacheRoot: join(root, 'cache') }),
    /\[host-runtime\].*找不到可执行/,
  )
})

test('显式来源优先级：--host > WASMNEST_HOST_BIN > WASMNEST_HOST_APP', (t) => {
  const root = tempRoot(t)
  const argHost = makeHostDir(join(root, 'arg-host'))
  const binHost = makeHostDir(join(root, 'bin-host'))
  const appHost = makeHostDir(join(root, 'app-host'))
  withEnv(t, { WASMNEST_HOST_BIN: binHost.bin, WASMNEST_HOST_APP: appHost.dir })

  const byArg = resolveHostRuntime({ explicit: argHost.bin, platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.equal(byArg.bin, argHost.bin)

  const byBin = resolveHostRuntime({ platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.equal(byBin.bin, binHost.bin)

  // 外层 withEnv 负责最终还原，这里直接删即可（避免嵌套 withEnv 的还原顺序反把值写回）。
  delete process.env.WASMNEST_HOST_BIN
  const byApp = resolveHostRuntime({ platformRoot: null, cacheRoot: join(root, 'cache') })
  assert.equal(byApp.bin, appHost.bin)
  assert.equal(byApp.dir, appHost.dir)
})

// ==================== 本机 host:pack 产物（档 2） ====================

/** 造平台仓根下的 host:pack 产物（dist-host 新落点 / dist 旧落点） */
function makeLocalHost(platformRoot, { legacy = false, builtAt, metaOverrides = {} } = {}) {
  const parts = legacy
    ? ['wasmnest-desktop', 'dist', 'host-desktop']
    : ['wasmnest-desktop', 'dist-host', 'host-desktop']
  return makeHostDir(join(platformRoot, ...parts), {
    metaOverrides: { ...(builtAt ? { builtAt } : {}), ...metaOverrides },
  })
}

/** 造缓存条目 `<cacheRoot>/<version>/<platform>-<arch>/` */
function makeCacheEntry(cacheRoot, version, { complete = true, builtAt, metaOverrides = {} } = {}) {
  const dir = join(cacheRoot, version, platformArch().key)
  const hit = makeHostDir(dir, {
    metaOverrides: { hostVersion: version, ...(builtAt ? { builtAt } : {}), ...metaOverrides },
  })
  if (complete) {
    writeFileSync(join(dir, '.complete'), JSON.stringify({ sha256: 'deadbeef', unpackedAt: builtAt }))
  }
  return hit
}

/** 写应用仓 lock（版本真源档 2） */
function writeLock(appsRoot, version = '0.0.1') {
  mkdirSync(appsRoot, { recursive: true })
  writeFileSync(join(appsRoot, 'host-runtime.lock.json'), JSON.stringify({ hostRuntime: { version } }))
}

test('auto：本机产物在场且无缓存 ⇒ 用本机（source=local）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  const local = makeLocalHost(platformRoot)
  writeLock(join(root, 'apps'))
  const got = resolveHostRuntime({
    appsRoot: join(root, 'apps'),
    platformRoot,
    cacheRoot: join(root, 'cache'),
  })
  assert.ok(got)
  assert.equal(got.source, 'local')
  assert.equal(got.bin, local.bin)
})

test('auto：本机比缓存新 ⇒ 用本机', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  const local = makeLocalHost(platformRoot, { builtAt: '2026-10-22T00:00:00.000Z' })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  makeCacheEntry(cacheRoot, '0.0.1', { builtAt: '2026-10-21T00:00:00.000Z' })
  const got = resolveHostRuntime({ appsRoot, platformRoot, cacheRoot })
  assert.equal(got.source, 'local')
  assert.equal(got.bin, local.bin)
})

test('auto：本机比缓存旧 ⇒ 用缓存（避免旧本机遮住新缓存）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  makeLocalHost(platformRoot, { builtAt: '2026-10-20T00:00:00.000Z' })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  const cached = makeCacheEntry(cacheRoot, '0.0.1', { builtAt: '2026-10-21T00:00:00.000Z' })
  const got = resolveHostRuntime({ appsRoot, platformRoot, cacheRoot })
  assert.equal(got.source, 'cache')
  assert.equal(got.bin, cached.bin)
})

test('本机兼容旧落点 dist/host-desktop', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  const local = makeLocalHost(platformRoot, { legacy: true })
  writeLock(join(root, 'apps'))
  const got = resolveHostRuntime({
    appsRoot: join(root, 'apps'),
    platformRoot,
    cacheRoot: join(root, 'cache'),
  })
  assert.equal(got.source, 'local')
  assert.equal(got.bin, local.bin)
})

test('WASMNEST_HOST_PREFER=local：本机比缓存旧也强制本机', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: 'local', WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  const local = makeLocalHost(platformRoot, { builtAt: '2026-10-20T00:00:00.000Z' })
  writeLock(join(root, 'apps'))
  const got = resolveHostRuntime({
    appsRoot: join(root, 'apps'),
    platformRoot,
    cacheRoot: join(root, 'cache'),
  })
  assert.equal(got.source, 'local')
  assert.equal(got.bin, local.bin)
})

test('WASMNEST_HOST_PREFER=local：本机不存在 ⇒ 抛错并给出 host:pack 指引', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: 'local', WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  assert.throws(
    () =>
      resolveHostRuntime({
        appsRoot: join(root, 'apps'),
        platformRoot: join(root, 'platform'),
        cacheRoot: join(root, 'cache'),
      }),
    /\[host-runtime\].*host:pack/,
  )
})

test('WASMNEST_HOST_PREFER=cache：跳过更新的本机，直接用缓存', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: 'cache', WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  makeLocalHost(platformRoot, { builtAt: '2026-10-22T00:00:00.000Z' })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  const cached = makeCacheEntry(cacheRoot, '0.0.1', { builtAt: '2026-10-21T00:00:00.000Z' })
  const got = resolveHostRuntime({ appsRoot, platformRoot, cacheRoot })
  assert.equal(got.source, 'cache')
  assert.equal(got.bin, cached.bin)
})

test('WASMNEST_HOST_PREFER 非法值 ⇒ fail-visible', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: 'sometimes' })
  assert.throws(
    () =>
      resolveHostRuntime({ appsRoot: join(root, 'apps'), platformRoot: null, cacheRoot: join(root, 'cache') }),
    /\[host-runtime\].*WASMNEST_HOST_PREFER/,
  )
})

// ==================== 已下载缓存（档 3） ====================

test('cache：按 <cacheRoot>/<version>/<platform>-<arch> 命中', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot, '0.0.1')
  const cacheRoot = join(root, 'cache')
  const cached = makeCacheEntry(cacheRoot, '0.0.1')
  const got = resolveHostRuntime({ appsRoot, platformRoot: null, cacheRoot })
  assert.ok(got)
  assert.equal(got.source, 'cache')
  assert.equal(got.bin, cached.bin)
  assert.equal(got.dir, cached.dir)
})

test('cache：.complete 缺失 ⇒ 视为不完整，不使用', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  makeCacheEntry(cacheRoot, '0.0.1', { complete: false })
  assert.equal(resolveHostRuntime({ appsRoot, platformRoot: null, cacheRoot }), null)
})

test('cache：键必须含 <platform>-<arch>（别的架构键不命中）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  const current = platformArch()
  const wrongArch = current.arch === 'x86_64' ? 'arm64' : 'x86_64'
  makeHostDir(join(cacheRoot, '0.0.1', `${current.platform}-${wrongArch}`))
  assert.equal(resolveHostRuntime({ appsRoot, platformRoot: null, cacheRoot }), null)
})

test('平台仓不在场时，缓存仍可用（不抛「平台仓缺失」）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  const cached = makeCacheEntry(cacheRoot, '0.0.1')
  const got = resolveHostRuntime({
    appsRoot,
    platformRoot: join(root, 'missing-platform'),
    cacheRoot,
  })
  assert.equal(got.source, 'cache')
  assert.equal(got.bin, cached.bin)
})

test('优先级：显式 > 本机 > 缓存', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const platformRoot = join(root, 'platform')
  makeLocalHost(platformRoot, { builtAt: '2026-10-22T00:00:00.000Z' })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  const cacheRoot = join(root, 'cache')
  makeCacheEntry(cacheRoot, '0.0.1')
  const explicit = makeHostDir(join(root, 'explicit'))

  const got = resolveHostRuntime({ explicit: explicit.dir, appsRoot, platformRoot, cacheRoot })
  assert.equal(got.source, 'explicit')
  assert.equal(got.bin, explicit.bin)
})

test('各档都没有（lock 有版本）⇒ 返回 null', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_PREFER: undefined, WASMNEST_HOST_BIN: undefined, WASMNEST_HOST_APP: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot)
  assert.equal(
    resolveHostRuntime({ appsRoot, platformRoot: join(root, 'missing'), cacheRoot: join(root, 'cache') }),
    null,
  )
})

// ==================== 版本解析（env > lock > manifest > 缺失） ====================

/** 写平台 manifest 的 hostRuntime.version */
function writeManifest(platformRoot, version) {
  mkdirSync(platformRoot, { recursive: true })
  writeFileSync(
    join(platformRoot, 'release-manifest.json'),
    JSON.stringify({ hostRuntime: { version } }),
  )
}

test('resolveHostVersion：WASMNEST_HOST_VERSION > lock > manifest', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: '9.9.9' })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot, '0.0.1')
  const platformRoot = join(root, 'platform')
  writeManifest(platformRoot, '0.0.2')
  assert.equal(resolveHostVersion({ appsRoot, platformRoot }), '9.9.9')
})

test('resolveHostVersion：无 env 时 lock 优先于 manifest', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot, '0.0.1')
  const platformRoot = join(root, 'platform')
  writeManifest(platformRoot, '0.0.2')
  assert.equal(resolveHostVersion({ appsRoot, platformRoot }), '0.0.1')
})

test('resolveHostVersion：无 lock 时回退平台 manifest', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  const appsRoot = join(root, 'apps')
  mkdirSync(appsRoot, { recursive: true })
  const platformRoot = join(root, 'platform')
  writeManifest(platformRoot, '0.0.2')
  assert.equal(resolveHostVersion({ appsRoot, platformRoot }), '0.0.2')
})

test('resolveHostVersion：三档都缺失 ⇒ 抛错（不硬编码默认版本）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  const appsRoot = join(root, 'apps')
  mkdirSync(appsRoot, { recursive: true })
  assert.throws(
    () => resolveHostVersion({ appsRoot, platformRoot: join(root, 'missing') }),
    /\[host-runtime\].*无法确定宿主运行时版本/,
  )
})

test('resolveHostVersion：lock 缺 hostRuntime.version ⇒ 抛错（不静默跳过）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  const appsRoot = join(root, 'apps')
  mkdirSync(appsRoot, { recursive: true })
  writeFileSync(join(appsRoot, 'host-runtime.lock.json'), JSON.stringify({ hostRuntime: {} }))
  assert.throws(
    () => resolveHostVersion({ appsRoot, platformRoot: null }),
    /\[host-runtime\].*缺少 hostRuntime\.version/,
  )
})

test('resolveHostRuntime 的缓存查找用 lock 版本（非硬编码）', (t) => {
  const root = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined, WASMNEST_HOST_PREFER: undefined })
  const appsRoot = join(root, 'apps')
  writeLock(appsRoot, '7.8.9')
  const cacheRoot = join(root, 'cache')
  const cached = makeCacheEntry(cacheRoot, '7.8.9')
  const got = resolveHostRuntime({ appsRoot, platformRoot: null, cacheRoot })
  assert.equal(got.source, 'cache')
  assert.equal(got.bin, cached.bin)
})




// ==================== 兼容检查（CONTRACT §7 / D15） ====================

const EXPECTED = { sdkVersion: '0.0.1', witVersion: '0.0.1', mountContract: '1' }

test('assertHostCompatible：三轴一致 ⇒ 不抛错', () => {
  assert.doesNotThrow(() => assertHostCompatible({ ...EXPECTED }, EXPECTED))
})

test('assertHostCompatible：sdkVersion 不匹配 ⇒ 点名 + 换宿主 / 重建 app 指引', () => {
  assert.throws(
    () => assertHostCompatible({ ...EXPECTED, sdkVersion: '0.0.2' }, EXPECTED),
    (err) => {
      assert.match(err.message, /\[host-runtime\].*sdkVersion 不匹配/)
      assert.match(err.message, /宿主 0\.0\.2.*期望 0\.0\.1/)
      assert.match(err.message, /fetch-host\.mjs --version/)
      assert.match(err.message, /pnpm run build/)
      return true
    },
  )
})

test('assertHostCompatible：witVersion 不匹配 ⇒ 点名 + 全量重建指引', () => {
  assert.throws(
    () => assertHostCompatible({ ...EXPECTED, witVersion: '0.0.2' }, EXPECTED),
    (err) => {
      assert.match(err.message, /\[host-runtime\].*witVersion 不匹配/)
      assert.match(err.message, /全量重建/)
      return true
    },
  )
})

test('assertHostCompatible：mountContract 不匹配 ⇒ 点名 + 换宿主 / 重建 app 指引', () => {
  assert.throws(
    () => assertHostCompatible({ ...EXPECTED, mountContract: '2' }, EXPECTED),
    (err) => {
      assert.match(err.message, /\[host-runtime\].*mountContract 不匹配/)
      assert.match(err.message, /fetch-host\.mjs --version/)
      assert.match(err.message, /pnpm run build/)
      return true
    },
  )
})

test('assertHostCompatible：旧宿主缺字段 ⇒ fail-visible（不当作匹配）', () => {
  const legacy = { ...EXPECTED }
  delete legacy.sdkVersion
  assert.throws(
    () => assertHostCompatible(legacy, EXPECTED),
    /\[host-runtime\].*缺少 sdkVersion.*host-version\.json/,
  )
})

test('assertHostCompatible：没有 host-version.json（meta=null）⇒ fail-visible', () => {
  assert.throws(
    () => assertHostCompatible(null, EXPECTED),
    /\[host-runtime\].*缺少 host-version\.json/,
  )
})

// ==================== 缺失指引（CONTRACT §4.3） ====================

test('hostRuntimeMissingHint：含下载 / 本机构建 / 显式指定三条可执行路径', () => {
  const hint = hostRuntimeMissingHint({ version: '0.0.1' })
  assert.match(hint, /\[host-runtime\].*未找到桌面宿主运行时/)
  assert.match(hint, /node scripts\/fetch-host\.mjs --version 0\.0\.1/)
  assert.match(hint, /pnpm run host:pack/)
  assert.match(hint, /pnpm run dev:host -- --host <host-desktop 目录>/)
})

test('hostRuntimeMissingHint：未给 version 时用 lock / env 解析，缺失则留占位符', (t) => {
  withEnv(t, { WASMNEST_HOST_VERSION: '4.5.6' })
  assert.match(hostRuntimeMissingHint(), /fetch-host\.mjs --version 4\.5\.6/)
})
