/**
 * 「我的设备」（T21）移动端读面契约
 *
 * 宿主未提供 node-info 时不得伪造连接串；relay 端点保存失败不得显示已保存。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useMyDevice } from '../useMyDevice'

const NODE_ID = 'c'.repeat(64)
const LAN = '/ip4/192.168.1.8/tcp/47613'
const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

type Responder = (command: string, args?: Record<string, unknown>) => unknown

function makeContext(responder: Responder) {
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
  } as unknown as PluginContext
  return { context, calls }
}

describe('useMyDevice（移动端）', () => {
  it('should_reportUnsupportedWithoutLink', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      reason: 'host-unsupported',
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [RELAY_ENDPOINT],
    }))
    const my = useMyDevice(context)
    await my.load()
    expect(my.info.value.supported).toBe(false)
    expect(my.link.value).toBe('')
    expect(my.info.value.relayAddrs).toEqual([RELAY_ENDPOINT])
  })

  it('should_buildLinkWhenNodeInfoArrives', async () => {
    const { context } = makeContext(() => ({
      supported: true,
      capabilities: { nodeInfo: true, relayReservation: false },
      relayAddrs: [],
      nodeId: NODE_ID,
      addrs: [LAN],
    }))
    const my = useMyDevice(context)
    await my.load()
    expect(my.canShare.value).toBe(true)
    expect(my.link.value.startsWith('wasmnest://pair/')).toBe(true)
  })

  it('should_notFakeSavedOnRelayFailure', async () => {
    const { context } = makeContext((command) => {
      if (command === 'file-transfer.set-settings') throw new Error('invalid address')
      return {
        supported: false,
        capabilities: { nodeInfo: false, relayReservation: false },
        relayAddrs: [],
      }
    })
    const my = useMyDevice(context)
    await my.load()
    await expect(my.saveRelayAddrs(['bad'])).rejects.toThrow(/invalid address/)
    expect(my.relaySaved.value).toBe(false)
    expect(my.relayError.value).toBe('save-failed')
  })
})


describe('useMyDevice — 空间码', () => {
  it('should_sendRoomTogetherWithRelayAddrs', async () => {
    const { context, calls } = makeContext((command) =>
      command === 'file-transfer.set-settings'
        ? { ok: true }
        : {
            supported: false,
            capabilities: { nodeInfo: false, relayReservation: false },
            relayAddrs: [RELAY_ENDPOINT],
            relayRoom: '',
          },
    )
    const my = useMyDevice(context)
    await my.load()
    await my.saveRelayAddrs([RELAY_ENDPOINT], 'home_1')

    const call = calls.find((c) => c.id === 'file-transfer.set-settings')!
    expect(call.args).toEqual({ relayAddrs: [RELAY_ENDPOINT], relayRoom: 'home_1' })
    expect(my.info.value.relayRoom).toBe('home_1')
  })
})
