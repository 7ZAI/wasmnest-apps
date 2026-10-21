import { describe, it, expect, vi } from 'vitest'
import {
  averageUs,
  callRate,
  collectSystemSections,
  describeError,
  displayStateOf,
  formatBytes,
  formatDurationUs,
  formatNumber,
  formatRatio,
  formatUnixTime,
  latestLifecycle,
  mergePluginRows,
  nonZeroEntries,
  normalizeSnapshot,
  sumValues,
  summarize,
  usageRatio,
} from '../utils/format'
import { info, metrics, snapshot } from './fixtures'

describe('normalizeSnapshot（fail-visible 的结构校验）', () => {
  it('接受对象载荷', () => {
    const snap = snapshot({ a: metrics() })
    expect(normalizeSnapshot(snap)).toBe(snap)
  })

  it('接受 JSON 字符串载荷', () => {
    const parsed = normalizeSnapshot(JSON.stringify(snapshot({ a: metrics() })))
    expect(Object.keys(parsed.plugins)).toEqual(['a'])
  })

  it('非对象 / 缺 plugins 段 / 非法 JSON 一律抛明确错误', () => {
    expect(() => normalizeSnapshot(null)).toThrow(/non-object/)
    expect(() => normalizeSnapshot([])).toThrow(/non-object/)
    expect(() => normalizeSnapshot({ task: {} })).toThrow(/missing the plugins section/)
    expect(() => normalizeSnapshot({ plugins: { bad: null } })).toThrow(
      /plugin metrics for "bad" is not an object/,
    )
    expect(() => normalizeSnapshot('{bad json')).toThrow(/invalid JSON/)
  })
})

describe('displayStateOf（宿主状态 → 壳展示态）', () => {
  it.each([
    ['activated', 'running'],
    ['degraded', 'degraded'],
    ['needsApproval', 'approval'],
    ['error', 'error'],
    ['loaded', 'dormant'],
    ['activating', 'dormant'],
    ['deactivated', 'dormant'],
    ['whatever', 'unknown'],
    [undefined, 'unknown'],
  ])('%s → %s', (raw, expected) => {
    expect(displayStateOf(raw as string | undefined)).toBe(expected)
  })
})

describe('mergePluginRows（指标 + 宿主清单）', () => {
  it('合并名称 / 状态，并按「运行中 → 需关注 → 未运行 / 未知」排序', () => {
    const rows = mergePluginRows(
      snapshot({
        'com.wasmnest.dormant': metrics(),
        'com.wasmnest.running': metrics(),
        'com.wasmnest.error': metrics(),
        'com.wasmnest.missing': metrics(),
      }),
      [
        info({ id: 'com.wasmnest.dormant', name: 'Dormant', state: { state: 'deactivated' } }),
        info({ id: 'com.wasmnest.running', name: 'Running', state: { state: 'activated' } }),
        info({
          id: 'com.wasmnest.error',
          name: 'Broken',
          state: { state: 'error', error: 'boom' },
        }),
      ],
    )
    expect(rows.map((row) => row.id)).toEqual([
      'com.wasmnest.running',
      'com.wasmnest.error',
      'com.wasmnest.dormant',
      'com.wasmnest.missing',
    ])
    expect(rows[1].state).toBe('error')
    expect(rows[1].stateError).toBe('boom')
    // 清单里没有的插件：名称回落 plugin_id，状态 unknown（不冒充未运行）
    expect(rows[3].name).toBe('com.wasmnest.missing')
    expect(rows[3].state).toBe('unknown')
  })

  it('宿主清单为空 / null：全部按 unknown 展示，指标仍完整', () => {
    for (const infos of [null, undefined, []]) {
      const rows = mergePluginRows(
        snapshot({ 'com.wasmnest.a': metrics({ calls_total: 3 }) }),
        infos,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].state).toBe('unknown')
      expect(rows[0].metrics.calls_total).toBe(3)
    }
  })

  it('兼容宿主清单 state 为字符串的旧形状', () => {
    const rows = mergePluginRows(snapshot({ a: metrics() }), [
      info({ id: 'a', state: 'activated' }),
    ])
    expect(rows[0].state).toBe('running')
  })
})

