/**
 * 隧道状态投影单测（T09）：纯映射，不依赖宿主。
 *
 * 覆盖判据：八态映射（含未知显性）/ 手动入口三重条件 / 事件并入快照 /
 * 错误码映射（含未识别码原样）/ QR `peer` → 拨号入参 / 回执坏形状显性失败。
 */
import { describe, expect, it } from 'vitest'
import {
  TUNNEL_MODES,
  applyModeEvent,
  buildTunnelView,
  errorCodeOf,
  modeLabelKey,
  modeTone,
  parseConnectResult,
  parseModeEvent,
  reasonLabelKey,
  shouldOfferManualWan,
  tunnelConnectArgs,
  tunnelErrorKey,
  type TunnelStatus,
} from '../tunnel'

function status(overrides: Partial<TunnelStatus> = {}): TunnelStatus {
  return {
    nodeId: '12D3KooWSELF',
    started: true,
    addrs: [],
    allowWan: true,
    relayAddrsConfigured: 1,
    reservation: false,
    relayState: 'idle',
    relayAddr: null,
    relayDetail: null,
    connects: 1,
    modes: [],
    mode: 'lan-active',
    reason: null,
    targets: [],
    ...overrides,
  }
}

describe('mode mapping', () => {
  it('covers all eight host modes with distinct keys', () => {
    const keys = TUNNEL_MODES.map((mode) => modeLabelKey(mode))
    expect(new Set(keys).size).toBe(TUNNEL_MODES.length)
    expect(keys.every((key) => key.startsWith('hub.tunnelMode'))).toBe(true)
  })

  it('unknown / missing mode is explicit, never silently "lan-active"', () => {
    expect(modeLabelKey('some-future-mode')).toBe('hub.tunnelModeUnknown')
    expect(modeLabelKey(null)).toBe('hub.tunnelModeUnknown')
    expect(modeTone('some-future-mode')).toBe('muted')
  })

  it('tone reflects transport family', () => {
    expect(modeTone('lan-active')).toBe('ok')
    expect(modeTone('wan-active')).toBe('warn')
    expect(modeTone('lan-unreachable')).toBe('error')
    expect(modeTone('wan-unavailable')).toBe('muted')
    expect(modeTone('offline')).toBe('muted')
  })

  it('reason keys exist for the documented vocabulary, unknown → null', () => {
    expect(reasonLabelKey('cellular')).toBe('hub.tunnelReasonCellular')
    expect(reasonLabelKey('host-unreachable')).toBe('hub.tunnelReasonHostUnreachable')
    expect(reasonLabelKey('made-up')).toBeNull()
    expect(reasonLabelKey(null)).toBeNull()
  })
})

describe('manual "try WAN" entry', () => {
  it('requires lan-unreachable + allowWan + relay configured', () => {
    expect(shouldOfferManualWan(status({ mode: 'lan-unreachable' }))).toBe(true)
    expect(shouldOfferManualWan(status({ mode: 'lan-unreachable', allowWan: false }))).toBe(false)
    expect(shouldOfferManualWan(status({ mode: 'lan-unreachable', relayAddrsConfigured: 0 }))).toBe(
      false,
    )
    // 其它模式一律不给（宿主的判据说了算）
    expect(shouldOfferManualWan(status({ mode: 'lan-active' }))).toBe(false)
    expect(shouldOfferManualWan(status({ mode: 'wan-active' }))).toBe(false)
    expect(shouldOfferManualWan(null)).toBe(false)
  })
})

describe('mode events', () => {
  it('parses host payload, rejects incomplete ones', () => {
    expect(
      parseModeEvent({ nodeId: 'p1', mode: 'wan-active', reason: 'cellular', atMs: 9 }),
    ).toEqual({ nodeId: 'p1', mode: 'wan-active', reason: 'cellular', atMs: 9 })
    expect(parseModeEvent({ mode: 'wan-active' })).toBeNull()
    expect(parseModeEvent({ nodeId: 'p1' })).toBeNull()
    expect(parseModeEvent(null)).toBeNull()
  })

  it('merges into snapshot and only touches the matching peer row', () => {
    const base = status({
      modes: [{ nodeId: 'p1', mode: 'lan-active', reason: null, manualWan: false, updatedAtMs: 1 }],
    })
    const next = applyModeEvent(base, 'p1', {
      nodeId: 'p1',
      mode: 'wan-active',
      reason: 'cellular',
      atMs: 5,
    })!
    expect(next.modes[0].mode).toBe('wan-active')
    expect(next.mode).toBe('wan-active')
    expect(next.reason).toBe('cellular')

    // 事件对端不是当前查看的对端：顶层不变，行照更新
    const other = applyModeEvent(base, 'p2', {
      nodeId: 'p1',
      mode: 'offline',
      reason: null,
      atMs: 6,
    })!
    expect(other.modes[0].mode).toBe('offline')
    expect(other.mode).toBe('lan-active')

    // 快照里没有的对端：补一行（模式是宿主事实，前端不筛）
    const appended = applyModeEvent(base, null, {
      nodeId: 'p9',
      mode: 'lan-probing',
      reason: null,
      atMs: 7,
    })!
    expect(appended.modes.map((row) => row.nodeId)).toEqual(['p1', 'p9'])
  })

  it('null snapshot stays null (no fabricated state)', () => {
    expect(
      applyModeEvent(null, 'p1', { nodeId: 'p1', mode: 'offline', reason: null, atMs: 1 }),
    ).toBeNull()
  })
})

