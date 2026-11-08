/**
 * 中继地址导入载荷（T14）——`wasmnest-relay print-addrs` 的消费方契约
 *
 * 产出方真源（能力仓 `wasmnest-relay/src/addrs.rs`）：
 * - `print-addrs --json`：`{ v, kind, relay_version, peer_id, peer_id_sha256,
 *   control_protocol, addrs, access: { mode }, quota: { max_circuit_bytes,
 *   max_circuit_duration_secs } }`（snake_case；地址已带 `/p2p/<relayPeerId>`）；
 * - `print-addrs`（无 `--json`）：每行一个地址，随后 `peerId:` / `peerIdSha256:` /
 *   `access:` / `controlProtocol:` 四行元数据。
 *
 * 本模块只做**结构与身份校验**，不联网、不落存储：
 * - 载荷版本只认 `v=1`（未来版本显性拒绝，不猜字段语义）；
 * - PeerId 必须能解出 ed25519 公钥（libp2p base58 + identity multihash +
 *   protobuf key），并用同一派生口径本地复算指纹（不信任载荷自报值）；
 * - 地址只接受「主机 + TCP + `/p2p/<peerId>`」的 relay 基础地址；带
 *   `/p2p-circuit` 的是拨号目标，不是中继地址，直接拒绝；
 * - 二维码在本卡片里按**文本形态**处理：其内容就是这份 JSON（桌面无摄像头，
 *   扫码结果粘贴进来即可）。
 *
 * 导入成功后的落点见 `useRelaySettings`（插件 KV `network.relay`，字段
 * `relayAddrs`），供 T07/T12 的 WAN 拨号与模式判定读取。
 */

/** 产出方载荷版本（`IMPORT_PAYLOAD_VERSION`） */
export const RELAY_IMPORT_VERSION = 1
/** 载荷类型标识（`IMPORT_PAYLOAD_KIND`） */
export const RELAY_IMPORT_KIND = 'wasmnest-relay'
/** relay 控制协议名（`CONTROL_PROTOCOL`）；版本不匹配即显性拒绝 */
export const RELAY_CONTROL_PROTOCOL = '/wasmnest/relay-control/1'

/** 准入模式（只读提示：是否要另发 enrollment token） */
export type RelayAccessMode = 'open' | 'allowlist'
/** 导入来源：JSON / 文本（两种形态的字段校验强度不同） */
export type RelayImportSource = 'json' | 'text'

/** 配额摘要（只保留客户端需要知道的字段） */
export interface RelayQuota {
  maxCircuitBytes: number
  maxCircuitDurationSecs: number
}

/** 解析后的中继配置（字段命名 = 本仓前端 camelCase，wire 保持 snake_case） */
export interface RelayImport {
  /** 可拨地址（已含 `/p2p/<peerId>`，顺序保持产出方顺序） */
  relayAddrs: string[]
  /** 中继 PeerId（base58） */
  peerId: string
  /** 指纹：sha256(ed25519 公钥) 十六进制——本地从 PeerId 复算 */
  peerIdSha256: string
  /** 准入模式；文本形态未给时为 null（不猜） */
  accessMode: RelayAccessMode | null
  /** 中继版本；只有 JSON 形态带 */
  relayVersion: string | null
  /** 控制协议名；文本形态未给时为 null */
  controlProtocol: string | null
  /** 配额；只有 JSON 形态带 */
  quota: RelayQuota | null
  /** 导入来源 */
  source: RelayImportSource
}

/** 解析失败原因（组件按 key 取文案；detail 只放安全的短片段） */
export type RelayImportErrorKey =
  | 'relay.error.empty'
  | 'relay.error.json'
  | 'relay.error.version'
  | 'relay.error.kind'
  | 'relay.error.peerId'
  | 'relay.error.fingerprintMissing'
  | 'relay.error.fingerprintMismatch'
  | 'relay.error.controlProtocol'
  | 'relay.error.addrs'
  | 'relay.error.addrShape'
  | 'relay.error.addrPeer'
  | 'relay.error.multiPeer'
  | 'relay.error.metadata'
  | 'relay.error.access'
  | 'relay.error.quota'
  | 'relay.error.line'
  | 'relay.error.crypto'

