/**
 * OpenAI 兼容适配器单测（票 08）
 *
 * 覆盖：URL 拼接、pi 消息 → OpenAI 消息映射、请求载荷形状、
 * SSE data → pi 事件映射（正文 / 思考 / 结束 / 非法 JSON）。
 * 协议同形自实现（不引用 ai-chatbox 源码，spec §5.2）。
 */
import { describe, it, expect } from 'vitest'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import {
  OpenAICompatStreamError,
  OpenAICompatStreamMapper,
  buildOpenAICompatChatRequest,
  joinChatCompletionsUrl,
  mapMessagesToOpenAI,
} from '@nest-shared/providers/openai-compat'
import type { Message } from '@earendil-works/pi-ai'

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
    api: 'openai-completions',
    provider: 'p1',
    model: 'm1',
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

describe('joinChatCompletionsUrl', () => {
  it('基础 base 拼接 /chat/completions', () => {
    expect(joinChatCompletionsUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })
  it('尾部斜杠归一', () => {
    expect(joinChatCompletionsUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })
  it('本地端点同样拼接', () => {
    expect(joinChatCompletionsUrl('http://127.0.0.1:8000/v1')).toBe(
      'http://127.0.0.1:8000/v1/chat/completions',
    )
  })
  it('已是完整端点则原样使用（不重复拼接）', () => {
    expect(joinChatCompletionsUrl('https://x.test/v1/chat/completions')).toBe(
      'https://x.test/v1/chat/completions',
    )
  })
})

describe('mapMessagesToOpenAI', () => {
  it('system / user / assistant 文本映射', () => {
    const mapped = mapMessagesToOpenAI([sys('S'), user('U'), assistant('A')])
    expect(mapped).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
      { role: 'assistant', content: 'A' },
    ])
  })

  it('assistant 纯工具调用轮：content 置 null + tool_calls', () => {
    const mapped = mapMessagesToOpenAI([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call_1',
            name: 't',
            arguments: { a: 1 },
          },
        ],
        api: 'openai-completions',
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
      },
    ])
    expect(mapped[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 't', arguments: '{"a":1}' } },
      ],
    })
  })

  it('toolResult → tool 角色（带 tool_call_id）', () => {
    const mapped = mapMessagesToOpenAI([
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 't',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
        timestamp: ts,
      },
    ])
    expect(mapped[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'ok' })
  })
})

describe('buildOpenAICompatChatRequest', () => {
  it('载荷形状：method/url/headers/body/stream/streamEvent', () => {
    const req = buildOpenAICompatChatRequest({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'm1',
      messages: [sys('S'), user('U')],
      streamEvent: 'assistant:stream:s1',
    })
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://api.example.com/v1/chat/completions')
    expect(req.headers).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    })
    expect(req.stream).toBe(true)
    expect(req.streamEvent).toBe('assistant:stream:s1')
    const body = JSON.parse(req.body!)
    expect(body).toEqual({
      model: 'm1',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' },
      ],
      stream: true,
    })
  })
})

describe('OpenAICompatStreamMapper（SSE → pi 事件）', () => {
  function collect(datas: string[]): AssistantMessageEvent[] {
    const mapper = new OpenAICompatStreamMapper('p1', 'm1')
    const out: AssistantMessageEvent[] = []
    for (const d of datas) out.push(...mapper.handleData(d))
    return out
  }

  it('首帧发 start；正文增量映射 text_start / text_delta', () => {
    const events = collect([
      '{"choices":[{"delta":{"content":"你"}}]}',
      '{"choices":[{"delta":{"content":"好"}}]}',
    ])
    expect(events[0].type).toBe('start')
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas.map((e) => (e as { delta: string }).delta)).toEqual(['你', '好'])
    expect(events.some((e) => e.type === 'text_start')).toBe(true)
  })

  it('reasoning_content 映射 thinking 事件', () => {
    const events = collect(['{"choices":[{"delta":{"reasoning_content":"想"}}]}'])
    expect(events.some((e) => e.type === 'thinking_start')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(true)
  })

  it('[DONE] 收尾为 done 事件（reason stop）', () => {
    const mapper = new OpenAICompatStreamMapper('p1', 'm1')
    mapper.handleData('{"choices":[{"delta":{"content":"x"},"finish_reason":null}]}')
    const done = mapper.handleData('[DONE]')
    expect(done).toHaveLength(1)
    expect(done[0].type).toBe('done')
    if (done[0].type === 'done') {
      expect(done[0].reason).toBe('stop')
      expect(done[0].message.content[0]).toMatchObject({ type: 'text', text: 'x' })
    }
  })

  it('finish_reason=length 映射 stopReason length', () => {
    const mapper = new OpenAICompatStreamMapper('p1', 'm1')
    mapper.handleData('{"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}')
    const done = mapper.handleData('[DONE]')
    if (done[0].type === 'done') expect(done[0].reason).toBe('length')
  })

  it('非法 JSON 抛 OpenAICompatStreamError（由 StreamFn 编码为 error 事件）', () => {
    const mapper = new OpenAICompatStreamMapper('p1', 'm1')
    expect(() => mapper.handleData('not-json')).toThrow(OpenAICompatStreamError)
  })

  it('usage 帧（无 choices）不产出内容事件但更新用量', () => {
    const mapper = new OpenAICompatStreamMapper('p1', 'm1')
    const events = mapper.handleData(
      '{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    )
    expect(events).toEqual([])
    const done = mapper.handleData('[DONE]')
    if (done[0].type === 'done') {
      expect(done[0].message.usage.input).toBe(10)
      expect(done[0].message.usage.output).toBe(5)
    }
  })
})
