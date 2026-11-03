/**
 * LinkCryptoSettingsSection 行为契约（按应用/端点加密策略 spec §6）
 *
 * 契约清单：
 * - C1 只读展示宿主下限：经 `get_link_crypto_capabilities` 取 floor 并回显；
 * - C2 只读展示本机指纹（供双端人工核对）；
 * - C3 不提供写入口：挂载与交互全程不调 `set_traffic_encryption_config`，
 *   页面上没有可切换的开关（旧版开关会把全机加密关掉——issue #45）；
 * - C4 旧宿主缺能力（invoke 拒绝 / 缺字段）：显性提示能力缺失，不假装已加密。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import type { AppMountEnv } from '@/entry'
import LinkCryptoSettingsSection from '@/components/LinkCryptoSettingsSection.vue'

const t = (key: string) => i18n.global.t(`com.wasmnest.bedcode.${key}`)

function makeEnv(impl: (command: string) => unknown): AppMountEnv {
  return {
    appId: 'com.wasmnest.bedcode',
    invoke: vi.fn(async (command: string) => impl(command)),
    appInvoke: vi.fn(async () => undefined),
    appStorageGet: vi.fn(async () => undefined),
    appStorageSet: vi.fn(async () => {}),
    appStorageDelete: vi.fn(async () => {}),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '/settings',
  } as unknown as AppMountEnv
}

function capabilities(floor: 'off' | 'preferred' | 'required') {
  return {
    per_endpoint_policy: true,
    endpoint_policies: ['off', 'preferred', 'required'],
    floor,
    identity_fingerprint: 'abcd1234abcd1234',
    key_models: ['http-path-bound', 'ws-session'],
  }
}

function mountSection(env: AppMountEnv) {
  return mount(LinkCryptoSettingsSection, {
    global: { plugins: [i18n], provide: { appEnv: env } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LinkCryptoSettingsSection — 只读宿主下限', () => {
  it('回显宿主下限与本机指纹（required）', async () => {
    const env = makeEnv((command) => {
      if (command === 'get_link_crypto_capabilities') return capabilities('required')
      throw new Error(`unexpected command: ${command}`)
    })

    const wrapper = mountSection(env)
    await flushPromises()

    expect(env.invoke).toHaveBeenCalledWith('get_link_crypto_capabilities')
    expect(wrapper.find('[data-testid="link-crypto-floor"]').text()).toBe(
      t('linkCrypto.floorRequired'),
    )
    expect(wrapper.text()).toContain('abcd1234abcd1234')
    // 归属说明：下限归宿主设置页，应用不提供写入口
    expect(wrapper.text()).toContain(t('linkCrypto.hostManaged'))
  })

  it('下限为明文时回显「明文」，但页面无任何开关', async () => {
    const env = makeEnv((command) => {
      if (command === 'get_link_crypto_capabilities') return capabilities('off')
      throw new Error(`unexpected command: ${command}`)
    })

    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-floor"]').text()).toBe(t('linkCrypto.floorOff'))
    // 只读面：没有可切换控件
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(0)
    // 全程不调用写命令（旧版会调 set_traffic_encryption_config）
    const commands = vi.mocked(env.invoke).mock.calls.map(([command]) => command)
    expect(commands).not.toContain('set_traffic_encryption_config')
  })

  it('旧宿主缺能力查询：显性提示能力缺失，不渲染假下限', async () => {
    const env = makeEnv((command) => {
      throw new Error(`command not allowed: ${command}`)
    })

    const wrapper = mountSection(env)
    await flushPromises()

    expect(wrapper.find('[data-testid="link-crypto-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(t('linkCrypto.capabilityMissing'))
    expect(wrapper.find('[data-testid="link-crypto-floor"]').text()).toBe('—')
  })
})
