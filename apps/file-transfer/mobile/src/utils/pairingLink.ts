/**
 * 配对载荷工具（file-transfer，移动端）
 *
 * 本文件承载两类载荷：
 *
 * 1. 设备二维码 v3（`wasmnest://pair/`）：nodeId + 可拨地址 + 展示名。
 *    **入口已下线**（2026-11-16 形态改造）：扫码添加 / 我的设备二维码不再有
 *    界面消费方，生成与解析仅保留兼容（旧快照与历史载荷不失效）。
 * 2. 穿透配置分享 v1（`wasmnest://relay-config/`）：设置页扫码导入，只写本机
 *    relay 配置，不建立设备信任。
 *
 * 设备发现主路径是中继会合 + mDNS。
 *
 * 桌面 / 移动端各持一份（与双端同构的既有做法一致，刻意不跨应用耦合
 * 源码）；改动字段口径时两处一起改。
 */

/** 设备二维码解析后的形状（导入后落 paired 缓存） */
export interface RemotePeerLink {
  /** 宿主已验证的 peer 节点 id（64 位小写 hex） */
  nodeId: string
  /** 多地址候选（LAN 直连在前、relay circuit 在后；顺序即拨号顺序） */
  addrs: string[]
  /** 一次性配对票据（file-transfer 自身不消费，仅保留形状；不落盘） */
  ticket: string | null
  /** 载荷自带展示名时使用（空串 = 由界面按短指纹展示） */
  deviceName: string
}

/** 设备二维码前缀（v3；保留兼容，界面已无生成 / 扫码入口） */
export const PAIR_URI_PREFIX = 'wasmnest://pair/'

/** 载荷版本（v3 = 设备连接串） */
export const PAIR_URI_VERSION = 3

/** 设备二维码载荷输入（保留兼容） */
export interface DeviceLinkInput {
  nodeId: string
  addrs: string[]
  deviceName?: string
}

/** 设备二维码解析失败原因（界面按此分文案） */
export type RemotePeerLinkError = 'malformed' | 'incomplete' | 'address-invalid'

export type RemotePeerLinkResult =
  { ok: true; link: RemotePeerLink } | { ok: false; reason: RemotePeerLinkError }

/** 64 位小写 hex（引擎 node_id = 公钥指纹） */
const NODE_ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * 地址是否可拨号：multiaddr 形态、无空白、不是未指定地址。
 * 内网直连候选是 `/ip4/<ip>/tcp/<port>`（目标身份由 `nodeId` 给出）。
 */
function isDialableAddr(addr: string): boolean {
  return (
    addr.startsWith('/') &&
    !/\s/.test(addr) &&
    !addr.includes('/ip4/0.0.0.0') &&
    !addr.includes('/ip6/::')
  )
}

/** 生成设备二维码载荷；非法入参显性抛错（不得展示坏码） */
export function buildRemotePeerLink(input: DeviceLinkInput): string {
  const nodeId = (input.nodeId ?? '').trim().toLowerCase()
  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new Error('buildRemotePeerLink: invalid nodeId')
  }
  const addrs: string[] = []
  for (const item of input.addrs ?? []) {
    const addr = (item ?? '').trim()
    if (!isDialableAddr(addr)) {
      throw new Error(`buildRemotePeerLink: invalid address: ${addr}`)
    }
    if (!addrs.includes(addr)) addrs.push(addr)
  }
  if (addrs.length === 0) {
    throw new Error('buildRemotePeerLink: at least one address is required')
  }
  const payload: Record<string, unknown> = { v: PAIR_URI_VERSION, nodeId, addrs }
  const deviceName = (input.deviceName ?? '').trim()
  if (deviceName) payload.deviceName = deviceName
  return `${PAIR_URI_PREFIX}${encodeBase64UrlUtf8(JSON.stringify(payload))}`
}

