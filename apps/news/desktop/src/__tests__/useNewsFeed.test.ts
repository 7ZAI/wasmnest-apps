import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useNewsFeed } from '../composables/useNewsFeed'

function fakeContext(execute: (command: string, ...args: any[]) => Promise<any>) {
  return { commands: { execute } } as unknown as PluginContext
}

const EMPTY_FEED = { items: [], windowHours: 24, generatedAt: 0 }

describe('useNewsFeed', () => {
  it('初始为今日视图并载入空列表', async () => {
    const execute = vi.fn(async () => EMPTY_FEED)
    const feed = useNewsFeed(fakeContext(execute))

    await feed.load()

    expect(feed.view.value).toBe('today')
    expect(feed.items.value).toEqual([])
    expect(feed.error.value).toBeNull()
    expect(execute).toHaveBeenCalledWith('news.list-feed', { view: 'today', circleId: null })
  })

  it('命令失败时保留错误原文，不伪装成空列表成功', async () => {
    const execute = vi.fn(async () => {
      throw new Error('unknown command: news.list-feed')
    })
    const feed = useNewsFeed(fakeContext(execute))

    await feed.load()

    expect(feed.items.value).toEqual([])
    expect(feed.error.value).toContain('unknown command')
  })

  it('切到实时视图后重新请求并清空选中', async () => {
    const execute = vi.fn(async () => EMPTY_FEED)
    const feed = useNewsFeed(fakeContext(execute))
    await feed.load()

    await feed.setView('realtime')

    expect(feed.view.value).toBe('realtime')
    expect(feed.selected.value).toBeNull()
    expect(execute).toHaveBeenLastCalledWith('news.list-feed', {
      view: 'realtime',
      circleId: null,
    })
  })

  it('圈子列表取不到时保持空列表，不影响主列表', async () => {
    const execute = vi.fn(async (command: string) => {
      if (command === 'news.list-circles') throw new Error('circles unavailable')
      return EMPTY_FEED
    })
    const feed = useNewsFeed(fakeContext(execute))

    await feed.loadCircles()
    await feed.load()

    expect(feed.circles.value).toEqual([])
    expect(feed.error.value).toBeNull()
  })

  it('刷新命令失败时把错误抛给界面（不吞掉）', async () => {
    const execute = vi.fn(async (command: string) => {
      if (command === 'news.refresh') throw new Error('fetch engine not wired')
      return EMPTY_FEED
    })
    const feed = useNewsFeed(fakeContext(execute))

    await expect(feed.refresh()).rejects.toThrow('fetch engine not wired')
  })
})