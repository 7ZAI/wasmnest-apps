/**
 * 桌面宿主运行时 resolver —— 宿主运行时可分发化 CONTRACT §3 的应用仓唯一吃入口。
 *
 * 本模块**只解析**：不构建（不做 host:pack）、不下载（fetch 见 `scripts/fetch-host.mjs`）。
 * dev-host / e2e / e2e-dual 的桌面侧统一走这里，禁止各自再钉路径。
 *
 * 优先级链（CONTRACT §3.1）：
 *  1. 显式：`--host` > `WASMNEST_HOST_BIN` > `WASMNEST_HOST_APP`；指向不存在 ⇒ 抛错（不静默回退）；
 *  2. 本机平台仓 host:pack 产物：`<platform>/wasmnest-desktop/dist-host/host-desktop`
 *     （兼容旧落点 `dist/host-desktop`）；默认 auto 下与缓存比新旧，不旧于缓存才用；
 *     `WASMNEST_HOST_PREFER=local|cache` 可强制；
 *  3. 已下载缓存：`<cacheRoot>/<hostVersion>/<platform>-<arch>/`（须有 host-version.json 与 .complete）；
 *  4. 都没有 ⇒ 返回 null，调用方打印 `hostRuntimeMissingHint()` 并非零退出。
 *
 * 纪律：
 *  - 纯 Node 内置模块；**不 import `platform-paths.mjs`**，平台仓不在场也能工作；
 *  - 所有错误前缀 `[host-runtime]`，不吞异常、不静默降级；
 *  - 版本解析：`WASMNEST_HOST_VERSION` → `host-runtime.lock.json` → 平台 manifest → 缺失抛错。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 应用仓根：本文件在 `<appsRoot>/scripts/` 下 */
export const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// ==================== 平台 / 架构 / 缓存根 ====================

/** Node 平台名 → 资产 token（CONTRACT §1.3：win32→windows、darwin→macos） */
export function normalizePlatform(platform = process.platform) {
  switch (platform) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      throw new Error(
        `[host-runtime] 不支持的平台：${platform}（宿主运行时只发布 linux / macos / windows）`,
      )
  }
}

/** Node 架构名 → 资产 token（x64→x86_64） */
export function normalizeArch(arch = process.arch) {
  switch (arch) {
    case 'x64':
      return 'x86_64'
    case 'arm64':
      return 'arm64'
    default:
      throw new Error(`[host-runtime] 不支持的架构：${arch}（宿主运行时只发布 x86_64 / arm64）`)
  }
}

/** 当前平台的资产 / 缓存键：`{ platform, arch, key: '<platform>-<arch>' }` */
export function platformArch() {
  const platform = normalizePlatform()
  const arch = normalizeArch()
  return { platform, arch, key: `${platform}-${arch}` }
}

/**
 * 缓存根（CONTRACT §3.3）：`WASMNEST_HOST_CACHE` → 平台默认 → `os.tmpdir()/wasmnest/host`。
 * 回退到临时目录时打印警告（不静默）。
 */
export function resolveCacheRoot() {
  const override = process.env.WASMNEST_HOST_CACHE
  if (override) return resolve(override)

  const home = homedir()
  if (process.platform === 'linux') {
    const xdg = process.env.XDG_CACHE_HOME
    return join(xdg ? resolve(xdg) : join(home, '.cache'), 'wasmnest', 'host')
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Caches', 'wasmnest', 'host')
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'wasmnest', 'host')
  }

  console.warn(
    '[host-runtime] 无法确定平台缓存目录，回退到 os.tmpdir()/wasmnest/host；' +
      '可用 WASMNEST_HOST_CACHE 显式指定。',
  )
  return join(tmpdir(), 'wasmnest', 'host')
}

// ==================== 宿主产物目录读取 ====================

/** 读 `<dir>/host-version.json`；不存在返回 null，解析失败 fail-visible */
function readHostMeta(dir) {
  const metaPath = join(dir, 'host-version.json')
  if (!existsSync(metaPath)) return null
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch (e) {
    throw new Error(`[host-runtime] 解析宿主版本文件失败：${metaPath}（${e.message}）`)
  }
}

