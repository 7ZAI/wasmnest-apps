/**
 * Gemini 适配器单测（票 10）
 *
 * 覆盖：URL 拼接（含模型名与 alt=sse）、pi 消息 → Gemini contents 映射
 * （systemInstruction / 角色映射 / 连续同角色合并 / functionCall /
 * functionResponse）、请求载荷形状（x-goog-api-key）、SSE → pi 事件映射
 * （文本 / 思考 / 函数调用 / finishReason / usageMetadata），以及与
 * SseParser 的分片边界集成（半包 / 多事件一包 / 心跳 / 错误形状）。
 * 协议同形自实现（不引用其它应用源码，spec §5.2）。
 */
import { describe, it, expect } from 'vitest'
import type { AssistantMessageEvent, Message } from '@earendil-works/pi-ai'
import { SseParser } from '@nest-shared/providers/sse'
import {
  GEMINI_DEFAULT_BASE_URL,
  GeminiStreamError,
  GeminiStreamMapper,
  buildGeminiStreamRequest,
  joinGeminiStreamUrl,
  mapMessagesToGemini,
} from '@nest-shared/providers/gemini'

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
    api: 'google-generative-ai',
    provider: 'p-gemini',
    model: 'gemini-test',
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

describe('joinGeminiStreamUrl', () => {
  it('缺省 base / 带 /v1beta / 完整端点原样 / 尾部斜杠', () => {
    expect(joinGeminiStreamUrl('', 'gemini-2.0-flash')).toBe(
      `${GEMINI_DEFAULT_BASE_URL}/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse`,
    )
    expect(joinGeminiStreamUrl('https://generativelanguage.googleapis.com/v1beta', 'm1')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/m1:streamGenerateContent?alt=sse',
    )
    expect(
      joinGeminiStreamUrl('https://proxy.example.com/models/m1:streamGenerateContent?alt=sse', 'm1'),
    ).toBe('https://proxy.example.com/models/m1:streamGenerateContent?alt=sse')
    expect(joinGeminiStreamUrl('https://genai.example.com/', 'm1')).toBe(
      'https://genai.example.com/v1beta/models/m1:streamGenerateContent?alt=sse',
    )
  })
})

describe('mapMessagesToGemini', () => {
  it('system → systemInstruction；assistant → model 角色', () => {
    const out = mapMessagesToGemini([sys('你是 Nest'), user('你好'), assistant('在的')])
    expect(out.systemInstruction).toEqual({ parts: [{ text: '你是 Nest' }] })
    expect(out.contents).toEqual([
      { role: 'user', parts: [{ text: '你好' }] },
      { role: 'model', parts: [{ text: '在的' }] },
    ])
  })

  it('连续同角色消息合并（parts 追加）', () => {
    const out = mapMessagesToGemini([user('第一段'), user('第二段'), assistant('回')])
    expect(out.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: '第一段' }, { text: '第二段' }],
    })
  })

  it('toolCall → functionCall part；toolResult → functionResponse part', () => {
    const toolAssistant: Message = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call_1', name: 'demo.tool', arguments: { a: 1 } }],
      api: 'google-generative-ai',
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
    const out = mapMessagesToGemini([user('调用'), toolAssistant, toolResult])
    expect(out.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'demo.tool', args: { a: 1 } } }],
    })
    expect(out.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'call_1',
            response: { result: '结果文本' },
          },
        },
      ],
    })
  })
})

describe('buildGeminiStreamRequest', () => {
  it('请求形状：URL 含模型与 alt=sse / x-goog-api-key / 流式体', () => {
    const req = buildGeminiStreamRequest({
      apiKey: 'AIza-test',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-2.0-flash',
      messages: [sys('s'), user('u')],
      streamEvent: 'assistant:stream:s1',
    })
    expect(req.method).toBe('POST')
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
    )
    expect(req.headers).toMatchObject({ 'x-goog-api-key': 'AIza-test' })
    expect(req.stream).toBe(true)
    expect(req.streamEvent).toBe('assistant:stream:s1')
    const body = JSON.parse(req.body ?? '{}')
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: 's' }] },
      contents: [{ role: 'user', parts: [{ text: 'u' }] }],
    })
  })
})

// ==================== SSE → pi 事件映射 ====================

function typesOf(events: AssistantMessageEvent[]): string[] {
  return events.map((e) => e.type)
}

