/**
 * WasmNest 插件统一构建脚本（frontend + rust）
 *
 * 串联：vite build（前端挂载包）→ cargo build（WASM wasip3）→ 复制产物到
 * 本仓默认产物目录（.build/plugins/desktop <id>/index.js + wasm + 随包资源）。
 *
 * 用法：node scripts/build.js [--rust-only] [--frontend-only] [--out <dir>]
 */

import { execSync } from 'child_process'
import { cpSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, dirname, basename, join, sep } from 'path'
import { fileURLToPath } from 'url'
import {
  WASM_TARGET,
  WASM_TARGET_DIR,
  wasip3CargoEnv,
} from '../../../../scripts/plugin-wasm-config.mjs'
import { injectWasmHash } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.notenote'
const RUST_LIB_NAME = 'wasmnest_plugin_notenote'

const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const WASM_PROFILE = DEBUG_MODE ? 'debug' : 'release'
const WASM_PROFILE_DIR = `${WASM_TARGET_DIR}/${WASM_TARGET}/${WASM_PROFILE}`

const argv = process.argv.slice(2)
function flagValue(flag) {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const OUT_DIR_ARG = flagValue('--out')
const PLUGINS_DIR = resolve(ROOT, OUT_DIR_ARG || DEFAULT_PLUGINS_DIR)
const RESOURCES_DIR = resolve(PLUGINS_DIR, PLUGIN_ID)

function run(cmd, options = {}) {
  console.log(`[build] > ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...options })
  } catch (e) {
    console.error(`[build] 命令失败: ${cmd} (cwd=${ROOT})`)
    throw e
  }
}

function preservePreviousWasm() {
  const prev = resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`)
  if (!existsSync(prev)) return null
  const tmp = mkdtempSync(join(tmpdir(), 'wasmnest-wasm-keep-'))
  const kept = join(tmp, `${RUST_LIB_NAME}.wasm`)
  copyFileSync(prev, kept)
  return kept
}

function buildFrontend() {
  console.log('\n[build] ====== Building frontend bundle (mount contract) ======')
  run('npx vite build', {})
}

function buildRust() {
  console.log('\n[build] ====== Building Rust backend (WASM) ======')
  run(
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path rust/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
    { env: wasip3CargoEnv() },
  )
}

function copyArtifacts(opts = {}) {
  console.log('\n[build] ====== Copying artifacts ======')

  const candidates = [
    resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`),
    resolve(
      ROOT,
      `${WASM_TARGET_DIR}/${WASM_TARGET}/${DEBUG_MODE ? 'release' : 'debug'}`,
      `${RUST_LIB_NAME}.wasm`,
    ),
  ]
  if (opts.wasmRebuilt === false) {
    if (opts.keptWasm && existsSync(opts.keptWasm)) candidates.unshift(opts.keptWasm)
    candidates.unshift(resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  }
  const wasmSource = candidates.find((p) => existsSync(p))
  if (!wasmSource) {
    console.error(`[build] ERROR: WASM not found at ${candidates.join(' or ')}`)
    process.exit(1)
  }

  let wasmKeep = wasmSource
  if (wasmSource.startsWith(RESOURCES_DIR + sep)) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wasmnest-wasm-keep-'))
    wasmKeep = join(tmpDir, basename(wasmSource))
    copyFileSync(wasmSource, wasmKeep)
  }

  if (existsSync(RESOURCES_DIR)) {
    rmSync(RESOURCES_DIR, { recursive: true })
  }
  mkdirSync(RESOURCES_DIR, { recursive: true })

  cpSync(resolve(ROOT, 'plugin.json'), resolve(RESOURCES_DIR, 'plugin.json'))

  const frontendBundle = resolve(ROOT, 'dist/index.js')
  if (existsSync(frontendBundle)) {
    cpSync(frontendBundle, resolve(RESOURCES_DIR, 'index.js'))
    console.log('[build] Copied frontend bundle: dist/index.js → index.js')
  } else if (!rustOnly) {
    console.error('[build] ERROR: frontend bundle not found at ' + frontendBundle)
    process.exit(1)
  }

  cpSync(resolve(ROOT, 'icon.svg'), resolve(RESOURCES_DIR, 'icon.svg'))

  cpSync(wasmKeep, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  console.log(`[build] Copied WASM: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
}

const rustOnly = argv.includes('--rust-only')
const frontendOnly = argv.includes('--frontend-only')
for (const legacy of ['--watch']) {
  if (argv.includes(legacy)) {
    console.error(
      '[build] 参数 ' + legacy + ' 已退役：前端 watch 走宿主 plugins:dev 编排（plugin-watch）。',
    )
    process.exit(1)
  }
}

const keptWasm = frontendOnly ? preservePreviousWasm() : null
if (!rustOnly) buildFrontend()
if (!frontendOnly) buildRust()
copyArtifacts({ wasmRebuilt: !frontendOnly, keptWasm })

console.log('\n[build] ====== Build complete! ======')
