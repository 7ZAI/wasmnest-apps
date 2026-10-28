// A2 票据：平台 SDK 本地 link / unlink 的 seam 单测（node:test）。
//
// 被测面 = `scripts/platform-sdk-link.mjs` 的纯函数（plan / apply / revert / status）。
// 不真跑 pnpm install / cargo：用临时目录 + 最小 fixture 覆盖「写入、还原、幂等、
// fail-visible、路径含空格」；真实 install 由票据验证步骤单独执行。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import {
  LINK_BLOCK_BEGIN,
  SDK_PACKAGE_NAME,
  applyLinkPlan,
  createLinkPlan,
  inspectLinkStatus,
  resolvePlatformRoot,
  revertLink,
  runPnpmInstalls,
  toFileSpec,
} from '../platform-sdk-link.mjs'

const APP_SLUGS = ['ai-chatbox', 'bedcode', 'file-transfer', 'monitor']

const ORIGINAL_CARGO_CONFIG =
  '# ==================== wasm 应用共享 target 目录 ====================\n' +
  '[build]\n' +
  'target-dir = "target/wasm-apps"\n' +
  '\n' +
  'jobs = 4\n'

function writeFileDeep(file, content) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function writeJson(file, value) {
  writeFileDeep(file, JSON.stringify(value, null, 2))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function desktopPackageFile(appsRoot, slug) {
  return join(appsRoot, 'apps', slug, 'desktop', 'package.json')
}

function packageFiles(appsRoot) {
  return [join(appsRoot, 'package.json'), ...APP_SLUGS.map((slug) => desktopPackageFile(appsRoot, slug))]
}

/**
 * 最小 R1 布局 fixture：
 *   <root>/apps/package.json + apps/<slug>/desktop/package.json + .cargo/config.toml
 *   <root>/<platformDirName>/wasmnest-desktop/packages/plugin-sdk-desktop/**
 *   <root>/lib/wasmnest-server-*（bedcode dev-deps 的 git tag patch 目标）
 */
function makeFixture({ platformDirName = 'platform', withLib = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wasmnest-link-'))
  const appsRoot = join(root, 'apps')
  const platformRoot = join(root, platformDirName)
  const libRoot = withLib ? join(root, 'lib') : null

  writeJson(join(appsRoot, 'package.json'), {
    name: 'wasmnest-apps',
    version: '0.0.1',
    private: true,
    devDependencies: { [SDK_PACKAGE_NAME]: '0.0.1', eslint: '^9.0.0' },
  })
  for (const slug of APP_SLUGS) {
    writeJson(desktopPackageFile(appsRoot, slug), {
      name: `@wasmnest/wasm-app-${slug}`,
      version: '0.0.1',
      dependencies: { [SDK_PACKAGE_NAME]: '0.0.1' },
    })
  }
  writeFileDeep(join(appsRoot, '.cargo', 'config.toml'), ORIGINAL_CARGO_CONFIG)

  const sdkDir = join(platformRoot, 'wasmnest-desktop', 'packages', 'plugin-sdk-desktop')
  writeJson(join(sdkDir, 'package.json'), { name: SDK_PACKAGE_NAME, version: '0.0.1' })
  writeFileDeep(
    join(sdkDir, 'rust', 'Cargo.toml'),
    '[package]\nname = "wasmnest-plugin-api"\nversion = "0.0.1"\n',
  )
  writeFileDeep(
    join(sdkDir, 'rust-macros', 'Cargo.toml'),
    '[package]\nname = "wasmnest-plugin-api-macros"\nversion = "0.0.1"\n',
  )

  if (libRoot) {
    for (const crate of [
      'wasmnest-server-base',
      'wasmnest-server-core',
      'wasmnest-server-http',
      'wasmnest-server-websocket',
    ]) {
      writeFileDeep(join(libRoot, crate, 'Cargo.toml'), `[package]\nname = "${crate}"\nversion = "0.0.1"\n`)
    }
  }

  return { root, appsRoot, platformRoot, libRoot, sdkDir }
}

function link(fixture) {
  const plan = createLinkPlan({
    appsRoot: fixture.appsRoot,
    platformRoot: fixture.platformRoot,
    libRoot: fixture.libRoot,
  })
  return applyLinkPlan(plan, { now: () => '2026-10-21T00:00:00.000Z' })
}

function specOf(file) {
  const pkg = readJson(file)
  return pkg.dependencies?.[SDK_PACKAGE_NAME] ?? pkg.devDependencies?.[SDK_PACKAGE_NAME]
}

describe('link-platform-sdk / createLinkPlan + applyLinkPlan', () => {
  it('写入 file: 依赖、cargo patch 与 marker（marker 记录原始 spec）', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    const marker = link(fx)

    // 根 package.json：file: 指向平台 SDK（相对路径、正斜杠、无尾斜杠）
    assert.equal(
      specOf(join(fx.appsRoot, 'package.json')),
      'file:../platform/wasmnest-desktop/packages/plugin-sdk-desktop',
    )
    // app 深 3 层的相对路径
    assert.equal(
      specOf(desktopPackageFile(fx.appsRoot, 'bedcode')),
      'file:../../../../platform/wasmnest-desktop/packages/plugin-sdk-desktop',
    )

    // marker：6 个文件 + 原始 spec
    const markerFile = join(fx.appsRoot, '.platform-sdk-link.json')
    assert.ok(existsSync(markerFile))
    const onDisk = readJson(markerFile)
    assert.deepEqual(onDisk, marker)
    assert.equal(onDisk.platformRoot, fx.platformRoot)
    assert.equal(onDisk.linkedAt, '2026-10-21T00:00:00.000Z')
    assert.equal(Object.keys(onDisk.files).length, 6)
    for (const file of packageFiles(fx.appsRoot)) {
      assert.equal(onDisk.files[file], '0.0.1')
    }

    // .cargo/config.toml：原文保留 + 追加 patch 块
    const config = readFileSync(join(fx.appsRoot, '.cargo', 'config.toml'), 'utf8')
    assert.ok(config.startsWith(ORIGINAL_CARGO_CONFIG))
    assert.ok(config.includes('[patch.crates-io]'))
    assert.ok(
      config.includes(`wasmnest-plugin-api = { path = "${join(fx.sdkDir, 'rust')}" }`),
    )
    assert.ok(
      config.includes(`wasmnest-plugin-api-macros = { path = "${join(fx.sdkDir, 'rust-macros')}" }`),
    )
    assert.ok(config.includes('[patch."https://github.com/7ZAI/wasmnest-lib"]'))
    for (const crate of [
      'wasmnest-server-base',
      'wasmnest-server-core',
      'wasmnest-server-http',
      'wasmnest-server-websocket',
    ]) {
      assert.ok(config.includes(`${crate} = { path = "${join(fx.libRoot, crate)}" }`))
    }
    assert.equal(config.split(LINK_BLOCK_BEGIN).length - 1, 1)
  })

  it('幂等：连续 link 两次不重复写块，marker 仍记录原始值', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    link(fx)
    const firstMarker = readJson(join(fx.appsRoot, '.platform-sdk-link.json'))
    link(fx)
    const secondMarker = readJson(join(fx.appsRoot, '.platform-sdk-link.json'))

    assert.deepEqual(secondMarker.files, firstMarker.files)
    assert.equal(secondMarker.linkedAt, firstMarker.linkedAt, '第二次 link 不应重写 linkedAt')

    const config = readFileSync(join(fx.appsRoot, '.cargo', 'config.toml'), 'utf8')
    assert.equal(config.split(LINK_BLOCK_BEGIN).length - 1, 1)
    assert.equal(config.split('[patch.crates-io]').length - 1, 1)
  })

  it('平台根缺失：createLinkPlan fail-visible，且不写半套文件', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    const missing = join(fx.root, 'missing-platform')
    assert.throws(
      () => createLinkPlan({ appsRoot: fx.appsRoot, platformRoot: missing, libRoot: null }),
      /plugin-sdk-desktop/,
    )
    assert.equal(specOf(join(fx.appsRoot, 'package.json')), '0.0.1')
    assert.equal(readFileSync(join(fx.appsRoot, '.cargo', 'config.toml'), 'utf8'), ORIGINAL_CARGO_CONFIG)
    assert.equal(existsSync(join(fx.appsRoot, '.platform-sdk-link.json')), false)
  })

  it('平台根解析：环境变量指向不存在目录时 fail-visible 并点名变量', () => {
    const missing = join(tmpdir(), 'wasmnest-platform-does-not-exist')
    assert.throws(
      () => resolvePlatformRoot({ envRoot: missing, mainWorktreeRoot: tmpdir() }),
      /WASMNEST_PLATFORM_ROOT/,
    )
  })
})

