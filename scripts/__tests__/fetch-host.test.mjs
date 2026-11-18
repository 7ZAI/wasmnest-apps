/**
 * fetch-host / host-runtime.lock 单测（票据 A5 / CONTRACT §2.3、§4）
 *
 * 全部用临时缓存 + 本地 fixture：
 *  - 下载路径注入 `fetchImpl`，**不访问真实 GitHub**；
 *  - tar fixture 由本文件的 ustar 写入器现场构造（与实现解耦，按 CONTRACT §1.2 的
 *    扁平一层形态生成）。
 * 运行：node --test scripts/__tests__/fetch-host.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  cacheDirFor,
  extractTarGz,
  fetchHostRuntime,
  installHostFromDir,
  installHostFromTarball,
  loadHostLock,
  resolveFetchVersion,
} from '../fetch-host.mjs'
import { normalizeArch, normalizePlatform } from '../host-runtime.mjs'

const FETCH_SCRIPT = fileURLToPath(new URL('../fetch-host.mjs', import.meta.url))
const PLATFORM = normalizePlatform()
const ARCH = normalizeArch()
const KEY = `${PLATFORM}-${ARCH}`
const BINARY = PLATFORM === 'windows' ? 'wasmnest-desktop.exe' : 'wasmnest-desktop'

// ==================== 夹具 ====================

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-fetch-host-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

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

function hostMeta(overrides = {}) {
  return {
    hostVersion: '0.0.1',
    platform: PLATFORM,
    arch: ARCH,
    sourceCommit: 'a'.repeat(40),
    libTag: 'lib-v0.0.1',
    witVersion: '0.0.1',
    sdkVersion: '0.0.1',
    mountContract: '1',
    binary: BINARY,
    builtBy: 'fixture',
    builtAt: '2026-10-21T00:00:00.000Z',
    pluginsEnv: 'WASMNEST_PLUGINS_DIR',
    note: 'fixture',
    ...overrides,
  }
}

/** 造一份 host:pack 目录形态的宿主产物（CONTRACT §1.1） */
function makeHostDir(dir, { meta = {}, binaryMode = 0o755 } = {}) {
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, BINARY)
  writeFileSync(bin, '#!/bin/sh\necho host\n')
  chmodSync(bin, binaryMode)
  writeFileSync(join(dir, 'config.properties'), '')
  const metaJson = hostMeta(meta)
  writeFileSync(join(dir, 'host-version.json'), JSON.stringify(metaJson, null, 2) + '\n')
  return { dir, bin, meta: metaJson }
}

function writeLock(appsRoot, hostRuntime = {}) {
  const lock = {
    hostRuntime: {
      version: '0.0.1',
      sourceCommit: 'a'.repeat(40),
      libTag: 'lib-v0.0.1',
      witVersion: '0.0.1',
      sdkVersion: '0.0.1',
      mountContract: '1',
      artifacts: {},
      ...hostRuntime,
    },
  }
  writeFileSync(join(appsRoot, 'host-runtime.lock.json'), JSON.stringify(lock, null, 2) + '\n')
  return lock
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 极简 ustar 头（测试夹具；只覆盖本用例需要的类型） */
function tarHeader({ name, size = 0, mode = 0o644, type = '0', linkname = '' }) {
  const buf = Buffer.alloc(512)
  buf.write(name, 0, 100, 'utf8')
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii')
  buf.write('0000000\0', 108, 8, 'ascii')
  buf.write('0000000\0', 116, 8, 'ascii')
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  buf.write('00000000000\0', 136, 12, 'ascii')
  buf.fill(0x20, 148, 156)
  buf.write(type, 156, 1, 'ascii')
  if (linkname) buf.write(linkname, 157, 100, 'utf8')
  buf.write('ustar', 257, 6, 'ascii')
  buf.write('00', 263, 2, 'ascii')
  const sum = buf.reduce((acc, byte) => acc + byte, 0)
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return buf
}

/** entries: [{ name, data?, mode?, type?, linkname? }] */
function makeTarGz(entries) {
  const chunks = []
  for (const entry of entries) {
    const data = entry.data === undefined ? Buffer.alloc(0) : Buffer.from(entry.data)
    const type = entry.type ?? '0'
    chunks.push(
      tarHeader({
        name: entry.name,
        size: data.length,
        mode: entry.mode ?? 0o644,
        type,
        linkname: entry.linkname ?? '',
      }),
    )
    if (data.length) {
      chunks.push(data)
      const pad = (512 - (data.length % 512)) % 512
      if (pad) chunks.push(Buffer.alloc(pad))
    }
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks))
}

