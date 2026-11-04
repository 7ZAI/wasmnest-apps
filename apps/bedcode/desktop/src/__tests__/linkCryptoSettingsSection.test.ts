/**
 * LinkCryptoSettingsSection 行为契约（2026-11-04 用户裁决：策略属于应用）
 *
 * 契约清单：
 * - C1 回显本应用当前策略（off / preferred / required）与语义提示；
 * - C2 切换调用 `appLinkCryptoSet`（app 通道令牌已绑定本应用），成功后界面更新；
 * - C3 保存失败保持原值并提示，不显示「已生效」假象；
 * - C4 旧宿主缺 own-token 方法 / 能力字段：显性提示不可用，控件禁用；
 * - C5 展示本机指纹（供双端人工核对）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import type { AppMountEnv } from '@/entry'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

import LinkCryptoSettingsSection from '@/components/LinkCryptoSettingsSection.vue'

const t = (key: string) => i18n.global.t(`com.wasmnest.bedcode.${key}`)

/**
 * 能力查询 wire 形状（能力仓 `LinkCryptoCapabilities`，serde camelCase）
 *
 * 夹具必须与真实宿主逐字同形；按 snake_case 造夹具会让「前端读错键名」的缺陷
 * 继续全绿（2026-11-03 宿主设置页踩过一次）。
 */
function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    appScopedPolicy: true,
    policies: ['required', 'preferred', 'off'],
    identityFingerprint: 'abcd1234abcd1234',
    keyModels: ['paired-http-path-bound'],
    // WS 帧级加密已支持（2026-11-04 升级期协商）：默认能力 wsSession=true
    wsSession: true,
    ...overrides,
  }
}

interface EnvOptions {
  policy?: 'off' | 'preferred' | 'required'
  caps?: unknown
  setError?: Error
  omitBindings?: boolean
}

function makeEnv(options: EnvOptions = {}): AppMountEnv {
  const env = {
    appId: 'com.wasmnest.bedcode',
    invoke: vi.fn(async (command: string) => {
      if (command === 'get_link_crypto_capabilities') return options.caps ?? capabilities()
      throw new Error(`unexpected command: ${command}`)
    }),
    appInvoke: vi.fn(async () => undefined),
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '/settings',
  } as unknown as AppMountEnv

  if (!options.omitBindings) {
    env.appLinkCryptoGet = vi.fn(async () => options.policy ?? 'off')
    env.appLinkCryptoSet = vi.fn(async () => {
      if (options.setError) throw options.setError
    })
  }
  return env
}

function mountSection(env: AppMountEnv) {
  return mount(LinkCryptoSettingsSection, {
    global: { plugins: [i18n], provide: { appEnv: env } },
  })
}

function activePolicy(wrapper: ReturnType<typeof mountSection>): string | null {
  const pressed = wrapper.findAll('[data-testid^="link-crypto-policy-"][aria-pressed="true"]')
  return pressed.length ? (pressed[0].attributes('data-testid') ?? null) : null
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LinkCryptoSettingsSection — 应用自有策略', () => {
  it('回显当前策略与本机指纹（required）', async () => {
    const env = makeEnv({ policy: 'required' })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(env.invoke).toHaveBeenCalledWith('get_link_crypto_capabilities')
    expect(env.appLinkCryptoGet).toHaveBeenCalled()
    expect(activePolicy(wrapper)).toBe('link-crypto-policy-required')
    expect(wrapper.find('[data-testid="link-crypto-hint"]').text()).toBe(
      t('linkCrypto.requiredHint'),
    )
    expect(wrapper.find('[data-testid="link-crypto-fingerprint"]').text()).toBe('abcd1234abcd1234')
  })

  it('明文策略给风险提示（未设置 = off）', async () => {
    const env = makeEnv({ policy: 'off' })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(activePolicy(wrapper)).toBe('link-crypto-policy-off')
    expect(wrapper.find('[data-testid="link-crypto-hint"]').text()).toBe(t('linkCrypto.offHint'))
  })

  it('切换策略调用 appLinkCryptoSet 并更新界面', async () => {
    const env = makeEnv({ policy: 'off' })
    const wrapper = mountSection(env)
    await flushPromises()

    await wrapper.find('[data-testid="link-crypto-policy-preferred"]').trigger('click')
    await flushPromises()

    expect(env.appLinkCryptoSet).toHaveBeenCalledWith('preferred')
    expect(activePolicy(wrapper)).toBe('link-crypto-policy-preferred')
    expect(toastMock.success).toHaveBeenCalledWith(t('linkCrypto.saved'))
  })

  it('保存失败保持原值并提示，不显示「已生效」假象', async () => {
    const env = makeEnv({ policy: 'off', setError: new Error('persist failed') })
    const wrapper = mountSection(env)
    await flushPromises()

    await wrapper.find('[data-testid="link-crypto-policy-preferred"]').trigger('click')
    await flushPromises()

    expect(env.appLinkCryptoSet).toHaveBeenCalledWith('preferred')
    expect(activePolicy(wrapper)).toBe('link-crypto-policy-off')
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(t('linkCrypto.saveFailed'))
  })

  it('WS 帧级加密已支持：required 可选并可下发', async () => {
    const env = makeEnv({ policy: 'off' })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-ws-gap"]').exists()).toBe(false)
    const requiredBtn = wrapper.find('[data-testid="link-crypto-policy-required"]')
    expect(requiredBtn.attributes('disabled')).toBeUndefined()
    await requiredBtn.trigger('click')
    await flushPromises()
    expect(env.appLinkCryptoSet).toHaveBeenCalledWith('required')
    expect(activePolicy(wrapper)).toBe('link-crypto-policy-required')
  })

  it('旧宿主 wsSession=false：required 不可选并显性说明（不把 WS 明文说成已加密）', async () => {
    const env = makeEnv({ policy: 'off', caps: capabilities({ wsSession: false }) })
    const wrapper = mountSection(env)
    await flushPromises()

    const requiredBtn = wrapper.find('[data-testid="link-crypto-policy-required"]')
    expect(requiredBtn.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="link-crypto-ws-gap"]').text()).toBe(
      t('linkCrypto.wsNotEncrypted'),
    )
    // 明文 / 尽量加密仍可选
    expect(
      wrapper.find('[data-testid="link-crypto-policy-off"]').attributes('disabled'),
    ).toBeUndefined()
    expect(
      wrapper.find('[data-testid="link-crypto-policy-preferred"]').attributes('disabled'),
    ).toBeUndefined()
  })

  it('旧宿主不注入 own-token 方法：显性提示不可用，控件禁用', async () => {
    const env = makeEnv({ omitBindings: true })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(t('linkCrypto.capabilityMissing'))
    expect(wrapper.find('[data-testid="link-crypto-hint"]').exists()).toBe(false)
    for (const button of wrapper.findAll('[data-testid^="link-crypto-policy-"]')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('能力缺 appScopedPolicy：按不可用处理，不假装有策略面', async () => {
    const env = makeEnv({ caps: capabilities({ appScopedPolicy: false }) })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-unavailable"]').exists()).toBe(true)
    expect(activePolicy(wrapper)).toBeNull()
  })
})
