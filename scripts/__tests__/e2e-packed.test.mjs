/**
 * E2E 宿主模式计划锁（node:test 纯函数）
 *
 * 契约来源：CONTRACT §8.3（packed / cargo / runtime 模式表）、spec D14。
 * 判据要点（每条都是历史上的假绿来源）：
 *  - packed（默认）**不启**宿主 dev server，产物进**临时目录**，不写平台工作树；
 *  - cargo 才保留「平台 resources + dev server」的平台集成形态；
 *  - `--skip-build` 时产物来源点名（缺就让人去构建，不静默复用残留）；
 *  - 版本比对必须有 lock，缺 lock 即错（不猜默认版本号）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HOST_MODES,
  cargoHostBin,
  hostExpectations,
  needsDevServer,
  planArtifactCopy,
  planBuildArgs,
  planStaging,
  planStagingCleanup,
  resolveHostMode,
} from '../e2e-plan.mjs'

const APP = { pluginId: 'com.wasmnest.ai-chatbox', dir: '/apps/ai-chatbox/desktop' }
const LOCK = { sdkVersion: '0.0.1', witVersion: '0.0.1', mountContract: '1' }

test('resolveHostMode：缺省 = packed（G2 验收形态），显式值与 env 生效，非法值点名允许项', () => {
  assert.equal(resolveHostMode({ env: {} }), 'packed')
  assert.equal(resolveHostMode({ hostMode: 'cargo', env: {} }), 'cargo')
  assert.equal(resolveHostMode({ env: { WASMNEST_E2E_HOST_MODE: 'runtime' } }), 'runtime')
  assert.throws(() => resolveHostMode({ hostMode: 'dev-run', env: {} }), (e) => {
    assert.match(e.message, /--host-mode 取值非法：dev-run/)
    for (const mode of HOST_MODES) assert.match(e.message, new RegExp(mode))
    return true
  })
})

test('needsDevServer：只有 cargo 起宿主前端 dev server', () => {
  assert.equal(needsDevServer('cargo'), true)
  assert.equal(needsDevServer('packed'), false, 'packed 起 dev server = 前端来源不真实')
  assert.equal(needsDevServer('runtime'), false)
})

test('cargoHostBin：指向平台 src-tauri debug；平台根缺失时给出路', () => {
  assert.equal(
    cargoHostBin({ platformRoot: '/tmp/platform' }),
    '/tmp/platform/wasmnest-desktop/src-tauri/target/debug/wasmnest-desktop',
  )
  assert.throws(() => cargoHostBin({ platformRoot: null }), /WASMNEST_PLATFORM_ROOT[\s\S]*packed/)
})

test('planBuildArgs：非 cargo 必须 --out staging；cargo 不传（保持平台 resources）', () => {
  assert.deepEqual(
    planBuildArgs({ mode: 'packed', pluginsDir: '/tmp/stage' }),
    ['--frontend-only', '--out', '/tmp/stage'],
  )
  assert.deepEqual(planBuildArgs({ mode: 'packed', full: true, pluginsDir: '/tmp/stage' }), [
    '--out',
    '/tmp/stage',
  ])
  assert.deepEqual(planBuildArgs({ mode: 'cargo' }), ['--frontend-only'])
  assert.throws(() => planBuildArgs({ mode: 'runtime' }), /pluginsDir 缺失/)
})

test('planStaging：packed 用临时目录且标记 temp；cargo 落平台 target 下（历史行为）', () => {
  const packed = planStaging({ mode: 'packed', stagingDir: '/tmp/wasmnest-e2e-plugins-xyz' })
  assert.deepEqual(packed, { pluginsDir: '/tmp/wasmnest-e2e-plugins-xyz', temp: true })
  assert.ok(!packed.pluginsDir.includes('wasmnest-desktop'), 'packed staging 不得在平台工作树内')
  assert.deepEqual(planStaging({ mode: 'cargo', platformRoot: '/tmp/platform' }), {
    pluginsDir: '/tmp/platform/wasmnest-desktop/src-tauri/target/debug/resources/plugins/e2e',
    temp: false,
  })
  assert.throws(() => planStaging({ mode: 'packed' }), /临时 staging 目录/)
  assert.throws(() => planStaging({ mode: 'cargo' }), /WASMNEST_PLATFORM_ROOT/)
})

test('planArtifactCopy：packed 真构建=就地不复制；--skip-build=从 app 默认产物目录拷；cargo=从平台 resources 拷', () => {
  const built = planArtifactCopy({
    mode: 'packed',
    skipBuild: false,
    apps: [APP],
    pluginsDir: '/tmp/stage',
  })
  assert.deepEqual(built, [
    {
      pluginId: APP.pluginId,
      src: '/tmp/stage/com.wasmnest.ai-chatbox',
      dst: '/tmp/stage/com.wasmnest.ai-chatbox',
      copy: false,
    },
  ])

  const skipped = planArtifactCopy({
    mode: 'packed',
    skipBuild: true,
    apps: [APP],
    pluginsDir: '/tmp/stage',
  })
  assert.deepEqual(skipped[0].src, '/apps/ai-chatbox/desktop/.build/plugins/com.wasmnest.ai-chatbox')
  assert.equal(skipped[0].copy, true)

  const cargo = planArtifactCopy({
    mode: 'cargo',
    skipBuild: false,
    apps: [APP],
    pluginsDir: '/tmp/platform/e2e',
    platformResourcesDir: '/tmp/platform/wasmnest-desktop/src-tauri/resources/plugins/desktop',
  })
  assert.equal(cargo[0].copy, true)
  assert.equal(
    cargo[0].src,
    '/tmp/platform/wasmnest-desktop/src-tauri/resources/plugins/desktop/com.wasmnest.ai-chatbox',
  )
  assert.throws(
    () => planArtifactCopy({ mode: 'cargo', apps: [APP], pluginsDir: '/x' }),
    /cargo 模式需要平台宿主 resources 目录/,
  )
})

test('planStagingCleanup：cargo 复用固定目录必须清空；packed 临时目录不得清空（会删掉刚构建的产物）', () => {
  assert.equal(planStagingCleanup({ mode: 'cargo' }), true)
  assert.equal(planStagingCleanup({ mode: 'packed' }), false)
  assert.equal(planStagingCleanup({ mode: 'runtime' }), false)
})

test('hostExpectations：缺 lock 直接拒（不猜版本号）；app SDK 优先于 lock', () => {
  assert.deepEqual(hostExpectations({ lock: LOCK, sdkVersion: '0.0.2' }), {
    sdkVersion: '0.0.2',
    witVersion: '0.0.1',
    mountContract: '1',
  })
  assert.equal(hostExpectations({ lock: LOCK, sdkVersion: null }).sdkVersion, '0.0.1')
  assert.throws(() => hostExpectations({ lock: null }), /缺 host-runtime\.lock\.json/)
})