/** 一份可用的宿主 tar.gz + host-version.json（扁平一层） */
function makeHostTar({ meta = {}, binaryMode = 0o755 } = {}) {
  return makeTarGz([
    { name: BINARY, data: '#!/bin/sh\necho host\n', mode: binaryMode },
    { name: 'config.properties', data: '' },
    { name: 'host-version.json', data: JSON.stringify(hostMeta(meta), null, 2) + '\n' },
  ])
}

/** 假 fetch：按 URL 返回 tar / sha 边车 / 404 / 抛错 */
function fakeFetch({ tar, sidecar, onCall } = {}) {
  return async (url) => {
    if (onCall) onCall(String(url))
    if (String(url).endsWith('.sha256')) {
      if (sidecar === undefined) return { ok: false, status: 404, statusText: 'Not Found' }
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(sidecar) }
    }
    return { ok: true, status: 200, arrayBuffer: async () => tar }
  }
}

function assertNoCache(cacheRoot) {
  assert.equal(existsSync(cacheRoot), false, `失败时不应落缓存：${cacheRoot}`)
}

// ==================== 版本 / lock ====================

test('resolveFetchVersion：WASMNEST_HOST_VERSION 优先于 lock', (t) => {
  const appsRoot = tempRoot(t)
  writeLock(appsRoot)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  assert.equal(resolveFetchVersion({ appsRoot }), '0.0.1')
  withEnv(t, { WASMNEST_HOST_VERSION: '9.9.9' })
  assert.equal(resolveFetchVersion({ appsRoot }), '9.9.9')
})

test('resolveFetchVersion：env 与 lock 都缺失 ⇒ 显性报错并指出两条出路', (t) => {
  const appsRoot = tempRoot(t)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  assert.throws(
    () => resolveFetchVersion({ appsRoot }),
    /\[fetch-host\].*WASMNEST_HOST_VERSION.*host-runtime\.lock\.json/s,
  )
})

test('loadHostLock：lock 缺 hostRuntime.version ⇒ 抛错（lock 是版本真源，不能留空）', (t) => {
  const appsRoot = tempRoot(t)
  writeFileSync(join(appsRoot, 'host-runtime.lock.json'), '{ "hostRuntime": {} }\n')
  assert.throws(() => loadHostLock({ appsRoot }), /hostRuntime\.version/)

  writeFileSync(join(appsRoot, 'host-runtime.lock.json'), '{ "hostRuntime": { "version": "0.0.1" } }\n')
  assert.throws(() => loadHostLock({ appsRoot }), /hostRuntime\.artifacts/)
})

// ==================== tar 解包（安全边界） ====================

test('extractTarGz：扁平一层解包、保留可执行位', (t) => {
  const root = tempRoot(t)
  const dest = join(root, 'out')
  extractTarGz(makeHostTar({ binaryMode: 0o755 }), dest)

  assert.equal(readFileSync(join(dest, BINARY), 'utf-8'), '#!/bin/sh\necho host\n')
  assert.equal(statSync(join(dest, BINARY)).mode & 0o111, 0o111)
  assert.equal(existsSync(join(dest, 'host-version.json')), true)
  assert.equal(existsSync(join(dest, 'config.properties')), true)
})

test('extractTarGz：拒绝 ../ 穿越条目，且不写出任何文件', (t) => {
  const root = tempRoot(t)
  const dest = join(root, 'out')
  const escape = join(root, 'escape')
  const tar = makeTarGz([{ name: '../escape', data: 'pwn' }])

  assert.throws(() => extractTarGz(tar, dest), /\[fetch-host\].*(\.\.|穿越)/)
  assert.equal(existsSync(escape), false)
})

