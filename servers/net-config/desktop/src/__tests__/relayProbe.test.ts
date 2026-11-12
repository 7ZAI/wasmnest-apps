/**
 * 探测结果的解析契约（纯函数）
 *
 * 只做两件事的判据：把宿主返回的 `code: detail` 拆干净，以及把码映射到文案键。
 * 这两步一旦「猜」，权限拒绝会被渲染成 relay 不可达、未知故障会被吞成空字符串。
 */

import { describe, expect, it } from 'vitest'
import { isProbeReport, probeErrorKey, splitWireError } from '@/composables/useRelayProbe'

describe('splitWireError', () => {
  it('拆出 kebab-case 错误码与明细', () => {
    expect(splitWireError('relay-unreachable: 127.0.0.1:4001 → 拒绝连接')).toEqual({
      code: 'relay-unreachable',
      detail: '127.0.0.1:4001 → 拒绝连接',
    })
  })

  it('无明细时 detail 为空串（不把冒号留下）', () => {
    expect(splitWireError('probe-rate-limited:')).toEqual({
      code: 'probe-rate-limited',
      detail: '',
    })
  })

  it('非「码 + 冒号」形状整串进 detail，不猜码', () => {
    expect(splitWireError('something exploded')).toEqual({
      code: '',
      detail: 'something exploded',
    })
    // 大写 / 空格开头都不是契约码（例如平台层包装的 `Tunnel Probe: ...`）
    expect(splitWireError('Tunnel Probe: nope')).toEqual({
      code: '',
      detail: 'Tunnel Probe: nope',
    })
  })

  it('权限门串按首段成码（渲染为权限错误，不误判成 relay 故障）', () => {
    expect(splitWireError('permission denied: tunnel:probe').code).toBe('permission')
  })
})

describe('probeErrorKey', () => {
  it('能力域错误码全覆盖', () => {
    expect(probeErrorKey('relay-unreachable')).toBe('relay.probe.errorUnreachable')
    expect(probeErrorKey('relay-identity-mismatch')).toBe('relay.probe.errorIdentity')
    expect(probeErrorKey('relay-address-invalid')).toBe('relay.probe.errorAddress')
    expect(probeErrorKey('probe-rate-limited')).toBe('relay.probe.errorRateLimited')
    expect(probeErrorKey('relay-not-configured')).toBe('relay.probe.errorNotConfigured')
    expect(probeErrorKey('tunnel-unavailable')).toBe('relay.probe.unsupported')
    expect(probeErrorKey('permission')).toBe('relay.probe.errorPermission')
  })

  it('未知码走 errorUnknown（不静默成成功）', () => {
    expect(probeErrorKey('weird-code')).toBe('relay.probe.errorUnknown')
    expect(probeErrorKey('')).toBe('relay.probe.errorUnknown')
  })
})

describe('isProbeReport', () => {
  const report = {
    v: 1,
    addr: '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest',
    peerId: '12D3KooWTest',
    peerIdSha256: 'ab'.repeat(32),
    handshakeMs: 12,
    rttMs: null,
    checkedAt: '2026-11-10T13:26:37Z',
  }

  it('接受契约形状（rttMs 可为 null）', () => {
    expect(isProbeReport(report)).toBe(true)
    expect(isProbeReport({ ...report, rttMs: 42 })).toBe(true)
  })

  it('拒绝缺字段 / 类型不符（回执变形必须显性失败）', () => {
    expect(isProbeReport(null)).toBe(false)
    expect(isProbeReport({ ...report, peerId: 42 })).toBe(false)
    expect(isProbeReport({ ...report, handshakeMs: '12' })).toBe(false)
    const { checkedAt: _omit, ...missing } = report
    expect(isProbeReport(missing)).toBe(false)
  })
})
