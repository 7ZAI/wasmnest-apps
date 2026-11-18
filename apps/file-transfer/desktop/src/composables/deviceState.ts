/**
 * 设备状态派生 — 无头纯函数（无 Vue / 插件运行时依赖，可独立直测）
 *
 * 把发现缓存快照与三份连接态记录（握手中集合 / 已连接集合 / 拨号失败表）
 * 归并为设备行列表：connected > connecting > idle 优先级归并，拨号失败
 * 仅在非连接态呈现；活跃对端标记要求已连接。组件只消费派生结果，
 * 编排 composable（usePeerDevices）负责维护输入。
 *
 * T20：拨号失败改成**分类 token**（`DialFailureCode`）而不是「不可达」一刀切，
 * 前端据此给可操作出路（仅经中继 / 打开中继设置 / 重新添加设备）；未识别的
 * 错误保留原文（`detail`），**不猜**成 LAN / WAN / 成功（fail-visible）。
 */

/** 发现的对端条目（mdns:found 事件派生 + 快照恢复的 camelCase 子集） */
export interface DiscoveredDevice {
  /** 完整节点 ID（64 位小写 hex，兼作指纹展示源） */
  nodeId: string
  /** 设备名（TXT `name`；缺失回退实例名末段） */
  deviceName: string
  /** 对端监听地址（IPv4，不带端口），缺失时留空 */
  addr?: string
  /** 对端监听端口（endpoint 拨号三元组） */
  port?: number
  /** 是否具备文件传输能力（缺省视为具备，兼容旧载荷/种子） */
  fileTransfer?: boolean
  /** 能力位图小写 hex（bit0 = 文件传输）；与 fileTransfer 双轨兼容 */
  capabilitiesHex?: string
  /** mDNS 实例全名（lost 事件按它寻源移除） */
  instanceName?: string
  /** 最近被发现时刻（前端 Date.now 盖章；快照恢复时为历史值） */
  lastSeenMs?: number
  /** 快照恢复标记：未被实时事件刷新前展示「最近可见」且不参与自动清扫 */
  restored?: boolean
  /** 配对/历史保留的多地址候选（LAN 直连在前、relay circuit 在后） */
  addrs?: string[]
  /** 手动添加的远程设备：无 mDNS 发现，TTL 清扫不得移除（T12） */
  paired?: boolean
  /**
   * 中继会合发现（跨 NAT）：宿主经中继控制面拿到的设备。
   *
   * 没有 LAN 心跳，由宿主 25s 快照续期；快照不再包含时移除（除非同时有 mDNS
   * 证据 / 已配对 / 已连接）。这类条目只有 circuit 候选，没有 addr/port。
   */
  relay?: boolean
  /**
   * 上次连接成功时宿主上报的传输形态（T20；断开后保留）
   *
   * 用途：行内显示「上次：外网中继」；下次连接默认把 relay 纳入候选
   * （LAN 仍优先，见 `connect` 注释）。未知形态不显示。
   */
  lastTransport?: TransportKind
}

/** 在线缓存 TTL：与引擎 PEER_DISCOVERY_TTL 同值（120s 广播周期口径） */
export const DEVICE_TTL_MS = 120_000

/**
 * 快照恢复窗口判定：仅恢复「近期可见」条目（真实 lastSeen 在 TTL 窗口内）。
 *
 * 陈旧条目（换网 / 换身份后残留的旧地址）不得作为首屏拨号候选——
 * 2026-10-16 实机：快照里 9 天前的 `192.168.1.4:47613` 被按当前网络拨号，
 * TCP 超时表现为「对端无反应」。可拨性由实时 mdns-found 刷新（restored
 * 置 false）接管；缺失 / 非数值 lastSeenMs 无法证明可见性，同样不可恢复。
 */
export function isWithinRestoreWindow(lastSeenMs: unknown, nowMs: number): boolean {
  return (
    typeof lastSeenMs === 'number' &&
    !Number.isNaN(lastSeenMs) &&
    nowMs - lastSeenMs >= 0 &&
    nowMs - lastSeenMs <= DEVICE_TTL_MS
  )
}

