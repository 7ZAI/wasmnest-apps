/**
 * Agent 清单编排（后端 `agent-hub.list-agents` → 前端展示清单）
 *
 * 顺序与能力以后端注册表为准；调用失败时回退到前端内置注册表并留下可见
 * 降级标记（不渲染空列表、不静默丢 agent）。挂载时调用一次，结果供概览/
 * 安装/统计/Skills/供应商各分区派生列表。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { BUILTIN_AGENTS } from '../agents'
import type { AgentCapabilities, AgentDescriptor } from '../types'

const CAPABILITY_KEYS = ['install', 'provider', 'skills', 'usage'] as const

function parseCapabilities(raw: unknown): AgentCapabilities | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const out = {} as AgentCapabilities
  for (const key of CAPABILITY_KEYS) {
    if (typeof obj[key] !== 'boolean') return null
    out[key] = obj[key] as boolean
  }
  return out
}

/**
 * 校验 `list-agents` 载荷（纯函数，可测）。
 *
 * 形状不合法 / 空清单 → null（调用方回退内置注册表）；重复 id 只保留首个。
 * 未知 id 是**正常数据**（后端有、前端没登记图标），不得过滤。
 */
export function parseAgentList(payload: unknown): AgentDescriptor[] | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as { agents?: unknown }).agents
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: AgentDescriptor[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const entry = item as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const displayName =
      typeof entry.displayName === 'string' ? entry.displayName.trim() : ''
    const capabilities = parseCapabilities(entry.capabilities)
    if (!id || !displayName || !capabilities) return null
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, displayName, capabilities })
  }
  return out.length > 0 ? out : null
}

/** 内置注册表 → 回退清单（能力/名称/顺序与当前适配器一致） */
export function fallbackAgents(): AgentDescriptor[] {
  return BUILTIN_AGENTS.map(({ id, displayName, capabilities }) => ({
    id,
    displayName,
    capabilities: { ...capabilities },
  }))
}

export interface UseAgentCatalogReturn {
  /** 当前展示清单（后端优先；失败 = 内置回退） */
  agents: Ref<AgentDescriptor[]>
  /** 是否处于回退态（界面可见降级） */
  degraded: Ref<boolean>
  ids: ComputedRef<string[]>
  skillsTargets: ComputedRef<string[]>
  providerTargets: ComputedRef<string[]>
  load: () => Promise<void>
}

export function useAgentCatalog(context: PluginContext): UseAgentCatalogReturn {
  const agents = ref<AgentDescriptor[]>(fallbackAgents())
  const degraded = ref(false)

  async function load(): Promise<void> {
    try {
      const res = await context.commands.execute('agent-hub.list-agents')
      const parsed = parseAgentList(res)
      if (!parsed) throw new Error('invalid list-agents payload')
      agents.value = parsed
      degraded.value = false
    } catch (e) {
      agents.value = fallbackAgents()
      degraded.value = true
      console.warn('[Agent Hub] list-agents failed; falling back to builtin catalog', e)
    }
  }

  const ids = computed(() => agents.value.map((a) => a.id))
  const skillsTargets = computed(() =>
    agents.value.filter((a) => a.capabilities.skills).map((a) => a.id),
  )
  const providerTargets = computed(() =>
    agents.value.filter((a) => a.capabilities.provider).map((a) => a.id),
  )

  return { agents, degraded, ids, skillsTargets, providerTargets, load }
}
