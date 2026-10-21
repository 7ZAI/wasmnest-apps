#!/usr/bin/env node

/**
 * fetch-host —— 宿主运行时下载 / 校验 / 解包（CONTRACT §4，票据 A5）
 *
 * ## 职责边界
 *
 * - **只负责把已发布的宿主资产落到本地缓存**（下载、sha256 校验、解包、原子 rename）；
 * - 解析「用哪一份宿主」是 `scripts/host-runtime.mjs` 的职责（显式 / 本机 / 缓存）；
 * - 不构建宿主（平台仓 `host:pack` 的事）、不发布、不猜版本。
 *
 * ## 缓存布局（与 resolver 共用，CONTRACT §3.3）
 *
 * ```text
 * <cache root>/<host-version>/<platform>-<arch>/
 *   <binary>              # 可执行（保留 mode 位）
 *   config.properties
 *   host-version.json
 *   .complete             # { sha256, extractedAt, source }（resolver 的完整性判据）
 * ```
 *
 * ## 用法
 *
 * ```bash
 * node scripts/fetch-host.mjs                     # 按 lock 的版本下载
 * node scripts/fetch-host.mjs --version 0.0.1
 * node scripts/fetch-host.mjs --force             # 已存在也重下
 * node scripts/fetch-host.mjs --print             # 只打印解析到的 bin（不下载）
 * node scripts/fetch-host.mjs --from <dir|tar.gz> # 本地 bootstrap / 离线替代
 * ```
 *
 * ## tar 实现
 *
 * Node 内置 `zlib` + 自实现 ustar 读取器（与平台仓 `package-host.mjs` 的写入器对称）：
 * **不依赖系统 `tar`**，跨平台行为一致；符号链接 / 硬链接 / 设备条目一律拒绝，
 * 条目路径必须相对且不得含 `..`（防路径穿越）。
 *
 * ## 失败口径（CONTRACT §4.2）
 *
 * 404 / sha 不符 / 缺可执行 / meta 不一致 / 网络不可达 → 全部显性报错并给可执行指引，
 * 失败绝不落缓存（临时目录清理，目标目录保持原状）。
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  APPS_ROOT,
  normalizeArch,
  normalizePlatform,
  platformArch,
  resolveCacheRoot,
  resolveHostRuntime,
  hostRuntimeMissingHint,
} from './host-runtime.mjs'

const DEFAULT_BASE_URL = 'https://github.com/7ZAI/wasmnest/releases/download'
const TAR_BLOCK = 512
const SHA256_RE = /^[0-9a-f]{64}$/

// ==================== lock / 版本 ====================

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (e) {
    throw new Error(`[fetch-host] 解析 JSON 失败：${path}（${e.message}）`)
  }
}

/**
 * 读应用仓 `host-runtime.lock.json`（签入的版本真源）。
 * 缺失返回 null（由调用方决定是否可接受）；存在但缺必填段 ⇒ fail-visible。
 */
export function loadHostLock({ appsRoot = APPS_ROOT } = {}) {
  const lockPath = join(appsRoot, 'host-runtime.lock.json')
  if (!existsSync(lockPath)) return null

  const lock = readJsonFile(lockPath)
  const hostRuntime = lock?.hostRuntime
  if (!hostRuntime || typeof hostRuntime !== 'object') {
    throw new Error(`[fetch-host] ${lockPath} 缺少 hostRuntime 段；lock 是宿主版本真源。`)
  }
  if (typeof hostRuntime.version !== 'string' || !hostRuntime.version.trim()) {
    throw new Error(`[fetch-host] ${lockPath} 缺少 hostRuntime.version；lock 是版本真源，不能留空。`)
  }
  if (!hostRuntime.artifacts || typeof hostRuntime.artifacts !== 'object') {
    throw new Error(
      `[fetch-host] ${lockPath} 缺少 hostRuntime.artifacts（对象）；` +
        '未发布时可为空对象，由 scripts/ci/sync-host-lock.mjs 从平台 manifest 同步。',
    )
  }
  return lock
}