/** mDNS 实例名前缀（引擎 INSTANCE_PREFIX 对齐） */
const INSTANCE_PREFIX = 'wasmnest-peer-'

/** 能力位 bit0 = 文件传输（引擎 CAP_FILE_TRANSFER 对齐） */
const CAP_FILE_TRANSFER_BIT = 0x1

/**
 * mdns:found 载荷解析（纯函数）：`{ instanceName, addresses, port,
 * txtRecords: { id, name, ver, cap } }` → 缓存条目。
 * TXT `id` 缺失/非法（非 64 位 hex）丢弃；设备名缺失回退实例名末段。
 */
export function parseFoundPayload(payload: unknown): DiscoveredDevice | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const instanceName = typeof p.instanceName === 'string' ? p.instanceName : ''
  const txt = (p.txtRecords ?? {}) as Record<string, unknown>
  const nodeId = typeof txt.id === 'string' ? txt.id.toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(nodeId)) return null
  const addresses = Array.isArray(p.addresses)
    ? p.addresses.filter((a) => typeof a === 'string')
    : []
  const port = typeof p.port === 'number' ? p.port : 0
  const capHexRaw = typeof txt.cap === 'string' ? txt.cap.replace(/^0x/i, '') : ''
  const cap = Number.parseInt(capHexRaw, 16)
  const capabilitiesHex = Number.isNaN(cap) ? '' : cap.toString(16)
  const fallbackName = instanceName.startsWith(INSTANCE_PREFIX)
    ? instanceName.slice(INSTANCE_PREFIX.length)
    : instanceName
  const name = typeof txt.name === 'string' && txt.name !== '' ? txt.name : fallbackName
  const fileTransferByCap = Number.isNaN(cap) ? undefined : (cap & CAP_FILE_TRANSFER_BIT) !== 0
  return {
    nodeId,
    deviceName: name,
    addr: addresses[0] ?? '',
    port,
    // 能力位缺失时视为具备（兼容无 cap 的旧节点/种子）
    fileTransfer: fileTransferByCap ?? true,
    ...(capabilitiesHex !== '' ? { capabilitiesHex } : {}),
    ...(instanceName !== '' ? { instanceName } : {}),
  }
}

/**
 * lost 事件应用（纯函数）：实例名 → 短指纹（前 8 位）→ 按 nodeId 前缀匹配移除。
 * 返回新数组（不可变更新）。
 */
export function applyLost(
  list: readonly DiscoveredDevice[],
  instanceName: string,
  nowMs: number = Date.now(),
): DiscoveredDevice[] {
  if (!instanceName.startsWith(INSTANCE_PREFIX)) return [...list]
  const short = instanceName.slice(INSTANCE_PREFIX.length, INSTANCE_PREFIX.length + 8)
  if (!short) return [...list]
  // mDNS goodbye 只证明「LAN 这条路没了」：同一台设备若仍在中继快照里，保留行
  // 并摘掉 LAN 证据（避免跨网设备在两次 25s 心跳之间从列表里闪掉）
  return list
    .filter((d) => !d.nodeId.startsWith(short) || d.relay === true)
    .map((d) => {
      if (!d.nodeId.startsWith(short)) return d
      return { ...d, addr: '', port: 0, instanceName: undefined, lastSeenMs: nowMs }
    })
}

/**
 * TTL 惰性清扫（纯函数）：移除 lastSeenMs 超 TTL 且未连接的条目（spec 步骤 1
 * 「读取列表时顺带清理」）。快照恢复条目按其历史 lastSeenMs 参与判定——重启后
 * 首屏先渲染，用户首次手动刷新时清算过期项；近期恢复的条目（< TTL）保留。
 */
