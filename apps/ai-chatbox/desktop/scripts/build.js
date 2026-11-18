/**
 * AI Chatbox 插件统一构建脚本（双后端：Rust wasip3 / Go TinyGo wasip2）
 *
 * 串联：vite build → 后端 WASM 构建（Rust cargo 与/或 Go TinyGo）→ 复制产物到
 *      本仓默认产物目录 `.build/plugins`
 *
 * **两个后端并存**（issue #21 试点：Go 为 Rust 的对等移植，命令面 / 存储布局逐字对齐）：
 *   - `rust/`：wasm32-wasip3，pinned nightly，cdylib 直出 Component；
 *   - `go/`：TinyGo wasip2 组件，需 PATH 上有 go / tinygo / wasm-tools（钉版见
 *     `go/README.md`）。
 * 一次全量构建默认**两份都编**（`--backend both`），产物流水线各自独立：
 *   - Rust → `<appsRoot>/target/wasm-apps/<target>/<profile>/<rustLibrary>.wasm`（共享 target）
 *   - Go   → 本工程 `.build/go/<rustLibrary>.wasm`（+ `.build/go-wit` 组装区）
 * 宿主只能按 `plugin.json.rustLibrary` 装**一份**。**默认安装 Rust 版**（用户 2026-11-09
 * 裁决：宿主默认加载 rust），Go 版作为可选第二后端：`--install <go|rust>` >
 * env `WASMNEST_AI_CHATBOX_BACKEND` > 默认 rust（rust 未产出才回落 go，回落必打印横幅）。
 *
 * `--variants <dir>`：把**未安装**的后端也物化成完整插件目录（`<dir>/<backend>/<id>/`），
 * 供打包链各打一份 zip（应用仓 `scripts/package-plugins.mjs --variants-dir`）。
 * 默认不写：dev 的 `--out` 直指宿主 resources，多出的目录会被宿主扫描成幽灵插件。
 *
 * 后端集合：`--backend go|rust|both`（默认 both）。`--go-only` = `--backend go`；
 * `--rust-only` 是历史名字（平台仓 plugin-precheck 的「只补后端、跳过 vite」快速路径
 * 沿用它），语义 = `--backend-only`，后端集合仍由 `--backend` 决定。
 *
 * **工具链缺失不再静默沿用旧产物**（2026-11-09 修）：显式点名的后端缺工具链 → 硬失败；
 * 默认 both 时 Go 缺失 → 告警并按 Rust 产物安装（点名缺失与 PATH 出路），绝不把上一份
 * 旧 wasm 复制回去刷 mtime（那会让平台仓的 mtime 陈旧判据永久失效）。
 */

import { execSync } from 'child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'
import { resolve, dirname, basename, join, sep } from 'path'
import { fileURLToPath } from 'url'
import { startPluginWatch } from '@binblink/wasmnest-plugin-sdk-desktop/bin/plugin-watch.js'
import { injectWasmHash, wasmFileName } from '@binblink/wasmnest-plugin-sdk-desktop/bin/wasm-hash.js'
import {
  WASM_TARGET,
  WASM_TARGET_DIR,
  wasip3CargoEnv,
} from '../../../../scripts/plugin-wasm-config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)
const ROOT = resolve(__dirname, '..')
/** 默认产物根目录：本仓内、且不在 vite outDir（dist）之下 */
const DEFAULT_PLUGINS_DIR = join('.build', 'plugins')
const PLUGIN_ID = 'com.wasmnest.ai-chatbox'
// 产物 wasm 文件名由清单 rustLibrary 声明（宿主按该名装载；Go 版沿用同一键位）
const WASM_NAME = wasmFileName(JSON.parse(readFileSync(resolve(ROOT, 'plugin.json'), 'utf-8')))
const IS_WIN = process.platform === 'win32'

