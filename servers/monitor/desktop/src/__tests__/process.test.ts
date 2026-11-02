import { describe, it, expect } from 'vitest'
import { hostProcessOf } from '../utils/process'
import { metrics, snapshot } from './fixtures'

/** 宿主 `process` 段的完整形状（与平台仓 system/process_metrics.rs 对齐） */
function segment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    available: true,
    sampledAtUnixMs: 1_700_000_000_000,
    cpuWindowMs: 1000,
    cores: 8,
    self: {
      pid: 1000,
      name: 'wasmnest-desktop',
      role: 'host',
      rssBytes: 300,
      pssBytes: 200,
      cpuPercent: 4.5,
    },
    webview: {
      present: true,
      processCount: 2,
      rssBytes: 500,
      pssBytes: 320,
      cpuPercent: 12.5,
      processes: [
        {
          pid: 1001,
          name: 'WebKitWebProces',
          role: 'webview',
          rssBytes: 400,
          pssBytes: 260,
          cpuPercent: 10,
        },
        {
          pid: 1002,
          name: 'WebKitNetworkPr',
          role: 'network',
          rssBytes: 100,
          pssBytes: 60,
          cpuPercent: 2.5,
        },
      ],
    },
    otherChildren: {
      processCount: 1,
      rssBytes: 50,
      pssBytes: 30,
      cpuPercent: 1,
      processes: [
        { pid: 1003, name: 'claude', role: 'other', rssBytes: 50, pssBytes: 30, cpuPercent: 1 },
      ],
    },
    tree: { processCount: 4, rssBytes: 850, pssBytes: 550, cpuPercent: 18 },
    ...overrides,
  }
}

describe('hostProcessOf（process 段解析）', () => {
  it('段缺失 → null（旧宿主：页面按「未提供」渲染，不当 0）', () => {
    expect(hostProcessOf(null)).toBeNull()
    expect(hostProcessOf(snapshot({ a: metrics() }))).toBeNull()
    expect(hostProcessOf(snapshot({ a: metrics() }, { process: 'nope' }))).toBeNull()
  })

  it('available=false → 透传原因，不带任何数字', () => {
    const parsed = hostProcessOf(
      snapshot({ a: metrics() }, { process: { available: false, reason: 'no-pid' } }),
    )
    expect(parsed).toEqual({ available: false, reason: 'no-pid' })
  })

  it('完整段：self / webview / otherChildren / tree 逐字段解析', () => {
    const parsed = hostProcessOf(snapshot({ a: metrics() }, { process: segment() }))
    expect(parsed?.available).toBe(true)
    expect(parsed?.cores).toBe(8)
    expect(parsed?.cpuWindowMs).toBe(1000)
    expect(parsed?.self).toMatchObject({ pid: 1000, role: 'host', pssBytes: 200 })
    expect(parsed?.webview).toMatchObject({
      present: true,
      processCount: 2,
      pssBytes: 320,
      cpuPercent: 12.5,
    })
    expect(parsed?.webview?.processes?.map((p) => p.role)).toEqual(['webview', 'network'])
    expect(parsed?.otherChildren?.processes?.[0]).toMatchObject({ name: 'claude', pid: 1003 })
    expect(parsed?.tree?.pssBytes).toBe(550)
  })

  it('pss / cpu 的 null 原样保留（不拿 RSS 顶替 PSS，不把无基线说成 0%）', () => {
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
            tree: { processCount: 1, rssBytes: 300, pssBytes: null, cpuPercent: null },
          }),
        },
      ),
    )
    expect(parsed?.self?.pssBytes).toBeNull()
    expect(parsed?.self?.cpuPercent).toBeNull()
    expect(parsed?.cpuWindowMs).toBeNull()
  })

  it('webview.present 只认布尔 true：漏发就是「没有」，不按进程条数反推', () => {
    const parsed = hostProcessOf(
      snapshot(
        { a: metrics() },
        {
          process: segment({
            webview: {
              processCount: 2,
              processes: [{ pid: 1001, name: 'WebKitWebProces', role: 'webview' }],
            },
          }),
        },
      ),
    )
    expect(parsed?.webview?.present).toBe(false)
    expect(parsed?.webview?.processes).toHaveLength(1)
  })

  it('非法字段不产出 NaN：非数字 → 缺失；未知 role → other；无 pid 的行丢弃', () => {
    const parsed = hostProcessOf(
      snapshot(
        { a: metrics() },
        {
          process: segment({
            cores: 'eight',
            self: { pid: 1000, name: 'host', role: 'weird', rssBytes: 'big', pssBytes: 1 },
            webview: {
              present: false,
              processes: [{ name: 'nameless' }, { pid: 1005, name: 'ok', role: 'gpu' }],
            },
          }),
        },
      ),
    )
    expect(parsed?.cores).toBeNull()
    expect(parsed?.self).toMatchObject({ rssBytes: undefined, pssBytes: 1, role: 'other' })
    expect(parsed?.webview?.processes).toEqual([
      { pid: 1005, name: 'ok', role: 'gpu', rssBytes: undefined, pssBytes: null, cpuPercent: null },
    ])
  })
})
