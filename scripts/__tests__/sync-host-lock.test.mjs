/**
 * sync-host-lock 单测（票据 A5 / CONTRACT §2.3）
 *
 * 用临时平台仓 / 应用仓 fixture，不碰真实工作树。
 * 运行：node --test scripts/__tests__/sync-host-lock.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHostLock, formatHostLock, syncHostLock } from '../ci/sync-host-lock.mjs'

const SYNC_SCRIPT = fileURLToPath(new URL('../ci/sync-host-lock.mjs', import.meta.url))
const SHA = 'a'.repeat(64)

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-sync-lock-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function manifest(overrides = {}) {
  return {
    hostRuntime: {
      version: '0.0.1',
      sourceCommit: 'b'.repeat(40),
      libTag: 'lib-v0.0.1',
      witVersion: '0.0.1',
      sdkVersion: '0.0.1',
      mountContract: '1',
      artifacts: {},
      $comment: '发布时填充',
      ...overrides,
    },
  }
}

function fixture(t, hostRuntime = {}) {
  const root = tempRoot(t)
  const platformRoot = join(root, 'wasmnest')
  const appsRoot = join(root, 'wasmnest-apps')
  mkdirSync(platformRoot, { recursive: true })
  mkdirSync(appsRoot, { recursive: true })
  writeFileSync(
    join(platformRoot, 'release-manifest.json'),
    JSON.stringify(manifest(hostRuntime), null, 2) + '\n',
  )
  return { root, platformRoot, appsRoot, lockPath: join(appsRoot, 'host-runtime.lock.json') }
}

test('buildHostLock：只保留 CONTRACT §2.3 字段，忽略 $comment', () => {
  const lock = buildHostLock(manifest())
  assert.deepEqual(Object.keys(lock.hostRuntime), [
    'version',
    'sourceCommit',
    'libTag',
    'witVersion',
    'sdkVersion',
    'mountContract',
    'artifacts',
  ])
  assert.equal(lock.hostRuntime.artifacts && typeof lock.hostRuntime.artifacts, 'object')
})

test('buildHostLock：artifacts 空对象允许（平台未发布）', () => {
  const lock = buildHostLock(manifest({ artifacts: {} }))
  assert.deepEqual(lock.hostRuntime.artifacts, {})
})

test('buildHostLock：artifacts 命名 / sha 不合法 ⇒ 点名报错', () => {
  assert.throws(
    () =>
      buildHostLock(
        manifest({
          artifacts: { 'linux-x86_64': { file: 'wrong.tar.gz', sha256: SHA } },
        }),
      ),
    /artifacts\.linux-x86_64\.file.*host-desktop-0\.0\.1-linux-x86_64\.tar\.gz/s,
  )
  assert.throws(
    () =>
      buildHostLock(
        manifest({
          artifacts: { 'linux-x86_64': { file: 'host-desktop-0.0.1-linux-x86_64.tar.gz', sha256: 'xyz' } },
        }),
      ),
    /artifacts\.linux-x86_64\.sha256.*64 位/s,
  )
  assert.throws(
    () => buildHostLock(manifest({ artifacts: { 'linux-ia32': { file: 'x', sha256: SHA } } })),
    /artifacts 的 key/,
  )
})

test('buildHostLock：缺 hostRuntime / 版本 / commit ⇒ fail-visible', () => {
  assert.throws(() => buildHostLock({}), /缺少 hostRuntime/)
  assert.throws(() => buildHostLock(manifest({ version: 'latest' })), /hostRuntime\.version.*x\.y\.z/)
  assert.throws(() => buildHostLock(manifest({ sourceCommit: 'abc' })), /sourceCommit.*40 位/)
})

test('formatHostLock：2 空格缩进 + 尾换行（稳定格式）', () => {
  const text = formatHostLock(buildHostLock(manifest()))
  assert.equal(text.endsWith('}\n'), true)
  assert.match(text, /^\{\n  "hostRuntime": \{\n    "version": "0\.0\.1",/)
})

test('syncHostLock：写入 lock；重复执行 status=unchanged', (t) => {
  const { platformRoot, appsRoot, lockPath } = fixture(t)
  const first = syncHostLock({ platformRoot, appsRoot })
  assert.equal(first.status, 'written')
  assert.equal(existsSync(lockPath), true)

  const text = readFileSync(lockPath, 'utf-8')
  assert.match(text, /"mountContract": "1"/)
  assert.equal(text.endsWith('\n'), true)

  const second = syncHostLock({ platformRoot, appsRoot })
  assert.equal(second.status, 'unchanged')
})

test('syncHostLock({ check })：漂移返回 drift 且不写文件', (t) => {
  const { platformRoot, appsRoot, lockPath } = fixture(t, {
    version: '0.0.2',
  })
  writeFileSync(lockPath, JSON.stringify({ hostRuntime: { version: '0.0.1' } }, null, 2) + '\n')
  const before = readFileSync(lockPath, 'utf-8')

  const result = syncHostLock({ platformRoot, appsRoot, check: true })
  assert.equal(result.status, 'drift')
  assert.equal(readFileSync(lockPath, 'utf-8'), before)
})

test('syncHostLock：平台 manifest 不存在 ⇒ 点名路径与 WASMNEST_PLATFORM_ROOT', (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  mkdirSync(appsRoot, { recursive: true })
  assert.throws(
    () => syncHostLock({ platformRoot: join(root, 'missing'), appsRoot }),
    /找不到平台仓 manifest[\s\S]*WASMNEST_PLATFORM_ROOT/,
  )
})

test('CLI --check：漂移时非零退出并提示重跑同步', (t) => {
  const { platformRoot, appsRoot, lockPath } = fixture(t)
  writeFileSync(lockPath, '{ "hostRuntime": { "version": "0.0.0" } }\n')

  assert.throws(
    () =>
      execFileSync(process.execPath, [SYNC_SCRIPT, '--check', '--apps-root', appsRoot], {
        env: { ...process.env, WASMNEST_PLATFORM_ROOT: platformRoot },
        cwd: appsRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      }),
    (error) => {
      assert.equal(error.status, 1)
      assert.match(error.stderr, /\[sync-host-lock\].*不一致/s)
      return true
    },
  )
})