/** 解析设备二维码 / 连接串文本 */
export function parseRemotePeerLink(text: unknown): RemotePeerLinkResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'malformed' }
  let jsonText = text.trim()
  if (jsonText.startsWith('wasmnest://')) {
    if (!jsonText.startsWith(PAIR_URI_PREFIX)) return { ok: false, reason: 'malformed' }
    const decoded = decodeBase64UrlUtf8(jsonText.slice(PAIR_URI_PREFIX.length).trim())
    if (decoded === null) return { ok: false, reason: 'malformed' }
    jsonText = decoded
  }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' }
  }
  const obj = raw as Record<string, unknown>
  // 未知版本不猜语义（v1 载荷没有 peer 信息，无法当作远程设备）
  if (obj.v !== undefined && obj.v !== 2 && obj.v !== 3) {
    return { ok: false, reason: 'malformed' }
  }

  // 兼容 v2 包装形态 `{v:2,…,peer}` 与扁平形态
  const peerRaw =
    obj.peer && typeof obj.peer === 'object' && !Array.isArray(obj.peer)
      ? (obj.peer as Record<string, unknown>)
      : obj

  const nodeId = typeof peerRaw.nodeId === 'string' ? peerRaw.nodeId.trim().toLowerCase() : ''
  if (!NODE_ID_PATTERN.test(nodeId)) return { ok: false, reason: 'incomplete' }

  const addrsRaw = peerRaw.addrs
  if (!Array.isArray(addrsRaw) || addrsRaw.length === 0) {
    return { ok: false, reason: 'incomplete' }
  }
  const addrs: string[] = []
  for (const item of addrsRaw) {
    if (typeof item !== 'string') return { ok: false, reason: 'address-invalid' }
    const addr = item.trim()
    if (!isDialableAddr(addr)) return { ok: false, reason: 'address-invalid' }
    if (!addrs.includes(addr)) addrs.push(addr)
  }

  const ticketRaw = peerRaw.ticket
  const ticket = typeof ticketRaw === 'string' && ticketRaw.trim() !== '' ? ticketRaw.trim() : null

  const nameRaw = peerRaw.deviceName ?? peerRaw.name
  const deviceName = typeof nameRaw === 'string' ? nameRaw.trim() : ''

  return { ok: true, link: { nodeId, addrs, ticket, deviceName } }
}

/** UTF-8 文本 → base64url（与解析端对称；载荷很小，一次编码足够） */
function encodeBase64UrlUtf8(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → UTF-8 文本；非法编码 / 非 UTF-8 返回 null */
function decodeBase64UrlUtf8(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 空间码判据（与核内 `normalize_relay_room` 同口径：1–64 位 `[A-Za-z0-9_-]`） */
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 展示名上限（仅展示、不参与寻址；超长截断而不是让整份分享失效） */
const INVITE_NAME_MAX = 64

/**
 * relay 端点判据（与核内 `settings::normalize_relay_addrs` 同口径）：
 * `<transport>/tcp/<port>/p2p/<relay>`，禁 circuit 拨号目标与未指定地址。
 */
function isRelayEndpointAddr(addr: string): boolean {
  return (
    addr.startsWith('/') &&
    !/\s/.test(addr) &&
    addr.includes('/tcp/') &&
    addr.includes('/p2p/') &&
    !addr.includes('/p2p-circuit') &&
    !addr.includes('/ip4/0.0.0.0') &&
    !addr.includes('/ip6/::')
  )
}

/** 展示名归一：去控制字符、trim、超长截断（截断只影响展示，不影响解析成败） */
function normalizeInviteName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .trim()
  return cleaned.length > INVITE_NAME_MAX ? cleaned.slice(0, INVITE_NAME_MAX) : cleaned
}

/** 两组 relay 端点是否等价（顺序无关、忽略空项；中心与缓存冲突判定用） */
export function sameRelaySet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map((x) => x.trim()).filter(Boolean))
  const right = new Set(b.map((x) => x.trim()).filter(Boolean))
  if (left.size !== right.size) return false
  for (const addr of left) {
    if (!right.has(addr)) return false
  }
  return true
}

// ==================== 穿透配置分享（v1） ====================
//
// 只回答「本机接入外网用哪台中继」（relay 端点 + 空间码 + 对外网策略），
// 不含 nodeId / 长期密钥 / 票据。扫码导入只写本机 relay 配置，不建立设备
// 信任——信任仍走首连确认。

/** 穿透配置分享前缀 */
export const RELAY_CONFIG_URI_PREFIX = 'wasmnest://relay-config/'

/** 载荷版本（未知版本拒绝，不猜语义） */
export const RELAY_CONFIG_VERSION = 1

/** 载荷 kind（防止把其它 `wasmnest://` 载荷误当配置） */
export const RELAY_CONFIG_KIND = 'ft-relay-config'

/** 对外网策略（只表达「本机允许经中继拨号」，不是授权） */
export type RelayWanPolicy = 'allowed' | 'blocked'

/** 穿透配置分享载荷（v1） */
export interface RelayConfigShare {
  /** relay 端点（至少一条；不得是 circuit 拨号目标） */
  relayAddrs: string[]
  /** 空间码（非空时导入端一并对齐，否则两端可能互相不可见） */
  room: string
  /** 生成方是否允许经中继拨号（导入端只展示，不静默改本机开关） */
  wanPolicy: RelayWanPolicy
  /** 生成方展示名（可选，仅展示） */
  deviceName: string
  /** 生成时刻（Unix 毫秒；0 = 未提供） */
  generatedAt: number
}

/** 解析失败原因（界面按此分文案，不合并成「无效配置」） */
export type RelayConfigShareError =
  'malformed' | 'version-unsupported' | 'missing-relay' | 'address-invalid'

