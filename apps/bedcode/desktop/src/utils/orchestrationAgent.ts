/**
 * 节点 → Agent 展示投影（纯函数）
 *
 * v2 节点持池成员快照；旧节点 / 快照缺失时退回 `agentId`（CLI）与池清单。
 * 图标用 `cli`，标签优先快照名——池成员被改名 / 删除不影响运行中节点的呈现。
 */
import type { AgentProfileView } from '@/composables/orchestration/types'
import type { NodeView } from '@/composables/orchestration/types'

export interface AgentDisplay {
  /** 参与者分组键：池成员 id（旧数据回退 CLI） */
  key: string
  cli: string
  name: string
  model: string | null
  thinkingLevel: string | null
}

export function agentDisplay(
  node: Pick<NodeView, 'agent' | 'agentId' | 'agentRef'>,
  profiles: AgentProfileView[] = [],
): AgentDisplay {
  const key = node.agentRef || node.agentId
  const profile = profiles.find((entry) => entry.id === key)
  return {
    key,
    cli: node.agent?.cli || profile?.cli || node.agentId,
    name: node.agent?.name || profile?.name || node.agentId,
    model: node.agent?.model ?? profile?.model ?? null,
    thinkingLevel: node.agent?.thinkingLevel ?? profile?.thinkingLevel ?? null,
  }
}

/** 一行紧凑的 profile 徽标（CLI / model / thinking） */
export function agentChips(display: AgentDisplay): string[] {
  return [display.cli, display.model ?? '', display.thinkingLevel ?? ''].filter((value) => !!value)
}
