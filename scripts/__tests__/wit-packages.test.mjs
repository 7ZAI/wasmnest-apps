/**
 * `compat.witPackages` 生产者行为契约（ADR 0061 §6.2 / §8「app 元数据锁」）
 *
 * 契约来源：平台仓 `.scratch/2026-11-07-wit-package-split/spec.md` D6/D7。
 * 包表必须来自组件二进制（`componentize --list-packages`），且缺 `wasmnest:plugin`
 * / 非 semver / 解析失败一律 fail-visible——宿主 vendor 门禁据此逐包判定是否重发。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { listWitPackages } from '../lib/wit-packages.mjs'

const fakeRun = (status, stdout) => () => ({ status, stdout, stderr: '' })

describe('listWitPackages', () => {
  it('正例：解析包表并返回 包→版本 映射', () => {
    const run = fakeRun(
      0,
      '{"wasmnest:plugin":"0.1.0","wasmnest:pty":"0.0.1","wasmnest:http":"0.0.1"}\n',
    )
    assert.deepEqual(listWitPackages('/tmp/x.wasm', { run }), {
      'wasmnest:plugin': '0.1.0',
      'wasmnest:pty': '0.0.1',
      'wasmnest:http': '0.0.1',
    })
  })

  it('反例：缺 wasmnest:plugin（公共轴）→ 抛错', () => {
    const run = fakeRun(0, '{"wasmnest:pty":"0.0.1"}')
    assert.throws(() => listWitPackages('/tmp/x.wasm', { run }), /wasmnest:plugin/)
  })

  it('反例：输出不是 JSON → 抛错', () => {
    const run = fakeRun(0, 'not json')
    assert.throws(() => listWitPackages('/tmp/x.wasm', { run }), /不是 JSON/)
  })

  it('反例：空包表 → 抛错（防锁空转）', () => {
    const run = fakeRun(0, '{}')
    assert.throws(() => listWitPackages('/tmp/x.wasm', { run }), /包表/)
  })

  it('反例：版本非三段 semver → 抛错', () => {
    const run = fakeRun(0, '{"wasmnest:plugin":"0.1"}')
    assert.throws(() => listWitPackages('/tmp/x.wasm', { run }), /semver/)
  })

  it('反例：componentize 非零退出 → 抛错（不静默产出空包表）', () => {
    const run = fakeRun(1, '')
    assert.throws(() => listWitPackages('/tmp/x.wasm', { run }), /退出码 1/)
  })
})
