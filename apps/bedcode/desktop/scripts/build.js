/**
 * WasmNest 插件统一构建脚本（frontend + rust）
 *
 * 桌面 UI 宿主修正（2026-10-17）：本 app 前端恢复为**独立构建的挂载包**——
 * vite build（src/entry.ts 的 mountApp 契约，自带依赖无外部化）→ 复制
 * dist/index.js 到资源目录；宿主壳经 useAppMount 运行时装载。
 *
 * 串联：vite build（前端挂载包）→ cargo build（WASM wasip3）→ 复制产物到
 * 内置资源目录（resources/plugins/desktop/<id>/index.js + wasm + 随包资源）。
 *
 * 票 03 说明：桌面插件统一 wasm32-wasip3（pinned nightly 提供 std；cdylib 直出
 * Component，免 componentize 编码步骤），构建链配置取自仓库单一真源
 * `scripts/plugin-wasm-config.mjs`，本脚本不自带 target / toolchain 字面量。
 * wasip3 实例化需宿主 async store（阶段 2 票 02 已落）。
 *
 * 用法：node scripts/build.js [--rust-only]
 */

import { execSync } from 'child_process'
import { cpSync, mkdirSync, existsSync, rmSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import {
  WASM_TARGET,
  WASM_TARGET_DIR,
  wasip3CargoEnv,
} from '../../../../scripts/plugin-wasm-config.mjs'
import { injectWasmHash } from '../../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/bin/wasm-hash.js'
import { desktopHostResourcesDir } from '../../../../scripts/platform-paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const PLUGIN_ID = 'com.wasmnest.terminal-session'
const RUST_LIB_NAME = 'bedcode_plugin_terminal_session'

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留 DWARF，
// 宿主开启 backtrace 行号栈用）；release 构建忽略（宿主侧以 cfg!(debug_assertions)
// 兜底，见 wasm_runtime.rs plugin_debug_mode）
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const WASM_PROFILE = DEBUG_MODE ? 'debug' : 'release'
const WASM_PROFILE_DIR = `${WASM_TARGET_DIR}/${WASM_TARGET}/${WASM_PROFILE}`

// 产物目标目录（内置资源，宿主按 resources/plugins/desktop/<id>/ 扫描加载）
// 宿主资源目录（平台仓）经集中 resolver 解析（三仓拆分 §5-E7）：dev 期产物直接写进
// 平台仓宿主 resources，宿主读同一目录。
const RESOURCES_DIR = resolve(desktopHostResourcesDir(), PLUGIN_ID)

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

/** 随包 Agent hook 脚本（部署到用户项目里的集成入口，hooks.rs 按名取用） */
const HOOK_SCRIPTS = [
  'auto_task_hook.py',
  'codex_task_hook.py',
  'pi_task_hook.ts',
  'opencode_task_hook.ts',
]

/** 复制存在的可选随包资源（缺失即跳过）；flatten 时压平一级路径，落资源目录根 */
function copyOptionalFiles(files, flatten = false) {
  for (const rel of files) {
    const src = resolve(ROOT, rel)
    if (!existsSync(src)) continue
    const target = flatten ? basename(rel) : rel
    cpSync(src, resolve(RESOURCES_DIR, target))
    console.log(`[build] Copied ${rel}${flatten ? ` → ${target}` : ''}`)
  }
}

function copyArtifacts() {
  console.log('\n[build] ====== Copying artifacts ======')

  if (existsSync(RESOURCES_DIR)) {
    rmSync(RESOURCES_DIR, { recursive: true })
  }
  mkdirSync(RESOURCES_DIR, { recursive: true })

  cpSync(resolve(ROOT, 'plugin.json'), resolve(RESOURCES_DIR, 'plugin.json'))

  // 前端挂载包（vite build 产物；宿主 useAppMount 按 <id>/index.js 约定装载）
  const frontendBundle = resolve(ROOT, 'dist/index.js')
  if (existsSync(frontendBundle)) {
    cpSync(frontendBundle, resolve(RESOURCES_DIR, 'index.js'))
    console.log('[build] Copied frontend bundle: dist/index.js → index.js')
  } else if (!rustOnly) {
    console.error('[build] ERROR: frontend bundle not found at ' + frontendBundle)
    process.exit(1)
  }

  // 随包资源：图标（PluginIcon.vue 经 asset protocol 读取）
  copyOptionalFiles(['icon.svg'])

  // Agent hook 脚本（票 16）：会话注入时 hooks.rs 按 `<resource_dir>/<脚本名>` 取，
  // 即**安装目录根**（不是 scripts/ 子目录），故复制时压平一级路径。
  // hook 与插件版本同进退（spec D1）：脚本内容改了就必须随包重出，否则项目里部署
  // 的副本指向已不存在的端点。
  copyOptionalFiles(
    HOOK_SCRIPTS.map((name) => `scripts/${name}`),
    true,
  )

  // WASM 模块（按 profile 取产物；缺失时回退另一 profile）
  const wasmPath = resolve(ROOT, WASM_PROFILE_DIR, `${RUST_LIB_NAME}.wasm`)
  if (existsSync(wasmPath)) {
    cpSync(wasmPath, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
    console.log(`[build] Copied WASM (${WASM_PROFILE}): ${RUST_LIB_NAME}.wasm`)
  } else {
    const fallbackProfile = DEBUG_MODE ? 'release' : 'debug'
    const fallbackWasmPath = resolve(
      ROOT,
      `${WASM_TARGET_DIR}/${WASM_TARGET}/${fallbackProfile}`,
      `${RUST_LIB_NAME}.wasm`,
    )
    if (!existsSync(fallbackWasmPath)) {
      console.error(`[build] ERROR: WASM not found at ${wasmPath} or ${fallbackWasmPath}`)
      process.exit(1)
    }
    cpSync(fallbackWasmPath, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
    console.log(`[build] Copied WASM (${fallbackProfile} fallback): ${RUST_LIB_NAME}.wasm`)
  }

  // WASM 内容摘要写进产物清单（票 14：只写产物，源 plugin.json 不带该键）
  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
  for (const name of HOOK_SCRIPTS) {
    console.log(
      `[build]   - ${name}${existsSync(resolve(RESOURCES_DIR, name)) ? '' : ' (缺失！检查 scripts/)'}`,
    )
  }
}

// ==================== Main ====================

// 构建开关：--rust-only 只出 wasm；--frontend-only 只出前端挂载包并复制产物；
// 缺省 = 前端 + Rust 全量（与其余三个 app 的 build.js 同款编排）
const args = process.argv.slice(2)
const rustOnly = args.includes('--rust-only')
const frontendOnly = args.includes('--frontend-only')
// 遗留参数显性报错而非静默忽略——避免旧脚本/文档照抄产生「构建了却缺前置」的假象。
for (const legacy of ['--watch']) {
  if (args.includes(legacy)) {
    console.error(
      '[build] 参数 ' + legacy + ' 已退役：前端 watch 走宿主 plugins:dev 编排（plugin-watch）。',
    )
    process.exit(1)
  }
}

// --frontend-only 必须真的构建前端（此前写成 `!frontendOnly` → 该分支直接复用旧
// dist/index.js 就复制产物：dev 编排的预重建会静默拿到旧挂载包，改码不生效）
if (!rustOnly) buildFrontend()
if (!frontendOnly) buildRust()
copyArtifacts()

console.log('\n[build] ====== Build complete! ======')