/** 解析结果 */
export type RelayImportParseResult =
  { ok: true; value: RelayImport } | { ok: false; errorKey: RelayImportErrorKey; detail?: string }

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_INDEX: Record<string, number> = Object.fromEntries(
  [...BASE58_ALPHABET].map((char, index) => [char, index]),
)
/** base58 输入上限（ed25519 PeerId = 52 字符；留足余量，拒绝畸形长串） */
const MAX_BASE58_LENGTH = 128
/** 单次导入的地址上限（产出方通常只给 1–2 条） */
const MAX_RELAY_ADDRS = 16
/** 十六进制指纹长度（sha256） */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

/** 本地从 PeerId 复算的 ed25519 身份 */
export interface RelayPeerIdentity {
  /** 原始 32 字节 ed25519 公钥 */
  publicKey: Uint8Array
  /** sha256(公钥) 十六进制（小写） */
  fingerprint: string
}

/**
 * base58 解码（Bitcoin 字母表；`1` = 前导零字节）
 *
 * 用 BigInt 实现（PeerId 只有 38 字节，性能不是瓶颈）；畸形字符返回 null。
 */
export function base58Decode(text: string): Uint8Array | null {
  if (!text || text.length > MAX_BASE58_LENGTH) return null
  let leadingZeros = 0
  while (leadingZeros < text.length && text[leadingZeros] === '1') leadingZeros += 1
  let value = 0n
  for (const char of text) {
    const digit = BASE58_INDEX[char]
    if (digit === undefined) return null
    value = value * 58n + BigInt(digit)
  }
  const body: number[] = []
  while (value > 0n) {
    body.push(Number(value % 256n))
    value /= 256n
  }
  body.reverse()
  return Uint8Array.from([...Array<number>(leadingZeros).fill(0), ...body])
}

/**
 * 解出 ed25519 PeerId 的原始公钥
 *
 * 结构：identity multihash（`0x00` + 长度 `0x24`）+ protobuf PublicKey
 * （`08 01` = Ed25519，`12 20` = 32 字节 Data）。非该结构（RSA / secp256k1 /
 * CIDv1 base32 / 畸形串）一律 null。
 */
export function decodeEd25519PeerId(peerId: string): Uint8Array | null {
  const decoded = base58Decode(peerId)
  if (!decoded || decoded.length !== 38) return null
  if (decoded[0] !== 0x00 || decoded[1] !== 0x24) return null
  const proto = decoded.subarray(2)
  if (proto.length !== 36) return null
  if (proto[0] !== 0x08 || proto[1] !== 0x01 || proto[2] !== 0x12 || proto[3] !== 0x20) return null
  return proto.subarray(4)
}

/** sha256 十六进制（WebCrypto；缺失时返回 null，由调用方显性失败） */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 从 PeerId 复算指纹（与能力仓 `RelayIdentity::fingerprint` 同口径）
 *
 * 失败返回 null：畸形 PeerId / 非 ed25519 / 运行环境无 WebCrypto。
 */
export async function resolvePeerIdentity(peerId: string): Promise<RelayPeerIdentity | null> {
  const publicKey = decodeEd25519PeerId(peerId)
  if (!publicKey) return null
  const fingerprint = await sha256Hex(publicKey)
  if (!fingerprint) return null
  return { publicKey, fingerprint }
}

/** IPv4 字面量（拒绝前导零，避免 `010.0.0.1` 这类歧义写法） */
function isIpv4(text: string): boolean {
  const parts = text.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255 && String(value) === part
  })
}

/** IPv6 字面量（借 URL 解析器判合法性；拒绝 zone id） */
function isIpv6(text: string): boolean {
  if (!text.includes(':') || text.includes('%')) return false
  try {
    new URL(`http://[${text}]/`)
    return true
  } catch {
    return false
  }
}