export type RelayConfigShareResult =
  { ok: true; share: RelayConfigShare } | { ok: false; reason: RelayConfigShareError }

/** 是否为穿透配置分享文本（入口分流用；只判前缀，不保证一定可解析） */
export function isRelayConfigShare(text: unknown): boolean {
  return typeof text === 'string' && text.trim().startsWith(RELAY_CONFIG_URI_PREFIX)
}

/**
 * 生成穿透配置分享二维码载荷。
 *
 * 非法 room / relay / 策略显性抛错——调用方不得展示坏码（解析端同判据拒绝）。
 * `generatedAt` 缺省取当前时刻；载荷只用于展示新鲜度，不参与过期判定。
 */
export function buildRelayConfigShare(input: {
  relayAddrs: readonly string[]
  room?: string
  wanPolicy?: RelayWanPolicy
  deviceName?: string
  generatedAt?: number
}): string {
  const relayAddrs: string[] = []
  for (const item of input.relayAddrs ?? []) {
    const addr = (item ?? '').trim()
    if (!isRelayEndpointAddr(addr)) {
      throw new Error(`buildRelayConfigShare: invalid relay address: ${addr}`)
    }
    if (!relayAddrs.includes(addr)) relayAddrs.push(addr)
  }
  if (relayAddrs.length === 0) {
    throw new Error('buildRelayConfigShare: at least one relay address is required')
  }
  const room = (input.room ?? '').trim()
  if (room !== '' && !ROOM_PATTERN.test(room)) {
    throw new Error('buildRelayConfigShare: invalid room')
  }
  const wanPolicy: RelayWanPolicy = input.wanPolicy === 'blocked' ? 'blocked' : 'allowed'
  const payload: Record<string, unknown> = {
    v: RELAY_CONFIG_VERSION,
    kind: RELAY_CONFIG_KIND,
    relayAddrs,
    wanPolicy,
    deviceName: normalizeInviteName(input.deviceName),
    generatedAt:
      typeof input.generatedAt === 'number' && Number.isFinite(input.generatedAt)
        ? Math.max(0, Math.trunc(input.generatedAt))
        : Date.now(),
  }
  // 空间码为空时省略（空 = relay-wide，等价语义，不必占二维码容量）
  if (room !== '') payload.room = room
  return `${RELAY_CONFIG_URI_PREFIX}${encodeBase64UrlUtf8(JSON.stringify(payload))}`
}

/**
 * 解析穿透配置分享（`wasmnest://relay-config/<base64url>` 或纯 JSON 文本）。
 *
 * 失败必须显性：版本不认 / 载荷不合法 / relay 地址为空或不可拨号分别给 reason，
 * 不静默保存半份配置。
 */
export function parseRelayConfigShare(text: unknown): RelayConfigShareResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'malformed' }
  let jsonText = text.trim()
  if (jsonText.startsWith('wasmnest://')) {
    if (!jsonText.startsWith(RELAY_CONFIG_URI_PREFIX)) return { ok: false, reason: 'malformed' }
    const decoded = decodeBase64UrlUtf8(jsonText.slice(RELAY_CONFIG_URI_PREFIX.length).trim())
    if (decoded === null) return { ok: false, reason: 'malformed' }
    jsonText = decoded
  }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.v !== RELAY_CONFIG_VERSION) return { ok: false, reason: 'version-unsupported' }
  if (obj.kind !== RELAY_CONFIG_KIND) return { ok: false, reason: 'malformed' }

  const relayRaw = obj.relayAddrs
  if (!Array.isArray(relayRaw) || relayRaw.length === 0) {
    return { ok: false, reason: 'missing-relay' }
  }
  const relayAddrs: string[] = []
  for (const item of relayRaw) {
    if (typeof item !== 'string') return { ok: false, reason: 'address-invalid' }
    const addr = item.trim()
    if (!isRelayEndpointAddr(addr)) return { ok: false, reason: 'address-invalid' }
    if (!relayAddrs.includes(addr)) relayAddrs.push(addr)
  }

  const room = typeof obj.room === 'string' ? obj.room.trim() : ''
  if (room !== '' && !ROOM_PATTERN.test(room)) return { ok: false, reason: 'malformed' }

  const wanPolicy = obj.wanPolicy
  if (wanPolicy !== 'allowed' && wanPolicy !== 'blocked') {
    return { ok: false, reason: 'malformed' }
  }

  const generatedAt =
    typeof obj.generatedAt === 'number' && Number.isFinite(obj.generatedAt)
      ? Math.max(0, Math.trunc(obj.generatedAt))
      : 0

  return {
    ok: true,
    share: {
      relayAddrs,
      room,
      wanPolicy,
      deviceName: normalizeInviteName(obj.deviceName),
      generatedAt,
    },
  }
}
