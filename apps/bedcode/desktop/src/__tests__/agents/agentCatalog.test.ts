/**
 * Agent 清单契约（issue #4 / P4）：注册表 → 前端列表数据驱动
 *
 * 覆盖：
 * - `list-agents` 载荷校验（未知 id 保留、重复去除、坏形状整体回退）
 * - 调用失败 = 内置注册表回退 + 可见降级标记（不渲染空列表）
 * - 概览/安装/统计/Skills/供应商列表由清单派生（合成第五个 agent 验证）
 * - 未知 agent 的图标回退（通用占位，不白屏）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { AgentDescriptor, ProvidersDomainState } from '../../agents/types'
import type { UseProvidersReturn } from '../../agents/composables/useProviders'
import type { UseSkillsReturn } from '../../agents/composables/useSkills'
import type { UseUsageReturn } from '../../agents/composables/useUsage'
import type { CliSessionState, StatsDays } from '../../agents/composables/useUsage'
import {
  BUILTIN_AGENTS,
  BUILTIN_CLI_IDS,
  GENERIC_AGENT_GLYPH,
  agentGlyph,
  builtinAgentName,
  preferredProviderTarget,
} from '../../agents/registry'
import {
  fallbackAgents,
  parseAgentList,
  useAgentCatalog,
} from '../../agents/composables/useAgentCatalog'
import OverviewTab from '../../agents/components/OverviewTab.vue'
import InstallTab from '../../agents/components/InstallTab.vue'
import SkillsTab from '../../agents/components/SkillsTab.vue'
import StatsTab from '../../agents/components/StatsTab.vue'
import ProviderApply from '../../agents/components/ProviderApply.vue'
import AgentHubView from '../../agents/components/AgentHubView.vue'
import CliIcon from '../../agents/components/CliIcon.vue'
import type { ProviderPreset } from '../../agents/types'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// ==================== 上下文/挂载桩 ====================

const execute = vi.fn(
  async (_command: string, _args?: Record<string, unknown>): Promise<Record<string, unknown> | null> => null,
)

function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: {
      t: (k: string, params?: Record<string, unknown>) =>
        params && Object.keys(params).length > 0
          ? `${k}(${Object.entries(params).map(([pk, pv]) => `${pk}=${String(pv)}`).join(',')})`
          : k,
      getI18n: () => ({ global: { t: (k: string) => k } }),
    },
    commands: { execute },
    events: { on: () => ({ dispose: () => {} }) },
  } as unknown as PluginContext
}

function mountComponent(component: unknown, props: Record<string, unknown> = {}) {
  return mount(component as never, {
    props,
    global: { provide: { pluginContext: makeContext() }, stubs: { teleport: true } },
  } as never)
}

/** 合成第五个 agent（数据驱动验证：列表必须来自清单而不是四条硬编码） */
const FIFTH: AgentDescriptor = {
  id: 'zeta',
  displayName: 'Zeta CLI',
  capabilities: { install: true, provider: true, skills: true, usage: true },
}
const CATALOG: AgentDescriptor[] = [...fallbackAgents(), FIFTH]

const byCli = ['claude', 'codex', 'opencode', 'pi', 'zeta'].map((adapter) => ({
  adapter,
  sessions: 1,
  tokens_in: 10,
  tokens_out: 5,
  tokens_cache_read: 0,
  tokens_cache_write: 0,
  tokens_reasoning: 0,
  duration_ms: 1000,
  cost_total: null,
  last_at: null,
}))

function usageStub(): UseUsageReturn {
  return {
    state: ref({ status: 'ok', home: '/home/u', adapters: {} }),
    stats: ref({ total: null, byDay: [], byCli, byModel: [], byProject: [], byHour: [] }),
    sources: ref([]),
    adapterErrors: ref([]),
    clearing: ref(false),
    clearData: vi.fn(async () => ({ ok: true })),
    cliSessionState: vi.fn(() => 'unknown' as CliSessionState),
    statsDays: ref(30 as StatsDays),
    statsLoading: ref(false),
    reloadStats: vi.fn(),
    setStatsDays: vi.fn(),
  } as unknown as UseUsageReturn
}

function skillsStub(): UseSkillsReturn {
  return {
    state: ref({
      status: 'ready',
      libraryRoot: '/home/u/.agents/skills',
      skills: [],
      import: { last: null },
      github: { last: null },
    }),
    scanning: ref(false),
    importing: ref(false),
    busy: ref(false),
    githubBusy: ref(false),
    distributing: ref(null),
    scan: vi.fn(),
    importLocal: vi.fn(),
    installGithub: vi.fn(),
    distribute: vi.fn(),
  } as unknown as UseSkillsReturn
}

