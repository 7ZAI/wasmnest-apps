/**
 * 会话切换与响应式绑定回归（票 09 修复）
 *
 * 两个曾经真实存在的缺陷，各锁一条：
 * 1. `openConversation` 不复位 agent → 切到会话 B 后 agent 仍持有会话 A 的
 *    transcript（旧上下文串进新会话）。锁法：切会话后 agent 实例必须换新，
 *    且新 transcript 不含旧会话消息。
 * 2. `openConversation` 用 `this.messages = []` 换数组 → 端侧对消息数组做的
 *    `reactive()` 代理绑定指向旧数组，切会话后历史与流式增量都不再刷新。
 *    锁法：数组身份跨切换保持不变（就地清空）。
 *
 * 用假 invoke 驱动（内存后端模拟 Rust 命令面），不依赖真实宿主。
 */
import { describe, it, expect } from 'vitest'
import { NestChatSession } from '@nest-shared/chat/session'
import type {
  AssistantInvoke,
  ConversationRecord,
  MessageRecord,
  ProviderRecord,
} from '@nest-shared/types'

const PROVIDER: ProviderRecord = {
  id: 'p1',
  name: 'Local',
  apiStyle: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'test-model',
  isDefault: true,
}

function conv(id: string): ConversationRecord {
  return { id, title: id, kind: 'task', createdAt: '0', updatedAt: '0', archived: false }
}

function msg(conversationId: string, seq: number, content: string): MessageRecord {
  return {
    id: `${conversationId}-${seq}`,
    conversationId,
    seq,
    role: 'user',
    content,
    meta: {},
    createdAt: '0',
  }
}

const CONVERSATIONS = [conv('a'), conv('b')]
const MESSAGES = [msg('a', 1, 'A 会话的消息'), msg('b', 1, 'B 会话的消息')]

function makeInvoke(): AssistantInvoke {
  const invoke = (async <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    switch (command) {
      case 'assistant.conversations-list':
        return { conversations: CONVERSATIONS } as T
      case 'assistant.messages-list': {
        const id = String(args?.conversationId)
        return { messages: MESSAGES.filter((m) => m.conversationId === id) } as T
      }
      case 'assistant.messages-count': {
        const id = String(args?.conversationId)
        return { count: MESSAGES.filter((m) => m.conversationId === id).length } as T
      }
      case 'assistant.providers-list':
        return { providers: [PROVIDER] } as T
      case 'assistant.vault-status':
        return { exists: true, unlocked: true } as T
      case 'assistant.vault-get-secret':
        return { value: 'sk-test' } as T
      case 'assistant.settings-get':
        return { key: String(args?.key), value: null } as T
      default:
        throw new Error(`未知命令：${command}`)
    }
  }) as unknown as AssistantInvoke
  return invoke
}

function makeSession(): NestChatSession {
  return new NestChatSession({
    invoke: makeInvoke(),
    subscribe: () => () => {},
    lang: 'zh-CN',
  })
}

/** 取内部 agent（private 只影响编译期；本用例需要检查 transcript 内容） */
function agentOf(session: NestChatSession): {
  state: {
    messages: Array<{ role: string; content: unknown; toolsAdded?: Array<{ name: string }> }>
  }
} | null {
  return (session as unknown as { agent: ReturnType<typeof agentOf> }).agent
}

function transcriptText(session: NestChatSession): string {
  return JSON.stringify(agentOf(session)?.state.messages ?? [])
}

describe('票 09 修复：会话切换', () => {
  it('切会话换新 agent，旧会话上下文不串进新会话', async () => {
    const session = makeSession()
    await session.refreshProviders()

    await session.openConversation('a')
    const agentA = agentOf(session)
    expect(agentA, '打开会话后应重建 agent').not.toBeNull()
    expect(transcriptText(session)).toContain('A 会话的消息')
    // 票 13：system 消息（含工具声明）必须置顶；赋 state.messages 会把它丢掉
    const head = agentA?.state.messages[0]
    expect(head?.role).toBe('system')
    expect(head?.toolsAdded?.map((tool) => tool.name)).toContain('time.now')

    await session.openConversation('b')
    const agentB = agentOf(session)
    expect(agentB, '切会话后应有 agent').not.toBeNull()
    expect(agentB, '切会话必须换新 agent（否则旧 transcript 被复用）').not.toBe(agentA)
    expect(transcriptText(session)).toContain('B 会话的消息')
    expect(transcriptText(session)).not.toContain('A 会话的消息')
  })

  it('切会话保持消息数组身份（端侧 reactive 代理不脱钩）', async () => {
    const session = makeSession()
    await session.refreshProviders()

    await session.openConversation('a')
    const bound = session.messages
    expect(bound.map((m) => m.content)).toEqual(['A 会话的消息'])

    await session.openConversation('b')
    // 同一个数组实例：端侧 `reactive(session.messages)` 绑定仍然有效
    expect(session.messages).toBe(bound)
    expect(session.messages.map((m) => m.content)).toEqual(['B 会话的消息'])
  })
})
