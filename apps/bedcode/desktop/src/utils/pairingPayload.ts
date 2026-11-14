/**
 * 配对载荷组装（T08：QR v2；2026-11-13 起 v3 紧凑编码）
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
 *
 * ## v3：只为把二维码变小（2026-11-13）
 *
 * v2 的典型载荷（LAN + relay 两条地址、真实 64 hex 票据）是 479 字符 / 85 模块，
 * 按「每模块 ≥4 CSS px」的画布硬下限要撑到 356px（见 `utils/qrRender.ts` 头注）。
 * v3 不改变语义，只删掉移动端可推导的重复（判据：`apps/bedcode/mobile/src/host/qr.ts`
 * 的 v3 解析逐字段还原，且有跨端集成用例锁住等价性）：
 *
 * - 字段名缩写：`host→h`、`port→p`、`token→t`、`peer.nodeId→n`、`addrs→a`、`ticket→tk`；
 * - `nodeId` 全载荷只出现一次：`a` 存**拨号前缀**（完整地址去掉尾部 `/p2p/<nodeId>`），
 *   解析侧统一再拼回；relay 前缀保留 `/p2p/<relayId>/p2p-circuit`（拨号必需）；
 * - 与 `h:p` 完全相同的那条 LAN 前缀记为 `"@"`（**逐字相等才替换**，不按地址类型推测）。
 *
 * 实测（ECC M，LAN 端口与 `h:p` 相同→`"@"`）：479 → 314 字符 / 85 → 69 模块 /
 * 画布 356 → 292px；仅 LAN 时 216 字符 / 61 模块 / 260px；多网卡三地址 73 模块。
 * 旧桌面仍发 v2、新桌面只发 v3，移动端保留 v1/v2 解析路径（回滚与降级不炸）。
 */

/**
 * 连接串前缀（无摄像头场景与 QR 共用同一载荷）
 *
 * 解析端真源：`apps/bedcode/mobile/src/host/qr.ts::PAIR_URI_PREFIX`（同一字面）。
 */
export const PAIR_URI_PREFIX = 'wasmnest://pair/'

/** v3 载荷版本（v1 = 无版本字段的三字段旧形状；v2 = 本轮之前的 peer 形状） */
const PAYLOAD_VERSION = 3

/** `a` 中代表「与载荷 `h:p` 完全相同的那条 LAN 地址」的占位符 */
export const SAME_ENDPOINT_PREFIX = '@'

/** 对端节点信息（QR `peer` 字段；宿主 `host-tunnel` 状态投影） */
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

/** 归一后的 peer：`addrs` 已转成 v3 拨号前缀（含 `"@"` 占位） */
interface NormalizedPeer {
  nodeId: string
  addrs: string[]
  ticket: string
}

/**
 * 完整 multiaddr 的可拨判据（与移动端解析同口径）：
 * 以 `/` 开头、无空白、不是未指定地址、带 `/p2p/` 目标段。
 */
function isDialableAddr(addr: string): boolean {
  return (
    addr.startsWith('/') && !/\s/.test(addr) && !addr.includes('/ip4/0.0.0.0') && addr.includes('/p2p/')
  )
}

/**
 * 完整 multiaddr → v3 拨号前缀（去掉尾部 `/p2p/<nodeId>`）。
 *
 * 只接受**以本节点 id 结尾**的地址：v3 靠「前缀 + `/p2p/<n>`」还原，
 * 结尾不是本节点就无法还原（例如宿主投影出错），必须显性失败而不是猜。
 */
function dialPrefixOf(addr: string, nodeId: string): string {
  const suffix = `/p2p/${nodeId}`
  if (!addr.endsWith(suffix)) {
    throw new PairingPayloadError(
      'peer-address-invalid',
      `peer address missing /p2p/ target: ${addr}`,
    )
  }
  const prefix = addr.slice(0, -suffix.length)
  if (!prefix) {
    throw new PairingPayloadError('peer-address-invalid', `peer address has no transport: ${addr}`)
  }
  return prefix
}

/**
 * 归一并校验 `peer`：缺省返回 null（v1 路径）；给了就必须完整且可拨号。
 *
 * 地址判据：完整地址先按 [`isDialableAddr`] 校验，再折叠成 v3 拨号前缀；
 * 多网卡去重保序（LAN 在前不被重排），与 `h:p` 逐字相同的前缀记为 `"@"`。
 */
function normalizePeer(
  peer: PairingPeerInfo | null | undefined,
  host: string,
  port: number,
): NormalizedPeer | null {
  if (peer === undefined || peer === null) return null

  const nodeId = typeof peer.nodeId === 'string' ? peer.nodeId.trim() : ''
  const ticket = typeof peer.ticket === 'string' ? peer.ticket.trim() : ''
  if (!nodeId || !ticket) {
    throw new PairingPayloadError(
      'peer-incomplete',
      'peer info incomplete (nodeId / ticket required for QR v3)',
    )
  }

  if (!Array.isArray(peer.addrs) || peer.addrs.length === 0) {
    throw new PairingPayloadError('peer-incomplete', 'peer info incomplete (addrs required)')
  }
  // 先按完整地址去重（保留宿主给出的顺序），再折叠成前缀
  const fullAddrs: string[] = []
  for (const raw of peer.addrs) {
    const addr = typeof raw === 'string' ? raw.trim() : ''
    if (!isDialableAddr(addr)) {
      throw new PairingPayloadError(
        'peer-address-invalid',
        `peer address is not dialable: ${addr || '<empty>'}`,
      )
    }
    if (!fullAddrs.includes(addr)) fullAddrs.push(addr)
  }

  const hostPrefix = `/ip4/${host}/tcp/${port}`
  const addrs: string[] = []
  for (const addr of fullAddrs) {
    const prefix = dialPrefixOf(addr, nodeId)
    const compact = prefix === hostPrefix ? SAME_ENDPOINT_PREFIX : prefix
    if (!addrs.includes(compact)) addrs.push(compact)
  }

  return { nodeId, addrs, ticket }
}

/**
 * 组装二维码载荷文本（JSON）。
 *
 * 有完整 `peer` → v3 `{v:3, h, p, t, n, a, tk}`；否则 → `{host, port, token}`
 * （字段顺序与旧实现一致，保证旧移动端与既有快照不受影响）。
 *
 * @throws {PairingPayloadError} `peer` 存在但缺字段 / 地址不可拨号
 */
export function buildQrPayload(input: PairingPayloadInput): string {
  const peer = normalizePeer(input.peer, input.host, input.port)
  if (!peer) {
    return JSON.stringify({ host: input.host, port: input.port, token: input.token })
  }
  return JSON.stringify({
    v: PAYLOAD_VERSION,
    h: input.host,
    p: input.port,
    t: input.token,
    n: peer.nodeId,
    a: peer.addrs,
    tk: peer.ticket,
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
