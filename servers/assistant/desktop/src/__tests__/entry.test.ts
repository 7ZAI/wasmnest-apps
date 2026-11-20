/**
 * Nest 助手挂载契约单测（桌面 · 票 08 对话主链路）
 *
 * 覆盖 shell 装配与入口契约：mountApp 挂载全屏会话页（ChatView）、保险库门
 * （未解锁走 VaultView / 已解锁进对话）、unmount 清空、setLocale 切换；
 * 失败路径显性呈现（fail-visible，不静默）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountApp, mountContract, type AppMountEnv } from '../entry'
import i18n from '../i18n'
import { ASSISTANT_PLUGIN_ID } from '@nest-shared/types'

afterEach(() => {
  vi.restoreAllMocks()
})

function mountEnv(overrides: Partial<AppMountEnv> = {}): AppMountEnv {
  return {
    appId: ASSISTANT_PLUGIN_ID,
    mountContract,
    invoke: vi.fn(async () => ({})) as AppMountEnv['invoke'],
    appInvoke: vi.fn(async () => ({ exists: true, unlocked: true })) as AppMountEnv['appInvoke'],
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

describe('mountApp 挂载契约（桌面机制 B · 票 08 对话主链路）', () => {
  it('导出挂载契约版本 mountContract = "1"（宿主装载时比对）', () => {
    expect(mountContract).toBe('1')
  })

  it('保险库已解锁：挂载会话页（ChatView），挂载后查状态与供应商', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const appInvoke = vi.fn(async () => ({ exists: true, unlocked: true })) as AppMountEnv['appInvoke']
    const env = mountEnv({ appInvoke })

    const handle = await mountApp(root, env)
    await flushPromises()

    // 挂载会话页（保险库门通过）
    expect(root.querySelector('[data-testid="nest-chat"]')).not.toBeNull()
    // 保险库门视图不再渲染
    expect(root.querySelector('[data-testid="nest-vault"]')).toBeNull()
    // 挂载后查保险库状态（门检查）+ 供应商列表（会话初始化）
    const commands = (appInvoke as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls.map((c) => c[0])
    expect(commands).toContain('assistant.vault-status')
    expect(commands).toContain('assistant.providers-list')

    await handle.unmount()
    expect(root.innerHTML).toBe('')
    root.remove()
  })

  it('保险库未解锁：落保险库门（VaultView），不进对话', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({
      appInvoke: vi.fn(async () => ({ exists: true, unlocked: false })) as AppMountEnv['appInvoke'],
    })

    const handle = await mountApp(root, env)
    await flushPromises()

    expect(root.querySelector('[data-testid="nest-vault"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="nest-chat"]')).toBeNull()
    const statusEl = root.querySelector('[data-testid="nest-vault-status"]')
    expect(statusEl?.textContent).toContain('已锁定')

    await handle.unmount()
    root.remove()
  })

  it('状态查询失败：保险库门显性报错，不假装可用', async () => {
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
    expect(root.querySelector('[data-testid="nest-chat"]')).toBeNull()

    await handle.unmount()
    root.remove()
  })

  it('状态查询失败（宿主错误信封）：保险库门显示可读文案而非 [object Object]', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const env = mountEnv({
      appInvoke: vi.fn(async () => {
        throw { code: 'host.internal', request_id: 'req-1' }
      }) as AppMountEnv['appInvoke'],
    })

    const handle = await mountApp(root, env)
    await flushPromises()

    const errorEl = root.querySelector('[data-testid="nest-vault-error"]')
    expect(errorEl?.getAttribute('role')).toBe('alert')
    expect(errorEl?.textContent).toContain('插件运行时错误')
    expect(errorEl?.textContent).not.toContain('[object Object]')
    expect(root.querySelector('[data-testid="nest-chat"]')).toBeNull()

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
