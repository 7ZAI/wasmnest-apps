/**
 * Skills 搜索的纯函数（本地过滤 / 联网结果可信度）
 *
 * 判据真源 = pi `find-skills` skill（`~/.agents/skills/find-skills/SKILL.md`）：
 * 搜索走 skills.sh，**不能只看搜索名次**——安装量 ≥1K 才优先推荐、<100 要谨慎、
 * 官方来源（vercel-labs / anthropics / microsoft）更可信。这里只做判定，
 * 不拼结论文案；结论由 i18n 在组件里给。
 */
import type { SkillEntry, SkillSearchHit } from '../types'

/** find-skills 点名的官方来源（GitHub owner 段） */
export const OFFICIAL_SKILL_OWNERS = ['vercel-labs', 'anthropics', 'microsoft'] as const

/** 高信任安装量门槛（find-skills：1K+ 优先） */
export const TRUSTED_INSTALLS = 1000
/** 低信任安装量门槛（find-skills：<100 谨慎） */
export const LOW_TRUST_INSTALLS = 100

/** 查询拆词（空白折叠；空查询 → 空数组） */
export function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean)
}

/**
 * 本地过滤：每个词都要命中（名称 / 描述 / 目录路径，大小写不敏感）。
 * 多词按 AND 处理——「react testing」不该把只沾一个词的 skill 也算命中。
 */
export function filterLocalSkills(entries: SkillEntry[], query: string): SkillEntry[] {
  const terms = searchTerms(query).map((t) => t.toLowerCase())
  if (terms.length === 0) return entries
  return entries.filter((entry) => {
    // 不含 entry.path：路径 = 规范库根 + dir，词项会意外命中 `skills` / `.agents`
    // 这类每行都有的公共段（搜「agents」会命中全部，等于没筛）
    const haystack = [entry.name, entry.description ?? '', entry.dir].join('\n').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

/** 安装量信任档（高 / 中 / 低）：驱动结果行的可信度标签 */
export function trustTier(installs: number): 'high' | 'mid' | 'low' {
  if (!Number.isFinite(installs) || installs < LOW_TRUST_INSTALLS) return 'low'
  return installs >= TRUSTED_INSTALLS ? 'high' : 'mid'
}

/** 来源 owner 是否属 find-skills 点名的官方来源 */
export function isOfficialSource(source: string): boolean {
  const owner = source.split('/')[0]?.toLowerCase() ?? ''
  return (OFFICIAL_SKILL_OWNERS as readonly string[]).includes(owner)
}

/** `npx skills add` 安装命令（find-skills 给出的「用户可自行执行」形态） */
export function installCommand(hit: SkillSearchHit): string {
  return `npx skills add ${hit.source}@${hit.skillId}`
}
