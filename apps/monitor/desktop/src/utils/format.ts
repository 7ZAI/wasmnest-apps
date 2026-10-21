/**
 * Monitor 纯函数层：快照校验 / 合并 / 数值格式化
 *
 * 页面与预览面共用。所有函数无副作用，可直接单测；格式化对缺失 / 非法值统一
 * 返回 `—`（不把 undefined 渲染成 0，避免把「没有数据」说成「零」）。
 */
import type {
  HostPluginInfo,
  MetricsSnapshot,
  PluginDisplayState,
  PluginKindRole,
  PluginMetricsSnapshot,
  PluginRow,
  SystemSection,
} from '../types'

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 解析 / 校验 `monitor.snapshot` 返回值；结构不合法即抛错（fail-visible） */
export function normalizeSnapshot(raw: unknown): MetricsSnapshot {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('monitor.snapshot returned invalid JSON')
    }
  }
  if (!isRecord(value)) {
    throw new Error('monitor.snapshot returned a non-object payload')
  }
  if (!isRecord(value.plugins)) {
    throw new Error('monitor.snapshot payload is missing the plugins section')
  }
  for (const [id, metrics] of Object.entries(value.plugins)) {
    if (!isRecord(metrics)) {
      throw new Error(`monitor.snapshot plugin metrics for "${id}" is not an object`)
    }
  }
  return value as MetricsSnapshot
}

/** 宿主 PluginState → 壳展示态（未知 / 缺失不猜，显示 unknown） */
export function displayStateOf(raw: string | undefined): PluginDisplayState {
  switch (raw) {
    case 'activated':
      return 'running'
    case 'degraded':
      return 'degraded'
    case 'needsApproval':
      return 'approval'
    case 'error':
      return 'error'
    case 'loaded':
    case 'activating':
    case 'deactivated':
      return 'dormant'
    default:
      return 'unknown'
  }
}

/** 排序权重：活跃 / 需要关注的状态在前，未运行在后 */
const STATE_RANK: Record<PluginDisplayState, number> = {
  running: 0,
  degraded: 1,
  error: 1,
  approval: 2,
  dormant: 3,
  unknown: 4,
}

/** 同一状态下服务优先于业务应用（认证中心等基础服务先被发现） */
const ROLE_RANK: Record<PluginKindRole, number> = {
  'basic-service': 0,
  'internal-business': 1,
  'business-app': 2,
  unknown: 3,
}

/** 宿主清单有、指标快照无时只补这些异常态，正常未运行的应用不进入运行时台账 */
const HOST_ONLY_VISIBLE_STATES = new Set<PluginDisplayState>(['error', 'degraded', 'approval'])

/** 携带 wasm Store 的产物形态；ts-only 没有运行时指标 */
const WASM_PLUGIN_TYPES = new Set(['rust', 'rust-ts', 'wasm'])

/** manifest kind → 展示角色（兼容历史别名 system / application） */
export function normalizePluginKind(raw: unknown): PluginKindRole {
  switch (raw) {
    case 'basic-service':
    case 'system':
      return 'basic-service'
    case 'internal-business':
      return 'internal-business'
    case 'business-app':
    case 'application':
      return 'business-app'
    default:
      return 'unknown'
  }
}

/** 角色徽标的 i18n key；unknown 不出徽标 */
export function roleI18nKey(kind: PluginKindRole): string | null {
  switch (kind) {
    case 'basic-service':
      return 'monitor.role.basicService'
    case 'internal-business':
      return 'monitor.role.internalBusiness'
    case 'business-app':
      return 'monitor.role.businessApp'
    default:
      return null
  }
}

/** 是否为服务型角色（L1 / L2） */
export function isServiceKind(kind: PluginKindRole): boolean {
  return kind === 'basic-service' || kind === 'internal-business'
}

function isWasmBearingPluginType(raw: unknown): boolean | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  return WASM_PLUGIN_TYPES.has(raw.toLowerCase())
}

function emptyPluginMetrics(): PluginMetricsSnapshot {
  return {
    memory_current_bytes: 0,
    memory_peak_bytes: 0,
    calls_total: 0,
    calls_in_flight: 0,
    fuel_consumed_total: 0,
    call_duration_us_total: 0,
    call_duration_us_max: 0,
    call_duration_buckets: [],
    lifecycle: {},
    lifecycle_last_unix: {},
    trap_reasons: {},
    memory_grow_denied_total: 0,
    table_grow_denied_total: 0,
    activation_us_total: 0,
    activation_us_max: 0,
    quota: {},
    authz: {},
    bus: {},
  }
}

