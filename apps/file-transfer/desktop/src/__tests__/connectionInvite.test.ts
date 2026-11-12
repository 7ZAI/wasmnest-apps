/**
 * 跨网邀请编排（T23）契约测试
 *
 * 覆盖：
 * ① 生成：已有空间码直接复用；缺失时先落一个 `nest-<8hex>` 再产出；
 * ② relay 为空显性失败，不产出废码；
 * ③ 轮换：写入新码并让旧邀请失效（内容变化）；
 * ④ 导入：set-settings 带 `relayOrigin: "invite"`，保存失败返回 false；
 * ⑤ 中心冲突：中心已配置且与邀请不同才报，顺序不同 / 缓存来源不报。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { createRelayRoom, useConnectionInvite } from '../composables/useConnectionInvite'
import { parseConnectionInvite } from '../utils/pairingLink'

const RELAY_A = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'
const RELAY_B = '/ip4/198.51.100.7/tcp/4001/p2p/12D3KooWOther'

type Responder = (command: string, args?: Record<string, unknown>) => unknown

function makeContext(responder: Responder) {
  const calls: Array<{ id: string; args?: Record<string, unknown> }> = []
  const execute = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push({ id: command, args })
    return responder(command, args)
  })
  const context = { commands: { execute } } as unknown as PluginContext
  return { context, calls }
}

function inviteOf(text: string) {
  const parsed = parseConnectionInvite(text)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('invite did not parse')
  return parsed.invite
}

describe('useConnectionInvite — 生成', () => {
  it('已有空间码直接复用，invite 可往返解析', async () => {
    const { context, calls } = makeContext(() => ({
      relayAddrs: [RELAY_A],
      relayRoom: 'home_1',
      relaySource: 'cache',
      deviceName: '客厅 NAS',
    }))
    const api = useConnectionInvite(context)

    const text = await api.generate()
    expect(text.startsWith('wasmnest://join/')).toBe(true)
    expect(inviteOf(text)).toEqual({
      room: 'home_1',
      relay: [RELAY_A],
      name: '客厅 NAS',
    })
    // 已有码不得再写一次设置
    expect(calls.some((c) => c.id === 'file-transfer.set-settings')).toBe(false)
  })

  it('缺空间码先生成一个并保存，再用它产出邀请', async () => {
    let room = ''
    const { context, calls } = makeContext((command, args) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [RELAY_A], relayRoom: room, relaySource: 'cache', deviceName: 'PC' }
      }
      if (command === 'file-transfer.set-settings') {
        room = String((args as Record<string, unknown>)?.relayRoom ?? '')
        return { ok: true }
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)

    const text = await api.generate()
    const invite = inviteOf(text)
    expect(invite.room).toMatch(/^nest-[0-9a-f]{8}$/)
    expect(invite.room).toBe(room)
    expect(calls.find((c) => c.id === 'file-transfer.set-settings')?.args).toEqual({
      relayRoom: room,
    })
  })

  it('没有 relay 时显性失败，不产出邀请', async () => {
    const { context } = makeContext(() => ({
      relayAddrs: [],
      relayRoom: '',
      relaySource: 'center',
      deviceName: 'PC',
    }))
    const api = useConnectionInvite(context)

    expect(await api.generate()).toBe('')
    expect(api.error.value).toBe('relay-missing')
    expect(api.invite.value).toBe('')
  })
})

describe('useConnectionInvite — 轮换与导入', () => {
  it('轮换空间码写入新值并刷新邀请内容', async () => {
    let room = 'home_1'
    const { context, calls } = makeContext((command, args) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [RELAY_A], relayRoom: room, relaySource: 'cache', deviceName: 'PC' }
      }
      if (command === 'file-transfer.set-settings') {
        room = String((args as Record<string, unknown>)?.relayRoom ?? '')
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)

    const first = await api.generate()
    const rotatedRoom = await api.rotateRoom()

    expect(rotatedRoom).toMatch(/^nest-[0-9a-f]{8}$/)
    expect(rotatedRoom).not.toBe('home_1')
    expect(room).toBe(rotatedRoom)
    expect(inviteOf(api.invite.value).room).toBe(rotatedRoom)
    expect(api.invite.value).not.toBe(first)
    // 轮换只写一次设置（生成时已有码，不写）
    expect(calls.filter((c) => c.id === 'file-transfer.set-settings')).toHaveLength(1)
  })

  it('导入写入 relay + 空间码 + relayOrigin=invite', async () => {
    const { context, calls } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [], relayRoom: '', relaySource: 'cache', deviceName: 'PC' }
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)
    await api.loadCurrent()

    const ok = await api.apply({ room: 'nest-abc', relay: [RELAY_A, RELAY_B], name: '' })
    expect(ok).toBe(true)
    expect(calls.find((c) => c.id === 'file-transfer.set-settings')?.args).toEqual({
      relayAddrs: [RELAY_A, RELAY_B],
      relayRoom: 'nest-abc',
      relayOrigin: 'invite',
    })
  })

  it('保存失败返回 false 并留下 save-failed（弹层不静默关闭）', async () => {
    const { context } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [], relayRoom: '', relaySource: 'cache', deviceName: 'PC' }
      }
      throw new Error('invalid relay')
    })
    const api = useConnectionInvite(context)
    await api.loadCurrent()

    expect(await api.apply({ room: 'nest-abc', relay: [RELAY_A], name: '' })).toBe(false)
    expect(api.error.value).toBe('save-failed')
  })
})

describe('useConnectionInvite — 中心冲突', () => {
  const target = { room: 'nest-abc', relay: [RELAY_A], name: '' }

  it('中心已配置且与邀请不同 → 冲突', async () => {
    const { context } = makeContext(() => ({
      relayAddrs: [RELAY_B],
      relayRoom: '',
      relaySource: 'center',
      deviceName: 'PC',
    }))
    const api = useConnectionInvite(context)
    await api.loadCurrent()
    expect(api.isCenterConflict(target)).toBe(true)
  })

  it('顺序不同不算冲突；缓存来源不算冲突', async () => {
    const { context } = makeContext(() => ({
      relayAddrs: [RELAY_B, RELAY_A],
      relaySource: 'center',
    }))
    const api = useConnectionInvite(context)
    await api.loadCurrent()
    expect(api.isCenterConflict({ ...target, relay: [RELAY_A, RELAY_B] })).toBe(false)

    const cached = useConnectionInvite(
      makeContext(() => ({
        relayAddrs: [RELAY_B],
        relaySource: 'cache',
      })).context,
    )
    await cached.loadCurrent()
    expect(cached.isCenterConflict(target)).toBe(false)
  })
})

describe('createRelayRoom', () => {
  it('形状固定为 nest-<8 位小写 hex>', () => {
    expect(createRelayRoom()).toMatch(/^nest-[0-9a-f]{8}$/)
  })
})
