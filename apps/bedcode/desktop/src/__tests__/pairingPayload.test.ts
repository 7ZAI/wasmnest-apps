/**
 * 配对载荷组装 行为契约测试（T08：QR v2 → 2026-11-13 v3 紧凑编码 → 11-14 v2 回落）
 *
 * 被测：`src/utils/pairingPayload.ts::buildQrPayload`。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | T08-1 | v1 兼容 | 无 peer（缺省 / null） | 输出与旧实现逐字一致 `{host,port,token}` |
 * | T08-2 | v3 组装 | peer 完整且地址尾部 id === nodeId | `{v:3,h,p,t,n,a,tk}`，字段顺序稳定 |
 * | T08-3 | 归一 | nodeId / ticket 去空白；完整地址去重保序 | `a` 里是去重后的拨号前缀 |
 * | T08-3b | 前缀折叠 | `addrs` 去尾部 `/p2p/<nodeId>`；与 `h:p` 逐字相同的记 `"@"` | 单 nodeId、无重复 |
 * | T08-4 | 显性失败 | peer 存在但缺 nodeId / ticket / addrs | 抛 `peer-incomplete`，禁止静默退回 v1 |
 * | T08-5 | 地址判据 | 不以 `/` 开头 / 含空白 / 未指定地址 / 缺尾部目标段 / 只有目标段 | 抛 `peer-address-invalid` |
 * | T08-6 | 连接串 | `wasmnest://pair/<base64url(json)>` 与 QR 同载荷同校验；url-safe 无 padding | 解码即 QR 载荷 |
 * | T08-7 | 尺寸回归 | 真实 id / token / 票据下 v3 模块数 | 双地址 69 模块（v2 为 85），仅 LAN 61 |
 * | T08-8 | 双 id 空间 | 地址尾部 PeerId ≠ `peer.nodeId`（真实宿主常态，11-14 现场） | 退回 v2 完整 `peer` 载荷，不出「地址不可拨号」 |
 */
import { describe, it, expect } from 'vitest'
import {
  buildPairUri,
  buildQrPayload,
  PAIR_URI_PREFIX,
  PairingPayloadError,
  SAME_ENDPOINT_PREFIX,
  type PairingPayloadErrorReason,
  type PairingPeerInfo,
} from '../utils/pairingPayload'
import { planQrCanvas, qrMatrix } from '../utils/qrRender'

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

