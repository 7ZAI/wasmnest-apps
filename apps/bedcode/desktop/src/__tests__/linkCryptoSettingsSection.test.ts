/**
 * LinkCryptoSettingsSection 行为契约（T07：固定强制加密，不可关闭）
 *
 * 契约清单：
 * - C1 策略档位是**只读状态**：不渲染 off / preferred 选择按钮（配置层拒绝关闭）；
 * - C2 宿主记录旧值（off / preferred）时，加载即自动收紧为 `required`；
 * - C3 自动收紧失败：显示修复入口与失败原因，重试成功后转为已生效；
 * - C4 强制加密**无法生效**时不写库、也不宣称已加密：
 *      · 链路身份未初始化（required 会拒绝全部对端）；
 *      · 旧宿主 WS 帧级加密未接线（WS 仍明文）；
 * - C5 旧宿主缺 own-token 方法 / 能力字段：显性提示不可用；
 * - C6 展示本机指纹（供双端人工核对）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import type { AppMountEnv } from '@/entry'
import type { EncryptionPolicy } from '@/composables/useLinkCrypto'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => toastMock }))

import LinkCryptoSettingsSection from '@/components/LinkCryptoSettingsSection.vue'

const t = (key: string, named?: Record<string, unknown>) =>
  i18n.global.t(`com.wasmnest.bedcode.${key}`, named ?? {})

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
  policy?: EncryptionPolicy
  caps?: unknown
  /** 前 N 次 `appLinkCryptoSet` 抛错（模拟宿主写库失败） */
  writeFailures?: number
  omitBindings?: boolean
}

interface EnvFixture {
  env: AppMountEnv
  /** 宿主侧真实状态：写入成功的值才会更新 */
  state: { policy: EncryptionPolicy; writes: EncryptionPolicy[] }
}

function makeEnv(options: EnvOptions = {}): EnvFixture {
  const state = { policy: options.policy ?? 'off', writes: [] as EncryptionPolicy[] }
  let remainingFailures = options.writeFailures ?? 0

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
    env.appLinkCryptoGet = vi.fn(async () => state.policy)
    env.appLinkCryptoSet = vi.fn(async (next: EncryptionPolicy) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error('persist failed')
      }
      state.writes.push(next)
      state.policy = next
    })
  }
  return { env, state }
}

function mountSection(env: AppMountEnv) {
  return mount(LinkCryptoSettingsSection, {
    global: { plugins: [i18n], provide: { appEnv: env } },
  })
}

function badge(wrapper: ReturnType<typeof mountSection>) {
  const node = wrapper.find('[data-testid="link-crypto-policy"]')
  return {
    exists: node.exists(),
    policy: node.attributes('data-policy'),
    enforced: node.attributes('data-enforced'),
    text: node.text(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LinkCryptoSettingsSection — 固定强制加密（T07）', () => {
  it('宿主已 required：显示已生效与指纹，且不重复写库', async () => {
    const { env, state } = makeEnv({ policy: 'required' })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(env.appLinkCryptoGet).toHaveBeenCalled()
    expect(state.writes).toEqual([])
    expect(badge(wrapper)).toMatchObject({ policy: 'required', enforced: 'true' })
    expect(wrapper.find('[data-testid="link-crypto-enforced"]').text()).toBe(
      t('linkCrypto.requiredHint'),
    )
    expect(wrapper.find('[data-testid="link-crypto-fingerprint"]').text()).toBe('abcd1234abcd1234')
    expect(wrapper.find('[data-testid="link-crypto-repair"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="link-crypto-blocked"]').exists()).toBe(false)
  })

  it('宿主记录 off：加载即收紧为 required，界面不提供关闭/放行档', async () => {
    const { env, state } = makeEnv({ policy: 'off' })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(state.writes).toEqual(['required'])
    expect(state.policy).toBe('required')
    expect(env.appLinkCryptoSet).toHaveBeenCalledWith('required')
    expect(badge(wrapper)).toMatchObject({ policy: 'required', enforced: 'true' })

    // C1 只读档位：三档选择器已退役（没有任何 link-crypto-policy-<档> 按钮）
    expect(wrapper.findAll('[data-testid^="link-crypto-policy-"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="link-crypto-enforce"]').exists()).toBe(false)
  })

  it('自动收紧失败：显示修复入口与原因；重试成功后生效', async () => {
    const { env, state } = makeEnv({ policy: 'preferred', writeFailures: 1 })
    const wrapper = mountSection(env)
    await flushPromises()

    // 首次自动写入失败：保持「未生效」并给出原因，不显示已生效假象
    expect(state.policy).toBe('preferred')
    expect(badge(wrapper)).toMatchObject({ policy: 'preferred', enforced: 'false' })
    expect(wrapper.find('[data-testid="link-crypto-repair"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="link-crypto-repair"]').text()).toContain(
      t('linkCrypto.repairNeeded', { state: t('linkCrypto.currentPreferred') }),
    )
    expect(wrapper.find('[data-testid="link-crypto-error"]').text()).toContain('persist failed')
    expect(toastMock.success).not.toHaveBeenCalled()

    // 手动修复：唯一写入口只写 required
    await wrapper.find('[data-testid="link-crypto-enforce"]').trigger('click')
    await flushPromises()

    expect(state.writes).toEqual(['required'])
    expect(badge(wrapper)).toMatchObject({ policy: 'required', enforced: 'true' })
    expect(wrapper.find('[data-testid="link-crypto-repair"]').exists()).toBe(false)
    expect(toastMock.success).toHaveBeenCalledWith(t('linkCrypto.enforced'))
  })

  it('链路身份未初始化：不写库、不宣称已加密（required 会拒绝全部对端）', async () => {
    const { env, state } = makeEnv({
      policy: 'off',
      caps: capabilities({ identityFingerprint: null }),
    })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(state.writes).toEqual([])
    expect(env.appLinkCryptoSet).not.toHaveBeenCalled()
    expect(badge(wrapper)).toMatchObject({ enforced: 'false', text: t('linkCrypto.forcedPending') })
    expect(wrapper.find('[data-testid="link-crypto-blocked"]').text()).toBe(
      t('linkCrypto.blockedIdentityMissing'),
    )
    expect(wrapper.find('[data-testid="link-crypto-enforce"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="link-crypto-enforced"]').exists()).toBe(false)
  })

  it('旧宿主 wsSession=false：不写库并明说 WS 仍为明文', async () => {
    const { env, state } = makeEnv({ policy: 'off', caps: capabilities({ wsSession: false }) })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(state.writes).toEqual([])
    expect(badge(wrapper)).toMatchObject({ enforced: 'false' })
    expect(wrapper.find('[data-testid="link-crypto-blocked"]').text()).toBe(
      t('linkCrypto.blockedWsUnsupported'),
    )
    expect(wrapper.find('[data-testid="link-crypto-enforced"]').exists()).toBe(false)
  })

  it('旧宿主不注入 own-token 方法：显性提示不可用，且不写库', async () => {
    const { env, state } = makeEnv({ omitBindings: true })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(t('linkCrypto.capabilityMissing'))
    expect(badge(wrapper).enforced).toBe('false')
    expect(state.writes).toEqual([])
  })

  it('能力缺 appScopedPolicy：按不可用处理，不假装有策略面', async () => {
    const { env, state } = makeEnv({ caps: capabilities({ appScopedPolicy: false }) })
    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-unavailable"]').exists()).toBe(true)
    expect(badge(wrapper).enforced).toBe('false')
    expect(state.writes).toEqual([])
  })
})