describe('collectSystemSections（系统维度段）', () => {
  it('排除插件保留段，收集对象段；includeTask=false 时裁掉 task', () => {
    const snap = snapshot(
      { a: metrics() },
      { task: { jobsActive: 1 }, custom: { x: 2 }, scalar: 3 },
    )
    expect(collectSystemSections(snap).map((s) => s.id)).toEqual(['custom', 'task'])
    expect(collectSystemSections(snap, { includeTask: false }).map((s) => s.id)).toEqual(['custom'])
    expect(collectSystemSections(snap).find((s) => s.id === 'task')?.data).toEqual({
      jobsActive: 1,
    })
  })
})

describe('数值 / 时间格式化', () => {
  it('formatNumber：千分位；缺失 / 非有限值 → —', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
  })

  it('formatBytes：B / KiB / MiB / GiB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatBytes(1536)).toBe('1.50 KiB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MiB')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GiB')
    expect(formatBytes(undefined)).toBe('—')
  })

  it('formatDurationUs：µs / ms / s', () => {
    expect(formatDurationUs(500)).toBe('500 µs')
    expect(formatDurationUs(1500)).toBe('1.50 ms')
    expect(formatDurationUs(1_500_000)).toBe('1.50 s')
    expect(formatDurationUs(null)).toBe('—')
  })

  it('averageUs / usageRatio：除零返回 null，不伪造 0', () => {
    expect(averageUs(1000, 4)).toBe(250)
    expect(averageUs(1000, 0)).toBeNull()
    expect(averageUs(undefined, 4)).toBeNull()
    expect(usageRatio(50, 100)).toBe(0.5)
    expect(usageRatio(50, 0)).toBeNull()
    expect(formatRatio(0.5)).toBe('50.0%')
    expect(formatRatio(null)).toBe('—')
  })

  it('sumValues / nonZeroEntries / latestLifecycle', () => {
    expect(sumValues({ a: 1, b: 2 })).toBe(3)
    expect(sumValues(undefined)).toBe(0)
    expect(nonZeroEntries({ a: 1, b: 0, c: 2 }, ['a', 'b', 'c'])).toEqual([
      { key: 'a', value: 1 },
      { key: 'c', value: 2 },
    ])
    expect(latestLifecycle({ a: 100, b: 200, c: 0 })).toEqual({ key: 'b', unix: 200 })
    expect(latestLifecycle({})).toBeNull()
  })

  it('formatUnixTime：0 / 非法值 → —', () => {
    expect(formatUnixTime(0)).toBe('—')
    expect(formatUnixTime(undefined)).toBe('—')
    expect(formatUnixTime(1_700_000_000)).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('formatUnixTime：原样使用调用方传入的 locale（不按 en/zh 前缀猜）', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat')
    formatUnixTime(1_700_000_000, 'en-US')

    expect(spy).toHaveBeenCalledWith('en-US', expect.any(Object))
    spy.mockRestore()
  })
})

describe('callRate（相邻采样差值）', () => {
  it('正常增量 / 不同间隔 / 计数回退 / 间隔过短', () => {
    expect(callRate(100, 300, 1000)).toBe(200)
    expect(callRate(100, 300, 2000)).toBe(100)
    expect(callRate(300, 100, 1000)).toBeNull()
    expect(callRate(100, 300, 100)).toBeNull()
    expect(callRate(undefined, 300, 1000)).toBeNull()
  })
})

describe('summarize（KPI 合计）', () => {
  it('汇总插件数 / 调用 / 在飞 / 内存峰值 / trap 总数', () => {
    const s = summarize(
      snapshot({
        a: metrics({
          calls_total: 10,
          calls_in_flight: 2,
          memory_peak_bytes: 1024,
          trap_reasons: { fuel_exhausted: 1, other: 2 },
        }),
        b: metrics({ calls_total: 5, memory_peak_bytes: 2048 }),
      }),
    )
    expect(s).toEqual({
      pluginCount: 2,
      callsTotal: 15,
      callsInFlight: 2,
      memoryPeakBytes: 3072,
      trapsTotal: 3,
    })
  })

  it('空快照全 0（不是 undefined）', () => {
    expect(summarize(snapshot({}))).toEqual({
      pluginCount: 0,
      callsTotal: 0,
      callsInFlight: 0,
      memoryPeakBytes: 0,
      trapsTotal: 0,
    })
  })
})

describe('describeError（Tauri 信封 / Error / 字符串）', () => {
  it('兼容多形态', () => {
    expect(describeError('nope')).toBe('nope')
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError({ message: 'msg' })).toBe('msg')
    expect(describeError({ error: 'err' })).toBe('err')
    expect(describeError({ code: 1 })).toBe('{"code":1}')
    expect(describeError(42)).toBe('42')
  })
})
