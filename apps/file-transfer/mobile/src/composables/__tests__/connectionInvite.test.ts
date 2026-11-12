/**
 * 跨网邀请编排（T23，移动端）— 与桌面同判据
 *
 * 移动端没有配置中心：导入直接用缓存地址（`relayOrigin = invite`）。
 * 本用例锁住生成 / 轮换 / 导入载荷与失败语义，避免两端邀请行为漂移。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { createRelayRoom, useConnectionInvite } from '../useConnectionInvite'
import { parseConnectionInvite } from '../../utils/pairingLink'

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

function parseOk(text: string) {
  const parsed = parseConnectionInvite(text)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('invite did not parse')
  return parsed.invite
}

describe('useConnectionInvite（移动端）', () => {
  it('should_generateInviteAndSaveMissingRoom', async () => {
    let room = ''
    const { context, calls } = makeContext((command, args) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [RELAY_A], relayRoom: room, relaySource: 'cache', deviceName: '手机' }
      }
      if (command === 'file-transfer.set-settings') {
        room = String((args as Record<string, unknown>)?.relayRoom ?? '')
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)

    const text = await api.generate()
    const invite = parseOk(text)
    expect(invite.room).toMatch(/^nest-[0-9a-f]{8}$/)
    expect(invite.room).toBe(room)
    expect(invite.name).toBe('手机')
    expect(calls.some((c) => c.id === 'file-transfer.set-settings')).toBe(true)
  })

  it('should_failVisibleWhenNoRelay', async () => {
    const { context } = makeContext(() => ({
      relayAddrs: [],
      relayRoom: '',
      relaySource: 'cache',
    }))
    const api = useConnectionInvite(context)

    expect(await api.generate()).toBe('')
    expect(api.error.value).toBe('relay-missing')
  })

  it('should_applyInviteWithInviteOrigin', async () => {
    const { context, calls } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [], relayRoom: '', relaySource: 'cache' }
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)
    await api.loadCurrent()

    expect(await api.apply({ room: 'nest-abc', relay: [RELAY_A, RELAY_B], name: '' })).toBe(true)
    expect(calls.find((c) => c.id === 'file-transfer.set-settings')?.args).toEqual({
      relayAddrs: [RELAY_A, RELAY_B],
      relayRoom: 'nest-abc',
      relayOrigin: 'invite',
    })
  })

  it('should_rotateRoomAndInvalidateOldInvite', async () => {
    let room = 'home_1'
    const { context } = makeContext((command, args) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [RELAY_A], relayRoom: room, relaySource: 'cache' }
      }
      if (command === 'file-transfer.set-settings') {
        room = String((args as Record<string, unknown>)?.relayRoom ?? '')
      }
      return { ok: true }
    })
    const api = useConnectionInvite(context)

    const first = await api.generate()
    const rotated = await api.rotateRoom()
    expect(rotated).toMatch(/^nest-[0-9a-f]{8}$/)
    expect(room).toBe(rotated)
    expect(parseOk(api.invite.value).room).toBe(rotated)
    expect(api.invite.value).not.toBe(first)
  })

  it('should_reportSaveFailureWithoutInvite', async () => {
    const { context } = makeContext((command) => {
      if (command === 'file-transfer.get-my-device') {
        return { relayAddrs: [], relayRoom: '', relaySource: 'cache' }
      }
      throw new Error('invalid relay')
    })
    const api = useConnectionInvite(context)
    await api.loadCurrent()

    expect(await api.apply({ room: 'nest-abc', relay: [RELAY_A], name: '' })).toBe(false)
    expect(api.error.value).toBe('save-failed')
  })

  it('should_createRoomInExpectedShape', () => {
    expect(createRelayRoom()).toMatch(/^nest-[0-9a-f]{8}$/)
  })
})
