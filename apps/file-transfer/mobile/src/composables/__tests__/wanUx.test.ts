/**
 * T20 契约测试（移动端）：上次传输形态 / 仅经中继 / 分类失败
 *
 * 与桌面 `src/__tests__/{deviceState,remoteDevices}.test.ts` 同判据（双端各一份
 * 是既有口径：`deviceState.ts` / `usePeerDevices.ts` 两处一起改）。
 * 移动 vitest 是 node 环境，只覆盖纯函数 + composable 层，不渲染组件。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import {
  deriveDeviceRows,
  dialFailureFromError,
  dialFailureFromResult,
  normalizeTransport,
} from '../deviceState'
import { usePeerDevices } from '../usePeerDevices'

const NODE_REMOTE = 'f'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

type EventHandler = (payload: any) => void

function makeContext() {
  const calls: Array<{ id: string; args: any }> = []
  const handlers = new Map<string, EventHandler[]>()
  const responders = new Map<string, (args: any) => unknown>()

  const context = {
    commands: {
      async execute(id: string, args?: any) {
        calls.push({ id, args })
        const respond = responders.get(id)
        if (!respond) throw new Error(`no responder for ${id}`)
        return respond(args)
      },
      register: vi.fn(),
    },
    events: {
      on(event: string, handler: EventHandler) {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return {
          dispose: () =>
            handlers.set(
              event,
              (handlers.get(event) ?? []).filter((h) => h !== handler),
            ),
        }
      },
    },
  } as unknown as PluginContext

  function emit(event: string, payload: unknown): void {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }
  function onCommand(id: string, respond: (args: any) => unknown): void {
    responders.set(id, respond)
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { context, calls, emit, onCommand, flush }
}

function setup() {
  const h = makeContext()
  h.onCommand('file-transfer.get-device-snapshot', () => ({ devices: [] }))
  h.onCommand('file-transfer.save-device-snapshot', () => ({ ok: true }))
  h.onCommand('file-transfer.refresh-devices', () => ({ ok: true }))
  h.onCommand('file-transfer.remember-peer-endpoint', () => ({ ok: true }))
  h.onCommand('file-transfer.set-active-peer', () => ({ ok: true }))
  h.onCommand('file-transfer.dial-peer', () => ({ status: 'connected' }))
  h.onCommand('file-transfer.disconnect-peer', () => ({ existed: true }))
  const peers = usePeerDevices(h.context)
  return { ...h, peers }
}

describe('T20 · 拨号失败分类（纯函数）', () => {
  it('connected / 缺省 = 成功；已知 token = 对应分类', () => {
    expect(dialFailureFromResult({ status: 'connected' })).toBeNull()
    expect(dialFailureFromResult({})).toBeNull()
    for (const token of [
      'denied',
      'no-endpoint',
      'relay-disabled',
      'relay-unreachable',
      'lan-unreachable',
      'timeout',
    ] as const) {
      expect(dialFailureFromResult({ status: token })).toEqual({ code: token })
    }
    expect(
      dialFailureFromResult({ status: 'relay-disabled', detail: 'relay is disabled' }),
    ).toEqual({ code: 'relay-disabled', detail: 'relay is disabled' })
  })

  it('未知 status / 命令抛错都不猜成因：unknown + 原文', () => {
    expect(dialFailureFromResult({ status: 'quarantined' })).toEqual({
      code: 'unknown',
      detail: 'quarantined',
    })
    expect(dialFailureFromError(new Error('host error -1: boom'))).toEqual({
      code: 'unknown',
      detail: 'host error -1: boom',
    })
    expect(dialFailureFromError({ code: 'errors.host.internal', request_id: 'abcd1234' })).toEqual({
      code: 'unknown',
      detail: '{"code":"errors.host.internal","request_id":"abcd1234"}',
    })
    const long = dialFailureFromError('x'.repeat(1000))
    expect(long.detail!.length).toBeLessThanOrEqual(241)
    expect(long.detail!.endsWith('…')).toBe(true)
  })

  it('transport 词表外的值不猜', () => {
    expect(normalizeTransport('lan-direct')).toBe('lan-direct')
    expect(normalizeTransport('wan-relay')).toBe('wan-relay')
    expect(normalizeTransport('satellite')).toBeNull()
    expect(normalizeTransport(undefined)).toBeNull()
  })
})

describe('T20 · 行状态派生', () => {
  const device = {
    nodeId: NODE_REMOTE,
    deviceName: 'Remote',
    addr: '',
    port: 0,
    addrs: [LAN, RELAY],
    paired: true,
  }

  function derive(overrides: Partial<Parameters<typeof deriveDeviceRows>[0]> = {}) {
    return deriveDeviceRows({
      devices: [device],
      connectingIds: new Set(),
      connectedIds: new Set(),
      dialErrors: {},
      activePeerId: '',
      ...overrides,
    })[0]
  }

  it('上次传输形态断开后仍展示；词表外值不展示', () => {
    expect(derive({ devices: [{ ...device, lastTransport: 'wan-relay' }] }).lastTransport).toBe(
      'wan-relay',
    )
    expect(
      derive({ devices: [{ ...device, lastTransport: 'quic' as never }] }).lastTransport,
    ).toBeNull()
  })

  it('LAN 失败 + 有 relay 候选 ⇒ 建议仅经中继；中继失败不再建议', () => {
    expect(
      derive({ dialErrors: { [NODE_REMOTE]: { code: 'lan-unreachable' } } }).relayOnlyRecommended,
    ).toBe(true)
    expect(
      derive({ dialErrors: { [NODE_REMOTE]: { code: 'relay-unreachable' } } }).relayOnlyRecommended,
    ).toBe(false)
    // 无 relay 候选：没有可走的出路
    expect(
      derive({
        devices: [{ ...device, addrs: [LAN] }],
        dialErrors: { [NODE_REMOTE]: { code: 'lan-unreachable' } },
      }).relayOnlyRecommended,
    ).toBe(false)
  })

  it('已连接 / 握手中不残留失败态', () => {
    const failure = { code: 'lan-unreachable' as const }
    expect(
      derive({ connectedIds: new Set([NODE_REMOTE]), dialErrors: { [NODE_REMOTE]: failure } })
        .dialError,
    ).toBeNull()
    expect(
      derive({ connectingIds: new Set([NODE_REMOTE]), dialErrors: { [NODE_REMOTE]: failure } })
        .dialError,
    ).toBeNull()
  })
})

describe('T20 · 连接编排（composable）', () => {
  it('上次经中继 ⇒ 重连默认带 wan；显式 relayOnly 带 relayOnly', async () => {
    const { peers, calls, emit, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN, RELAY], ticket: null, deviceName: '' })

    emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE_REMOTE,
      connected: true,
      transport: 'wan-relay',
    })
    expect(peers.rows.value[0]!.lastTransport).toBe('wan-relay')
    emit('plugin:file-transfer:connection-changed', { nodeId: NODE_REMOTE, connected: false })
    await flush()
    // 断开后保留（重连策略输入）
    expect(peers.rows.value[0]!.lastTransport).toBe('wan-relay')

    await peers.connect(NODE_REMOTE)
    let dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.wan).toBe(true)
    expect(dial.args.relayOnly).toBeUndefined()

    await peers.disconnect(NODE_REMOTE)
    await flush()
    await peers.connect(NODE_REMOTE, { relayOnly: true })
    dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.relayOnly).toBe(true)
  })

  it('分类失败不改连接态；成功即清除旧失败', async () => {
    const { peers, onCommand, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN, RELAY], ticket: null, deviceName: '' })
    onCommand('file-transfer.dial-peer', () => ({ status: 'lan-unreachable' }))

    expect(await peers.connect(NODE_REMOTE)).toBe('lan-unreachable')
    expect(peers.connectedIds.value.has(NODE_REMOTE)).toBe(false)
    expect(peers.rows.value[0]!.dialError).toEqual({ code: 'lan-unreachable' })
    expect(peers.rows.value[0]!.relayOnlyRecommended).toBe(true)

    onCommand('file-transfer.dial-peer', () => ({ status: 'connected' }))
    expect(await peers.connect(NODE_REMOTE, { relayOnly: true })).toBe('connected')
    expect(peers.rows.value[0]!.dialError).toBeNull()
  })

  it('无 endpoint 本地即判 no-endpoint（不发命令）', async () => {
    const { peers, calls, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [], ticket: null, deviceName: '' })
    expect(await peers.connect(NODE_REMOTE)).toBe('no-endpoint')
    expect(calls.some((c) => c.id === 'file-transfer.dial-peer')).toBe(false)
  })
})
