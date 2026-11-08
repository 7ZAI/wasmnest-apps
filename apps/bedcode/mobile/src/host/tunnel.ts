/**
 * 隧道客户端状态投影（T09）
 * -----------------------------------------------------------------------------
 * 机制在宿主 `host-tunnel`（LAN 优先 / §4.9 模式判定 / 回环代理 / 一次性票据），
 * 本模块只做**纯映射**：宿主事实（`tunnel.status` 投影 + `peer:mode` 等总线事件）
 * → 界面可渲染的视图模型。所有判定（要不要切外网、能不能手动尝试）都在宿主，
 * 前端不重算、不猜测、不把未知模式当成「内网直连」。
 *
 * 口径：
 * - 未知模式 → `hub.tunnelModeUnknown`（显性），不静默当 `lan-active`；
 * - 「尝试外网」入口只在宿主说 `lan-unreachable` 且确实具备外网条件时出现
 *   （`allowWan` + 已配置 relay 地址）——否则点了必然 `wan-disabled`，等于骗点击；
 * - 错误按宿主错误码映射文案（码前缀即语义），未识别的码原样展示（fail-visible）。
 */

/** 隧道/传输事件 → 前端事件名（与 rust `tunnel::EVENT_TUNNEL` 同源） */
export const TUNNEL_EVENT = 'bedcode-tunnel-event'

/** 宿主 §4.9 八态（`wasmnest-server-peer-net::tunnel::mode::TransferMode`） */
export const TUNNEL_MODES = [
  'pairing',
  'lan-probing',
  'lan-active',
  'lan-unreachable',
  'wan-connecting',
  'wan-active',
  'wan-unavailable',
  'offline',
] as const

export type TunnelMode = (typeof TUNNEL_MODES)[number]

/** 每对端模式投影（宿主 `status.modes[i]`） */
export interface PeerModeRow {
  nodeId: string
  mode: string
  reason: string | null
  manualWan: boolean
  updatedAtMs: number
}

/** 对端记录（插件 KV；不含 LAN 地址） */
export interface PeerTarget {
  nodeId: string
  deviceName: string
  relayAddrs: string[]
  /** 目标逻辑端口（桌面业务端口；手动「尝试外网」重建拨号入参用） */
  port: number
  lastMode: string | null
  lastReason: string | null
  updatedAtMs: number
}

/** 宿主 `status` 的应用侧视图（`bedcode.tunnel-status` 返回值） */
export interface TunnelStatus {
  nodeId: string | null
  started: boolean
  addrs: string[]
  allowWan: boolean
  relayAddrsConfigured: number
  reservation: boolean
  relayState: string | null
  relayAddr: string | null
  relayDetail: string | null
  connects: number
  modes: PeerModeRow[]
  mode: string | null
  reason: string | null
  targets: PeerTarget[]
}

/** 模式 → i18n key（八态全映射；未知显性） */
const MODE_KEYS: Record<string, string> = {
  pairing: 'hub.tunnelModePairing',
  'lan-probing': 'hub.tunnelModeLanProbing',
  'lan-active': 'hub.tunnelModeLanActive',
  'lan-unreachable': 'hub.tunnelModeLanUnreachable',
  'wan-connecting': 'hub.tunnelModeWanConnecting',
  'wan-active': 'hub.tunnelModeWanActive',
  'wan-unavailable': 'hub.tunnelModeWanUnavailable',
  offline: 'hub.tunnelModeOffline',
}

export function modeLabelKey(mode: string | null | undefined): string {
  if (!mode) return 'hub.tunnelModeUnknown'
  return MODE_KEYS[mode] ?? 'hub.tunnelModeUnknown'
}

/** 归因 → i18n key（未知归因不展示，不编造解释） */
const REASON_KEYS: Record<string, string> = {
  cellular: 'hub.tunnelReasonCellular',
  'different-subnet': 'hub.tunnelReasonDifferentSubnet',
  'no-lan-candidate': 'hub.tunnelReasonNoLanCandidate',
  'host-unreachable': 'hub.tunnelReasonHostUnreachable',
  user: 'hub.tunnelReasonUser',
  'wan-disabled': 'hub.tunnelReasonWanDisabled',
  'relay-unavailable': 'hub.tunnelReasonRelayUnavailable',
  'lan-restored': 'hub.tunnelReasonLanRestored',
  'network-changed': 'hub.tunnelReasonNetworkChanged',
}