/**
 * 解析要下载的宿主版本（CONTRACT §3.4 的 fetch 子集）：
 * `WASMNEST_HOST_VERSION` → lock。`--version` 由调用方作为 `explicitVersion` 传入。
 */
export function resolveFetchVersion({ appsRoot = APPS_ROOT, explicitVersion } = {}) {
  const value = explicitVersion || process.env.WASMNEST_HOST_VERSION
  if (value && String(value).trim()) return String(value).trim()

  const lock = loadHostLock({ appsRoot })
  const fromLock = lock?.hostRuntime?.version
  if (typeof fromLock === 'string' && fromLock.trim()) return fromLock.trim()

  throw new Error(
    '[fetch-host] 无法确定宿主运行时版本：未设置 WASMNEST_HOST_VERSION，' +
      `且 ${join(appsRoot, 'host-runtime.lock.json')} 不存在或缺少 hostRuntime.version。\n` +
      '[fetch-host]   → 签入 lock：node scripts/ci/sync-host-lock.mjs（平台仓在场时）\n' +
      '[fetch-host]   → 或显式指定：node scripts/fetch-host.mjs --version <host-version>',
  )
}

/** 当前平台的缓存目录 */
export function cacheDirFor({ cacheRoot, version, platform, arch }) {
  return join(cacheRoot, version, `${platform}-${arch}`)
}

/** lock 中该版本 / 平台的资产记录；未列出返回 null（调用方 fail-visible） */
function lockArtifact(lock, version, platform, arch) {
  if (!lock) return null
  if (lock.hostRuntime.version !== version) return null

  const key = `${platform}-${arch}`
  const artifact = lock.hostRuntime.artifacts?.[key]
  if (!artifact) return null
  if (!SHA256_RE.test(artifact.sha256 ?? '')) {
    throw new Error(
      `[fetch-host] lock 的 artifacts.${key}.sha256 不是 64 位小写 hex：${artifact.sha256}`,
    )
  }
  if (typeof artifact.file !== 'string' || !artifact.file.trim()) {
    throw new Error(`[fetch-host] lock 的 artifacts.${key}.file 缺失或为空。`)
  }
  return artifact
}

/** lock 缺当前平台资产时的统一报错（点名 key + 可用项 + 出路） */
function missingArtifactError({ lock, version, platform, arch }) {
  const key = `${platform}-${arch}`
  if (lock && lock.hostRuntime.version !== version) {
    return new Error(
      `[fetch-host] lock 的版本是 ${lock.hostRuntime.version}，但请求的是 ${version}：` +
        '跨版本没有可信 sha256，拒绝下载。\n' +
        '[fetch-host]   → 先同步 lock：node scripts/ci/sync-host-lock.mjs\n' +
        '[fetch-host]   → 或用 --from 指定本地 host:pack 产物',
    )
  }
  const available = Object.keys(lock?.hostRuntime?.artifacts ?? {})
  return new Error(
    `[fetch-host] lock 的 hostRuntime.artifacts 未列出当前平台 ${key} 的宿主资产` +
      `（可用：${available.length ? available.join(' / ') : '无，宿主尚未发布'}）。\n` +
      `[fetch-host]   → 平台仓发布后同步 lock：node scripts/ci/sync-host-lock.mjs\n` +
      `[fetch-host]   → 或本地 bootstrap：node scripts/fetch-host.mjs --from <host-desktop 目录|tar.gz>\n` +
      `[fetch-host]   → 或直接用本地产物起宿主：pnpm run dev:host -- --host <host-desktop 目录>`,
  )
}

// ==================== URL / 下载 ====================

/** 资产命名（CONTRACT §1.2） */
export function hostAssetNames({ version, platform, arch }) {
  const file = `host-desktop-${version}-${platform}-${arch}.tar.gz`
  return { file, sidecar: `${file}.sha256` }
}

