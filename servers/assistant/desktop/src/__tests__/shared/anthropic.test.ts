/**
 * Anthropic Messages API 适配器单测（票 10）
 *
 * 覆盖：URL 拼接、pi 消息 → Anthropic 消息映射（system 提取 / 连续同角色
 * 合并 / tool_use / tool_result）、请求载荷形状（x-api-key / anthropic-version）、
 * SSE → pi 事件映射（message_start / content_block_* / message_delta /
 * message_stop / ping / error），以及与 SseParser 的分片边界集成
 * （半包 / 多事件一包 / 心跳注释 / 错误事件）。
 * 协议同形自实现（不引用其它应用源码，spec §5.2）。
 */
import { describe, it, expect } from 'vitest'
import type { AssistantMessageEvent, Message } from '@earendil-works/pi-ai'
import { SseParser } from '@nest-shared/providers/sse'
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_VERSION,
  AnthropicStreamError,
  AnthropicStreamMapper,
  buildAnthropicMessagesRequest,
  joinAnthropicMessagesUrl,
  mapMessagesToAnthropic,
} from '@nest-shared/providers/anthropic'

const ts = 1_700_000_000_000

function sys(content: string): Message {
  return { role: 'system', content, timestamp: ts }
}
function user(content: string): Message {
  return { role: 'user', content, timestamp: ts }
}
function assistant(content: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'anthropic-messages',
    provider: 'p-anthropic',
    model: 'claude-test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: ts,
  }
}

describe('joinAnthropicMessagesUrl', () => {
  it('缺省 base / 带 /v1 / 完整端点 / 尾部斜杠', () => {
    expect(joinAnthropicMessagesUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(joinAnthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/v1/messages',
    )
    expect(joinAnthropicMessagesUrl('https://proxy.example.com/anthropic/messages')).toBe(
      'https://proxy.example.com/anthropic/messages',
    )
    expect(joinAnthropicMessagesUrl('https://api.anthropic.com/')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })
})

describe('mapMessagesToAnthropic', () => {
  it('system 提取为顶层参数；user / assistant 正常映射', () => {
    const out = mapMessagesToAnthropic([sys('你是 Nest'), user('你好'), assistant('在的')])
    expect(out.system).toBe('你是 Nest')
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'text', text: '在的' }] },
    ])
  })

  it('连续同角色消息合并（Anthropic 要求交替）', () => {
    const out = mapMessagesToAnthropic([user('第一段'), user('第二段'), assistant('回')])
    expect(out.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    })
  })

  it('toolCall → tool_use 块；toolResult → user 侧 tool_result 块', () => {
    const toolAssistant: Message = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call_1', name: 'demo.tool', arguments: { a: 1 } }],
      api: 'anthropic-messages',
      provider: 'p',
      model: 'm',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: ts,
    }
    const toolResult: Message = {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'demo.tool',
      content: [{ type: 'text', text: '结果文本' }],
      isError: false,
      timestamp: ts,
    }
    const out = mapMessagesToAnthropic([user('调用'), toolAssistant, toolResult])
    expect(out.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'demo.tool', input: { a: 1 } }],
    })
    expect(out.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: '结果文本',
        },
      ],
    })
  })
})

describe('buildAnthropicMessagesRequest', () => {
  it('请求形状：URL / 鉴权头 / 版本头 / 流式体', () => {
    const req = buildAnthropicMessagesRequest({
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test',
      messages: [sys('s'), user('u')],
      streamEvent: 'assistant:stream:s1',
    })
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': ANTHROPIC_VERSION,
    })
    expect(req.stream).toBe(true)
    expect(req.streamEvent).toBe('assistant:stream:s1')
    const body = JSON.parse(req.body ?? '{}')
    expect(body).toMatchObject({
      model: 'claude-test',
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      stream: true,
      system: 's',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'u' }] }],
    })
  })
})

// ==================== SSE → pi 事件映射 ====================

function typesOf(events: AssistantMessageEvent[]): string[] {
  return events.map((e) => e.type)
}

