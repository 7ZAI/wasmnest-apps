/**
 * RelayConfigSection 渲染契约（设置页「内网穿透」区块）
 *
 * 锁住五件事：
 * ① 配置来自 `get-my-device`（中心真源），地址默认脱敏、可展开 / 复制；
 * ② 来源 / 状态 / 空间码 / 策略逐项可见（不把缓存当中心，不伪造空配置）；
 * ③ 无 relay 时不生成分享二维码，只给可执行说明；
 * ④ 分享生成后出现二维码（载荷 = relay + 空间码 + 策略，不含密钥）；
 * ⑤ 中心不可用时显性提示 `relayError`，仍展示缓存地址。
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import RelayConfigSection from '../components/RelayConfigSection.vue'
import { maskRelayAddr } from '../utils/relayConfig'

const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelayPeerId'

type Responder = (command: string, args?: Record<string, unknown>) => unknown

function makeContext(responder: Responder) {
  const execute = vi.fn(async (command: string, args?: Record<string, unknown>) =>
    responder(command, args),
  )
  const context = {
    id: 'com.wasmnest.file-transfer',
    i18n: { t: (key: string) => key },
    commands: { execute },
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    events: { on: vi.fn(() => ({ dispose: vi.fn() })), emit: vi.fn() },
  } as unknown as PluginContext
  return { context, execute }
}

function mountSection(context: PluginContext) {
  return mount(RelayConfigSection, {
    global: { provide: { pluginContext: context } },
  })
}

function baseDevice(overrides: Record<string, unknown> = {}) {
  return {
    supported: true,
    capabilities: { nodeInfo: true, relayReservation: true },
    relayAddrs: [RELAY_ENDPOINT],
    relayRoom: 'nest-7f3a2c91',
    relaySource: 'center',
    relayOrigin: '',
    relaySyncedAt: 0,
    wanPolicy: 'allowed',
    relayState: 'relay-reserved',
    nodeId: 'e'.repeat(64),
    deviceName: 'Desktop',
    addrs: [],
    ...overrides,
  }
}

describe('RelayConfigSection', () => {
  it('should_showMaskedAddressSourceStateAndRoom', async () => {
    const { context } = makeContext(() => baseDevice())
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-settings-section-relay-config"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ft-relay-config-addr"]').text()).toBe(
      maskRelayAddr(RELAY_ENDPOINT),
    )
    expect(wrapper.get('[data-testid="ft-relay-config-source"]').text()).toBe(
      'transfer.relayConfig.sourceCenter',
    )
    expect(wrapper.get('[data-testid="ft-relay-config-state"]').text()).toBe(
      'transfer.relayConfig.stateReserved',
    )
    expect(wrapper.get('[data-testid="ft-relay-config-wan-policy"]').text()).toBe(
      'transfer.relayConfig.wanAllowed',
    )
    expect(wrapper.get('[data-testid="ft-relay-config-room"]').text()).toBe('nest-7f3a2c91')
    expect(wrapper.find('[data-testid="ft-relay-config-empty"]').exists()).toBe(false)

    // 地址 / 复制 / 显示完整地址必须同一行（曾各自换行成单独一行）
    const row = wrapper.get('.ft-relay-config-addr-row')
    expect(row.find('[data-testid="ft-relay-config-addr"]').exists()).toBe(true)
    expect(row.find('[data-testid="ft-relay-config-copy"]').exists()).toBe(true)
    expect(row.find('[data-testid="ft-relay-config-reveal"]').exists()).toBe(true)
  })

  it('should_revealFullAddressAndCopyIt', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const { context } = makeContext(() => baseDevice())
    const wrapper = mountSection(context)
    await flushPromises()

    await wrapper.get('[data-testid="ft-relay-config-reveal"]').trigger('click')
    expect(wrapper.get('[data-testid="ft-relay-config-addr"]').text()).toBe(RELAY_ENDPOINT)

    await wrapper.get('[data-testid="ft-relay-config-copy"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(RELAY_ENDPOINT)
    // 复制反馈就地改按钮文案（不再额外占一行）
    expect(wrapper.get('[data-testid="ft-relay-config-copy"]').text()).toBe(
      'transfer.relayConfig.copied',
    )
  })

  it('should_explainEmptyConfigAndDisableShare', async () => {
    const { context } = makeContext(() => baseDevice({ relayAddrs: [], relayState: 'relay-idle' }))
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.get('[data-testid="ft-relay-config-empty"]').text()).toBe(
      'transfer.relayConfig.empty',
    )
    expect(
      wrapper.get('[data-testid="ft-relay-config-share"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.find('[data-testid="ft-relay-config-qr"]').exists()).toBe(false)
  })

  it('should_generateShareQr', async () => {
    const { context } = makeContext(() => baseDevice())
    const wrapper = mountSection(context)
    await flushPromises()

    await wrapper.get('[data-testid="ft-relay-config-share"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-relay-config-qr"]').exists()).toBe(true)
    // 二维码必须带扫码去向（手机设置页），不只是一个裸码
    expect(wrapper.get('[data-testid="ft-relay-config-qr-hint"]').text()).toBe(
      'transfer.relayConfig.shareHint',
    )
    expect(wrapper.find('[data-testid="ft-relay-config-share-error"]').exists()).toBe(false)
  })

  it('should_surfaceCenterErrorWhileKeepingCacheAddrs', async () => {
    const { context } = makeContext(() =>
      baseDevice({ relaySource: 'cache', relayError: 'api-call: timeout' }),
    )
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.get('[data-testid="ft-relay-config-source"]').text()).toBe(
      'transfer.relayConfig.sourceCache',
    )
    const error = wrapper.get('[data-testid="ft-relay-config-error"]').text()
    expect(error).toContain('transfer.relayConfig.centerError')
    expect(wrapper.find('[data-testid="ft-relay-config-addr"]').exists()).toBe(true)
  })

  it('should_showQrAndSyncSourcesDistinctly', async () => {
    for (const [source, key] of [
      ['qr', 'transfer.relayConfig.sourceQr'],
      ['sync', 'transfer.relayConfig.sourceSync'],
    ] as const) {
      const { context } = makeContext(() => baseDevice({ relaySource: source }))
      const wrapper = mountSection(context)
      await flushPromises()
      expect(wrapper.get('[data-testid="ft-relay-config-source"]').text()).toBe(key)
    }
  })
})
