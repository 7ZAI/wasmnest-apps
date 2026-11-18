import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useNewsFeed } from '../composables/useNewsFeed'
import type { NewsItem } from '../types'

function item(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'i1',
    title: 'Title',
    url: 'https://example.com/a',
    publishedAt: 1,
    firstSeenAt: 1,
    sourceId: 's1',
    sourceName: 'Source',
    circleName: '未分组',
    read: false,
    favorite: false,
    originCount: 1,
    score: 1,
    ...overrides,
  }
}

function context(handler: (command: string, args?: Record<string, unknown>) => unknown): {
  context: PluginContext
  calls: Array<{ command: string; args?: Record<string, unknown> }>
} {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const context = {
    i18n: { t: (key: string) => key, getI18n: () => ({}), },
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

describe('useNewsFeed', () => {
  it('load 拉取条目与窗口信息', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.list-feed') {
        return { items: [item()], windowHours: 24, generatedAt: 123 }
      }
      return {}
    })
    const controller = useNewsFeed(ctx)
    await controller.load()
    expect(controller.items.value).toHaveLength(1)
    expect(controller.windowHours.value).toBe(24)
    expect(controller.generatedAt.value).toBe(123)
    expect(controller.error.value).toBeNull()
  })

  it('load 失败时保留分类码，不静默清空错误', async () => {
    const { context: ctx } = context(() => {
      throw new Error('storage.failed: db is locked')
    })
    const controller = useNewsFeed(ctx)
    await controller.load()
    expect(controller.items.value).toEqual([])
    expect(controller.error.value).toContain('storage.failed')
  })

  it('打开条目即标记已读并取回来源归属', async () => {
    const { context: ctx, calls } = context((command) => {
      if (command === 'news.list-feed') return { items: [item()], windowHours: 24, generatedAt: 1 }
      if (command === 'news.get-item') {
        return {
          item: item({ read: true, originCount: 2 }),
          origins: [
            { sourceId: 's1', sourceName: 'A', rawUrl: 'https://a/1' },
            { sourceId: 's2', sourceName: 'B', rawUrl: 'https://b/1' },
          ],
        }
      }
      return {}
    })
    const controller = useNewsFeed(ctx)
    await controller.load()
    await controller.openItem(controller.items.value[0])

    expect(controller.items.value[0].read).toBe(true)
    expect(controller.origins.value).toHaveLength(2)
    expect(calls.some((call) => call.command === 'news.mark-read')).toBe(true)
  })

  it('收藏切换写入后端并同步列表', async () => {
    const { context: ctx, calls } = context((command) => {
      if (command === 'news.list-feed') return { items: [item()], windowHours: 24, generatedAt: 1 }
      if (command === 'news.get-item') return { item: item(), origins: [] }
      return {}
    })
    const controller = useNewsFeed(ctx)
    await controller.load()
    await controller.openItem(controller.items.value[0])
    await controller.toggleFavorite()

    expect(controller.selected.value?.favorite).toBe(true)
    expect(controller.items.value[0].favorite).toBe(true)
    const call = calls.find((entry) => entry.command === 'news.set-favorite')
    expect(call?.args).toMatchObject({ itemId: 'i1', favorite: true })
  })

  it('复制链接：后端不支持时回退浏览器剪贴板', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.copy-link') throw new Error('port.unsupported: clipboard.write')
      return {}
    })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const controller = useNewsFeed(ctx)
    const result = await controller.copyLink('https://example.com/a')
    expect(result).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://example.com/a')
  })

  it('复制链接：两条通道都失败时返回回退结果', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.copy-link') throw new Error('port.unsupported: clipboard.write')
      return {}
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
      configurable: true,
    })
    const controller = useNewsFeed(ctx)
    expect(await controller.copyLink('https://example.com/a')).toBe('fallback')
  })

  it('全部已读后列表条目标记为已读', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.list-feed') return { items: [item(), item({ id: 'i2' })], windowHours: 24, generatedAt: 1 }
      if (command === 'news.mark-all-read') return { count: 2 }
      return {}
    })
    const controller = useNewsFeed(ctx)
    await controller.load()
    expect(controller.canMarkAllRead.value).toBe(true)
    const count = await controller.markAllRead()
    expect(count).toBe(2)
    expect(controller.items.value.every((entry) => entry.read)).toBe(true)
  })

  it('刷新被防抖拦截时把 blocked 透出给界面', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.list-feed') return { items: [], windowHours: 24, generatedAt: 1 }
      if (command === 'news.refresh-all') {
        return { results: [], failed: 0, newItems: 0, skipped: 1, blocked: 'refresh.debounced' }
      }
      return {}
    })
    const controller = useNewsFeed(ctx)
    const outcome = await controller.refresh()
    expect(outcome?.blocked).toBe('refresh.debounced')
  })

  it('失败源汇总只含真正失败的源', async () => {
    const { context: ctx } = context((command) => {
      if (command === 'news.list-feed') return { items: [], windowHours: 24, generatedAt: 1 }
      if (command === 'news.refresh-all') {
        return {
          results: [
            {
              sourceId: 's1',
              sourceName: 'A',
              ok: false,
              newItems: 0,
              parsedItems: 0,
              durationMs: 10,
              errorKind: 'net.failed',
            },
            {
              sourceId: 's2',
              sourceName: 'B',
              ok: false,
              newItems: 0,
              parsedItems: 0,
              durationMs: 0,
              skipped: 'not-due',
            },
          ],
          failed: 1,
          newItems: 0,
          skipped: 1,
        }
      }
      return {}
    })
    const controller = useNewsFeed(ctx)
    await controller.refresh()
    expect(controller.failedSources.value).toHaveLength(1)
    expect(controller.failedSources.value[0].sourceId).toBe('s1')
  })
})
