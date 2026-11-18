import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  useOrchestrations,
  reasonKey,
  statusKey,
  nodeStatusKey,
  parseReasonCode,
} from '@/composables/orchestration/useOrchestrations'
import { useOrchestrationPolling } from '@/composables/orchestration/useOrchestrationPolling'

function fakeContext(response: (command: string, args: Record<string, unknown>) => unknown) {
  const execute = vi.fn(async (command: string, args: Record<string, unknown>) =>
    response(command, args),
  )
  return { context: { commands: { execute } } as unknown as PluginContext, execute }
}

describe('useOrchestrations（命令映射）', () => {
  it('meta / list / get / 变更命令使用约定的命令名与入参', async () => {
    const { context, execute } = fakeContext((command) => {
      if (command === 'orchestration.list') return { orchestrations: [] }
      if (command === 'orchestration.meta') return { statuses: [] }
      return { id: 'o1', status: 'awaiting-approval' }
    })
    const api = useOrchestrations(context)

    await api.meta()
    await api.list()
    await api.list('p1')
    await api.get('o1')
    await api.create({
      projectId: 'p1',
      title: 't',
      goal: 'g',
      mode: 'manual',
    })
    await api.updatePlan('o1', {
      version: 1,
      title: 't',
      goal: 'g',
      maxParallel: 2,
      nodes: [],
    })
    await api.approve('o1')
    await api.start('o1')
    await api.pause('o1')
    await api.resume('o1')
    await api.cancel('o1')
    await api.retryNode('o1', 'n1')
    await api.skipNode('o1', 'n1')
    await api.events('o1', 3)

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      'orchestration.meta',
      'orchestration.list',
      'orchestration.list',
      'orchestration.get',
      'orchestration.create',
      'orchestration.update-plan',
      'orchestration.approve',
      'orchestration.start',
      'orchestration.pause',
      'orchestration.resume',
      'orchestration.cancel',
      'orchestration.retry-node',
      'orchestration.skip-node',
      'orchestration.events',
    ])
    expect(execute.mock.calls[1][1]).toEqual({})
    expect(execute.mock.calls[2][1]).toEqual({ projectId: 'p1' })
    expect(execute.mock.calls[11][1]).toEqual({ id: 'o1', nodeKey: 'n1' })
    expect(execute.mock.calls[13][1]).toEqual({ id: 'o1', afterSeq: 3 })
  })

  it('词表 key 与 reason 解析遵守 `<code>: <detail>` 约定', () => {
    expect(statusKey('awaiting-approval')).toBe('orchestration.status.awaiting-approval')
    expect(nodeStatusKey('awaiting-input')).toBe('orchestration.nodeStatus.awaiting-input')
    expect(reasonKey('scope-violation')).toBe('orchestration.reason.scope-violation')
    expect(parseReasonCode('scope-violation: secret.txt')).toBe('scope-violation')
    expect(parseReasonCode('something else')).toBeNull()
  })
})

describe('useOrchestrationPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('立即触发首拍、按间隔轮询、隐藏时暂停、终态停止', async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    const load = vi.fn(async () => false)
    const scope = effectScope()
    const polling = scope.run(() => useOrchestrationPolling({ load, intervalMs: 1000 }))!

    polling.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(polling.running.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(2)

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(2)

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(3)

    load.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(4)
    expect(polling.running.value).toBe(false)

    scope.stop()
  })

  it('stop 后不再触发；慢请求不堆叠', async () => {
    let resolveLoad: (() => void) | null = null
    const load = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = () => resolve(false)
        }),
    )
    const scope = effectScope()
    const polling = scope.run(() => useOrchestrationPolling({ load, intervalMs: 10 }))!

    polling.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(1)

    resolveLoad?.()
    await vi.advanceTimersByTimeAsync(0)
    polling.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(load).toHaveBeenCalledTimes(1)
    scope.stop()
  })
})
