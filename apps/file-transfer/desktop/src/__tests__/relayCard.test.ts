/**
 * 中继发现状态信封解析（T23 / P0-2 探索链路的数据层）
 *
 * 覆盖：旧宿主降级（无 status = null）、错误摘要截断、设备计数。
 * 探索面板只消费设备快照；状态信封随 `peer:relay-devices` 事件下发，
 * 由 usePeerDevices 解析后并入发现缓存。
 */
import { describe, it, expect } from 'vitest'
import { parseRelayDiscoveryPayload } from '../composables/deviceState'

const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

describe('parseRelayDiscoveryPayload', () => {
  it('should_parseEnvelopeAndCountDevices', () => {
    expect(
      parseRelayDiscoveryPayload({
        status: 'ok',
        error: null,
        relay: RELAY,
        updatedAtMs: 123,
        devices: [{}, {}],
      }),
    ).toEqual({ status: 'ok', error: null, relay: RELAY, updatedAtMs: 123, count: 2 })
  })

  it('should_returnNullForOldHostWithoutStatus', () => {
    expect(parseRelayDiscoveryPayload({ devices: [] })).toBeNull()
    expect(parseRelayDiscoveryPayload({ status: 'unknown-status' })).toBeNull()
    expect(parseRelayDiscoveryPayload(null)).toBeNull()
  })

  it('should_truncateErrorDetailForDisplay', () => {
    const parsed = parseRelayDiscoveryPayload({
      status: 'error',
      error: 'x'.repeat(200),
      updatedAtMs: 1,
      devices: [],
    })
    expect(parsed?.error).toHaveLength(121)
    expect(parsed?.error?.endsWith('…')).toBe(true)
  })
})
