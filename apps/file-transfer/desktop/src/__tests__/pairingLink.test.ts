/**
 * 远程设备连接串解析（T12）契约测试
 *
 * 判据（与 bedcode `host/qr.ts` 同口径，见模块注释）：
 * ① 连接串 / 纯 JSON 两种形态同一解析；
 * ② 包装形态 `{v:2,…,peer}` 与扁平形态都接受；未知版本 / 坏 base64 判 malformed；
 * ③ 缺字段判 incomplete、地址不可拨号判 address-invalid（界面文案可区分）；
 * ④ 多地址去重保序（LAN 在前不被重排）；ticket 不落任何长期位置（只留在返回值）。
 */
import { describe, it, expect } from 'vitest'
import { isRelayCandidate, parseRemotePeerLink, relayCandidatesOf } from '../utils/pairingLink'

const NODE_ID = 'a'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

/** UTF-8 → base64url（与 bedcode 组装端同形） */
function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function uri(payload: unknown): string {
  return `wasmnest://pair/${toBase64Url(JSON.stringify(payload))}`
}

describe('parseRemotePeerLink', () => {
  it('接受 QR v2 包装形态的连接串（LAN + relay 候选原序保留）', () => {
    const text = uri({
      v: 2,
      host: '192.168.1.5',
      port: 8765,
      token: 'jwt-like',
      peer: { nodeId: NODE_ID, addrs: [LAN, RELAY], ticket: 'tkt-1' },
    })
    const r = parseRemotePeerLink(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.nodeId).toBe(NODE_ID)
    expect(r.link.addrs).toEqual([LAN, RELAY])
    expect(r.link.ticket).toBe('tkt-1')
    expect(r.link.deviceName).toBe('')
  })

  it('接受扁平 JSON（nodeId + addrs），并把大写 nodeId 归一为小写', () => {
    const r = parseRemotePeerLink(
      JSON.stringify({ nodeId: NODE_ID.toUpperCase(), addrs: [LAN], deviceName: '客厅 NAS' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.nodeId).toBe(NODE_ID)
    expect(r.link.deviceName).toBe('客厅 NAS')
    expect(r.link.ticket).toBeNull()
  })

  it('去重多地址且保持给定顺序（LAN 不被重排到 relay 后）', () => {
    const r = parseRemotePeerLink(JSON.stringify({ nodeId: NODE_ID, addrs: [LAN, RELAY, LAN] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.addrs).toEqual([LAN, RELAY])
  })

  it('坏连接串 / 非 JSON / 未知版本判 malformed', () => {
    expect(parseRemotePeerLink('wasmnest://pair/%%%')).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseRemotePeerLink('wasmnest://other/abc')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseRemotePeerLink('not-json')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseRemotePeerLink('')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseRemotePeerLink(uri({ v: 3, peer: { nodeId: NODE_ID, addrs: [LAN] } }))).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseRemotePeerLink(uri([NODE_ID]))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('缺 nodeId / 缺 addrs 判 incomplete（不静默当 v1 处理）', () => {
    expect(parseRemotePeerLink(JSON.stringify({ addrs: [LAN] }))).toEqual({
      ok: false,
      reason: 'incomplete',
    })
    expect(parseRemotePeerLink(JSON.stringify({ nodeId: 'abc', addrs: [LAN] }))).toEqual({
      ok: false,
      reason: 'incomplete',
    })
    expect(parseRemotePeerLink(JSON.stringify({ nodeId: NODE_ID }))).toEqual({
      ok: false,
      reason: 'incomplete',
    })
    expect(parseRemotePeerLink(JSON.stringify({ nodeId: NODE_ID, addrs: [] }))).toEqual({
      ok: false,
      reason: 'incomplete',
    })
    // 旧 v1 载荷（host/port/token）没有 peer 地址，不能当远程设备
    expect(
      parseRemotePeerLink(JSON.stringify({ host: '192.168.1.5', port: 8765, token: 't' })),
    ).toEqual({ ok: false, reason: 'incomplete' })
  })

  it('地址不可拨号（非 multiaddr / 空白 / 未指定地址）判 address-invalid', () => {
    for (const bad of ['192.168.1.5:47613', '/ip4/0.0.0.0/tcp/47613', '/ip4/10 0 0 1/tcp/1', 42]) {
      expect(parseRemotePeerLink(JSON.stringify({ nodeId: NODE_ID, addrs: [bad] }))).toEqual({
        ok: false,
        reason: 'address-invalid',
      })
    }
  })
})

describe('relayCandidatesOf', () => {
  it('只挑出 circuit 候选并保留顺序', () => {
    expect(isRelayCandidate(LAN)).toBe(false)
    expect(isRelayCandidate(RELAY)).toBe(true)
    expect(relayCandidatesOf([LAN, RELAY])).toEqual([RELAY])
    expect(relayCandidatesOf(undefined)).toEqual([])
  })
})