test('extractTarGz：拒绝绝对路径条目', (t) => {
  const root = tempRoot(t)
  const dest = join(root, 'out')
  const tar = makeTarGz([{ name: '/etc/evil', data: 'pwn' }])
  assert.throws(() => extractTarGz(tar, dest), /\[fetch-host\].*(绝对|absolute)/)
})

test('extractTarGz：拒绝符号链接条目（防逃逸）', (t) => {
  const root = tempRoot(t)
  const dest = join(root, 'out')
  const tar = makeTarGz([{ name: 'link', type: '2', linkname: '/etc/passwd' }])
  assert.throws(() => extractTarGz(tar, dest), /\[fetch-host\].*符号链接/)
})

// ==================== 下载 + 校验 + 原子落缓存 ====================

test('fetchHostRuntime：下载 tar、校验 lock sha、解包并写 .complete', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  const tar = makeHostTar()
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: sha256(tar) } },
  })

  const result = await fetchHostRuntime({
    appsRoot,
    cacheRoot,
    fetchImpl: fakeFetch({ tar, sidecar: `${sha256(tar)}  host.tar.gz\n` }),
  })

  assert.equal(result.source, 'cache')
  assert.equal(result.dir, cacheDirFor({ cacheRoot, version: '0.0.1', platform: PLATFORM, arch: ARCH }))
  assert.equal(result.bin, join(result.dir, BINARY))
  assert.equal(existsSync(join(result.dir, '.complete')), true)
  const complete = JSON.parse(readFileSync(join(result.dir, '.complete'), 'utf-8'))
  assert.equal(complete.sha256, sha256(tar))
  assert.match(complete.extractedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('fetchHostRuntime：sha 不匹配 ⇒ 报错且不落缓存', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  const tar = makeHostTar()
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: 'f'.repeat(64) } },
  })

  await assert.rejects(
    () =>
      fetchHostRuntime({
        appsRoot,
        cacheRoot,
        fetchImpl: fakeFetch({ tar, sidecar: undefined }),
      }),
    /\[fetch-host\].*sha256.*不匹配/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

test('fetchHostRuntime：lock 边车与 lock sha 不一致 ⇒ 报错（不落缓存）', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  const tar = makeHostTar()
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: sha256(tar) } },
  })

  await assert.rejects(
    () =>
      fetchHostRuntime({
        appsRoot,
        cacheRoot,
        fetchImpl: fakeFetch({ tar, sidecar: `${'e'.repeat(64)}  host.tar.gz\n` }),
      }),
    /\[fetch-host\].*边车.*sha256.*不一致/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

test('fetchHostRuntime：meta 的 hostVersion / platform / arch 任一不符 ⇒ 点名报错', async (t) => {
  for (const [field, value] of [
    ['hostVersion', '9.9.9'],
    ['platform', 'windows'],
    ['arch', 'arm64'],
  ]) {
    const root = tempRoot(t)
    const appsRoot = join(root, 'apps')
    const cacheRoot = join(root, 'cache')
    mkdirSync(appsRoot, { recursive: true })
    const tar = makeHostTar({ meta: { [field]: value } })
    writeLock(appsRoot, {
      artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: sha256(tar) } },
    })

    await assert.rejects(
      () =>
        fetchHostRuntime({
          appsRoot,
          cacheRoot,
          fetchImpl: fakeFetch({ tar, sidecar: undefined }),
        }),
      new RegExp(`\\[fetch-host\\].*host-version\\.json.*${field}`, 's'),
      `字段 ${field} 不符时必须点名`,
    )
    assertNoCache(join(cacheRoot, '0.0.1'))
  }
})

