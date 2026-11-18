import { describe, it, expect } from 'vitest'
import type { PluginRow, RuntimeSample } from '../types'
import {
  formatCompact,
  formatRate,
  platformTotals,
  quotaMemoryOf,
  ratePerSecond,
  sampleElapsedMs,
  taskCountersOf,
  topMemoryConsumers,
} from '../utils/platform'
import { metrics, snapshot } from './fixtures'

function sample(overrides: Partial<RuntimeSample> & { at: number }): RuntimeSample {
  return { callsTotal: 0, callsInFlight: 0, trapsTotal: 0, ...overrides }
}

function row(overrides: Partial<PluginRow> & { id: string }): PluginRow {
  return {
    name: overrides.id,
    kind: 'business-app',
    state: 'running',
    stateRaw: 'activated',
    metricsAvailable: true,
    metrics: metrics(),
    ...overrides,
  }
}

describe('quotaMemoryOf（配额口径）', () => {
  it('只认正数；缺失 / 0 / 非数字 → null（不把「无上限」当 0 上限）', () => {
    expect(quotaMemoryOf(metrics({ quota: { memory_bytes: 1024 } }))).toBe(1024)
    expect(quotaMemoryOf(metrics({ quota: {} }))).toBeNull()
    expect(quotaMemoryOf(metrics({ quota: { memory_bytes: 0 } }))).toBeNull()
    expect(quotaMemoryOf(null)).toBeNull()
  })
})

describe('ratePerSecond（相邻采样速率）', () => {
  it('正常增量按秒折算', () => {
    expect(ratePerSecond(100, 400, 1000)).toBe(300)
    expect(ratePerSecond(0, 10, 500)).toBe(20)
  })

  it('计数回退 / 间隔过短 / 缺基线 → null（不补 0 冒充连续）', () => {
    expect(ratePerSecond(400, 100, 1000)).toBeNull()
    expect(ratePerSecond(0, 1, 100)).toBeNull()
    expect(ratePerSecond(undefined, 10, 1000)).toBeNull()
    expect(ratePerSecond(0, 10, null)).toBeNull()
  })

  it('sampleElapsedMs：不足两点 → null', () => {
    expect(sampleElapsedMs([])).toBeNull()
    expect(sampleElapsedMs([sample({ at: 1000 })])).toBeNull()
    expect(sampleElapsedMs([sample({ at: 1000 }), sample({ at: 4000 })])).toBe(3000)
  })
})

describe('platformTotals（平台合计）', () => {
  it('求和内存 / 配额 / 计数，比值按配额之和', () => {
    const totals = platformTotals(
      snapshot({
        a: metrics({
          memory_current_bytes: 600,
          memory_peak_bytes: 800,
          quota: { memory_bytes: 1000 },
          calls_total: 3,
          calls_in_flight: 1,
          fuel_consumed_total: 120,
          trap_reasons: { fuel_exhausted: 1 },
        }),
        b: metrics({
          memory_current_bytes: 400,
          memory_peak_bytes: 500,
          quota: { memory_bytes: 1000 },
          calls_total: 2,
          fuel_consumed_total: 80,
          trap_reasons: { other: 2 },
        }),
      }),
    )

    expect(totals).toMatchObject({
      pluginCount: 2,
      memoryCurrentBytes: 1000,
      memoryPeakBytes: 1300,
      memoryQuotaBytes: 2000,
      memoryRatio: 0.5,
      callsTotal: 5,
      callsInFlight: 1,
      fuelTotal: 200,
      trapsTotal: 3,
      fuelPerSecond: null,
      callsPerSecond: null,
    })
  })

  it('快照没有配额 → 比值 null（不是 0%）', () => {
    const totals = platformTotals(snapshot({ a: metrics({ memory_current_bytes: 10 }) }))
    expect(totals.memoryQuotaBytes).toBe(0)
    expect(totals.memoryRatio).toBeNull()
  })

  it('空 / null 快照 → 全 0，不抛错', () => {
    expect(platformTotals(null).pluginCount).toBe(0)
    expect(platformTotals(snapshot({})).memoryCurrentBytes).toBe(0)
  })

  it('速率取最后两个采样；计数回退落 null', () => {
    const snap = snapshot({ a: metrics({ calls_total: 300, fuel_consumed_total: 900 }) })
    const rising = platformTotals(snap, [
      sample({ at: 1000, callsTotal: 100, fuelTotal: 300 }),
      sample({ at: 2000, callsTotal: 300, fuelTotal: 900 }),
    ])
    expect(rising.callsPerSecond).toBe(200)
    expect(rising.fuelPerSecond).toBe(600)

    const reset = platformTotals(snap, [
      sample({ at: 1000, callsTotal: 300, fuelTotal: 900 }),
      sample({ at: 2000, callsTotal: 100, fuelTotal: 100 }),
    ])
    expect(reset.callsPerSecond).toBeNull()
    expect(reset.fuelPerSecond).toBeNull()
  })
})

describe('topMemoryConsumers（内存排行）', () => {
  it('按当前占用降序，跳过无指标 / 零占用，share 用平台合计', () => {
    const rows = [
      row({ id: 'a', name: 'A', metrics: metrics({ memory_current_bytes: 300 }) }),
      row({ id: 'b', name: 'B', metrics: metrics({ memory_current_bytes: 600 }) }),
      row({ id: 'c', name: 'C', metrics: metrics({ memory_current_bytes: 100 }) }),
      row({ id: 'zero', metrics: metrics({ memory_current_bytes: 0 }) }),
      row({ id: 'off', metricsAvailable: false, metrics: metrics({ memory_current_bytes: 999 }) }),
    ]

    const top = topMemoryConsumers(rows, 2, 1000)
    expect(top.map((item) => item.id)).toEqual(['b', 'a'])
    expect(top[0].share).toBeCloseTo(0.6)
    expect(top[1].share).toBeCloseTo(0.3)
  })

  it('没有平台合计时回落为排行内部之和；全零 → share null', () => {
    const rows = [
      row({ id: 'a', metrics: metrics({ memory_current_bytes: 100 }) }),
      row({ id: 'b', metrics: metrics({ memory_current_bytes: 300 }) }),
    ]
    expect(topMemoryConsumers(rows, 3)[0].share).toBeCloseTo(0.75)
    expect(topMemoryConsumers([], 3)[0]).toBeUndefined()
  })
})

describe('taskCountersOf（宿主任务池）', () => {
  it('读 camelCase 累计计数', () => {
    expect(
      taskCountersOf(snapshot({}, { task: { jobsRejectedTotal: 2, eventsDroppedTotal: 3 } })),
    ).toEqual({ rejectedTotal: 2, droppedTotal: 3 })
  })

  it('没有 task 段 / 字段非数字 → 缺省（不是 0，避免差分误判）', () => {
    expect(taskCountersOf(snapshot({}))).toEqual({})
    expect(taskCountersOf(snapshot({}, { task: { jobsRejectedTotal: '2' } }))).toEqual({})
    expect(taskCountersOf(null)).toEqual({})
  })
})

describe('紧凑格式化', () => {
  it('formatCompact / formatRate：缺失 → —；大数用紧凑单位', () => {
    expect(formatCompact(null)).toBe('—')
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(1_500_000)).toBe('1.5M')
    expect(formatRate(null)).toBe('—')
    expect(formatRate(1234.6)).toBe('1.2K')
  })
})
