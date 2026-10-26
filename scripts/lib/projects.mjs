/**
 * 仓内工程枚举 resolver —— **唯一枚举点**（issue #6 D1）
 *
 * 拓扑：应用仓根下两个**平级**分组，结构完全一致
 *
 * ```
 * <appsRoot>/apps/<slug>/{desktop,mobile}      # 产品应用（L3）
 * <appsRoot>/servers/<slug>/{desktop,mobile}   # 服务型 wasm（L1 基础服务 / L2 内部业务）
 * ```
 *
 * 为什么需要它：`run-apps` / `package-plugins` / `ci/app-info` / `ci/build-app` /
 * `ci/set-app-version` / `e2e` staging 曾各自 `join(root, 'apps')`，新增分组时
 * 漏改一处就是「产物不生成 / 产品不装配 / 清单红」（agent-hub 曾因漏注册表长期
 * 停在旧构建）。本文件是**唯一**允许拼 `apps` / `servers` 字面量的地方。
 *
 * 口径（fail-visible）：
 * - 分组不存在时返回空集合而不是抛错——`servers/` 允许暂空；
 * - **slug 跨分组重名直接抛错**：`--app <slug>` 这类调用方按 slug 定位，重名意味着
 *   定位歧义，必须显性失败而不是「先到先得」；需要精确定位时用 `group:slug` 形式；
 * - `_` / `.` 前缀目录一律忽略（与各脚本既有口径一致：草稿 / 隐藏目录不参与构建）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 应用仓根（本文件在 `<appsRoot>/scripts/lib/`） */
export const APPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 工程分组（与仓根平级；顺序 = 枚举顺序，输出稳定） */
export const PROJECT_GROUPS = ['apps', 'servers']

/** 工程端（一个分组内一个 slug 可以有多个端） */
export const PROJECT_ENDS = ['desktop', 'mobile']

/** slug 形态：目录名同时是 `--app` 取值，只允许小写字母 / 数字 / 连字符 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** 分组目录（不校验存在性） */
export function groupDir(group, root = APPS_ROOT) {
  assertGroup(group)
  return join(root, group)
}

/** 工程目录（不校验存在性）：`<root>/<group>/<slug>/<end>` */
export function projectDir(group, slug, end, root = APPS_ROOT) {
  assertGroup(group)
  assertSlug(slug)
  assertEnd(end)
  return join(root, group, slug, end)
}

/** slug 根目录（不校验存在性）：`<root>/<group>/<slug>`（含全部端） */
export function slugDir(group, slug, root = APPS_ROOT) {
  assertGroup(group)
  assertSlug(slug)
  return join(root, group, slug)
}

function assertGroup(group) {
  if (!PROJECT_GROUPS.includes(group)) {
    throw new Error(
      `[projects] 非法分组 ${JSON.stringify(group)}（允许 ${PROJECT_GROUPS.join(' / ')}）`,
    )
  }
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(
      `[projects] 非法 slug ${JSON.stringify(slug)}（只允许小写字母 / 数字 / 连字符）`,
    )
  }
}

function assertEnd(end) {
  if (!PROJECT_ENDS.includes(end)) {
    throw new Error(`[projects] 非法端 ${JSON.stringify(end)}（允许 ${PROJECT_ENDS.join(' / ')}）`)
  }
}

/** 分组内的 slug 目录名（存在即算，不要求有端；忽略 `_` / `.` 前缀与非目录） */
export function listSlugsInGroup(group, root = APPS_ROOT) {
  const dir = groupDir(group, root)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort()
}

/**
 * 全部工程目录。
 *
 * @param {object} [options]
 * @param {string} [options.root] 应用仓根（测试注入临时目录用）
 * @param {string[]} [options.groups] 限定分组（默认全部分组）
 * @param {string[]} [options.ends] 限定端（默认 desktop + mobile）
 * @param {boolean} [options.requireManifest] 只返回含 `plugin.json` 的端
 * @param {boolean} [options.requirePackage] 只返回含 `package.json` 的端
 * @returns {Array<{group: string, slug: string, end: string, dir: string, rel: string}>}
 *          按 `group`（枚举顺序）→ `slug` → `end` 排序
 */
