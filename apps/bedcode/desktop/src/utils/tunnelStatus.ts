/**
 * 隧道状态投影（T07）
 *
 * 真源 = 宿主 `host-tunnel.status`（`session.tunnel.prepare` / `session.tunnel.status`
 * 命令回执）。本模块只做**纯派生**：把宿主快照折叠成一条状态栏文案 + 语气，
 * 不判断安全、不拨号、不改模式（§4.9 判定全在宿主，应用只读）。
 *
 * 判据（顺序即优先级）：
 * 1. 快照缺失（宿主无隧道面 / 命令失败）→ `unavailable`（显性，不假装「就绪」）；
 * 2. 节点未启动 → `offline`；
 * 3. 任一对端 `wan-active` → `relay`（外网中继）；
 * 4. 任一对端 `lan-active` → `direct`（内网直连）；
 * 5. 任一对端 `lan-unreachable` / `wan-unavailable` → 对应失败态（给手动出路）；
 * 6. 没有对端：未配置中继且未开外网 → `wanOff`；否则 `ready`。
 *
 * **加密永远是开着的**（不变量 12/14）：本模块不派生「是否加密」——界面上的
 * 「已加密」是常量事实，不是可切换状态。
 */

/** 宿主 `status.modes[]` 的一行（每对端传输模式） */
export interface TunnelModeRow {
  nodeId: string
  mode: string
  reason?: string | null
}

/** 宿主 `host-tunnel.status` 的应用侧投影（字段与宿主 camelCase 一致） */
export interface TunnelStatusSnapshot {
  nodeId?: string | null
  started?: boolean
  addrs?: string[]
  peerFace?: string | null
  allowWan?: boolean
  relayAddrsConfigured?: number
  reservation?: boolean
  relayState?: string | null
  relayAddr?: string | null
  relayDetail?: string | null
  exposeRules?: number
  connects?: number
  modes?: TunnelModeRow[]
}

/** 状态栏语义键（i18n 键尾段：`pairing.tunnel.<key>`） */
export type TunnelStatusKey =
  | 'direct'
  | 'relay'
  | 'ready'
  | 'lanUnreachable'
  | 'relayUnavailable'
  | 'wanOff'
  | 'offline'
  | 'unavailable'

/** 语气（决定徽标配色；与状态语义一一对应） */
export type TunnelStatusTone = 'success' | 'warning' | 'neutral' | 'danger'

export interface TunnelStatusSummary {
  key: TunnelStatusKey
  tone: TunnelStatusTone
  /** 补充说明（失败原因 / 中继明细）；无补充为 null */
  detail: string | null
}

const TONE: Record<TunnelStatusKey, TunnelStatusTone> = {
  direct: 'success',
  relay: 'success',
  ready: 'neutral',
  lanUnreachable: 'warning',
  relayUnavailable: 'warning',
  wanOff: 'neutral',
  offline: 'neutral',
  unavailable: 'danger',
}

function summary(key: TunnelStatusKey, detail: string | null = null): TunnelStatusSummary {
  return { key, tone: TONE[key], detail: detail && detail.trim() ? detail.trim() : null }
}

/**
 * 折叠成状态栏文案。
 *
 * @param status 宿主快照；null / undefined = 宿主没有隧道面或命令失败
 * @param peerError 配对 `peer` 生产失败原因（QR v2 退回 v1 时的显性原因）
 */
export function deriveTunnelStatus(
  status: TunnelStatusSnapshot | null | undefined,
  peerError?: string | null,
): TunnelStatusSummary {
  if (!status || typeof status !== 'object') {
    return summary('unavailable', peerError ?? null)
  }
  if (status.started !== true) {
    return summary('offline', peerError ?? null)
  }

  const modes = Array.isArray(status.modes) ? status.modes : []
  const has = (mode: string): boolean => modes.some((row) => row?.mode === mode)

  if (has('wan-active')) {
    return summary('relay', peerError ?? null)
  }
  if (has('wan-unavailable')) {
    return summary('relayUnavailable', peerError ?? status.relayDetail ?? null)
  }
  if (has('lan-active')) {
    return summary('direct', peerError ?? null)
  }
  if (has('lan-unreachable')) {
    return summary('lanUnreachable', peerError ?? null)
  }

  // 没有对端上下文：按「外网通道是否配置」给出就绪语义
  const relayConfigured = (status.relayAddrsConfigured ?? 0) > 0
  if (!status.allowWan && !relayConfigured) {
    return summary('wanOff', peerError ?? null)
  }
  return summary('ready', peerError ?? null)
}