export function sweepStaleDevices(
  list: readonly DiscoveredDevice[],
  nowMs: number,
  connectedIds: ReadonlySet<string>,
): DiscoveredDevice[] {
  return list.filter((d) => {
    // 手动添加的远程设备没有 mDNS 心跳：清扫不得让用户配好的设备「自己消失」
    if (d.paired) return true
    if (connectedIds.has(d.nodeId)) return true
    if (!d.lastSeenMs) return true
    return nowMs - d.lastSeenMs < DEVICE_TTL_MS
  })
}

/** 实际传输形态（宿主 `peer:connection` 事件的 `transport` 词表） */
export type TransportKind = 'lan-direct' | 'wan-relay'

/** 宿主 transport 词表归一（未知值不猜，按「未知」处理） */
export function normalizeTransport(value: unknown): TransportKind | null {
  return value === 'lan-direct' || value === 'wan-relay' ? value : null
}

/**
 * 拨号失败分类（T20 §4.2）
 *
 * = 插件 `file-transfer.dial-peer` 返回载荷的 `status` token。为什么用 token 而不是
 * 错误串前缀：宿主把插件命令失败统一包成 `{ code, request_id }` 信封（ADR 0030），
 * 双端前端都拿不到错误原文，只有成功载荷里的字段才是可靠通道。
 *
 * `unknown` = 未识别（原文进 `detail`，不猜成 LAN / WAN / 成功）。
 */
export type DialFailureCode =
  | 'denied'
  | 'no-endpoint'
  | 'relay-disabled'
  | 'relay-unreachable'
  | 'lan-unreachable'
  | 'timeout'
  | 'unknown'

/** 拨号失败（分类 + 未识别时的原文，供控制台 / 诊断） */
export interface DialFailure {
  code: DialFailureCode
  /** 未识别错误的原文（截断展示；识别出的分类不带正文） */
  detail?: string
}

/** 拨号命令返回状态（含成功） */
export type DialStatus = 'connected' | DialFailureCode

/** 拨号失败原文的展示上限：错误串只用于诊断，不撑爆行内文案 */
const DIAL_ERROR_DETAIL_MAX = 240

const DIAL_FAILURE_CODES: readonly DialFailureCode[] = [
  'denied',
  'no-endpoint',
  'relay-disabled',
  'relay-unreachable',
  'lan-unreachable',
  'timeout',
]

/** 是否为已知失败 token（`unknown` 不算：它不是宿主上报值） */
export function isDialFailureCode(value: unknown): value is DialFailureCode {
  return typeof value === 'string' && (DIAL_FAILURE_CODES as readonly string[]).includes(value)
}

/**
 * `dial-peer` 返回载荷 → 失败分类（`null` = 成功 / 老版本宿主不带 status）
 *
 * 只认已知 token：未知 status 不当成功也不当已知失败（返回 unknown），
 * 让调用方按「未识别」如实呈现。
 */
export function dialFailureFromResult(payload: unknown): DialFailure | null {
  if (!payload || typeof payload !== 'object') return null
  const status = (payload as Record<string, unknown>).status
  if (status === undefined || status === 'connected') return null
  if (isDialFailureCode(status)) {
    const detail = (payload as Record<string, unknown>).detail
    return typeof detail === 'string' && detail !== '' ? { code: status, detail } : { code: status }
  }
  return { code: 'unknown', detail: stringifyDialError(status) }
}

/**
 * 命令抛错 → 失败分类（T20）
 *
 * 信封（`{ code, request_id }`）里没有分类信息，故一律 `unknown` + 原文
 * ——**不**按正文猜成 denied / LAN / WAN（那会把「本机参数错误」说成网络问题）。
 */
export function dialFailureFromError(e: unknown): DialFailure {
  const detail = stringifyDialError(e)
  return detail ? { code: 'unknown', detail } : { code: 'unknown' }
}

