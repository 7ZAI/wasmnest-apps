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
    expect(await peers.connect(NODE_MDNS)).toBe('lan-unreachable')
    expect(h.calls.filter((c) => c.id === 'file-transfer.dial-peer')).toHaveLength(1)
  })
})

describe('配对设备重启恢复与连接盖章（T12）', () => {
  it('配对条目即使 lastSeen 过期也恢复；发现条目仍按 TTL 丢弃', async () => {
    const h = makeContext()
    const stale = Date.now() - 9 * 24 * 60 * 60 * 1000
    h.onCommand('file-transfer.get-device-snapshot', () => ({
      devices: [
        {
          nodeId: NODE_REMOTE,
          deviceName: '远程 NAS',
          addr: '',
          port: 0,
          addrs: [RELAY],
          paired: true,
          lastSeenMs: stale,
        },
        {
          nodeId: NODE_MDNS,
          deviceName: '旧手机',
          addr: '192.168.1.9',
          port: 47821,
          lastSeenMs: stale,
        },
      ],
    }))
    h.onCommand('file-transfer.save-device-snapshot', () => ({ ok: true }))
    h.onCommand('file-transfer.refresh-devices', () => ({ ok: true }))
    const peers = usePeerDevices(h.context)
    peers.start()
    await h.flush()

    expect(peers.devices.value.map((d) => d.nodeId)).toEqual([NODE_REMOTE])
    expect(peers.devices.value[0]!.paired).toBe(true)
  })

  it('连接事件刷新最近可见时刻与宿主设备名（远程设备无 mDNS 心跳）', async () => {
    vi.useFakeTimers()
    try {
      const { peers, emit, calls } = setup()
      peers.start()
      await vi.advanceTimersByTimeAsync(0)
      peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN], ticket: null, deviceName: '' })
      const before = peers.devices.value[0]!.lastSeenMs
      await vi.advanceTimersByTimeAsync(10)
      emit('plugin:file-transfer:connection-changed', {
        nodeId: NODE_REMOTE,
        connected: true,
        deviceName: '书房 NAS',
        transport: 'lan-direct',
      })
      const device = peers.devices.value[0]!
      expect(device.deviceName).toBe('书房 NAS')
      expect(device.lastSeenMs).toBeGreaterThan(before ?? 0)
      await vi.advanceTimersByTimeAsync(2100)
      const saved = calls.filter((c) => c.id === 'file-transfer.save-device-snapshot').pop()!
      expect(saved.args.devices[0].deviceName).toBe('书房 NAS')
      expect(saved.args.devices[0].lastSeenMs).toBe(device.lastSeenMs)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ==================== T20：上次传输形态 / 仅经中继 / 分类失败 ====================

describe('T20 · 上次传输形态驱动重连 + 仅经中继', () => {
  it('上次经中继 ⇒ 默认带 wan:true（LAN 仍先试）；显式 relayOnly 带 relayOnly:true', async () => {
    const { peers, calls, emit, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN, RELAY], ticket: null, deviceName: '' })

    // 宿主上报「本次经中继」→ 写进设备缓存（lastTransport）
    emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE_REMOTE,
      connected: true,
      transport: 'wan-relay',
    })
    expect(peers.rows.value[0]!.lastTransport).toBe('wan-relay')
    emit('plugin:file-transfer:connection-changed', { nodeId: NODE_REMOTE, connected: false })
    await flush()
    // 断开后保留
    expect(peers.rows.value[0]!.lastTransport).toBe('wan-relay')

    // 重连：默认纳入 relay（不必再点「尝试外网」）
    await peers.connect(NODE_REMOTE)
    let dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.wan).toBe(true)
    expect(dial.args.relayOnly).toBeUndefined()

    // 显式「仅经中继」：跳过 LAN 候选（已连接时不会重拨，先断开）
    await peers.disconnect(NODE_REMOTE)
    await flush()
    await peers.connect(NODE_REMOTE, { relayOnly: true })
    dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.relayOnly).toBe(true)
    expect(dial.args.wan).toBe(true)
  })

  it('上次内网直连 ⇒ 默认不带 wan（不自动烧中继）', async () => {
    const { peers, calls, emit, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN, RELAY], ticket: null, deviceName: '' })
    emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE_REMOTE,
      connected: true,
      transport: 'lan-direct',
    })
    emit('plugin:file-transfer:connection-changed', { nodeId: NODE_REMOTE, connected: false })
    await flush()

    await peers.connect(NODE_REMOTE)
    const dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.wan).toBeUndefined()
  })

  it('分类失败经成功载荷返回：行内给对应出路，且不进入已连接态', async () => {
    const { peers, onCommand, emit, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [LAN, RELAY], ticket: null, deviceName: '' })
    onCommand('file-transfer.dial-peer', () => ({
      status: 'lan-unreachable',
      detail: 'dial addrs failed: peer unreachable',
    }))

    expect(await peers.connect(NODE_REMOTE)).toBe('lan-unreachable')
    expect(peers.connectedIds.value.has(NODE_REMOTE)).toBe(false)
    const row = peers.rows.value[0]!
    // detail 保留宿主原文（只进控制台 / 诊断；UI 对已分类失败只用分类文案）
    expect(row.dialError).toEqual({
      code: 'lan-unreachable',
      detail: 'dial addrs failed: peer unreachable',
    })
    expect(row.relayOnlyRecommended).toBe(true)

    // 成功即清除旧失败态
    onCommand('file-transfer.dial-peer', () => ({ status: 'connected' }))
    expect(await peers.connect(NODE_REMOTE, { relayOnly: true })).toBe('connected')
    expect(peers.rows.value[0]!.dialError).toBeNull()
    // 未收到 connection-changed 时不伪造 transport / lastTransport
    expect(peers.rows.value[0]!.transport).toBeNull()
    expect(peers.rows.value[0]!.lastTransport).toBeNull()
    emit('plugin:file-transfer:connection-changed', { nodeId: NODE_REMOTE, connected: false })
  })

  it('未知失败（信封无分类）不猜成因：dialError.code = unknown 且原文只作 detail', async () => {
    const { peers, onCommand, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [RELAY], ticket: null, deviceName: '' })
    onCommand('file-transfer.dial-peer', () => {
      throw new Error('host error -1: peer_dial_addrs: invalid multiaddr')
    })

    expect(await peers.connect(NODE_REMOTE)).toBe('unknown')
    const row = peers.rows.value[0]!
    expect(row.dialError).toEqual({
      code: 'unknown',
      detail: 'host error -1: peer_dial_addrs: invalid multiaddr',
    })
    expect(row.relayOnlyRecommended).toBe(false)
  })

  it('无有效 endpoint：本地即判 no-endpoint，不发命令', async () => {
    const { peers, calls, flush } = setup()
    peers.start()
    await flush()
    peers.addRemotePeer({ nodeId: NODE_REMOTE, addrs: [], ticket: null, deviceName: '' })
    expect(await peers.connect(NODE_REMOTE)).toBe('no-endpoint')
    expect(calls.some((c) => c.id === 'file-transfer.dial-peer')).toBe(false)
    expect(peers.rows.value[0]!.dialError).toEqual({ code: 'no-endpoint' })
  })

  it('快照落盘与恢复带 lastTransport（重启后免再点「尝试外网」）', async () => {
    vi.useFakeTimers()
    try {
      const h = makeContext()
      h.onCommand('file-transfer.get-device-snapshot', () => ({
        devices: [
          {
            nodeId: NODE_REMOTE,
            deviceName: 'Remote',
            addrs: [LAN, RELAY],
            paired: true,
            lastSeenMs: Date.now(),
            lastTransport: 'wan-relay',
          },
          // 词表外的历史值不恢复（不猜）
          { nodeId: 'e'.repeat(64), paired: true, lastSeenMs: Date.now(), lastTransport: 'quic' },
        ],
      }))
      h.onCommand('file-transfer.save-device-snapshot', () => ({ ok: true }))
      h.onCommand('file-transfer.refresh-devices', () => ({ ok: true }))
      const peers = usePeerDevices(h.context)
      peers.start()
      // fake timers 下 h.flush 的 setTimeout(0) 不会自己走：显式推进
      await vi.advanceTimersByTimeAsync(0)

      const restored = peers.devices.value.find((d) => d.nodeId === NODE_REMOTE)!
      expect(restored.lastTransport).toBe('wan-relay')
      expect(
        peers.devices.value.find((d) => d.nodeId === 'e'.repeat(64))!.lastTransport,
      ).toBeUndefined()

      // 落盘回写保持 camelCase 字段
      peers.addRemotePeer({
        nodeId: NODE_REMOTE,
        addrs: [LAN, RELAY],
        ticket: null,
        deviceName: '',
      })
      await vi.advanceTimersByTimeAsync(2100)
      const saved = h.calls.filter((c) => c.id === 'file-transfer.save-device-snapshot').pop()!
      const entry = saved.args.devices.find((d: any) => d.nodeId === NODE_REMOTE)!
      expect(entry.lastTransport).toBe('wan-relay')
    } finally {
      vi.useRealTimers()
    }
  })
})


