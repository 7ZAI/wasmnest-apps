import { describe, it, expect } from 'vitest'
import { hostProcessOf, webviewHeapOf } from '../utils/process'
import { metrics, snapshot } from './fixtures'

/** 宿主 `process` 段的完整形状（与平台仓移动宿主 system/process_metrics.rs 对齐） */
function segment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    available: true,
    sampledAtUnixMs: 1_700_000_000_000,
    cpuWindowMs: 1000,
    cores: 8,
    self: {
      pid: 1000,
      name: 'wasmnest-mobile',
      role: 'host',
      rssBytes: 300,
      pssBytes: 200,
      cpuPercent: 4.5,
    },
    webview: {
      present: false,
      reason: 'not-a-child-process',
      processCount: 0,
      rssBytes: 0,
      pssBytes: null,
      cpuPercent: null,
      processes: [],
    },
    otherChildren: { processCount: 1, rssBytes: 50, pssBytes: 30, cpuPercent: 1, processes: [] },
    tree: { processCount: 2, rssBytes: 350, pssBytes: 230, cpuPercent: 5.5 },
    ...overrides,
  }
}

describe('hostProcessOf（移动端 process 段解析）', () => {
  it('段缺失 → null（旧宿主：按「未提供」渲染）', () => {
    expect(hostProcessOf(null)).toBeNull()
    expect(hostProcessOf(snapshot({ a: metrics() }))).toBeNull()
    expect(hostProcessOf(snapshot({ a: metrics() }, { process: [] }))).toBeNull()
  })

  it('available=false → 透传原因，不带数字（iOS 无 procfs）', () => {
    const parsed = hostProcessOf(
      snapshot({ a: metrics() }, { process: { available: false, reason: 'no-procfs' } }),
    )
    expect(parsed).toEqual({ available: false, reason: 'no-procfs' })
  })

  it('完整段：self / webview(不可归属) / otherChildren / tree', () => {
    const parsed = hostProcessOf(snapshot({ a: metrics() }, { process: segment() }))
    expect(parsed?.available).toBe(true)
    expect(parsed?.self).toMatchObject({ pid: 1000, role: 'host', pssBytes: 200 })
    expect(parsed?.webview).toMatchObject({ present: false, reason: 'not-a-child-process' })
    expect(parsed?.otherChildren?.processCount).toBe(1)
    expect(parsed?.tree?.pssBytes).toBe(230)
    expect(parsed?.cores).toBe(8)
  })

  it('pss / cpu 的 null 原样保留（不拿 RSS 顶替，不把无基线说成 0%）', () => {
    const parsed = hostProcessOf(
      snapshot(
        { a: metrics() },
        {
          process: segment({
            cpuWindowMs: null,
            self: {
              pid: 1000,
              name: 'host',
              role: 'host',
              rssBytes: 300,
              pssBytes: null,
              cpuPercent: null,
            },
          }),
        },
      ),
    )
    expect(parsed?.self?.pssBytes).toBeNull()
    expect(parsed?.self?.cpuPercent).toBeNull()
    expect(parsed?.cpuWindowMs).toBeNull()
  })

  it('present 只认布尔 true；非法字段不产出 NaN；无 pid 的行丢弃', () => {
    const parsed = hostProcessOf(
      snapshot(
        { a: metrics() },
        {
          process: segment({
            cores: 'eight',
            webview: { present: 'yes', processCount: 1, processes: [{ name: 'x' }] },
            self: { pid: 1000, name: 'host', role: 'weird', rssBytes: 'big' },
          }),
        },
      ),
    )
    expect(parsed?.cores).toBeNull()
    expect(parsed?.webview?.present).toBe(false)
    expect(parsed?.webview?.processes).toEqual([])
    expect(parsed?.self).toMatchObject({ rssBytes: undefined, role: 'other' })
  })
})

describe('webviewHeapOf（Chromium 自报 JS 堆）', () => {
  it('读 performance.memory；量化标记跟随 crossOriginIsolated', () => {
    const heap = webviewHeapOf({
      performance: {
        memory: {
          usedJSHeapSize: 10_000_000,
          totalJSHeapSize: 10_000_000,
          jsHeapSizeLimit: 1_530_000_000,
        },
      },
      crossOriginIsolated: false,
    })
    expect(heap).toEqual({
      usedBytes: 10_000_000,
      totalBytes: 10_000_000,
      limitBytes: 1_530_000_000,
      quantized: true,
    })
  })

  it('跨源隔离 → 不量化', () => {
    const heap = webviewHeapOf({
      performance: { memory: { usedJSHeapSize: 1234 } },
      crossOriginIsolated: true,
    })
    expect(heap?.quantized).toBe(false)
    expect(heap?.totalBytes).toBeNull()
  })

  it('WebKit 系（无 performance.memory）/ 非法入参 → null，不伪造 0', () => {
    expect(webviewHeapOf({ performance: {} })).toBeNull()
    expect(webviewHeapOf({})).toBeNull()
    expect(webviewHeapOf(null)).toBeNull()
    expect(webviewHeapOf({ performance: { memory: { usedJSHeapSize: 'x' } } })).toBeNull()
  })
})
