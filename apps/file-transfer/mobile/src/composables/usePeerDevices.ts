/**
 * 附近设备面板编排 — 自建设备缓存版（issue 13 Phase 3 步骤 1）
 *
 * 数据源：`mdns-found` / `mdns-lost` 插件事件（宿主 mdns:* 原样透传）驱动的
 * 前端缓存状态机（去重 / TTL / 展示名 / 能力位见 deviceState 纯函数）；
 * `connection-changed` 维护连接态。缓存经 `save-device-snapshot` debounce
 * 落盘（含 last-seen），activate 首屏由 `get-device-snapshot` 恢复并标注
 * 「最近可见」（spec 故事 2）。连接动作携带显式 endpoint 三元组走
 * `dial-peer`（失败按命令返回的分类 token 呈现，T20），断开走
 * `disconnect-peer`。
 */
import { computed, ref, type Ref } from 'vue'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import {
  applyLost,
  deriveDeviceRows,
  dialFailureFromError,
  dialFailureFromResult,
  isWithinRestoreWindow,
  mergeRelayDevices,
  normalizeTransport,
  parseFoundPayload,
  parseRelayDevicesPayload,
  parseRelayDiscoveryPayload,
  sweepStaleDevices,
  type DeviceRow,
  type DialFailure,
  type DiscoveredDevice,
  type DialStatus,
  type RelayDiscovery,
  type TransportKind,
} from './deviceState'
import type { RemotePeerLink } from '../utils/pairingLink'

/** 快照落盘 debounce 窗口（毫秒） */
const SNAPSHOT_SAVE_DEBOUNCE_MS = 2000

/** 可传输对端条目（工作台兼容形状） */
export interface PeerItem {
  id: string
  name: string
}

/** 激活对端派生状态 */
export interface PeerState {
  id: string
  name: string
  online: boolean
}

/** 快照恢复条目形状（get-device-snapshot 返回，camelCase） */
interface SnapshotEntry {
  nodeId: string
  deviceName?: string
  addr?: string
  port?: number
  capabilitiesHex?: string
  instanceName?: string
  lastSeenMs?: number
  /** T12：配对/历史保留的多地址候选 */
  addrs?: string[]
  /** T12：手动添加的远程设备 */
  paired?: boolean
  /** T20：上次连接成功时的传输形态（未知 / 旧快照缺省 = 不恢复） */
  lastTransport?: unknown
  /** 中继会合发现（跨 NAT；重启后先按「最近可见」展示，等中继快照刷新） */
  relay?: boolean
}

interface ConnectionPayload {
  nodeId?: string
  connected?: boolean
  /** 宿主上报的真实传输形态（T11/T12）：lan-direct / wan-relay；入站未知时缺省 */
  transport?: string
  deviceName?: string
}

function withId(set: ReadonlySet<string>, id: string): Set<string> {
  return new Set(set).add(id)
}

function withoutId(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  next.delete(id)
  return next
}