// 插件调试模式：WASMNEST_PLUGIN_DEBUG=1 → Rust 版 wasm 以 debug profile 构建
// （保留 DWARF）。Go 版 TinyGo 产物首期无调试档等价物，按 release 构建并告警
// （宿主侧以 cfg!(debug_assertions) 兜底，见 wasm_runtime.rs plugin_debug_mode）。
const DEBUG_MODE = !!process.env.WASMNEST_PLUGIN_DEBUG
const RUST_PROFILE = DEBUG_MODE ? 'debug' : 'release'
/** Rust 产物：共享 target（`<appsRoot>/target/wasm-apps`）下的 cdylib Component */
const RUST_WASM_PATH = resolve(
  ROOT,
  `${WASM_TARGET_DIR}/${WASM_TARGET}/${RUST_PROFILE}/${WASM_NAME}`,
)
/** TinyGo 构建输出与 wit 组装的中间区（gitignore 内 .build/） */
const GO_BUILD_DIR = join('.build', 'go')
const GO_WIT_DIR = join('.build', 'go-wit')
const GO_WASM_PATH = resolve(ROOT, GO_BUILD_DIR, WASM_NAME)
/** Go 工具链（钉版组合见 go/README.md：TinyGo 组件化必须有外部 wasm-tools） */
const GO_TOOLS = ['go', 'tinygo', 'wasm-tools']
/**
 * SDK Go 壳模块（wit 组装脚本随包分发）。
 *
 * 经**包名**解析（G2 导入锁：构建链不得引平台仓相对路径）：`
 * node_modules/@binblink/wasmnest-plugin-sdk-desktop/go`——平台仓 R1 布局下是 file: 软链，
 * 发布后也能命中（SDK package.json `files` 含 `go`）。`WASMNEST_SDK_GO_DIR` 为本地覆盖口
 * （同 WASMNEST_HOST_BIN 约定）：平台仓 feature worktree 未合流时指 worktree 路径。
 *
 * 注：Go 模块自身的 `go.mod replace` 仍指平台仓（issue #21 首期不发布 Go 模块，
 * `go.work` 为本地逃生阀）；两处路径在 R1 布局下指向同一物理目录。
 */
const SDK_GO_DIR =
  process.env.WASMNEST_SDK_GO_DIR ||
  resolve(
    dirname(require.resolve('@binblink/wasmnest-plugin-sdk-desktop/package.json')),
    'go',
  )

/** 后端 → 产物路径（唯一真源，安装 / 摘要注入 / watch 复制都从这里取） */
const BACKEND_ARTIFACT = {
  rust: RUST_WASM_PATH,
  go: GO_WASM_PATH,
}
const ALL_BACKENDS = ['go', 'rust']

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
/** 未安装后端的物化目录（可选；`--variants <dir>`，打包链用来各打一份 zip） */
const VARIANTS_DIR_ARG = flagValue('--variants')
const VARIANTS_DIR = VARIANTS_DIR_ARG ? resolve(ROOT, VARIANTS_DIR_ARG) : null

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

// ==================== 后端构建 ====================

/** 工具链在位检查：返回缺失名单（空数组 = 齐全），不做退出决策 */
function missingTools(names) {
  const missing = []
  for (const name of names) {
    try {
      execSync(`${IS_WIN ? 'where' : 'which'} ${name}`, { stdio: 'pipe' })
    } catch {
      missing.push(name)
    }
  }
  return missing
}

/** 工具链出路文案（点名钉版组合 + PATH 示例；调用方决定警告还是硬失败） */
function printToolchainEscape(missing) {
  console.error(`[build]   缺失: ${missing.join(', ')}`)
  console.error(`[build]   钉版组合（issue #21 Phase 0 实证）：Go 1.27.3 / TinyGo 0.43.0 / wasm-tools 1.240.0`)
  console.error(`[build]   PATH 需含 Go / TinyGo / wasm-tools（本机安装示例：`)
  console.error(
    `[build]   export PATH="$HOME/.local/toolchains/go/bin:$HOME/.local/toolchains/tinygo/bin:$HOME/go/bin:$PATH"）`,
  )
}