/** 任意错误值 → 可读短文本（取 message / error / detail，其次 JSON / String） */
function stringifyDialError(e: unknown): string {
  let text = ''
  if (typeof e === 'string') text = e
  else if (e instanceof Error) text = e.message
  else if (e && typeof e === 'object') {
    const rec = e as Record<string, unknown>
    for (const key of ['message', 'error', 'detail'] as const) {
      if (typeof rec[key] === 'string' && rec[key] !== '') {
        text = rec[key] as string
        break
      }
    }
    if (!text) {
      try {
        text = JSON.stringify(e)
      } catch {
        text = String(e)
      }
    }
  } else if (e !== undefined && e !== null) {
    text = String(e)
  }
  return text.length > DIAL_ERROR_DETAIL_MAX ? `${text.slice(0, DIAL_ERROR_DETAIL_MAX)}…` : text
}

/** 设备行归并三态 */
export type DeviceRowStatus = 'connected' | 'connecting' | 'idle'

/** 派生后的设备行（面板渲染模型） */
export interface DeviceRow {
  nodeId: string
  deviceName: string
  addr: string
  /** 无能力节点可见但不可发起连接 */
  fileTransfer: boolean
  status: DeviceRowStatus
  /** 拨号失败分类；连接中/已连接时为 null */
  dialError: DialFailure | null
  /** 是否为当前活跃对端（仅已连接态可为活跃） */
  isActive: boolean
  /** 快照恢复且未被实时事件刷新：展示「最近可见」标注（spec 故事 2） */
  recent: boolean
  /** 手动添加的远程设备（界面标「远程」；不参与 TTL 清扫） */
  paired: boolean
  /** 中继会合发现（跨 NAT）：界面标「中继」，无需扫码 / 连接串 */
  relay: boolean
  /** 已连接时宿主上报的真实传输形态（未连接 / 入站未知 = null） */
  transport: TransportKind | null
  /** 上次连接成功时的传输形态（T20：idle 态展示「上次：…」） */
  lastTransport: TransportKind | null
  /** 有 relay 候选可手动「尝试外网」（§4.9：不自动切，给手动入口） */
  wanAvailable: boolean
  /** 有内网候选（LAN 地址 / 非 circuit 多地址；可点「内网」连接） */
  lanAvailable: boolean
  /**
   * 可用连接方式标注（spec §4.1.2）：both = 内网+外网 / lan = 仅内网 /
   * wan = 仅外网 / none = 暂无可用候选（等重新发现）。
   */
  connectionModes: 'both' | 'lan' | 'wan' | 'none'
  /**
   * 建议「仅经中继」：LAN 拨号失败且存在 relay 候选（T20 §4.2）
   *
   * 判定不依赖 relay 预留是否生效——预留状态宿主不上报，用户点了才知道；
   * 失败文案由 `relay-unreachable` 如实给出。
   */
  relayOnlyRecommended: boolean
}

/** deriveDeviceRows 输入（全部为只读快照） */
export interface DeviceStateInput {
  devices: readonly DiscoveredDevice[]
  connectingIds: ReadonlySet<string>
  connectedIds: ReadonlySet<string>
  dialErrors: Readonly<Record<string, DialFailure>>
  activePeerId: string
  /** 宿主上报的传输形态（nodeId → lan-direct / wan-relay） */
  transports?: Readonly<Record<string, TransportKind>>
}

/** relay 候选标记（与核内 `dial::RELAY_MARKER` 同字面） */
const RELAY_MARKER = '/p2p-circuit'

/** 候选表里是否存在 relay 地址（手动「尝试外网」入口判据） */
export function hasRelayCandidate(addrs: readonly string[] | undefined): boolean {
  return (addrs ?? []).some((a) => a.includes(RELAY_MARKER))
}

/** 64 位小写 hex（与核内 NodeId / pairingLink 同判据） */
const NODE_ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * 中继会合快照解析（宿主 `peer:relay-devices` 载荷的纯函数）。
 *
 * 载荷：`{ devices: [{ nodeId, peerId, deviceName, addrs, lastSeenMs }] }`。
 * 只收合法 nodeId + 至少一条 circuit 候选；`peerId` 只用于诊断，不参与前端
 * 寻址（circuit 地址已自带）。非法条目跳过而不是整批失败——单台设备的坏记录
 * 不该让整个中继名单消失。
 */
