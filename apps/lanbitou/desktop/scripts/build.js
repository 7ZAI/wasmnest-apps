/**
 * Lanbitou 插件统一构建脚本（frontend + rust）
 *
 * 串联：vite build（前端挂载包）→ cargo build（WASM wasip3）→ 复制产物到本仓
 * 默认产物目录 `.build/plugins/com.wasmnest.lanbitou/`（index.js + plugin.json +
 * icon.svg + wasmnest_plugin_lanbitou.wasm + wasmHash）。
 *
 * 构建目标 / toolchain 取自仓库单一真源 `scripts/plugin-wasm-config.mjs`，
 * 本脚本不自带 target / toolchain 字面量（AGENTS.md §4）。
 *
 * 用法：node scripts/build.js [--watch] [--frontend-only] [--rust-only] [--out <pluginsDir>]
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
import { startPluginWatch } from '@binblink/wasmnest-plugin-sdk-desktop/bin/plugin-watch.js'
import { injectWasmHash } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.lanbitou'
const RUST_LIB_NAME = 'wasmnest_plugin_lanbitou'

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留 DWARF）
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const WASM_PROFILE = DEBUG_MODE ? 'debug' : 'release'
const WASM_PROFILE_DIR = `${WASM_TARGET_DIR}/${WASM_TARGET}/${WASM_PROFILE}`

// ==================== 产物目标目录（G2：默认写本仓，不依赖平台仓） ====================
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
    console.error(`[build] 命令失败: ${cmd} (cwd=${options.cwd || ROOT})`)
    throw e
  }
}

/**
 * 仅前端构建前保全上一份 wasm：`vite build` 会清空 dist，而 `--frontend-only`
 * 的语义是「wasm 保持现状」；不先挪出来，产物目录就只剩前端包。
 */
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
  run('pnpm exec vite build')
}

function buildRust() {
  console.log('\n[build] ====== Building Rust backend (WASM wasip3) ======')
  run(
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path rust/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
    { env: wasip3CargoEnv() },
  )
}

function copyArtifacts(opts = {}) {
  console.log('\n[build] ====== Copying artifacts ======')

  // 先解析 wasm 产物，再清空目标目录（失败时不丢上一份好产物）
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
    console.error('[build]   首次构建请跑全量：node scripts/build.js')
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
  } else if (opts.wasmRebuilt !== true) {
    console.error(`[build] ERROR: frontend bundle not found at ${frontendBundle}`)
    process.exit(1)
  }

  const iconSrc = resolve(ROOT, 'icon.svg')
  if (existsSync(iconSrc)) {
    cpSync(iconSrc, resolve(RESOURCES_DIR, 'icon.svg'))
  }

  cpSync(wasmKeep, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  console.log(`[build] Copied WASM: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
}

// ==================== Main ====================

const watchMode = argv.includes('--watch')
const rustOnly = argv.includes('--rust-only')
const frontendOnly = argv.includes('--frontend-only')

if (watchMode) {
  // 前端 watch：改源码自动重建 + 复制产物（配合宿主 PluginDevWatcher 热重载）。
  // Rust 改动需一次性全量构建（与 ai-chatbox 同语义）。
  startPluginWatch({
    root: ROOT,
    resourcesDir: RESOURCES_DIR,
    extraFiles: ['icon.svg'],
    wasmFile: `${WASM_PROFILE_DIR}/${RUST_LIB_NAME}.wasm`,
  })
} else {
  const keptWasm = frontendOnly ? preservePreviousWasm() : null
  if (!rustOnly) buildFrontend()
  if (!frontendOnly) buildRust()
  copyArtifacts({ wasmRebuilt: !frontendOnly, keptWasm })
  console.log('\n[build] ====== Build complete! ======')
}