function createPeerDevices(context: PluginContext) {
  // ==================== 状态 ====================

  /** 自建设备缓存（found/lost/TTL 三路事件驱动；快照恢复首屏） */
  const devices = ref<DiscoveredDevice[]>([]) as Ref<DiscoveredDevice[]>
  /** 正在握手的节点集合（防重复点击与并发拨号同一节点） */
  const connectingIds = ref<ReadonlySet<string>>(new Set())
  /** 已连接节点集合（connection-changed 维护的宿主真相副本） */
  const connectedIds = ref<ReadonlySet<string>>(new Set())
  /** 最近一次拨号未成功状态（nodeId → 分类 + 原文；成功即清除） */
  const dialErrors = ref<Record<string, DialFailure>>({})
  /** 宿主上报的传输形态（nodeId → lan-direct / wan-relay；断开即清除） */
  const transports = ref<Record<string, TransportKind>>({})
  /** 活跃对端 id（'' = 未选择；仅已连接节点可成为活跃对端） */
  const activePeerId = ref('') as Ref<string>
  /** 中继发现状态（宿主 envelope 增量字段；旧宿主为 null） */
  const relayDiscovery = ref<RelayDiscovery | null>(null) as Ref<RelayDiscovery | null>

  let started = false
  /** 本次会话已尝试自动重连的中继设备（防重连风暴；用户手动断开后不再自动连） */
  const autoConnectAttempted = new Set<string>()
  let disposables: Disposable[] = []
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // ==================== 派生 ====================

  /** 设备行（三态归并 + 行内错误 + 活跃标记 + 最近可见标注），面板直接渲染 */
  const rows = computed<DeviceRow[]>(() =>
    deriveDeviceRows({
      devices: devices.value,
      connectingIds: connectingIds.value,
      connectedIds: connectedIds.value,
      dialErrors: dialErrors.value,
      activePeerId: activePeerId.value,
      transports: transports.value,
    }),
  )

  /** 具备传输能力的发现节点（工作台设备名映射用，不要求已连接） */
  const peers = computed<PeerItem[]>(() =>
    devices.value
      .filter((d) => d.fileTransfer !== false)
      .map((d) => ({ id: d.nodeId, name: d.deviceName || d.nodeId })),
  )

  /** 已连接且可传输的节点 id（活跃兜底切换候选） */
  const connectableConnectedIds = computed<string[]>(() =>
    devices.value
      .filter((d) => d.fileTransfer !== false && connectedIds.value.has(d.nodeId))
      .map((d) => d.nodeId),
  )

  /** 激活对端派生 */
  const peer = computed<PeerState>(() => {
    const item = devices.value.find((d) => d.nodeId === activePeerId.value)
    return item
      ? {
          id: item.nodeId,
          name: item.deviceName || item.nodeId,
          online: connectedIds.value.has(item.nodeId),
        }
      : { id: '', name: '', online: false }
  })

  // ==================== 内部辅助 ====================

  function setDialError(nodeId: string, failure: DialFailure): void {
    dialErrors.value = { ...dialErrors.value, [nodeId]: failure }
  }

  function clearDialError(nodeId: string): void {
    if (!(nodeId in dialErrors.value)) return
    const next = { ...dialErrors.value }
    delete next[nodeId]
    dialErrors.value = next
  }

  /**
   * 连接态盖章：刷新最近可见时刻（远程设备无 mDNS 心跳，只靠连接事件续期），
   * `deviceName` 非空时更新展示名。
   *
   * `transport` 非空时同时记「上次传输形态」（T20：断开后保留，供行内展示与
   * 下次重连默认纳入 relay）。
   */
  function touchDevice(nodeId: string, deviceName: string, transport: TransportKind | null): void {
    const idx = devices.value.findIndex((d) => d.nodeId === nodeId)
    if (idx < 0) return
    const next = [...devices.value]
    next[idx] = {
      ...next[idx]!,
      // 没有新信息也要续期：远程设备没有 mDNS 心跳，不盖章会被 TTL 清掉
      lastSeenMs: Date.now(),
      ...(deviceName ? { deviceName } : {}),
      ...(transport ? { lastTransport: transport } : {}),
    }
    devices.value = next
    scheduleSnapshotSave()
  }

  /** 登记已连接并清除历史拨号错误 */
  function markConnected(nodeId: string): void {
    connectedIds.value = withId(connectedIds.value, nodeId)
    clearDialError(nodeId)
  }

  /** 活跃对端乐观切换：本地立即生效，命令失败仅记日志（事件/刷新兜底纠正） */
  function activateOptimistic(nodeId: string): void {
    activePeerId.value = nodeId
    context.commands
      .execute('file-transfer.set-active-peer', { peerId: nodeId })
      .catch((e: unknown) => {
        console.error('[File Transfer] set-active-peer failed:', e)
      })
  }

  /**
   * 活跃对端兜底：当前活跃节点已连接则保持；否则乐观切到首个已连接可传输节点。
   * 无任何已连接节点时不动（启动早期连接事件未到，不可凭空清掉宿主侧活跃态）。
   */
  function ensureActiveFallback(): boolean {
    const candidates = connectableConnectedIds.value
    if (candidates.length === 0 || candidates.includes(activePeerId.value)) return false
    activateOptimistic(candidates[0]!)
    return true
  }

  /** 活跃对端自身会话丢失的收尾：有其他候选则乐观切换，否则本地清空活跃 */
  function handleActiveLost(): void {
    const candidates = connectableConnectedIds.value
    if (candidates.length > 0) {
      activateOptimistic(candidates[0]!)
      return
    }
    activePeerId.value = ''
  }

  /** 缓存 upsert（不可变更新；found 即刷新 last-seen 并摘除快照恢复标记） */
  function upsertDevice(device: DiscoveredDevice): void {
    const stamped: DiscoveredDevice = { ...device, lastSeenMs: Date.now(), restored: false }
    const idx = devices.value.findIndex((d) => d.nodeId === device.nodeId)
    if (idx >= 0) {
      const next = [...devices.value]
      next[idx] = { ...next[idx], ...stamped }
      devices.value = next
    } else {
      devices.value = [...devices.value, stamped]
    }
    scheduleSnapshotSave()
  }

  /** 缓存快照 debounce 落盘（≤50 条裁剪；失败静默——下次变更重试） */
  function scheduleSnapshotSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const entries: SnapshotEntry[] = devices.value.slice(0, 50).map((d) => ({
        nodeId: d.nodeId,
        deviceName: d.deviceName ?? '',
        addr: d.addr ?? '',
        port: d.port ?? 0,
        capabilitiesHex: d.capabilitiesHex ?? '',
        instanceName: d.instanceName ?? '',
        lastSeenMs: d.lastSeenMs ?? 0,
        // 配对候选与「手动添加」标记必须跨重启保留（否则远程设备重启即丢）；
        // 上次传输形态是重连策略输入（T20：重启后免再点「尝试外网」）
        addrs: d.addrs ?? [],
        paired: d.paired === true,
        ...(d.relay === true ? { relay: true } : {}),
        ...(d.lastTransport ? { lastTransport: d.lastTransport } : {}),
      }))
      context.commands
        .execute('file-transfer.save-device-snapshot', { devices: entries })
        .catch((e: unknown) => {
          console.error('[File Transfer] save-device-snapshot failed:', e)
        })
    }, SNAPSHOT_SAVE_DEBOUNCE_MS)
  }

  // ==================== 事件处理 ====================

  function handleFound(payload: unknown): void {
    const device = parseFoundPayload(payload)
    if (!device) return
    upsertDevice(device)
    ensureActiveFallback()
  }

  function handleLost(payload: unknown): void {
    const instanceName =
      payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).instanceName ?? '')
        : ''
    if (!instanceName) return
    const next = applyLost(devices.value, instanceName)
    if (next.length !== devices.value.length) {
      devices.value = next
      scheduleSnapshotSave()
    }
  }

  /**
   * 中继会合快照（跨 NAT）：全量替换 relay 发现面。
   *
   * 与 mDNS 事件共用同一设备缓存，按 nodeId 归并——同一台设备既在局域网又被
   * 中继看见时只显示一行，LAN 候选与 circuit 候选合并（连接时 LAN 优先）。
   * 中继快照中消失的纯中继条目会被移除（宿主 25s 心跳续期；中继离线不保留
   * 陈旧 circuit）。
   */
  function handleRelayDevices(payload: unknown): void {
    relayDiscovery.value = parseRelayDiscoveryPayload(payload)
    const snapshot = parseRelayDevicesPayload(payload)
    devices.value = mergeRelayDevices(devices.value, snapshot, Date.now(), connectedIds.value)
    scheduleSnapshotSave()
    // 只对「上次确实经中继连过」的设备自动重连；新设备仍需用户点一下 + 对端
    // 首连确认（自动连陌生设备 = 静默扩大信任面，不做）
    for (const device of snapshot) {
      const known = devices.value.find((d) => d.nodeId === device.nodeId)
      if (!known || known.lastTransport !== 'wan-relay') continue
      if (autoConnectAttempted.has(device.nodeId)) continue
      if (connectedIds.value.has(device.nodeId) || connectingIds.value.has(device.nodeId)) continue
      autoConnectAttempted.add(device.nodeId)
      void connect(device.nodeId, { wan: true })
    }
  }

  function handleConnectionChanged(payload: ConnectionPayload): void {
    if (!payload?.nodeId) return
    if (payload.connected) {
      markConnected(payload.nodeId)
      const transport = normalizeTransport(payload.transport)
      if (transport) transports.value = { ...transports.value, [payload.nodeId]: transport }
      // 宿主带出的设备名 / 连接时刻 / 真实传输形态回写缓存：远程设备没有
      // mDNS 心跳，不在这里盖章就永远停在配对那一刻（重启后按 TTL 恢复窗口被丢弃）
      touchDevice(
        payload.nodeId,
        typeof payload.deviceName === 'string' ? payload.deviceName : '',
        transport,
      )
      ensureActiveFallback()
      // 入站（被连侧）连接没有拨号 memo：数据面命令（浏览/拉取/发送）经它
      // 重拨，endpoint 取自自建缓存（mdns-found 维护）
      rememberEndpoint(payload.nodeId)
    } else {
      connectedIds.value = withoutId(connectedIds.value, payload.nodeId)
      if (payload.nodeId in transports.value) {
        const next = { ...transports.value }
        delete next[payload.nodeId]
        transports.value = next
      }
      if (payload.nodeId === activePeerId.value) handleActiveLost()
    }
  }

  /** 入站连接的对端寻址登记（fire-and-forget；缓存缺失时跳过，对端不可达由命令错误呈现） */
  function rememberEndpoint(nodeId: string): void {
    const device = devices.value.find((d) => d.nodeId === nodeId)
    // 手动远程设备（pairing 连接串）只有 `addrs`：不能因为 addr/port 为空就跳过，
    // 否则入站后不点「连接」直接发文件 / 浏览会走 ensure_target → 无 endpoint memo。
    if (!device) return
    if (!device.addr && !device.port && !device.addrs?.length) return
    context.commands
      .execute('file-transfer.remember-peer-endpoint', {
        endpoint: {
          nodeId,
          addr: device.addr,
          port: device.port,
          ...(device.addrs?.length ? { addrs: device.addrs } : {}),
        },
      })
      .catch((e: unknown) => console.error('[File Transfer] remember-peer-endpoint failed:', e))
  }

  // ==================== 对外操作 ====================

  /** 向宿主请求发现刷新：宿主立即重查 + 缓存/连接态以事件重发（按钮直达后端，
   * 挂载晚于引擎发现事件时首屏即有数据） */
  function requestHostRefresh(): void {
    context.commands.execute('file-transfer.refresh-devices', {}).catch((e: unknown) => {
      console.error('[File Transfer] refresh-devices failed:', e)
    })
  }

  /**
   * 手动刷新：TTL 惰性清扫（含清算快照恢复条目）+ 落盘 + 宿主发现刷新。
   * 发现数据由 mDNS 事件流驱动，本操作触发宿主即时重查加速数据到位。
   */
  async function refresh(): Promise<void> {
    devices.value = sweepStaleDevices(devices.value, Date.now(), connectedIds.value)
    requestHostRefresh()
    scheduleSnapshotSave()
  }

  /**
   * 发起对等连接：握手期间该节点进入 connecting 态（重复发起被拒绝），
   * 失败以分类行内错误呈现（T20）。endpoint 三元组取自自建缓存；
   * 返回终态；null 表示本次未实际发起（未发现/无能力/进行中的防御拦截）。
   *
   * `opts.wan` 缺省 = 「上次走过中继就把 relay 纳入候选」（LAN 仍优先，T20 §4.1）；
   * `opts.relayOnly` = 用户显式「仅经中继」（跳过 LAN，失败不回退）。
   */
  async function connect(
    nodeId: string,
    opts?: { wan?: boolean; relayOnly?: boolean; lanOnly?: boolean },
  ): Promise<DialStatus | null> {
    const device = devices.value.find((d) => d.nodeId === nodeId)
    if (!device || !device.fileTransfer) return null
    // 快照恢复条目尚未被本会话实时 mdns-found 刷新：endpoint 未经本次网络
    // 验证，直接拨号只会按陈旧地址撞墙（2026-10-16 实机：快照旧网络地址
    // 拨号 TCP 超时、对端完全无感知）。拒绝并触发宿主即时重查——实时条目
    // 接管（restored 清 false）后即可正常拨号。
    // 例外：**手动添加的远程设备**（paired）地址来自连接串而非发现缓存，
    // 本就没有 mDNS 实时条目可等，直接按配对候选拨号。
    if (device.restored && !device.paired) {
      setDialError(nodeId, { code: 'lan-unreachable' })
      requestHostRefresh()
      return 'lan-unreachable'
    }
    const addrs = device.addrs ?? []
    if ((!device.addr || !device.port) && addrs.length === 0) {
      setDialError(nodeId, { code: 'no-endpoint' })
      return 'no-endpoint'
    }
    if (connectingIds.value.has(nodeId) || connectedIds.value.has(nodeId)) return null

    // 纯中继发现的设备没有 LAN 证据（addr/port/instanceName 全空）：直接走
    // relay-only，避免拿上一网络的陈旧 LAN 候选先吃超时。同网设备若同时被
    // mDNS 发现，仍保留 LAN 优先。
    const hasLanCandidate = (device.addrs ?? []).some((a) => !a.includes('/p2p-circuit'))
    const pureRelay =
      device.relay === true &&
      !device.instanceName &&
      !device.addr &&
      (device.port ?? 0) === 0 &&
      !hasLanCandidate
    // 显式「内网」入口：只走 LAN，不允许 pureRelay 的隐式升级
    const lanOnly = opts?.lanOnly === true
    const relayOnly = !lanOnly && (opts?.relayOnly === true || pureRelay)
    // 当前仍在中继快照里、且没有实时 mDNS 证据（instanceName）= 设备现在只经
    // 中继可见：即使缓存里还留着上一网络的 LAN 地址，也要把 relay 纳入候选
    // （LAN 仍先试，失败后走 relay，而不是停在 lan-unreachable）。
    const relayVisible = device.relay === true && !device.instanceName
    // 上次经中继成功 ⇒ 本次默认把 relay 纳入候选（有 LAN 候选时 LAN 仍先试）；
    // 「仅经中继」是更强的显式意图，优先
    const wan =
      !lanOnly &&
      (relayOnly || (opts?.wan ?? (device.lastTransport === 'wan-relay' || relayVisible)))

    connectingIds.value = withId(connectingIds.value, nodeId)
    clearDialError(nodeId)
    try {
      const result = await context.commands.execute('file-transfer.dial-peer', {
        endpoint: {
          nodeId,
          addr: device.addr ?? '',
          port: device.port ?? 0,
          ...(addrs.length ? { addrs } : {}),
        },
        ...(wan ? { wan: true } : {}),
        ...(relayOnly ? { relayOnly: true } : {}),
      })
      // 分类失败经成功载荷返回（信封不带原文，T20 §4.2）；未识别保持 unknown
      const failure = dialFailureFromResult(result)
      if (failure) {
        setDialError(nodeId, failure)
        return failure.code
      }
      markConnected(nodeId)
      ensureActiveFallback()
      return 'connected'
    } catch (e) {
      // 机制失败（宿主不可用 / 参数畸形）：分类交回 unknown，原文只进控制台
      console.error('[File Transfer] dial-peer failed:', e)
      const failure = dialFailureFromError(e)
      setDialError(nodeId, failure)
      return failure.code
    } finally {
      connectingIds.value = withoutId(connectingIds.value, nodeId)
    }
  }

  /**
   * 添加远程设备（T12）：配对连接串 → 自建缓存条目。
   *
   * 手工配对入口已于 2026-11-16 从探索页下线（本函数不再有界面调用），
   * 保留用于已存 paired 快照的兼容与测试种子。
   *
   * 已存在同 nodeId 时合并候选与展示名（保留已连接态）；手动添加的条目标
   * `paired`，之后 TTL 清扫不会把它清掉。返回是否为新增。
   */
  function addRemotePeer(link: RemotePeerLink): boolean {
    const exists = devices.value.some((d) => d.nodeId === link.nodeId)
    const idx = devices.value.findIndex((d) => d.nodeId === link.nodeId)
    const base: DiscoveredDevice =
      idx >= 0
        ? { ...devices.value[idx]! }
        : {
            nodeId: link.nodeId,
            deviceName: link.deviceName,
            addr: '',
            port: 0,
            fileTransfer: true,
            lastSeenMs: Date.now(),
          }
    const merged: DiscoveredDevice = {
      ...base,
      deviceName: link.deviceName || base.deviceName || '',
      addrs: [...new Set([...(base.addrs ?? []), ...link.addrs])],
      paired: true,
      restored: false,
    }
    const next = [...devices.value]
    if (idx >= 0) next[idx] = merged
    else next.push(merged)
    devices.value = next
    scheduleSnapshotSave()
    return !exists
  }

  /** 移除手动添加的远程设备（发现缓存条目只摘候选与标记，不整条删） */
  function removeRemotePeer(nodeId: string): void {
    devices.value = devices.value.map((d) =>
      d.nodeId === nodeId && d.paired && !connectedIds.value.has(nodeId)
        ? { ...d, paired: false, addrs: [] }
        : d,
    )
    // 从未被 mDNS 发现过的条目（addr/port 皆空）整条移除，避免空行残留
    devices.value = devices.value.filter(
      (d) => d.nodeId !== nodeId || d.paired || d.addr !== '' || d.port !== 0,
    )
    scheduleSnapshotSave()
  }

  /** 断开对等连接：乐观摘除即时反馈；断的是活跃对端则按兜底规则收尾 */
  async function disconnect(nodeId: string): Promise<void> {
    connectedIds.value = withoutId(connectedIds.value, nodeId)
    if (nodeId === activePeerId.value) handleActiveLost()
    try {
      await context.commands.execute('file-transfer.disconnect-peer', { nodeId })
    } catch (e) {
      console.error('[File Transfer] disconnect-peer failed:', e)
    }
  }

  /** 切换活跃对端（含清空：id 为空串表示放弃当前活跃） */
  async function switchPeer(id: string): Promise<boolean> {
    try {
      await context.commands.execute('file-transfer.set-active-peer', { peerId: id })
      activePeerId.value = id
      return true
    } catch (e) {
      console.error('[File Transfer] set-active-peer failed:', e)
      return false
    }
  }

  // ==================== 生命周期 ====================

  /** 幂等启动：先恢复快照首屏（「最近可见」标注），再订阅实时事件流 */
  function start(): void {
    if (started) return
    started = true
    autoConnectAttempted.clear()
    disposables = [
      context.events.on('plugin:file-transfer:mdns-found', handleFound),
      context.events.on('plugin:file-transfer:mdns-lost', handleLost),
      context.events.on('plugin:file-transfer:connection-changed', handleConnectionChanged),
      context.events.on('plugin:file-transfer:relay-devices', handleRelayDevices),
    ]
    void (async () => {
      try {
        const snap = await context.commands.execute('file-transfer.get-device-snapshot', {})
        const list: DiscoveredDevice[] = Array.isArray(snap?.devices)
          ? (snap.devices as SnapshotEntry[])
              .filter((d) => typeof d?.nodeId === 'string' && d.nodeId !== '')
              // 只恢复「近期可见」条目：陈旧条目（旧网络残留地址 / 旧身份）
              // 不得成为首屏拨号候选（见 isWithinRestoreWindow 注释）
              // paired 无条件恢复：远程设备没有 mDNS 心跳，lastSeenMs 停在配对时刻
              .filter((d) => d.paired === true || isWithinRestoreWindow(d.lastSeenMs, Date.now()))
              .map((d) => {
                const capHex = d.capabilitiesHex ?? ''
                // 上次传输形态：词表外的历史值不恢复（不猜）
                const lastTransport = normalizeTransport(d.lastTransport)
                return {
                  nodeId: d.nodeId,
                  deviceName: d.deviceName ?? '',
                  addr: d.addr ?? '',
                  port: d.port ?? 0,
                  fileTransfer: capHex === '' ? true : (Number.parseInt(capHex, 16) & 1) !== 0,
                  ...(d.instanceName ? { instanceName: d.instanceName } : {}),
                  ...(Array.isArray(d.addrs) && d.addrs.length ? { addrs: d.addrs } : {}),
                  ...(d.paired === true ? { paired: true } : {}),
                  ...(d.relay === true ? { relay: true } : {}),
                  ...(lastTransport ? { lastTransport } : {}),
                  lastSeenMs: d.lastSeenMs ?? 0,
                  restored: true,
                }
              })
          : []
        if (list.length > 0 && devices.value.length === 0) devices.value = list
      } catch (e) {
        console.error('[File Transfer] get-device-snapshot failed:', e)
      }
    })()
    // 首屏即向宿主要一次发现/连接快照（挂载晚于引擎发现与连接建立时不空屏）
    requestHostRefresh()
  }

  function stop(): void {
    disposables.forEach((d) => d.dispose())
    disposables = []
    started = false
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  return {
    relayDiscovery,
    devices,
    rows,
    peers,
    peer,
    activePeerId,
    connectingIds,
    connectedIds,
    dialErrors,
    transports,
    connect,
    addRemotePeer,
    removeRemotePeer,
    disconnect,
    switchPeer,
    refresh,
    start,
    stop,
  }
}