describe('GeminiStreamMapper', () => {
  it('文本 part → text_delta；finishReason STOP → done(stop)', () => {
    const mapper = new GeminiStreamMapper('p-gemini', 'gemini-test')
    const events: AssistantMessageEvent[] = []
    const feed = (data: string) => events.push(...mapper.handleData(data))

    feed(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: '你' }, { text: '好' }] },
            finishReason: 'STOP',
          },
        ],
      }),
    )
    const done = mapper.finish('stop')
    events.push(done)

    expect(typesOf(events)).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'done'])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['你', '好'])
    if (done.type !== 'done') throw new Error('末事件须为 done')
    expect(done.reason).toBe('stop')
    expect(done.message).toMatchObject({
      api: 'google-generative-ai',
      provider: 'p-gemini',
      model: 'gemini-test',
    })
    expect(done.message.content[0]).toMatchObject({ type: 'text', text: '你好' })
  })

  it('思考 part（thought:true）→ thinking_delta；函数调用 part → toolcall_*', () => {
    const mapper = new GeminiStreamMapper('p', 'm')
    const events: AssistantMessageEvent[] = []
    const feed = (data: string) => events.push(...mapper.handleData(data))

    feed(JSON.stringify({ candidates: [{ content: { parts: [{ text: '想', thought: true }] } }] }))
    feed(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'demo.tool', args: { a: 1 } } }],
            },
            finishReason: 'TOOL_CALLS',
          },
        ],
      }),
    )
    const done = mapper.finish('stop')
    events.push(done)

    expect(typesOf(events)).toEqual([
      'start',
      'thinking_start',
      'thinking_delta',
      'toolcall_start',
      'toolcall_delta',
      'done',
    ])
    if (done.type !== 'done') throw new Error('末事件须为 done')
    expect(done.reason).toBe('toolUse')
    expect(done.message.content).toEqual([
      { type: 'thinking', thinking: '想' },
      { type: 'toolCall', id: 'call_1', name: 'demo.tool', arguments: { a: 1 } },
    ])
  })

  it('finishReason 映射：MAX_TOKENS → length；usageMetadata 入 usage', () => {
    const mapper = new GeminiStreamMapper('p', 'm')
    mapper.handleData(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
      }),
    )
    const done = mapper.finish('stop')
    if (done.type !== 'done') throw new Error('末事件须为 done')
    expect(done.reason).toBe('length')
    expect(done.message.usage).toMatchObject({ input: 7, output: 2, totalTokens: 9 })
  })

  it('无候选帧（纯 usage）不产生内容事件；ping 形状帧忽略', () => {
    const mapper = new GeminiStreamMapper('p', 'm')
    expect(mapper.handleData(JSON.stringify({ usageMetadata: { promptTokenCount: 1 } }))).toEqual([])
    expect(mapper.handleData(JSON.stringify({ candidates: [] }))).toEqual([])
    const done = mapper.finish('stop')
    expect(done.type).toBe('done')
  })

  it('非法 JSON / 非对象 JSON：抛 GeminiStreamError', () => {
    const mapper = new GeminiStreamMapper('p', 'm')
    expect(() => mapper.handleData('not-json')).toThrow(GeminiStreamError)
    expect(() => mapper.handleData('"str"')).toThrow(GeminiStreamError)
  })
})

// ==================== 与 SseParser 的分片边界集成 ====================

describe('Gemini SSE 分片边界（SseParser + 映射器）', () => {
  /** 用原始分片驱动 parser + mapper，返回全部协议事件 */
  function runChunks(chunks: string[]): AssistantMessageEvent[] {
    const parser = new SseParser()
    const mapper = new GeminiStreamMapper('p-gemini', 'gemini-test')
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

  it('半包：一条 JSON 拆成两个网络分片，内容不丢不重', () => {
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: '半包内容' }] } }] })
    const mid = Math.floor(payload.length / 2)
    const events = runChunks([`data: ${payload.slice(0, mid)}`, `${payload.slice(mid)}\n\n`])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['半包内容'])
  })

  it('多事件一包：一个网络分片含多条完整响应 JSON', () => {
    const events = runChunks([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '一' }] } }] })}\n\n` +
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '二' }] } }] })}\n\n`,
    ])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['一', '二'])
    // 同一条流的文本 part 并入同一文本块（与单响应内多 part 同口径）
    expect(typesOf(events).filter((t) => t === 'text_start')).toHaveLength(1)
  })

  it('心跳注释与空行：不产生事件不阻断', () => {
    const events = runChunks([
      ': keep-alive\n\n\n' +
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '心跳后' }] } }] })}\n\n`,
    ])
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['心跳后'])
  })

  it('流尾无空行：flush 尽力解析末条事件（不丢最后一段内容）', () => {
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: '尾段' }] } }] })
    const events = runChunks([`data: ${payload}`]) // 无结尾 \n\n
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(deltas).toEqual(['尾段'])
  })
})
