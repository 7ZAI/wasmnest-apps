/**
 * 多会话单测（票 09 票面）
 *
 * 覆盖：默认陪伴会话建立与自愈、归档守卫（拒绝原样上交）、归档 / 恢复、
 * 改名、冷启动最近 N 条上下文恢复、摘要 / 记忆注入钩子的 transcript 形状。
 * 用假 invoke 驱动（内存后端模拟 Rust 命令面），不依赖真实宿主。
 */
import { describe, it, expect, vi } from 'vitest'
import { NestChatSession, buildTranscriptMessages, isCreationTitle } from '@nest-shared/chat/session'
import {
  ASSISTANT_SETTINGS_GET_COMMAND,
  DEFAULT_COMPANION_ID,
  type AssistantInvoke,
  type ConversationRecord,
  type MessageRecord,
  type ProviderRecord,
} from '@nest-shared/types'

// ==================== 内存假后端（模拟 Rust 命令面） ====================

interface FakeState {
  conversations: ConversationRecord[]
  messages: MessageRecord[]
  settings: Record<string, string>
}

function conv(id: string, extra: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id,
    title: '标题',
    kind: 'task',
    createdAt: '0',
    updatedAt: '0',
    archived: false,
    ...extra,
  }
}

function makeBackend(state: FakeState) {
  const calls = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
  const invoke = async <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls(command, args)
    switch (command) {
      case 'assistant.conversations-list':
        return { conversations: state.conversations } as T
      case 'assistant.conversations-create': {
        const id = String(args?.id ?? `conv-${state.conversations.length + 1}`)
        state.conversations.push(
          conv(id, {
            title: String(args?.title ?? '标题'),
            kind: (String(args?.kind ?? 'companion') === 'task' ? 'task' : 'companion'),
          }),
        )
        return { id } as T
      }
      case 'assistant.conversations-rename': {
        const c = state.conversations.find((x) => x.id === args?.id)
        if (!c) throw new Error(`会话不存在：${args?.id}`)
        c.title = String(args?.title)
        return { ok: true } as T
      }
      case 'assistant.conversations-archive': {
        const id = String(args?.id)
        const archived = Boolean(args?.archived)
        // 与 Rust archive_guard 同口径：默认陪伴会话归档（archived=true）点名拒绝，恢复放行
        if (archived && id === DEFAULT_COMPANION_ID) throw new Error('默认陪伴会话不可归档或删除')
        const c = state.conversations.find((x) => x.id === id)
        if (!c) throw new Error(`会话不存在：${id}`)
        c.archived = Boolean(args?.archived)
        return { ok: true, id, archived: c.archived } as T
      }
      case 'assistant.messages-list': {
        const convId = String(args?.conversationId)
        const limit = Number(args?.limit ?? 50)
        const sorted = state.messages
          .filter((m) => m.conversationId === convId)
          .sort((a, b) => a.seq - b.seq)
        const recent = sorted.slice(Math.max(0, sorted.length - limit))
        return { messages: recent } as T
      }
      case 'assistant.messages-count': {
        const convId = String(args?.conversationId)
        return { count: state.messages.filter((m) => m.conversationId === convId).length } as T
      }
      case 'assistant.messages-append': {
        const id = `msg-${state.messages.length + 1}`
        state.messages.push({
          id,
          conversationId: String(args?.conversationId),
          seq: Number(args?.seq ?? 0),
          role: String(args?.role) as 'user' | 'assistant',
          content: String(args?.content),
          meta: {},
          createdAt: '0',
        })
        return { ok: true, id } as T
      }
      case 'assistant.providers-list':
        return { providers: [] } as T
      case 'assistant.vault-status':
        return { exists: true, unlocked: true } as T
      case 'assistant.vault-get-secret':
        return { value: 'sk-test' } as T
      case ASSISTANT_SETTINGS_GET_COMMAND:
        return { key: String(args?.key), value: state.settings[String(args?.key)] ?? null } as T
      default:
        throw new Error(`未知命令：${command}`)
    }
  }
  return { invoke: invoke as unknown as AssistantInvoke, calls }
}

