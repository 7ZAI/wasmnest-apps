/**
 * 二维码载荷解析 行为契约测试
 * （票 2026-10-09：旧宿主 ScanPanel 的 `{host,port,token}` 契约迁入插件）
 *
 * 被测：`src/host/qr.ts::parseQrText`。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-QR-1 | 成功分支 | `{host,port,token}` 齐备且端口可归正整数 | `{ok:true, payload}` |
 * | C-QR-2 | try/catch | JSON 非法 / 非对象（数组、数字、null）/ 非字符串 | `malformed` |
 * | C-QR-3 | 字段校验 | host / token 缺失或空白；端口缺失/0/负/非数字/越界/小数 | `incomplete` |
 * | C-QR-4 | 归一 | host 去首尾空白；数字字符串端口转数字 | 归一后的载荷 |
 * | C-QR-5 | 健壮性 | 额外字段不参与判定，不影响成功 | 仍成功且载荷只含三字段 |
 * | C-QR-6 | T08 v2 | `v:2` 且 `peer`（nodeId/addrs/ticket）完整、地址可拨号 | `ok` 且带 `peer`；残缺/地址不可拨号 → `incomplete`；未知版本 → `malformed` |
 * | C-QR-7 | T08 连接串 | `wasmnest://pair/<base64url(json)>` 与 QR 共用解析 | 合法 → `ok`；坏 base64 / 未知 kind → `malformed` |
 */
import { describe, it, expect } from 'vitest'
import { parseQrText } from '../qr'

