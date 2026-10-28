/**
 * 前端 Agent UI 注册表（品牌资产 + 能力回退）
 *
 * 唯一保留的前端 agent 清单：id / 品牌展示名 / 图标图元 / 能力声明。
 * 顺序与能力以后端 `agent.list-agents` 为准；本表只用于：
 * - 后端清单不可用时的回退（可见降级，不渲染空列表）；
 * - 图标与品牌名（跨语言无法共享的品牌资产）；
 * - provider 应用的默认目标偏好（当前 pi：唯一支持模型清单的目标）。
 *
 * 新增 agent：后端适配器 + 注册一行 + 本表登记图标/品牌名。后端有、本表没有
 * 的 id 用通用占位图标 + 后端展名渲染（不丢行）。
 */
import { CLI_ICONS, type BrandGlyph } from './icons'
import type { AgentDescriptor } from './types'

export interface AgentUiEntry extends AgentDescriptor {
  glyph: BrandGlyph
  /** provider 应用的默认目标（首个模型清单目标；保持历史默认落在 pi） */
  preferredProviderTarget?: boolean
  /** 供应商写入是否需要至少一个模型（无模型时面板提前警告；未知 agent 默认 true） */
  providerWritesModels?: boolean
  /** 供应商配置落点提示（面板展示用；未知 agent 留空） */
  providerConfigHint?: string
}

/** 通用占位图标（未知 agent：机器人头像，品牌色随主题） */
export const GENERIC_AGENT_GLYPH: BrandGlyph = {
  viewBox: '0 0 24 24',
  color: 'currentColor',
  paths: [
    {
      d: 'M12 2a2 2 0 0 1 2 2v1h2.5A3.5 3.5 0 0 1 20 8.5v9A3.5 3.5 0 0 1 16.5 21h-9A3.5 3.5 0 0 1 4 17.5v-9A3.5 3.5 0 0 1 7.5 5H10V4a2 2 0 0 1 2-2Zm-4.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-6 6a1 1 0 0 0 0 2h3a1 1 0 0 0 0-2h-3Z',
    },
  ],
}

/**
 * 内置四家（顺序 = 后端注册表顺序 = 展示顺序）。
 *
 * `capabilities` 是后端 `list-agents` 不可用时的回退值，与当前适配器声明一致：
 * 四家都有供应商写入与使用统计；Skills 目录仅 claude / pi 声明。
 */
export const BUILTIN_AGENTS: AgentUiEntry[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    glyph: CLI_ICONS.claude ?? GENERIC_AGENT_GLYPH,
    capabilities: { install: true, provider: true, skills: true, usage: true },
    providerWritesModels: false,
    providerConfigHint: '~/.claude/settings.json',
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    glyph: CLI_ICONS.codex ?? GENERIC_AGENT_GLYPH,
    capabilities: { install: true, provider: true, skills: false, usage: true },
    providerWritesModels: true,
    providerConfigHint: '~/.codex/config.toml',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    glyph: CLI_ICONS.opencode ?? GENERIC_AGENT_GLYPH,
    capabilities: { install: true, provider: true, skills: false, usage: true },
    providerWritesModels: true,
    providerConfigHint: '~/.config/opencode/opencode.json',
  },
  {
    id: 'pi',
    displayName: 'Pi',
    glyph: CLI_ICONS.pi ?? GENERIC_AGENT_GLYPH,
    capabilities: { install: true, provider: true, skills: true, usage: true },
    preferredProviderTarget: true,
    providerWritesModels: true,
    providerConfigHint: '~/.pi/agent/{models.json, auth.json}',
  },
]

/** 内置 id（仅兼容/测试用；业务列表从清单派生，勿再作为渲染清单） */
export const BUILTIN_CLI_IDS: string[] = BUILTIN_AGENTS.map((a) => a.id)

const UI_BY_ID = new Map(BUILTIN_AGENTS.map((a) => [a.id, a]))

/** 内置 agent 的前端条目（None = 本表未登记，用通用占位/后端展示名） */
export function builtinAgent(id: string): AgentUiEntry | undefined {
  return UI_BY_ID.get(id)
}

/** 图标图元：未登记的 id 用通用占位（不丢行、不白屏） */
export function agentGlyph(id: string): BrandGlyph {
  return UI_BY_ID.get(id)?.glyph ?? GENERIC_AGENT_GLYPH
}

/** 品牌展示名回退（后端展示名优先；此函数只给纯前端场景兜底） */
export function builtinAgentName(id: string): string {
  return UI_BY_ID.get(id)?.displayName ?? id
}

/** 供应商写入是否需要模型（未登记 agent 默认 true：没把握时先警告） */
export function providerWritesModels(id: string): boolean {
  return UI_BY_ID.get(id)?.providerWritesModels ?? true
}

/** 供应商配置落点提示（未登记 agent 留空，面板只显示目标名） */
export function providerConfigHint(id: string): string {
  return UI_BY_ID.get(id)?.providerConfigHint ?? ''
}

/** provider 默认目标：声明的偏好优先，否则回退第一个 provider 目标 */
export function preferredProviderTarget(providerIds: string[]): string | null {
  const preferred = BUILTIN_AGENTS.find((a) => a.preferredProviderTarget)?.id
  if (preferred && providerIds.includes(preferred)) return preferred
  return providerIds[0] ?? null
}
