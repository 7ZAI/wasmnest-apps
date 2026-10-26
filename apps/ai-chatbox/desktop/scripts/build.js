/**
 * AI Chatbox 插件统一构建脚本
 *
 * 串联：vite build → tinygo build（WASM 组件，issue #21 Solution 4 构建链接入）
 *      → 复制产物到本仓默认产物目录 `.build/plugins`
 *
 * 后端构建（TinyGo 步骤替换 cargo，其余复用）：
 *   1. 工具链预检（tinygo / wasm-tools / Go 在 PATH；缺失 fail-visible + PATH 提示）；
 *   2. 清单嵌入副本同步：go:embed 不能上溯目录，plugin.json 由本脚本复制进 go/；
 *   3. wit 包组装：SDK 壳 tools/assemble-wit.mjs --out .build/go-wit（与绑定生成
 *      同一脚本，派生产物不入库）；
 *   4. tinygo build -target=wasip2 -wit-world go-plugin → `<rustLibrary>.wasm`
 *      （产物名沿用清单 rustLibrary 键位——键名中性化另裁，见 issue #21）。
 *
 * TinyGo 产物的调试档等价物首期不做（spec #21 Implementation Decisions）：
 * WASMNEST_PLUGIN_DEBUG=1 时按 release 构建并告警。
 */

import { execSync } from 'child_process'
import { cpSync, copyFileSync, mkdirSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, dirname, basename, join, sep } from 'path'
import { fileURLToPath } from 'url'
import { startPluginWatch } from '@binblink/wasmnest-plugin-sdk-desktop/bin/plugin-watch.js'
import { injectWasmHash, wasmFileName } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.ai-chatbox'
// 产物 wasm 文件名由清单 rustLibrary 声明（宿主按该名装载；Go 版沿用同一键位）
const WASM_NAME = wasmFileName(JSON.parse(readFileSync(resolve(ROOT, 'plugin.json'), 'utf-8')))

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → Rust 版 wasm 以 debug profile 构建
// （保留 DWARF）。Go 版 TinyGo 产物首期无调试档等价物，按 release 构建并告警
// （宿主侧以 cfg!(debug_assertions) 兜底，见 wasm_runtime.rs plugin_debug_mode）。
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
// TinyGo 构建输出与 wit 组装的中间区（gitignore 内 .build/）
const GO_BUILD_DIR = join('.build', 'go')
const GO_WIT_DIR = join('.build', 'go-wit')
// SDK Go 壳模块（首期源码取用，go.mod replace 同一目标；R1 兄弟布局 4 级上溯，
// 与 npm 侧 file: 依赖同深度）。WASMNEST_SDK_GO_DIR 为本地覆盖口（同
// WASMNEST_HOST_BIN 约定）：平台仓 feature worktree 未合流时指 worktree 路径。
const SDK_GO_DIR = process.env.WASMNEST_SDK_GO_DIR ||
  resolve(ROOT, '../../../../wasmnest/wasmnest-desktop/packages/plugin-sdk-desktop/go')

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
    console.error(`[build] 命令失败: ${cmd} (cwd=${options.cwd || ROOT})`)
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
  const prev = resolve(RESOURCES_DIR, WASM_NAME)
  if (!existsSync(prev)) return null
  const tmp = mkdtempSync(join(tmpdir(), 'wasmnest-wasm-keep-'))
  const kept = join(tmp, WASM_NAME)
  copyFileSync(prev, kept)
  return kept
}

function buildFrontend() {
  console.log('\n[build] ====== Building frontend (Vite) ======')
  run('pnpm exec vite build')
}

/** 工具链预检：缺失即退出并给出可执行出路（不猜默认值，不静默降级） */
function requireTools(names) {
  const missing = []
  for (const name of names) {
    try {
      execSync(`which ${name}`, { stdio: 'pipe' })
    } catch {
      missing.push(name)
    }
  }
  if (missing.length) {
    console.error(`[build] ERROR: 工具链缺失: ${missing.join(', ')}`)
    console.error(`[build]   钉版组合（issue #21 Phase 0 实证）：Go 1.27.3 / TinyGo 0.43.0 / wasm-tools 1.240.0`)
    console.error(`[build]   PATH 需含 Go / TinyGo / wasm-tools（本机安装示例：`)
    console.error(`[build]   export PATH="$HOME/.local/toolchains/go/bin:$HOME/.local/toolchains/tinygo/bin:$HOME/go/bin:$PATH"）`)
    process.exit(1)
  }
}

/**
 * Go 后端构建（TinyGo wasip2 组件）：
 *   清单副本同步 → wit 组装 → tinygo build → `.build/go/<rustLibrary>.wasm`
 */
