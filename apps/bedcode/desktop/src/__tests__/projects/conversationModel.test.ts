/**
 * 对话面渲染模型契约（ADR 0004 / issue #23 M3 Seam 3）
 *
 * 只断言外部行为：**事件进 → 行模型出**。12 类 kind 的归一事件按 seq 消费，
 * 断言行形状、工具状态机（pending→running→done/error）、meta 槽合并与
 * 「status / session.meta 不进时间线」。不测内部函数调用顺序，不做快照。
 */
import { describe, it, expect } from 'vitest'
import {
  buildConversation,
  renderAssistantMarkdown,
  type ConversationRow,
  type LedgerEvent,
} from '@/components/chat/conversationModel'

function event(
  seq: number,
  kind: string,
  payload: Record<string, unknown>,
  at = '2026-10-30T10:00:00Z',
): LedgerEvent {
  return { seq, at, kind, payload, source: 'bridge' }
}

/** 取出特定类型的行（类型不对即测试失败；比 expect+cast 更直白） */
function expectRow<T extends ConversationRow['type']>(
  row: ConversationRow | undefined,
  type: T,
): Extract<ConversationRow, { type: T }> {
  if (!row || row.type !== type) {
    throw new Error(`expected a ${type} row, got ${row ? row.type : 'nothing'}`)
  }
  return row as Extract<ConversationRow, { type: T }>
}

describe('buildConversation（对话行）', () => {
  it('user.message → 用户行；空正文不渲染', () => {
    const model = buildConversation([
      event(1, 'user.message', { text: '继续', attachments: [] }),
      event(2, 'user.message', { text: '   ' }),
    ])
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]).toMatchObject({ type: 'user', seq: 1, text: '继续', source: 'bridge' })
    expect(model.rows[0]!.key).toBe('user:1')
  })

  it('assistant.text → markdown 已渲染成 html；streaming 标记透传', () => {
    const model = buildConversation([
      event(1, 'assistant.text', { text: '**加粗** 正文', streaming: true, messageId: 'm1' }),
    ])
    expect(model.rows).toHaveLength(1)
    const row = expectRow(model.rows[0], 'text')
    expect(row.html).toContain('<strong>加粗</strong>')
    expect(row.streaming).toBe(true)
  })

  it('assistant.thinking → thinking 行（含 redacted 标记）', () => {
    const model = buildConversation([
      event(1, 'assistant.thinking', { text: '推理草稿', redacted: false }),
      event(2, 'assistant.thinking', { text: '已隐去', redacted: true }),
    ])
    expect(model.rows).toHaveLength(2)
    expect(model.rows[0]).toMatchObject({ type: 'thinking', text: '推理草稿', redacted: false })
    expect(model.rows[1]).toMatchObject({ type: 'thinking', redacted: true })
  })

  it('patch → 文件列表 + diff 文本', () => {
    const model = buildConversation([
      event(3, 'patch', { files: ['src/a.ts', 'src/b.ts'], diff: '--- a\n+++ b' }),
    ])
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]).toMatchObject({
      type: 'patch',
      files: ['src/a.ts', 'src/b.ts'],
      diff: '--- a\n+++ b',
    })
  })

  it('plan → 待办项（text/status）', () => {
    const model = buildConversation([
      event(4, 'plan', {
        items: [
          { text: '写实现', status: 'completed' },
          { text: '跑测试', status: 'in_progress' },
          { text: '收尾', status: 'pending' },
          { text: '', status: 'pending' },
        ],
      }),
    ])
    const row = expectRow(model.rows[0], 'plan')
    expect(row.items).toEqual([
      { text: '写实现', status: 'completed' },
      { text: '跑测试', status: 'in_progress' },
      { text: '收尾', status: 'pending' },
    ])
  })

  it('error → 错误条（code + message）；message 缺失回落 code', () => {
    const model = buildConversation([
      event(5, 'error', { code: 'ProviderAuthError', message: 'bad key' }),
      event(6, 'error', { code: 'Unknown' }),
    ])
    expect(model.rows).toHaveLength(2)
    expect(model.rows[0]).toMatchObject({
      type: 'error',
      code: 'ProviderAuthError',
      message: 'bad key',
    })
    expect(model.rows[1]).toMatchObject({ type: 'error', code: 'Unknown', message: 'Unknown' })
  })
})