function resolveBaseUrl(baseUrl) {
  const raw = (baseUrl || process.env.WASMNEST_HOST_BASE_URL || DEFAULT_BASE_URL).trim()
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`[fetch-host] WASMNEST_HOST_BASE_URL 不是合法 URL：${raw}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`[fetch-host] 宿主下载只允许 https：${raw}（禁止降级到 http / 本地文件）`)
  }
  return raw.replace(/\/+$/, '')
}

/** GitHub Releases 形态的资产 / 边车 URL（CONTRACT §2.1） */
export function releaseUrls({ baseUrl, version, platform, arch }) {
  const root = resolveBaseUrl(baseUrl)
  const { file, sidecar } = hostAssetNames({ version, platform, arch })
  const prefix = `${root}/host-v${version}`
  return { asset: `${prefix}/${file}`, sidecar: `${prefix}/${sidecar}` }
}

function networkError(url, error) {
  return new Error(
    `[fetch-host] 网络不可达：GET ${url}\n` +
      `[fetch-host]   ${error?.message ?? error}\n` +
      hostRuntimeMissingHint(),
  )
}

async function download(url, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, { redirect: 'follow' })
  } catch (e) {
    throw networkError(url, e)
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `[fetch-host] 宿主资产不存在（404）：${url}\n` +
          '[fetch-host]   → 该版本可能尚未发布 / 资产命名不符 CONTRACT §1.2。\n' +
          '[fetch-host]   → 用本机 host:pack 产物：pnpm run dev:host -- --host <host-desktop 目录>',
      )
    }
    throw new Error(
      `[fetch-host] 下载失败（HTTP ${res.status} ${res.statusText ?? ''}）：${url}\n` +
        hostRuntimeMissingHint(),
    )
  }
  return Buffer.from(await res.arrayBuffer())
}

/** 边车存在才返回 hex；404 视为没有边车（lock 的 sha 仍是权威） */
async function downloadSidecar(url, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, { redirect: 'follow' })
  } catch (e) {
    throw networkError(url, e)
  }
  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`[fetch-host] 下载 sha256 边车失败（HTTP ${res.status}）：${url}`)
  }
  const text = Buffer.from(await res.arrayBuffer()).toString('utf-8').trim()
  const hex = text.split(/\s+/)[0]?.toLowerCase()
  if (!SHA256_RE.test(hex ?? '')) {
    throw new Error(`[fetch-host] sha256 边车内容不合法（期望 "<hex>  <文件名>"）：${url}`)
  }
  return hex
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

// ==================== tar.gz 读取（Node zlib + ustar） ====================

function parseOctal(buf, offset, length) {
  const text = buf
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/\0.*$/, '')
    .trim()
  if (!text) return 0
  const value = Number.parseInt(text, 8)
  if (!Number.isFinite(value)) {
    throw new Error(`[fetch-host] tar 头字段不是八进制：${JSON.stringify(text)}`)
  }
  return value
}

function parsePax(data) {
  const fields = {}
  let cursor = 0
  while (cursor < data.length) {
    const space = data.indexOf(0x20, cursor)
    if (space === -1) break
    const length = Number.parseInt(data.subarray(cursor, space).toString('ascii'), 10)
    if (!Number.isFinite(length) || length <= 0 || cursor + length > data.length) break
    const record = data.subarray(space + 1, cursor + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0) fields[record.slice(0, eq)] = record.slice(eq + 1)
    cursor += length
  }
  return fields
}

/** 条目路径校验：必须相对、不得含 `..` / 绝对路径 / Windows 盘符 */
function safeTarPath(name) {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`[fetch-host] tar 条目使用绝对路径，拒绝解包（防路径穿越）：${name}`)
  }
  const parts = normalized.split('/').filter((part) => part && part !== '.')
  if (parts.includes('..')) {
    throw new Error(`[fetch-host] tar 条目包含 ..，拒绝解包（防路径穿越）：${name}`)
  }
  if (parts.length === 0) {
    throw new Error(`[fetch-host] tar 条目路径为空：${JSON.stringify(name)}`)
  }
  return parts
}

/**
 * 解包 tar.gz（扁平一层；目录 / 普通文件）。
 *
 * 安全边界：绝对路径 / `..` / 符号链接 / 硬链接 / 设备条目一律抛错；不写出任何
 * 目标目录之外的文件。失败时调用方负责清理目标目录。
 *
 * @param {Buffer} gzBuffer tar.gz 内容
 * @param {string} destDir 目标目录（不存在则创建）
 * @returns {string[]} 解包出的文件相对路径（`/` 分隔）
 */
export function extractTarGz(gzBuffer, destDir) {
  let tar
  try {
    tar = gunzipSync(gzBuffer)
  } catch (e) {
    throw new Error(`[fetch-host] 解包失败：不是有效的 tar.gz（${e.message}）`)
  }

  mkdirSync(destDir, { recursive: true })
  const written = []
  let offset = 0
  let pendingPath = null

  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK)
    if (header.every((byte) => byte === 0)) break

    const size = parseOctal(header, 124, 12)
    const mode = parseOctal(header, 100, 8)
    const type = String.fromCharCode(header[156] || 0)
    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const dataStart = offset + TAR_BLOCK
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) {
      throw new Error('[fetch-host] tar 内容被截断（条目声明的 size 超出文件长度）')
    }
    const data = tar.subarray(dataStart, dataEnd)

    // pax 扩展头：只采纳 path（GNU long name 同理），其它字段忽略。
    if (type === 'x') {
      pendingPath = parsePax(data).path ?? pendingPath
      offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
      continue
    }
    if (type === 'L') {
      pendingPath = data.toString('utf8').replace(/\0.*$/, '')
      offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
      continue
    }
    if (type === 'g' || type === 'K') {
      // 全局 pax / 长链接名：与宿主产物无关，跳过。
      offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
      continue
    }

    const rawName = pendingPath ?? (prefix ? `${prefix}/${nameField}` : nameField)
    pendingPath = null
    const parts = safeTarPath(rawName)
    const rel = parts.join('/')
    const target = resolve(destDir, ...parts)
    const root = resolve(destDir)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`[fetch-host] tar 条目逃出目标目录，拒绝解包：${rawName}`)
    }

    if (type === '5') {
      mkdirSync(target, { recursive: true })
      offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
      continue
    }
    if (type === '1' || type === '2') {
      throw new Error(
        `[fetch-host] tar 含符号链接/硬链接条目，拒绝解包（防逃逸）：${rawName} -> ` +
          header.subarray(157, 257).toString('utf8').replace(/\0.*$/, ''),
      )
    }
    if (type !== '0' && type !== '\0') {
      throw new Error(`[fetch-host] tar 含不支持的条目类型（typeflag=${JSON.stringify(type)}）：${rawName}`)
    }

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    chmodSync(target, (mode & 0o777) || 0o644)
    written.push(rel)

    offset = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }

  return written
}

// ==================== 产物校验 / 缓存提交 ====================

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readMeta(dir) {
  const metaPath = join(dir, 'host-version.json')
  if (!existsSync(metaPath)) return null
  return readJsonFile(metaPath)
}

function findBinary(dir, meta) {
  if (meta?.binary) {
    const hit = join(dir, meta.binary)
    if (isFile(hit)) return hit
  }
  const names = readdirSync(dir).sort()
  if (process.platform === 'win32') {
    const exe = names.find((name) => name.endsWith('.exe') && isFile(join(dir, name)))
    return exe ? join(dir, exe) : null
  }
  const exact = names.find((name) => name === 'wasmnest-desktop' && isFile(join(dir, name)))
  if (exact) return join(dir, exact)
  const plain = names.find((name) => !name.includes('.') && isFile(join(dir, name)))
  if (plain) return join(dir, plain)
  const appImage = names.find((name) => name.endsWith('.AppImage') && isFile(join(dir, name)))
  return appImage ? join(dir, appImage) : null
}

/**
 * 校验解包 / 复制后的宿主产物（CONTRACT §1.1 / §1.3）：
 * 必须有 host-version.json，且 hostVersion / platform / arch 与请求一致；必须找得到可执行。
 */
function validateHostDir(dir, expected) {
  const meta = readMeta(dir)
  if (!meta) {
    throw new Error(
      `[fetch-host] 宿主产物缺少 host-version.json：${dir}\n` +
        '[fetch-host]   → tar.gz 内容必须扁平一层（CONTRACT §1.2），不能有外层目录。',
    )
  }
  for (const field of ['hostVersion', 'platform', 'arch']) {
    if (String(meta[field] ?? '') !== String(expected[field])) {
      throw new Error(
        `[fetch-host] 解包后的 host-version.json 与请求不一致：${field} 期望 ` +
          `${expected[field]}，实际 ${meta[field] ?? '（缺失）'}（${dir}）。`,
      )
    }
  }
  const bin = findBinary(dir, meta)
  if (!bin) {
    throw new Error(
      `[fetch-host] 宿主产物里找不到可执行文件：${dir}\n` +
        '[fetch-host]   → 产物形态不符合 CONTRACT §1.1（二进制 + config.properties + host-version.json）。',
    )
  }
  return { meta, bin: basename(bin) }
}

/** 目录内容指纹（--from 目录没有发布 sha，用内容树哈希记进 .complete） */
function treeSha256(dir) {
  const hash = createHash('sha256')
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === '.complete') continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        hash.update(`d:${rel}\0`)
        walk(full, rel)
      } else if (entry.isFile()) {
        hash.update(`f:${rel}\0`)
        hash.update(readFileSync(full))
        hash.update('\0')
      }
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}

function writeComplete(dir, { sha, source }) {
  const complete = {
    sha256: sha,
    extractedAt: new Date().toISOString(),
    source,
  }
  writeFileSync(join(dir, '.complete'), JSON.stringify(complete, null, 2) + '\n')
}

/**
 * 原子提交缓存：临时目录完整后 rename 到 `<cache>/<version>/<platform>-<arch>/`。
 * 已存在旧目录时先挪到备份名，新目录就位后再删备份；失败恢复旧目录。
 */
function commitCache(tmpDir, targetDir) {
  mkdirSync(dirname(targetDir), { recursive: true })
  if (!existsSync(targetDir)) {
    renameSync(tmpDir, targetDir)
    return
  }

  const backup = `${targetDir}.old-${process.pid}-${Date.now()}`
  renameSync(targetDir, backup)
  try {
    renameSync(tmpDir, targetDir)
  } catch (e) {
    renameSync(backup, targetDir)
    throw e
  }
  rmSync(backup, { recursive: true, force: true })
}

/** 已有且完整的缓存条目（resolver 的 `.complete` 判据） */
function readCacheHit({ cacheRoot, version, platform, arch }) {
  const dir = cacheDirFor({ cacheRoot, version, platform, arch })
  if (!existsSync(dir) || !existsSync(join(dir, '.complete'))) return null
  const meta = readMeta(dir)
  if (!meta) return null
  const bin = findBinary(dir, meta)
  if (!bin) {
    throw new Error(
      `[fetch-host] 宿主缓存不完整：${dir} 有 .complete 但找不到可执行文件。\n` +
        '[fetch-host]   → 删除该目录后重下：node scripts/fetch-host.mjs --force',
    )
  }
  return { bin, dir, meta, source: 'cache' }
}

function makeTempDir(cacheRoot) {
  mkdirSync(cacheRoot, { recursive: true })
  return mkdtempSync(join(cacheRoot, '.tmp-'))
}

// ==================== 安装入口 ====================

/**
 * 从本地目录安装（`--from <dir>`）：复制 → 校验 meta → `.complete` → 原子 rename。
 */
export async function installHostFromDir({
  fromDir,
  version,
  appsRoot = APPS_ROOT,
  cacheRoot = resolveCacheRoot(),
  platform,
  arch,
} = {}) {
  platform = platform ?? normalizePlatform()
  arch = arch ?? normalizeArch()
  version = version || resolveFetchVersion({ appsRoot })

  const sourceDir = resolve(fromDir)
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`[fetch-host] --from 目录不存在：${sourceDir}`)
  }

  const targetDir = cacheDirFor({ cacheRoot, version, platform, arch })
  const tmpDir = makeTempDir(cacheRoot)
  try {
    for (const name of readdirSync(sourceDir)) {
      const from = join(sourceDir, name)
      const to = join(tmpDir, name)
      if (statSync(from).isDirectory()) {
        mkdirSync(to, { recursive: true })
        for (const child of readdirSync(from)) copyFileSync(join(from, child), join(to, child))
      } else {
        copyFileSync(from, to)
        chmodSync(to, statSync(from).mode & 0o777)
      }
    }

    const { meta, bin } = validateHostDir(tmpDir, { hostVersion: version, platform, arch })
    const sha = treeSha256(tmpDir)
    writeComplete(tmpDir, { sha, source: 'from-dir' })
    commitCache(tmpDir, targetDir)
    return { bin: join(targetDir, bin), dir: targetDir, meta, source: 'from-dir' }
  } catch (e) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw e
  }
}

/**
 * 从本地 tar.gz 安装（`--from <tar.gz>`）：走与下载相同的解包 + meta 校验链。
 * lock 有该平台资产时校验发布 sha；没有则打印「未校验发布 sha」警告（不静默）。
 */
export async function installHostFromTarball({
  fromPath,
  version,
  appsRoot = APPS_ROOT,
  cacheRoot = resolveCacheRoot(),
  platform,
  arch,
} = {}) {
  platform = platform ?? normalizePlatform()
  arch = arch ?? normalizeArch()
  version = version || resolveFetchVersion({ appsRoot })

  const sourcePath = resolve(fromPath)
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`[fetch-host] --from tar.gz 不存在：${sourcePath}`)
  }
  const buffer = readFileSync(sourcePath)
  const actualSha = sha256(buffer)

  const lock = loadHostLock({ appsRoot })
  const artifact = lockArtifact(lock, version, platform, arch)
  if (artifact) {
    if (artifact.sha256 !== actualSha) {
      throw new Error(
        `[fetch-host] --from tar.gz 的 sha256 与 lock 不一致：期望 ${artifact.sha256}，实际 ${actualSha}\n` +
          '[fetch-host]   → 该文件不是 lock 记录的发布资产；本地构建请用 --from <host-desktop 目录>。',
      )
    }
  } else {
    console.warn(
      `[fetch-host] 未校验发布 sha：lock 未列出 ${version} 的 ${platform}-${arch} 资产（--from 本地 bootstrap）。`,
    )
  }

  const targetDir = cacheDirFor({ cacheRoot, version, platform, arch })
  const tmpDir = makeTempDir(cacheRoot)
  try {
    extractTarGz(buffer, tmpDir)
    const { meta, bin } = validateHostDir(tmpDir, { hostVersion: version, platform, arch })
    writeComplete(tmpDir, { sha: actualSha, source: 'from-tar' })
    commitCache(tmpDir, targetDir)
    return { bin: join(targetDir, bin), dir: targetDir, meta, source: 'from-tar' }
  } catch (e) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw e
  }
}

/**
 * 下载并安装宿主运行时（CONTRACT §4；`fetchHostRuntime({ version, force })`）。
 *
 * 默认从 lock 取版本与权威 sha256；`--force` 忽略已有缓存。缓存完整时直接复用
 * （不发任何网络请求）。任何失败都清理临时目录，不产生半套缓存。
 *
 * @returns {Promise<{bin: string, dir: string, meta: object, source: 'cache'}>}
 */
export async function fetchHostRuntime({
  version,
  force = false,
  appsRoot = APPS_ROOT,
  cacheRoot = resolveCacheRoot(),
  platform,
  arch,
  fetchImpl = globalThis.fetch,
  baseUrl,
} = {}) {
  platform = platform ?? normalizePlatform()
  arch = arch ?? normalizeArch()
  version = version || resolveFetchVersion({ appsRoot })

  if (!force) {
    const cached = readCacheHit({ cacheRoot, version, platform, arch })
    if (cached) return cached
  }

  const lock = loadHostLock({ appsRoot })
  const artifact = lockArtifact(lock, version, platform, arch)
  if (!artifact) throw missingArtifactError({ lock, version, platform, arch })
  if (typeof fetchImpl !== 'function') {
    throw new Error('[fetch-host] 当前 Node 没有可用的 fetch；请用 Node >= 18 运行本脚本。')
  }

  const urls = releaseUrls({ baseUrl, version, platform, arch })
  const sidecarSha = await downloadSidecar(urls.sidecar, fetchImpl)
  if (sidecarSha && sidecarSha !== artifact.sha256) {
    throw new Error(
      `[fetch-host] 边车 sha256 与 lock 不一致：lock ${artifact.sha256}，边车 ${sidecarSha}\n` +
        '[fetch-host]   → lock 是权威；发布资产的边车被污染 / lock 未同步，均拒绝下载。',
    )
  }

  const buffer = await download(urls.asset, fetchImpl)
  const actualSha = sha256(buffer)
  if (actualSha !== artifact.sha256) {
    throw new Error(
      `[fetch-host] 下载内容 sha256 不匹配：期望 lock 的 ${artifact.sha256}，实际 ${actualSha}\n` +
        '[fetch-host]   → 中止下载（不落缓存）。检查发布资产或重新同步 lock。',
    )
  }

  const targetDir = cacheDirFor({ cacheRoot, version, platform, arch })
  const tmpDir = makeTempDir(cacheRoot)
  try {
    extractTarGz(buffer, tmpDir)
    const { meta, bin } = validateHostDir(tmpDir, { hostVersion: version, platform, arch })
    writeComplete(tmpDir, { sha: actualSha, source: 'release' })
    commitCache(tmpDir, targetDir)
    return { bin: join(targetDir, bin), dir: targetDir, meta, source: 'cache' }
  } catch (e) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw e
  }
}

// ==================== CLI ====================

const USAGE = `用法：node scripts/fetch-host.mjs [选项]

  --version <v>    指定宿主运行时版本（默认 WASMNEST_HOST_VERSION → host-runtime.lock.json）
  --force          已存在完整缓存也重新下载
  --print          只打印解析到的宿主可执行路径（不下载）
  --from <path>    从本地 host-desktop 目录或 tar.gz 安装（离线 bootstrap）
  -h, --help       显示本帮助

环境变量：WASMNEST_HOST_CACHE / WASMNEST_HOST_BASE_URL（必须 https）/ WASMNEST_HOST_VERSION`

function parseArgs(argv) {
  const options = { force: false, print: false, from: null, version: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') options.force = true
    else if (arg === '--print') options.print = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--version' || arg === '--from') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`[fetch-host] ${arg} 需要一个值。`)
      }
      options[arg === '--version' ? 'version' : 'from'] = value
      i += 1
    } else {
      throw new Error(`[fetch-host] 未知参数：${arg}\n${USAGE}`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  if (options.print) {
    const resolved = resolveHostRuntime()
    if (!resolved) {
      console.error(hostRuntimeMissingHint())
      process.exitCode = 1
      return
    }
    console.log(resolved.bin)
    return
  }

  const from = options.from ? resolve(options.from) : null
  if (from && !existsSync(from)) {
    throw new Error(`[fetch-host] --from 路径不存在：${from}`)
  }

  const result = from
    ? statSync(from).isDirectory()
      ? await installHostFromDir({ fromDir: from, version: options.version })
      : await installHostFromTarball({ fromPath: from, version: options.version })
    : await fetchHostRuntime({ version: options.version, force: options.force })

  console.log(
    `[fetch-host] 宿主就绪：${result.dir}（source=${result.source}，` +
      `hostVersion=${result.meta?.hostVersion ?? '未知'}）`,
  )
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
}
