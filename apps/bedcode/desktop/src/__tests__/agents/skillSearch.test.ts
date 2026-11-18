/**
 * Skills 搜索纯函数契约（本地过滤 / 联网结果可信度）
 *
 * 判据真源 = pi `find-skills` skill：搜索命中不等于该装——安装量与来源决定
 * 可信度呈现。这些函数是组件的判定面，单测锁住「多词 AND」「档位边界」
 * 「安装命令形态」三件事，避免 UI 里散落魔法数字。
 */
import { describe, it, expect } from 'vitest'
import {
  LOW_TRUST_INSTALLS,
  TRUSTED_INSTALLS,
  filterLocalSkills,
  installCommand,
  isOfficialSource,
  searchTerms,
  trustTier,
} from '../../agents/utils/skillSearch'
import type { SkillEntry, SkillSearchHit } from '../../agents/types'

function entry(over: Partial<SkillEntry> = {}): SkillEntry {
  return {
    dir: 'code-review',
    path: '/home/u/.agents/skills/code-review',
    name: 'code-review',
    description: 'Review a diff against repo standards',
    allowedTools: null,
    files: [],
    hash: 'h',
    error: null,
    distribution: {},
    ...over,
  }
}

function hit(over: Partial<SkillSearchHit> = {}): SkillSearchHit {
  return {
    id: 'vercel-labs/agent-skills/vercel-react-best-practices',
    name: 'vercel-react-best-practices',
    source: 'vercel-labs/agent-skills',
    skillId: 'vercel-react-best-practices',
    installs: 893_012,
    install: 'vercel-labs/agent-skills@vercel-react-best-practices',
    url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
    ...over,
  }
}

describe('searchTerms', () => {
  it('空白折叠成词列表，空查询给空列表', () => {
    expect(searchTerms('  react   perf ')).toEqual(['react', 'perf'])
    expect(searchTerms('   ')).toEqual([])
  })
})

describe('filterLocalSkills', () => {
  it('空查询原样返回（本地模式默认全量）', () => {
    const skills = [entry(), entry({ dir: 'changelog', name: 'changelog' })]
    expect(filterLocalSkills(skills, '')).toHaveLength(2)
  })

  it('多词 AND：只命中全部词都在名称 / 描述 / 目录里的 skill', () => {
    const skills = [
      entry({ dir: 'react-review', name: 'react-review', description: 'PR review helper' }),
      entry({ dir: 'react-perf', name: 'react-perf', description: 'performance rules' }),
    ]
    expect(filterLocalSkills(skills, 'react').map((s) => s.dir)).toEqual(['react-review', 'react-perf'])
    expect(filterLocalSkills(skills, 'react review').map((s) => s.dir)).toEqual(['react-review'])
    expect(filterLocalSkills(skills, 'react changelog')).toHaveLength(0)
  })

  it('大小写不敏感（用户不会记得 frontmatter 的大小写）', () => {
    const skills = [entry({ description: 'Frontend Design System' })]
    expect(filterLocalSkills(skills, 'frontend design')).toHaveLength(1)
    expect(filterLocalSkills(skills, 'FRONTEND')).toHaveLength(1)
  })

  it('描述为 null 不炸（未写 frontmatter 的 skill）', () => {
    const skills = [entry({ description: null })]
    expect(filterLocalSkills(skills, 'code-review')).toHaveLength(1)
  })
})

describe('trustTier', () => {
  it('档位边界：<100 低、100–999 中、≥1000 高', () => {
    expect(trustTier(0)).toBe('low')
    expect(trustTier(LOW_TRUST_INSTALLS - 1)).toBe('low')
    expect(trustTier(LOW_TRUST_INSTALLS)).toBe('mid')
    expect(trustTier(TRUSTED_INSTALLS - 1)).toBe('mid')
    expect(trustTier(TRUSTED_INSTALLS)).toBe('high')
    expect(trustTier(Number.NaN)).toBe('low')
  })
})

describe('isOfficialSource', () => {
  it('owner 段命中官方名单才为真（不接受子串匹配）', () => {
    expect(isOfficialSource('vercel-labs/agent-skills')).toBe(true)
    expect(isOfficialSource('Anthropics/skills')).toBe(true)
    expect(isOfficialSource('microsoft/skills')).toBe(true)
    expect(isOfficialSource('not-vercel-labs/skills')).toBe(false)
    expect(isOfficialSource('someone/vercel-labs')).toBe(false)
  })
})

describe('installCommand', () => {
  it('给出 find-skills 同形态的 npx 命令（source@skillId）', () => {
    expect(installCommand(hit())).toBe(
      'npx skills add vercel-labs/agent-skills@vercel-react-best-practices',
    )
  })
})
