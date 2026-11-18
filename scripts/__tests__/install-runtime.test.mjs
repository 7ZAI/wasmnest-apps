/**
 * install-runtime 单测（票据 A7 / L2 / CONTRACT §5.2）
 *
 * 不真的执行 cargo：注入假 exec，只验证版本解析、缓存路径、命令构造与失败口径
 * （真跑一次 release 编译属 X3 的端到端项）。
 * 运行：node --test scripts/__tests__/install-runtime.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  installRuntime,
  resolveRuntimePlan,
  runtimeCacheDir,
  runtimeMissingHint,
} from '../install-runtime.mjs'
import { normalizeArch, normalizePlatform } from '../host-runtime.mjs'

const PLATFORM = normalizePlatform()
const ARCH = normalizeArch()
const KEY = `${PLATFORM}-${ARCH}`
const BINARY = PLATFORM === 'windows' ? 'wasmnest-desktop.exe' : 'wasmnest-desktop'

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wasmnest-install-runtime-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeLock(appsRoot, version = '0.0.1') {
  writeFileSync(
    join(appsRoot, 'host-runtime.lock.json'),
    JSON.stringify(
      {
        hostRuntime: {
          version,
          sourceCommit: 'a'.repeat(40),
          libTag: 'lib-v0.0.1',
          witVersion: '0.0.1',
          sdkVersion: '0.0.1',
          mountContract: '1',
          artifacts: {},
        },
      },
      null,
      2,
    ) + '\n',
  )
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

function fakeExec({ onCall, writeBin = false } = {}) {
  return (command, args) => {
    if (onCall) onCall(command, args)
    if (writeBin) {
      const root = args[args.indexOf('--root') + 1]
      const binDir = join(root, 'bin')
      mkdirSync(binDir, { recursive: true })
      const bin = join(binDir, BINARY)
      writeFileSync(bin, '#!/bin/sh\n')
      chmodSync(bin, 0o755)
    }
    return { status: 0 }
  }
}

// ==================== 版本 / 路径 ====================

test('runtimeCacheDir：与宿主产物缓存同根，按版本 + 平台架构分层', (t) => {
  const cacheRoot = tempRoot(t)
  assert.equal(
    runtimeCacheDir({ cacheRoot, version: '0.0.1', platform: PLATFORM, arch: ARCH }),
    join(cacheRoot, 'runtime', '0.0.1', KEY),
  )
})

test('resolveRuntimePlan：版本优先 env，其次 host-runtime.lock.json', (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  const cacheRoot = join(root, 'cache')
  mkdirSync(appsRoot, { recursive: true })
  writeLock(appsRoot)
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })

  const fromLock = resolveRuntimePlan({ appsRoot, cacheRoot })
  assert.equal(fromLock.version, '0.0.1')
  assert.equal(fromLock.root, join(cacheRoot, 'runtime', '0.0.1', KEY))
  assert.equal(fromLock.bin, join(fromLock.root, 'bin', BINARY))

  withEnv(t, { WASMNEST_HOST_VERSION: '9.9.9' })
  assert.equal(resolveRuntimePlan({ appsRoot, cacheRoot }).version, '9.9.9')
})

test('resolveRuntimePlan：env 与 lock 都没有 ⇒ 点名两条出路（不猜默认版本）', (t) => {
  const root = tempRoot(t)
  const appsRoot = join(root, 'apps')
  mkdirSync(appsRoot, { recursive: true })
  withEnv(t, { WASMNEST_HOST_VERSION: undefined })
  assert.throws(
    () => resolveRuntimePlan({ appsRoot, cacheRoot: join(root, 'cache') }),
    /\[install-runtime\][\s\S]*WASMNEST_HOST_VERSION[\s\S]*host-runtime\.lock\.json[\s\S]*--version/s,
  )
})

// ==================== 两条通道 ====================

test('resolveRuntimePlan：默认 crates-io 通道，版本精确钉死', (t) => {
  const plan = resolveRuntimePlan({ version: '0.0.1', cacheRoot: join(tempRoot(t), 'cache') })
  assert.equal(plan.source, 'crates-io')
  assert.equal(plan.command.command, 'cargo')
  assert.deepEqual(plan.command.args, [
    'install',
    'wasmnest-desktop-runtime',
    '--version',
    '=0.0.1',
    '--root',
    plan.root,
    '--locked',
  ])
})

test('resolveRuntimePlan：--from 走平台仓 src-tauri 的 debug + custom-protocol 构建 + 复制', (t) => {
  const root = tempRoot(t)
  const platformRoot = join(root, 'wasmnest')
  const manifestDir = join(platformRoot, 'wasmnest-desktop', 'src-tauri')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(join(manifestDir, 'Cargo.toml'), '[package]\nname="wasmnest-desktop-runtime"\n')

  const plan = resolveRuntimePlan({ version: '0.0.1', cacheRoot: join(root, 'cache'), from: platformRoot })
  assert.equal(plan.source, 'platform')
  assert.equal(plan.mode, 'build-copy')
  assert.equal(plan.cwd, platformRoot, 'cwd 必须是平台仓根（cargo 的 [patch] 按 cwd 发现）')
  // debug（wdio 插件在）+ tauri/custom-protocol（内嵌随包壳，不走 devUrl）——
  // 纯 debug 会白屏，release 没有 wdio 插件，两条都跑不了 E2E
  assert.equal(plan.builtBin, join(manifestDir, 'target', 'debug', BINARY))
  assert.deepEqual(plan.command.args, [
    'build',
    '--features',
    'tauri/custom-protocol',
    '--manifest-path',
    join(manifestDir, 'Cargo.toml'),
    '--bin',
    'wasmnest-desktop',
  ])
})

test('resolveRuntimePlan：--from 指向的不是平台仓 ⇒ 显性报错点名 manifest', (t) => {
  const root = tempRoot(t)
  const platformRoot = join(root, 'wasmnest')
  mkdirSync(platformRoot, { recursive: true })
  assert.throws(
    () => resolveRuntimePlan({ version: '0.0.1', cacheRoot: join(root, 'cache'), from: platformRoot }),
    /\[install-runtime\][\s\S]*src-tauri[\s\S]*Cargo\.toml/s,
  )
})

// ==================== 执行 ====================

test('installRuntime({ print })：只解析 bin，不执行命令也不建目录', (t) => {
  const cacheRoot = join(tempRoot(t), 'cache')
  let calls = 0
  const result = installRuntime({
    version: '0.0.1',
    cacheRoot,
    print: true,
    exec: () => {
      calls += 1
      return { status: 0 }
    },
  })
  assert.equal(calls, 0)
  assert.equal(result.version, '0.0.1')
  assert.equal(result.bin, join(cacheRoot, 'runtime', '0.0.1', KEY, 'bin', BINARY))
  assert.equal(existsSync(cacheRoot), false)
})

test('installRuntime：执行 cargo install 后返回 bin', (t) => {
  const cacheRoot = join(tempRoot(t), 'cache')
  const calls = []
  const result = installRuntime({
    version: '0.0.1',
    cacheRoot,
    exec: fakeExec({ writeBin: true, onCall: (c, a) => calls.push([c, a]) }),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'cargo')
  assert.equal(result.installed, true)
  assert.equal(result.bin, join(cacheRoot, 'runtime', '0.0.1', KEY, 'bin', BINARY))
  assert.equal(existsSync(result.bin), true)
})

test('installRuntime：缓存已有 bin ⇒ 复用不重装；force 才重装', (t) => {
  const cacheRoot = join(tempRoot(t), 'cache')
  const binDir = join(cacheRoot, 'runtime', '0.0.1', KEY, 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, BINARY), '#!/bin/sh\n')

  let calls = 0
  const countExec = () => {
    calls += 1
    return { status: 0 }
  }
  const reused = installRuntime({ version: '0.0.1', cacheRoot, exec: countExec })
  assert.equal(calls, 0)
  assert.equal(reused.installed, false)
  assert.equal(reused.reused, true)

  installRuntime({
    version: '0.0.1',
    cacheRoot,
    force: true,
    exec: fakeExec({ writeBin: true }),
  })
  assert.equal(calls, 0, 'force 走的是假 exec（writeBin 版本不计数）——只要求它被调用一次')
})

test('installRuntime：cargo install 失败 ⇒ 报错给两条出路且不落缓存', (t) => {
  const cacheRoot = join(tempRoot(t), 'cache')
  assert.throws(
    () =>
      installRuntime({
        version: '0.0.1',
        cacheRoot,
        exec: () => ({ status: 101, stderr: Buffer.from('error: failed to compile') }),
      }),
    /\[install-runtime\][\s\S]*cargo install 失败[\s\S]*crates\.io[\s\S]*--from/s,
  )
  assert.equal(existsSync(join(cacheRoot, 'runtime', '0.0.1', KEY, 'bin', BINARY)), false)
})

test('installRuntime：cargo 成功但产物缺失 ⇒ 点名 bin', (t) => {
  assert.throws(
    () =>
      installRuntime({
        version: '0.0.1',
        cacheRoot: join(tempRoot(t), 'cache'),
        exec: () => ({ status: 0 }),
      }),
    /\[install-runtime\][\s\S]*找不到[\s\S]*wasmnest-desktop/s,
  )
})

test('installRuntime --from：构建产物复制进缓存并保留可执行位', (t) => {
  const root = tempRoot(t)
  const platformRoot = join(root, 'wasmnest')
  const manifestDir = join(platformRoot, 'wasmnest-desktop', 'src-tauri')
  const cacheRoot = join(root, 'cache')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(join(manifestDir, 'Cargo.toml'), '[package]\nname="wasmnest-desktop-runtime"\n')

  const plan = resolveRuntimePlan({ version: '0.0.1', cacheRoot, from: platformRoot })
  const result = installRuntime({
    version: '0.0.1',
    cacheRoot,
    from: platformRoot,
    exec: () => {
      mkdirSync(dirname(plan.builtBin), { recursive: true })
      writeFileSync(plan.builtBin, '#!/bin/sh\necho host\n')
      chmodSync(plan.builtBin, 0o755)
      return { status: 0 }
    },
  })
  assert.equal(result.installed, true)
  assert.equal(result.source, 'platform')
  assert.equal(result.bin, plan.bin)
  assert.equal(statSync(result.bin).mode & 0o111, 0o111)
})

test('installRuntime --from：build 成功但 target/release 没有产物 ⇒ 点名 builtBin', (t) => {
  const root = tempRoot(t)
  const platformRoot = join(root, 'wasmnest')
  const manifestDir = join(platformRoot, 'wasmnest-desktop', 'src-tauri')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(join(manifestDir, 'Cargo.toml'), '[package]\nname="wasmnest-desktop-runtime"\n')
  assert.throws(
    () =>
      installRuntime({
        version: '0.0.1',
        cacheRoot: join(root, 'cache'),
        from: platformRoot,
        exec: () => ({ status: 0 }),
      }),
    /\[install-runtime\][\s\S]*cargo build 成功但找不到产物[\s\S]*target\/debug[\s\S]*wasmnest-desktop/s,
  )
})

test('runtimeMissingHint：三条出路都可执行（registry / --from / fetch-host）', () => {
  const hint = runtimeMissingHint({ version: '0.0.1', channel: 'crates-io' })
  assert.match(hint, /^ {7}node scripts\/install-runtime\.mjs$/m, 'registry 通道必须单独成行')
  assert.match(hint, /--from <平台仓根>/)
  assert.match(hint, /node scripts\/fetch-host\.mjs/)
})
