/**
 * 远程设备连接串解析（T12）
 *
 * 契约（设计 §4.3 / T12 验收）：
 * - 输入形态二选一：`wasmnest://pair/<base64url(json)>` 连接串，或纯 JSON 文本；
 * - 载荷只承载**连接所需**信息：`nodeId`（宿主已验证的 peer 身份）、`addrs`
 *   （同一节点的多地址，LAN 直连在前、relay 在后）、可选 `ticket`（一次性配对
 *   票据，TTL ≤ 120s）；**不含长期密钥**（不变量 13）；
 * - 兼容三种形态：自持 v3 `{v:3, nodeId, addrs}`、QR v2 包装
 *   `{v:2, host, port, token, peer:{…}}`、扁平 `{nodeId, addrs, …}`（同一套
 *   字段判据，不猜未知版本）。
 *
 * 失败必须显性（返回 reason，由界面给可操作文案）：连接串坏 / 字段缺失 /
 * 地址不可拨号三种分开报，不静默退化成「什么也没发生」。
 *
 * 桌面 / 移动端各持一份（与双端同构的既有做法一致，刻意不跨应用耦合
 * 源码）；改动字段口径时两处一起改。
 */

/** 连接串前缀（无摄像头场景粘贴用） */
export const PAIR_URI_PREFIX = 'wasmnest://pair/'

/** 连接串载荷版本（v3 = file-transfer 自持「我的设备」；v2 = 旧 QR 兼容） */
export const PAIR_URI_VERSION = 3

/** 解析成功后的远程设备信息 */
export interface RemotePeerLink {
  /** 宿主已验证的 peer 节点 id（64 位小写 hex） */
  nodeId: string
  /** 多地址候选（LAN 直连在前、relay circuit 在后；顺序即拨号顺序） */
  addrs: string[]
  /** 一次性配对票据（file-transfer 自身不消费，仅保留形状；不落盘） */
  ticket: string | null
  /** 载荷自带展示名时使用（QR v2 通常没有；空串 = 由界面按短指纹展示） */
  deviceName: string
}

/** 「我的设备」生成连接串的输入（宿主 node-info + 设备展示名） */
export interface DeviceLinkInput {
  nodeId: string
  addrs: string[]
  deviceName?: string
}

/** 解析失败原因（决定界面文案） */
export type RemotePeerLinkError = 'malformed' | 'incomplete' | 'address-invalid'

/** 解析结果 */
export type RemotePeerLinkResult =
  { ok: true; link: RemotePeerLink } | { ok: false; reason: RemotePeerLinkError }

/** 64 位小写 hex（引擎 node_id = 公钥指纹；与 `parseFoundPayload` 同口径） */
const NODE_ID_PATTERN = /^[0-9a-f]{64}$/

/** UTF-8 文本 → base64url（与解析端对称；连接串载荷很小，一次编码足够） */
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

/**
 * 地址是否可拨号：multiaddr 形态、无空白、不是未指定地址。
 *
 * 刻意**不要求** `/p2p/`：内网直连候选是 `/ip4/<ip>/tcp/<port>`（目标身份由
 * `nodeId` 单独给出）；relay circuit 候选自带 `/p2p-circuit/p2p/<target>`。
 */
function isDialableAddr(addr: string): boolean {
  return (
    addr.startsWith('/') &&
    !/\s/.test(addr) &&
    !addr.includes('/ip4/0.0.0.0') &&
    !addr.includes('/ip6/::')
  )
}

/**
 * 生成 `wasmnest://pair/<base64url>` 连接串（file-transfer 自持「我的设备」）。
 *
 * 入参来自宿主 node-info：nodeId + 可拨 addrs（LAN 在前、relay circuit 在后）。
 * 不合法入参显性抛错——调用方不得把残缺链接展示给用户（解析端同判据拒绝）。
 */
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

/** 解析二维码 / 连接串文本为远程设备信息 */
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

  // 兼容两种包装：QR v2 的 `peer` 子对象 / 扁平字段
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

/** 是否为经 relay 的候选地址（与核内 `dial::is_relay_addr` 同标记） */
export function isRelayCandidate(addr: string): boolean {
  return addr.includes('/p2p-circuit')
}

/** 从候选表里拆出 relay 候选（界面「尝试外网」可用性判据） */
export function relayCandidatesOf(addrs: readonly string[] | undefined): string[] {
  return (addrs ?? []).filter((a) => isRelayCandidate(a))
}
