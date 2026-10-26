import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountApp, mountPreview, mountContract, type AppMountEnv, type AppPreviewEnv } from '../entry'
import i18n from '../i18n'
import { info, metrics, snapshot } from './fixtures'

afterEach(() => {
  vi.restoreAllMocks()
})

const SNAPSHOT = snapshot(
  {
    'com.wasmnest.monitor': metrics(),
    'com.wasmnest.ai-chatbox': metrics({ calls_total: 4, memory_peak_bytes: 2048 }),
  },
  { task: { jobsActive: 1 } },
)

function mountEnv(overrides: Partial<AppMountEnv> = {}): AppMountEnv {
  return {
    appId: 'com.wasmnest.monitor',
    mountContract,
    invoke: vi.fn(async () => [
      info({ id: 'com.wasmnest.monitor', name: 'Monitor' }),
    ]) as AppMountEnv['invoke'],
    appInvoke: vi.fn(async () => SNAPSHOT) as AppMountEnv['appInvoke'],
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    platform: 'linux',
    initialRoute: '/monitor',
    ...overrides,
  }
}

describe('mountApp 挂载契约（桌面机制 B）', () => {
  it('导出挂载契约版本 mountContract = "1"（宿主装载时比对）', () => {
    expect(mountContract).toBe('1')
  })

  it('挂载出监控界面，unmount 后 DOM 清空', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv()

    const handle = await mountApp(root, env)
    await flushPromises()

    expect(root.querySelector('[data-testid="monitor-view"]')).not.toBeNull()
    expect(env.appInvoke).toHaveBeenCalledWith('monitor.snapshot')
    expect(env.invoke).toHaveBeenCalledWith('plugin_list_loaded')

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('setLocale 切换 i18n 语言（zh-CN / en 白名单）', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = await mountApp(root, mountEnv({ locale: 'zh-CN' }))
    await flushPromises()
    expect(i18n.global.locale.value).toBe('zh-CN')

    handle.setLocale?.('en')
    expect(i18n.global.locale.value).toBe('en')

    handle.setLocale?.('zh-CN')
    expect(i18n.global.locale.value).toBe('zh-CN')

    await handle.unmount()
    root.remove()
  })
})

describe('mountPreview 预览契约（只读、无副作用）', () => {
  function previewEnv(): AppPreviewEnv {
    return {
      appId: 'com.wasmnest.monitor',
      appInvoke: vi.fn(async () => SNAPSHOT) as AppPreviewEnv['appInvoke'],
      appStorageGet: vi.fn(async () => undefined),
      locale: 'zh-CN',
      theme: 'light',
      platform: 'linux',
    }
  }

  it('立即返回 handle，异步取一次数后渲染摘要；DOM 无可聚焦控件', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = previewEnv()

    const handle = await mountPreview(root, env)
    await flushPromises()

    expect(env.appInvoke).toHaveBeenCalledTimes(1)
    expect(root.querySelector('.mnpv')).not.toBeNull()
    expect(root.textContent).toContain('运行监控')
    expect(
      root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'),
    ).toHaveLength(0)

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('命令失败：显示诚实空态，不抛错', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = previewEnv()
    env.appInvoke = vi.fn(async () => {
      throw new Error('metrics:read denied')
    })

    const handle = await mountPreview(root, env)
    await flushPromises()

    expect(root.textContent).toContain('指标不可读')
    expect(env.appInvoke).toHaveBeenCalledTimes(1)

    await handle.unmount()
    root.remove()
  })
})
