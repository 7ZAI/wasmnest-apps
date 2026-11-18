/**
 * Monitor（移动端）纯函数层：快照校验 / 数值格式化 / 短 id
 *
 * 与桌面端同口径（字段形状 = 宿主契约）；移动端没有宿主插件清单，故没有
 * mergePluginRows / 状态映射。缺失 / 非法值统一 `—`，不把 undefined 渲染成 0。
 */
import type {
  MetricsSnapshot,
  PlatformTotals,
  PluginMetricRow,
  PluginMetricsSnapshot,
  RuntimeSample,
  SystemSection,
} from '../types'

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
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
  if (!isRecord(value)) throw new Error('monitor.snapshot returned a non-object payload')
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

/** 指标条目 → 行（按 plugin_id 排序；合并宿主 `plugin_meta` 的 name / kind） */
export function toRows(snapshot: MetricsSnapshot): PluginMetricRow[] {
  const meta = snapshot.plugin_meta ?? {}
  return Object.entries(snapshot.plugins)
    .map(([id, metrics]) => ({
      id,
      name: meta[id]?.name,
      kind: meta[id]?.kind,
      metrics,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 是否为服务型角色（L1 基础服务 / L2 内部业务） */
export function isServiceKind(kind: string | undefined): boolean {
  return kind === 'basic-service' || kind === 'internal-business'
}

/** 角色展示 key（unknown 返回 null，不伪造徽标） */
export function roleI18nKey(kind: string | undefined): string | null {
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

/** 非插件维度段（默认隐藏 task：桌面宿主任务池在移动端不作为消费面）
 *
 * `process` 段已升级为**专用卡片**（`HostProcessCard` + `utils/process.ts`）：
 * 不再进裸键名列表，否则同一份数据会在页面上出现两次。
 */
export function collectSystemSections(
  snapshot: MetricsSnapshot,
  opts: { includeTask?: boolean } = {},
): SystemSection[] {
  const includeTask = opts.includeTask ?? false
  return Object.entries(snapshot)
    .filter(([id, data]) => {
      if (id === 'plugins' || id === 'plugin_meta' || id === 'process') return false
      if (!includeTask && id === 'task') return false
      return isRecord(data)
    })
    .map(([id, data]) => ({ id, data: data as Record<string, unknown> }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 展示用短 id（只剥固定前缀，不改写身份） */
export function shortPluginId(id: string): string {
  const prefix = 'com.wasmnest.'
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/** 数字千分位；缺失 / 非有限值 → `—` */
export function formatNumber(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  return NUMBER_FORMAT.format(Math.round(value))
}

/** 百分比（输入已是 0..100 的百分数，如宿主进程 CPU）；保留一位小数 */
export function formatPercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  return `${value.toFixed(1)}%`
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

/** 微秒：µs / ms / s */
export function formatDurationUs(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  if (value < 1000) return `${Math.round(value)} µs`
  if (value < 1_000_000) {
    const ms = value / 1000
    return `${ms >= 100 ? ms.toFixed(0) : ms.toFixed(2)} ms`
  }
  return `${(value / 1_000_000).toFixed(2)} s`
}

/** 平均耗时（调用数为 0 → null） */
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

/** 占比（分母 <= 0 → null） */
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

/** 记录映射求和 */
export function sumValues(map: Record<string, number> | null | undefined): number {
  if (!map) return 0
  return Object.values(map).reduce((sum, value) => (isFiniteNumber(value) ? sum + value : sum), 0)
}

/** 记录映射中非零项（按传入 key 顺序） */
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
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(unix * 1000))
  } catch {
    return '—'
  }
}

/** 快照关键合计（KPI 条） */
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

/** 错误对象 → 用户可读串 */ export function describeError(error: unknown): string {
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

// ==================== 平台总览（全部 wasm 合计） ====================

/** 单插件内存配额（未声明 / 非正数 → null，不把「无上限」当 0 上限） */
export function quotaMemoryOf(metrics: PluginMetricsSnapshot | null | undefined): number | null {
  const raw = metrics?.quota?.memory_bytes
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return raw
}

/** 相邻采样的增量速率（单位/秒）；计数回退 / 间隔过短 → null */
export function ratePerSecond(
  previous: number | null | undefined,
  current: number | null | undefined,
  elapsedMs: number | null | undefined,
): number | null {
  if (
    typeof previous !== 'number' ||
    typeof current !== 'number' ||
    typeof elapsedMs !== 'number' ||
    !Number.isFinite(previous) ||
    !Number.isFinite(current) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 200
  ) {
    return null
  }
  const delta = current - previous
  return delta < 0 ? null : delta / (elapsedMs / 1000)
}

/** 快照 + 采样序列 → 平台总览 */
export function platformTotals(
  snapshot: MetricsSnapshot | null,
  samples: readonly RuntimeSample[] = [],
): PlatformTotals {
  const list: PluginMetricsSnapshot[] = snapshot ? Object.values(snapshot.plugins ?? {}) : []
  const memoryCurrentBytes = list.reduce(
    (sum, m) => sum + (Number.isFinite(m.memory_current_bytes) ? m.memory_current_bytes : 0),
    0,
  )
  const memoryPeakBytes = list.reduce(
    (sum, m) => sum + (Number.isFinite(m.memory_peak_bytes) ? m.memory_peak_bytes : 0),
    0,
  )
  const memoryQuotaBytes = list.reduce((sum, m) => sum + (quotaMemoryOf(m) ?? 0), 0)
  const fuelTotal = list.reduce(
    (sum, m) => sum + (Number.isFinite(m.fuel_consumed_total) ? m.fuel_consumed_total : 0),
    0,
  )
  const previous = samples.length >= 2 ? samples[samples.length - 2] : null
  const current = samples.length >= 1 ? samples[samples.length - 1] : null
  const elapsedMs = previous && current ? current.at - previous.at : null

  return {
    pluginCount: list.length,
    memoryCurrentBytes,
    memoryPeakBytes,
    memoryQuotaBytes,
    memoryRatio: memoryQuotaBytes > 0 ? memoryCurrentBytes / memoryQuotaBytes : null,
    callsTotal: list.reduce(
      (sum, m) => sum + (Number.isFinite(m.calls_total) ? m.calls_total : 0),
      0,
    ),
    fuelTotal,
    fuelPerSecond:
      previous && current ? ratePerSecond(previous.fuelTotal, current.fuelTotal, elapsedMs) : null,
    callsPerSecond:
      previous && current
        ? ratePerSecond(previous.callsTotal, current.callsTotal, elapsedMs)
        : null,
  }
}

/** 大倍数紧凑显示（燃料是很长的计数） */
const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** 燃料 / 计数紧凑格式化；缺失或非有限值 → `—` */
export function formatCompact(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return COMPACT_FORMAT.format(value)
}

/** 速率格式化（单位/秒）；null → `—` */
export function formatRate(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return COMPACT_FORMAT.format(Math.round(value))
}
