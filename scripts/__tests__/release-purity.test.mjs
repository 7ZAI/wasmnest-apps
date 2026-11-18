/**
 * 发布产物纯净锁单测（票据 A7 / D8 / S7）
 *
 * 纯函数 + 临时目录：不构建任何 app、不碰真实 dist。
 * 运行：node --test scripts/__tests__/release-purity.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkReleasePurity,
  findReleasePurityViolations,
} from '../ci/check-release-purity.mjs'

const PURITY_SCRIPT = fileURLToPath(new URL('../ci/check-release-purity.mjs', import.meta.url))

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-release-purity-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const GOOD_FILES = ['plugin.json', 'index.js', 'icon.svg', 'monitor.wasm', 'assets/logo.png']

test('findReleasePurityViolations：正常 app 产物零命中（不误伤 app 自己的 wasm 名）', () => {
  assert.deepEqual(findReleasePurityViolations(GOOD_FILES), [])
  assert.deepEqual(findReleasePurityViolations(['wasmnest_plugin_ai_chatbox.wasm']), [])
})

test('findReleasePurityViolations：宿主二进制 / runtime crate 痕迹 ⇒ 命中并点名', () => {
  const cases = [
    ['wasmnest-desktop', /宿主二进制/],
    ['wasmnest-desktop.exe', /宿主二进制/],
    ['bin/wasmnest-desktop', /宿主二进制/],
    ['host-version.json', /宿主版本/],
    ['host-runtime.lock.json', /宿主 lock/],
    ['shell-dist/index.html', /壳前端/],
    ['wasmnest-desktop-runtime/Cargo.toml', /runtime crate/],
    ['libwasmnest_desktop_lib.rlib', /runtime crate/],
    ['host-desktop-0.0.1-linux-x86_64.tar.gz', /宿主发布资产/],
    ['host-desktop-0.0.1-linux-x86_64.tar.gz.sha256', /宿主发布资产/],
  ]
  for (const [path, reason] of cases) {
    const violations = findReleasePurityViolations([path])
    assert.equal(violations.length, 1, `${path} 必须命中`)
    assert.equal(violations[0].path, path)
    assert.match(violations[0].reason, reason)
  }
})

test('findReleasePurityViolations：多条命中全部列出（不只报第一条）', () => {
  const violations = findReleasePurityViolations([
    'plugin.json',
    'host-version.json',
    'shell-dist/app.js',
    'index.js',
  ])
  assert.deepEqual(
    violations.map((v) => v.path),
    ['host-version.json', 'shell-dist/app.js'],
  )
})

test('checkReleasePurity：干净目录通过并返回空', (t) => {
  const dir = tempRoot(t)
  for (const file of GOOD_FILES) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), 'x')
  }
  assert.deepEqual(checkReleasePurity(dir), [])
})

test('checkReleasePurity：脏目录抛错并列出全部命中路径', (t) => {
  const dir = tempRoot(t)
  writeFileSync(join(dir, 'plugin.json'), '{}')
  writeFileSync(join(dir, 'host-version.json'), '{}')
  assert.throws(
    () => checkReleasePurity(dir),
    (error) => {
      assert.match(error.message, /\[release-purity\]/)
      assert.match(error.message, /host-version\.json/)
      assert.match(error.message, /宿主版本/)
      return true
    },
  )
})

test('checkReleasePurity：目录不存在时报错（不空转给绿）', (t) => {
  assert.throws(() => checkReleasePurity(join(tempRoot(t), 'nope')), /产物目录不存在/)
})

test('CLI --dir：脏目录非零退出并打印命中清单', (t) => {
  const dir = tempRoot(t)
  writeFileSync(join(dir, 'plugin.json'), '{}')
  mkdirSync(join(dir, 'shell-dist'), { recursive: true })
  writeFileSync(join(dir, 'shell-dist', 'index.html'), '<html/>')
  assert.throws(
    () =>
      execFileSync(process.execPath, [PURITY_SCRIPT, '--dir', dir], {
        encoding: 'utf-8',
        stdio: 'pipe',
      }),
    (error) => {
      assert.equal(error.status, 1)
      assert.match(error.stderr, /\[release-purity\][\s\S]*shell-dist/)
      return true
    },
  )
})

test('CLI --list：按 zip 文件清单检查（每行一个相对路径）', (t) => {
  const root = tempRoot(t)
  const list = join(root, 'files.txt')
  writeFileSync(list, 'plugin.json\nindex.js\n')
  const out = execFileSync(process.execPath, [PURITY_SCRIPT, '--list', list], { encoding: 'utf-8' })
  assert.match(out, /通过/)
})
