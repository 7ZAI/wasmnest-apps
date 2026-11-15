/**
 * 设备二维码（v3）与穿透配置分享（v1）契约测试
 *
 * 设备配对只保留「桌面生成二维码 → 手机扫码导入」；粘贴连接串与邀请已退役。
 */
import { describe, it, expect } from 'vitest'
import {
  PAIR_URI_PREFIX,
  RELAY_CONFIG_URI_PREFIX,
  buildRelayConfigShare,
  buildRemotePeerLink,
  isRelayConfigShare,
  parseRelayConfigShare,
} from '../utils/pairingLink'

const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

/** UTF-8 → base64url（夹具用；生成端实现见模块） */
function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('设备二维码（v3）', () => {
  const NODE_ID = 'a'.repeat(64)
  const LAN = '/ip4/192.168.1.5/tcp/47613'

  it('should_buildPairPayloadWithNodeIdAddrsAndName', () => {
    const text = buildRemotePeerLink({
      nodeId: NODE_ID.toUpperCase(),
      addrs: [LAN, RELAY, LAN],
      deviceName: '客厅 NAS',
    })
    expect(text.startsWith(PAIR_URI_PREFIX)).toBe(true)
    const raw = text.slice(PAIR_URI_PREFIX.length)
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4)
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))))
    expect(payload).toEqual({
      v: 3,
      nodeId: NODE_ID,
      addrs: [LAN, RELAY],
      deviceName: '客厅 NAS',
    })
  })

  it('should_rejectInvalidInputInsteadOfBuildingBrokenQr', () => {
    expect(() => buildRemotePeerLink({ nodeId: 'abc', addrs: [LAN] })).toThrow(/invalid nodeId/)
    expect(() => buildRemotePeerLink({ nodeId: NODE_ID, addrs: [] })).toThrow(
      /at least one address/,
    )
  })
})

describe('RelayConfigShare（ft-relay-config v1）', () => {
  const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

  it('should_roundTripRelayRoomAndPolicy', () => {
    const text = buildRelayConfigShare({
      relayAddrs: [RELAY_ENDPOINT, RELAY_ENDPOINT],
      room: 'nest-7f3a2c91',
      wanPolicy: 'allowed',
      deviceName: '客厅 NAS',
      generatedAt: 1_734_000_000_000,
    })
    expect(text.startsWith(RELAY_CONFIG_URI_PREFIX)).toBe(true)
    expect(isRelayConfigShare(text)).toBe(true)
    expect(parseRelayConfigShare(text)).toEqual({
      ok: true,
      share: {
        relayAddrs: [RELAY_ENDPOINT],
        room: 'nest-7f3a2c91',
        wanPolicy: 'allowed',
        deviceName: '客厅 NAS',
        generatedAt: 1_734_000_000_000,
      },
    })
  })

  it('should_omitEmptyRoomAndDefaultWanPolicy', () => {
    const text = buildRelayConfigShare({ relayAddrs: [RELAY_ENDPOINT] })
    const r = parseRelayConfigShare(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.share.room).toBe('')
    expect(r.share.wanPolicy).toBe('allowed')
    expect(r.share.generatedAt).toBeGreaterThan(0)
  })

  it('should_rejectUnknownVersionKindAndMissingRelayWithDistinctReasons', () => {
    const b64 = (payload: unknown): string =>
      `${RELAY_CONFIG_URI_PREFIX}${toBase64Url(JSON.stringify(payload))}`
    expect(
      parseRelayConfigShare(b64({ v: 2, kind: 'ft-relay-config', relayAddrs: [RELAY_ENDPOINT] })),
    ).toEqual({ ok: false, reason: 'version-unsupported' })
    expect(
      parseRelayConfigShare(b64({ v: 1, kind: 'other', relayAddrs: [RELAY_ENDPOINT] })),
    ).toEqual({ ok: false, reason: 'malformed' })
    expect(parseRelayConfigShare(b64({ v: 1, kind: 'ft-relay-config', relayAddrs: [] }))).toEqual({
      ok: false,
      reason: 'missing-relay',
    })
  })

  it('should_rejectCircuitAddressAndBadPolicy', () => {
    const b64 = (payload: unknown): string =>
      `${RELAY_CONFIG_URI_PREFIX}${toBase64Url(JSON.stringify(payload))}`
    expect(
      parseRelayConfigShare(
        b64({ v: 1, kind: 'ft-relay-config', relayAddrs: [RELAY], wanPolicy: 'allowed' }),
      ),
    ).toEqual({ ok: false, reason: 'address-invalid' })
    expect(
      parseRelayConfigShare(
        b64({
          v: 1,
          kind: 'ft-relay-config',
          relayAddrs: [RELAY_ENDPOINT],
          wanPolicy: 'maybe',
        }),
      ),
    ).toEqual({ ok: false, reason: 'malformed' })
  })

  it('should_notBeConfusedWithOtherPayloadsAndRejectBadBuildInput', () => {
    expect(isRelayConfigShare('wasmnest://join/abc')).toBe(false)
    expect(isRelayConfigShare('wasmnest://pair/abc')).toBe(false)
    expect(() => buildRelayConfigShare({ relayAddrs: [] })).toThrow(/at least one relay/)
    expect(() => buildRelayConfigShare({ relayAddrs: [RELAY] })).toThrow(/invalid relay address/)
  })
})
