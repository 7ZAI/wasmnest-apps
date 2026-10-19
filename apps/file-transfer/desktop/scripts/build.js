/**
 * File Transfer 插件统一构建脚本（双端单产物，2026-10-13）
 *
 * 串联：vite build → cargo 构建（wasm32-unknown-unknown）→ 组件化 → 复制产物
 *
 * **工具链口径（单产物）**：本插件是双端共享产物源（规格
 * `.scratch/2026-10-13-file-transfer-single-wasm/spec.md`），与桌面其余
 * wasm 应用的 wasm32-wasip3 直出 Component **不同**——改用
 * wasm32-unknown-unknown + 平台仓级组件化工具（`tools/componentize`），
 * 与移动端构建同一编码路径：stable 工具链可编（无需 pinned nightly），且移动
 * 宿主（wasmtime 48）加载的组件形态与其既有产物同构。桌面宿主加载标准组件
 * 无差异（T3 探针用例覆盖）。
 */

import { execSync } from 'child_process'
import { cpSync, mkdirSync, existsSync, rmSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { startPluginWatch } from '../../../../../wasmnest/wasmnest-desktop/scripts/plugin-watch.js'
import { WASM_TARGET_DIR } from '../../../../scripts/plugin-wasm-config.mjs'
import { componentizeManifest, desktopHostResourcesDir } from '../../../../scripts/platform-paths.mjs'
import { injectWasmHash } from '../../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const PLUGIN_ID = 'com.wasmnest.file-transfer'
const RUST_LIB_NAME = 'wasmnest_plugin_file_transfer'

// 单产物工具链：unknown-unknown + 组件化（非 wasip3 直出；见文件头口径）
const WASM_TARGET = 'wasm32-unknown-unknown'
const COMPONENTIZE_MANIFEST = componentizeManifest()

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留
// DWARF，宿主开启 backtrace 行号栈用）；release 构建忽略（宿主侧以
// cfg!(debug_assertions) 兜底，见 wasm_runtime.rs plugin_debug_mode）
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const WASM_PROFILE = DEBUG_MODE ? 'debug' : 'release'
const WASM_PROFILE_DIR = `${WASM_TARGET_DIR}/${WASM_TARGET}/${WASM_PROFILE}`

// ==================== 产物目标目录 ====================
// 默认 = 平台仓宿主 resources（经集中 resolver 解析，三仓拆分 §5-E7）：dev 期产物直接
// 写进平台仓宿主 resources，宿主读同一目录。
//
// `--out <dir>`（或 env WASMNEST_PLUGINS_DIR）：产物改写到**指定 plugins 目录**下的
// `<dir>/<appId>/`。给「宿主以构建产物运行、不依赖平台仓源码」的形态用——宿主启动时
// 用同一个目录作为 WASMNEST_PLUGINS_DIR 即可装载本 app（见 scripts/dev-host.js）。
// 注意本脚本只写 `<dir>/<appId>/` 一层，同目录下可以有别的 app 的产物，互不覆盖。
const argv = process.argv.slice(2)
function flagValue(flag) {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const OUT_DIR_ARG = flagValue('--out') || process.env.WASMNEST_PLUGINS_DIR || null
const PLUGINS_DIR = OUT_DIR_ARG ? resolve(ROOT, OUT_DIR_ARG) : desktopHostResourcesDir()
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
    `cargo run --release --manifest-path "${COMPONENTIZE_MANIFEST}" -- "${modulePath}" -o "${modulePath}"`,
  )
}

function copyArtifacts() {
  console.log('\n[build] ====== Copying artifacts ======')

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

  // 复制 WASM 组件（按构建 profile 取产物；缺失时回退另一 profile）
  const wasmPath = resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`)

  if (existsSync(wasmPath)) {
    cpSync(wasmPath, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
    console.log(`[build] Copied WASM component (${WASM_PROFILE}): ${RUST_LIB_NAME}.wasm`)
  } else {
    const fallbackProfile = DEBUG_MODE ? 'release' : 'debug'
    const fallbackWasmPath = resolve(
      ROOT,
      `${WASM_TARGET_DIR}/${WASM_TARGET}/${fallbackProfile}`,
      `${RUST_LIB_NAME}.wasm`,
    )
    if (!existsSync(fallbackWasmPath)) {
      console.error(`[build] ERROR: WASM file not found at ${wasmPath} or ${fallbackWasmPath}`)
      process.exit(1)
    }
    cpSync(fallbackWasmPath, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
    console.log(`[build] Copied WASM component (${fallbackProfile} fallback): ${RUST_LIB_NAME}.wasm`)
  }

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
  buildFrontend()
  copyArtifacts()
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
