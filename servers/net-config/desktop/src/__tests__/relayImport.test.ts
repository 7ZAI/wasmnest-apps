/**
 * relay 导入载荷解析契约（T14）
 *
 * 判据（全部来自 T13 `print-addrs` 产出方契约 + T14 验收条件）：
 * - P1 JSON 形态：字段/协议/版本/配额按产出方 snake_case 读，指纹由 PeerId 本地复算；
 * - P2 文本形态：`print-addrs` 的「地址行 + peerId 元数据行」可直接粘贴；
 * - P3 身份：只认 ed25519 libp2p PeerId；载荷自报指纹与本地复算不一致即拒绝；
 * - P4 地址：只接受 relay 基础地址（host + tcp + /p2p），`/p2p-circuit` 拒绝；
 * - P5 失败可见：每个拒绝都给可翻译的 errorKey，不静默丢字段/丢地址。
 */

import { describe, it, expect } from 'vitest'
import {
  RELAY_CONTROL_PROTOCOL,
  base58Decode,
  buildRelayImportPayload,
  decodeEd25519PeerId,
  parseRelayAddr,
  parseRelayImport,
  resolvePeerIdentity,
} from '@/relay/relayImport'

/** 测试夹具：仅公钥派生的 PeerId / 指纹（无密钥材料） */
const PEER_ID = '12D3KooWEgB32or8rjD4jBv6KdABzehxstZ4oFVJV934U9GU387H'
const FINGERPRINT = 'd842779d48acb8694b01b0091b72e4b81f7a52bad4bca0ee03cf14e3c689cadb'
const ADDR = `/dns4/relay.example.com/tcp/4001/p2p/${PEER_ID}`
const ADDR_IP = `/ip4/203.0.113.10/tcp/4001/p2p/${PEER_ID}`

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'wasmnest-relay',
    relay_version: '0.0.1',
    peer_id: PEER_ID,
    peer_id_sha256: FINGERPRINT,
    control_protocol: RELAY_CONTROL_PROTOCOL,
    addrs: [ADDR],
    access: { mode: 'open' },
    quota: { max_circuit_bytes: 1073741824, max_circuit_duration_secs: 3600 },
    ...overrides,
  }
}

describe('PeerId / 指纹', () => {
  it('base58 解码保留前导零字节', () => {
    expect([...(base58Decode('1') ?? [])]).toEqual([0])
    expect([...(base58Decode('2') ?? [])]).toEqual([1])
    expect(base58Decode('0OIl')).toBeNull()
  })

  it('ed25519 PeerId 解出 32 字节公钥，指纹与产出方口径一致', async () => {
    expect(decodeEd25519PeerId(PEER_ID)?.length).toBe(32)
    const identity = await resolvePeerIdentity(PEER_ID)
    expect(identity?.fingerprint).toBe(FINGERPRINT)
  })

  it('非 ed25519 / 畸形 PeerId 一律 null', async () => {
    expect(decodeEd25519PeerId('12D3KooW')).toBeNull()
    expect(decodeEd25519PeerId('not-a-peer-id')).toBeNull()
    expect(await resolvePeerIdentity('not-a-peer-id')).toBeNull()
  })
})

describe('地址校验', () => {
  it('接受 host + tcp + /p2p 的 relay 基础地址', () => {
    expect(parseRelayAddr(ADDR)).toEqual({ ok: true, peerId: PEER_ID })
    expect(parseRelayAddr(ADDR_IP)).toEqual({ ok: true, peerId: PEER_ID })
    expect(parseRelayAddr(`/ip6/2001:db8::1/tcp/4001/p2p/${PEER_ID}`)).toEqual({
      ok: true,
      peerId: PEER_ID,
    })
  })

  it('拒绝 /p2p-circuit（那是拨号目标，不是中继地址）与额外段', () => {
    expect(parseRelayAddr(`${ADDR}/p2p-circuit`)).toEqual({
      ok: false,
      errorKey: 'relay.error.addrShape',
    })
    expect(parseRelayAddr(`${ADDR}/ws`)).toEqual({ ok: false, errorKey: 'relay.error.addrShape' })
    expect(parseRelayAddr(`/dns4/relay.example.com/tcp/4001`)).toEqual({
      ok: false,
      errorKey: 'relay.error.addrShape',
    })
  })

  it('拒绝非法端口 / 主机 / PeerId', () => {
    expect(parseRelayAddr(`/dns4/relay.example.com/tcp/0/p2p/${PEER_ID}`)).toEqual({
      ok: false,
      errorKey: 'relay.error.addrShape',
    })
    expect(parseRelayAddr(`/dns4/relay example.com/tcp/4001/p2p/${PEER_ID}`)).toEqual({
      ok: false,
      errorKey: 'relay.error.addrShape',
    })
    expect(parseRelayAddr('/dns4/relay.example.com/tcp/4001/p2p/abc')).toEqual({
      ok: false,
      errorKey: 'relay.error.peerId',
    })
  })
})