export function reasonLabelKey(reason: string | null | undefined): string | null {
  if (!reason) return null
  return REASON_KEYS[reason] ?? null
}

export type ModeTone = 'ok' | 'warn' | 'error' | 'muted'

/** 模式 → 视觉档（颜色只是提示，文字才是判据） */
export function modeTone(mode: string | null | undefined): ModeTone {
  switch (mode) {
    case 'lan-active':
      return 'ok'
    case 'wan-active':
      return 'warn'
    case 'lan-unreachable':
      return 'error'
    case 'wan-unavailable':
    case 'offline':
      return 'muted'
    case 'pairing':
    case 'lan-probing':
    case 'wan-connecting':
      return 'muted'
    default:
      return 'muted'
  }
}

/** 是否可以给出「尝试外网」入口（判据全在宿主事实里） */
export function shouldOfferManualWan(status: TunnelStatus | null): boolean {
  if (!status) return false
  return status.mode === 'lan-unreachable' && status.allowWan && status.relayAddrsConfigured > 0
}

/** 从 `peer:mode` / `tunnel:state` 事件载荷解析出对端模式更新（无则 null） */
export interface TunnelModeEvent {
  nodeId: string
  mode: string
  reason: string | null
  atMs: number
}

export function parseModeEvent(payload: unknown): TunnelModeEvent | null {
  if (!payload || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const nodeId = typeof row.nodeId === 'string' ? row.nodeId.trim() : ''
  const mode = typeof row.mode === 'string' ? row.mode : ''
  if (!nodeId || !mode) return null
  return {
    nodeId,
    mode,
    reason: typeof row.reason === 'string' ? row.reason : null,
    atMs: typeof row.atMs === 'number' ? row.atMs : 0,
  }
}

/**
 * 把模式事件并入状态快照（纯函数）
 *
 * 只改该对端那一行与顶层 `mode` / `reason`（当事件对端 = 当前查看的对端）。
 * 事件是宿主事实；快照里没有该对端时补一行（模式由宿主判定，前端不筛）。
 */
export function applyModeEvent(
  status: TunnelStatus | null,
  nodeId: string | null,
  event: TunnelModeEvent,
): TunnelStatus | null {
  if (!status) return status
  const modes = status.modes.slice()
  const index = modes.findIndex((row) => row.nodeId === event.nodeId)
  const row: PeerModeRow = {
    nodeId: event.nodeId,
    mode: event.mode,
    reason: event.reason,
    manualWan: index >= 0 ? modes[index].manualWan : false,
    updatedAtMs: event.atMs,
  }
  if (index >= 0) modes[index] = row
  else modes.push(row)
  const isCurrent = !!nodeId && nodeId === event.nodeId
  return {
    ...status,
    modes,
    mode: isCurrent ? event.mode : status.mode,
    reason: isCurrent ? event.reason : status.reason,
  }
}

/** 宿主错误码 → i18n key（码前缀即语义；未识别码由调用方原样展示） */
const ERROR_KEYS: Record<string, string> = {
  'lan-unreachable': 'hub.tunnelErrorLanUnreachable',
  'relay-unreachable': 'hub.tunnelErrorRelayUnreachable',
  'wan-disabled': 'hub.tunnelErrorWanDisabled',
  'peer-offline': 'hub.tunnelErrorPeerOffline',
  'tunnel-closed': 'hub.tunnelErrorTunnelClosed',
  'tunnel-idle': 'hub.tunnelErrorTunnelClosed',
  'not-matched': 'hub.tunnelErrorNotMatched',
  'ticket-expired': 'hub.tunnelErrorTicketExpired',
  'port-not-exposed': 'hub.tunnelErrorPortNotExposed',
  'tunnel-limit': 'hub.tunnelErrorLimit',
  'tunnel-unavailable': 'hub.tunnelErrorUnavailable',
  'proxy-bind-failed': 'hub.tunnelErrorProxyBind',
  'not-owner': 'hub.tunnelErrorNotOwner',
  'encryption-required': 'hub.tunnelErrorEncryptionRequired',
  'encryption-unsupported': 'hub.tunnelErrorEncryptionRequired',
}

/** 从宿主错误串里取错误码（形如 `lan-unreachable: 内网不可达…`） */
export function errorCodeOf(message: unknown): string | null {
  const text = String(message ?? '').trim()
  if (!text) return null
  const match = /^([a-z][a-z-]*)/.exec(text)
  return match ? match[1] : null
}

/**
 * 宿主错误 → 展示文案 key
 *
 * 已知码映射到域内文案；未知/无码返回 null（调用方原样展示错误串——fail-visible，
 * 不把没见过的失败包装成「连接失败，请重试」）。
 */
export function tunnelErrorKey(message: unknown): string | null {
  const code = errorCodeOf(message)
  if (!code) return null
  return ERROR_KEYS[code] ?? null
}

/** 状态栏视图模型（组件只渲染，不自己拼判据） */
export interface TunnelStatusView {
  /** 模式文案 key（未知也是 key，不静默丢弃） */
  modeKey: string
  /** 归因文案 key（无归因 / 未知 → null） */
  reasonKey: string | null
  tone: ModeTone
  /** 是否展示「尝试外网」入口 */
  manualWan: boolean
  /** 外网通道被关闭 / 未配置中继（与模式无关的配置事实） */
  wanOff: boolean
  /** 有通道句柄 = 当前连接确实经隧道（旧 LAN 直连为 false） */
  viaTunnel: boolean
}

/** 宿主状态 → 状态栏视图（`viaTunnel` 由调用方给：句柄是应用侧事实） */
export function buildTunnelView(
  status: TunnelStatus | null,
  viaTunnel = false,
): TunnelStatusView | null {
  if (!status) return null
  return {
    modeKey: modeLabelKey(status.mode),
    reasonKey: reasonLabelKey(status.reason),
    tone: modeTone(status.mode),
    manualWan: shouldOfferManualWan(status),
    wanOff: !status.allowWan || status.relayAddrsConfigured === 0,
    viaTunnel,
  }
}

/** 从 QR v2 载荷的 `peer` 构造拨号入参（无 `peer` → null，走旧 LAN 直连路径） */
export interface TunnelConnectArgs {
  nodeId: string
  port: number
  kind: 'http'
  addrs: string[]
  pairingTicket: string
  deviceName: string
  nowMs: number
}

export function tunnelConnectArgs(
  payload: {
    host?: string
    port: number
    peer?: { nodeId: string; addrs: string[]; ticket: string }
  },
  nowMs: number,
  deviceName = 'Desktop',
): TunnelConnectArgs | null {
  const peer = payload.peer
  if (!peer || !peer.nodeId || peer.addrs.length === 0 || !peer.ticket) return null
  return {
    nodeId: peer.nodeId,
    port: payload.port,
    kind: 'http',
    addrs: peer.addrs.slice(),
    pairingTicket: peer.ticket,
    deviceName,
    nowMs,
  }
}

/** 连接目标：本地回环代理地址（`connectDevice` 的 address/port） */
export interface TunnelProxyTarget {
  handle: string
  address: string
  port: number
}

/**
 * 归一 `bedcode.tunnel-connect` 回执
 *
 * 回执缺 `handle` / `address` / `port` 一律显性失败：拿着半个回执去连
 * 会变成「连到 127.0.0.1:undefined」这种难排的错误。
 */
export function parseConnectResult(result: unknown): TunnelProxyTarget {
  const row = (result ?? {}) as Record<string, unknown>
  const handle = typeof row.handle === 'string' ? row.handle : ''
  const address = typeof row.address === 'string' ? row.address : ''
  const port = typeof row.port === 'number' ? row.port : 0
  if (!handle || !address || !port) {
    throw new Error('tunnel-connect: malformed result (handle/address/port)')
  }
  return { handle, address, port }
}
