/**
 * 隧道状态栏派生 行为契约测试（T07）
 *
 * 被测：`src/utils/tunnelStatus.ts::deriveTunnelStatus`。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | T07-1 | 无隧道面 | 快照缺失 / 命令失败 | `unavailable`（不假装就绪），detail 带原因 |
 * | T07-2 | 节点未起 | `started !== true` | `offline` |
 * | T07-3 | 外网优先 | 任一 mode = `wan-active` | `relay`（即使同时有 LAN 对端） |
 * | T07-4 | 内网直连 | 任一 mode = `lan-active` | `direct` |
 * | T07-5 | 失败态 | `lan-unreachable` / `wan-unavailable` | 对应 warning 态（给手动出路） |
 * | T07-6 | 无对端 | 未开 allowWan 且未配置中继 | `wanOff` |
 * | T07-7 | 无对端 | 已配置中继 | `ready` |
 * | T07-8 | 显性原因 | peerError 优先作为 detail（QR 退回 v1 的可见原因） | detail = peerError |
 */
import { describe, it, expect } from 'vitest'
import { deriveTunnelStatus, type TunnelStatusSnapshot } from '../utils/tunnelStatus'

function snapshot(over: Partial<TunnelStatusSnapshot> = {}): TunnelStatusSnapshot {
  return {
    nodeId: '12D3KooWTarget',
    started: true,
    allowWan: true,
    relayAddrsConfigured: 1,
    reservation: true,
    relayState: 'relay-active',
    relayAddr: '/ip4/203.0.113.9/tcp/4001',
    relayDetail: '',
    exposeRules: 1,
    connects: 0,
    modes: [],
    ...over,
  }
}

describe('deriveTunnelStatus', () => {
  it('T07-1 快照缺失 = 隧道不可用（显性，不报「就绪」）', () => {
    expect(deriveTunnelStatus(null).key).toBe('unavailable')
    expect(deriveTunnelStatus(undefined).tone).toBe('danger')
    const withReason = deriveTunnelStatus(null, 'tunnel unavailable outside wasm runtime')
    expect(withReason.key).toBe('unavailable')
    expect(withReason.detail).toBe('tunnel unavailable outside wasm runtime')
  })

  it('T07-2 节点未启动 = 离线', () => {
    expect(deriveTunnelStatus(snapshot({ started: false })).key).toBe('offline')
  })

  it('T07-3 任一对端走中继 = 外网中继（外网优先于内网）', () => {
    const s = snapshot({
      modes: [
        { nodeId: 'a', mode: 'lan-active' },
        { nodeId: 'b', mode: 'wan-active', reason: 'cellular' },
      ],
    })
    const summary = deriveTunnelStatus(s)
    expect(summary.key).toBe('relay')
    expect(summary.tone).toBe('success')
  })

  it('T07-4 只有内网对端 = 内网直连', () => {
    const s = snapshot({ modes: [{ nodeId: 'a', mode: 'lan-active' }] })
    expect(deriveTunnelStatus(s).key).toBe('direct')
  })

  it('T07-5 失败态可区分：内网不可达 / 外网不可用', () => {
    const lan = deriveTunnelStatus(snapshot({ modes: [{ nodeId: 'a', mode: 'lan-unreachable' }] }))
    expect(lan.key).toBe('lanUnreachable')
    expect(lan.tone).toBe('warning')

    const wan = deriveTunnelStatus(
      snapshot({
        modes: [{ nodeId: 'a', mode: 'wan-unavailable' }],
        relayDetail: 'relay dial failed',
      }),
    )
    expect(wan.key).toBe('relayUnavailable')
    expect(wan.detail).toBe('relay dial failed')
  })

  it('T07-6/T07-7 无对端时按外网通道配置给出「已关闭 / 就绪」', () => {
    const off = deriveTunnelStatus(snapshot({ allowWan: false, relayAddrsConfigured: 0 }))
    expect(off.key).toBe('wanOff')
    expect(off.tone).toBe('neutral')

    const ready = deriveTunnelStatus(snapshot())
    expect(ready.key).toBe('ready')
  })

  it('T07-8 peerError 优先作为 detail（QR 退回 v1 的可见原因）', () => {
    const s = snapshot({ modes: [{ nodeId: 'a', mode: 'lan-active' }] })
    const summary = deriveTunnelStatus(s, 'tunnel node addrs unavailable')
    expect(summary.key).toBe('direct')
    expect(summary.detail).toBe('tunnel node addrs unavailable')
  })

  it('脏数据不 panic：缺 modes / 缺字节字段按缺省处理', () => {
    const summary = deriveTunnelStatus({} as TunnelStatusSnapshot)
    expect(summary.key).toBe('offline')
    const noModes = deriveTunnelStatus({ started: true } as TunnelStatusSnapshot)
    expect(noModes.key).toBe('wanOff')
  })
})