export function listProjects(options = {}) {
  const {
    root = APPS_ROOT,
    groups = PROJECT_GROUPS,
    ends = PROJECT_ENDS,
    requireManifest = false,
    requirePackage = false,
  } = options
  for (const g of groups) assertGroup(g)
  for (const e of ends) assertEnd(e)

  const out = []
  for (const group of PROJECT_GROUPS) {
    if (!groups.includes(group)) continue
    for (const slug of listSlugsInGroup(group, root)) {
      for (const end of PROJECT_ENDS) {
        if (!ends.includes(end)) continue
        const dir = join(root, group, slug, end)
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
        if (requireManifest && !existsSync(join(dir, 'plugin.json'))) continue
        if (requirePackage && !existsSync(join(dir, 'package.json'))) continue
        out.push({ group, slug, end, dir, rel: `${group}/${slug}/${end}` })
      }
    }
  }
  return out
}

/**
 * 全部 slug（**跨分组去重 + 歧义检查**），顺序 = 分组枚举顺序 → slug 字典序。
 *
 * @param {object} [options] 同 `listProjects` 的 `root` / `groups`
 * @returns {string[]}
 * @throws slug 在多个分组重名时抛错（按 slug 定位的调用方会拿错工程）
 */
export function listSlugs(options = {}) {
  const { root = APPS_ROOT, groups = PROJECT_GROUPS } = options
  const seen = new Map()
  const slugs = []
  for (const project of listProjects({ root, groups, requireManifest: true })) {
    const prev = seen.get(project.slug)
    if (prev && prev !== project.group) {
      throw new Error(
        `[projects] slug 跨分组重名: ${project.slug}（${prev} / ${project.group}）。` +
          `按 slug 定位会有歧义——改目录名，或用 group:slug 形式精确指定。`,
      )
    }
    if (prev) continue
    seen.set(project.slug, project.group)
    slugs.push(project.slug)
  }
  return slugs
}

/**
 * 解析 `slug` 或 `group:slug` 定位到分组。
 *
 * @param {string} spec 调用方传入的取值（`auth-center` / `servers:auth-center`）
 * @param {object} [options] 同 `listProjects` 的 `root` / `groups`
 * @returns {{group: string, slug: string} | null} 未找到返回 null（由调用方决定报错文案）
 */
export function locate(spec, options = {}) {
  const { root = APPS_ROOT, groups = PROJECT_GROUPS } = options
  if (typeof spec !== 'string' || !spec) return null

  const sep = spec.indexOf(':')
  if (sep > 0) {
    const group = spec.slice(0, sep)
    const slug = spec.slice(sep + 1)
    if (!PROJECT_GROUPS.includes(group) || !SLUG_RE.test(slug)) return null
    if (!groups.includes(group)) return null
    const has = listProjects({ root, groups: [group], requireManifest: true }).some(
      (p) => p.slug === slug,
    )
    return has ? { group, slug } : null
  }

  if (!SLUG_RE.test(spec)) return null
  let hit = null
  for (const group of PROJECT_GROUPS) {
    if (!groups.includes(group)) continue
    const has = listProjects({ root, groups: [group], requireManifest: true }).some(
      (p) => p.slug === spec,
    )
    if (!has) continue
    if (hit) {
      throw new Error(
        `[projects] slug 跨分组重名: ${spec}（${hit.group} / ${group}）。` +
          `用 ${hit.group}:${spec} 或 ${group}:${spec} 精确指定。`,
      )
    }
    hit = { group, slug: spec }
  }
  return hit
}

/**
 * 定位并要求工程目录存在。
 *
 * @param {string} group 分组
 * @param {string} slug slug
 * @param {string} [end] 端（省略 = 不校验端目录）
 * @param {object} [options] 同 `listProjects` 的 `root`
 * @returns {string} 工程目录绝对路径
 * @throws 目录不存在（点名可用工程清单）
 */
export function requireProjectDir(group, slug, end, options = {}) {
  const { root = APPS_ROOT } = options
  const dir = end ? projectDir(group, slug, end, root) : join(root, group, slug)
  if (!existsSync(dir)) {
    const available = listProjects({ root }).map((p) => `${p.group}:${p.slug}/${p.end}`)
    throw new Error(
      `[projects] 工程目录不存在: ${dir}\n  可用工程: ${available.join(' / ') || '（无）'}`,
    )
  }
  return dir
}

/** 相对应用仓根的 POSIX 路径（日志 / 元数据用，跨平台稳定） */
export function relFromRoot(path, root = APPS_ROOT) {
  return resolve(path).slice(root.length + 1).split('\\').join('/')
}
