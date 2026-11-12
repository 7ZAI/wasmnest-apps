/**
 * MyDeviceDialog 渲染契约（T21）
 *
 * 锁住四件事：
 * ① 宿主不支持 node-info 时显性提示，且不渲染伪造连接串；
 * ② 宿主提供 node-info 时渲染 v3 `wasmnest://pair/…`，复制按钮可用；
 * ③ relay 地址只读展示（真源在「内网穿透」配置中心），本页不再提供编辑器；
 * ④ 中心降级用缓存时显性提示，不把缓存当中心。
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import MyDeviceDialog from '../components/MyDeviceDialog.vue'

const NODE_ID = 'd'.repeat(64)
const LAN = '/ip4/192.168.1.9/tcp/47613'
const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

type Responder = (command: string, args?: Record<string, unknown>) => unknown

function makeContext(responder: Responder, navigate?: (path: string) => boolean) {
  const calls: Array<{ id: string; args?: Record<string, unknown> }> = []
  const execute = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push({ id: command, args })
    return responder(command, args)
  })
  const context = {
    id: 'com.wasmnest.file-transfer',
    i18n: { t: (key: string) => key },
    commands: { execute },
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    events: { on: vi.fn(() => ({ dispose: vi.fn() })), emit: vi.fn() },
    ...(navigate ? { navigate } : {}),
  } as unknown as PluginContext
  return { context, calls }
}

function mountDialog(context: PluginContext) {
  return mount(MyDeviceDialog, {
    global: {
      provide: { pluginContext: context },
      // Teleport 到 body 会让 wrapper.find 找不到内容；测试里原地渲染
      stubs: { Teleport: true },
    },
  })
}

describe('MyDeviceDialog — 宿主不支持 node-info', () => {
  it('should_showUnsupportedNoticeAndNoLink', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      reason: 'host-unsupported',
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [],
    }))
    const wrapper = mountDialog(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-unsupported"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ft-my-device-link"]').exists()).toBe(false)
    // 「只保存、不建立预留」必须显性，不能让用户以为已生效
    expect(wrapper.find('[data-testid="ft-my-device-relay-unsupported"]').exists()).toBe(true)
  })
})

describe('MyDeviceDialog — 宿主提供 node-info', () => {
  it('should_renderV3LinkAndEnableCopy', async () => {
    const { context } = makeContext(() => ({
      supported: true,
      capabilities: { nodeInfo: true, relayReservation: true },
      relayAddrs: [RELAY_ENDPOINT],
      nodeId: NODE_ID,
      deviceName: 'Desktop',
      addrs: [LAN],
      relayState: 'relay-reserved',
    }))
    const wrapper = mountDialog(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-unsupported"]').exists()).toBe(false)
    const link = wrapper.get('[data-testid="ft-my-device-link"]').element as HTMLTextAreaElement
    expect(link.value.startsWith('wasmnest://pair/')).toBe(true)
    expect(wrapper.get('[data-testid="ft-my-device-copy"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="ft-my-device-relay-state"]').text()).toBe(
      'transfer.myDevice.relayReserved',
    )
    // 可分享时必须同时给出二维码（扫码是移动端主路径）
    expect(wrapper.find('[data-testid="ft-my-device-qr"]').exists()).toBe(true)
  })
})

describe('MyDeviceDialog — relay 只读（配置中心真源）', () => {
  const CENTER_RESPONSE = {
    supported: false,
    capabilities: { nodeInfo: false, relayReservation: false },
    relayAddrs: [RELAY_ENDPOINT],
    relaySource: 'center',
    relayError: null,
  }

  it('should_renderReadOnlyAddressesWithoutEditor', async () => {
    const { context } = makeContext(() => CENTER_RESPONSE)
    const wrapper = mountDialog(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-relay-list"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(RELAY_ENDPOINT)
    // 桌面端不保留第二份编辑器：没有输入框 / 保存按钮
    expect(wrapper.find('[data-testid="ft-my-device-relay-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ft-my-device-relay-save"]').exists()).toBe(false)
  })

  it('should_warnWhenCenterFellBackToCache', async () => {
    const { context } = makeContext(() => ({
      ...CENTER_RESPONSE,
      relaySource: 'cache',
      relayError: 'api-call: timeout',
    }))
    const wrapper = mountDialog(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-relay-cache"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ft-my-device-relay-center-error"]').exists()).toBe(true)
  })

  it('should_navigateToCenterOrExplainOutage', async () => {
    const navigate = vi.fn(() => true)
    const { context } = makeContext(() => CENTER_RESPONSE, navigate)
    const wrapper = mountDialog(context)
    await flushPromises()

    await wrapper.get('[data-testid="ft-my-device-open-center"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('/network')
    expect(wrapper.find('[data-testid="ft-my-device-open-center-unavailable"]').exists()).toBe(
      false,
    )

    const { context: legacy } = makeContext(() => CENTER_RESPONSE)
    const legacyWrapper = mountDialog(legacy)
    await flushPromises()
    await legacyWrapper.get('[data-testid="ft-my-device-open-center"]').trigger('click')
    expect(
      legacyWrapper.find('[data-testid="ft-my-device-open-center-unavailable"]').exists(),
    ).toBe(true)
  })
})
