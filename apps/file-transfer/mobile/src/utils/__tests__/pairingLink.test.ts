/**
 * 设备二维码（v3）与穿透配置分享（v1）契约测试（移动端）
 *
 * 设备配对只保留「我的设备二维码 → 手机扫码导入」；粘贴连接串与邀请已退役。
 */
import { describe, it, expect } from 'vitest'
import {
  PAIR_URI_PREFIX,
  RELAY_CONFIG_URI_PREFIX,
  buildRelayConfigShare,
  buildRemotePeerLink,
  isRelayConfigShare,
  parseRelayConfigShare,
  parseRemotePeerLink,
} from '../pairingLink'

const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

/** UTF-8 → base64url（夹具用；生成端实现见模块） */
function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('设备二维码（v3）', () => {
  const NODE_ID = 'b'.repeat(64)
  const LAN = '/ip4/192.168.1.7/tcp/47613'

  it('should_roundTripNodeIdAddrsAndName', () => {
    const text = buildRemotePeerLink({
      nodeId: NODE_ID.toUpperCase(),
      addrs: [LAN, RELAY, LAN],
      deviceName: '手机',
    })
    expect(text.startsWith(PAIR_URI_PREFIX)).toBe(true)
    const r = parseRemotePeerLink(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.nodeId).toBe(NODE_ID)
    expect(r.link.addrs).toEqual([LAN, RELAY])
    expect(r.link.deviceName).toBe('手机')
  })

  it('should_rejectInvalidInputInsteadOfBuildingBrokenLink', () => {
    expect(() => buildRemotePeerLink({ nodeId: 'abc', addrs: [LAN] })).toThrow(/invalid nodeId/)
    expect(() => buildRemotePeerLink({ nodeId: NODE_ID, addrs: [] })).toThrow(
      /at least one address/,
    )
  })

  it('should_rejectUnknownPayloadVersion', () => {
    const b64 = toBase64Url(JSON.stringify({ v: 4, nodeId: NODE_ID, addrs: [LAN] }))
    expect(parseRemotePeerLink(`${PAIR_URI_PREFIX}${b64}`)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('RelayConfigShare（ft-relay-config v1）', () => {
  const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

  it('should_roundTripRelayRoomAndPolicy', () => {
    const text = buildRelayConfigShare({
      relayAddrs: [RELAY_ENDPOINT],
      room: 'nest-7f3a2c91',
      wanPolicy: 'blocked',
      deviceName: '手机',
      generatedAt: 1_734_000_000_000,
    })
    expect(text.startsWith(RELAY_CONFIG_URI_PREFIX)).toBe(true)
    expect(isRelayConfigShare(text)).toBe(true)
    expect(parseRelayConfigShare(text)).toEqual({
      ok: true,
      share: {
        relayAddrs: [RELAY_ENDPOINT],
        room: 'nest-7f3a2c91',
        wanPolicy: 'blocked',
        deviceName: '手机',
        generatedAt: 1_734_000_000_000,
      },
    })
  })

  it('should_rejectBadPayloadWithDistinctReasons', () => {
    const b64 = (payload: unknown): string =>
      `${RELAY_CONFIG_URI_PREFIX}${toBase64Url(JSON.stringify(payload))}`
    expect(
      parseRelayConfigShare(b64({ v: 2, kind: 'ft-relay-config', relayAddrs: [RELAY_ENDPOINT] })),
    ).toEqual({
      ok: false,
      reason: 'version-unsupported',
    })
    expect(parseRelayConfigShare(b64({ v: 1, kind: 'ft-relay-config', relayAddrs: [] }))).toEqual({
      ok: false,
      reason: 'missing-relay',
    })
    expect(
      parseRelayConfigShare(
        b64({ v: 1, kind: 'ft-relay-config', relayAddrs: [RELAY], wanPolicy: 'allowed' }),
      ),
    ).toEqual({ ok: false, reason: 'address-invalid' })
  })

  it('should_notBeConfusedWithOtherPayloadsAndRejectBadBuildInput', () => {
    expect(isRelayConfigShare('wasmnest://pair/abc')).toBe(false)
    expect(isRelayConfigShare('wasmnest://join/abc')).toBe(false)
    expect(() => buildRelayConfigShare({ relayAddrs: [] })).toThrow(/at least one relay/)
    expect(() => buildRelayConfigShare({ relayAddrs: [RELAY] })).toThrow(/invalid relay address/)
  })
})
