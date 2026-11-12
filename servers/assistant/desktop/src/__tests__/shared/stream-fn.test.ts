/**
 * StreamFn 单测（票 08 票面：不抛异常 / 中止编码 / 错误编码）
 *
 * pi-agent-core 契约：StreamFn 不得抛异常或返回 rejected promise，所有失败
 * 编码为协议 error 事件（stopReason error|aborted + errorMessage）。
 * 用假 invoke / 假 subscribe 驱动，覆盖：请求被拒、无 provider、用户中止
 * （流前 / 流中）、宿主错误帧、正常流收尾、退订。
 */
import { describe, it, expect, vi } from 'vitest'
import type { AssistantMessageEvent, TranscriptContext } from '@earendil-works/pi-ai'
import { createStreamFn, type StreamFnDeps } from '@nest-shared/agent/stream-fn'
import type { RequestContext } from '@nest-shared/agent/stream-fn'
import type { AssistantInvoke } from '@nest-shared/types'

const model = {
  id: 'm1',
  name: 'm1',
  api: 'openai-completions',
  provider: 'p1',
  baseUrl: 'https://example.test/v1',
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 128_000,
  maxTokens: 8_192,
}

const ctx = { messages: [] } as unknown as TranscriptContext

const CTX: RequestContext = {
  apiStyle: 'openai-compatible',
  apiKey: 'sk-test',
  baseUrl: 'https://example.test/v1',
  model: 'm1',
}

function makeDeps(overrides: Partial<StreamFnDeps> = {}) {
  const handlers: Array<{ event: string; handler: (payload: unknown) => void; disposed: boolean }> = []
  const subscribe = vi.fn((event: string, handler: (payload: unknown) => void) => {
    const entry = { event, handler, disposed: false }
    handlers.push(entry)
    return () => {
      entry.disposed = true
    }
  })
  const defaultInvoke = vi.fn(async () => ({ streamId: 's1', streamEvent: 'assistant:stream:s1' })) as unknown as AssistantInvoke
  const deps: StreamFnDeps = {
    invoke: defaultInvoke,
    subscribe,
    resolveRequestContext: vi.fn(async () => CTX),
    ...overrides,
  }
  return { deps, handlers, subscribe }
}

async function drain(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = []
  for await (const e of stream) events.push(e)
  return events
}

/** 启动流并开始消费，返回 pump 与句柄（便于中途触发事件） */
async function start(deps: StreamFnDeps, signal?: AbortSignal) {
  const stream = await createStreamFn(deps)(model as never, ctx, signal ? { signal } : undefined)
  const pump = drain(stream)
  return { stream, pump }
}

describe('createStreamFn（票 08 不抛异常契约）', () => {
  it('请求被拒：编码 error 事件（stopReason error），不抛', async () => {
    const rejectedInvoke = vi.fn(async () => {
      throw new Error('http_fetch failed: network unreachable')
    }) as unknown as AssistantInvoke
    const { deps } = makeDeps({ invoke: rejectedInvoke })
    const { pump } = await start(deps)
    const events = await pump

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    if (events[0].type === 'error') {
      expect(events[0].reason).toBe('error')
      expect(events[0].error.stopReason).toBe('error')
      expect(events[0].error.errorMessage).toContain('network unreachable')
    }
  })

  it('无可用 provider：编码 error 事件并点名缺什么', async () => {
    const { deps } = makeDeps({ resolveRequestContext: vi.fn(async () => null) })
    const { pump } = await start(deps)
    const events = await pump

    expect(events[0].type).toBe('error')
    if (events[0].type === 'error') {
      expect(events[0].error.errorMessage).toContain('provider')
    }
  })

  it('流开始前中止：编码 aborted 事件', async () => {
    const controller = new AbortController()
    controller.abort()
    const { deps } = makeDeps()
    const { pump } = await start(deps, controller.signal)
    const events = await pump

    expect(events[0].type).toBe('error')
    if (events[0].type === 'error') {
      expect(events[0].reason).toBe('aborted')
      expect(events[0].error.stopReason).toBe('aborted')
    }
  })

  it('流中中止：停止推送并编码 aborted（不产出 done）', async () => {
    const controller = new AbortController()
    const { deps, handlers } = makeDeps()
    const { pump } = await start(deps, controller.signal)

    handlers[0].handler({ chunk: 'data: {"choices":[{"delta":{"content":"你"}}]}\n\n', done: false })
    await Promise.resolve()
    controller.abort()

    const events = await pump
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    const last = events[events.length - 1]
    expect(last.type).toBe('error')
    if (last.type === 'error') expect(last.reason).toBe('aborted')
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('宿主错误帧：编码 error 事件（原文上交，不吞）', async () => {
    const { deps, handlers } = makeDeps()
    const { pump } = await start(deps)

    handlers[0].handler({ error: 'API error 401: invalid key', done: true })
    const events = await pump

    expect(events[0].type).toBe('error')
    if (events[0].type === 'error') {
      expect(events[0].error.errorMessage).toContain('API error 401')
    }
  })

  it('正常流：chunk → 文本事件 → done 收尾，事件名与受理回显一致', async () => {
    const { deps, handlers, subscribe } = makeDeps()
    const { pump } = await start(deps)

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(handlers[0].event).toBe('assistant:stream:s1')

    handlers[0].handler({ chunk: 'data: {"choices":[{"delta":{"content":"你"}}]}\n\n', done: false })
    handlers[0].handler({ chunk: 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n', done: false })
    handlers[0].handler({ done: true })

    const events = await pump
    expect(events[0].type).toBe('start')
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta)
    expect(text).toEqual(['你', '好'])
    const last = events[events.length - 1]
    expect(last.type).toBe('done')
    if (last.type === 'done') {
      expect(last.message.content[0]).toMatchObject({ type: 'text', text: '你好' })
    }
    // 收尾后退订
    expect(handlers[0].disposed).toBe(true)
  })

  it('chat-stream 命令入参：streamId 与 streamEvent 精确匹配（Rust 校验口径）', async () => {
    const invokeMock = vi.fn(async (_command: string, _args?: Record<string, unknown>) => ({ streamId: 's1', streamEvent: 'assistant:stream:s1' }))
    const invoke = invokeMock as unknown as AssistantInvoke
    const { deps, handlers } = makeDeps({ invoke })
    const { pump } = await start(deps)

    handlers[0].handler({ done: true })
    await pump

    const [command, rawArgs] = invokeMock.mock.calls[0]
    expect(command).toBe('assistant.chat-stream')
    const args = rawArgs as { streamId: string; request: { stream: boolean; streamEvent: string } }
    expect(args.streamId).toBeTruthy()
    expect(args.request.stream).toBe(true)
    expect(args.request.streamEvent).toBe(`assistant:stream:${args.streamId}`)
  })
})
