/**
 * Agent Hub 插件统一构建脚本
 *
 * 串联：vite build → cargo build (WASM) → 复制产物到本仓默认产物目录 `.build/plugins`
 * （与 file-transfer 同构，仅插件 ID / crate 名不同）
 */

import { execSync } from 'child_process'
import { cpSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, dirname, basename, join, sep } from 'path'
import { fileURLToPath } from 'url'
import { startPluginWatch } from '@binblink/wasmnest-plugin-sdk-desktop/bin/plugin-watch.js'
import {
  WASM_TARGET,
  WASM_TARGET_DIR,
  wasip3CargoEnv,
} from '../../../../scripts/plugin-wasm-config.mjs'
import { injectWasmHash } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.agent-hub'
const RUST_LIB_NAME = 'wasmnest_plugin_agent_hub'

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留
// DWARF，宿主开启 backtrace 行号栈用）；release 构建忽略
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const WASM_PROFILE = DEBUG_MODE ? 'debug' : 'release'
const WASM_PROFILE_DIR = `${WASM_TARGET_DIR}/${WASM_TARGET}/${WASM_PROFILE}`

// ==================== 产物目标目录（G2：默认写本仓，不依赖平台仓） ====================
// 默认 = 本 app 工程内 `.build/plugins/<appId>/`（已 gitignore）。**刻意不落 `dist/`**：
// 桌面各 app 的 vite 配置都是 `outDir: dist` + `emptyOutDir: true`，产物一旦落在 dist
// 就会被每次前端构建清空——仅前端构建会连 wasm 一起丢，watch 期宿主还会短暂看到目录消失。
//
// `--out <dir>`（或 env WASMNEST_PLUGINS_DIR）：产物改写到**指定 plugins 目录**下的
// `<dir>/<appId>/`。宿主以构建产物运行（dev:host）、E2E 临时 staging 都走这条。
// 本脚本只写 `<dir>/<appId>/` 一层，同目录下可以有别的 app 的产物，互不覆盖。
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
 * 仅前端构建前保全上一份 wasm（G2 默认产物写本仓后的必做前置）。
 *
 * `vite build` 清空 outDir（dist），而 `--frontend-only` 的语义是「wasm 保持现状」；
 * 不在构建前把它挪出来，清空后无处复用 = 产物目录里只剩前端包，宿主装不上该 app。
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
  console.log('\n[build] ====== Building Rust backend (WASM) ======')
  // 票 03：桌面插件统一 wasm32-wasip3（pinned nightly 提供 std；产物 cdylib 直出
  // Component，免 componentize 编码步骤）。wasip3 实例化需宿主 async store（票 02）。
  run(
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path rust/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
    { env: wasip3CargoEnv() },
  )
}

function copyArtifacts(opts = {}) {
  console.log('\n[build] ====== Copying artifacts ======')

  // **先解析 WASM 产物，再清空目标目录**：清空在前 + 后续失败 ⇒ 目标目录既没有新产物，
  // 也没有上一份好产物（宿主随即装不上该 app，且 wasm 无处可回捞）。
  //
  // 候选顺序（`wasmRebuilt` = 本次是否真的重建了 wasm）：
  //   1. 本次构建 profile 的产物
  //   2. 另一 profile 的产物
  //   3. **仅前端构建时**：复用上一份留在产物目录里的 wasm —— `--frontend-only`
  //      的语义就是「只改前端，wasm 保持现状」；共享 wasm target 被 cargo clean 清掉
  //      （平台仓 15G 阈值自动清理，见 wasmnest-desktop/scripts/check-target-size.js）
  //      时这是唯一正确的来源。重建 wasm 请走完整构建（不加 --frontend-only）。
  const candidates = [
    resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`),
    resolve(
      ROOT,
      `${WASM_TARGET_DIR}/${WASM_TARGET}/${DEBUG_MODE ? 'release' : 'debug'}`,
      `${RUST_LIB_NAME}.wasm`,
    ),
  ]
  if (opts.wasmRebuilt === false) {
    // 本次构建没动 wasm：目标目录里仍在的那份优先（原位复用），其次用构建前保全到
    // 临时目录的那份（vite 清空 outDir 时唯一来源）。
    if (opts.keptWasm && existsSync(opts.keptWasm)) candidates.unshift(opts.keptWasm)
    candidates.unshift(resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  }
  const wasmSource = candidates.find((p) => existsSync(p))
  if (!wasmSource) {
    console.error(`[build] ERROR: WASM file not found at ${candidates.join(' or ')}`)
    process.exit(1)
  }

  // 源落在目标目录内（仅前端构建复用上一份产物）→ 先挪到临时位置，
  // 否则下面「清空目标目录」会把源一起删掉。
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
  console.log(`[build] Copied WASM: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

  // WASM 内容摘要写进产物清单（票 14：只写产物，源 plugin.json 不带该键）
  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
}

// ==================== Main ====================

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
  // 先保全上一份 wasm 再让 vite 清空 outDir：仅前端构建语义 = 「wasm 保持现状」
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
