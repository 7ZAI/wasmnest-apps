/**
 * WasmNest 插件统一构建脚本（frontend + rust）
 *
 * 桌面 UI 宿主修正（2026-10-17）：本 app 前端恢复为**独立构建的挂载包**——
 * vite build（src/entry.ts 的 mountApp 契约，自带依赖无外部化）→ 复制
 * dist/index.js 到资源目录；宿主壳经 useAppMount 运行时装载。
 *
 * 串联：vite build（前端挂载包）→ cargo build（WASM wasip3）→ 复制产物到
 * 本仓默认产物目录（.build/plugins/desktop <id>/index.js + wasm + 随包资源）。
 *
 * 票 03 说明：桌面插件统一 wasm32-wasip3（pinned nightly 提供 std；cdylib 直出
 * Component，免 componentize 编码步骤），构建链配置取自仓库单一真源
 * `scripts/plugin-wasm-config.mjs`，本脚本不自带 target / toolchain 字面量。
 * wasip3 实例化需宿主 async store（阶段 2 票 02 已落）。
 *
 * 用法：node scripts/build.js [--rust-only]
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
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.terminal-session'
const RUST_LIB_NAME = 'bedcode_plugin_terminal_session'

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → wasm 以 debug profile 构建（保留 DWARF，
// 宿主开启 backtrace 行号栈用）；release 构建忽略（宿主侧以 cfg!(debug_assertions)
// 兜底，见 wasm_runtime.rs plugin_debug_mode）
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
    // 本次构建没动 wasm：目标目录里仍在的那份优先（原位复用），其次用**构建前保全到
    // 临时目录的那份**（vite 清空 outDir 时唯一来源）。
    if (opts.keptWasm && existsSync(opts.keptWasm)) candidates.unshift(opts.keptWasm)
    candidates.unshift(resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  }
  const wasmSource = candidates.find((p) => existsSync(p))
  if (!wasmSource) {
    console.error(`[build] ERROR: WASM not found at ${candidates.join(' or ')}`)
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

  // WASM 模块（已在函数开头解析出产物源；此处只落盘）
  cpSync(wasmKeep, resolve(RESOURCES_DIR, `${RUST_LIB_NAME}.wasm`))
  console.log(`[build] Copied WASM: ${RUST_LIB_NAME}.wasm (from ${wasmSource})`)

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
const rustOnly = argv.includes('--rust-only')
const frontendOnly = argv.includes('--frontend-only')
// 遗留参数显性报错而非静默忽略——避免旧脚本/文档照抄产生「构建了却缺前置」的假象。
for (const legacy of ['--watch']) {
  if (argv.includes(legacy)) {
    console.error(
      '[build] 参数 ' + legacy + ' 已退役：前端 watch 走宿主 plugins:dev 编排（plugin-watch）。',
    )
    process.exit(1)
  }
}

// --frontend-only 必须真的构建前端（此前写成 `!frontendOnly` → 该分支直接复用旧
// dist/index.js 就复制产物：dev 编排的预重建会静默拿到旧挂载包，改码不生效）
// 仅前端构建：先把上一份 wasm 挪到临时位置，vite 清空 outDir 后才还有东西可复用。
const keptWasm = frontendOnly ? preservePreviousWasm() : null
if (!rustOnly) buildFrontend()
if (!frontendOnly) buildRust()
copyArtifacts({ wasmRebuilt: !frontendOnly, keptWasm })

console.log('\n[build] ====== Build complete! ======')
