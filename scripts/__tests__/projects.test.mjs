/**
 * 工程枚举 resolver 单测（issue #6 D1「唯一枚举点」）
 *
 * 这些用例是 `servers/` 拓扑的**锁**：一旦有脚本绕过 resolver 自己拼 `apps/`，
 * 新增分组就会静默漏构建（应用曾因漏注册表长期停在旧构建）。因此这里断言
 * 的是「枚举结果」这一外部可见行为，不测内部实现。
 *
 * 覆盖：
 * - 两个分组都被枚举（apps + servers），`_` / `.` 前缀目录被忽略；
 * - `requireManifest` / `requirePackage` / `ends` 过滤语义；
 * - slug 跨分组重名 → 抛错（按 slug 定位会拿错工程）；
 * - `group:slug` 精确指定；
 * - 仓库真实布局：五个既有 app 都在枚举结果里（防 resolver 空转）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  APPS_ROOT,
  PROJECT_ENDS,
  PROJECT_GROUPS,
  listProjects,
  listSlugs,
  locate,
  projectDir,
  slugDir,
} from '../lib/projects.mjs'

/** 造一个临时「仓」：{ [relPath]: content | null }（null = 只建目录） */
function makeRepo(entries) {
  const root = mkdtempSync(join(tmpdir(), 'projects-test-'))
  for (const [rel, content] of Object.entries(entries)) {
    const full = join(root, rel)
    if (content === null) {
      mkdirSync(full, { recursive: true })
      continue
    }
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return root
}

test('分组常量与仓布局一致：apps / servers 与仓根平级', () => {
  assert.deepEqual(PROJECT_GROUPS, ['apps', 'servers'])
  assert.deepEqual(PROJECT_ENDS, ['desktop', 'mobile'])
  assert.equal(projectDir('servers', 'auth-center', 'desktop', '/r'), join('/r', 'servers', 'auth-center', 'desktop'))
  assert.equal(slugDir('apps', 'monitor', '/r'), join('/r', 'apps', 'monitor'))
})

test('listProjects 同时枚举 apps 与 servers，忽略 _ / . 前缀目录', () => {
  const root = makeRepo({
    'apps/monitor/desktop/plugin.json': '{}',
    'apps/monitor/mobile/plugin.json': '{}',
    'apps/_draft/desktop/plugin.json': '{}',
    'apps/.hidden/desktop/plugin.json': '{}',
    'servers/auth-center/desktop/plugin.json': '{}',
    'servers/auth-center/desktop/package.json': '{}',
    'servers/empty': null,
  })
  try {
    const all = listProjects({ root })
    assert.deepEqual(
      all.map((p) => p.rel),
      ['apps/monitor/desktop', 'apps/monitor/mobile', 'servers/auth-center/desktop'],
      '枚举必须跨分组，且排除 _ / . 前缀与空分组目录',
    )
    assert.deepEqual(
      listProjects({ root, requireManifest: true }).map((p) => p.rel),
      all.map((p) => p.rel),
    )
    assert.deepEqual(
      listProjects({ root, requirePackage: true }).map((p) => p.rel),
      ['servers/auth-center/desktop'],
      'requirePackage 只保留含 package.json 的端',
    )
    assert.deepEqual(
      listProjects({ root, ends: ['mobile'] }).map((p) => p.rel),
      ['apps/monitor/mobile'],
    )
    assert.deepEqual(
      listProjects({ root, groups: ['servers'] }).map((p) => p.rel),
      ['servers/auth-center/desktop'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listSlugs 跨分组合并；重名直接抛错（不静默取先到）', () => {
  const ok = makeRepo({
    'apps/monitor/desktop/plugin.json': '{}',
    'servers/auth-center/desktop/plugin.json': '{}',
  })
  try {
    assert.deepEqual(listSlugs({ root: ok }), ['monitor', 'auth-center'])
    assert.deepEqual(locate('monitor', { root: ok }), { group: 'apps', slug: 'monitor' })
    assert.deepEqual(locate('servers:auth-center', { root: ok }), {
      group: 'servers',
      slug: 'auth-center',
    })
    assert.equal(locate('nope', { root: ok }), null)
  } finally {
    rmSync(ok, { recursive: true, force: true })
  }

  const dup = makeRepo({
    'apps/dup/desktop/plugin.json': '{}',
    'servers/dup/desktop/plugin.json': '{}',
  })
  try {
    assert.throws(() => listSlugs({ root: dup }), /跨分组重名: dup/)
    assert.throws(() => locate('dup', { root: dup }), /跨分组重名: dup/)
    // 显式分组仍可精确定位
    assert.deepEqual(locate('apps:dup', { root: dup }), { group: 'apps', slug: 'dup' })
  } finally {
    rmSync(dup, { recursive: true, force: true })
  }
})

test('非法 group / slug / end 显性抛错（不接受猜测）', () => {
  assert.throws(() => projectDir('plugins', 'monitor', 'desktop'), /非法分组/)
  assert.throws(() => projectDir('apps', 'Monitor', 'desktop'), /非法 slug/)
  assert.throws(() => projectDir('apps', 'monitor', 'ios'), /非法端/)
})

test('仓库真实布局：五个既有 app 都能被枚举到（防 resolver 空转）', () => {
  const slugs = listSlugs()
  for (const slug of ['ai-chatbox', 'bedcode', 'file-transfer', 'monitor']) {
    assert.ok(slugs.includes(slug), `既有 app ${slug} 必须被枚举到（可用: ${slugs.join(', ')}）`)
  }
  const desktop = listProjects({ ends: ['desktop'], requireManifest: true }).map((p) => p.slug)
  assert.equal(
    new Set(desktop).size,
    desktop.length,
    '桌面端 slug 不应重复（重名会让 --app 定位歧义）',
  )
  assert.ok(APPS_ROOT.endsWith('wasmnest-apps'), `APPS_ROOT 解析异常: ${APPS_ROOT}`)
})
