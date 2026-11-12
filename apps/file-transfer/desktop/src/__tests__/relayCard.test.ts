/**
 * 跨网状态卡（T23 / P0-2）— 宿主 envelope 解析与卡片模型
 *
 * 覆盖：旧宿主降级（无 status = null）、错误摘要截断、状态优先级、
 * 「每个状态都有下一步」的 action 映射、过期判定与空间码提示。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PeerDevicesPanel from '../components/PeerDevicesPanel.vue'
import {
  deriveRelayCard,
  parseRelayDiscoveryPayload,
  RELAY_CARD_STALE_MS,
  type RelayDiscovery,
} from '../composables/deviceState'

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

  it('should_promptForRelayWhenUnconfigured', () => {
    const card = deriveRelayCard({ ...base, relayAddrs: [], discovery: null })
    expect(card.title).toBe('transfer.relayCard.unconfigured.title')
    expect(card.primary).toBe('paste-invite')
    expect(card.secondary).toBe('open-center')
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

  it('should_showReadyWithCountAndRoomHint', () => {
    const empty = deriveRelayCard({ ...base, relayRoom: '', discovery: discovery({ count: 0 }) })
    expect(empty.title).toBe('transfer.relayCard.readyEmpty.title')
    expect(empty.roomHint).toBe(true)

    const ready = deriveRelayCard({ ...base, discovery: discovery({ count: 3 }) })
    expect(ready.title).toBe('transfer.relayCard.ready.title')
    expect(ready.count).toBe(3)
    expect(ready.params).toMatchObject({ count: 3 })
    expect(ready.roomHint).toBe(false)
    expect(ready.tone).toBe('ok')
  })

  it('should_markStaleAfterThreshold', () => {
    const fresh = deriveRelayCard({
      ...base,
      discovery: discovery({ updatedAtMs: NOW - RELAY_CARD_STALE_MS + 1 }),
    })
    expect(fresh.stale).toBe(false)
    const stale = deriveRelayCard({
      ...base,
      discovery: discovery({ updatedAtMs: NOW - RELAY_CARD_STALE_MS - 1 }),
    })
    expect(stale.stale).toBe(true)
  })

  it('should_degradeForOldHostWithoutEnvelope', () => {
    const reserved = deriveRelayCard({ ...base, relayState: 'relay-reserved', discovery: null })
    expect(reserved.title).toBe('transfer.relayCard.pending.title')
    expect(reserved.primary).toBe('generate-invite')

    const unknown = deriveRelayCard({ ...base, discovery: null })
    expect(unknown.title).toBe('transfer.relayCard.pending.title')
    expect(unknown.primary).toBe('refresh')
  })
})

describe('PeerDevicesPanel — 状态卡渲染', () => {
  function mountPanel(relayCard: ReturnType<typeof deriveRelayCard>) {
    const context = {
      i18n: { t: (key: string) => key },
    } as unknown as PluginContext
    return mount(PeerDevicesPanel, {
      props: { rows: [], relayCard },
      global: { provide: { pluginContext: context } },
    })
  }

  it('should_renderTitleAndEmitPrimaryAction', async () => {
    const wrapper = mountPanel(
      deriveRelayCard({ relayAddrs: [], relayRoom: '', discovery: null, nowMs: NOW }),
    )
    expect(wrapper.find('[data-testid="ft-relay-card-title"]').text()).toBe(
      'transfer.relayCard.unconfigured.title',
    )
    expect(wrapper.find('[data-testid="ft-relay-card-room-hint"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ft-relay-card-primary"]').trigger('click')
    expect(wrapper.emitted('relayAction')?.[0]).toEqual(['paste-invite'])
  })

  it('should_renderErrorDetailAndStaleHint', () => {
    const wrapper = mountPanel(
      deriveRelayCard({
        relayAddrs: [RELAY],
        relayRoom: 'nest',
        discovery: discovery({
          status: 'error',
          error: 'timeout',
          updatedAtMs: NOW - RELAY_CARD_STALE_MS - 1,
        }),
        nowMs: NOW,
      }),
    )
    expect(wrapper.find('[data-testid="ft-relay-card-title"]').text()).toBe(
      'transfer.relayCard.error.title',
    )
    expect(wrapper.find('[data-testid="ft-relay-card-stale"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ft-relay-card-room-hint"]').exists()).toBe(false)
  })
})