describe('link-platform-sdk / revertLink', () => {
  it('unlink 精确还原 package.json 与 .cargo/config.toml，并删除 marker', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    link(fx)
    const result = revertLink({ appsRoot: fx.appsRoot })

    assert.equal(result.markerExisted, true)
    assert.equal(result.restored.length, 6)
    for (const file of packageFiles(fx.appsRoot)) {
      assert.equal(specOf(file), '0.0.1')
    }
    assert.equal(readFileSync(join(fx.appsRoot, '.cargo', 'config.toml'), 'utf8'), ORIGINAL_CARGO_CONFIG)
    assert.equal(existsSync(join(fx.appsRoot, '.platform-sdk-link.json')), false)
  })

  it('marker 缺失时仍按精确版本恢复（unlink 两次幂等）', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    link(fx)
    rmSync(join(fx.appsRoot, '.platform-sdk-link.json'))
    const first = revertLink({ appsRoot: fx.appsRoot })
    assert.equal(first.markerExisted, false)
    for (const file of packageFiles(fx.appsRoot)) {
      assert.equal(specOf(file), '0.0.1')
    }

    // 第二次：不再有 file: 依赖 / patch 块，保持原样且不抛错
    const second = revertLink({ appsRoot: fx.appsRoot })
    assert.deepEqual(second.restored, [])
    assert.equal(readFileSync(join(fx.appsRoot, '.cargo', 'config.toml'), 'utf8'), ORIGINAL_CARGO_CONFIG)
  })
})

