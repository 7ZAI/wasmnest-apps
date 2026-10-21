// 平台 SDK 本地 link 的纯实现（plan / apply / revert / status）。
//
// 背景（A2 票据 / spec D11①②⑤）：
// - 默认路径 = **发布物**：npm SDK 用精确版本（`0.0.1`），Rust SDK 用
//   `version = "=0.0.1"`；应用仓不依赖平台工作树；
// - 平台仓开发者需要把 SDK / 能力仓 dev-deps 指回本地源码时，显式运行
//   `scripts/link-platform-sdk.mjs` 切换；`unlink-platform-sdk.mjs` 还原；
// - link 状态只存在于工作区（package.json 的 `file:`、`.cargo/config.toml` 的
//   `[patch]`、根 `.platform-sdk-link.json`），**不可提交**。
//
// 本文件不执行子进程：pnpm install 由 CLI 注入（`runPnpmInstalls({ spawn })`），
// 便于 node:test 在临时 fixture 上真实验证「写入 / 还原 / 幂等 / fail-visible」。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const SDK_PACKAGE_NAME = '@binblink/wasmnest-plugin-sdk-desktop'
/** 未发布 / 发布后都应保持的精确版本（与 host-runtime.lock 的 sdkVersion 同轴） */
export const SDK_EXACT_VERSION = '0.0.1'
/** 五个桌面 app（monitor 也是本票对象） */
export const DESKTOP_APPS = Object.freeze([
  'agent-hub',
  'ai-chatbox',
  'bedcode',
  'file-transfer',
  'monitor',
])
/** marker（gitignore）：记录 link 前的原始 spec，供 unlink 精确还原 */
export const MARKER_FILE_NAME = '.platform-sdk-link.json'
/** `.cargo/config.toml` 追加块的定界标记（unlink 靠它整块删除） */
export const LINK_BLOCK_BEGIN = '# >>> wasmnest-platform-sdk-link（scripts/link-platform-sdk.mjs 写入，unlink 删除） >>>'
export const LINK_BLOCK_END = '# <<< wasmnest-platform-sdk-link <<<'

/** bedcode dev-deps 里对能力仓的 git tag 依赖（逐个列出以生成本地 patch） */
export const LIB_CRATES = Object.freeze([
  'wasmnest-server-base',
  'wasmnest-server-core',
  'wasmnest-server-http',
  'wasmnest-server-websocket',
])

/** 平台仓内的桌面 SDK 包目录 */
export function sdkPackageDir(platformRoot) {
  return join(resolve(platformRoot), 'wasmnest-desktop', 'packages', 'plugin-sdk-desktop')
}

/** 根 + 五个 app 的 package.json（SDK 依赖所在文件） */
export function desktopPackageFiles(appsRoot) {
  const root = resolve(appsRoot)
  return [
    join(root, 'package.json'),
    ...DESKTOP_APPS.map((slug) => join(root, 'apps', slug, 'desktop', 'package.json')),
  ]
}

/** 五个 app 工程目录（link 后逐个 pnpm install） */
export function desktopAppDirs(appsRoot) {
  const root = resolve(appsRoot)
  return DESKTOP_APPS.map((slug) => join(root, 'apps', slug, 'desktop'))
}

/**
 * 生成本地 `file:` spec。跨平台统一 `file:<posix 相对路径>`：
 * - 相对路径锚点 = 该 package.json 所在目录（pnpm 语义）；
 * - Windows 的 `\` 一律转 `/`；不加尾斜杠。
 */
export function toFileSpec(fromDir, targetDir) {
  const rel = relative(resolve(fromDir), resolve(targetDir)).split(sep).join('/')
  return `file:${rel.startsWith('.') ? rel : `./${rel}`}`
}

/** 读 package.json 里的 SDK 依赖 spec（dependencies 优先，其次 devDependencies） */
export function readSdkSpec(packageFile) {
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
  for (const section of ['dependencies', 'devDependencies']) {
    const spec = pkg[section]?.[SDK_PACKAGE_NAME]
    if (typeof spec === 'string') return { section, spec }
  }
  throw new Error(`[link-platform-sdk] ${packageFile} 未声明 ${SDK_PACKAGE_NAME} 依赖`)
}

/**
 * 平台根解析（fail-visible）：
 *   1. `WASMNEST_PLATFORM_ROOT`（显式）；
 *   2. 主工作树的兄弟目录 `wasmnest` —— worktree 场景下应用仓根在
 *      `<main>/.worktrees/<name>`，兄弟目录必须按**主工作树**算，不能按当前 worktree 算。
 * 缺失时抛错并给出设置指引，不返回可能无效的路径。
 */