describe('AnthropicStreamMapper：完整事件序列', () => {
  it('message_start → 文本块 → message_delta → message_stop：事件序与内容', () => {
    const mapper = new AnthropicStreamMapper('p-anthropic', 'claude-test')
    const events: AssistantMessageEvent[] = []
    const feed = (data: string, event?: string) => events.push(...mapper.handleData(data, event))

    feed(
      JSON.stringify({
        type: 'message_start',
        message: { id: 'msg_1', usage: { input_tokens: 12 } },
      }),
      'message_start',
    )
    feed(
      JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      'content_block_start',
    )
    feed(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你' } }), 'content_block_delta')
    feed(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } }), 'content_block_delta')
    feed(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop')
    feed(
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 3 },
      }),
      'message_delta',
    )
    feed(JSON.stringify({ type: 'message_stop' }), 'message_stop')

    expect(typesOf(events)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_delta',
      'done',
    ])
    const texts = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(texts).toEqual(['你', '好'])
    const done = events[events.length - 1]
    if (done.type !== 'done') throw new Error('末事件须为 done')
    expect(done.reason).toBe('stop')
    expect(done.message).toMatchObject({
      api: 'anthropic-messages',
      provider: 'p-anthropic',
      model: 'claude-test',
      responseId: 'msg_1',
      usage: { input: 12, output: 3 },
    })
    expect(done.message.content[0]).toMatchObject({ type: 'text', text: '你好' })
  })

  it('思考块与工具调用块映射', () => {
    const mapper = new AnthropicStreamMapper('p', 'm')
    const events: AssistantMessageEvent[] = []
    const feed = (data: string, event?: string) => events.push(...mapper.handleData(data, event))

    feed(JSON.stringify({ type: 'message_start', message: {} }), 'message_start')
    feed(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }), 'content_block_start')
    feed(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想' } }), 'content_block_delta')
    feed(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop')
    feed(JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'demo.tool' } }), 'content_block_start')
    feed(
      JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } }),
      'content_block_delta',
    )
    feed(JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':1}' } }), 'content_block_delta')
    feed(JSON.stringify({ type: 'content_block_stop', index: 1 }), 'content_block_stop')
    const done = mapper.finish('stop')
    events.push(done)

    expect(typesOf(events)).toEqual([
      'start',
      'thinking_start',
      'thinking_delta',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_delta',
      'done',
    ])
    // contentIndex 按紧凑块下标（thinking=0，tool=1）
    const toolDeltas = events.filter((e) => e.type === 'toolcall_delta')
    expect(toolDeltas[0]).toMatchObject({ contentIndex: 1, delta: '{"a"' })
    if (done.type !== 'done') throw new Error('末事件须为 done')
    expect(done.message.content).toEqual([
      { type: 'thinking', thinking: '想' },
      { type: 'toolCall', id: 'toolu_1', name: 'demo.tool', arguments: { a: 1 } },
    ])
  })

  it('stop_reason 映射：max_tokens → length，tool_use → toolUse', () => {
    const forReason = (reason: string): AssistantMessageEvent => {
      const mapper = new AnthropicStreamMapper('p', 'm')
      mapper.handleData(JSON.stringify({ type: 'message_delta', delta: { stop_reason: reason } }), 'message_delta')
      return mapper.finish('stop')
    }
    const len = forReason('max_tokens')
    if (len.type !== 'done') throw new Error('末事件须为 done')
    expect(len.reason).toBe('length')
    const tool = forReason('tool_use')
    if (tool.type !== 'done') throw new Error('末事件须为 done')
    expect(tool.reason).toBe('toolUse')
    const stop = forReason('end_turn')
    if (stop.type !== 'done') throw new Error('末事件须为 done')
    expect(stop.reason).toBe('stop')
  })

  it('ping 忽略；未知事件类型忽略不阻断', () => {
    const mapper = new AnthropicStreamMapper('p', 'm')
    expect(mapper.handleData(JSON.stringify({ type: 'ping' }), 'ping')).toEqual([])
    expect(mapper.handleData(JSON.stringify({ type: 'unknown_event' }), 'unknown_event')).toEqual([])
    // 仍可正常收尾
    const done = mapper.finish('stop')
    expect(done.type).toBe('done')
  })

  it('error 事件：抛 AnthropicStreamError（点名原因）', () => {
    const mapper = new AnthropicStreamMapper('p', 'm')
    expect(() =>
      mapper.handleData(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }), 'error'),
    ).toThrow(AnthropicStreamError)
    expect(() =>
      mapper.handleData(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }), 'error'),
    ).toThrow(/overloaded/)
  })

  it('非法 JSON / 非对象 JSON：抛 AnthropicStreamError', () => {
    const mapper = new AnthropicStreamMapper('p', 'm')
    expect(() => mapper.handleData('not-json', 'message_start')).toThrow(AnthropicStreamError)
    expect(() => mapper.handleData('[1,2]', 'message_start')).toThrow(AnthropicStreamError)
  })
})

// ==================== 与 SseParser 的分片边界集成 ====================

describe('Anthropic SSE 分片边界（SseParser + 映射器）', () => {
  /** 用原始分片驱动 parser + mapper，返回全部协议事件 */
  function runChunks(chunks: string[]): AssistantMessageEvent[] {
    const parser = new SseParser()
    const mapper = new AnthropicStreamMapper('p-anthropic', 'claude-test')
    const out: AssistantMessageEvent[] = []
    for (const chunk of chunks) {
      for (const sse of parser.push(chunk)) {
        out.push(...mapper.handleData(sse.data, sse.event))
      }
    }
    for (const sse of parser.flush()) {
      out.push(...mapper.handleData(sse.data, sse.event))
    }
    out.push(mapper.finish('stop'))
    return out
  }

  it('半包：一条事件拆成两个网络分片，内容不丢不重', () => {
    const events = runChunks([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"del',
      `ta":{"type":"text_delta","text":"半包内容"}}\n\n`,
    ])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['半包内容'])
  })

  it('多事件一包：一个网络分片含多条完整事件', () => {
    const events = runChunks([
      'event: message_start\ndata: {"type":"message_start","message":{}}\n\n' +
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"多事件"}}\n\n',
    ])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['多事件'])
    expect(typesOf(events)).toContain('start')
  })

  it('心跳注释：`:` 开头行被忽略，不产生事件不阻断', () => {
    const events = runChunks([
      ': heartbeat\n\n' +
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"心跳后"}}\n\n',
    ])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['心跳后'])
  })

  it('error 事件在分片流中：映射器抛错，由 StreamFn 编码（此处验证抛出）', () => {
    const parser = new SseParser()
    const mapper = new AnthropicStreamMapper('p', 'm')
    let threw = false
    try {
      for (const sse of parser.push('event: error\ndata: {"type":"error","error":{"message":"boom"}}\n\n')) {
        mapper.handleData(sse.data, sse.event)
      }
    } catch (e) {
      threw = true
      expect(e).toBeInstanceOf(AnthropicStreamError)
      expect((e as Error).message).toContain('boom')
    }
    expect(threw).toBe(true)
  })
})
