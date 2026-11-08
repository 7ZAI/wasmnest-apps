/**
 * 远程设备与拨号载荷（T12）契约测试
 *
 * 覆盖：
 * ① 连接串导入 → 设备缓存条目（paired + 多地址），并与既有发现条目合并去重；
 * ② 拨号命令载荷：带 `addrs`；手动「尝试外网」才带 `wan: true`（§4.9 不自动切）；
 * ③ 宿主 `peer:connection.transport` → 设备行 `transport`，断开即清除；
 * ④ 快照恢复：手动添加的远程设备可直接拨号（发现条目仍受 restored 防线约束）；
 * ⑤ 配对条目落盘（addrs + paired）与移除。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { usePeerDevices } from '../composables/usePeerDevices'

type EventHandler = (payload: any) => void

const NODE_REMOTE = 'f'.repeat(64)
const NODE_MDNS = 'a'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

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

describe('远程设备（T12）', () => {
  it('addRemotePeer 落 paired + 多地址，同 nodeId 合并去重且返回新增标记', () => {
    const { peers } = setup()
    expect(
      peers.addRemotePeer({
        nodeId: NODE_REMOTE,
        addrs: [LAN, RELAY],
        ticket: 'tkt',
        deviceName: '书房 NAS',
      }),
    ).toBe(true)
    let row = peers.rows.value.find((r) => r.nodeId === NODE_REMOTE)!
    expect(row.paired).toBe(true)
    expect(row.wanAvailable).toBe(true)
    expect(row.deviceName).toBe('书房 NAS')

    // 重复添加（新 LAN 地址）：合并去重，不新增行
    expect(
      peers.addRemotePeer({
        nodeId: NODE_REMOTE,
        addrs: ['/ip4/10.0.0.9/tcp/47613', LAN],
        ticket: null,
        deviceName: '',
      }),
    ).toBe(false)
    expect(peers.devices.value).toHaveLength(1)
    expect(peers.devices.value[0]!.addrs).toEqual([LAN, RELAY, '/ip4/10.0.0.9/tcp/47613'])
    // 空展示名不得覆盖已配对名
    row = peers.rows.value[0]!
    expect(row.deviceName).toBe('书房 NAS')
  })

  it('connect 带多地址；手动尝试外网才带 wan:true', async () => {
    const { peers, calls, flush } = setup()
    peers.addRemotePeer({
      nodeId: NODE_REMOTE,
      addrs: [LAN, RELAY],
      ticket: null,
      deviceName: '',
    })

    await peers.connect(NODE_REMOTE)
    const first = calls.find((c) => c.id === 'file-transfer.dial-peer')!
    expect(first.args.endpoint).toEqual({
      nodeId: NODE_REMOTE,
      addr: '',
      port: 0,
      addrs: [LAN, RELAY],
    })
    expect(first.args.wan).toBeUndefined()

    // 断开后手动「尝试外网」：显式 wan 标记，核内据此纳入 relay 候选
    await peers.disconnect(NODE_REMOTE)
    await flush()
    await peers.connect(NODE_REMOTE, { wan: true })
    const second = calls.filter((c) => c.id === 'file-transfer.dial-peer')[1]!
    expect(second.args.wan).toBe(true)
  })

  it('宿主 transport 进入设备行，断开后清除', async () => {
    const { peers, emit, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN], ticket: null, deviceName: '' })
    emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE_REMOTE,
      connected: true,
      transport: 'wan-relay',
    })
    expect(peers.rows.value[0]!.transport).toBe('wan-relay')
    emit('plugin:file-transfer:connection-changed', { nodeId: NODE_REMOTE, connected: false })
    expect(peers.rows.value[0]!.transport).toBeNull()
    // 未知 transport 值不猜（不写进状态）
    emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE_REMOTE,
      connected: true,
      transport: 'quic-direct',
    })
    expect(peers.rows.value[0]!.transport).toBeNull()
  })

  it('配对条目落盘带 addrs/paired；移除后清空配对标记', async () => {
    vi.useFakeTimers()
    try {
      const { peers, calls } = setup()
      peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN], ticket: null, deviceName: 'X' })
      await vi.advanceTimersByTimeAsync(2100)
      const saved = calls.filter((c) => c.id === 'file-transfer.save-device-snapshot').pop()!
      expect(saved.args.devices[0].addrs).toEqual([LAN])
      expect(saved.args.devices[0].paired).toBe(true)

      peers.removeRemotePeer(NODE_REMOTE)
      expect(peers.devices.value.some((d) => d.nodeId === NODE_REMOTE)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('快照恢复拨号防线（T12 例外）', () => {
  it('手动添加的远程设备可直接拨号；发现条目仍拒绝', async () => {
    const h = makeContext()
    const snapshot = {
      devices: [
        {
          nodeId: NODE_REMOTE,
          deviceName: '远程',
          addr: '',
          port: 0,
          addrs: [RELAY],
          paired: true,
          lastSeenMs: Date.now(),
        },
        {
          nodeId: NODE_MDNS,
          deviceName: '手机',
          addr: '192.168.1.108',
          port: 47821,
          lastSeenMs: Date.now(),
        },
      ],
    }
    h.onCommand('file-transfer.get-device-snapshot', () => snapshot)
    h.onCommand('file-transfer.save-device-snapshot', () => ({ ok: true }))
    h.onCommand('file-transfer.refresh-devices', () => ({ ok: true }))
    h.onCommand('file-transfer.dial-peer', () => ({ status: 'connected' }))
    h.onCommand('file-transfer.set-active-peer', () => ({ ok: true }))
    const peers = usePeerDevices(h.context)
    peers.start()
    await h.flush()

    const remote = await peers.connect(NODE_REMOTE)
    expect(remote).toBe('connected')
    // 发现条目被 restored 防线拦下（不触发拨号，改为请求宿主重查）
    expect(await peers.connect(NODE_MDNS)).toBe('unreachable')
    expect(h.calls.filter((c) => c.id === 'file-transfer.dial-peer')).toHaveLength(1)
  })
})
