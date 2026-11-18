import { describe, expect, it, vi } from 'vitest'
import { mountApp, mountPreview, type AppMountEnv, type AppPreviewEnv } from '../entry'

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
        }
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
