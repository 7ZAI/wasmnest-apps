/**
 * 运行事件账本读取面契约（ADR 0004 / issue #23 M3）
 *
 * 判据只落在外部行为：**命令进 → 状态出**。被测对象是 `useRunEvents`（真实现）
 * 与一个命令面桩 context，断言游标推进、同 seq 原地替换、满页续拉、换运行
 * 串账防护、终态停拍、错误显性上浮与发送的排队/回显闭环。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { mergeEvents, useRunEvents, type RunEvent } from '@/composables/useRunEvents'

type Handler = (args: any) => unknown

const execute = vi.fn()
let routes: Record<string, Handler>

function ledgerEvent(seq: number, kind: string, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { seq, at: '2026-10-30T10:00:00Z', kind, payload, source: 'bridge' }
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'r-1',
    truncated: false,
    cursor: 0,
    events: [],
    bridge: { connected: true, lastSeenAt: '2026-10-30T10:00:00Z' },
    ...overrides,
  }
}

function defaultRoutes(): Record<string, Handler> {
  return {
    'run.events': () => response({ cursor: 3, events: [ledgerEvent(1, 'user.message', { text: 'a' })] }),
    'run.send': () => ({ commandId: 42, runId: 'r-1' }),
  }
}

/** 最小 context 桩：useRunEvents 只用 commands.execute */
function makeContext(): PluginContext {
  return { commands: { execute } } as unknown as PluginContext
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  routes = defaultRoutes()
  execute.mockImplementation(async (id: string, args: any) => {
    const handler = routes[id]
    if (!handler) throw new Error(`unexpected command: ${id}`)
    return handler(args)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * 抽干在途微任务链（poll → fetchOnce → execute 的多级 await）：假定时器只
 * 推进宏任务，纯 promise 链要靠多次 microtask pump 才能落定。
 */
async function drain(pumps = 24): Promise<void> {
  for (let i = 0; i < pumps; i += 1) await Promise.resolve()
}

/** 组合式创建 + 首屏加载完成（watch immediate 的首拍消化完） */
async function setup(runIdValue: string | null = 'r-1') {
  const runId = ref<string | null>(runIdValue)
  const domain = useRunEvents(makeContext(), runId, { intervalMs: 1000, limit: 500 })
  await drain()
  return { runId, domain }
}

describe('mergeEvents（合并纯函数）', () => {
  it('同 seq 替换、新 seq 插入、输出按 seq 升序', () => {
    const a: RunEvent = { seq: 1, at: 't1', kind: 'assistant.text', payload: { text: '旧' }, source: 'bridge' }
    const a2: RunEvent = { seq: 1, at: 't2', kind: 'assistant.text', payload: { text: '新' }, source: 'bridge' }
    const b: RunEvent = { seq: 2, at: 't3', kind: 'tool.call', payload: {}, source: 'bridge' }
    const merged = mergeEvents([a], [b, a2])
    expect(merged.map((event) => event.seq)).toEqual([1, 2])
    expect(merged[0]!.payload).toEqual({ text: '新' })
    expect(merged).toHaveLength(2)
  })

  it('空增量返回等价副本（不改入参）', () => {
    const existing: RunEvent[] = [
      { seq: 5, at: 't', kind: 'status', payload: {}, source: 'bridge' },
    ]
    const merged = mergeEvents(existing, [])
    expect(merged).toEqual(existing)
    expect(merged).not.toBe(existing)
  })
})

describe('useRunEvents（取数与游标）', () => {
  it('首屏加载：run.events 入参（runId + afterId 0）→ 事件按 seq 落位、bridge/truncated 透传', async () => {
    const { domain } = await setup()
    expect(execute).toHaveBeenCalledWith('run.events', { runId: 'r-1', afterId: 0, limit: 500 })
    expect(domain.events.value).toHaveLength(1)
    expect(domain.events.value[0]).toMatchObject({ seq: 1, kind: 'user.message' })
    expect(domain.bridge.value).toEqual({
      connected: true,
      lastSeenAt: '2026-10-30T10:00:00Z',
    })
    expect(domain.truncated.value).toBe(false)
    expect(domain.loadError.value).toBeNull()
  })

  it('增量轮询：游标取响应给的 cursor；同 seq 新内容原地替换（不追加重复行）', async () => {
    const { domain } = await setup()
    routes['run.events'] = () =>
      response({
        cursor: 7,
        events: [
          ledgerEvent(1, 'assistant.text', { text: '同位置的新内容' }),
          ledgerEvent(4, 'tool.call', { callId: 'c1' }),
        ],
      })
    await vi.advanceTimersByTimeAsync(1000)
    await drain()

    expect(execute).toHaveBeenLastCalledWith('run.events', { runId: 'r-1', afterId: 3, limit: 500 })
    expect(domain.events.value.map((event) => event.seq)).toEqual([1, 4])
    expect(domain.events.value[0]!.payload).toEqual({ text: '同位置的新内容' })
    expect(domain.eventCount.value).toBe(2)
  })

  it('满页续拉：一拍内立即取下一页直到不满页', async () => {
    const fullPage = Array.from({ length: 2 }, (_, i) => ledgerEvent(i + 1, 'status', {}))
    let page = 0
    routes['run.events'] = () => {
      page += 1
      if (page === 1) return response({ cursor: 2, events: fullPage })
      return response({ cursor: 3, events: [ledgerEvent(3, 'status', {})] })
    }
    const runId = ref('r-1')
    const domain = useRunEvents(makeContext(), runId, { intervalMs: 1000, limit: 2 })
    await drain()
    expect(execute.mock.calls.filter((call) => call[0] === 'run.events')).toHaveLength(2)
    expect(domain.events.value.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('truncated 与桥接离线随响应透传（镜像模式判据）', async () => {
    routes['run.events'] = () =>
      response({ truncated: true, bridge: { connected: false, lastSeenAt: null } })
    const { domain } = await setup()
    expect(domain.truncated.value).toBe(true)
    expect(domain.bridge.value).toEqual({ connected: false, lastSeenAt: null })
  })

  it('读取失败显性上浮 loadError；retry 清错误续拉', async () => {
    routes['run.events'] = () => {
      throw new Error('run not found')
    }
    const { domain } = await setup()
    expect(domain.loadError.value).toBe('run not found')
    expect(domain.loading.value).toBe(false)

    routes['run.events'] = () => response({ cursor: 1, events: [ledgerEvent(1, 'status', {})] })
    await domain.retry()
    expect(domain.loadError.value).toBeNull()
    expect(domain.events.value).toHaveLength(1)
  })

  it('形状不对的行丢弃，不炸整个对话面', async () => {
    routes['run.events'] = () =>
      response({
        cursor: 3,
        events: [
          { seq: 'x', kind: 'user.message' },
          { seq: 2 },
          ledgerEvent(3, 'status', {}),
        ],
      })
    const { domain } = await setup()
    expect(domain.events.value.map((event) => event.seq)).toEqual([3])
  })
})

describe('useRunEvents（换运行与终态）', () => {
  it('换运行：重置旧账本、加载新账本；旧运行的在途响应被丢弃', async () => {
    let slowFirst = true
    routes['run.events'] = (args: any) => {
      if (args.runId === 'r-1' && slowFirst) {
        slowFirst = false
        // 旧运行响应悬挂：换运行后才 resolve，必须整批丢弃
        return new Promise((resolve) =>
          setTimeout(() => resolve(response({ cursor: 9, events: [ledgerEvent(9, 'status', {})] })), 5000),
        )
      }
      if (args.runId === 'r-2') return response({ cursor: 2, events: [ledgerEvent(1, 'user.message', { text: 'r2' })] })
      return response()
    }
    const { runId, domain } = await setup()
    runId.value = 'r-2'
    await nextTick()
    await drain()
    expect(domain.events.value).toHaveLength(1)
    expect(domain.events.value[0]!.payload).toEqual({ text: 'r2' })

    // 旧响应此刻到达：不得串进 r-2 的账本
    await vi.advanceTimersByTimeAsync(5000)
    expect(domain.events.value.map((event) => event.seq)).toEqual([1])
  })

  it('终态（active 翻假）：停拍前补最后一拍，之后 ticker 不再发请求', async () => {
    const active = ref(true)
    const runId = ref('r-1')
    const domain = useRunEvents(makeContext(), runId, { active, intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterLoad = execute.mock.calls.length

    active.value = false
    await nextTick()
    await drain()
    const callsAfterFinal = execute.mock.calls.length
    expect(callsAfterFinal).toBeGreaterThan(callsAfterLoad, '终态前补一拍收尾')

    await vi.advanceTimersByTimeAsync(5000)
    expect(execute.mock.calls.length).toBe(callsAfterFinal, '停拍后不再轮询')
    void domain
  })
})

describe('useRunEvents（发送与回显）', () => {
  it('sendText：run.send 入参（trim 后文本）→ 本地「排队中」气泡；事件流回显同文本后摘除', async () => {
    const { domain } = await setup()
    await domain.sendText('  继续  ')
    expect(execute).toHaveBeenCalledWith('run.send', { runId: 'r-1', text: '继续' })
    expect(domain.pending.value).toHaveLength(1)
    expect(domain.pending.value[0]!.text).toBe('继续')

    // 下一拍事件流带回同一文本的 user.message → 气泡收掉
    routes['run.events'] = () =>
      response({ cursor: 5, events: [ledgerEvent(5, 'user.message', { text: '继续' })] })
    await vi.advanceTimersByTimeAsync(1000)
    await drain()
    expect(domain.pending.value).toHaveLength(0)
    // 回显的事件本身仍进账本
    expect(domain.events.value.some((event) => event.seq === 5)).toBe(true)
  })

  it('sendText 失败：原样上抛、不产生本地气泡', async () => {
    routes['run.send'] = () => {
      throw new Error('run.send: bridge unavailable (mirror mode)')
    }
    const { domain } = await setup()
    await expect(domain.sendText('hi')).rejects.toThrow('mirror mode')
    expect(domain.pending.value).toHaveLength(0)
  })

  it('空文本 / 无运行不发命令', async () => {
    const { runId, domain } = await setup()
    await domain.sendText('   ')
    expect(execute.mock.calls.some((call) => call[0] === 'run.send')).toBe(false)

    runId.value = null
    await nextTick()
    const before = execute.mock.calls.length
    await domain.sendText('hi')
    expect(execute.mock.calls.length).toBe(before)
  })
})

describe('useRunEvents（生命周期）', () => {
  it('dispose：停拍 + 在途响应丢弃；runId 置 null 停拍且清空账本', async () => {
    const { runId, domain } = await setup()
    runId.value = null
    await nextTick()
    expect(domain.events.value).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute.mock.calls.every((call) => call[1].runId === 'r-1')).toBe(true, '置空后不再发请求')

    runId.value = 'r-1'
    await nextTick()
    await drain()
    expect(domain.events.value.length).toBeGreaterThan(0)
    domain.dispose()
    const before = execute.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute.mock.calls.length).toBe(before)
  })
})