describe('error mapping', () => {
  it('extracts host error codes', () => {
    expect(errorCodeOf('lan-unreachable: 内网不可达（timeout）')).toBe('lan-unreachable')
    expect(errorCodeOf('peer-offline')).toBe('peer-offline')
    expect(errorCodeOf('')).toBeNull()
    expect(errorCodeOf(undefined)).toBeNull()
  })

  it('maps known codes, leaves unknown ones visible', () => {
    expect(tunnelErrorKey('lan-unreachable: x')).toBe('hub.tunnelErrorLanUnreachable')
    expect(tunnelErrorKey('wan-disabled: allowWan=false')).toBe('hub.tunnelErrorWanDisabled')
    expect(tunnelErrorKey('tunnel-closed: 代理已关闭')).toBe('hub.tunnelErrorTunnelClosed')
    expect(tunnelErrorKey('peer-offline: 对等网络节点未启动')).toBe('hub.tunnelErrorPeerOffline')
    expect(tunnelErrorKey('not-matched: 未匹配')).toBe('hub.tunnelErrorNotMatched')
    expect(tunnelErrorKey('encryption-required: noise')).toBe('hub.tunnelErrorEncryptionRequired')
    // 未识别码 / 无码：返回 null，由调用方原样展示（不编造文案）
    expect(tunnelErrorKey('brand-new-code: detail')).toBeNull()
    expect(tunnelErrorKey('some plain text')).toBeNull()
  })
})

describe('connect arguments from QR payload', () => {
  const peer = {
    nodeId: 'peer-1',
    addrs: ['/ip4/192.168.1.9/tcp/4001/p2p/peer-1'],
    ticket: 't-1',
  }

  it('builds http tunnel args when peer is present', () => {
    expect(tunnelConnectArgs({ host: '192.168.1.9', port: 8765, peer }, 42, 'Home')).toEqual({
      nodeId: 'peer-1',
      port: 8765,
      kind: 'http',
      addrs: peer.addrs,
      pairingTicket: 't-1',
      deviceName: 'Home',
      nowMs: 42,
    })
  })

  it('returns null for v1 payloads (LAN direct path stays intact)', () => {
    expect(tunnelConnectArgs({ host: '192.168.1.9', port: 8765 }, 42)).toBeNull()
    expect(tunnelConnectArgs({ host: 'h', port: 1, peer: { ...peer, addrs: [] } }, 1)).toBeNull()
    expect(tunnelConnectArgs({ host: 'h', port: 1, peer: { ...peer, ticket: '' } }, 1)).toBeNull()
  })
})

describe('status bar view model', () => {
  it('carries mode/reason/tone and tunnel fact', () => {
    const view = buildTunnelView(status({ mode: 'wan-active', reason: 'cellular' }), true)!
    expect(view.modeKey).toBe('hub.tunnelModeWanActive')
    expect(view.reasonKey).toBe('hub.tunnelReasonCellular')
    expect(view.tone).toBe('warn')
    expect(view.manualWan).toBe(false)
    expect(view.viaTunnel).toBe(true)
    expect(view.wanOff).toBe(false)
  })

  it('flags WAN off from config facts, not from mode guessing', () => {
    expect(buildTunnelView(status({ allowWan: false }))!.wanOff).toBe(true)
    expect(buildTunnelView(status({ relayAddrsConfigured: 0 }))!.wanOff).toBe(true)
  })

  it('null status renders nothing (unknown host face)', () => {
    expect(buildTunnelView(null)).toBeNull()
  })
})

describe('connect result normalization', () => {
  it('accepts a full host result', () => {
    expect(parseConnectResult({ handle: 'tunnel-1', address: '127.0.0.1', port: 5000 })).toEqual({
      handle: 'tunnel-1',
      address: '127.0.0.1',
      port: 5000,
    })
  })

  it('rejects half results instead of connecting to 127.0.0.1:undefined', () => {
    expect(() => parseConnectResult({ handle: 'h', address: '127.0.0.1' })).toThrow()
    expect(() => parseConnectResult({ address: '127.0.0.1', port: 1 })).toThrow()
    expect(() => parseConnectResult(null)).toThrow()
  })
})
