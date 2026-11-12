/**
 * Nest Agent 工厂（票 08 / spec §5.2）
 *
 * `@earendil-works/pi-agent-core` 的 `Agent` 是有状态循环：持有 transcript、
 * 发生命周期事件、执行工具。本模块把共享核的各部件装配成一个可用 Agent：
 *
 * - `streamFn`：`shared/agent/stream-fn.ts`（不抛异常的流式实现）；
 * - `convertToLlm`：本应用直接用 pi 的标准 `Message[]` 作 transcript，
 *   原样透传（无自定义消息类型，M1 无工具结果消息以外的转换需求）；
 * - `initialState.systemPrompt`：`shared/prompt/system.ts` 的人格骨架。
 *
 * 工具装配（`AgentTool` + 风险确认）在票 13 接入，本工厂预留 `tools` 参数。
 */
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Message, Model } from '@earendil-works/pi-ai'
import { createStreamFn, type StreamFnDeps } from './stream-fn'
import type { ProviderRecord } from '../types'

/** pi 模型描述符：BYOK 自定义端点没有目录信息，字段按保守缺省填（spec D6/D17） */
export function toPiModel(provider: ProviderRecord): Model<any> {
  return {
    id: provider.model,
    name: provider.model,
    api: 'openai-completions',
    provider: provider.id,
    baseUrl: provider.baseUrl,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
  }
}

export interface NestAgentDeps extends StreamFnDeps {
  /** 系统提示词（shared/prompt/system.ts 构建，按当前语言） */
  systemPrompt: string
  /** 当前 provider（决定 model 描述符；密钥不在此处，按需经 resolveRequestContext 取） */
  provider: ProviderRecord
  /** 工具（票 13 接入；M1 传空数组） */
  tools?: AgentTool<any>[]
}

/**
 * 创建 Nest 对话 Agent。
 *
 * 每次创建持有独立 transcript；多会话 = 多个 Agent（会话级隔离，记忆跨会话
 * 共享由记忆工具层负责，spec D15）。
 */
export function createNestAgent(deps: NestAgentDeps): Agent {
  const model = toPiModel(deps.provider)
  return new Agent({
    initialState: {
      systemPrompt: deps.systemPrompt,
      model,
      messages: [],
    },
    streamFn: createStreamFn(deps),
    convertToLlm: (messages: Array<Message | unknown>): Message[] => {
      // 本应用 transcript 即 pi 标准消息；custom 消息（未来 UI 通知类）在此过滤
      return messages.filter((m): m is Message => isPiMessage(m))
    },
    toolExecution: 'sequential',
  })
}

/** 最小形状判据（避免把 UI 专用消息送进 LLM 上下文） */
function isPiMessage(m: unknown): m is Message {
  if (!m || typeof m !== 'object') return false
  const role = (m as { role?: unknown }).role
  return role === 'system' || role === 'user' || role === 'assistant' || role === 'toolResult'
}
