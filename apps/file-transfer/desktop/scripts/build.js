/**
 * File Transfer 插件统一构建脚本（双端单产物，2026-10-13）
 *
 * 串联：vite build → cargo 构建（wasm32-unknown-unknown）→ 组件化 → 复制产物到本仓 .build/plugins
 *
 * **工具链口径（单产物）**：本插件是双端共享产物源（规格
 * `.scratch/2026-10-13-file-transfer-single-wasm/spec.md`），与桌面其余
 * wasm 应用的 wasm32-wasip3 直出 Component **不同**——改用
 * wasm32-unknown-unknown + 组件化工具（随桌面 SDK 发布的 `tools/componentize`，
 * 经包名定位，见 `scripts/sdk-componentize.mjs`；G2 构建链不引平台仓源码），
 * 与移动端构建同一编码路径：stable 工具链可编（无需 pinned nightly），且移动
 * 宿主（wasmtime 48）加载的组件形态与其既有产物同构。桌面宿主加载标准组件
 * 无差异（T3 探针用例覆盖）。
 */

import { execSync } from 'child_process'
import { cpSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'fs'
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
const PLUGIN_ID = 'com.wasmnest.file-transfer'
const RUST_LIB_NAME = 'wasmnest_plugin_file_transfer'

// 单产物工具链：unknown-unknown + 组件化（非 wasip3 直出；见文件头口径）
const WASM_TARGET = 'wasm32-unknown-unknown'
// 每次构建物化到本 app 可写目录（node_modules 内是 pnpm 只读仓库，cargo 要写 lock）
const COMPONENTIZE_MANIFEST = componentizeManifestForBuild({
  destDir: resolve(ROOT, '.build', 'componentize'),
})

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留
// DWARF，宿主开启 backtrace 行号栈用）；release 构建忽略（宿主侧以
// cfg!(debug_assertions) 兜底，见 wasm_runtime.rs plugin_debug_mode）
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
  console.log('\n[build] ====== Building Rust backend (WASM, unknown-unknown) ======')
  // 单产物工具链：core module 产出后经仓库级组件化工具编码为 Component
  // （等价 wasm-tools component new；产物字节形态 00 61 73 6d 0d 00 01 00）
  run(
    // 双端同构 crate 住应用级 rust 层（`apps/file-transfer/rust/plugin`，非本端目录下）
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path ../rust/plugin/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
  )
  const modulePath = resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`)
  if (!existsSync(modulePath)) {
    console.error(`[build] ERROR: core module not found at ${modulePath}`)
    process.exit(1)
  }
  console.log('\n[build] ====== Componentizing WASM (Component Model) ======')
  // 原地组件化（-o 覆盖输入）：工具幂等，已是组件时直通
  run(
    // --target-dir 复用应用仓共享 target（工具是宿主机 native bin，与 wasm 产物同桶无害）。
    // 不加 --locked：仓内 .cargo/config.toml 的 [patch]（CI 的跨仓检出 / link-platform-sdk
    // 的本地 patch）会让 SDK 带来的 Cargo.lock 需要重写，--locked 只会把构建打死；
    // 工具依赖本身钉死在 `wit-component = "=0.256.0"`，编码行为不随依赖漂移。
    `cargo run --release --manifest-path "${COMPONENTIZE_MANIFEST}" --target-dir ${WASM_TARGET_DIR} -- "${modulePath}" -o "${modulePath}"`,
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
  //      （平台仓 15G 阈值自动清理）时这是唯一正确的来源。
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

  // 清理并创建目标目录
  if (existsSync(RESOURCES_DIR)) {
    rmSync(RESOURCES_DIR, { recursive: true })
  }
  mkdirSync(RESOURCES_DIR, { recursive: true })

  // 复制前端产物
  const distDir = resolve(ROOT, 'dist')
  cpSync(resolve(distDir, 'index.js'), resolve(RESOURCES_DIR, 'index.js'))

  // 复制 plugin.json
  cpSync(resolve(ROOT, 'plugin.json'), resolve(RESOURCES_DIR, 'plugin.json'))

  // 复制插件图标（PluginIcon.vue 经 asset protocol 加载 icon.svg）
  const iconSrc = resolve(ROOT, 'icon.svg')
  if (existsSync(iconSrc)) {
    cpSync(iconSrc, resolve(RESOURCES_DIR, 'icon.svg'))
  }

  cpSync(wasmKeep, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  console.log(`[build] Copied WASM component: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

  // WASM 内容摘要写进产物清单（票 14：只写产物，源 plugin.json 不带该键）
  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
  console.log(`[build]   - index.js`)
  console.log(`[build]   - plugin.json`)
  console.log(`[build]   - icon.svg`)
  console.log(`[build]   - ${RUST_LIB_NAME}.wasm`)
}

// ==================== Main ====================

const watchMode = argv.includes('--watch')
const frontendOnly = argv.includes('--frontend-only')
const rustOnly = argv.includes('--rust-only')

if (watchMode) {
  // 前端 watch 构建：改源码自动重建 + 复制产物（配合宿主 PluginDevWatcher 触发前端热重载）。
  // vite 子进程 + fs.watch 保持事件循环常驻，Ctrl+C 退出
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