/** 是否普通文件（目录 / 符号链接目标不存在都不算） */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * 在宿主产物目录里找可执行（CONTRACT §1.1）：
 * `host-version.json.binary` 优先；缺失则按平台形态扫（windows `.exe` /
 * macOS `.app/Contents/MacOS/<name>` / linux 无扩展名或 `.AppImage`）。
 */
function findBinaryInDir(dir) {
  const meta = readHostMeta(dir)

  if (meta?.binary) {
    const hit = join(dir, meta.binary)
    if (isFile(hit)) return { bin: hit, meta }
  }

  const names = readdirSync(dir).sort()
  if (IS_WIN) {
    const exe = names.find((name) => name.endsWith('.exe') && isFile(join(dir, name)))
    return exe ? { bin: join(dir, exe), meta } : null
  }
  if (IS_MAC) {
    for (const name of names) {
      if (!name.endsWith('.app')) continue
      const hit = join(dir, name, 'Contents', 'MacOS', name.replace(/\.app$/, ''))
      if (isFile(hit)) return { bin: hit, meta }
    }
    const plain = names.find((name) => !name.includes('.') && isFile(join(dir, name)))
    return plain ? { bin: join(dir, plain), meta } : null
  }

  const exact = names.find((name) => name === 'wasmnest-desktop' && isFile(join(dir, name)))
  if (exact) return { bin: join(dir, exact), meta }
  const plain = names.find((name) => !name.includes('.') && isFile(join(dir, name)))
  if (plain) return { bin: join(dir, plain), meta }
  const appImage = names.find((name) => name.endsWith('.AppImage') && isFile(join(dir, name)))
  return appImage ? { bin: join(dir, appImage), meta } : null
}

/** 解析显式指定的宿主（文件或产物目录）；不存在 / 目录无可执行 ⇒ 抛错 */
function resolveExplicit(input) {
  if (!input) return null
  const target = resolve(input)
  if (!existsSync(target)) {
    throw new Error(
      `[host-runtime] 显式指定的宿主路径不存在：${target}\n` +
        '[host-runtime]   → 指向 host:pack 产物目录或宿主可执行文件；不要留一个失效路径。',
    )
  }
  if (statSync(target).isDirectory()) {
    const hit = findBinaryInDir(target)
    if (!hit) {
      throw new Error(
        `[host-runtime] 显式指定的宿主产物目录里找不到可执行文件：${target}\n` +
          '[host-runtime]   → 确认它是 host:pack 的 host-desktop 目录（含 wasmnest-desktop 与 host-version.json）。',
      )
    }
    return { bin: hit.bin, dir: target, meta: hit.meta, source: 'explicit' }
  }
  const dir = dirname(target)
  return { bin: target, dir, meta: readHostMeta(dir), source: 'explicit' }
}

// ==================== 平台根 / 版本 / 新旧 ====================

/** 本机 host:pack 产物落点（新落点优先，旧落点兼容读取） */
const LOCAL_HOST_SUBDIRS = [
  ['wasmnest-desktop', 'dist-host', 'host-desktop'],
  ['wasmnest-desktop', 'dist', 'host-desktop'],
]

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (e) {
    throw new Error(`[host-runtime] 解析 JSON 失败：${path}（${e.message}）`)
  }
}

/**
 * 平台仓根（只做定位，不 import `platform-paths.mjs`）：
 * `WASMNEST_PLATFORM_ROOT` → 主工作树兄弟目录 `wasmnest`（经 git 公共目录定位）。
 * 平台仓不在场是合法状态（只影响档 2 与 manifest 版本回退），不抛错。
 */
