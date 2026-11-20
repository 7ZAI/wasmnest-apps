import { describe, expect, it, vi } from 'vitest'
import { mountApp, mountPreview, type AppMountEnv, type AppPreviewEnv } from '../entry'
import type { NewsItem } from '../types'

const ITEM: NewsItem = {
  id: 'i1',
  title: 'Item title',
  url: 'https://example.com/a',
  summary: 'Summary text',
  publishedAt: 1,
  firstSeenAt: 1,
  sourceId: 's1',
  sourceName: 'Source',
  circleName: '未分组',
  read: false,
  favorite: false,
  originCount: 1,
  score: 1,
}

function mountEnv(overrides: Partial<AppMountEnv> = {}): AppMountEnv {
  return {
    appId: 'com.wasmnest.news',
    mountContract: '1',
    invoke: vi.fn(async () => undefined) as unknown as AppMountEnv['invoke'],
    appInvoke: vi.fn(async (command: string) => {
      if (command === 'news.list-feed') return { items: [], windowHours: 24, generatedAt: 0 }
      if (command === 'news.list-circles') return { circles: [] }
      if (command === 'news.list-sources') return { sources: [] }
      if (command === 'news.refresh-stale') {
        return { results: [], failed: 0, newItems: 0, skipped: 0 }
      }
      if (command === 'news.list-credentials') return { credentials: [] }
      if (command === 'news.list-fetch-log') return { entries: [] }
      if (command === 'news.get-settings') {
        return {
          aiEnabled: false,
          aiBaseUrl: '',
          aiModel: '',
          aiApiKeyTail: '',
          aiApiKeyLen: 0,
          readerEnabled: true,
        }
      }
      if (command === 'news.reader-stats') {
        return { cachedCount: 0, cachedBytes: 0, archivedCount: 0, archivedBytes: 0 }
      }
      return {}
    }) as unknown as AppMountEnv['appInvoke'],
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => undefined),
    appStorageDelete: vi.fn(async () => undefined),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '/',
    ...overrides,
  }
}

function readerEnv(
  options: {
    readerEnabled?: boolean
    getSettingsError?: Error
    setSettingsError?: Error
    items?: NewsItem[]
  } = {},
): AppMountEnv {
  const items = options.items ?? []
  return mountEnv({
    appInvoke: vi.fn(async (command: string) => {
      if (command === 'news.list-feed') return { items, windowHours: 24, generatedAt: 0 }
      if (command === 'news.get-item') return { item: items[0], origins: [] }
      if (command === 'news.get-settings') {
        if (options.getSettingsError) throw options.getSettingsError
        return {
          aiEnabled: false,
          aiBaseUrl: '',
          aiModel: '',
          aiApiKeyTail: '',
          aiApiKeyLen: 0,
          readerEnabled: options.readerEnabled ?? true,
        }
      }
      if (command === 'news.set-settings') {
        if (options.setSettingsError) throw options.setSettingsError
        return {
          aiEnabled: false,
          aiBaseUrl: '',
          aiModel: '',
          aiApiKeyTail: '',
          aiApiKeyLen: 0,
          readerEnabled: false,
        }
      }
      if (command === 'news.list-circles') return { circles: [] }
      if (command === 'news.list-sources') return { sources: [] }
      if (command === 'news.refresh-stale') {
        return { results: [], failed: 0, newItems: 0, skipped: 0 }
      }
      if (command === 'news.list-credentials') return { credentials: [] }
      if (command === 'news.list-fetch-log') return { entries: [] }
      if (command === 'news.reader-stats') {
        return { cachedCount: 0, cachedBytes: 0, archivedCount: 0, archivedBytes: 0 }
      }
      return {}
    }) as unknown as AppMountEnv['appInvoke'],
  })
}

async function openFirstItem(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(root.querySelector('[data-news-item="i1"]')).not.toBeNull()
  })
  root.querySelector<HTMLButtonElement>('[data-news-item="i1"]')!.click()
  await vi.waitFor(() => {
    expect(root.querySelector('[data-testid="news-detail"]')).not.toBeNull()
  })
}

function previewEnv(): AppPreviewEnv {
  return {
    appId: 'com.wasmnest.news',
    appInvoke: vi.fn(async () => ({
      items: [],
      windowHours: 24,
      generatedAt: 0,
    })) as unknown as AppPreviewEnv['appInvoke'],
    appStorageGet: vi.fn(async () => undefined),
    locale: 'zh-CN',
    theme: 'light',
  }
}

