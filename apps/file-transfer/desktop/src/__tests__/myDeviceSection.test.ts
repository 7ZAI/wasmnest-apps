/**
 * MyDeviceSection 渲染契约（设置页「我的设备」区块）
 *
 * 锁住三件事：
 * ① 宿主提供设备身份时展示设备名与短指纹（完整值在 title 里）；
 * ② 宿主能力未就绪时显性 unsupported，不伪造指纹；
 * ③ 读取失败时给出可重试出路（重试后重新拉取）。
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import MyDeviceSection from '../components/MyDeviceSection.vue'

const NODE_ID = 'ab'.repeat(32)

type Responder = () => unknown

function makeContext(responder: Responder) {
  const execute = vi.fn(async () => responder())
  const context = {
    id: 'com.wasmnest.file-transfer',
    i18n: { t: (key: string) => key },
    commands: { execute },
  } as unknown as PluginContext
  return { context, execute }
}

function mountSection(context: PluginContext) {
  return mount(MyDeviceSection, {
    global: { provide: { pluginContext: context } },
  })
}

describe('MyDeviceSection', () => {
  it('should_showDeviceNameAndShortFingerprint', async () => {
    const { context } = makeContext(() => ({
      supported: true,
      capabilities: { nodeInfo: true, relayReservation: false },
      nodeId: NODE_ID,
      deviceName: 'My Laptop',
      addrs: [],
      relayAddrs: [],
    }))
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-settings-section-my-device"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ft-my-device-name"]').text()).toBe('My Laptop')
    const fp = wrapper.get('[data-testid="ft-my-device-fingerprint"]')
    expect(fp.text()).toBe(NODE_ID.slice(0, 16))
    expect(fp.attributes('title')).toBe(NODE_ID)
    expect(wrapper.find('[data-testid="ft-my-device-unsupported"]').exists()).toBe(false)
  })

  it('should_surfaceUnsupportedHostWithoutFakeIdentity', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      reason: 'host-unsupported',
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [],
    }))
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-unsupported"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ft-my-device-fingerprint"]').exists()).toBe(false)
  })

  it('should_retryAfterLoadError', async () => {
    let calls = 0
    const { context, execute } = makeContext(() => {
      calls += 1
      if (calls === 1) throw new Error('host error')
      return {
        supported: true,
        capabilities: { nodeInfo: true, relayReservation: false },
        nodeId: NODE_ID,
        deviceName: '',
        addrs: [],
        relayAddrs: [],
      }
    })
    const wrapper = mountSection(context)
    await flushPromises()

    expect(wrapper.find('[data-testid="ft-my-device-load-error"]').exists()).toBe(true)
    await wrapper.get('[data-testid="ft-my-device-retry"]').trigger('click')
    await flushPromises()

    expect(execute).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="ft-my-device-name"]').text()).toBe(
      'transfer.myDevice.unnamed',
    )
  })
})