/**
 * Rust 后端（wasm32-wasip3，cdylib 直出 Component，免 componentize）。
 * @returns {boolean} 是否真的产出了本次构建的产物
 */
function buildRust() {
  console.log('\n[build] ====== Building Rust backend (wasm32-wasip3) ======')
  run(
    `cargo build --target ${WASM_TARGET} --target-dir ${WASM_TARGET_DIR} --no-default-features --features wasm --manifest-path rust/Cargo.toml${DEBUG_MODE ? '' : ' --release'}`,
    { env: wasip3CargoEnv() },
  )
  return existsSync(RUST_WASM_PATH)
}

/**
 * Go 后端构建（TinyGo wasip2 组件）：清单副本同步 → wit 组装 → tinygo build
 * → `.build/go/<rustLibrary>.wasm`。
 *
 * 工具链缺失的策略由调用方通过 `required` 决定（显式点名的后端硬失败；默认 both
 * 允许降级到 Rust，但必须告警并打印出路——**不再沿用上一份旧产物**）。
 * 工具链在位但 SDK Go 模块缺失 = 配置问题，仍硬失败（fail-visible）。
 * @param {{required: boolean}} opts
 * @returns {boolean} 本次是否真的重建了 wasm
 */
function buildGo({ required }) {
  console.log('\n[build] ====== Building Go backend (TinyGo wasip2) ======')
  const missing = missingTools(GO_TOOLS)
  if (missing.length) {
    if (required) {
      console.error('[build] ERROR: 显式要求构建 Go 后端，但工具链缺失：')
      printToolchainEscape(missing)
      process.exit(1)
    }
    console.warn('[build] ⚠ 跳过 Go 后端（工具链缺失）——本次将安装 Rust 产物：')
    printToolchainEscape(missing)
    console.warn('[build] ⚠ 装好工具链后重跑本脚本即会同时构建并安装 Go 产物')
    return false
  }
  if (DEBUG_MODE) {
    console.warn('[build] ⚠ WASMNEST_PLUGIN_DEBUG=1：TinyGo 产物首期无调试档等价物，按 release 构建（spec #21）')
  }

  // SDK Go 壳模块（wit 组装脚本随包分发）；缺失 = 平台仓检出不含 go/（未合流/未检出）
  if (!existsSync(SDK_GO_DIR)) {
    console.error(`[build] ERROR: SDK Go 模块缺失: ${SDK_GO_DIR}`)
    console.error(`[build]   平台仓需检出含 plugin-sdk-desktop/go 的分支（dev 已合流，主树即有）`)
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
  return existsSync(GO_WASM_PATH)
}

// ==================== 产物复制 ====================

/**
 * 把前端产物 + 选定后端的 WASM 复制进目标产物目录。
 *
 * **先解析 WASM 产物，再清空目标目录**：清空在前 + 后续失败 ⇒ 目标目录既没有新产物，
 * 也没有上一份好产物（宿主随即装不上该 app，且 wasm 无处可回捞）。
 *
 * @param {{wasmSource: string, backend?: string}} opts wasmSource 已存在（调用方保证）
 */
function copyArtifacts({ wasmSource, backend }) {
  console.log('\n[build] ====== Copying artifacts ======')

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
  console.log(
    `[build] Copied WASM: ${WASM_NAME}${backend ? ` (backend=${backend})` : ''} (from ${wasmSource})`,
  )

  // WASM 内容摘要写进产物清单（票 14：只写产物，源 plugin.json 不带该键）
  injectWasmHash(RESOURCES_DIR, { log: (m) => console.log(`[build] ${m}`) })

  console.log(`[build] Artifacts copied to: ${RESOURCES_DIR}`)
  console.log(`[build]   - index.js`)
  console.log(`[build]   - plugin.json`)
  console.log(`[build]   - icon.svg`)
  console.log(`[build]   - ${WASM_NAME}`)
}

/** 产物大小（日志用；缺失返回 0） */
function artifactSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * 把**未安装**的后端物化成完整插件目录：`<variantsDir>/<backend>/<id>/`。
 *
 * 前端 / 清单 / 图标直接从已物化的默认目录复制（同一次构建，字节必然一致），
 * 只把 wasm 换成该后端的产物并重算 wasmHash——打包链据此出一个独立 zip。
 */
function writeVariant({ backend }) {
  const dest = resolve(VARIANTS_DIR, backend, PLUGIN_ID)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(RESOURCES_DIR, dest, { recursive: true })
  copyFileSync(BACKEND_ARTIFACT[backend], resolve(dest, WASM_NAME))
  injectWasmHash(dest, { log: (m) => console.log(`[build] [variant ${backend}] ${m}`) })
  console.log(`[build] backend ${backend} 变体已物化: ${dest}`)
}

// ==================== Main ====================

const watchMode = argv.includes('--watch')
const frontendOnly = argv.includes('--frontend-only')
const goOnly = argv.includes('--go-only')
/** 历史名字（平台仓 plugin-precheck 的快速路径）：只构建后端，跳过 vite */
const backendOnly = argv.includes('--rust-only') || argv.includes('--backend-only')

/** `--backend go|rust|both`，缺省 both；非法值硬失败（不猜） */
function resolveBackends() {
  const raw = (flagValue('--backend') || 'both').toLowerCase()
  if (raw === 'both' || raw === 'all') return [...ALL_BACKENDS]
  if (raw === 'go' || raw === 'rust') return [raw]
  console.error(`[build] ERROR: --backend 只接受 go|rust|both（收到 ${raw}）`)
  process.exit(1)
}

/**
 * 安装哪一份产物到宿主目录。
 *
 * 优先级：`--install` > env `WASMNEST_AI_CHATBOX_BACKEND` > 本次真正构建成功的后端里
 * **优先 rust**（宿主默认加载 rust）、否则 go。显式点名但该后端产物不存在 → 硬失败
 * （不静默换后端）；**只接受本次构建成功的后端**，避免把旧产物复制回去刷新 mtime
 * （那会让平台仓的陈旧判据永久失效）。
 */
function selectInstallBackend(built) {
  const explicit = (flagValue('--install') || process.env.WASMNEST_AI_CHATBOX_BACKEND || '').toLowerCase()
  if (explicit) {
    if (!ALL_BACKENDS.includes(explicit)) {
      console.error(`[build] ERROR: 安装后端只接受 go|rust（收到 ${explicit}）`)
      process.exit(1)
    }
    if (!existsSync(BACKEND_ARTIFACT[explicit])) {
      console.error(`[build] ERROR: 指定安装 ${explicit} 产物，但 ${BACKEND_ARTIFACT[explicit]} 不存在`)
      console.error(`[build]   先构建它：node scripts/build.js --backend ${explicit} --backend-only`)
      process.exit(1)
    }
    return explicit
  }
  const preferred = built.includes('rust') ? 'rust' : built[0]
  if (!preferred) {
    console.error('[build] ERROR: 没有任何后端产物可用')
    console.error(`[build]   rust: ${RUST_WASM_PATH}`)
    console.error(`[build]   go:   ${GO_WASM_PATH}`)
    console.error('[build]   首次构建请跑全量：node scripts/build.js（或指定 --backend <go|rust>）')
    process.exit(1)
  }
  return preferred
}

/**
 * 当前产物目录里实际装的是哪个后端（按 wasm 字节比对）。
 *
 * watch 只重写前端、随手把 wasm 一起复制；若写错后端，就等于把 host 默认加载的 rust
 * 静默换成 go。所以 watch 必须先识别已安装的那一份，识别不出时按默认 rust。
 */
function detectInstalledBackend() {
  const installed = resolve(RESOURCES_DIR, WASM_NAME)
  if (!existsSync(installed)) return null
  const target = readFileSync(installed)
  for (const backend of ALL_BACKENDS) {
    const artifact = BACKEND_ARTIFACT[backend]
    try {
      if (existsSync(artifact) && readFileSync(artifact).equals(target)) return backend
    } catch {
      // 读取失败（文件被并发重建）→ 换下一个后端，最后回落默认
    }
  }
  return null
}

if (watchMode) {
  // 前端 watch 构建：改源码自动重建 + 复制产物（配合宿主 PluginDevWatcher 触发前端热重载）。
  // vite 子进程 + fs.watch 保持事件循环常驻，Ctrl+C 退出。
  // watch 只重建前端（与 Rust 版同语义）：后端改动需一次性全量构建（--backend both）。
  const watchBackend =
    detectInstalledBackend() ?? (existsSync(RUST_WASM_PATH) ? 'rust' : 'go')
  if (!watchBackend || !existsSync(BACKEND_ARTIFACT[watchBackend])) {
    console.warn('[build] ⚠ 两个后端都还没有产物：watch 期间宿主将缺少 wasm')
    console.warn('[build]   先跑一次全量构建：node scripts/build.js --backend both --backend-only')
  } else {
    console.log(`[build] watch 期间复制 ${watchBackend} 后端产物（后端改动需重新全量构建）`)
  }
  const watchWasm =
    watchBackend && existsSync(BACKEND_ARTIFACT[watchBackend])
      ? BACKEND_ARTIFACT[watchBackend]
      : undefined
  startPluginWatch({
    root: ROOT,
    resourcesDir: RESOURCES_DIR,
    extraFiles: ['icon.svg'],
    wasmFile: watchWasm,
  })
} else if (frontendOnly) {
  // 先保全上一份 wasm 再让 vite 清空 outDir：仅前端构建语义 = 「wasm 保持现状」
  const keptWasm = preservePreviousWasm()
  buildFrontend()
  if (!keptWasm) {
    console.error(`[build] ERROR: 目标目录没有上一份 wasm，--frontend-only 无法保全产物：${RESOURCES_DIR}`)
    console.error('[build]   先跑一次后端构建：node scripts/build.js --backend both --backend-only')
    process.exit(1)
  }
  copyArtifacts({ wasmSource: keptWasm })
} else {
  // 后端集合：--go-only 特例（历史兼容）；否则 --backend
  const backends = goOnly ? ['go'] : resolveBackends()
  if (!backendOnly) buildFrontend()

  const built = []
  for (const backend of backends) {
    const ok = backend === 'rust' ? buildRust() : buildGo({ required: backends.length === 1 })
    console.log(
      `[build] backend ${backend}: ${ok ? '✅ 已构建' : '⚠ 跳过（沿用既有产物，未安装）'}`,
    )
    if (ok) built.push(backend)
  }

  const install = selectInstallBackend(built)
  copyArtifacts({ wasmSource: BACKEND_ARTIFACT[install], backend: install })

  // 未安装的后端物化一份完整产物目录（打包链各打一个 zip；dev 不传 --variants，不写）
  if (VARIANTS_DIR) {
    for (const backend of built) {
      if (backend === install) continue
      writeVariant({ backend })
    }
  }

  console.log('\n[build] ====== Backend summary ======')
  for (const backend of ALL_BACKENDS) {
    const path = BACKEND_ARTIFACT[backend]
    const size = artifactSize(path)
    const mark = backend === install ? '→ 已安装' : ''
    console.log(
      `[build]   ${backend.padEnd(4)} ${size ? `${(size / 1024).toFixed(0)} KiB` : '缺失'}  ${path} ${mark}`,
    )
  }
}

if (!watchMode) {
  console.log('\n[build] ====== Build complete! ======')
}