export function parseRelayDevicesPayload(payload: unknown): DiscoveredDevice[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = (payload as Record<string, unknown>).devices
  if (!Array.isArray(raw)) return []
  const out: DiscoveredDevice[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const nodeId = typeof rec.nodeId === 'string' ? rec.nodeId.trim().toLowerCase() : ''
    if (!NODE_ID_PATTERN.test(nodeId)) continue
    const addrs = Array.isArray(rec.addrs)
      ? rec.addrs
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter((a) => a.startsWith('/') && a.includes(RELAY_MARKER))
      : []
    if (addrs.length === 0) continue
    const deviceName = typeof rec.deviceName === 'string' ? rec.deviceName.trim() : ''
    out.push({
      nodeId,
      deviceName,
      addr: '',
      port: 0,
      fileTransfer: true,
      addrs: [...new Set(addrs)],
      relay: true,
      lastSeenMs: typeof rec.lastSeenMs === 'number' ? rec.lastSeenMs : Date.now(),
      restored: false,
    })
  }
  return out
}

/**
 * 中继快照并入设备缓存（纯函数，返回新数组）。
 *
 * 规则：
 * - 同 nodeId：合并 circuit 候选、保留已有 LAN 证据（addr/port/instanceName）、
 *   摘除 `restored`（中继心跳是实时证据）；展示名优先保留已有非空值。
 * - 快照中消失的「纯中继」条目删除——中继离线后不应留下可拨的陈旧 circuit。
 *   有 mDNS 证据 / 已配对 / 已连接的条目保留（可能是同一条目的另一条发现路径）。
 * - `nowMs` 只用于给「本次仍在快照里的中继条目」续期，不用中继自报时间
 *   （两端时钟可能漂移）。
 */
export function mergeRelayDevices(
  devices: readonly DiscoveredDevice[],
  snapshot: readonly DiscoveredDevice[],
  nowMs: number,
  connectedIds: ReadonlySet<string>,
): DiscoveredDevice[] {
  const snapshotIds = new Set(snapshot.map((d) => d.nodeId))
  const byId = new Map<string, DiscoveredDevice>()
  for (const device of devices) byId.set(device.nodeId, { ...device })

  for (const incoming of snapshot) {
    const existing = byId.get(incoming.nodeId)
    if (!existing) {
      byId.set(incoming.nodeId, { ...incoming, lastSeenMs: nowMs, restored: false })
      continue
    }
    byId.set(incoming.nodeId, {
      ...existing,
      deviceName: existing.deviceName || incoming.deviceName,
      addrs: [...new Set([...(existing.addrs ?? []), ...(incoming.addrs ?? [])])],
      relay: true,
      lastSeenMs: nowMs,
      restored: false,
    })
  }

  const out: DiscoveredDevice[] = []
  for (const device of byId.values()) {
    if (!device.relay || snapshotIds.has(device.nodeId)) {
      out.push(device)
      continue
    }
    const lanEvidence =
      Boolean(device.instanceName) || Boolean(device.addr) || (device.port ?? 0) > 0
    if (!lanEvidence && !device.paired && !connectedIds.has(device.nodeId)) continue
    // 行保留（LAN / 配对 / 已连接），但「中继发现」标记必须摘掉：
    // 继续显示中继徽标会让用户以为跨网路径仍可用
    out.push({ ...device, relay: false })
  }
  return out
}

/**
 * 归并设备行：状态优先级 connected > connecting > idle；
 * 拨号失败只在 idle 态呈现（连接中/已连接即视为旧错误已消除）
 */