/** 域名（DNS 标签；不做单标签限制——`relay` 这类内网名也合法） */
function isDomain(text: string): boolean {
  if (!text || text.length > 253) return false
  if (!/^[a-zA-Z0-9.-]+$/.test(text)) return false
  return text
    .split('.')
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'),
    )
}

/** TCP 端口（1–65535） */
function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}

type RelayAddrParse = { ok: true; peerId: string } | { ok: false; errorKey: RelayImportErrorKey }

/**
 * 解析单条 relay 基础地址
 *
 * 允许：`/ip4|ip6|dns|dns4|dns6/<主机>/tcp/<端口>/p2p/<peerId>`；
 * 拒绝：缺段、额外段（含 `/p2p-circuit`、`/ws`）、端口越界、非 ed25519 PeerId。
 */
export function parseRelayAddr(addr: string): RelayAddrParse {
  const text = addr.trim()
  if (!text || !text.startsWith('/') || text.endsWith('/') || /\s/.test(text)) {
    return { ok: false, errorKey: 'relay.error.addrShape' }
  }
  const parts = text.split('/').slice(1)
  if (parts.length !== 6) return { ok: false, errorKey: 'relay.error.addrShape' }
  const [hostProto, host, tcpProto, portText, p2pProto, peerId] = parts
  if (tcpProto !== 'tcp' || p2pProto !== 'p2p') {
    return { ok: false, errorKey: 'relay.error.addrShape' }
  }
  if (!['ip4', 'ip6', 'dns', 'dns4', 'dns6'].includes(hostProto)) {
    return { ok: false, errorKey: 'relay.error.addrShape' }
  }
  if (hostProto === 'ip4' && !isIpv4(host)) return { ok: false, errorKey: 'relay.error.addrShape' }
  if (hostProto === 'ip6' && !isIpv6(host)) return { ok: false, errorKey: 'relay.error.addrShape' }
  if (hostProto !== 'ip4' && hostProto !== 'ip6' && !isDomain(host)) {
    return { ok: false, errorKey: 'relay.error.addrShape' }
  }
  if (parsePort(portText) === null) return { ok: false, errorKey: 'relay.error.addrShape' }
  if (!decodeEd25519PeerId(peerId)) return { ok: false, errorKey: 'relay.error.peerId' }
  return { ok: true, peerId }
}

type NormalizedAddrs =
  | { ok: true; relayAddrs: string[]; peerId: string }
  | { ok: false; errorKey: RelayImportErrorKey; detail?: string }

/**
 * 校验一组地址：必须同属一个 relay PeerId；与期望 PeerId 不符即拒绝
 *
 * 地址顺序保持产出方顺序（§4.9 的拨号顺序由产出方/用户决定，本层不排序）。
 */
function normalizeAddrs(rawAddrs: string[], expectedPeerId: string | null): NormalizedAddrs {
  if (rawAddrs.length === 0) return { ok: false, errorKey: 'relay.error.addrs' }
  if (rawAddrs.length > MAX_RELAY_ADDRS) return { ok: false, errorKey: 'relay.error.addrs' }
  const seen = new Set<string>()
  const relayAddrs: string[] = []
  let peerId: string | null = null
  for (const raw of rawAddrs) {
    const parsed = parseRelayAddr(raw)
    if (!parsed.ok) return { ...parsed, detail: raw.slice(0, 120) }
    if (peerId !== null && parsed.peerId !== peerId) {
      return { ok: false, errorKey: 'relay.error.multiPeer' }
    }
    peerId = parsed.peerId
    const canonical = raw.trim()
    if (!seen.has(canonical)) {
      seen.add(canonical)
      relayAddrs.push(canonical)
    }
  }
  if (!peerId) return { ok: false, errorKey: 'relay.error.addrs' }
  if (expectedPeerId !== null && peerId !== expectedPeerId) {
    return { ok: false, errorKey: 'relay.error.addrPeer', detail: peerId }
  }
  return { ok: true, relayAddrs, peerId }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 校验 access.mode（JSON 形态） */
function parseAccessMode(value: unknown): RelayAccessMode | null {
  const record = asRecord(value)
  const mode = record?.mode
  return mode === 'open' || mode === 'allowlist' ? mode : null
}

/** 校验 quota（JSON 形态） */
function parseQuota(value: unknown): RelayQuota | null {
  const record = asRecord(value)
  if (!record) return null
  const bytes = record.max_circuit_bytes
  const duration = record.max_circuit_duration_secs
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return null
  if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 0) return null
  return { maxCircuitBytes: bytes, maxCircuitDurationSecs: duration }
}