describe('C-QR-1/C-QR-4 合法载荷', () => {
  it('should_returnPayload_when_allFieldsPresent', () => {
    const result = parseQrText(JSON.stringify({ host: '192.168.1.5', port: 8765, token: 'abc123' }))
    expect(result).toEqual({ ok: true, payload: { host: '192.168.1.5', port: 8765, token: 'abc123' } })
  })

  it('should_normalizeHostAndNumericPort_when_whitespaceOrStringPort', () => {
    const result = parseQrText(JSON.stringify({ host: '  desktop.local  ', port: '8765', token: 't' }))
    expect(result).toEqual({
      ok: true,
      payload: { host: 'desktop.local', port: 8765, token: 't' },
    })
  })

  it('should_ignoreExtraFields_when_payloadHasMoreKeys', () => {
    const result = parseQrText(
      JSON.stringify({ host: 'h', port: 1, token: 't', version: 2, note: 'x' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.keys(result.payload).sort()).toEqual(['host', 'port', 'token'])
  })
})

describe('C-QR-2 malformed（JSON / 结构非法）', () => {
  const malformedInputs: Array<{ label: string; input: unknown }> = [
    { label: '非 JSON 文本', input: 'not-json-at-all' },
    { label: '空串', input: '' },
    { label: '仅空白', input: '   ' },
    { label: '非字符串', input: { host: 'h', port: 1, token: 't' } },
    { label: 'undefined', input: undefined },
    { label: 'JSON 数组', input: '[{"host":"h","port":1,"token":"t"}]' },
    { label: 'JSON 数字', input: '42' },
    { label: 'JSON null', input: 'null' },
  ]

  for (const c of malformedInputs) {
    it(`should_rejectAsMalformed_when_${c.label}`, () => {
      expect(parseQrText(c.input)).toEqual({ ok: false, reason: 'malformed' })
    })
  }
})

describe('C-QR-3 incomplete（字段缺失 / 越界）', () => {
  const incompletePayloads: Array<{ label: string; payload: Record<string, unknown> }> = [
    { label: '缺 host', payload: { port: 8765, token: 't' } },
    { label: 'host 空串', payload: { host: '', port: 8765, token: 't' } },
    { label: 'host 仅空白', payload: { host: '   ', port: 8765, token: 't' } },
    { label: 'host 非字符串', payload: { host: 5, port: 8765, token: 't' } },
    { label: '缺 port', payload: { host: 'h', token: 't' } },
    { label: 'port 为 0', payload: { host: 'h', port: 0, token: 't' } },
    { label: 'port 负数', payload: { host: 'h', port: -1, token: 't' } },
    { label: 'port 非数字', payload: { host: 'h', port: 'abc', token: 't' } },
    { label: 'port 小数', payload: { host: 'h', port: 87.65, token: 't' } },
    { label: 'port 越界', payload: { host: 'h', port: 70000, token: 't' } },
    { label: '缺 token', payload: { host: 'h', port: 8765 } },
    { label: 'token 空串', payload: { host: 'h', port: 8765, token: '' } },
    { label: 'token 非字符串', payload: { host: 'h', port: 8765, token: 1 } },
  ]

  for (const c of incompletePayloads) {
    it(`should_rejectAsIncomplete_when_${c.label}`, () => {
      expect(parseQrText(JSON.stringify(c.payload))).toEqual({ ok: false, reason: 'incomplete' })
    })
  }
})

// ==================== T08：QR v2 与连接串 ====================

/** 连接串编码（与桌面 `wasmnest://pair/<base64url(json)>` 同形；测试侧自带编码器） */
function encodePairUri(json: string): string {
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return `wasmnest://pair/${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

const peerFixture = {
  nodeId: '12D3KooWTargetNode',
  addrs: [
    '/ip4/192.168.1.5/tcp/47613/p2p/12D3KooWTargetNode',
    '/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTargetNode',
  ],
  ticket: 'ticket-once',
}

describe('C-QR-6 QR v2 载荷', () => {
  it('should_returnPeer_when_v2PayloadComplete', () => {
    const result = parseQrText(
      JSON.stringify({ v: 2, host: 'h', port: 8765, token: 't', peer: peerFixture }),
    )
    expect(result).toEqual({
      ok: true,
      payload: { host: 'h', port: 8765, token: 't', peer: peerFixture },
    })
  })

  it('should_dedupeAddrsAndKeepOrder_when_duplicateAddresses', () => {
    const result = parseQrText(
      JSON.stringify({
        v: 2,
        host: 'h',
        port: 8765,
        token: 't',
        peer: { ...peerFixture, addrs: [peerFixture.addrs[0], peerFixture.addrs[0]] },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.peer?.addrs).toEqual([peerFixture.addrs[0]])
  })

  it('should_ignorePeer_when_legacyPayloadCarriesIt', () => {
    // 旧版协议（无 v / v:1）不解释 peer：忽略未知字段，避免旧语义被新字段劫持
    const result = parseQrText(
      JSON.stringify({ host: 'h', port: 8765, token: 't', peer: peerFixture }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload).toEqual({ host: 'h', port: 8765, token: 't' })
  })

  const incompletePeers: Array<{ label: string; peer: unknown }> = [
    { label: 'peer 缺失', peer: undefined },
    { label: 'peer 非对象', peer: 'x' },
    { label: 'peer 为数组', peer: [] },
    { label: '缺 nodeId', peer: { addrs: peerFixture.addrs, ticket: 't' } },
    { label: 'nodeId 空串', peer: { ...peerFixture, nodeId: '' } },
    { label: '缺 ticket', peer: { ...peerFixture, ticket: undefined } },
    { label: 'addrs 空数组', peer: { ...peerFixture, addrs: [] } },
    { label: 'addrs 非数组', peer: { ...peerFixture, addrs: '/ip4/1.2.3.4/tcp/1/p2p/x' } },
    { label: 'addrs 含非字符串', peer: { ...peerFixture, addrs: [1] } },
    { label: '地址无 /p2p/', peer: { ...peerFixture, addrs: ['/ip4/1.2.3.4/tcp/1'] } },
    { label: '地址为 0.0.0.0', peer: { ...peerFixture, addrs: ['/ip4/0.0.0.0/tcp/1/p2p/x'] } },
    { label: '地址含空白', peer: { ...peerFixture, addrs: ['/ip4/1.2.3.4/tcp/1/p2p/x y'] } },
    { label: '地址不以 / 开头', peer: { ...peerFixture, addrs: ['ip4/1.2.3.4/tcp/1/p2p/x'] } },
  ]

  for (const c of incompletePeers) {
    it(`should_rejectAsIncomplete_when_${c.label}`, () => {
      const payload = { v: 2, host: 'h', port: 8765, token: 't' } as Record<string, unknown>
      if (c.peer !== undefined) payload.peer = c.peer
      expect(parseQrText(JSON.stringify(payload))).toEqual({ ok: false, reason: 'incomplete' })
    })
  }

  it('should_rejectAsMalformed_when_versionUnknown', () => {
    expect(
      parseQrText(JSON.stringify({ v: 3, host: 'h', port: 8765, token: 't', peer: peerFixture })),
    ).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('C-QR-7 连接串（wasmnest://pair/…）', () => {
  it('should_parseLegacyPayload_when_pairUriWrapsV1Json', () => {
    const result = parseQrText(encodePairUri(JSON.stringify({ host: 'h', port: 8765, token: 't' })))
    expect(result).toEqual({ ok: true, payload: { host: 'h', port: 8765, token: 't' } })
  })

  it('should_parsePeer_when_pairUriWrapsV2Json', () => {
    const result = parseQrText(
      encodePairUri(
        JSON.stringify({ v: 2, host: 'h', port: 8765, token: 't', peer: peerFixture }),
      ),
    )
    expect(result).toEqual({
      ok: true,
      payload: { host: 'h', port: 8765, token: 't', peer: peerFixture },
    })
  })

  it('should_rejectAsMalformed_when_pairUriBase64Invalid', () => {
    expect(parseQrText('wasmnest://pair/@@not-base64@@')).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('should_rejectAsMalformed_when_unknownWasmnestUriKind', () => {
    expect(parseQrText('wasmnest://device/abc')).toEqual({ ok: false, reason: 'malformed' })
  })
})
