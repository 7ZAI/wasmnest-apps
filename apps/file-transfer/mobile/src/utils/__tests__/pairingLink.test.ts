/**
 * 连接串生成 / 解析（T21）— 移动端同判据
 *
 * 与桌面端 `src/utils/pairingLink.ts` 各持一份实现；本用例锁住 v3 往返与
 * 非法入参显性失败，避免两端在「我的设备」/「添加远程设备」之间漂移。
 */
import { describe, it, expect } from 'vitest'
import {
  JOIN_URI_PREFIX,
  buildConnectionInvite,
  buildRemotePeerLink,
  isConnectionInvite,
  parseConnectionInvite,
  parseRemotePeerLink,
  relayCandidatesOf,
} from '../pairingLink'

const NODE_ID = 'b'.repeat(64)
const LAN = '/ip4/192.168.1.7/tcp/47613'
const RELAY = `/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/${NODE_ID}`

describe('buildRemotePeerLink（v3）', () => {
  it('should_roundTripNodeIdAddrsAndName', () => {
    const text = buildRemotePeerLink({
      nodeId: NODE_ID.toUpperCase(),
      addrs: [LAN, RELAY, LAN],
      deviceName: '手机',
    })
    expect(text.startsWith('wasmnest://pair/')).toBe(true)
    const r = parseRemotePeerLink(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.nodeId).toBe(NODE_ID)
    expect(r.link.addrs).toEqual([LAN, RELAY])
    expect(r.link.deviceName).toBe('手机')
    expect(relayCandidatesOf(r.link.addrs)).toEqual([RELAY])
  })

  it('should_rejectInvalidInputInsteadOfBuildingBrokenLink', () => {
    expect(() => buildRemotePeerLink({ nodeId: 'abc', addrs: [LAN] })).toThrow(/invalid nodeId/)
    expect(() => buildRemotePeerLink({ nodeId: NODE_ID, addrs: [] })).toThrow(
      /at least one address/,
    )
  })

  it('should_rejectUnknownPayloadVersion', () => {
    const b64 = btoa(JSON.stringify({ v: 4, nodeId: NODE_ID, addrs: [LAN] }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(parseRemotePeerLink(`wasmnest://pair/${b64}`)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('ConnectionInvite（v4，T23）', () => {
  const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

  it('should_roundTripRoomRelayAndName', () => {
    const text = buildConnectionInvite({
      room: 'nest-7f3a2c91',
      relay: [RELAY_ENDPOINT, RELAY_ENDPOINT],
      name: '手机',
    })
    expect(text.startsWith(JOIN_URI_PREFIX)).toBe(true)
    expect(parseConnectionInvite(text)).toEqual({
      ok: true,
      invite: { room: 'nest-7f3a2c91', relay: [RELAY_ENDPOINT], name: '手机' },
    })
  })

  it('should_rejectBadInviteWithDistinctReasons', () => {
    expect(parseConnectionInvite('wasmnest://join/%%%')).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(
      parseConnectionInvite(
        `${JOIN_URI_PREFIX}${btoa(JSON.stringify({ v: 4, relay: [RELAY_ENDPOINT] }))}`,
      ),
    ).toEqual({ ok: false, reason: 'missing-room' })
    expect(
      parseConnectionInvite(
        `${JOIN_URI_PREFIX}${btoa(JSON.stringify({ v: 4, room: 'nest', relay: [] }))}`,
      ),
    ).toEqual({ ok: false, reason: 'address-invalid' })
  })

  it('should_splitInviteFromDeviceLinkByPrefix', () => {
    expect(
      isConnectionInvite(
        buildConnectionInvite({ room: 'nest', relay: [RELAY_ENDPOINT], name: '' }),
      ),
    ).toBe(true)
    expect(isConnectionInvite(buildRemotePeerLink({ nodeId: NODE_ID, addrs: [LAN] }))).toBe(false)
  })
})
