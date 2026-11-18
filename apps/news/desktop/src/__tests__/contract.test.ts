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

  it('滚动窗口为空时请求 list-feed，而不是伪造条目', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv()

    const handle = await mountApp(root, env)
    await vi.waitFor(() => {
      expect(env.appInvoke).toHaveBeenCalledWith('news.list-feed', {
        view: 'today',
        circleId: null,
      })
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
      expect(env.appInvoke).toHaveBeenCalledWith('news.list-feed', {
        view: 'realtime',
        circleId: null,
      })
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