function makeSession(state: FakeState, overrides: Partial<ConstructorParameters<typeof NestChatSession>[0]> = {}) {
  const { invoke } = makeBackend(state)
  const session = new NestChatSession({
    invoke,
    subscribe: () => () => {},
    lang: 'zh-CN',
    ...overrides,
  })
  return session
}

// ==================== 用例 ====================

describe('票 09：默认陪伴会话', () => {
  it('缺失时按固定 id 补建；已存在时不重复建（幂等）', async () => {
    const state: FakeState = { conversations: [], messages: [], settings: {} }
    const session = makeSession(state)
    await session.ensureDefaultCompanion()
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0].id).toBe(DEFAULT_COMPANION_ID)
    expect(state.conversations[0].kind).toBe('companion')
    expect(state.conversations[0].archived).toBe(false)

    await session.ensureDefaultCompanion()
    expect(state.conversations).toHaveLength(1)
  })

  it('被归档的脏数据自愈为未归档', async () => {
    const state: FakeState = {
      conversations: [conv(DEFAULT_COMPANION_ID, { kind: 'companion', archived: true })],
      messages: [],
      settings: {},
    }
    const session = makeSession(state)
    await session.ensureDefaultCompanion()
    expect(state.conversations[0].archived).toBe(false)
  })
})

describe('票 09：归档 / 恢复 / 改名', () => {
  it('默认陪伴会话归档被守卫拒绝，错误原样上交不静默', async () => {
    const state: FakeState = {
      conversations: [conv(DEFAULT_COMPANION_ID, { kind: 'companion' }), conv('conv-1')],
      messages: [],
      settings: {},
    }
    const session = makeSession(state)
    await session.refreshConversations()
    await expect(session.archiveConversation(DEFAULT_COMPANION_ID, true)).rejects.toThrow(
      '默认陪伴会话不可归档或删除',
    )
    expect(state.conversations[0].archived).toBe(false)
  })

  it('任务会话归档后不进活跃列表、进归档列表；恢复后回到活跃列表', async () => {
    const state: FakeState = {
      conversations: [conv(DEFAULT_COMPANION_ID, { kind: 'companion' }), conv('conv-1')],
      messages: [],
      settings: {},
    }
    const session = makeSession(state)
    await session.refreshConversations()
    expect(session.conversations.map((c) => c.id)).toEqual([DEFAULT_COMPANION_ID, 'conv-1'])

    await session.archiveConversation('conv-1', true)
    expect(session.conversations.map((c) => c.id)).toEqual([DEFAULT_COMPANION_ID])
    expect(session.archivedConversations.map((c) => c.id)).toEqual(['conv-1'])

    await session.archiveConversation('conv-1', false)
    expect(session.conversations.map((c) => c.id)).toEqual([DEFAULT_COMPANION_ID, 'conv-1'])
    expect(session.archivedConversations).toHaveLength(0)
  })

  it('改名更新标题（活跃与归档列表同步）', async () => {
    const state: FakeState = {
      conversations: [conv(DEFAULT_COMPANION_ID, { kind: 'companion' }), conv('conv-1')],
      messages: [],
      settings: {},
    }
    const session = makeSession(state)
    await session.refreshConversations()
    await session.renameConversation('conv-1', '写周报')
    expect(state.conversations.find((c) => c.id === 'conv-1')?.title).toBe('写周报')
    expect(session.conversations.find((c) => c.id === 'conv-1')?.title).toBe('写周报')
  })
})

