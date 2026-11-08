/**
 * 配对载荷组装（T08：QR v2）
 *
 * 契约真源：设计 §4.3「QR v2（推荐路径）」——在既有 `{host, port, token}` 上追加
 * `peer`（`nodeId` + 多地址 + 一次性传输票据），旧版移动端忽略未知字段仍走 LAN。
 * 本模块只做**纯组装与校验**，不接触宿主：`peer` 由宿主 `host-tunnel.status` /
 * `issue-pairing-ticket` 提供（T06 落地后由插件后端透传，见 ticket T08）。
 *
 * 判据：
 * - 无 `peer`（当前后端尚未提供）→ 原样输出 v1 载荷，字节级兼容旧移动端；
 * - 有 `peer` 但字段不完整 / 地址不可拨号 → **显性失败**（抛
 *   {@link PairingPayloadError}），禁止静默退回 v1：静默降级会让新桌面把
 *   「本可走隧道」的配对退回明文 LAN 入口，属于不变量 6/9 禁止的静默降级。
 *
 * 两种输出共用同一载荷：{@link buildQrPayload}（二维码文本）与
 * {@link buildPairUri}（`wasmnest://pair/<base64url>` 连接串，无摄像头场景）。
 */

/**
 * 连接串前缀（无摄像头场景与 QR 共用同一载荷）
 *
 * 解析端真源：`apps/bedcode/mobile/src/host/qr.ts::PAIR_URI_PREFIX`（同一字面）。
 */
export const PAIR_URI_PREFIX = 'wasmnest://pair/'

/** 对端节点信息（QR v2 `peer` 字段；宿主 `host-tunnel` 状态投影） */
export interface PairingPeerInfo {
  /** peer 节点 id（宿主已验证；应用不得信任客户端自报值——本字段只用于渲染/拨号） */
  nodeId: string
  /** 同一节点的多地址（LAN 直连在前、relay 在后；顺序由宿主决定，本模块不改序） */
  addrs: string[]
  /** 一次性配对票据（TTL ≤ 120s，绑定目标端口；不落日志） */
  ticket: string
}

/** 载荷输入（`session.qr.generate` / `session.qr.info` 回执的可序列化投影） */
export interface PairingPayloadInput {
  host: string
  port: number
  token: string
  /** 缺省 / null = 后端尚未提供 peer 信息 → 输出 v1 载荷 */
  peer?: PairingPeerInfo | null
}

/** 显性失败原因（决定界面文案；不静默回退 v1） */
export type PairingPayloadErrorReason = 'peer-incomplete' | 'peer-address-invalid'

/** 配对载荷组装失败（字段缺 / 多地址不可拨号） */
export class PairingPayloadError extends Error {
  readonly reason: PairingPayloadErrorReason

  constructor(reason: PairingPayloadErrorReason, message: string) {
    super(message)
    this.name = 'PairingPayloadError'
    this.reason = reason
  }
}

/**
 * 归一并校验 `peer`：缺省返回 null（v1 路径）；给了就必须完整且可拨号。
 *
 * 地址判据（与移动端解析同口径）：multiaddr 以 `/` 开头、不含空白与未指定地址
 * （`/ip4/0.0.0.0`）、且带 `/p2p/` 目标段。多网卡去重保序（LAN 在前不被重排）。
 */
function normalizePeer(peer: PairingPeerInfo | null | undefined): PairingPeerInfo | null {
  if (peer === undefined || peer === null) return null

  const nodeId = typeof peer.nodeId === 'string' ? peer.nodeId.trim() : ''
  const ticket = typeof peer.ticket === 'string' ? peer.ticket.trim() : ''
  if (!nodeId || !ticket) {
    throw new PairingPayloadError(
      'peer-incomplete',
      'peer info incomplete (nodeId / ticket required for QR v2)',
    )
  }

  if (!Array.isArray(peer.addrs) || peer.addrs.length === 0) {
    throw new PairingPayloadError('peer-incomplete', 'peer info incomplete (addrs required)')
  }
  const addrs = peer.addrs.map((addr) => (typeof addr === 'string' ? addr.trim() : ''))
  for (const addr of addrs) {
    if (!addr.startsWith('/') || /\s/.test(addr) || addr.includes('/ip4/0.0.0.0')) {
      throw new PairingPayloadError(
        'peer-address-invalid',
        `peer address is not dialable: ${addr || '<empty>'}`,
      )
    }
    if (!addr.includes('/p2p/')) {
      throw new PairingPayloadError(
        'peer-address-invalid',
        `peer address missing /p2p/ target: ${addr}`,
      )
    }
  }

  return { nodeId, addrs: [...new Set(addrs)], ticket }
}

/**
 * 组装二维码载荷文本（JSON）。
 *
 * 有完整 `peer` → `{v:2, host, port, token, peer}`；否则 → `{host, port, token}`
 * （字段顺序与旧实现一致，保证旧移动端与既有快照不受影响）。
 *
 * @throws {PairingPayloadError} `peer` 存在但缺字段 / 地址不可拨号
 */
export function buildQrPayload(input: PairingPayloadInput): string {
  const peer = normalizePeer(input.peer)
  if (!peer) {
    return JSON.stringify({ host: input.host, port: input.port, token: input.token })
  }
  return JSON.stringify({
    v: 2,
    host: input.host,
    port: input.port,
    token: input.token,
    peer,
  })
}

/**
 * UTF-8 文本 → base64url（无 padding）。
 *
 * 走 `TextEncoder` + `btoa`：载荷含中文路径/设备名时不至于 `btoa` 抛
 * `InvalidCharacterError`；去掉 padding 与 `+/` 换形，保证可安全粘贴进任意
 * 输入框 / URL 查询串。
 */
function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 组装连接串 `wasmnest://pair/<base64url(json)>`（无摄像头场景的配对入口）。
 *
 * 与 {@link buildQrPayload} 同载荷、同校验（含 peer 残缺的显性失败）；
 * 只承载一次性 token 与一次性票据，不放任何长期密钥（不变量 13）。
 *
 * @throws {PairingPayloadError} `peer` 存在但缺字段 / 地址不可拨号
 */
export function buildPairUri(input: PairingPayloadInput): string {
  return PAIR_URI_PREFIX + toBase64Url(buildQrPayload(input))
}
