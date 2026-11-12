/**
 * 邀请导入（T23）— AddRemoteDeviceDialog 契约测试
 *
 * 锁住：
 * ① v3 设备链接行为不回归（解析成功直接 emit add）；
 * ② v4 邀请先进确认页，点「加入」才写设置（relay + room + relayOrigin）；
 * ③ 中心与邀请冲突时不给假成功（按钮禁用 + 冲突文案）；
 * ④ 已在别的空间时确认页明确「加入后看不到原空间设备」。
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import AddRemoteDeviceDialog from '../components/AddRemoteDeviceDialog.vue'
import { buildConnectionInvite, buildRemotePeerLink } from '../utils/pairingLink'

const NODE_ID = 'a'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
const RELAY_A = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'
const RELAY_B = '/ip4/198.51.100.7/tcp/4001/p2p/12D3KooWOther'

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

function mountDialog(context: PluginContext, relayDeviceCount = 0) {
  return mount(AddRemoteDeviceDialog, {
    props: { relayDeviceCount },
    global: {
      provide: { pluginContext: context },
      stubs: { Teleport: true },
    },
  })
}

const inviteText = buildConnectionInvite({
  room: 'nest-7f3a2c91',
  relay: [RELAY_A],
  name: '客厅 NAS',
})

describe('AddRemoteDeviceDialog — v3 设备链接', () => {
  it('解析成功直接 emit add（不进入邀请确认页）', async () => {
    const { context } = makeContext(() => ({ relayAddrs: [], relayRoom: '' }))
    const wrapper = mountDialog(context)
    await flushPromises()

    const text = buildRemotePeerLink({ nodeId: NODE_ID, addrs: [LAN], deviceName: '手机' })
    await wrapper.find('[data-testid="ft-remote-add-input"]').setValue(text)
    await wrapper.find('[data-testid="ft-remote-add-confirm"]').trigger('click')

    expect(wrapper.emitted('add')?.[0]?.[0]).toMatchObject({ nodeId: NODE_ID })
    expect(wrapper.find('[data-testid="ft-invite-confirm"]').exists()).toBe(false)
  })
})

describe('AddRemoteDeviceDialog — v4 邀请', () => {
  it('先进确认页；点加入才写设置并 emit joined', async () => {
    const { context, calls } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return {
          relayAddrs: [],
          relayRoom: '',
          relaySource: 'cache',
          deviceName: 'PC',
        }
      }
      return { ok: true }
    })
    const wrapper = mountDialog(context, 3)
    await flushPromises()

    await wrapper.find('[data-testid="ft-remote-add-input"]').setValue(inviteText)
    await wrapper.find('[data-testid="ft-remote-add-confirm"]').trigger('click')

    expect(wrapper.find('[data-testid="ft-invite-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ft-invite-confirm-name"]').text()).toContain(
      'transfer.invite.joinName',
    )
    expect(wrapper.find('[data-testid="ft-invite-confirm-count"]').text()).toBe('3')
    // 确认页阶段不得写设置
    expect(calls.some((c) => c.id === 'file-transfer.set-settings')).toBe(false)

    await wrapper.find('[data-testid="ft-invite-join"]').trigger('click')
    await flushPromises()

    const write = calls.find((c) => c.id === 'file-transfer.set-settings')
    expect(write?.args).toEqual({
      relayAddrs: [RELAY_A],
      relayRoom: 'nest-7f3a2c91',
      relayOrigin: 'invite',
    })
    expect(wrapper.emitted('joined')?.[0]?.[0]).toMatchObject({
      room: 'nest-7f3a2c91',
      relay: [RELAY_A],
    })
  })

  it('中心与邀请不同：显示冲突并禁用加入', async () => {
    const { context, calls } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return {
          relayAddrs: [RELAY_B],
          relayRoom: '',
          relaySource: 'center',
          deviceName: 'PC',
        }
      }
      return { ok: true }
    })
    const wrapper = mountDialog(context)
    await flushPromises()

    await wrapper.find('[data-testid="ft-remote-add-input"]').setValue(inviteText)
    await wrapper.find('[data-testid="ft-remote-add-confirm"]').trigger('click')

    expect(wrapper.find('[data-testid="ft-invite-confirm-conflict"]').exists()).toBe(true)
    const join = wrapper.find('[data-testid="ft-invite-join"]')
    expect(join.attributes('disabled')).toBeDefined()
    await join.trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.id === 'file-transfer.set-settings')).toBe(false)
  })

  it('已在别的空间：确认页提示将看不到原空间设备', async () => {
    const { context } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return {
          relayAddrs: [RELAY_A],
          relayRoom: 'old-space',
          relaySource: 'cache',
          deviceName: 'PC',
        }
      }
      return { ok: true }
    })
    const wrapper = mountDialog(context)
    await flushPromises()

    await wrapper.find('[data-testid="ft-remote-add-input"]').setValue(inviteText)
    await wrapper.find('[data-testid="ft-remote-add-confirm"]').trigger('click')

    expect(wrapper.find('[data-testid="ft-invite-confirm-leave-room"]').exists()).toBe(true)
  })
})