const ok = <T,>(data: T) => ({ status: 'ok' as const, data })

function providersStub(): UseProvidersReturn {
  return {
    state: ref({
      claude: { env: {}, bridge: {} },
      codex: { model: null, modelProvider: null, providers: [] },
      presets: [],
      import: { last: null },
    } as unknown as ProvidersDomainState),
    importing: ref(false),
    applying: ref(false),
    saving: ref(false),
    fetchingModels: ref(false),
    refresh: vi.fn(),
    savePreset: vi.fn().mockResolvedValue(ok({ saved: true })),
    deletePreset: vi.fn().mockResolvedValue(ok(null)),
    importProviders: vi.fn().mockResolvedValue(ok(null)),
    applyProvider: vi.fn().mockResolvedValue(ok(null)),
    fetchModels: vi.fn().mockResolvedValue(ok({ models: [], url: '', count: 0 })),
  } as unknown as UseProvidersReturn
}

function preset(): ProviderPreset {
  return {
    id: 1,
    name: 'sensenova',
    baseUrl: 'https://u/v1',
    apiStyle: 'openai',
    models: ['m1'],
    modelsUrl: '',
    keyMask: '—',
    notes: '',
  } as unknown as ProviderPreset
}

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockImplementation(async () => null)
})

// ==================== 载荷校验与回退 ====================

describe('list-agents 载荷', () => {
  it('保留后端顺序与未知 id（不因前端没图标而丢行）', () => {
    const parsed = parseAgentList({
      agents: [
        FIFTH,
        { id: 'claude', displayName: 'Claude Code', capabilities: BUILTIN_AGENTS[0].capabilities },
      ],
    })
    expect(parsed?.map((a) => a.id)).toEqual(['zeta', 'claude'])
  })

  it('重复 id 只保留首个', () => {
    const parsed = parseAgentList({ agents: [FIFTH, FIFTH] })
    expect(parsed?.map((a) => a.id)).toEqual(['zeta'])
  })

  it('空/坏形状整体拒绝（调用方回退内置，不渲染半截清单）', () => {
    expect(parseAgentList(null)).toBeNull()
    expect(parseAgentList({})).toBeNull()
    expect(parseAgentList({ agents: [] })).toBeNull()
    expect(parseAgentList({ agents: [{ id: '', displayName: 'x', capabilities: FIFTH.capabilities }] })).toBeNull()
    expect(
      parseAgentList({
        agents: [{ id: 'x', displayName: 'X', capabilities: { install: true, provider: 'yes' } }],
      }),
    ).toBeNull()
  })
})

describe('useAgentCatalog', () => {
  it('成功：顺序/能力来自后端，派生 Skills 与供应商目标', async () => {
    execute.mockImplementation(async (command) =>
      command === 'agent.list-agents' ? { agents: CATALOG } : null,
    )
    const catalog = useAgentCatalog(makeContext())
    await catalog.load()
    expect(catalog.degraded.value).toBe(false)
    expect(catalog.ids.value).toEqual(['claude', 'codex', 'opencode', 'pi', 'zeta'])
    expect(catalog.skillsTargets.value).toEqual(['claude', 'pi', 'zeta'])
    // 供应商目标：注册表顺序（与后端 ProviderSpec 集合一致）
    expect(catalog.providerTargets.value).toEqual(['claude', 'codex', 'opencode', 'pi', 'zeta'])
  })

  it('失败：回退内置四家 + 可见降级（不抛给调用方）', async () => {
    execute.mockRejectedValue(new Error('host unavailable'))
    const catalog = useAgentCatalog(makeContext())
    await catalog.load()
    expect(catalog.degraded.value).toBe(true)
    expect(catalog.ids.value).toEqual(BUILTIN_CLI_IDS)
    expect(catalog.skillsTargets.value).toEqual(['claude', 'pi'])
  })

  it('空载荷同样回退（不渲染空列表）', async () => {
    execute.mockImplementation(async () => ({ agents: [] }))
    const catalog = useAgentCatalog(makeContext())
    await catalog.load()
    expect(catalog.degraded.value).toBe(true)
    expect(catalog.agents.value).toHaveLength(BUILTIN_AGENTS.length)
  })
})

// ==================== UI 注册表（品牌资产 + 占位） ====================