export function detectPlatformRoot({ appsRoot = APPS_ROOT } = {}) {
  const envRoot = process.env.WASMNEST_PLATFORM_ROOT
  if (envRoot) {
    const root = resolve(envRoot)
    if (!existsSync(root)) {
      console.warn(
        `[host-runtime] WASMNEST_PLATFORM_ROOT 指向的目录不存在：${root}` +
          '（将跳过本机 host:pack 产物与平台 manifest）',
      )
    }
    return root
  }

  let mainRoot = appsRoot
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: appsRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (common) mainRoot = dirname(common)
  } catch {
    // 非 git 工作树（如打包后的裸目录）：退回应用仓根，仍按 R1 兄弟布局找平台仓。
  }
  return resolve(mainRoot, '..', 'wasmnest')
}

/**
 * 宿主运行时版本（CONTRACT §3.4）：
 * `WASMNEST_HOST_VERSION` → `host-runtime.lock.json` → 平台 manifest → 缺失抛错。
 * `required=false` 仅供「本机 vs 缓存」新旧比较使用（本机命中不需要版本）。
 */
function readHostVersion({ appsRoot, platformRoot, required }) {
  const envVersion = process.env.WASMNEST_HOST_VERSION
  if (envVersion && envVersion.trim()) return envVersion.trim()

  const lockPath = join(appsRoot, 'host-runtime.lock.json')
  if (existsSync(lockPath)) {
    const lock = readJsonFile(lockPath)
    const version = lock?.hostRuntime?.version
    if (typeof version === 'string' && version.trim()) return version.trim()
    throw new Error(
      `[host-runtime] ${lockPath} 缺少 hostRuntime.version；lock 是版本唯一真源，不能留空。`,
    )
  }

  if (platformRoot) {
    const manifestPath = join(platformRoot, 'release-manifest.json')
    if (existsSync(manifestPath)) {
      const manifest = readJsonFile(manifestPath)
      const version = manifest?.hostRuntime?.version
      if (typeof version === 'string' && version.trim()) return version.trim()
    }
  }

  if (required) {
    throw new Error(
      `[host-runtime] 无法确定宿主运行时版本：未设置 WASMNEST_HOST_VERSION，` +
        `${lockPath} 与平台仓 release-manifest.json 均未提供 hostRuntime.version。\n` +
        '[host-runtime]   → 签入 host-runtime.lock.json（由平台 manifest 同步），' +
        '或用 WASMNEST_HOST_VERSION 指定版本。',
    )
  }
  return null
}

/** 宿主运行时版本（缺失 fail-visible） */
export function resolveHostVersion({ appsRoot = APPS_ROOT, platformRoot } = {}) {
  const actualPlatformRoot =
    platformRoot === undefined ? detectPlatformRoot({ appsRoot }) : platformRoot
  return readHostVersion({ appsRoot, platformRoot: actualPlatformRoot, required: true })
}

/** `WASMNEST_HOST_PREFER`：auto（默认）/ local / cache */
function hostPreference() {
  const raw = process.env.WASMNEST_HOST_PREFER
  if (!raw) return 'auto'
  const value = raw.trim().toLowerCase()
  if (value === 'auto' || value === 'local' || value === 'cache') return value
  throw new Error(
    `[host-runtime] WASMNEST_HOST_PREFER 只能是 auto / local / cache，收到：${raw}`,
  )
}

/** 产物时间：host-version.json.builtAt 优先，缺失用二进制 mtime */
function artifactTime(entry) {
  const builtAt = entry.meta?.builtAt
  if (builtAt) {
    const parsed = Date.parse(builtAt)
    if (!Number.isNaN(parsed)) return parsed
  }
  return statSync(entry.bin).mtimeMs
}

/** 本机平台仓 host:pack 产物（档 2）；不存在返回 null */
function findLocalHost(platformRoot) {
  if (!platformRoot) return null
  for (const parts of LOCAL_HOST_SUBDIRS) {
    const dir = join(platformRoot, ...parts)
    if (!existsSync(dir)) continue
    const hit = findBinaryInDir(dir)
    if (hit) return { bin: hit.bin, dir, meta: hit.meta }
  }
  return null
}

