// @vitest-environment node

/**
 * 桥接扩展脚本的运行时测试（假宿主 HTTP + 假 agent API）
 *
 * 随包脚本没有编译期检查（agent 运行时直接加载 TS），语法/拼写/协议接线的错
 * 只会在真实 agent 里静默失效。这里用 Node 直接加载真实脚本：
 * - 假 `fetch` 扮演插件回环路由，记账 run-events / run-commands / ack；
 * - 假 pi / opencode API 扮演 agent 侧，验证命令执行分支；
 * - 假定时器推进 150ms 合批与 500ms 轮询。
 *
 * 断言的是协议行为（发了什么、什么时候发、命令怎么落），不是脚本内部结构。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface CapturedCall {
  url: string
  body: Record<string, unknown>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 假回环宿主：run-attach 列表态返回可服务运行、绑定价返回绑定运行；
 *  命令批次按顺序在 run-commands 轮询里投放 */
function installHost(commands: unknown[][] = [], attachRunId: string | null = 'run-attach-1') {
  const calls: CapturedCall[] = []
  let poll = 0
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url: target, body })
    if (target.endsWith('/run-attach')) {
      return body.agentSessionId
        ? jsonResponse({ code: 0, message: 'ok', data: { runId: attachRunId } })
        : jsonResponse({ code: 0, message: 'ok', data: { runIds: [attachRunId] } })
    }
    if (target.endsWith('/run-commands')) {
      const batch = commands[poll] ?? []
      poll += 1
      return jsonResponse({ code: 0, message: 'ok', data: { commands: batch } })
    }
    return jsonResponse({ code: 0, message: 'ok', data: {} })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

function eventPosts(calls: CapturedCall[]): Array<Record<string, unknown>>[] {
  return calls
    .filter((call) => call.url.endsWith('/run-events'))
    .map((call) => (call.body.events as Array<Record<string, unknown>>) ?? [])
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('WASMNEST_SESSION_ID', 'run-bridge-test')
})

afterEach(() => {
  // 扩展脚本会启动 500ms 命令轮询：必须在切回真实时钟前清掉，
  // 否则测试结束后仍会持续发请求（拖慢/污染整套测试）
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('wasmnest_bridge（pi）', () => {
  it('合批上行：流式快照按身份合并，任务状态仍走 task-status', async () => {
    const host = installHost()
    const module = await import('../../scripts/wasmnest_bridge_pi.ts?case=pi-relay')
    const handlers = new Map<string, (event: unknown) => void>()
    const sendUserMessage = vi.fn(async () => {})
    const pi = {
      on: (name: string, handler: (event: unknown) => void) => {
        handlers.set(name, handler)
        return () => {}
      },
      sendUserMessage,
    }
    module.default(pi)

    handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 1_792_100_000_000 })
    handlers.get('message_update')!({
      type: 'message_update',
      message: {
        role: 'assistant',
        timestamp: 1_792_100_000_001,
        content: [{ type: 'text', text: 'hello' }],
      },
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} },
    })
    handlers.get('message_update')!({
      type: 'message_update',
      message: {
        role: 'assistant',
        timestamp: 1_792_100_000_001,
        content: [{ type: 'text', text: 'hello world' }],
      },
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world', partial: {} },
    })
    handlers.get('agent_settled')!({ type: 'agent_settled', aborted: false })

    await vi.advanceTimersByTimeAsync(200)
    await flushMicrotasks()

    const batches = eventPosts(host.calls)
    expect(batches).toHaveLength(1)
    const events = batches[0]
    expect(events.map((event) => event.type)).toEqual([
      'turn_start',
      'agent_settled',
      'message_update',
    ])
    const update = events.find((event) => event.type === 'message_update')!
    expect(
      (update.message as { content: Array<{ text: string }> }).content[0].text,
    ).toBe('hello world')
    expect((update.assistantMessageEvent as { partial?: unknown }).partial).toBeUndefined()
    expect(events.every((event) => typeof event.time === 'number')).toBe(true)

    // 任务状态仍按原通道推送（agent_settled → completed）
    expect(
      host.calls.some(
        (call) =>
          call.url.endsWith('/task-status') && (call.body as { status?: string }).status === 'completed',
      ),
    ).toBe(true)
    expect(sendUserMessage).not.toHaveBeenCalled()
    handlers.get('session_shutdown')!({ type: 'session_shutdown', reason: 'quit' })
  })

  it('运行行尚未写入（404）不会永久停用桥接：下一拍继续轮询', async () => {
    let firstPoll = true
    const calls: CapturedCall[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url)
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        calls.push({ url: target, body })
        if (target.endsWith('/run-commands')) {
          if (firstPoll) {
            firstPoll = false
            return jsonResponse({ code: 404, message: 'run not found' }, 404)
          }
          return jsonResponse({
            code: 0,
            message: 'ok',
            data: { commands: [{ id: 3, kind: 'send', payload: { text: 'after-race' } }] },
          })
        }
        return jsonResponse({ code: 0, message: 'ok', data: {} })
      }),
    )
    const module = await import('../../scripts/wasmnest_bridge_pi.ts?case=pi-404')
    const sendUserMessage = vi.fn(async () => {})
    const handlers = new Map<string, (event: unknown) => void>()
    module.default({
      on: (name: string, handler: (event: unknown) => void) => {
        handlers.set(name, handler)
        return () => {}
      },
      sendUserMessage,
    })

    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    await flushMicrotasks()

    expect(sendUserMessage).toHaveBeenCalledWith('after-race')
    handlers.get('session_shutdown')!({ type: 'session_shutdown', reason: 'quit' })
  })

  it('命令下行：领取 send → pi.sendUserMessage → ack', async () => {
    const host = installHost([[{ id: 7, kind: 'send', payload: { text: '继续' } }]])
    const module = await import('../../scripts/wasmnest_bridge_pi.ts?case=pi-command')
    const sendUserMessage = vi.fn(async () => {})
    const handlers = new Map<string, (event: unknown) => void>()
    module.default({
      on: (name: string, handler: (event: unknown) => void) => {
        handlers.set(name, handler)
        return () => {}
      },
      sendUserMessage,
    })

    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    await flushMicrotasks()

    expect(sendUserMessage).toHaveBeenCalledWith('继续')
    const ack = host.calls.find((call) => call.url.endsWith('/run-commands-ack'))
    expect(ack?.body).toMatchObject({
      runId: 'run-bridge-test',
      results: [{ id: 7, ok: true }],
    })
    handlers.get('session_shutdown')!({ type: 'session_shutdown', reason: 'quit' })
  })
})