// ==================== 模块级单例（跨组件共享） ====================

/**
 * ToolboxEntry 与 FileTransferView 各自挂载时不得建立两份事件订阅与宿主命令
 * 流量（mdns-found/lost/connection-changed 双份消费、双份 get-device-snapshot /
 * requestHostRefresh）。按 context 键控共享：宿主单插件进程内两组件注入的是
 * 同一 pluginContext → 共享同一实例；测试各造独立 context/mock env → 天然隔离。
 * start/stop 引用计数，最后一个持有者停止才真正摘除监听。
 */
const sharedDevices = new WeakMap<object, ReturnType<typeof createPeerDevices>>()
const devicesRefCounts = new WeakMap<object, number>()

export function usePeerDevices(context: PluginContext) {
  let instance = sharedDevices.get(context)
  if (!instance) {
    instance = createPeerDevices(context)
    sharedDevices.set(context, instance)
    devicesRefCounts.set(context, 0)
  }
  return {
    ...instance,
    start() {
      const next = (devicesRefCounts.get(context) ?? 0) + 1
      devicesRefCounts.set(context, next)
      if (next === 1) instance!.start()
    },
    stop() {
      const next = Math.max(0, (devicesRefCounts.get(context) ?? 0) - 1)
      devicesRefCounts.set(context, next)
      if (next === 0) instance!.stop()
    },
  }
}