describe('UI 注册表', () => {
  it('内置四家图标齐备；未登记 id 用通用占位', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agentGlyph(agent.id)).not.toBe(GENERIC_AGENT_GLYPH)
    }
    expect(agentGlyph('zeta')).toBe(GENERIC_AGENT_GLYPH)
    expect(builtinAgentName('zeta')).toBe('zeta')
  })

  it('provider 默认目标：偏好 pi；pi 不可用时回退首个', () => {
    expect(preferredProviderTarget(['claude', 'pi', 'zeta'])).toBe('pi')
    expect(preferredProviderTarget(['zeta', 'claude'])).toBe('zeta')
    expect(preferredProviderTarget([])).toBeNull()
  })

  it('未知 agent 的卡片图标渲染通用占位（不白屏）', () => {
    const w = mountComponent(CliIcon, { cliId: 'zeta' })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.find('svg').attributes('viewBox')).toBe(GENERIC_AGENT_GLYPH.viewBox)
    w.unmount()
  })
})

// ==================== 列表数据驱动（合成第五个 agent） ====================

describe('列表由清单派生', () => {
  it('概览卡片：顺序与展示名来自清单', async () => {
    const w = mountComponent(OverviewTab, {
      state: null,
      detecting: false,
      installState: null,
      speedTesting: false,
      agents: CATALOG,
    })
    await flushPromises()
    const names = w.findAll('[data-testid^="cli-name-"]').map((n) => n.text())
    expect(names).toEqual(['Claude Code', 'Codex CLI', 'OpenCode', 'Pi', 'Zeta CLI'])
    w.unmount()
  })

  it('安装行：合成 agent 出现在清单末尾', async () => {
    const w = mountComponent(InstallTab, {
      detection: null,
      state: null,
      output: null,
      checking: false,
      speedTesting: false,
      agents: CATALOG,
    })
    await flushPromises()
    const rows = w.findAll('.ah-inst-row')
    expect(rows).toHaveLength(5)
    expect(rows.at(-1)?.text()).toContain('Zeta CLI')
    w.unmount()
  })

  it('统计占比环：色槽顺序 = 清单顺序（前四家身份色不变）', async () => {
    const w = mountComponent(StatsTab, { usage: usageStub(), agents: CATALOG })
    await flushPromises()
    const legend = w.findAll('.ah-donut-legend-name').map((n) => n.text())
    expect(legend).toEqual(['claude', 'codex', 'opencode', 'pi', 'zeta'])
    w.unmount()
  })

  it('Skills 目标与「无约定」提示由能力集合派生', async () => {
    const w = mountComponent(SkillsTab, {
      detection: { authGranted: true },
      skills: skillsStub(),
      agents: CATALOG,
    })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('hub.skill.targetIdle(name=Claude Code)')
    expect(text).toContain('hub.skill.targetIdle(name=Pi)')
    expect(text).toContain('hub.skill.targetIdle(name=Zeta CLI)')
    expect(text).toContain('hub.skill.targetNoConvention(names=Codex CLI · OpenCode)')
    w.unmount()
  })

  it('AgentHubView：清单成功时概览渲染后端全量（含合成 agent）', async () => {
    execute.mockImplementation(async (command) => {
      if (command === 'agent.list-agents') return { agents: CATALOG }
      return null
    })
    const w = mountComponent(AgentHubView)
    await flushPromises()
    expect(w.find('[data-testid="agent-catalog-degraded"]').exists()).toBe(false)
    const names = w.findAll('[data-testid^="cli-name-"]').map((n) => n.text())
    expect(names).toEqual(['Claude Code', 'Codex CLI', 'OpenCode', 'Pi', 'Zeta CLI'])
    w.unmount()
  })

  it('AgentHubView：清单失败时上屏降级横幅，仍渲染内置四家', async () => {
    execute.mockImplementation(async (command) => {
      if (command === 'agent.list-agents') throw new Error('host unavailable')
      return null
    })
    const w = mountComponent(AgentHubView)
    await flushPromises()
    expect(w.find('[data-testid="agent-catalog-degraded"]').exists()).toBe(true)
    expect(w.findAll('[data-testid^="cli-name-"]')).toHaveLength(4)
    w.unmount()
  })

  it('供应商目标：合成 agent 可选中；默认仍落在 pi', async () => {
    const w = mountComponent(ProviderApply, {
      providers: providersStub(),
      preset: preset(),
      agents: CATALOG,
    })
    await flushPromises()
    expect(w.find('[data-testid="target-zeta"]').exists()).toBe(true)
    expect(w.get('[data-testid="target-pi"]').classes()).toContain('active')
    const targets = w.findAll('[data-testid^="target-"]').map((n) => n.attributes('data-testid'))
    expect(targets).toEqual([
      'target-claude',
      'target-codex',
      'target-opencode',
      'target-pi',
      'target-zeta',
    ])
    w.unmount()
  })
})