describe('中继会合发现（composable）', () => {
  const relayEvent = (addrs = [RELAY]) => ({
    devices: [
      {
        nodeId: NODE_REMOTE,
        peerId: '12D3KooWTarget',
        deviceName: 'Phone',
        addrs,
        lastSeenMs: Date.now(),
      },
    ],
  })

  it('快照并入设备行；纯中继设备连接走 relayOnly；空快照移除', async () => {
    const { peers, calls, emit, flush } = setup()
    peers.start()
    await flush()

    emit('plugin:file-transfer:relay-devices', relayEvent())
    await flush()
    const row = peers.rows.value.find((r) => r.nodeId === NODE_REMOTE)!
    expect(row.relay).toBe(true)
    expect(row.wanAvailable).toBe(true)

    expect(await peers.connect(NODE_REMOTE)).toBe('connected')
    const dial = calls.filter((c) => c.id === 'file-transfer.dial-peer').pop()!
    expect(dial.args.relayOnly).toBe(true)
    expect(dial.args.endpoint.addrs).toEqual([RELAY])

    await peers.disconnect(NODE_REMOTE)
    await flush()
    emit('plugin:file-transfer:relay-devices', { devices: [] })
    await flush()
    expect(peers.rows.value.find((r) => r.nodeId === NODE_REMOTE)).toBeUndefined()
  })
})