describe('T08-2/T08-3 v3 组装与归一', () => {
  it('should_emitV3WithPrefixes_when_peerComplete', () => {
    expect(JSON.parse(buildQrPayload({ ...base, peer }))).toEqual({
      v: 3,
      h: '192.168.1.5',
      p: 8765,
      t: 'token-1',
      n: '12D3KooWTarget',
      a: [
        '/ip4/192.168.1.5/tcp/47613',
        '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit',
      ],
      tk: 'ticket-once',
    })
  })

  it('should_keepFieldOrderStable_when_building', () => {
    // 字段顺序稳定：同一输入逐字节同形（快照 / 连接串可复现）
    const payload = buildQrPayload({ ...base, peer })
    expect(payload.indexOf('"v"')).toBeLessThan(payload.indexOf('"h"'))
    expect(payload.indexOf('"h"')).toBeLessThan(payload.indexOf('"p"'))
    expect(payload.indexOf('"p"')).toBeLessThan(payload.indexOf('"t"'))
    expect(payload.indexOf('"t"')).toBeLessThan(payload.indexOf('"n"'))
    expect(payload.indexOf('"n"')).toBeLessThan(payload.indexOf('"a"'))
    expect(payload.indexOf('"a"')).toBeLessThan(payload.indexOf('"tk"'))
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
    expect(payload.n).toBe('12D3KooWTarget')
    expect(payload.tk).toBe('ticket-once')
    expect(payload.a).toEqual([
      '/ip4/192.168.1.5/tcp/47613',
      '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit',
    ])
  })

  it('should_collapseToPlaceholder_when_lanAddrEqualsHostPort', () => {
    // 与 h:p 逐字相同的 LAN 地址折叠成 "@"：解析侧按同一字面展开（不做地址类型推测）
    const payload = JSON.parse(
      buildQrPayload({
        ...base,
        peer: {
          nodeId: '12D3KooWTarget',
          addrs: ['/ip4/192.168.1.5/tcp/8765/p2p/12D3KooWTarget'],
          ticket: 'ticket-once',
        },
      }),
    )
    expect(payload.a).toEqual([SAME_ENDPOINT_PREFIX])
  })

  it('should_notCollapse_when_onlyHostMatchesButPortDiffers', () => {
    const payload = JSON.parse(
      buildQrPayload({
        ...base,
        peer: {
          nodeId: '12D3KooWTarget',
          addrs: ['/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTarget'],
          ticket: 'ticket-once',
        },
      }),
    )
    expect(payload.a).toEqual(['/ip4/192.168.1.5/tcp/47613'])
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
    { label: '只有目标段没有传输段', addr: '/p2p/12D3KooWTarget' },
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

describe('T08-8 双 id 空间（真实宿主）→ v2 完整载荷，不再误判「地址不可拨号」', () => {
  // 2026-11-14 宿主实测：node.nodeId 是应用层 sha256 指纹（64 hex），
  // multiaddr 尾部是 libp2p PeerId —— 两者永远不相等，v3 的前缀折叠不成立。
  const APP_NODE_ID = '56bc2e94ca6a1f119d014c6bd491ef2a7a6fc68f9354c4c9e9c1354446d31e94'
  const LIBP2P_ID = '12D3KooWSFCWtAtXSKNhNAr7D6iYPnEJFfUjSrUTFJqopHuD4UDx'
  const RELAY_ID = '12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud'
  const TOKEN = '9c1f'.repeat(8)
  const TICKET = 'f3a1'.repeat(16)
  const realBase = { host: '192.168.1.100', port: 8765, token: TOKEN }
  const lanAddr = `/ip4/192.168.1.100/tcp/47613/p2p/${LIBP2P_ID}`
  const relayAddr = `/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${LIBP2P_ID}`
  const realPeer: PairingPeerInfo = {
    nodeId: APP_NODE_ID,
    addrs: [lanAddr, relayAddr],
    ticket: TICKET,
  }

  it('should_emitFullPeerShape_when_addrTargetDiffersFromNodeId', () => {
    expect(JSON.parse(buildQrPayload({ ...realBase, peer: realPeer }))).toEqual({
      v: 2,
      host: '192.168.1.100',
      port: 8765,
      token: TOKEN,
      peer: { nodeId: APP_NODE_ID, addrs: [lanAddr, relayAddr], ticket: TICKET },
    })
  })

  it('should_notThrow_when_idsDiffer', () => {
    // 现场故障：整批地址被当成「目标段不是本节点」→ 外网 Tab 显示「隧道地址不可拨号」
    expect(() => buildQrPayload({ ...realBase, peer: realPeer })).not.toThrow()
    expect(() => buildPairUri({ ...realBase, peer: realPeer })).not.toThrow()
  })

  it('should_keepAddrsReplayable_when_idsDiffer', () => {
    // 完整地址逐字保留：移动端按尾部 PeerId 直接拨号（不靠 nodeId 拼回）
    const payload = JSON.parse(buildQrPayload({ ...realBase, peer: realPeer }))
    expect(payload.peer.addrs).toEqual([lanAddr, relayAddr])
    expect(payload.peer.addrs.every((a: string) => a.endsWith(`/p2p/${LIBP2P_ID}`))).toBe(true)
  })

  it('should_stayWithinCanvasBudget_when_fullPeerPayload', () => {
    // v2 体积档（85 模块 / 356px）：画布仍按 4px/模块落，不触发缩小或溢出
    const payload = buildQrPayload({ ...realBase, peer: realPeer })
    const plan = planQrCanvas(qrMatrix(payload).size, 1)
    expect(qrMatrix(payload).size).toBe(85)
    expect(plan.cell).toBe(4)
    expect(plan.cssSize).toBe(356)
  })
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

  it('should_wrapV3Payload_when_peerComplete', () => {
    expect(JSON.parse(decodePairUri(buildPairUri({ ...base, peer })))).toEqual({
      v: 3,
      h: '192.168.1.5',
      p: 8765,
      t: 'token-1',
      n: '12D3KooWTarget',
      a: [
        '/ip4/192.168.1.5/tcp/47613',
        '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit',
      ],
      tk: 'ticket-once',
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

describe('T08-7 尺寸回归（v3 必须比 v2 小一个版本档）', () => {
  // 真实形状：宿主 status 的 LAN + relay 地址、认证中心 32 hex token、宿主 64 hex 票据
  const NODE_ID = '12D3KooWBSCkgKRqQWpPhGGC61TfEWno22bcEGXxQvohhPbQBkud'
  const RELAY_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'
  const TOKEN = '9c1f'.repeat(8)
  const TICKET = 'f3a1'.repeat(16)
  const realBase = { host: '192.168.1.100', port: 8765, token: TOKEN }
  const lanAddr = `/ip4/192.168.1.100/tcp/8765/p2p/${NODE_ID}`
  const relayAddr = `/ip4/113.45.43.60/tcp/4001/p2p/${RELAY_ID}/p2p-circuit/p2p/${NODE_ID}`

  it('should_fitIn69Modules_when_lanPlusRelay', () => {
    // v2 同载荷是 85 模块（画布 356px）；v3 压到 69 模块（画布 292px）
    const payload = buildQrPayload({
      ...realBase,
      peer: { nodeId: NODE_ID, addrs: [lanAddr, relayAddr], ticket: TICKET },
    })
    expect(qrMatrix(payload).size).toBe(69)
  })

  it('should_fitIn73Modules_when_threeAddresses', () => {
    const payload = buildQrPayload({
      ...realBase,
      peer: {
        nodeId: NODE_ID,
        addrs: [lanAddr, `/ip4/10.8.0.4/tcp/39000/p2p/${NODE_ID}`, relayAddr],
        ticket: TICKET,
      },
    })
    expect(qrMatrix(payload).size).toBe(73)
  })

  it('should_fitIn61Modules_when_lanOnly', () => {
    const payload = buildQrPayload({
      ...realBase,
      peer: { nodeId: NODE_ID, addrs: [lanAddr], ticket: TICKET },
    })
    expect(qrMatrix(payload).size).toBe(61)
  })
})