describe('buildConversation（工具状态机：callId 归并）', () => {
  it('pending → running → done：一张卡，状态前进，位置留在 call 的 seq', () => {
    const model = buildConversation([
      event(1, 'user.message', { text: '跑下测试' }),
      event(2, 'tool.call', {
        callId: 'c1',
        name: 'bash',
        args: { command: 'pnpm test' },
        status: 'pending',
      }),
      event(3, 'tool.call', {
        callId: 'c1',
        name: 'bash',
        args: { command: 'pnpm test' },
        status: 'running',
      }),
      event(4, 'assistant.text', { text: '之间插一条正文', streaming: false }),
      event(5, 'tool.result', { callId: 'c1', output: '3 passed', error: '', exitCode: 0 }),
    ])
    const toolRows = model.rows.filter((row) => row.type === 'tool')
    expect(toolRows).toHaveLength(1)
    const tool = expectRow(toolRows[0], 'tool')
    expect(tool.key).toBe('tool:c1')
    expect(tool.seq).toBe(2, '行位置 = 首次出现（call）的 seq，result 不挪动')
    expect(tool.state).toBe('done')
    expect(tool.output).toBe('3 passed')
    expect(tool.exitCode).toBe(0)
    // 正文行夹在 call 与 result 之间：时间线按 seq 交错，不被工具归并吃掉
    expect(model.rows.map((row) => row.seq)).toEqual([1, 2, 4])
  })

  it('error 结果 → error 状态 + 错误文本可见', () => {
    const model = buildConversation([
      event(1, 'tool.call', { callId: 'c2', name: 'bash', args: {}, status: 'running' }),
      event(2, 'tool.result', { callId: 'c2', output: '', error: 'boom', exitCode: 1 }),
    ])
    const tool = expectRow(model.rows[0], 'tool')
    expect(tool.state).toBe('error')
    expect(tool.error).toBe('boom')
  })

  it('result 先到（镜像乱序）→ 落已完成卡；后到的 call 不回退状态', () => {
    const model = buildConversation([
      event(1, 'tool.result', { callId: 'c3', output: 'ok', error: '' }),
      event(2, 'tool.call', { callId: 'c3', name: 'bash', args: {}, status: 'pending' }),
    ])
    expect(model.rows).toHaveLength(1)
    const tool = expectRow(model.rows[0], 'tool')
    expect(tool.state).toBe('done')
    expect(tool.output).toBe('ok')
  })

  it('缺 callId 的工具事件不落行', () => {
    const model = buildConversation([event(1, 'tool.call', { name: 'bash', status: 'pending' })])
    expect(model.rows).toHaveLength(0)
  })
})

describe('buildConversation（权限归并）', () => {
  it('request + replied → 一行，决定与处理方随行', () => {
    const model = buildConversation([
      event(1, 'permission.request', {
        requestId: 'pr1',
        tool: 'bash',
        input: { command: 'rm' },
        canReply: true,
      }),
      event(2, 'permission.replied', { requestId: 'pr1', decision: 'once', by: 'user' }),
    ])
    expect(model.rows).toHaveLength(1)
    const row = expectRow(model.rows[0], 'permission')
    expect(row.decision).toBe('once')
    expect(row.decidedBy).toBe('user')
    expect(row.seq).toBe(1)
  })

  it('replied 先到也能自建行；缺 requestId 丢弃', () => {
    const model = buildConversation([
      event(1, 'permission.replied', { requestId: 'pr2', decision: 'reject', by: 'bridge' }),
      event(2, 'permission.request', { tool: 'bash' }),
    ])
    expect(model.rows).toHaveLength(1)
    const row = expectRow(model.rows[0], 'permission')
    expect(row.decision).toBe('reject')
    expect(row.decidedBy).toBe('bridge')
  })
})

describe('buildConversation（不进时间线的两类）', () => {
  it('status → agentState 取最新一条；不产生行', () => {
    const model = buildConversation([
      event(1, 'status', { state: 'busy' }),
      event(2, 'status', { state: 'idle' }),
    ])
    expect(model.rows).toHaveLength(0)
    expect(model.agentState).toBe('idle')
  })

  it('session.meta → 按到达顺序逐字段合并；null / 空串不覆盖', () => {
    const model = buildConversation([
      event(1, 'session.meta', {
        agentSessionId: 'ses_1',
        title: '修登录',
        model: null,
        tokens: null,
      }),
      event(2, 'session.meta', {
        model: 'deepseek-v4.1',
        tokens: {
          input: 100,
          output: 50,
          reasoning: null,
          cacheRead: null,
          cacheWrite: null,
          total: 150,
        },
      }),
      event(3, 'session.meta', { agentSessionId: '', title: null, model: null, tokens: null }),
    ])
    expect(model.rows).toHaveLength(0)
    expect(model.meta).toEqual({
      agentSessionId: 'ses_1',
      title: '修登录',
      model: 'deepseek-v4.1',
      tokens: { input: 100, output: 50, total: 150 },
    })
  })

  it('未知 kind 丢弃不报错', () => {
    const model = buildConversation([event(1, 'opencode:futures', { x: 1 })])
    expect(model.rows).toHaveLength(0)
  })
})

describe('renderAssistantMarkdown（界缓存）', () => {
  it('同文本只解析一次，文本变化重新解析', () => {
    const first = renderAssistantMarkdown('**同一段**')
    const again = renderAssistantMarkdown('**同一段**')
    expect(again).toBe(first)
    expect(first).toContain('<strong>同一段</strong>')
  })
})
