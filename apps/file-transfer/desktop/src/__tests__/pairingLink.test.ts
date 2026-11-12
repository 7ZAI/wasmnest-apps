/**
 * 远程设备连接串解析（T12）契约测试
 *
 * 判据（见模块注释）：
 * ① 连接串 / 纯 JSON 两种形态同一解析；
 * ② 自持 v3、包装形态 `{v:2,…,peer}` 与扁平形态都接受；未知版本 / 坏 base64 判 malformed；
 * ③ 缺字段判 incomplete、地址不可拨号判 address-invalid（界面文案可区分）；
 * ④ 多地址去重保序（LAN 在前不被重排）；ticket 不落任何长期位置（只留在返回值）；
 * ⑤ 生成端与解析端同判据（v3 往返一致，非法入参显性抛错）。
 */
import { describe, it, expect } from 'vitest'
import {
  JOIN_URI_PREFIX,
  buildConnectionInvite,
  buildRemotePeerLink,
  isConnectionInvite,
  isRelayCandidate,
  parseConnectionInvite,
  parseRemotePeerLink,
  relayCandidatesOf,
} from '../utils/pairingLink'

const NODE_ID = 'a'.repeat(64)
const LAN = '/ip4/192.168.1.5/tcp/47613'
const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWTarget'

/** UTF-8 → base64url（夹具用；生成端实现见模块） */
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
    expect(parseRemotePeerLink(uri({ v: 4, peer: { nodeId: NODE_ID, addrs: [LAN] } }))).toEqual({
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

describe('buildRemotePeerLink', () => {
  it('生成 v3 连接串并可被解析端原样读回（LAN + relay 顺序保留）', () => {
    const text = buildRemotePeerLink({
      nodeId: NODE_ID.toUpperCase(),
      addrs: [LAN, RELAY, LAN],
      deviceName: '客厅 NAS',
    })
    expect(text.startsWith('wasmnest://pair/')).toBe(true)
    const r = parseRemotePeerLink(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link.nodeId).toBe(NODE_ID)
    expect(r.link.addrs).toEqual([LAN, RELAY])
    expect(r.link.deviceName).toBe('客厅 NAS')
    expect(r.link.ticket).toBeNull()
  })

  it('非法 nodeId / 空地址 / 不可拨地址显性抛错（不生成残缺链接）', () => {
    expect(() => buildRemotePeerLink({ nodeId: 'abc', addrs: [LAN] })).toThrow(/invalid nodeId/)
    expect(() => buildRemotePeerLink({ nodeId: NODE_ID, addrs: [] })).toThrow(
      /at least one address/,
    )
    expect(() =>
      buildRemotePeerLink({ nodeId: NODE_ID, addrs: ['/ip4/0.0.0.0/tcp/47613'] }),
    ).toThrow(/invalid address/)
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

const RELAY_ENDPOINT = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'
const FINGERPRINT = 'c'.repeat(64)

function joinUri(payload: unknown): string {
  return `${JOIN_URI_PREFIX}${toBase64Url(JSON.stringify(payload))}`
}

describe('ConnectionInvite（v4）', () => {
  it('生成 → 解析往返：room / relay（去重保序）/ name / relayMeta 保持', () => {
    const text = buildConnectionInvite({
      room: 'nest-7f3a2c91',
      relay: [RELAY_ENDPOINT, RELAY_ENDPOINT],
      name: '客厅 NAS',
      relayMeta: {
        version: 1,
        peerId: '12D3KooWRelay',
        peerIdSha256: FINGERPRINT,
        accessMode: 'open',
        relayVersion: '0.0.1',
        controlProtocol: '/wasmnest/relay-control/1',
        source: 'json',
      },
    })
    expect(text.startsWith(JOIN_URI_PREFIX)).toBe(true)
    expect(parseConnectionInvite(text)).toEqual({
      ok: true,
      invite: {
        room: 'nest-7f3a2c91',
        relay: [RELAY_ENDPOINT],
        name: '客厅 NAS',
        relayMeta: {
          version: 1,
          peerId: '12D3KooWRelay',
          peerIdSha256: FINGERPRINT,
          accessMode: 'open',
          relayVersion: '0.0.1',
          controlProtocol: '/wasmnest/relay-control/1',
          source: 'json',
        },
      },
    })
  })

  it('接受纯 v4 JSON 文本（粘贴场景），并按前缀区分邀请与设备链接', () => {
    const r = parseConnectionInvite(
      JSON.stringify({ v: 4, room: 'home_1', relay: [RELAY_ENDPOINT], name: '' }),
    )
    expect(r.ok).toBe(true)
    expect(isConnectionInvite(joinUri({ v: 4 }))).toBe(true)
    expect(isConnectionInvite(`wasmnest://pair/${toBase64Url('{}')}`)).toBe(false)
    expect(isConnectionInvite(JSON.stringify({ v: 4 }))).toBe(false)
    expect(isConnectionInvite(undefined)).toBe(false)
  })

  it('生成端对非法 room / relay 显性抛错（不产出坏码）', () => {
    expect(() => buildConnectionInvite({ room: '', relay: [RELAY_ENDPOINT], name: '' })).toThrow(
      /invalid room/,
    )
    expect(() =>
      buildConnectionInvite({ room: 'two words', relay: [RELAY_ENDPOINT], name: '' }),
    ).toThrow(/invalid room/)
    expect(() => buildConnectionInvite({ room: 'nest', relay: [], name: '' })).toThrow(
      /at least one relay/,
    )
    // circuit 拨号目标不是 relay 端点
    expect(() => buildConnectionInvite({ room: 'nest', relay: [RELAY], name: '' })).toThrow(
      /invalid relay address/,
    )
    expect(() =>
      buildConnectionInvite({ room: 'nest', relay: ['/ip4/203.0.113.9/tcp/4001'], name: '' }),
    ).toThrow(/invalid relay address/)
  })

  it('坏编码 / 未知版本 / v3 链接判 malformed（不猜语义）', () => {
    expect(parseConnectionInvite('')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseConnectionInvite('%%%')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseConnectionInvite(`${JOIN_URI_PREFIX}%%%`)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseConnectionInvite('wasmnest://pair/abc')).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(parseConnectionInvite(joinUri({ v: 3, room: 'nest', relay: [RELAY_ENDPOINT] }))).toEqual(
      { ok: false, reason: 'malformed' },
    )
    expect(parseConnectionInvite(joinUri([1]))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('空间码缺失 / 非法判 missing-room', () => {
    for (const room of [undefined, '', '  ', 'two words', 'a'.repeat(65)]) {
      expect(parseConnectionInvite(joinUri({ v: 4, room, relay: [RELAY_ENDPOINT] }))).toEqual({
        ok: false,
        reason: 'missing-room',
      })
    }
  })

  it('relay 缺失 / 空 / 非字符串 / circuit 目标 / 未指定地址判 address-invalid', () => {
    for (const relay of [
      undefined,
      [],
      [42],
      [RELAY],
      ['/ip4/0.0.0.0/tcp/4001/p2p/12D3KooWRelay'],
      ['203.0.113.9:4001'],
    ]) {
      expect(parseConnectionInvite(joinUri({ v: 4, room: 'nest', relay }))).toEqual({
        ok: false,
        reason: 'address-invalid',
      })
    }
  })

  it('展示名去控制字符并截断到 64（只影响展示，不拖累邀请）', () => {
    const r = parseConnectionInvite(
      joinUri({
        v: 4,
        room: 'nest',
        relay: [RELAY_ENDPOINT],
        name: `客\u0000厅\n${'x'.repeat(80)}`,
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.invite.name.startsWith('客厅')).toBe(true)
    expect(r.invite.name).toHaveLength(64)
    expect(r.invite.name).not.toContain('\u0000')
    expect(r.invite.name).not.toContain('\n')
  })

  it('relayMeta 缺身份字段时整块丢弃，邀请仍可用；缺省 version / source 按 1 / json 补', () => {
    const dropped = parseConnectionInvite(
      joinUri({ v: 4, room: 'nest', relay: [RELAY_ENDPOINT], relayMeta: { peerId: 'x' } }),
    )
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    expect(dropped.invite.relayMeta).toBeUndefined()

    const filled = parseConnectionInvite(
      joinUri({
        v: 4,
        room: 'nest',
        relay: [RELAY_ENDPOINT],
        relayMeta: { peerId: '12D3KooWRelay', peerIdSha256: FINGERPRINT },
      }),
    )
    expect(filled.ok).toBe(true)
    if (!filled.ok) return
    expect(filled.invite.relayMeta).toEqual({
      version: 1,
      peerId: '12D3KooWRelay',
      peerIdSha256: FINGERPRINT,
      accessMode: '',
      relayVersion: null,
      controlProtocol: '',
      source: 'json',
    })
  })
})
