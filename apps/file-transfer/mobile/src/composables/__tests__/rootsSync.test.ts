/**
 * 共享根清单可见性（移动端回归锁）
 *
 * 首次连接后「一端看不到对方共享目录」有三条断链，这里各钉一条：
 * ① 拉取就绪键：未连接 / 无可用地址时不得发起拉取（后端无重试，失败即永久空表）；
 * ② 拉取必须带显式 peerId：不依赖 `set-active-peer` 与建立连接的到达时序；
 * ③ 被连侧先收到连接、后收到发现时，先落身份条目，发现到达后补写 endpoint memo
 *    （没有 memo 就重拨不出去，浏览/拉取必失败）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { rootsReadyKey, useRemoteFs } from '../useRemoteFs'
import { usePeerDevices } from '../usePeerDevices'

const NODE = 'c'.repeat(64)

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

describe('rootsReadyKey（拉取就绪判据）', () => {
  it('should_requirePeerIdOnlineAndEndpoint', () => {
    expect(rootsReadyKey({ peerId: '', online: true, connectionModes: 'both' })).toBe('')
    expect(rootsReadyKey({ peerId: NODE, online: false, connectionModes: 'both' })).toBe('')
    // 无任何候选地址：入站侧无法重拨，发起只会拿到 no-endpoint
    expect(rootsReadyKey({ peerId: NODE, online: true, connectionModes: 'none' })).toBe('')
    expect(rootsReadyKey({ peerId: NODE, online: true, connectionModes: 'lan' })).toBe(NODE)
    expect(rootsReadyKey({ peerId: NODE, online: true, connectionModes: 'wan' })).toBe(NODE)
    expect(rootsReadyKey({ peerId: NODE, online: true, connectionModes: 'both' })).toBe(NODE)
  })
})

describe('list-remote 寻址（不依赖 ACTIVE_NODE 到达时序）', () => {
  function setup(getPeerId?: () => string) {
    const h = makeContext()
    h.onCommand('file-transfer.list-remote', () => ({ roots: [{ id: 'root-1', name: 'Docs' }] }))
    const fs = useRemoteFs(h.context, getPeerId)
    return { ...h, fs }
  }

  it('should_passExplicitPeerIdOnRoots', async () => {
    const { fs, calls } = setup(() => 'peer-explicit')
    await fs.loadRoots()
    const call = calls.find((c) => c.id === 'file-transfer.list-remote')!
    expect(call.args).toMatchObject({ path: '', dirId: '', peerId: 'peer-explicit' })
  })

  it('should_omitPeerIdWhenUnknown', async () => {
    const { fs, calls } = setup()
    await fs.loadRoots()
    expect(calls).toHaveLength(1)
    expect('peerId' in calls[0]!.args).toBe(false)
  })
})

describe('入站连接的对端寻址登记', () => {
  function setup() {
    const h = makeContext()
    h.onCommand('file-transfer.get-device-snapshot', () => ({ devices: [] }))
    h.onCommand('file-transfer.save-device-snapshot', () => ({ ok: true }))
    h.onCommand('file-transfer.refresh-devices', () => ({ ok: true }))
    h.onCommand('file-transfer.remember-peer-endpoint', () => ({ ok: true }))
    h.onCommand('file-transfer.set-active-peer', () => ({ ok: true }))
    const peers = usePeerDevices(h.context)
    return { ...h, peers }
  }

  it('should_keepUndiscoveredPeerVisibleAndMemoEndpointOnDiscovery', async () => {
    const h = setup()
    h.peers.start()
    await h.flush()

    // 连接先于发现到达：仍要有一行「已连接」（否则活跃对端兜底看不见它）
    h.emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE,
      connected: true,
      deviceName: 'Pixel 9',
    })
    await h.flush()
    const row = h.peers.rows.value.find((r) => r.nodeId === NODE)
    expect(row, '连接事件必须补进设备行').toBeDefined()
    expect(row!.status).toBe('connected')
    // 此刻还没有地址：不得凭空造 memo（空 endpoint 会污染寻址表）
    expect(h.calls.filter((c) => c.id === 'file-transfer.remember-peer-endpoint')).toHaveLength(0)

    // 发现补齐地址：必须补写 memo，供数据面重拨
    h.emit('plugin:file-transfer:mdns-found', {
      instanceName: '_wasmnest._tcp.Pixel',
      addresses: ['192.168.1.9'],
      port: 47613,
      txtRecords: { id: NODE, name: 'Pixel 9' },
    })
    await h.flush()

    const memos = h.calls.filter((c) => c.id === 'file-transfer.remember-peer-endpoint')
    expect(memos).toHaveLength(1)
    expect(memos[0]!.args.endpoint).toMatchObject({
      nodeId: NODE,
      addr: '192.168.1.9',
      port: 47613,
    })
    expect(h.peers.rows.value[0]!.connectionModes).not.toBe('none')
    h.peers.stop()
  })

  it('should_notDuplicateEntryWhenPeerAlreadyDiscovered', async () => {
    const h = setup()
    h.peers.start()
    await h.flush()

    h.emit('plugin:file-transfer:mdns-found', {
      instanceName: '_wasmnest._tcp.Pixel',
      addresses: ['192.168.1.9'],
      port: 47613,
      txtRecords: { id: NODE, name: 'Pixel 9' },
    })
    await h.flush()
    h.emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE,
      connected: true,
      deviceName: 'Pixel 9',
    })
    await h.flush()

    expect(h.peers.rows.value).toHaveLength(1)
    h.peers.stop()
  })
})
