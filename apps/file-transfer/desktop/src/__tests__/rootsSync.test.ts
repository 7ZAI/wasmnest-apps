/**
 * 共享根清单可见性（桌面端回归锁）
 *
 * 与移动端 `rootsSync.test.ts` 同判据（双端各一份是既有口径）：
 * ① 拉取就绪键：未连接 / 无可用地址时不得发起拉取（后端无重试，失败即永久空表）；
 * ② 拉取带显式 peerId：不再只看 `peer.id`（重连时 id 不变会漏掉重拉）；
 * ③ 被连侧先收到连接、后收到发现时，先落身份条目，发现到达后补写 endpoint memo。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { rootsReadyKey, useRemoteFs } from '../composables/useRemoteFs'
import { usePeerDevices } from '../composables/usePeerDevices'

const NODE = 'd'.repeat(64)

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

    h.emit('plugin:file-transfer:connection-changed', {
      nodeId: NODE,
      connected: true,
      deviceName: 'Desktop B',
    })
    await h.flush()
    const row = h.peers.rows.value.find((r) => r.nodeId === NODE)
    expect(row, '连接事件必须补进设备行').toBeDefined()
    expect(row!.status).toBe('connected')
    expect(h.calls.filter((c) => c.id === 'file-transfer.remember-peer-endpoint')).toHaveLength(0)

    h.emit('plugin:file-transfer:mdns-found', {
      instanceName: '_wasmnest._tcp.DesktopB',
      addresses: ['192.168.1.20'],
      port: 47614,
      txtRecords: { id: NODE, name: 'Desktop B' },
    })
    await h.flush()

    const memos = h.calls.filter((c) => c.id === 'file-transfer.remember-peer-endpoint')
    expect(memos).toHaveLength(1)
    expect(memos[0]!.args.endpoint).toMatchObject({
      nodeId: NODE,
      addr: '192.168.1.20',
      port: 47614,
    })
    expect(h.peers.rows.value[0]!.connectionModes).not.toBe('none')
    h.peers.stop()
  })
})
