/**
 * 二维码配对载荷解析（票 2026-10-09：旧宿主 ScanPanel 的载荷契约迁入插件）
 * -----------------------------------------------------------------------------
 * 旧实现（`src/components/ScanPanel.vue`）区分两种无效：
 *   · JSON 解析失败 → `mobile.scan.invalidQr`（「二维码无效」）
 *   · 解析成功但 `host/port/token` 缺失 → `mobile.scan.invalidQrData`（「信息不完整」）
 * 本模块保留这一区分（`reason`），抽为纯函数以便单测锁定契约（不依赖相机/DOM）。
 *
 * 有意收紧一处：旧实现只判「三字段非空」，端口非数字要到连接阶段才失败；此处要求
 * 端口可归一为**正整数**，无效载荷在扫码时即判为 `incomplete`（错误更早、更贴近用户操作）。
 *
 * 版本兼容（设计 §4.3）：
 *   · 无 `v` / `v:1` → 旧载荷，忽略未知字段（`peer` 不参与判定），走 LAN 直连；
 *   · `v:2` → `{v,host,port,token,peer:{nodeId,addrs[],ticket}}`，`peer` 必须完整且
 *     地址可拨号，否则 `incomplete`（fail-visible，不静默降级）；
 *   · `v:3` → 紧凑载荷 `{v,h,p,t,n,a[],tk}`（2026-11-13）：`nodeId` 只出现一次，
 *     `a` 是**拨号前缀**（完整 multiaddr 去掉尾部 `/p2p/<n>`），`"@"` 代表与 `h:p`
 *     完全相同的那条 LAN 地址；本模块负责拼回完整 multiaddr，语义与 v2 等价；
 *     **桌面只在「地址尾部 id === `n`」时才发 v3**（2026-11-14）：真实宿主里
 *     `node.nodeId` 是应用层指纹（64 hex），地址尾部是 libp2p PeerId，两者不同 ⇒
 *     桌面退回 v2 完整地址形状。所以 v2 不是遗留路径，而是当前宿主的主路径；
 *   · 其他 `v` → `malformed`（未知版本不猜测语义）。
 * `peer` 只描述传输层（nodeId + 多地址 + 一次性票据），不含长期密钥。
 *
 * v3 的压缩判据：`apps/bedcode/desktop/src/utils/pairingPayload.ts`（组装侧同判据），
 * 跨端等价性由 `__tests__/scanIntegration.test.ts` 用桌面真实载荷闭环锁定。
 */

/** 对端节点信息（QR `peer` 字段） */
export interface QrPeerInfo {
  /** 宿主已验证的 peer 节点 id（应用侧只用于拨号/展示，不做信任判定） */
  nodeId: string
  /** 同一节点的多地址：LAN 直连在前、relay 在后（顺序由桌面宿主决定） */
  addrs: string[]
  /** 一次性配对票据（TTL ≤ 120s）；只用于首次配对 */
  ticket: string
}

/** 桌面端二维码载荷（v1 `{host, port, token}`；v2/v3 追加 `peer`） */
export interface QrPayload {
  host: string
  port: number
  token: string
  peer?: QrPeerInfo
}

/** 解析结果：成功带载荷；失败带原因（决定展示文案） */
export type QrParseResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: 'malformed' | 'incomplete' }

/** 连接串前缀（与 QR 共用载荷；无摄像头场景用） */
const PAIR_URI_PREFIX = 'wasmnest://pair/'

/** v3 `a` 中代表「与载荷 `h:p` 完全相同的那条 LAN 地址」的占位符 */
const SAME_ENDPOINT_PREFIX = '@'

/** IPv4 字面量：`"@"` 只能展开成 `/ip4/<host>/tcp/<port>`，非 IPv4 的 host 不成立 */
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** 端口归一：数字或纯数字字符串 → 正整数（≤65535）；其余 → null */
function normalizePort(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isInteger(num) || num <= 0 || num > 65535) return null
  return num
}

/** 完整 multiaddr 的可拨判据（与桌面组装侧同口径） */
function isDialableAddr(addr: string): boolean {
  return (
    addr.startsWith('/') && !/\s/.test(addr) && !addr.includes('/ip4/0.0.0.0') && addr.includes('/p2p/')
  )
}

/**
 * base64url → UTF-8 文本；非法编码 / 非 UTF-8 返回 null（由调用方判 malformed）。
 * 手写归一而不是依赖第三方库：连接串是纯文本协议，避免为 20 行引入依赖。
 */
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
 * 若文本是 `wasmnest://pair/…` 连接串则解出 JSON 文本；否则原样返回。
 * 前缀命中但解码失败 → null（调用方判 `malformed`，不把坏连接串当 6 位码）。
 */
function unwrapPairUri(text: string): string | null {
  if (!text.startsWith('wasmnest://')) return text
  if (!text.startsWith(PAIR_URI_PREFIX)) return null
  return decodeBase64UrlUtf8(text.slice(PAIR_URI_PREFIX.length).trim())
}

