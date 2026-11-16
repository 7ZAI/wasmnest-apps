/**
 * 跨网状态卡（T23 / P0-2）— 宿主 envelope 解析与卡片模型
 *
 * 覆盖：旧宿主降级（无 status = null）、错误摘要截断、状态优先级、
 * 「每个状态都有下一步」的 action 映射、过期判定与空间码提示。
 */
import { describe, it, expect } from 'vitest'
import {
  deriveRelayCard,
  parseRelayDiscoveryPayload,
  RELAY_CARD_STALE_MS,
  type RelayDiscovery,
} from '../deviceState'

const NOW = 1_700_000_000_000
const RELAY = '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooWRelay'

function discovery(overrides: Partial<RelayDiscovery> = {}): RelayDiscovery {
  return {
    status: 'ok',
    error: null,
    relay: RELAY,
    updatedAtMs: NOW,
    count: 0,
    ...overrides,
  }
}

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

describe('deriveRelayCard', () => {
  const base = { relayAddrs: [RELAY], relayRoom: 'nest', nowMs: NOW }

  it('should_prioritizeConflictAndPointToCenter', () => {
    const card = deriveRelayCard({ ...base, discovery: discovery(), conflict: true })
    expect(card.title).toBe('transfer.relayCard.conflict.title')
    expect(card.primary).toBe('open-center')
  })

  it('should_pointToRelaySettingsWhenUnconfigured', () => {
    const card = deriveRelayCard({ ...base, relayAddrs: [], discovery: null })
    expect(card.title).toBe('transfer.relayCard.unconfigured.title')
    expect(card.primary).toBe('open-center')
    expect(card.secondary).toBe('none')
  })

  it('should_useRelayStateWhileReservationIsInProgress', () => {
    expect(
      deriveRelayCard({ ...base, relayState: 'relay-connecting', discovery: null }).title,
    ).toBe('transfer.relayCard.connecting.title')
    expect(deriveRelayCard({ ...base, relayState: 'relay-lost', discovery: null }).title).toBe(
      'transfer.relayCard.lost.title',
    )
    expect(deriveRelayCard({ ...base, relayState: 'relay-idle', discovery: null }).primary).toBe(
      'open-settings',
    )
  })

  it('should_mapDiscoveryFailuresToActionableStates', () => {
    const cases: Array<[RelayDiscovery['status'], string]> = [
      ['disabled', 'transfer.relayCard.disabled.title'],
      ['relay-unavailable', 'transfer.relayCard.unavailable.title'],
      ['unsupported', 'transfer.relayCard.unsupported.title'],
      ['denied', 'transfer.relayCard.denied.title'],
      ['error', 'transfer.relayCard.error.title'],
    ]
    for (const [status, title] of cases) {
      const card = deriveRelayCard({ ...base, discovery: discovery({ status }) })
      expect(card.title).toBe(title)
      expect(card.primary).not.toBe('none')
    }
    const errorCard = deriveRelayCard({
      ...base,
      discovery: discovery({ status: 'error', error: 'timeout' }),
    })
    expect(errorCard.params).toEqual({ detail: 'timeout' })
  })

  it('should_renderNoCardWhenRelayIsReady', () => {
    expect(
      deriveRelayCard({ ...base, relayRoom: '', discovery: discovery({ count: 0 }) }),
    ).toBeNull()
    expect(deriveRelayCard({ ...base, discovery: discovery({ count: 3 }) })).toBeNull()
  })

  it('should_markStaleAfterThreshold', () => {
    const fresh = deriveRelayCard({
      ...base,
      discovery: discovery({ status: 'unavailable', updatedAtMs: NOW - RELAY_CARD_STALE_MS + 1 }),
    })
    expect(fresh?.stale).toBe(false)
    const stale = deriveRelayCard({
      ...base,
      discovery: discovery({ status: 'unavailable', updatedAtMs: NOW - RELAY_CARD_STALE_MS - 1 }),
    })
    expect(stale?.stale).toBe(true)
  })

  it('should_degradeForOldHostWithoutEnvelope', () => {
    const reserved = deriveRelayCard({ ...base, relayState: 'relay-reserved', discovery: null })
    expect(reserved?.title).toBe('transfer.relayCard.pending.title')
    expect(reserved?.primary).toBe('share-config')

    const unknown = deriveRelayCard({ ...base, discovery: null })
    expect(unknown?.title).toBe('transfer.relayCard.pending.title')
    expect(unknown?.primary).toBe('refresh')
  })
})