describe('票 09：冷启动上下文恢复', () => {
  function seedMessages(state: FakeState, convId: string, n: number): void {
    for (let i = 1; i <= n; i++) {
      state.messages.push({
        id: `msg-${i}`,
        conversationId: convId,
        seq: i,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `m${i}`,
        meta: {},
        createdAt: '0',
      })
    }
  }

  it('按可配的最近 N 条加载（默认 20；设置可改）', async () => {
    const state: FakeState = { conversations: [conv('conv-1')], messages: [], settings: {} }
    seedMessages(state, 'conv-1', 30)

    // 默认：20 条
    const s1 = makeSession(state)
    await s1.openConversation('conv-1')
    expect(s1.messages).toHaveLength(20)
    expect(s1.messages[0].content).toBe('m11')
    expect(s1.nextSeq).toBe(31) // 下一条消息序号 = 已加载最大 seq + 1

    // 设置 contextLimit=5：只取最近 5 条
    const state2: FakeState = { conversations: [conv('conv-1')], messages: [], settings: {} }
    seedMessages(state2, 'conv-1', 30)
    state2.settings['conversation.contextLimit'] = '5'
    const s2 = makeSession(state2)
    await s2.openConversation('conv-1')
    expect(s2.messages).toHaveLength(5)
    expect(s2.messages[0].content).toBe('m26')
  })

  it('摘要钩子受阈值门控：未超阈值不请求；超过则请求且不进 UI 消息流', async () => {
    // 3 条消息 < 默认阈值 40 → 不请求摘要
    const state: FakeState = { conversations: [conv('conv-1')], messages: [], settings: {} }
    seedMessages(state, 'conv-1', 3)
    const summary = vi.fn(async () => '较早内容摘要')
    const session = makeSession(state, { resolveSummary: summary })
    await session.openConversation('conv-1')
    expect(summary).not.toHaveBeenCalled()
    expect(session.messages).toHaveLength(3)

    // 阈值降到 2：3 条消息超过阈值 → 请求摘要；UI 消息流仍只有 3 条真实消息
    const state2: FakeState = { conversations: [conv('conv-1')], messages: [], settings: {} }
    seedMessages(state2, 'conv-1', 3)
    state2.settings['conversation.summaryThreshold'] = '2'
    const summary2 = vi.fn(async () => '较早内容摘要')
    const session2 = makeSession(state2, { resolveSummary: summary2 })
    await session2.openConversation('conv-1')
    expect(summary2).toHaveBeenCalledWith('conv-1')
    expect(session2.messages).toHaveLength(3)
  })
})

describe('票 09：transcript 构建（buildTranscriptMessages）', () => {
  const provider: ProviderRecord = {
    id: 'p1',
    name: 'P',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    model: 'm1',
    isDefault: true,
  }
  const doneMsg = (id: string, role: 'user' | 'assistant', content: string) => ({
    id,
    role,
    content,
    status: 'done' as const,
    createdAt: '0',
  })

  it('无摘要无记忆：纯消息 transcript', () => {
    const out = buildTranscriptMessages([doneMsg('a', 'user', 'hi')], provider, null, null)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
    expect(String(out[0].content)).toContain('hi')
  })

  it('记忆 + 摘要按序置于消息之前', () => {
    const out = buildTranscriptMessages(
      [doneMsg('a', 'user', 'hi')],
      provider,
      '摘要内容',
      '记忆内容',
    )
    expect(out).toHaveLength(3)
    expect(String(out[0].content)).toContain('长期记忆')
    expect(String(out[0].content)).toContain('记忆内容')
    expect(String(out[1].content)).toContain('会话摘要')
    expect(String(out[1].content)).toContain('摘要内容')
    expect(String(out[2].content)).toContain('hi')
  })

  it('流式 / 错误卡不进 transcript', () => {
    const out = buildTranscriptMessages(
      [
        doneMsg('a', 'user', 'ok'),
        { id: 'b', role: 'assistant', content: 'x', status: 'streaming', createdAt: '0' },
        { id: 'c', role: 'assistant', content: 'x', status: 'error', createdAt: '0' },
      ],
      provider,
      null,
      null,
    )
    expect(out).toHaveLength(1)
  })
})

describe('票 09：创建期默认标题（自动命名判据）', () => {
  it('只认创建期字面量（双语言），用户自设标题不误改', () => {
    expect(isCreationTitle('新会话')).toBe(true)
    expect(isCreationTitle('New conversation')).toBe(true)
    expect(isCreationTitle('任务')).toBe(true)
    expect(isCreationTitle('Task')).toBe(true)
    expect(isCreationTitle('长期陪伴')).toBe(false)
    expect(isCreationTitle('写周报')).toBe(false)
  })
})