export function resolvePlatformRoot({ envRoot, mainWorktreeRoot, exists = existsSync }) {
  if (envRoot) {
    if (!exists(envRoot)) {
      throw new Error(
        `[link-platform-sdk] WASMNEST_PLATFORM_ROOT 指向的目录不存在: ${envRoot}；` +
          `请指向平台仓根（含 wasmnest-desktop/）。`,
      )
    }
    return resolve(envRoot)
  }
  const candidate = mainWorktreeRoot ? resolve(mainWorktreeRoot, '..', 'wasmnest') : null
  if (candidate && exists(candidate)) return candidate
  throw new Error(
    `[link-platform-sdk] 未找到平台仓${candidate ? `（尝试: ${candidate}）` : ''}；` +
      `请设置 WASMNEST_PLATFORM_ROOT 指向平台仓根。`,
  )
}

/**
 * 能力仓本地源码解析（可选）：bedcode 的 dev-deps 是 `wasmnest-lib` 的 git tag 依赖，
 * link 时用 `[patch."https://github.com/7ZAI/wasmnest-lib"]` 指回本地源码。
 * 顺序：`WASMNEST_LIB_ROOT` → 平台根兄弟 `wasmnest-lib` → 主工作树兄弟 `wasmnest-lib`；
 * 都没有返回 null（git tag 依赖仍可用，只是不走本地源码）。
 */
export function resolveLibRoot({ envRoot, platformRoot, mainWorktreeRoot, exists = existsSync }) {
  if (envRoot) {
    if (!exists(envRoot)) {
      throw new Error(`[link-platform-sdk] WASMNEST_LIB_ROOT 指向的目录不存在: ${envRoot}`)
    }
    return { root: resolve(envRoot), source: 'env' }
  }
  const candidates = []
  if (platformRoot) {
    candidates.push({ root: resolve(platformRoot, '..', 'wasmnest-lib'), source: 'platform-sibling' })
  }
  if (mainWorktreeRoot) {
    candidates.push({ root: resolve(mainWorktreeRoot, '..', 'wasmnest-lib'), source: 'main-sibling' })
  }
  return candidates.find((candidate) => exists(candidate.root)) ?? null
}

/** TOML 基本字符串里的路径：正斜杠 + 引号转义（Windows 盘符 / 路径含空格均不破坏语法） */
function tomlPath(pathOnDisk) {
  return pathOnDisk.split(sep).join('/').replace(/\\/g, '/').replace(/"/g, '\\"')
}

/** 生成 `.cargo/config.toml` 的 patch 块（不含首尾换行） */
export function renderLinkBlock({ sdkDir, libRoot }) {
  const lines = [
    LINK_BLOCK_BEGIN,
    '[patch.crates-io]',
    `wasmnest-plugin-api = { path = "${tomlPath(join(sdkDir, 'rust'))}" }`,
    `wasmnest-plugin-api-macros = { path = "${tomlPath(join(sdkDir, 'rust-macros'))}" }`,
  ]
  if (libRoot) {
    lines.push(
      '',
      '[patch."https://github.com/7ZAI/wasmnest-lib"]',
      ...LIB_CRATES.map((crate) => `${crate} = { path = "${tomlPath(join(libRoot, crate))}" }`),
    )
  }
  lines.push(LINK_BLOCK_END)
  return lines.join('\n')
}

/** 删除 `[patch]` 块（之前 link 写入的部分），其余内容原样保留 */
export function stripLinkBlock(text) {
  const begin = text.indexOf(LINK_BLOCK_BEGIN)
  if (begin === -1) return text
  const end = text.indexOf(LINK_BLOCK_END, begin)
  if (end === -1) {
    throw new Error(
      `[link-platform-sdk] .cargo/config.toml 的 link 块不完整（缺结束标记 ${LINK_BLOCK_END}）；` +
        `请手工修复后重试。`,
    )
  }
  if (text.slice(end + LINK_BLOCK_END.length).trim() !== '') {
    throw new Error(
      '[link-platform-sdk] .cargo/config.toml 的 link 块之后还有其他内容，无法安全还原；' +
        '请手工检查（link 块必须是文件末尾）。',
    )
  }
  // link 追加时在原文与块之间留了一个空行；还原为原文结尾的单个换行
  return text.slice(0, begin).replace(/\n\n$/, '\n')
}

/** 追加 patch 块（幂等：先删旧块再追加） */
export function appendLinkBlock(text, block) {
  const base = stripLinkBlock(text).replace(/\s+$/, '')
  return `${base}\n\n${block}\n`
}

/** 把 package.json 里 SDK 依赖的 spec 从 from 替换为 to（保留原文件格式） */
export function replaceDependencySpec(text, packageFile, from, to) {
  const key = JSON.stringify(SDK_PACKAGE_NAME)
  const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${escapeRe(key)}\\s*:\\s*)${escapeRe(JSON.stringify(from))}`)
  if (pattern.test(text)) return text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(to)}`)
  // 已经是目标值：幂等
  const already = new RegExp(`${escapeRe(key)}\\s*:\\s*${escapeRe(JSON.stringify(to))}`)
  if (already.test(text)) return text
  throw new Error(`[link-platform-sdk] ${packageFile} 的 ${SDK_PACKAGE_NAME} 依赖值不是 ${from}（也不是 ${to}）`)
}