test('fetchHostRuntime：404 ⇒ 报错并提示 --host 本地产物', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: 'a'.repeat(64) } },
  })

  await assert.rejects(
    () =>
      fetchHostRuntime({
        appsRoot,
        cacheRoot,
        fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
      }),
    /\[fetch-host\].*404[\s\S]*--host/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

test('fetchHostRuntime：网络不可达 ⇒ 报错带 CONTRACT §4.3 三选一指引', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: 'a'.repeat(64) } },
  })

  await assert.rejects(
    () =>
      fetchHostRuntime({
        appsRoot,
        cacheRoot,
        fetchImpl: async () => {
          throw new TypeError('fetch failed')
        },
      }),
    /\[host-runtime\][\s\S]*fetch-host\.mjs[\s\S]*host:pack[\s\S]*--host/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

test('fetchHostRuntime：lock artifacts 为空 + 当前平台 ⇒ 显性失败（不回退）', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, { artifacts: {} })

  await assert.rejects(
    () => fetchHostRuntime({ appsRoot, cacheRoot, fetchImpl: fakeFetch({ tar: makeHostTar() }) }),
    /\[fetch-host\].*artifacts[\s\S]*(?:linux|macos|windows)-(?:x86_64|arm64)/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

// ==================== --from 本地 bootstrap ====================

test('installHostFromDir：复制目录 + 校验 meta + 写 .complete（可执行位保留）', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  const from = join(root, 'host-desktop')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, { artifacts: {} })
  makeHostDir(from)

  const result = await installHostFromDir({ fromDir: from, appsRoot, cacheRoot })
  assert.equal(result.source, 'from-dir')
  assert.equal(statSync(result.bin).mode & 0o111, 0o111)
  assert.equal(existsSync(join(result.dir, '.complete')), true)
})

test('installHostFromDir：meta 与 lock 版本不符 ⇒ 报错且不落缓存', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  const from = join(root, 'host-desktop')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, { artifacts: {} })
  makeHostDir(from, { meta: { hostVersion: '9.9.9' } })

  await assert.rejects(
    () => installHostFromDir({ fromDir: from, appsRoot, cacheRoot }),
    /\[fetch-host\].*hostVersion.*0\.0\.1.*9\.9\.9/s,
  )
  assertNoCache(join(cacheRoot, '0.0.1'))
})

test('installHostFromTarball：lock 无 sha 时打印「未校验发布 sha」警告并安装', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  const tarPath = join(root, 'host.tar.gz')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot, { artifacts: {} })
  writeFileSync(tarPath, makeHostTar())

  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  t.after(() => {
    console.warn = original
  })

  const result = await installHostFromTarball({ fromPath: tarPath, appsRoot, cacheRoot })
  assert.equal(result.source, 'from-tar')
  assert.equal(warnings.some((line) => line.includes('未校验发布 sha')), true)
})

// ==================== 缓存复用 / --force ====================

test('fetchHostRuntime：缓存命中不重复下载；--force 强制重下', async (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  const tar = makeHostTar()
  writeLock(appsRoot, {
    artifacts: { [KEY]: { file: `host-desktop-0.0.1-${KEY}.tar.gz`, sha256: sha256(tar) } },
  })

  let downloads = 0
  const fetchImpl = fakeFetch({ tar, onCall: (url) => { if (!url.endsWith('.sha256')) downloads += 1 } })

  await fetchHostRuntime({ appsRoot, cacheRoot, fetchImpl })
  await fetchHostRuntime({ appsRoot, cacheRoot, fetchImpl })
  assert.equal(downloads, 1, '第二次应复用时缓存')

  await fetchHostRuntime({ appsRoot, cacheRoot, fetchImpl, force: true })
  assert.equal(downloads, 2, '--force 必须重下')
})

// ==================== CLI ====================

test('CLI --print：只打印解析到的 bin，不触发下载', (t) => {
  const root = tempRoot(t)
  const cacheRoot = join(root, 'cache')
  const host = makeHostDir(join(root, 'host-desktop'))
  const out = execFileSync(process.execPath, [FETCH_SCRIPT, '--print'], {
    env: {
      ...process.env,
      WASMNEST_HOST_BIN: host.bin,
      WASMNEST_HOST_CACHE: cacheRoot,
      WASMNEST_HOST_VERSION: undefined,
    },
    encoding: 'utf-8',
  })
  assert.equal(out.trim(), host.bin)
  assert.equal(existsSync(cacheRoot), false)
})