/**
 * 归一 v2 `peer`：字段必须齐全，地址必须是可拨号的 multiaddr。
 * 校验口径与桌面组装侧一致（`apps/bedcode/desktop/src/utils/pairingPayload.ts`）：
 * 以 `/` 开头、无空白、不含未指定地址 `/ip4/0.0.0.0`、带 `/p2p/` 目标段。
 */
function normalizePeer(raw: unknown): QrPeerInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { nodeId, addrs, ticket } = raw as Record<string, unknown>
  if (typeof nodeId !== 'string' || !nodeId.trim()) return null
  if (typeof ticket !== 'string' || !ticket.trim()) return null
  if (!Array.isArray(addrs) || addrs.length === 0) return null

  const normalized: string[] = []
  for (const item of addrs) {
    if (typeof item !== 'string') return null
    const addr = item.trim()
    if (!isDialableAddr(addr)) return null
    normalized.push(addr)
  }
  return {
    nodeId: nodeId.trim(),
    addrs: [...new Set(normalized)],
    ticket: ticket.trim(),
  }
}

/**
 * v3 拨号前缀 → 完整 multiaddr 列表（拼回尾部 `/p2p/<nodeId>`）。
 *
 * 规则（与桌面组装侧同判据）：
 * - `"@"` = `/ip4/<h>/tcp/<p>`，仅当 `h` 是 IPv4 字面量（桌面只在逐字相等时写它）；
 * - 其余前缀以 `/` 开头，且**不得**已含 `/p2p/<nodeId>`（否则拼出双目标段）；
 * - 拼出的完整地址再按 v2 同口径校验，去重保序（LAN 在前不被重排）。
 *
 * 任一条不满足返回 null → 调用方判 `incomplete`（不猜、不跳过坏地址）。
 */
function expandV3Addrs(
  raw: unknown,
  nodeId: string,
  host: string,
  port: number,
): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  const addrs: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const entry = item.trim()

    let prefix: string
    if (entry === SAME_ENDPOINT_PREFIX) {
      if (!IPV4_LITERAL.test(host)) return null
      prefix = `/ip4/${host}/tcp/${port}`
    } else if (entry.startsWith('/')) {
      prefix = entry
    } else {
      return null
    }

    if (prefix.includes(`/p2p/${nodeId}`)) return null
    const addr = `${prefix}/p2p/${nodeId}`
    if (!isDialableAddr(addr)) return null
    if (!addrs.includes(addr)) addrs.push(addr)
  }
  return addrs
}

/** v3 `peer` 归一：`{n,a,tk}` → 与 v2 同形的 `QrPeerInfo` */
function normalizePeerV3(
  nodeIdRaw: unknown,
  addrsRaw: unknown,
  ticketRaw: unknown,
  host: string,
  port: number,
): QrPeerInfo | null {
  const nodeId = typeof nodeIdRaw === 'string' ? nodeIdRaw.trim() : ''
  const ticket = typeof ticketRaw === 'string' ? ticketRaw.trim() : ''
  if (!nodeId || !ticket) return null

  const addrs = expandV3Addrs(addrsRaw, nodeId, host, port)
  if (!addrs) return null
  return { nodeId, addrs, ticket }
}

/**
 * 解析二维码 / 连接串文本为连接载荷。
 *
 * @returns `{ok:true,payload}` 合法；`{ok:false,reason:'malformed'}` JSON 非法/非对象/
 *          未知版本/坏连接串；`{ok:false,reason:'incomplete'}` 解析成功但字段缺失、
 *          类型不符或 peer 不可用
 */
export function parseQrText(decodedText: unknown): QrParseResult {
  if (typeof decodedText !== 'string' || !decodedText.trim()) {
    return { ok: false, reason: 'malformed' }
  }

  const jsonText = unwrapPairUri(decodedText.trim())
  if (jsonText === null) return { ok: false, reason: 'malformed' }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' }
  }

  const record = raw as Record<string, unknown>
  const { v } = record
  if (v !== undefined && v !== 1 && v !== 2 && v !== 3) {
    // 未知版本：宁可判无效，也不按旧版语义猜测（可能把 v4 的新字段当旧版用）
    return { ok: false, reason: 'malformed' }
  }

  // v3 用短键（h/p/t），v1/v2 用长键；三字段语义完全相同
  const isV3 = v === 3
  const host = isV3 ? record.h : record.host
  const port = isV3 ? record.p : record.port
  const token = isV3 ? record.t : record.token

  if (typeof host !== 'string' || !host.trim()) return { ok: false, reason: 'incomplete' }
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'incomplete' }

  const normalizedPort = normalizePort(port)
  if (normalizedPort === null) return { ok: false, reason: 'incomplete' }

  const payload: QrPayload = { host: host.trim(), port: normalizedPort, token }
  if (isV3) {
    const normalizedPeer = normalizePeerV3(
      record.n,
      record.a,
      record.tk,
      payload.host,
      normalizedPort,
    )
    if (!normalizedPeer) return { ok: false, reason: 'incomplete' }
    payload.peer = normalizedPeer
  } else if (v === 2) {
    const normalizedPeer = normalizePeer(record.peer)
    if (!normalizedPeer) return { ok: false, reason: 'incomplete' }
    payload.peer = normalizedPeer
  }
  return { ok: true, payload }
}
