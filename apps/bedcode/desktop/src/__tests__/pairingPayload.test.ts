/**
 * 配对载荷组装 行为契约测试（T08：QR v2）
 *
 * 被测：`src/utils/pairingPayload.ts::buildQrPayload`。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | T08-1 | v1 兼容 | 无 peer（缺省 / null） | 输出与旧实现逐字一致 `{host,port,token}` |
 * | T08-2 | v2 组装 | peer 完整 | `{v:2, host, port, token, peer}`，字段顺序稳定 |
 * | T08-3 | 归一 | nodeId / ticket 去空白；addrs 去重保序（LAN 在前不被重排） | 归一后的 peer |
 * | T08-4 | 显性失败 | peer 存在但缺 nodeId / ticket / addrs | 抛 `peer-incomplete`，禁止静默退回 v1 |
 * | T08-5 | 地址判据 | 不以 `/` 开头 / 含空白 / 未指定地址 / 缺 `/p2p/` | 抛 `peer-address-invalid` |
 * | T08-6 | 连接串 | `wasmnest://pair/<base64url(json)>` 与 QR 同载荷同校验；url-safe 无 padding | 解码即 QR 载荷 |
 */
import { describe, it, expect } from 'vitest'
import {
  buildPairUri,
  buildQrPayload,
  PAIR_URI_PREFIX,
  PairingPayloadError,
  type PairingPayloadErrorReason,
  type PairingPeerInfo,
} from '../utils/pairingPayload'

const base = { host: '192.168.1.5', port: 8765, token: 'token-1' }

const peer: PairingPeerInfo = {
  nodeId: '12D3KooWTarget',
  addrs: [
    '/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget',
    '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget',
  ],
  ticket: 'ticket-once',
}

/** 断言抛出指定 reason 的 PairingPayloadError */
function expectReason(fn: () => unknown, reason: PairingPayloadErrorReason) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(PairingPayloadError)
    expect((e as PairingPayloadError).reason).toBe(reason)
    return
  }
  throw new Error(`expected PairingPayloadError(${reason}), but no error was thrown`)
}

describe('T08-1 v1 兼容（无 peer）', () => {
  it('should_emitLegacyShape_when_peerAbsent', () => {
    expect(buildQrPayload(base)).toBe(JSON.stringify(base))
  })

  it('should_emitLegacyShape_when_peerNull', () => {
    expect(buildQrPayload({ ...base, peer: null })).toBe(JSON.stringify(base))
  })

  it('should_notEmitVersionField_when_peerAbsent', () => {
    // 旧移动端只认三字段：多一个 v 字段虽可忽略，但没必要改变既有线上形状
    expect(Object.keys(JSON.parse(buildQrPayload(base)))).toEqual(['host', 'port', 'token'])
  })
})

describe('T08-2/T08-3 v2 组装与归一', () => {
  it('should_emitV2WithPeer_when_peerComplete', () => {
    expect(JSON.parse(buildQrPayload({ ...base, peer }))).toEqual({ v: 2, ...base, peer })
  })

  it('should_trimAndDedupeAddrsKeepingOrder_when_peerHasNoise', () => {
    const payload = JSON.parse(
      buildQrPayload({
        ...base,
        peer: {
          nodeId: ' 12D3KooWTarget ',
          ticket: ' ticket-once ',
          addrs: [peer.addrs[0], peer.addrs[0], peer.addrs[1]],
        },
      }),
    )
    expect(payload.peer).toEqual({
      nodeId: '12D3KooWTarget',
      ticket: 'ticket-once',
      addrs: [peer.addrs[0], peer.addrs[1]],
    })
  })
})

describe('T08-4 peer 残缺 → 显性失败', () => {
  const cases: Array<{ label: string; value: Partial<PairingPeerInfo> }> = [
    { label: '缺 nodeId', value: { nodeId: '', addrs: peer.addrs, ticket: 't' } },
    { label: '缺 ticket', value: { nodeId: peer.nodeId, addrs: peer.addrs, ticket: '' } },
    { label: '缺 addrs', value: { nodeId: peer.nodeId, addrs: [], ticket: 't' } },
  ]

  for (const c of cases) {
    it(`should_throwPeerIncomplete_when_${c.label}`, () => {
      expectReason(
        () => buildQrPayload({ ...base, peer: c.value as PairingPeerInfo }),
        'peer-incomplete',
      )
    })
  }
})

describe('T08-5 地址不可拨号 → 显性失败', () => {
  const badAddrs: Array<{ label: string; addr: string }> = [
    { label: '空串', addr: '' },
    { label: '不以 / 开头', addr: 'ip4/1.2.3.4/tcp/1/p2p/x' },
    { label: '含空白', addr: '/ip4/1.2.3.4/tcp/1/p2p/x y' },
    { label: '未指定地址', addr: '/ip4/0.0.0.0/tcp/1/p2p/x' },
    { label: '缺 /p2p/ 目标', addr: '/ip4/1.2.3.4/tcp/1' },
  ]

  for (const c of badAddrs) {
    it(`should_throwPeerAddressInvalid_when_${c.label}`, () => {
      expectReason(
        () => buildQrPayload({ ...base, peer: { ...peer, addrs: [c.addr] } }),
        'peer-address-invalid',
      )
    })
  }
})

describe('T08-6 连接串（wasmnest://pair/…）', () => {
  /** 解回 JSON 文本（测试侧自带解码器，与移动端 `qr.ts` 解析同口径） */
  function decodePairUri(uri: string): string {
    expect(uri.startsWith(PAIR_URI_PREFIX)).toBe(true)
    const base64 = uri.slice(PAIR_URI_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))
  }

  it('should_wrapLegacyPayload_when_peerAbsent', () => {
    expect(decodePairUri(buildPairUri(base))).toBe(JSON.stringify(base))
  })

  it('should_wrapV2Payload_when_peerComplete', () => {
    expect(JSON.parse(decodePairUri(buildPairUri({ ...base, peer })))).toEqual({
      v: 2,
      ...base,
      peer,
    })
  })

  it('should_emitUrlSafeWithoutPadding_when_encoded', () => {
    // 可直接粘贴进输入框 / URL 查询串：无 `+` `/` `=`
    const body = buildPairUri({ ...base, peer }).slice(PAIR_URI_PREFIX.length)
    expect(body).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(body).not.toContain('=')
  })

  it('should_throwSameReasonAsQrPayload_when_peerIncomplete', () => {
    expectReason(() => buildPairUri({ ...base, peer: { ...peer, addrs: [] } }), 'peer-incomplete')
  })
})
