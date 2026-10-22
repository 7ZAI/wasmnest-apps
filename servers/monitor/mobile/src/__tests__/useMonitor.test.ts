import { describe, it, expect, vi, afterEach } from 'vitest'
import { useMonitor } from '../composables/useMonitor'
import { makeContext, metrics, snapshot } from './fixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMonitor（移动端：1s 轮询 / 无宿主清单 / task 裁掉）', () => {
  it('refresh 输出行与 KPI，默认不收集 task', async () => {
    const execute = vi.fn(async () =>
      snapshot({ 'com.wasmnest.a': metrics({ calls_total: 2 }) }, { task: { jobsActive: 1 } }),
    )
    const m = useMonitor(makeContext(execute))

    await m.refresh()

    expect(execute).toHaveBeenCalledWith('monitor.snapshot')
    expect(m.rows.value.map((row) => row.id)).toEqual(['com.wasmnest.a'])
    expect(m.summary.value.callsTotal).toBe(2)
    expect(m.systems.value).toEqual([])
    expect(m.error.value).toBeNull()
  })

  it('失败保留旧数据并置 error（stale 语义）', async () => {
    let mode: 'ok' | 'fail' = 'ok'
    const execute = vi.fn(async () => {
      if (mode === 'fail') throw new Error('metrics:read denied')
      return snapshot({ a: metrics({ calls_total: 5 }) })
    })
    const m = useMonitor(makeContext(execute))

    await m.refresh()
    mode = 'fail'
    await m.refresh()

    expect(m.error.value).toContain('metrics:read denied')
    expect(m.rows.value[0].metrics.calls_total).toBe(5)
  })

  it('start 立即取一次并按周期刷新；stop 后停止', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const m = useMonitor(makeContext(execute), { intervalMs: 1000 })

    m.start()
    m.start() // 幂等
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledTimes(2)

    m.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('页面隐藏时跳过轮询刷新（不烧电量、不叠加请求）', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const execute = vi.fn(async () => snapshot({ a: metrics() }))
    const m = useMonitor(makeContext(execute), { intervalMs: 1000 })

    m.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(execute).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(execute).toHaveBeenCalledTimes(1)
    m.stop()
  })
  it('成功采样进入本次打开序列，失败不追加；上限 60 条', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let calls = 1
    let fail = false
    const execute = vi.fn(async () => {
      if (fail) throw new Error('metrics:read denied')
      return snapshot({ a: metrics({ calls_total: calls }) })
    })
    const m = useMonitor(makeContext(execute))

    await m.refresh()
    expect(m.samples.value).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    calls = 5
    await m.refresh()
    expect(m.samples.value).toHaveLength(2)
    expect(m.samples.value[1].callsTotal).toBe(5)

    fail = true
    await m.refresh()
    expect(m.samples.value).toHaveLength(2)

    fail = false
    for (let i = 0; i < 65; i++) {
      calls += 1
      await vi.advanceTimersByTimeAsync(1000)
      await m.refresh()
    }
    expect(m.samples.value).toHaveLength(60)
    expect(m.samples.value[0].callsTotal).toBe(11)
    expect(m.samples.value[59].callsTotal).toBe(70)
  })
})