function stateOfInfo(info: HostPluginInfo): { raw: string; error?: string } {
  if (typeof info.state === 'string') return { raw: info.state }
  return { raw: info.state?.state ?? '', error: info.state?.error }
}

/**
 * 指标 + 宿主清单合并为按状态 / 角色排序的插件行。
 *
 * - 指标行带 manifest 角色（L1 基础服务 / L2 内部业务 / L3 应用）；
 * - 宿主清单里有、指标快照里没有的 wasm 插件（装载失败 / 待授权）补一行，
 *   `metricsAvailable=false`——服务失联不能从台账里静默消失；
 * - `infos` 缺失（清单命令失败 / 移动端不提供）时仍以指标里的 plugin_id 出行，
 *   状态落 `unknown`——不把「查不到状态」显示成「未运行」。
 */
export function mergePluginRows(
  snapshot: MetricsSnapshot,
  infos: HostPluginInfo[] | null | undefined,
): PluginRow[] {
  const infoById = new Map<string, HostPluginInfo>()
  for (const info of infos ?? []) {
    if (info && typeof info.id === 'string') infoById.set(info.id, info)
  }

  const rows: PluginRow[] = Object.entries(snapshot.plugins).map(([id, metrics]) => {
    const info = infoById.get(id)
    const state = info ? stateOfInfo(info) : { raw: '', error: undefined }
    return {
      id,
      name: info?.name?.trim() || id,
      version: info?.version,
      kind: normalizePluginKind(info?.kind),
      state: displayStateOf(state.raw),
      stateRaw: state.raw,
      stateError: state.error,
      metricsAvailable: true,
      metrics,
    }
  })

  for (const [id, info] of infoById) {
    if (snapshot.plugins[id]) continue
    const state = stateOfInfo(info)
    const displayState = displayStateOf(state.raw)
    if (!HOST_ONLY_VISIBLE_STATES.has(displayState)) continue
    // 明确 ts-only 的插件不进入 wasm 运行时台账；缺 pluginType 的老宿主按异常态兜底
    if (isWasmBearingPluginType(info.pluginType) === false) continue
    rows.push({
      id,
      name: info.name?.trim() || id,
      version: info.version,
      kind: normalizePluginKind(info.kind),
      state: displayState,
      stateRaw: state.raw,
      stateError: state.error,
      metricsAvailable: false,
      metrics: emptyPluginMetrics(),
    })
  }

  return rows.sort((a, b) => {
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state]
    if (rank !== 0) return rank
    const roleRank = ROLE_RANK[a.kind] - ROLE_RANK[b.kind]
    if (roleRank !== 0) return roleRank
    return a.name.localeCompare(b.name)
  })
}

/**
 * 收集非插件维度段（如宿主任务池 `task`）。
 *
 * 只收对象段：标量 / 数组段不是 v1 消费面，静默跳过；`plugins` 是保留段。
 */
