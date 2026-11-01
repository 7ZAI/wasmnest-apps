import { describe, it, expect } from 'vitest'
import {
  callRate,
  collectSystemSections,
  formatBytes,
  formatDurationUs,
  formatNumber,
  formatRatio,
  formatRate,
  normalizeSnapshot,
  platformTotals,
  ratePerSecond,
  shortPluginId,
  summarize,
  toRows,
} from '../utils/format'
import { metrics, snapshot } from './fixtures'

describe('normalizeSnapshot', () => {
  it('接受对象 / JSON 字符串；结构不合法抛错', () => {
    expect(Object.keys(normalizeSnapshot(snapshot({ a: metrics() })).plugins)).toEqual(['a'])
    expect(
      Object.keys(normalizeSnapshot(JSON.stringify(snapshot({ a: metrics() }))).plugins),
    ).toEqual(['a'])
    expect(() => normalizeSnapshot(null)).toThrow(/non-object/)
    expect(() => normalizeSnapshot({ task: {} })).toThrow(/missing the plugins section/)
    expect(() => normalizeSnapshot({ plugins: { bad: null } })).toThrow(
      /plugin metrics for "bad" is not an object/,
    )
  })
})

describe('shortPluginId（只剥固定前缀）', () => {
  it('剥 com.wasmnest. 前缀，其他原样返回', () => {
    expect(shortPluginId('com.wasmnest.ai-chatbox')).toBe('ai-chatbox')
    expect(shortPluginId('com.example.app')).toBe('com.example.app')
  })
})

describe('toRows / collectSystemSections', () => {
  it('行按 plugin_id 排序', () => {
    const rows = toRows(snapshot({ b: metrics(), a: metrics() }))
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('合并宿主 plugin_meta 的 name / kind（旧宿主缺省不伪造）', () => {
    const rows = toRows(
      snapshot(
        { b: metrics(), a: metrics() },
        {
          plugin_meta: {
            a: { name: 'Monitor', kind: 'internal-business' },
            b: { name: 'AI Chatbox', kind: 'business-app' },
          },
        },
      ),
    )
    expect(rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind }))).toEqual([
      { id: 'a', name: 'Monitor', kind: 'internal-business' },
      { id: 'b', name: 'AI Chatbox', kind: 'business-app' },
    ])
    const legacy = toRows(snapshot({ a: metrics() }))
    expect(legacy[0].name).toBeUndefined()
    expect(legacy[0].kind).toBeUndefined()
  })

  it('默认裁掉 task（移动端按端裁剪），其余对象段保留；plugin_meta 不作为系统段', () => {
    const snap = snapshot(
      { a: metrics() },
      { task: { jobsActive: 1 }, custom: { x: 1 }, plugin_meta: { a: { name: 'A' } }, n: 2 },
    )
    expect(collectSystemSections(snap).map((s) => s.id)).toEqual(['custom'])
  })

  it('默认裁掉 task（移动端按端裁剪），其余对象段保留', () => {
    const snap = snapshot({ a: metrics() }, { task: { jobsActive: 1 }, custom: { x: 1 }, n: 2 })
    expect(collectSystemSections(snap).map((s) => s.id)).toEqual(['custom'])
    expect(collectSystemSections(snap, { includeTask: true }).map((s) => s.id)).toEqual([
      'custom',
      'task',
    ])
  })
})

describe('格式化', () => {
  it('数字 / 字节 / 耗时 / 占比', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(undefined)).toBe('—')
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatDurationUs(1500)).toBe('1.50 ms')
    expect(formatRatio(0.25)).toBe('25.0%')
    expect(formatRatio(null)).toBe('—')
  })
})

describe('callRate（相邻采样差值）', () => {
  it('正常增量 / 其它间隔 / 回退与过短间隔', () => {
    expect(callRate(10, 30, 1000)).toBe(20)
    expect(callRate(10, 30, 500)).toBe(40)
    expect(callRate(30, 10, 1000)).toBeNull()
    expect(callRate(10, 30, 150)).toBeNull()
    expect(callRate(undefined, 30, 1000)).toBeNull()
  })
})

describe('summarize', () => {
  it('汇总插件数 / 调用 / 在飞 / 内存峰值 / trap', () => {
    expect(
      summarize(
        snapshot({
          a: metrics({
            calls_total: 3,
            calls_in_flight: 1,
            memory_peak_bytes: 100,
            trap_reasons: { other: 2 },
          }),
          b: metrics({ calls_total: 2, memory_peak_bytes: 200 }),
        }),
      ),
    ).toEqual({
      pluginCount: 2,
      callsTotal: 5,
      callsInFlight: 1,
      memoryPeakBytes: 300,
      trapsTotal: 2,
    })
  })
})

describe('platformTotals（平台合计）', () => {
  it('求和内存 / 配额 / 燃料，比值按配额之和；无配额 → null', () => {
    const totals = platformTotals(
      snapshot({
        a: metrics({ memory_current_bytes: 600, quota: { memory_bytes: 1000 } }),
        b: metrics({ memory_current_bytes: 400, quota: { memory_bytes: 1000 } }),
      }),
    )
    expect(totals.memoryCurrentBytes).toBe(1000)
    expect(totals.memoryQuotaBytes).toBe(2000)
    expect(totals.memoryRatio).toBe(0.5)

    const unbounded = platformTotals(snapshot({ a: metrics({ memory_current_bytes: 10 }) }))
    expect(unbounded.memoryQuotaBytes).toBe(0)
    expect(unbounded.memoryRatio).toBeNull()
  })

  it('速率取最后两个采样；计数回退 / 间隔过短 → null', () => {
    const snap = snapshot({ a: metrics({ calls_total: 300, fuel_consumed_total: 900 }) })
    const rising = platformTotals(snap, [
      { at: 1000, callsTotal: 100, callsInFlight: 0, trapsTotal: 0, fuelTotal: 300 },
      { at: 2000, callsTotal: 300, callsInFlight: 0, trapsTotal: 0, fuelTotal: 900 },
    ])
    expect(rising.callsPerSecond).toBe(200)
    expect(rising.fuelPerSecond).toBe(600)

    expect(ratePerSecond(300, 100, 1000)).toBeNull()
    expect(ratePerSecond(0, 1, 100)).toBeNull()
    expect(ratePerSecond(undefined, 10, 1000)).toBeNull()
    expect(formatRate(null)).toBe('—')
  })
})
