/**
 * Nest 助手挂载契约单测（桌面 · 票 07 保险库）
 *
 * 覆盖 shell 装配与入口契约：mountApp 挂载保险库视图（VaultView）、挂载后
 * 自动查保险库状态、unmount 清空、setLocale 切换；失败路径显性呈现
 * （fail-visible，不静默）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountApp, mountContract, type AppMountEnv } from '../entry'
import i18n from '../i18n'
import { ASSISTANT_PLUGIN_ID, type VaultStatus } from '@nest-shared/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function mountEnv(overrides: Partial<AppMountEnv> = {}): AppMountEnv {
  return {
    appId: ASSISTANT_PLUGIN_ID,
    mountContract,
    invoke: vi.fn(async () => ({})) as AppMountEnv['invoke'],
    appInvoke: vi.fn(async () => ({ exists: false, unlocked: false })) as AppMountEnv['appInvoke'],
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

describe('mountApp 挂载契约（桌面机制 B · 票 07 保险库）', () => {
  it('导出挂载契约版本 mountContract = "1"（宿主装载时比对）', () => {
    expect(mountContract).toBe('1')
  })

  it('挂载保险库视图，挂载后自动查状态，unmount 后 DOM 清空', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({
      appInvoke: vi.fn(async () => ({ exists: true, unlocked: false })) as AppMountEnv['appInvoke'],
    })

    const handle = await mountApp(root, env)
    await flushPromises()

    // 挂载保险库视图
    expect(root.querySelector('[data-testid="nest-vault"]')).not.toBeNull()
    // 挂载后自动查保险库状态
    expect(env.appInvoke).toHaveBeenCalledWith('assistant.vault-status', undefined)
    // 未解锁 → 状态徽标显性呈现
    const statusEl = root.querySelector('[data-testid="nest-vault-status"]')
    expect(statusEl?.textContent).toContain('已锁定')

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('状态查询失败：显性报错，不假装可用', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({
      appInvoke: vi.fn(async () => {
        throw new Error('assistant.vault-status rejected: vault missing')
      }) as AppMountEnv['appInvoke'],
    })

    const handle = await mountApp(root, env)
    await flushPromises()

    const errorEl = root.querySelector('[data-testid="nest-vault-error"]')
    expect(errorEl?.textContent).toContain('vault missing')

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