async function parseJsonPayload(text: string): Promise<RelayImportParseResult> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errorKey: 'relay.error.json' }
  }
  const payload = asRecord(raw)
  if (!payload) return { ok: false, errorKey: 'relay.error.json' }

  if (payload.v !== RELAY_IMPORT_VERSION) {
    return {
      ok: false,
      errorKey: 'relay.error.version',
      detail: payload.v === undefined ? undefined : `v=${String(payload.v)}`,
    }
  }
  if (payload.kind !== RELAY_IMPORT_KIND) {
    return {
      ok: false,
      errorKey: 'relay.error.kind',
      detail: typeof payload.kind === 'string' ? payload.kind.slice(0, 60) : undefined,
    }
  }
  const peerId = payload.peer_id
  if (typeof peerId !== 'string' || !decodeEd25519PeerId(peerId)) {
    return { ok: false, errorKey: 'relay.error.peerId' }
  }
  const identity = await resolvePeerIdentity(peerId)
  if (!identity) return { ok: false, errorKey: 'relay.error.crypto' }

  const claimedFingerprint = payload.peer_id_sha256
  if (
    typeof claimedFingerprint !== 'string' ||
    !FINGERPRINT_PATTERN.test(claimedFingerprint.toLowerCase())
  ) {
    return { ok: false, errorKey: 'relay.error.fingerprintMissing' }
  }
  if (claimedFingerprint.toLowerCase() !== identity.fingerprint) {
    return { ok: false, errorKey: 'relay.error.fingerprintMismatch' }
  }

  if (payload.control_protocol !== RELAY_CONTROL_PROTOCOL) {
    return {
      ok: false,
      errorKey: 'relay.error.controlProtocol',
      detail:
        typeof payload.control_protocol === 'string'
          ? payload.control_protocol.slice(0, 80)
          : undefined,
    }
  }

  const rawAddrs = payload.addrs
  if (!Array.isArray(rawAddrs) || !rawAddrs.every((item) => typeof item === 'string')) {
    return { ok: false, errorKey: 'relay.error.addrs' }
  }
  const normalized = normalizeAddrs(rawAddrs as string[], peerId)
  if (!normalized.ok) return normalized

  const accessMode = parseAccessMode(payload.access)
  if (accessMode === null) return { ok: false, errorKey: 'relay.error.access' }

  let quota: RelayQuota | null = null
  if (payload.quota !== undefined) {
    quota = parseQuota(payload.quota)
    if (quota === null) return { ok: false, errorKey: 'relay.error.quota' }
  }

  const relayVersion =
    typeof payload.relay_version === 'string' ? payload.relay_version.slice(0, 40) : null

  return {
    ok: true,
    value: {
      relayAddrs: normalized.relayAddrs,
      peerId,
      peerIdSha256: identity.fingerprint,
      accessMode,
      relayVersion,
      controlProtocol: RELAY_CONTROL_PROTOCOL,
      quota,
      source: 'json',
    },
  }
}

