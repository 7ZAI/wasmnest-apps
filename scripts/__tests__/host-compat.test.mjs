/**
 * 宿主兼容声明 resolver 单测（应用版本更新全链路）
 *
 * 纯函数 + 临时目录：不构建任何 app、不读真实锁（真实锁的漂移由
 * sync-host-lock / CI 校验，这里只钉本模块的 fail-visible 口径）。
 * 运行：node --test scripts/__tests__/host-compat.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compatFromLock, readHostCompat } from '../lib/host-compat.mjs'

const FULL_LOCK = {
  hostRuntime: {
    version: '0.0.1',
    sourceCommit: 'ca295a80',
    libTag: 'lib-v0.0.1',
    witVersion: '0.0.1',
    sdkVersion: '0.0.1',
    mountContract: '1',
    artifacts: {},
  },
}

test('compatFromLock：完整锁 → 四个标量字段，多余字段不带出', () => {
  assert.deepEqual(compatFromLock(FULL_LOCK), {
    hostRuntime: '0.0.1',
    mountContract: '1',
    sdkVersion: '0.0.1',
    witVersion: '0.0.1',
  })
})

test('compatFromLock：任一字段缺失 / 空 / 非字符串 ⇒ 点名字段拒绝', () => {
  const cases = [
    ['缺 mountContract', { ...FULL_LOCK.hostRuntime, mountContract: undefined }, /mountContract/],
    ['空 witVersion', { ...FULL_LOCK.hostRuntime, witVersion: '' }, /witVersion/],
    ['非字符串 sdkVersion', { ...FULL_LOCK.hostRuntime, sdkVersion: 1 }, /sdkVersion/],
  ]
  for (const [name, hostRuntime, re] of cases) {
    assert.throws(() => compatFromLock({ hostRuntime }), re, name)
  }
})

test('compatFromLock：锁结构残缺 ⇒ 显性拒绝', () => {
  assert.throws(() => compatFromLock(null), /不是对象/)
  assert.throws(() => compatFromLock({}), /hostRuntime 段/)
  assert.throws(() => compatFromLock({ hostRuntime: '1' }), /hostRuntime 段/)
})

test('readHostCompat：合法锁文件 → 兼容声明', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-host-compat-'))
  try {
    const path = join(dir, 'host-runtime.lock.json')
    writeFileSync(path, JSON.stringify(FULL_LOCK))
    assert.deepEqual(readHostCompat(path), compatFromLock(FULL_LOCK))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readHostCompat：文件缺失 / JSON 非法 ⇒ 点名路径拒绝（不发无兼容声明的包）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-host-compat-'))
  try {
    const missing = join(dir, 'absent.json')
    assert.throws(() => readHostCompat(missing), /无法读取宿主运行时锁.*absent\.json/s)

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{not json')
    assert.throws(() => readHostCompat(bad), /不是合法 JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