/** 已下载缓存条目（档 3）；不完整返回 null（不静默使用） */
function readCacheEntry({ cacheRoot, version, platform, arch }) {
  const dir = join(cacheRoot, version, `${platform}-${arch}`)
  if (!existsSync(dir)) return null

  const meta = readHostMeta(dir)
  if (!meta || !existsSync(join(dir, '.complete'))) return null

  const hit = findBinaryInDir(dir)
  if (!hit) {
    throw new Error(
      `[host-runtime] 宿主缓存不完整：${dir} 有 .complete 但找不到可执行文件。\n` +
        '[host-runtime]   → 删除该目录后重下：node scripts/fetch-host.mjs --force',
    )
  }
  return { bin: hit.bin, dir, meta: hit.meta ?? meta, source: 'cache' }
}

// ==================== 解析入口 ====================

/**
 * 解析宿主运行时（CONTRACT §3.5）。
 *
 * @param {object} [options]
 * @param {string} [options.explicit] `--host` 值（优先于环境变量）
 * @param {string} [options.appsRoot] 应用仓根（测试 seam；默认本文件上一级）
 * @param {string|null} [options.platformRoot] 平台仓根（`null` = 明确禁用；默认自动定位）
 * @param {string} [options.cacheRoot] 缓存根（测试 seam；默认平台缓存目录）
 * @returns {{ bin: string, dir: string, meta: object|null, source: 'explicit'|'local'|'cache' } | null}
 */
export function resolveHostRuntime({
  explicit,
  appsRoot = APPS_ROOT,
  platformRoot,
  cacheRoot = resolveCacheRoot(),
} = {}) {
  const explicitInput = explicit || process.env.WASMNEST_HOST_BIN || process.env.WASMNEST_HOST_APP
  const fromExplicit = resolveExplicit(explicitInput)
  if (fromExplicit) return fromExplicit

  const preference = hostPreference()
  const actualPlatformRoot =
    platformRoot === undefined ? detectPlatformRoot({ appsRoot }) : platformRoot

  if (preference !== 'cache') {
    const local = findLocalHost(actualPlatformRoot)
    if (local) {
      if (preference === 'local') return { ...local, source: 'local' }

      // auto：本机不旧于缓存才用，避免「刚 host:pack 的新宿主被同版本旧缓存遮住」。
      const version = readHostVersion({
        appsRoot,
        platformRoot: actualPlatformRoot,
        required: false,
      })
      if (!version) return { ...local, source: 'local' }

      const { platform, arch } = platformArch()
      const cached = readCacheEntry({ cacheRoot, version, platform, arch })
      if (!cached || artifactTime(local) >= artifactTime(cached)) {
        return { ...local, source: 'local' }
      }
    } else if (preference === 'local') {
      throw new Error(
        '[host-runtime] WASMNEST_HOST_PREFER=local，但未找到本机 host:pack 产物。\n' +
          '[host-runtime]   → 先构建：cd <平台仓>/wasmnest-desktop && pnpm run host:pack\n' +
          '[host-runtime]   → 或去掉 WASMNEST_HOST_PREFER，改用缓存：node scripts/fetch-host.mjs',
      )
    }
  }

  const version = readHostVersion({
    appsRoot,
    platformRoot: actualPlatformRoot,
    required: true,
  })
  const { platform, arch } = platformArch()
  return readCacheEntry({ cacheRoot, version, platform, arch })
}

// ==================== 版本兼容 / 缺失指引 ====================

/** 宿主壳 ↔ app 整包的三条版本轴（CONTRACT §7） */
const COMPAT_FIELDS = [
  ['sdkVersion', 'SDK 版本'],
  ['witVersion', 'WIT 版本'],
  ['mountContract', '挂载契约版本'],
]