export function collectSystemSections(
  snapshot: MetricsSnapshot,
  opts: { includeTask?: boolean } = {},
): SystemSection[] {
  const includeTask = opts.includeTask ?? true
  return Object.entries(snapshot)
    .filter(([id, data]) => {
      if (id === 'plugins') return false
      if (!includeTask && id === 'task') return false
      return isRecord(data)
    })
    .map(([id, data]) => ({ id, data: data as Record<string, unknown> }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 数字千分位；缺失 / 非有限值 → `—` */
export function formatNumber(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  return NUMBER_FORMAT.format(Math.round(value))
}

/** 字节：B / KiB / MiB / GiB / TiB */
export function formatBytes(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  const sign = value < 0 ? '-' : ''
  let n = Math.abs(value)
  if (n < 1024) return `${sign}${Math.round(n)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let unit = -1
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024
    unit++
  }
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2
  return `${sign}${n.toFixed(digits)} ${units[unit]}`
}

/** 微秒：µs / ms / s（耗时指标统一口径） */
export function formatDurationUs(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  if (value < 1000) return `${Math.round(value)} µs`
  if (value < 1_000_000) {
    const ms = value / 1000
    return `${ms >= 100 ? ms.toFixed(0) : ms.toFixed(2)} ms`
  }
  return `${(value / 1_000_000).toFixed(2)} s`
}

/** 平均耗时（调用数为 0 → null，由 UI 显示 `—`） */
export function averageUs(
  total: number | null | undefined,
  calls: number | null | undefined,
): number | null {
  if (!isFiniteNumber(total) || !isFiniteNumber(calls) || calls <= 0) return null
  return total / calls
}

/**
 * 相邻两次采样的调用速率（次/秒）。
 * 计数回退（宿主重启 / 插件重载）或采样间隔过短时返回 null，由图表断开，
 * 不用负值或补点冒充连续数据。
 */
export function callRate(
  previousCalls: number | null | undefined,
  currentCalls: number | null | undefined,
  elapsedMs: number | null | undefined,
): number | null {
  if (
    !isFiniteNumber(previousCalls) ||
    !isFiniteNumber(currentCalls) ||
    !isFiniteNumber(elapsedMs) ||
    elapsedMs < 200
  ) {
    return null
  }
  const delta = currentCalls - previousCalls
  if (delta < 0) return null
  return delta / (elapsedMs / 1000)
}

/** 占比（分母 <= 0 → null；不除零、不把无上限说成 0%） */
export function usageRatio(
  part: number | null | undefined,
  whole: number | null | undefined,
): number | null {
  if (!isFiniteNumber(part) || !isFiniteNumber(whole) || whole <= 0) return null
  return part / whole
}

/** 占比格式化（0..1 → `xx.x%`；null → `—`） */
export function formatRatio(ratio: number | null | undefined): string {
  if (!isFiniteNumber(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

/** 记录映射求和（缺失 / 非有限值按 0 计） */
export function sumValues(map: Record<string, number> | null | undefined): number {
  if (!map) return 0
  return Object.values(map).reduce((sum, value) => (isFiniteNumber(value) ? sum + value : sum), 0)
}

/** 记录映射中非零项（按传入 key 顺序；用于 trap 原因 / 生命周期分布） */
export function nonZeroEntries(
  map: Record<string, number> | null | undefined,
  keys: readonly string[],
): Array<{ key: string; value: number }> {
  if (!map) return []
  return keys
    .map((key) => ({ key, value: map[key] ?? 0 }))
    .filter((entry) => isFiniteNumber(entry.value) && entry.value > 0)
}

/** 最近一次生命周期事件（时间戳最大；无记录 → null） */
export function latestLifecycle(
  map: Record<string, number> | null | undefined,
): { key: string; unix: number } | null {
  if (!map) return null
  let best: { key: string; unix: number } | null = null
  for (const [key, unix] of Object.entries(map)) {
    if (!isFiniteNumber(unix) || unix <= 0) continue
    if (!best || unix > best.unix) best = { key, unix }
  }
  return best
}

/** unix 秒 → 本地时分秒 */
export function formatUnixTime(unix: number | null | undefined, locale = 'zh-CN'): string {
  if (!isFiniteNumber(unix) || unix <= 0) return '—'
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(unix * 1000))
  } catch {
    return '—'
  }
}

/** 快照内所有插件的关键合计（KPI 条与预览面共用） */
export function summarize(snapshot: MetricsSnapshot): {
  pluginCount: number
  callsTotal: number
  callsInFlight: number
  memoryPeakBytes: number
  trapsTotal: number
} {
  const list: PluginMetricsSnapshot[] = Object.values(snapshot.plugins)
  return {
    pluginCount: list.length,
    callsTotal: list.reduce((sum, m) => sum + (m.calls_total ?? 0), 0),
    callsInFlight: list.reduce((sum, m) => sum + (m.calls_in_flight ?? 0), 0),
    memoryPeakBytes: list.reduce((sum, m) => sum + (m.memory_peak_bytes ?? 0), 0),
    trapsTotal: list.reduce((sum, m) => sum + sumValues(m.trap_reasons), 0),
  }
}

/** 错误对象 → 用户可读串（Tauri 信封 / Error / 字符串都兼容） */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (isRecord(error)) {
    const message = error.message ?? error.error
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}
