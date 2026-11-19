/**
 * News 插件统一构建脚本（双端单产物）
 *
 * 串联：vite build → cargo 构建（wasm32-unknown-unknown）→ 组件化 → 复制产物到
 * 本仓 `.build/plugins/<appId>/`。
 *
 * **工具链口径**：本插件与 file-transfer 同为双端共享产物源（应用级
 * `rust/plugin` 双端同构 crate），因此不走 wasm32-wasip3 直出，而用
 * wasm32-unknown-unknown + 组件化工具（随桌面 SDK 发布的 `tools/componentize`，
 * 经包名定位，见 `./sdk-componentize.mjs`）。
 */

import { execSync } from 'child_process'
import { cpSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, dirname, basename, join, sep } from 'path'
import { fileURLToPath } from 'url'
import { startPluginWatch } from '@binblink/wasmnest-plugin-sdk-desktop/bin/plugin-watch.js'
import { WASM_TARGET_DIR } from '../../../../scripts/plugin-wasm-config.mjs'
import { componentizeManifestForBuild } from './sdk-componentize.mjs'
import { injectWasmHash } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.news'
const RUST_LIB_NAME = 'wasmnest_plugin_news'

const WASM_TARGET = 'wasm32-unknown-unknown'
const COMPONENTIZE_MANIFEST = componentizeManifestForBuild({
  destDir: resolve(ROOT, '.build', 'componentize'),
})

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

/**
 * 仅前端构建前保全上一份 wasm。
 *
 * `vite build` 清空 outDir（dist），而 `--frontend-only` 的语义是「wasm 保持现状」；
 * 不在构建前把它挪出来，清空后无处复用。
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
  console.log('\n[build] ====== Building frontend (Vite) ======')
  run('pnpm exec vite build')
}

function buildRust() {
  console.log('\n[build] ====== Building Rust backend (WASM, unknown-unknown) ======')
  run(
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path ../rust/plugin/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
  )
  const modulePath = resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`)
  if (!existsSync(modulePath)) {
    console.error(`[build] ERROR: core module not found at ${modulePath}`)
    process.exit(1)
  }
  console.log('\n[build] ====== Componentizing WASM (Component Model) ======')
  run(
    `cargo run --release --manifest-path "${COMPONENTIZE_MANIFEST}" --target-dir ${WASM_TARGET_DIR} -- "${modulePath}" -o "${modulePath}"`,
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
    console.error(`[build] ERROR: WASM file not found at ${candidates.join(' or ')}`)
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

  const distDir = resolve(ROOT, 'dist')
  cpSync(resolve(distDir, 'index.js'), resolve(RESOURCES_DIR, 'index.js'))
  cpSync(resolve(ROOT, 'plugin.json'), resolve(RESOURCES_DIR, 'plugin.json'))

  const iconSrc = resolve(ROOT, 'icon.svg')
  if (existsSync(iconSrc)) {
    cpSync(iconSrc, resolve(RESOURCES_DIR, 'icon.svg'))
  }

  cpSync(wasmKeep, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  console.log(`[build] Copied WASM component: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
  console.log(`[build]   - index.js`)
  console.log(`[build]   - plugin.json`)
  console.log(`[build]   - icon.svg`)
  console.log(`[build]   - ${RUST_LIB_NAME}.wasm`)
}

/**
 * 助手工具声明的构建期校验：每个 tool 的 argsSchema 必须是 object，且 command 必须
 * 已在同份清单的 contributes.commands 声明。双端清单都要过——助手消费方按端取清单，
 * 任一端漏声明都会让工具在该端不可调用。
 */
function validateAssistantTools() {
  for (const manifestPath of [
    resolve(ROOT, 'plugin.json'),
    resolve(ROOT, '..', 'mobile', 'plugin.json'),
  ]) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const declared = new Set((manifest.contributes?.commands ?? []).map((c) => c.id))
    for (const tool of manifest.contributes?.assistantTools ?? []) {
      if (tool.argsSchema?.type !== 'object') {
        throw new Error(`[build] ${manifestPath}: assistantTools.${tool.id} argsSchema 必须是 object`)
      }
      if (!declared.has(tool.command)) {
        throw new Error(
          `[build] ${manifestPath}: assistantTools.${tool.id} 引用了未声明的命令 ${tool.command}`,
        )
      }
    }
  }
  console.log('[build] assistantTools declarations validated (desktop + mobile)')
}

validateAssistantTools()

const watchMode = argv.includes('--watch')
const frontendOnly = argv.includes('--frontend-only')
const rustOnly = argv.includes('--rust-only')

if (watchMode) {
  startPluginWatch({
    root: ROOT,
    resourcesDir: RESOURCES_DIR,
    extraFiles: ['icon.svg'],
    wasmFile: `${WASM_PROFILE_DIR}/${RUST_LIB_NAME}.wasm`,
  })
} else if (frontendOnly) {
  const keptWasm = preservePreviousWasm()
  buildFrontend()
  copyArtifacts({ wasmRebuilt: false, keptWasm })
} else if (rustOnly) {
  buildRust()
  copyArtifacts()
} else {
  buildFrontend()
  buildRust()
  copyArtifacts()
}

if (!watchMode) {
  console.log('\n[build] ====== Build complete! ======')
}