describe('JSON 形态', () => {
  it('完整载荷解析为 camelCase 配置，指纹以本地复算为准', async () => {
    const result = await parseRelayImport(JSON.stringify(payload()))
    expect(result).toEqual({
      ok: true,
      value: {
        relayAddrs: [ADDR],
        peerId: PEER_ID,
        peerIdSha256: FINGERPRINT,
        accessMode: 'open',
        relayVersion: '0.0.1',
        controlProtocol: RELAY_CONTROL_PROTOCOL,
        quota: { maxCircuitBytes: 1073741824, maxCircuitDurationSecs: 3600 },
        source: 'json',
      },
    })
  })

  it('载荷版本不匹配显性拒绝（不猜未来字段）', async () => {
    expect(await parseRelayImport(JSON.stringify(payload({ v: 2 })))).toEqual({
      ok: false,
      errorKey: 'relay.error.version',
      detail: 'v=2',
    })
  })

  it('kind / 控制协议 / 指纹不一致全部拒绝', async () => {
    expect(await parseRelayImport(JSON.stringify(payload({ kind: 'other' })))).toMatchObject({
      ok: false,
      errorKey: 'relay.error.kind',
    })
    expect(
      await parseRelayImport(
        JSON.stringify(payload({ control_protocol: '/wasmnest/relay-control/2' })),
      ),
    ).toMatchObject({ ok: false, errorKey: 'relay.error.controlProtocol' })
    expect(
      await parseRelayImport(JSON.stringify(payload({ peer_id_sha256: '0'.repeat(64) }))),
    ).toEqual({ ok: false, errorKey: 'relay.error.fingerprintMismatch' })
    expect(await parseRelayImport(JSON.stringify(payload({ peer_id_sha256: undefined })))).toEqual({
      ok: false,
      errorKey: 'relay.error.fingerprintMissing',
    })
  })

  it('地址 PeerId 与载荷不一致 / 多条不同 relay 一律拒绝', async () => {
    const otherPeer = '12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA'
    expect(
      await parseRelayImport(
        JSON.stringify(payload({ addrs: [`/dns4/relay.example.com/tcp/4001/p2p/${otherPeer}`] })),
      ),
    ).toMatchObject({ ok: false, errorKey: 'relay.error.addrPeer' })

    expect(
      await parseRelayImport(
        JSON.stringify(payload({ addrs: [ADDR, `/ip4/203.0.113.10/tcp/4001/p2p/${otherPeer}`] })),
      ),
    ).toMatchObject({ ok: false, errorKey: 'relay.error.multiPeer' })
  })

  it('access / quota / addrs 结构非法时拒绝', async () => {
    expect(await parseRelayImport(JSON.stringify(payload({ access: { mode: 'closed' } })))).toEqual(
      { ok: false, errorKey: 'relay.error.access' },
    )
    expect(
      await parseRelayImport(
        JSON.stringify(payload({ quota: { max_circuit_bytes: -1, max_circuit_duration_secs: 1 } })),
      ),
    ).toEqual({ ok: false, errorKey: 'relay.error.quota' })
    expect(await parseRelayImport(JSON.stringify(payload({ addrs: [] })))).toEqual({
      ok: false,
      errorKey: 'relay.error.addrs',
    })
  })
})

describe('文本形态（print-addrs / 多地址）', () => {
  it('接受 render_text 形态并补齐本地复算指纹', async () => {
    const text = [
      ADDR,
      `peerId: ${PEER_ID}`,
      `peerIdSha256: ${FINGERPRINT}`,
      'access: open',
      `controlProtocol: ${RELAY_CONTROL_PROTOCOL}`,
    ].join('\n')
    const result = await parseRelayImport(text)
    expect(result).toEqual({
      ok: true,
      value: {
        relayAddrs: [ADDR],
        peerId: PEER_ID,
        peerIdSha256: FINGERPRINT,
        accessMode: 'open',
        relayVersion: null,
        controlProtocol: RELAY_CONTROL_PROTOCOL,
        quota: null,
        source: 'text',
      },
    })
  })

  it('纯 multiaddr 也能导入（指纹从 PeerId 复算，权限未知不猜）', async () => {
    const result = await parseRelayImport(ADDR_IP)
    expect(result).toMatchObject({
      ok: true,
      value: {
        relayAddrs: [ADDR_IP],
        peerId: PEER_ID,
        peerIdSha256: FINGERPRINT,
        accessMode: null,
        controlProtocol: null,
        source: 'text',
      },
    })
  })

  it('元数据与地址冲突 / 无法识别的行 / 多个 relay 都拒绝', async () => {
    expect(
      await parseRelayImport(
        [ADDR, 'peerId: 12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA'].join('\n'),
      ),
    ).toMatchObject({ ok: false, errorKey: 'relay.error.addrPeer' })

    expect(await parseRelayImport([ADDR, 'hello world'].join('\n'))).toEqual({
      ok: false,
      errorKey: 'relay.error.line',
      detail: 'hello world',
    })

    const otherPeer = '12D3KooWD3eckifWpRn9wQpMG9R9hX3sD158z7EqHWmweQAJU5SA'
    expect(
      await parseRelayImport([ADDR, `/ip4/203.0.113.10/tcp/4001/p2p/${otherPeer}`].join('\n')),
    ).toMatchObject({ ok: false, errorKey: 'relay.error.multiPeer' })
  })

  it('文本里的指纹不一致拒绝', async () => {
    const result = await parseRelayImport([ADDR, `peerIdSha256: ${'a'.repeat(64)}`].join('\n'))
    expect(result).toEqual({ ok: false, errorKey: 'relay.error.fingerprintMismatch' })
  })
})

describe('空输入与回写载荷', () => {
  it('空输入显性拒绝', async () => {
    expect(await parseRelayImport('   ')).toEqual({ ok: false, errorKey: 'relay.error.empty' })
  })

  it('JSON 解析失败给出可翻译错误', async () => {
    expect(await parseRelayImport('{ not json')).toEqual({
      ok: false,
      errorKey: 'relay.error.json',
    })
  })

  it('buildRelayImportPayload 的产物可被本解析器回读', async () => {
    const parsed = await parseRelayImport(JSON.stringify(payload()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const roundTrip = await parseRelayImport(JSON.stringify(buildRelayImportPayload(parsed.value)))
    expect(roundTrip).toEqual(parsed)
  })
})