/** 单轴不一致时的可执行指引（换哪个宿主版本 / 重编哪个 app） */
function compatMismatchMessage(field, label, got, want) {
  const lines = [
    `[host-runtime] ${field} 不匹配：宿主 ${got}，当前 app 期望 ${want}（${label}）。`,
  ]
  if (field === 'sdkVersion') {
    lines.push(
      `[host-runtime]   → 换用内嵌 SDK ${want} 的宿主版本：node scripts/fetch-host.mjs --version <host-version>`,
    )
    lines.push('[host-runtime]   → 或按当前 SDK 重建 app：pnpm run build')
  } else if (field === 'witVersion') {
    lines.push(
      `[host-runtime]   → 换用 WIT ${want} 的宿主版本：node scripts/fetch-host.mjs --version <host-version>`,
    )
    lines.push('[host-runtime]   → 或按当前 WIT 全量重建 app 产物：pnpm run build')
  } else {
    lines.push(
      `[host-runtime]   → 换用挂载契约 ${want} 的宿主版本：node scripts/fetch-host.mjs --version <host-version>`,
    )
    lines.push('[host-runtime]   → 或按当前宿主契约重建 app：pnpm run build')
  }
  return lines.join('\n')
}

/**
 * 宿主兼容检查（CONTRACT §7）：比对 `sdkVersion` / `witVersion` / `mountContract`。
 *
 * - `expected` 中提供的轴才比对（调用方可只关心其中几条）；
 * - 宿主缺字段（旧产物）同样 fail-visible，不当作匹配；
 * - 全部通过时不返回任何值，失败抛错（错误前缀 `[host-runtime]`）。
 */
export function assertHostCompatible(meta, expected = {}) {
  if (!meta || typeof meta !== 'object') {
    throw new Error(
      '[host-runtime] 宿主缺少 host-version.json，无法校验 sdkVersion / witVersion / mountContract。\n' +
        '[host-runtime]   → 换用含版本事实的新宿主产物：node scripts/fetch-host.mjs --version <host-version>\n' +
        '[host-runtime]   → 或平台仓重新打包：cd <平台仓>/wasmnest-desktop && pnpm run host:pack',
    )
  }

  for (const [field, label] of COMPAT_FIELDS) {
    const want = expected?.[field]
    if (want === undefined || want === null || want === '') continue

    const got = meta[field]
    if (got === undefined || got === null || got === '') {
      throw new Error(
        `[host-runtime] 宿主缺少 ${field} 字段（${label}；host-version.json 未提供），` +
          '旧宿主无法做分发版本校验。\n' +
          '[host-runtime]   → 换用新宿主产物：node scripts/fetch-host.mjs --version <host-version>\n' +
          '[host-runtime]   → 或平台仓重新打包：cd <平台仓>/wasmnest-desktop && pnpm run host:pack',
      )
    }
    if (String(got) !== String(want)) {
      throw new Error(compatMismatchMessage(field, label, got, want))
    }
  }
}

/**
 * 宿主缺失时的可执行指引（CONTRACT §4.3 固定形态）。
 * 版本可解析时填入 `--version`，否则留 `<host-version>` 占位（指引本身不能因缺版本而抛错）。
 */
export function hostRuntimeMissingHint({ version } = {}) {
  let resolved = version
  if (!resolved) {
    try {
      resolved = readHostVersion({
        appsRoot: APPS_ROOT,
        platformRoot: detectPlatformRoot(),
        required: false,
      })
    } catch {
      // 指引是兜底输出：lock / manifest 损坏时也要能打印三条出路。
      resolved = null
    }
  }

  return [
    '[host-runtime] 未找到桌面宿主运行时（完整前后端验证需要它）。三选一：',
    '  1) 下载已发布的宿主产物（推荐，只拿到应用仓也能用）：',
    `       node scripts/fetch-host.mjs --version ${resolved || '<host-version>'}`,
    '  2) 本机有平台仓时现场构建：',
    '       cd <平台仓>/wasmnest-desktop && pnpm run host:pack',
    '  3) 显式指定一份宿主产物目录：',
    '       pnpm run dev:host -- --host <host-desktop 目录>',
  ].join('\n')
}