function buildGo() {
  console.log('\n[build] ====== Building Go backend (TinyGo wasip2) ======')
  if (DEBUG_MODE) {
    console.warn('[build] ⚠ WASMNEST_PLUGIN_DEBUG=1：TinyGo 产物首期无调试档等价物，按 release 构建（spec #21）')
  }
  requireTools(['go', 'tinygo', 'wasm-tools'])

  // SDK Go 壳模块（wit 组装脚本随包分发）；缺失 = 平台仓未含 go/（分支未检出/未合流）
  if (!existsSync(SDK_GO_DIR)) {
    console.error(`[build] ERROR: SDK Go 模块缺失: ${SDK_GO_DIR}`)
    console.error(`[build]   平台仓需检出含 plugin-sdk-desktop/go 的分支（feat/go-backend-support，合流后主树即有）`)
    process.exit(1)
  }

  // 清单嵌入副本：go:embed 不能上溯目录，从工程根同步（embed 缺文件 = Go 编译错，fail-visible）
  run(`cp plugin.json go/plugin.json`)

  // wit 包组装（SDK 侧脚本，幂等全量重建；契约真源仍在能力仓 WIT）
  run(`node ${join(SDK_GO_DIR, 'tools', 'assemble-wit.mjs')} --out ${resolve(ROOT, GO_WIT_DIR)}`)

  // TinyGo 组件化（wasi:cli/command 由 TinyGo 运行时自带；导入面 = 代码实际引用面，
  // 链接器剪除未引用的 wasmimport 包装）
  run(
    `tinygo build -target=wasip2 -wit-package ${resolve(ROOT, GO_WIT_DIR)} -wit-world go-plugin -o ${resolve(ROOT, GO_BUILD_DIR, WASM_NAME)} .`,
    { cwd: resolve(ROOT, 'go') },
  )
}

function copyArtifacts(opts = {}) {
  console.log('\n[build] ====== Copying artifacts ======')

  // **先解析 WASM 产物，再清空目标目录**：清空在前 + 后续失败 ⇒ 目标目录既没有新产物，
  // 也没有上一份好产物（宿主随即装不上该 app，且 wasm 无处可回捞）。
  //
  // 候选顺序（`wasmRebuilt` = 本次是否真的重建了 wasm）：
  //   1. 本次 TinyGo 构建输出
  //   2. **仅前端构建时**：复用上一份留在产物目录里的 wasm —— `--frontend-only`
  //      的语义就是「只改前端，wasm 保持现状」。
  const candidates = [resolve(ROOT, GO_BUILD_DIR, WASM_NAME)]
  if (opts.wasmRebuilt === false) {
    // 本次构建没动 wasm：目标目录里仍在的那份优先（原位复用），其次用构建前保全到
    // 临时目录的那份（vite 清空 outDir 时唯一来源）。
    if (opts.keptWasm && existsSync(opts.keptWasm)) candidates.unshift(opts.keptWasm)
    candidates.unshift(resolve(RESOURCES_DIR, WASM_NAME))
  }
  const wasmSource = candidates.find((p) => existsSync(p))
  if (!wasmSource) {
    console.error(`[build] ERROR: WASM file not found at ${candidates.join(' or ')}`)
    console.error(`[build]   首次构建请跑全量：node scripts/build.js（Go 后端产物在 ${GO_BUILD_DIR}/）`)
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

  cpSync(wasmKeep, resolve(RESOURCES_DIR, WASM_NAME))
  console.log(`[build] Copied WASM: ${WASM_NAME} (from ${wasmSource})`)

  // WASM 内容摘要写进产物清单（票 14：只写产物，源 plugin.json 不带该键）
  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
  console.log(`[build]   - index.js`)
  console.log(`[build]   - plugin.json`)
  console.log(`[build]   - icon.svg`)
  console.log(`[build]   - ${WASM_NAME}`)
}

// ==================== Main ====================

const watchMode = argv.includes('--watch')
const frontendOnly = argv.includes('--frontend-only')
const goOnly = argv.includes('--go-only')

if (watchMode) {
  // 前端 watch 构建：改源码自动重建 + 复制产物（配合宿主 PluginDevWatcher 触发前端热重载）。
  // vite 子进程 + fs.watch 保持事件循环常驻，Ctrl+C 退出。
  // watch 只重建前端（与 Rust 版同语义）：Go 后端改动需一次性 `node scripts/build.js` 全量构建。
  startPluginWatch({
    root: ROOT,
    resourcesDir: RESOURCES_DIR,
    extraFiles: ['icon.svg'],
    wasmFile: `${GO_BUILD_DIR}/${WASM_NAME}`,
  })
} else if (frontendOnly) {
  // 先保全上一份 wasm 再让 vite 清空 outDir：仅前端构建语义 = 「wasm 保持现状」
  const keptWasm = preservePreviousWasm()
  buildFrontend()
  copyArtifacts({ wasmRebuilt: false, keptWasm })
} else if (goOnly) {
  buildGo()
  copyArtifacts()
} else {
  buildFrontend()
  buildGo()
  copyArtifacts()
}

if (!watchMode) {
  console.log('\n[build] ====== Build complete! ======')
}