async function parseTextPayload(text: string): Promise<RelayImportParseResult> {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const addrs: string[] = []
  const meta = new Map<string, string>()
  for (const [index, line] of lines.entries()) {
    if (!line) continue
    const match = /^(peerId|peerIdSha256|access|controlProtocol)\s*:\s*(\S.*)$/.exec(line)
    if (match) {
      const key = match[1]
      const value = match[2].trim()
      const previous = meta.get(key)
      if (previous !== undefined && previous !== value) {
        return {
          ok: false,
          errorKey: 'relay.error.metadata',
          detail: `${key}（第 ${index + 1} 行）`,
        }
      }
      meta.set(key, value)
      continue
    }
    if (line.startsWith('/')) {
      addrs.push(line)
      continue
    }
    return { ok: false, errorKey: 'relay.error.line', detail: line.slice(0, 80) }
  }

  const metaPeerId = meta.get('peerId') ?? null
  if (metaPeerId !== null && !decodeEd25519PeerId(metaPeerId)) {
    return { ok: false, errorKey: 'relay.error.peerId', detail: metaPeerId.slice(0, 60) }
  }
  const normalized = normalizeAddrs(addrs, metaPeerId)
  if (!normalized.ok) return normalized

  const identity = await resolvePeerIdentity(normalized.peerId)
  if (!identity) return { ok: false, errorKey: 'relay.error.crypto' }

  const claimedFingerprint = meta.get('peerIdSha256')
  if (claimedFingerprint !== undefined) {
    if (!FINGERPRINT_PATTERN.test(claimedFingerprint.toLowerCase())) {
      return { ok: false, errorKey: 'relay.error.fingerprintMismatch' }
    }
    if (claimedFingerprint.toLowerCase() !== identity.fingerprint) {
      return { ok: false, errorKey: 'relay.error.fingerprintMismatch' }
    }
  }

  const controlProtocol = meta.get('controlProtocol') ?? null
  if (controlProtocol !== null && controlProtocol !== RELAY_CONTROL_PROTOCOL) {
    return {
      ok: false,
      errorKey: 'relay.error.controlProtocol',
      detail: controlProtocol.slice(0, 80),
    }
  }

  const accessText = meta.get('access')
  let accessMode: RelayAccessMode | null = null
  if (accessText !== undefined) {
    if (accessText !== 'open' && accessText !== 'allowlist') {
      return { ok: false, errorKey: 'relay.error.access', detail: accessText.slice(0, 40) }
    }
    accessMode = accessText
  }

  return {
    ok: true,
    value: {
      relayAddrs: normalized.relayAddrs,
      peerId: normalized.peerId,
      peerIdSha256: identity.fingerprint,
      accessMode,
      relayVersion: null,
      controlProtocol,
      quota: null,
      source: 'text',
    },
  }
}

/**
 * 解析导入文本（JSON 载荷 / `print-addrs` 文本 / 多地址）
 *
 * 二维码内容就是 JSON 文本，因此扫码结果直接走 JSON 分支。
 */
export async function parseRelayImport(text: string): Promise<RelayImportParseResult> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, errorKey: 'relay.error.empty' }
  if (trimmed.startsWith('{')) return parseJsonPayload(trimmed)
  return parseTextPayload(trimmed)
}

/**
 * 生成给二维码/复制用的标准载荷（字段与产出方 `print-addrs --json` 同形）
 *
 * 只把**已知**字段写进去：文本形态缺 `controlProtocol` 时不伪造控制协议名，
 * 消费方按 `v/kind/peer_id/peer_id_sha256/addrs` 即能完成身份与寻址校验。
 */
export function buildRelayImportPayload(value: RelayImport): Record<string, unknown> {
  return {
    v: RELAY_IMPORT_VERSION,
    kind: RELAY_IMPORT_KIND,
    ...(value.relayVersion ? { relay_version: value.relayVersion } : {}),
    peer_id: value.peerId,
    peer_id_sha256: value.peerIdSha256,
    ...(value.controlProtocol ? { control_protocol: value.controlProtocol } : {}),
    addrs: [...value.relayAddrs],
    ...(value.accessMode ? { access: { mode: value.accessMode } } : {}),
    ...(value.quota
      ? {
          quota: {
            max_circuit_bytes: value.quota.maxCircuitBytes,
            max_circuit_duration_secs: value.quota.maxCircuitDurationSecs,
          },
        }
      : {}),
  }
}