describe('mountApp 契约', () => {
  it('挂载后渲染四段入口，卸载后清空 DOM', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const handle = await mountApp(root, mountEnv())

    await vi.waitFor(() => {
      expect(root.querySelectorAll('[data-news-view]')).toHaveLength(4)
    })
    expect(root.querySelector('[data-news-view="saved"]')?.textContent).toContain('收藏')

    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-empty]')).not.toBeNull()
    })

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('空态给出「去添加源」入口，而不是只显示一句空话', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const handle = await mountApp(root, mountEnv())
    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-empty-add]')).not.toBeNull()
    })

    await handle.unmount()
    root.remove()
  })

  it('首屏按今日口径请求 list-feed（带显式 nowMs）', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv()

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(env.appInvoke).toHaveBeenCalledWith(
        'news.list-feed',
        expect.objectContaining({ view: 'today', circleId: null }),
      )
    })

    await handle.unmount()
    root.remove()
  })

  it('切换段位会以新 view 重新请求', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv()

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(env.appInvoke).toHaveBeenCalled()
    })

    const realtime = root.querySelector<HTMLButtonElement>('[data-news-view="realtime"]')!
    realtime.click()

    await vi.waitFor(() => {
      expect(env.appInvoke).toHaveBeenCalledWith(
        'news.list-feed',
        expect.objectContaining({ view: 'realtime' }),
      )
    })

    await handle.unmount()
    root.remove()
  })

  it('设置入口可达，且页面可关闭', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const env = mountEnv()
    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-open-settings]')).not.toBeNull()
    })
    root.querySelector<HTMLButtonElement>('[data-news-open-settings]')!.click()

    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-settings]')).not.toBeNull()
    })
    // 设置页挂载后立即拉清单：等这批异步落地再关闭，避免半途卸载触发无效实例渲染
    await vi.waitFor(() => {
      expect(env.appInvoke).toHaveBeenCalledWith('news.list-sources')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    root.querySelector<HTMLButtonElement>('[data-news-settings-close]')!.click()
    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-settings]')).toBeNull()
    })

    await handle.unmount()
    root.remove()
  })

  it('英文 locale 下四段与空态走英文，无中文残留', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const handle = await mountApp(root, mountEnv({ locale: 'en' }))
    await vi.waitFor(() => {
      expect(root.querySelectorAll('[data-news-view]')).toHaveLength(4)
    })
    const text = root.textContent ?? ''
    expect(text).toContain('Today')
    expect(text).toContain('Saved')
    expect(text).not.toContain('收藏')

    await handle.unmount()
    root.remove()
  })

  it('阅读默认开启：打开详情出现入口且不自动抓取正文', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = readerEnv({ items: [ITEM] })

    const handle = await mountApp(root, env)
    await openFirstItem(root)

    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="news-reader-open"]')).not.toBeNull()
    })
    expect(root.querySelector('[data-testid="news-reader"]')).toBeNull()
    const calls = (env.appInvoke as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.filter(([command]) => command === 'news.read-item')).toHaveLength(0)

    await handle.unmount()
    root.remove()
  })

  it('显式关闭后详情不渲染阅读入口', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = readerEnv({ items: [ITEM], readerEnabled: false })

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      const calls = (env.appInvoke as unknown as { mock: { calls: unknown[][] } }).mock.calls
      expect(calls.some(([command]) => command === 'news.get-settings')).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await openFirstItem(root)

    expect(root.querySelector('[data-testid="news-reader-open"]')).toBeNull()
    expect(root.querySelector('[data-testid="news-copy"]')).not.toBeNull()

    await handle.unmount()
    root.remove()
  })

  it('设置读取失败：列表仍加载并显示可见提示', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = readerEnv({ getSettingsError: new Error('storage.failed: db closed') })

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(
        root.querySelector('[data-testid="news-reader-settings-warning"]'),
      ).not.toBeNull()
    })
    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-empty]')).not.toBeNull()
    })

    await handle.unmount()
    root.remove()
  })

  it('设置页阅读开关默认开启，保存失败时回滚', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = readerEnv({ setSettingsError: new Error('storage.failed: write denied') })

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-open-settings]')).not.toBeNull()
    })
    root.querySelector<HTMLButtonElement>('[data-news-open-settings]')!.click()
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="news-settings-tab-data"]')).not.toBeNull()
    })
    root.querySelector<HTMLButtonElement>('[data-testid="news-settings-tab-data"]')!.click()
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="news-reader-enabled"]')).not.toBeNull()
    })

    const checkbox = root.querySelector<HTMLInputElement>('[data-testid="news-reader-enabled"]')!
    expect(checkbox.checked).toBe(true)
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    await vi.waitFor(() => {
      expect(checkbox.checked).toBe(true)
    })

    await handle.unmount()
    root.remove()
  })
})

describe('mountPreview 契约', () => {
  it('渲染只读预览且不含可聚焦控件', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const handle = await mountPreview(root, previewEnv())

    await vi.waitFor(() => {
      expect(root.querySelector('[data-news-preview]')).not.toBeNull()
    })
    expect(root.querySelectorAll('button, input, select, textarea, a[href]')).toHaveLength(0)

    await handle.unmount()
    root.remove()
  })
})
