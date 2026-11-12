/**
 * 「我的设备」（T21）读面 / 链接 / relay 来源契约测试
 *
 * | 用例 | 期望 |
 * | --- | --- |
 * | 宿主不支持 node-info | `supported=false`、无链接、不伪造 nodeId |
 * | 宿主提供 node-info | 生成 v3 链接，解析端可原样读回 |
 * | relay 来自配置中心 | `relaySource=center`、无错误 |
 * | 中心降级用缓存 | `relaySource=cache` 且 `relayError` 非空（不被吞） |
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useMyDevice } from '../composables/useMyDevice'
import { parseRemotePeerLink } from '../utils/pairingLink'

const NODE_ID = 'a'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
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

describe('useMyDevice — 宿主能力未就绪', () => {
  it('should_reportUnsupportedAndNeverFabricateLink', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      reason: 'host-unsupported',
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [RELAY_ENDPOINT],
    }))
    const my = useMyDevice(context)
    await my.load()

    expect(my.info.value.supported).toBe(false)
    expect(my.info.value.nodeId).toBeUndefined()
    expect(my.canShare.value).toBe(false)
    expect(my.link.value).toBe('')
    // 已保存的 relay 端点仍可读回（配置面不依赖 node-info）
    expect(my.info.value.relayAddrs).toEqual([RELAY_ENDPOINT])
  })
})

describe('useMyDevice — 宿主提供 node-info', () => {
  it('should_buildV3LinkThatParserRoundTrips', async () => {
    const { context } = makeContext(() => ({
      supported: true,
      reason: null,
      capabilities: { nodeInfo: true, relayReservation: true },
      relayAddrs: [RELAY_ENDPOINT],
      nodeId: NODE_ID,
      deviceName: '客厅 NAS',
      addrs: [LAN, `${RELAY_ENDPOINT}/p2p-circuit/p2p/${NODE_ID}`],
      relayState: 'relay-reserved',
    }))
    const my = useMyDevice(context)
    await my.load()

    expect(my.canShare.value).toBe(true)
    const parsed = parseRemotePeerLink(my.link.value)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.link.nodeId).toBe(NODE_ID)
    expect(parsed.link.deviceName).toBe('客厅 NAS')
    expect(parsed.link.addrs).toHaveLength(2)
    expect(parsed.link.addrs[0]).toBe(LAN)
  })

  it('should_notBuildLinkWhenAddrsMissing', async () => {
    const { context } = makeContext(() => ({
      supported: true,
      capabilities: { nodeInfo: true, relayReservation: false },
      relayAddrs: [],
      nodeId: NODE_ID,
      addrs: [],
    }))
    const my = useMyDevice(context)
    await my.load()
    expect(my.info.value.supported).toBe(true)
    expect(my.canShare.value).toBe(false)
  })
})

describe('useMyDevice — relay 地址来源', () => {
  it('should_exposeCenterSourceAndReadOnlyFlag', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [RELAY_ENDPOINT],
      relaySource: 'center',
      relayError: null,
    }))
    const my = useMyDevice(context)
    await my.load()

    expect(my.info.value.relaySource).toBe('center')
    expect(my.info.value.relayError).toBeNull()
    expect(my.info.value.relayAddrs).toEqual([RELAY_ENDPOINT])
  })

  it('should_surfaceCacheFallbackError', async () => {
    const { context } = makeContext(() => ({
      supported: false,
      capabilities: { nodeInfo: false, relayReservation: false },
      relayAddrs: [RELAY_ENDPOINT],
      relaySource: 'cache',
      relayError: 'api-call: timeout',
    }))
    const my = useMyDevice(context)
    await my.load()

    expect(my.info.value.relaySource).toBe('cache')
    expect(my.info.value.relayError).toBe('api-call: timeout')
  })
})


describe('useMyDevice — 空间码', () => {
  it('should_saveRoomAndReload', async () => {
    let room = ''
    const { context, calls } = makeContext((command, args) => {
      if (command === 'file-transfer.set-settings') {
        room = String((args as Record<string, unknown>)?.relayRoom ?? '')
        return { ok: true }
      }
      return {
        supported: true,
        capabilities: { nodeInfo: true, relayReservation: true },
        relayAddrs: [RELAY_ENDPOINT],
        relayRoom: room,
        relayState: 'relay-reserved',
        nodeId: NODE_ID,
        addrs: [LAN],
      }
    })
    const my = useMyDevice(context)
    await my.load()
    await my.saveRelayRoom('home_1')

    expect(calls.find((c) => c.id === 'file-transfer.set-settings')!.args).toEqual({
      relayRoom: 'home_1',
    })
    expect(my.info.value.relayRoom).toBe('home_1')
    expect(my.roomSaved.value).toBe(true)
  })
})
