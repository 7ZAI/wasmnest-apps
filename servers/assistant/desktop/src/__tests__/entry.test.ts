/**
 * Nest 助手挂载契约单测（桌面 · 票 05 骨架最小用例）
 *
 * 覆盖 shell 装配与入口契约：mountApp 挂载占位页、自动 ping 验证命令链路、
 * unmount 清空、setLocale 切换；失败路径显性呈现（fail-visible，不静默）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountApp, mountContract, type AppMountEnv } from '../entry'
import i18n from '../i18n'
import { ASSISTANT_PLUGIN_ID, type AssistantPingResult } from '@nest-shared/types'

afterEach(() => {
  vi.restoreAllMocks()
})

const PING_RESULT: AssistantPingResult = { ok: true, appId: ASSISTANT_PLUGIN_ID }

function mountEnv(overrides: Partial<AppMountEnv> = {}): AppMountEnv {
  return {
    appId: ASSISTANT_PLUGIN_ID,
    mountContract,
    invoke: vi.fn(async () => ({})) as AppMountEnv['invoke'],
    appInvoke: vi.fn(async () => PING_RESULT) as AppMountEnv['appInvoke'],
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    platform: 'linux',
    initialRoute: '/assistant',
    ...overrides,
  }
}

describe('mountApp 挂载契约（桌面机制 B · 票 05 骨架）', () => {
  it('导出挂载契约版本 mountContract = "1"（宿主装载时比对）', () => {
    expect(mountContract).toBe('1')
  })

  it('挂载占位页，挂载后自动 ping 验证命令链路，unmount 后 DOM 清空', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv()

    const handle = await mountApp(root, env)
    await flushPromises()

    expect(root.querySelector('[data-testid="nest-placeholder"]')).not.toBeNull()
    expect(env.appInvoke).toHaveBeenCalledWith('assistant.ping')

    // ping 成功后状态与结果行显性呈现
    const stateEl = root.querySelector('[data-testid="nest-placeholder-state"]')
    expect(stateEl?.textContent).toContain('命令链路已连通')
    const resultEl = root.querySelector('[data-testid="nest-placeholder-result"]')
    expect(resultEl?.textContent).toContain(ASSISTANT_PLUGIN_ID)

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('ping 失败：显性报错状态，不假装可用', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({
      appInvoke: vi.fn(async () => {
        throw new Error('assistant.ping rejected: app.not_running')
      }) as AppMountEnv['appInvoke'],
    })

    const handle = await mountApp(root, env)
    await flushPromises()

    const stateEl = root.querySelector('[data-testid="nest-placeholder-state"]')
    expect(stateEl?.textContent).toContain('命令链路验证失败')
    const errorEl = root.querySelector('[data-testid="nest-placeholder-error"]')
    expect(errorEl?.textContent).toContain('app.not_running')

    await handle.unmount()
    root.remove()
  })

  it('setLocale 切换 i18n 语言（zh-CN / en 白名单）', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({ locale: 'zh-CN' })

    const handle = await mountApp(root, env)
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