function writeIfChanged(file, content) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  if (current === content) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return true
}

function readMarker(markerFile) {
  if (!existsSync(markerFile)) return null
  return JSON.parse(readFileSync(markerFile, 'utf8'))
}

/**
 * 生成 link 计划（只读，不写文件）。平台 SDK / 能力仓源码目录缺失时在**写入前**
 * fail-visible，保证不会留下半套 link 状态。
 */
export function createLinkPlan({ appsRoot, platformRoot, libRoot }) {
  const root = resolve(appsRoot)
  const platform = resolve(platformRoot)
  const sdkDir = sdkPackageDir(platform)
  for (const required of [join(sdkDir, 'package.json'), join(sdkDir, 'rust', 'Cargo.toml'), join(sdkDir, 'rust-macros', 'Cargo.toml')]) {
    if (!existsSync(required)) {
      throw new Error(`[link-platform-sdk] 平台 SDK 不完整，缺少 ${required}；请确认平台根正确（WASMNEST_PLATFORM_ROOT）。`)
    }
  }

  const markerFile = join(root, MARKER_FILE_NAME)
  const previousMarker = readMarker(markerFile)
  const warnings = []

  const packageEdits = desktopPackageFiles(root).map((file) => {
    const { section, spec } = readSdkSpec(file)
    // marker 存在时以它记录的原始值为准（重复 link 不把 file: 值当成原始值）
    const from = previousMarker?.files?.[file] ?? spec
    const to = toFileSpec(dirname(file), sdkDir)
    if (spec !== from && spec !== to) {
      throw new Error(
        `[link-platform-sdk] ${file} 的当前依赖值 ${spec} 既不是原始值 ${from} 也不是 link 值 ${to}；` +
          `请先手工核对（可能需要先 unlink）。`,
      )
    }
    return { file, section, from, to }
  })

  let resolvedLibRoot = null
  if (libRoot) {
    const lib = resolve(libRoot)
    for (const crate of LIB_CRATES) {
      const manifest = join(lib, crate, 'Cargo.toml')
      if (!existsSync(manifest)) {
        throw new Error(`[link-platform-sdk] 能力仓不完整，缺少 ${manifest}；请检查 WASMNEST_LIB_ROOT。`)
      }
    }
    resolvedLibRoot = lib
  } else {
    warnings.push(
      '未找到能力仓本地源码（WASMNEST_LIB_ROOT / 平台根兄弟 wasmnest-lib）：' +
        'bedcode 的 lib dev-deps 将按 git tag lib-v0.0.2 解析，不写 [patch."https://github.com/7ZAI/wasmnest-lib"]。',
    )
  }

  return {
    appsRoot: root,
    platformRoot: platform,
    libRoot: resolvedLibRoot,
    markerFile,
    cargoConfigFile: join(root, '.cargo', 'config.toml'),
    packageEdits,
    block: renderLinkBlock({ sdkDir, libRoot: resolvedLibRoot }),
    previousMarker,
    warnings,
  }
}

/**
 * 执行 link：package.json → `.cargo/config.toml` → marker（最后写）。
 * 中途失败时 marker 不存在，`--status` 会报 inconsistent 而不是假装 linked。
 * 返回写入的 marker（原始 spec 以 marker 为准，重复 link 保持不变）。
 */
export function applyLinkPlan(plan, { now = () => new Date().toISOString() } = {}) {
  for (const edit of plan.packageEdits) {
    const text = readFileSync(edit.file, 'utf8')
    writeIfChanged(edit.file, replaceDependencySpec(text, edit.file, edit.from, edit.to))
  }

  const configText = existsSync(plan.cargoConfigFile) ? readFileSync(plan.cargoConfigFile, 'utf8') : ''
  writeIfChanged(plan.cargoConfigFile, appendLinkBlock(configText, plan.block))

  const marker = {
    platformRoot: plan.platformRoot,
    linkedAt: plan.previousMarker?.linkedAt ?? now(),
    files: Object.fromEntries(plan.packageEdits.map((edit) => [edit.file, edit.from])),
  }
  if (plan.previousMarker && plan.previousMarker.platformRoot !== plan.platformRoot) {
    marker.linkedAt = now()
  }
  if (plan.libRoot) marker.libRoot = plan.libRoot

  const next = `${JSON.stringify(marker, null, 2)}\n`
  writeIfChanged(plan.markerFile, next)
  return marker
}

