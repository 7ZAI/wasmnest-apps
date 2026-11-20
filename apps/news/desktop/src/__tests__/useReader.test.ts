import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useReader } from '../composables/useReader'
import type { ReaderView } from '../types'

const READY: ReaderView = {
  itemId: 'i1',
  state: 'ready',
  blocks: [{ kind: 'paragraph', text: 'Article text' }],
  textLength: 12,
  truncated: false,
  stale: false,
  archived: false,
  fetchedAt: 1,
  lastAttemptAt: 1,
  errorKind: null,
  errorDetail: null,
}

const STATS = { cachedCount: 1, cachedBytes: 10, archivedCount: 0, archivedBytes: 0 }

function context(handler: (command: string, args?: Record<string, unknown>) => unknown): {
  context: PluginContext
  calls: Array<{ command: string; args?: Record<string, unknown> }>
} {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const context = {
    i18n: { t: (key: string) => key, getI18n: () => ({}) },
    commands: {
      execute: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return handler(command, args)
      }),
    },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
    storage: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      flush: async () => {},
    },
  } as unknown as PluginContext
  return { context, calls }
}

describe('useReader', () => {
  it('成功读取后进入 ready 并保留块序列', async () => {
    const { context: ctx } = context(() => READY)
    const reader = useReader(ctx)
    await reader.open('i1')
    expect(reader.status.value).toBe('ready')
    expect(reader.view.value?.blocks[0].text).toBe('Article text')
    expect(reader.error.value).toBeNull()
  })

  it('失败态从 ReaderView 提取分类码，不当作命令异常', async () => {
    const { context: ctx } = context(() => ({
      ...READY,
      state: 'failed',
      blocks: [],
      errorKind: 'extract.no_content',
      errorDetail: 'no article',
    }))
    const reader = useReader(ctx)
    await reader.open('i1')
    expect(reader.status.value).toBe('failed')
    expect(reader.error.value).toEqual({ code: 'extract.no_content', detail: 'no article' })
  })

  it('stale 仍可读，同时保留错误提示', async () => {
    const { context: ctx } = context(() => ({
      ...READY,
      stale: true,
      errorKind: 'net.failed',
      errorDetail: 'timeout',
    }))
    const reader = useReader(ctx)
    await reader.open('i1')
    expect(reader.status.value).toBe('ready')
    expect(reader.view.value?.stale).toBe(true)
    expect(reader.error.value?.code).toBe('net.failed')
  })

  it('重试强制绕过缓存', async () => {
    const { context: ctx, calls } = context(() => READY)
    const reader = useReader(ctx)
    await reader.retry('i1')
    const call = calls.find((entry) => entry.command === 'news.read-item')
    expect(call?.args).toMatchObject({ itemId: 'i1', force: true })
  })

  it('归档命令返回归档后的视图', async () => {
    const { context: ctx, calls } = context(() => ({ ...READY, archived: true }))
    const reader = useReader(ctx)
    await reader.archive('i1')
    expect(calls[0].command).toBe('news.archive-item-content')
    expect(reader.view.value?.archived).toBe(true)
  })

  it('统计与清理命令保持同一数据源', async () => {
    let stats = STATS
    const { context: ctx, calls } = context((command) => {
      if (command === 'news.reader-stats') return stats
      if (command === 'news.clear-reader-cache') {
        stats = { ...STATS, cachedCount: 0, cachedBytes: 0 }
        return { removed: 1, bytes: 10 }
      }
      return {}
    })
    const reader = useReader(ctx)
    await reader.loadStats()
    expect(reader.stats.value?.cachedCount).toBe(1)
    const result = await reader.clear('unarchived')
    expect(result).toEqual({ removed: 1, bytes: 10 })
    expect(reader.stats.value?.cachedCount).toBe(0)
    expect(calls.map((entry) => entry.command)).toContain('news.clear-reader-cache')
  })
})