import { describe, it, expect, vi, afterEach } from 'vitest'
import { useMonitor } from '../composables/useMonitor'
import { makeContext, info, metrics, snapshot } from './fixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMonitor（桌面：1s 轮询 + 宿主清单合并）', () => {
  it('refresh 合并指标与宿主清单，并输出 KPI / 系统段', async () => {
    const execute = vi.fn(async () =>
      snapshot({ 'com.wasmnest.a': metrics({ calls_total: 2 }) }, { task: { jobsActive: 1 } }),
    )
    const hostInvoke = vi.fn(async () => [info({ id: 'com.wasmnest.a', name: 'App A' })])
    const m = useMonitor(makeContext(execute, hostInvoke))

    await m.refresh()

    expect(execute).toHaveBeenCalledWith('monitor.snapshot')
    expect(hostInvoke).toHaveBeenCalledWith('plugin_list_loaded')
    expect(m.rows.value).toHaveLength(1)
    expect(m.rows.value[0].name).toBe('App A')
    expect(m.rows.value[0].state).toBe('running')
    expect(m.summary.value.callsTotal).toBe(2)
    expect(m.systems.value.map((s) => s.id)).toEqual(['task'])
    expect(m.error.value).toBeNull()
    expect(m.lastUpdated.value).toBeTypeOf('number')
  })

  it('宿主清单失败是软失败：指标仍出，状态落 unknown 并暴露告警', async () => {
    const execute = vi.fn(async () => snapshot({ a: metrics({ calls_total: 7 }) }))
    const hostInvoke = vi.fn(async () => {
      throw new Error('registry unavailable')
    })
    const m = useMonitor(makeContext(execute, hostInvoke))

    await m.refresh()

    expect(m.rows.value[0].state).toBe('unknown')
    expect(m.rows.value[0].metrics.calls_total).toBe(7)
    expect(m.error.value).toBeNull()
    expect(m.hostInfoWarning.value).toContain('registry unavailable')
  })

  it('指标失败保留旧数据并置 error（stale 语义），不清空行', async () => {
    let mode: 'ok' | 'fail' = 'ok'
    const execute = vi.fn(async () => {
      if (mode === 'fail') throw new Error('metrics:read denied')
      return snapshot({ a: metrics({ calls_total: 3 }) })
    })
    const m = useMonitor(makeContext(execute), { withHostInfo: false })

    await m.refresh()
    expect(m.rows.value).toHaveLength(1)

    mode = 'fail'
    await m.refresh()
    expect(m.error.value).toContain('metrics:read denied')
    expect(m.rows.value).toHaveLength(1)
    expect(m.rows.value[0].metrics.calls_total).toBe(3)
  })

  it('start 立即取一次并按周期刷新；stop 后不再请求（卸载清理口径）', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const m = useMonitor(makeContext(execute), { intervalMs: 1000, withHostInfo: false })

    m.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)

    m.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('start 幂等：重复调用不会叠加定时器', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const m = useMonitor(makeContext(execute), { intervalMs: 1000, withHostInfo: false })

    m.start()
    m.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)
    m.stop()
  })

  it('在飞请求不堆叠：慢命令期间重复 refresh 只发一次', async () => {
    let resolveExecute: ((value: unknown) => void) | undefined
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveExecute = resolve
        }),
    )
    const m = useMonitor(makeContext(execute as never), { withHostInfo: false })

    const first = m.refresh()
    const second = m.refresh()
    expect(execute).toHaveBeenCalledTimes(1)

    resolveExecute?.(snapshot({ a: metrics() }))
    await Promise.all([first, second])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(m.rows.value).toHaveLength(1)
  })
})