/**
 * 还原：按 marker 记录的原始 spec 写回；marker 缺失时把 `file:` 依赖写回精确版本。
 * 删除 `.cargo/config.toml` 的 link 块与 marker。**不执行 pnpm install**（发布版 SDK
 * 未发布时会失败，由调用方决定何时装回）。幂等：重复执行不抛错。
 */
export function revertLink({ appsRoot }) {
  const root = resolve(appsRoot)
  const markerFile = join(root, MARKER_FILE_NAME)
  const marker = readMarker(markerFile)
  const files = marker ? Object.keys(marker.files) : desktopPackageFiles(root)
  const restored = []

  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(`[link-platform-sdk] 还原失败：${file} 不存在（marker 与工作区不一致，请手工核对）`)
    }
    const { spec } = readSdkSpec(file)
    const target = marker ? marker.files[file] : spec.startsWith('file:') ? SDK_EXACT_VERSION : spec
    if (spec === target) continue
    const text = readFileSync(file, 'utf8')
    writeIfChanged(file, replaceDependencySpec(text, file, spec, target))
    restored.push(file)
  }

  const cargoConfigFile = join(root, '.cargo', 'config.toml')
  let cargoConfigRestored = false
  if (existsSync(cargoConfigFile)) {
    const text = readFileSync(cargoConfigFile, 'utf8')
    const next = stripLinkBlock(text)
    if (next !== text) {
      writeIfChanged(cargoConfigFile, next)
      cargoConfigRestored = true
    }
  }

  if (marker) rmSync(markerFile)
  return { markerExisted: Boolean(marker), restored, cargoConfigRestored }
}

/**
 * 状态：`published`（发布物）/ `linked`（marker + 依赖值 + patch 块一致）/
 * `inconsistent`（marker、依赖值、patch 任一漂移；fail-visible）。
 */
export function inspectLinkStatus({ appsRoot }) {
  const root = resolve(appsRoot)
  const marker = readMarker(join(root, MARKER_FILE_NAME))
  const cargoConfigFile = join(root, '.cargo', 'config.toml')
  const blockPresent =
    existsSync(cargoConfigFile) && readFileSync(cargoConfigFile, 'utf8').includes(LINK_BLOCK_BEGIN)
  const specs = desktopPackageFiles(root).map((file) => ({ file, spec: readSdkSpec(file).spec }))

  if (!marker) {
    const reasons = []
    for (const { file, spec } of specs) {
      if (spec !== SDK_EXACT_VERSION) reasons.push(`${file}: ${spec}（期望 ${SDK_EXACT_VERSION}）`)
    }
    if (blockPresent) reasons.push('.cargo/config.toml 仍含 link patch 块')
    return { state: reasons.length === 0 ? 'published' : 'inconsistent', marker: null, reasons }
  }

  const reasons = []
  const sdkDir = sdkPackageDir(marker.platformRoot)
  for (const { file, spec } of specs) {
    const expected = toFileSpec(dirname(file), sdkDir)
    if (spec !== expected) reasons.push(`${file}: ${spec}（marker 期望 ${expected}）`)
  }
  if (!existsSync(join(sdkDir, 'package.json'))) {
    reasons.push(`marker 指向的平台 SDK 不存在: ${sdkDir}（平台仓被移动 / 删除？）`)
  }
  if (!blockPresent) reasons.push('.cargo/config.toml 缺 link patch 块')
  return { state: reasons.length === 0 ? 'linked' : 'inconsistent', marker, reasons }
}

/**
 * 依次在给定目录执行 `pnpm install --no-frozen-lockfile`。
 * 用 argv 数组（非 shell 字符串），路径含空格不需要转义 / 引号。失败即抛错点名目录。
 */
export function runPnpmInstalls({ dirs, spawn, stdio = 'inherit' }) {
  if (typeof spawn !== 'function') {
    throw new Error('[link-platform-sdk] runPnpmInstalls 需要注入 spawn（CLI 用 node:child_process.spawnSync）')
  }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const installed = []
  for (const dir of dirs) {
    const result = spawn(pnpm, ['install', '--no-frozen-lockfile'], { cwd: dir, stdio })
    if (result.error) {
      throw new Error(`[link-platform-sdk] 无法执行 pnpm（${dir}）: ${result.error.message}`)
    }
    if (result.status !== 0) {
      throw new Error(
        `[link-platform-sdk] pnpm install 失败（${dir}，退出码 ${result.status}）；` +
          `link 状态已写入，修复后可重跑本脚本或执行 unlink-platform-sdk.mjs。`,
      )
    }
    installed.push(dir)
  }
  return installed
}