describe('wasmnest_bridge（opencode）', () => {
  it('事件上行：part 快照按身份合并，用户 text part 补 role', async () => {
    const host = installHost()
    const module = await import('../../scripts/wasmnest_bridge_opencode.ts?case=oc-relay')
    const prompt = vi.fn(async () => ({}))
    const hooks = await module.WasmNestBridge({ client: { session: { prompt } } })

    await hooks.event({
      event: {
        type: 'message.updated',
        properties: { sessionID: 'ses-1', info: { id: 'msg-1', role: 'user', sessionID: 'ses-1' } },
      },
    })
    for (const text of ['你', '你好']) {
      await hooks.event({
        event: {
          type: 'message.part.updated',
          properties: {
            sessionID: 'ses-1',
            part: { id: 'part-1', messageID: 'msg-1', sessionID: 'ses-1', type: 'text', text },
          },
        },
      })
    }
    await vi.advanceTimersByTimeAsync(200)
    await flushMicrotasks()

    const batches = eventPosts(host.calls)
    expect(batches).toHaveLength(1)
    const partEvents = batches[0].filter((event) => event.type === 'message.part.updated')
    expect(partEvents).toHaveLength(1, '同 part 的多帧只上行最新一帧')
    const part = (partEvents[0].properties as { part: { text: string; role?: string } }).part
    expect(part.text).toBe('你好')
    expect(part.role).toBe('user')
    expect(prompt).not.toHaveBeenCalled()
    await hooks.dispose?.()
  })

  it('命令下行：无事件时用 payload.agentSessionId 发送 → ack', async () => {
    const host = installHost([
      [
        {
          id: 9,
          kind: 'send',
          payload: { text: '继续', agentSessionId: 'ses-from-run' },
        },
      ],
    ])
    const module = await import('../../scripts/wasmnest_bridge_opencode.ts?case=oc-command')
    const prompt = vi.fn(async () => ({}))
    const hooks = await module.WasmNestBridge({ client: { session: { prompt } } })

    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    await flushMicrotasks()

    expect(prompt).toHaveBeenCalledWith({
      sessionID: 'ses-from-run',
      parts: [{ type: 'text', text: '继续' }],
    })
    const ack = host.calls.find((call) => call.url.endsWith('/run-commands-ack'))
    expect(ack?.body).toMatchObject({
      runId: 'run-bridge-test',
      results: [{ id: 9, ok: true }],
    })
    await hooks.dispose?.()
  })

  it('herdr 系构建兼容：default 导出 { id, server, setup }，server 挂同一插件函数', async () => {
    const module = await import('../../scripts/wasmnest_bridge_opencode.ts?case=oc-default')
    // 形状契约：这类构建在模块级校验 default（缺 default 整个文件拒载，
    // 服务端 WARN "Plugin must export a default definition"，桥接静默失效）
    expect(module.default).toMatchObject({
      id: 'wasmnest-bridge',
      server: module.WasmNestBridge,
    })
    expect(typeof module.default.setup).toBe('function')
    // 无 env（RUN_ID 空）时 setup 不引导：置空 env 后调用只拿到清理函数
    vi.stubEnv('WASMNEST_SESSION_ID', '')
    const noopCleanup = await module.default.setup({ event: {}, session: {} })
    expect(typeof noopCleanup).toBe('function')
  })

  it('V2 setup：run-attach 绑定 + 事件按项目目录过滤 + 命令按绑定运行轮询', async () => {
    const host = installHost([
      [{ id: 11, kind: 'send', payload: { text: '你好', agentSessionId: 'ses-v2' } }],
    ])
    const module = await import('../../scripts/wasmnest_bridge_opencode.ts?case=oc-v2')
    const prompt = vi.fn(async () => ({}))
    const CWD = '/home/user/proj'
    // 2.x 事件流形状：载荷在 data，顶层 location.directory 标注来源项目；
    // 他项目事件必须被过滤（服务总线是全量的）
    const events = (async function* () {
      yield {
        type: 'session.created',
        location: { directory: CWD },
        data: { sessionID: 'ses-v2', projectID: 'p1' },
      }
      yield {
        type: 'message.updated',
        location: { directory: '/home/user/other' },
        data: { sessionID: 'ses-foreign', info: { id: 'm-f', role: 'user' } },
      }
      yield {
        type: 'message.updated',
        location: { directory: CWD },
        data: { sessionID: 'ses-v2', info: { id: 'm1', role: 'user', sessionID: 'ses-v2' } },
      }
      // 挂起模拟持续事件流（清理走 abort 信号，测试进程随 afterEach 收尾）
      await new Promise(() => {})
    })()
    const cleanup = await module.default.setup({
      location: { directory: CWD },
      event: { subscribe: () => events },
      session: { prompt },
    })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    await flushMicrotasks()

    // attach 握手：列表态（cwd，心跳/轮询对象）随每拍发生；session.created 触发
    // 绑定价（cwd + agentSessionId + claim）
    const attachCalls = host.calls.filter((call) => call.url.endsWith('/run-attach'))
    expect(attachCalls.length).toBeGreaterThan(0)
    expect(attachCalls[0]?.body).toMatchObject({ cwd: CWD })
    const bindAttach = attachCalls.find(
      (call) => (call.body as { agentSessionId?: string }).agentSessionId === 'ses-v2',
    )
    expect(bindAttach?.body).toMatchObject({ cwd: CWD, agentSessionId: 'ses-v2', claim: true })
    // 事件上行带绑定到的运行 id；他项目会话（ses-foreign）不在批次里
    const eventPostsList = host.calls
      .filter((call) => call.url.endsWith('/run-events'))
      .map((call) => call.body as { runId: string; events: Array<Record<string, unknown>> })
    expect(eventPostsList.length).toBeGreaterThan(0)
    expect(eventPostsList.every((post) => post.runId === 'run-attach-1')).toBe(true)
    const relayedTypes = eventPostsList.flatMap((post) => post.events.map((e) => e.type))
    expect(relayedTypes).toContain('session.created')
    expect(relayedTypes).toContain('message.updated')
    expect(relayedTypes).not.toContain('message.part.updated')
    // 命令下行：按绑定运行轮询，2.x action 形状（根级 text），ack 回同一运行
    expect(prompt).toHaveBeenCalledWith({ sessionID: 'ses-v2', text: '你好' })
    const ack = host.calls.find((call) => call.url.endsWith('/run-commands-ack'))
    expect(ack?.body).toMatchObject({
      runId: 'run-attach-1',
      results: [{ id: 11, ok: true }],
    })
    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})