export function deriveDeviceRows(input: DeviceStateInput): DeviceRow[] {
  return input.devices.map((d) => {
    const connected = input.connectedIds.has(d.nodeId)
    const connecting = !connected && input.connectingIds.has(d.nodeId)
    const dialError = connected || connecting ? null : (input.dialErrors[d.nodeId] ?? null)
    const wanAvailable = hasRelayCandidate(d.addrs) || input.transports?.[d.nodeId] === 'wan-relay'
    // 内网候选：地址三元组存在，或多地址里有非 circuit 项（mDNS / 配对 LAN）
    const lanAvailable =
      Boolean(d.addr) || (d.port ?? 0) > 0 || (d.addrs ?? []).some((a) => !a.includes(RELAY_MARKER))
    const connectionModes =
      lanAvailable && wanAvailable ? 'both' : lanAvailable ? 'lan' : wanAvailable ? 'wan' : 'none'
    return {
      nodeId: d.nodeId,
      deviceName: d.deviceName || d.nodeId,
      addr: d.addr ?? '',
      fileTransfer: d.fileTransfer !== false,
      status: connected ? 'connected' : connecting ? 'connecting' : 'idle',
      dialError,
      isActive: connected && d.nodeId === input.activePeerId,
      recent: d.restored === true && !connected,
      paired: d.paired === true,
      relay: d.relay === true,
      transport: connected ? (input.transports?.[d.nodeId] ?? null) : null,
      lastTransport: normalizeTransport(d.lastTransport),
      wanAvailable,
      lanAvailable,
      connectionModes,
      relayOnlyRecommended: dialError?.code === 'lan-unreachable' && wanAvailable,
    }
  })
}

/** 宿主发现状态词表（`peer:relay-devices.status`） */
export type RelayDiscoveryStatus =
  'ok' | 'disabled' | 'relay-unavailable' | 'unsupported' | 'denied' | 'error'

const RELAY_DISCOVERY_STATUSES: readonly RelayDiscoveryStatus[] = [
  'ok',
  'disabled',
  'relay-unavailable',
  'unsupported',
  'denied',
  'error',
]

/** 错误摘要展示上限（完整内容只在日志 / 控制台） */
const RELAY_ERROR_DISPLAY_MAX = 120

/** 中继发现状态（宿主 envelope 的增量字段；旧宿主返回 null） */
export interface RelayDiscovery {
  status: RelayDiscoveryStatus
  /** 失败 token / 截断原文（ok / disabled 时为 null） */
  error: string | null
  /** 当前使用的中继端点（未配置为空串） */
  relay: string
  /** 宿主发布时刻（Unix 毫秒；0 = 宿主未给） */
  updatedAtMs: number
  /** 本次快照里的设备数 */
  count: number
}

function truncateDisplay(text: string, maxChars: number): string {
  const chars = Array.from(text)
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : text
}

/**
 * 解析宿主发现状态（纯函数）。
 *
 * 随 `peer:relay-devices` 快照下发；旧宿主只发 `{ devices }`：返回 null，
 * 不把缺失字段猜成 ok。`error` 只保留 ≤120 字符，完整内容进日志。
 */
export function parseRelayDiscoveryPayload(payload: unknown): RelayDiscovery | null {
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as Record<string, unknown>
  const status =
    typeof rec.status === 'string' &&
    (RELAY_DISCOVERY_STATUSES as readonly string[]).includes(rec.status)
      ? (rec.status as RelayDiscoveryStatus)
      : null
  if (!status) return null
  const rawError = typeof rec.error === 'string' ? rec.error.trim() : ''
  const updatedAtMs =
    typeof rec.updatedAtMs === 'number' && Number.isFinite(rec.updatedAtMs) ? rec.updatedAtMs : 0
  return {
    status,
    error: rawError === '' ? null : truncateDisplay(rawError, RELAY_ERROR_DISPLAY_MAX),
    relay: typeof rec.relay === 'string' ? rec.relay.trim() : '',
    updatedAtMs,
    count: Array.isArray(rec.devices) ? rec.devices.length : 0,
  }
}