describe('link-platform-sdk / 路径与命令', () => {
  it('路径含空格：file: spec 不转义，pnpm install 走 argv 数组而非 shell 字符串', (t) => {
    const fx = makeFixture({ platformDirName: 'platform with space' })
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    link(fx)
    assert.equal(
      specOf(join(fx.appsRoot, 'package.json')),
      'file:../platform with space/wasmnest-desktop/packages/plugin-sdk-desktop',
    )
    assert.equal(
      toFileSpec(join(fx.root, 'a b', 'desktop'), join(fx.root, 'c d', 'sdk')),
      'file:../../c d/sdk',
    )

    const calls = []
    const dirs = [fx.appsRoot, join(fx.appsRoot, 'apps', 'bedcode', 'desktop')]
    const installed = runPnpmInstalls({
      dirs,
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, opts })
        return { status: 0 }
      },
    })
    assert.equal(installed.length, 2)
    assert.deepEqual(calls[0].args, ['install', '--no-frozen-lockfile'])
    assert.equal(calls[0].opts.cwd, dirs[0])
    assert.equal(calls[1].opts.cwd, dirs[1])

    assert.throws(
      () =>
        runPnpmInstalls({
          dirs: [join(fx.root, 'a b', 'desktop')],
          spawn: () => ({ status: 1 }),
        }),
      /a b\/desktop/,
    )
  })
})

describe('link-platform-sdk / inspectLinkStatus', () => {
  it('published → linked → inconsistent → published', (t) => {
    const fx = makeFixture()
    t.after(() => rmSync(fx.root, { recursive: true, force: true }))

    assert.equal(inspectLinkStatus({ appsRoot: fx.appsRoot }).state, 'published')

    link(fx)
    const linked = inspectLinkStatus({ appsRoot: fx.appsRoot })
    assert.equal(linked.state, 'linked')
    assert.equal(linked.marker.platformRoot, fx.platformRoot)

    // 模拟手工改回精确版本但 marker / patch 仍在：状态必须显性报不一致
    const one = desktopPackageFile(fx.appsRoot, 'monitor')
    const pkg = readJson(one)
    pkg.dependencies[SDK_PACKAGE_NAME] = '0.0.1'
    writeJson(one, pkg)
    assert.equal(inspectLinkStatus({ appsRoot: fx.appsRoot }).state, 'inconsistent')

    revertLink({ appsRoot: fx.appsRoot })
    assert.equal(inspectLinkStatus({ appsRoot: fx.appsRoot }).state, 'published')
  })
})
