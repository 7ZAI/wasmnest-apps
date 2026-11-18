/**
 * 平台总览聚合（桌面）
 *
 * 只做**求和 / 比值 / 速率差分**：快照里每个插件的 wasm 线性内存、配额与计数
 * 是宿主事实，本层不估算、不补零。
 *
 * 口径边界（写清楚，别让页面把推断说成事实）：
 * - 「内存」= 全部已加载 wasm 插件的线性内存合计，**不是宿主进程 RSS**
 *   （整机口径在快照的 `process` 段，见 `utils/process.ts` 与 `HostProcessPanel`）；
 * - 「配额」= 各插件配额之和，是聚合刻度、不是共享池；
 * - 「CPU」= 宿主没有把「进程级 CPU」算进本层（`metrics:read` 的 wasm 段只覆盖
 *   运行时），本页用**燃料消耗速率**（宿主燃料 = 执行指令预算）反映 wasm
 *   计算负载，命名与文案都不写成「CPU 占用」。宿主进程树的真实 CPU 在
 *   `process` 段（`webview.cpuPercent` / `self.cpuPercent`），由宿主单独下发，
 *   本层不搬运、不换算——两套口径互不替代。
 */
import type {
  MemoryConsumer,
  MetricsSnapshot,
  PlatformTotals,
  PluginMetricsSnapshot,
  PluginRow,
  RuntimeSample,
} from '../types'
import { isFiniteNumber, sumValues } from './format'

/** 速率计算的最小间隔（毫秒）：轮询抖动过小时差值噪声大，宁可断开也不画假速率 */
const MIN_RATE_ELAPSED_MS = 200

function finiteOrZero(value: unknown): number {
  return isFiniteNumber(value) ? value : 0
}

/** 单插件内存配额（未声明 / 非正数 → null，不把「无上限」当作 0 上限） */
export function quotaMemoryOf(metrics: PluginMetricsSnapshot | null | undefined): number | null {
  const raw = metrics?.quota?.memory_bytes
  if (!isFiniteNumber(raw) || raw <= 0) return null
  return raw
}

/**
 * 相邻采样的增量速率（单位/秒）。
 *
 * 计数回退（宿主重启 / 插件重载）或间隔过短 → `null`（调用方断开曲线，
 * 不用 0 或负值冒充连续数据）。
 */
export function ratePerSecond(
  previous: number | null | undefined,
  current: number | null | undefined,
  elapsedMs: number | null | undefined,
): number | null {
  if (!isFiniteNumber(previous) || !isFiniteNumber(current) || !isFiniteNumber(elapsedMs)) {
    return null
  }
  if (elapsedMs < MIN_RATE_ELAPSED_MS) return null
  const delta = current - previous
  if (delta < 0) return null
  return delta / (elapsedMs / 1000)
}

/** 从采样序列取最后两个点的间隔（不足两点 → null） */
export function sampleElapsedMs(samples: readonly RuntimeSample[]): number | null {
  if (samples.length < 2) return null
  const previous = samples[samples.length - 2]
  const current = samples[samples.length - 1]
  return current.at - previous.at
}

/** 快照 → 平台总览（速率用传入的采样序列，缺省只算合计） */
export function platformTotals(
  snapshot: MetricsSnapshot | null,
  samples: readonly RuntimeSample[] = [],
): PlatformTotals {
  const list: PluginMetricsSnapshot[] = snapshot ? Object.values(snapshot.plugins ?? {}) : []
  const memoryCurrentBytes = list.reduce((sum, m) => sum + finiteOrZero(m.memory_current_bytes), 0)
  const memoryPeakBytes = list.reduce((sum, m) => sum + finiteOrZero(m.memory_peak_bytes), 0)
  const memoryQuotaBytes = list.reduce((sum, m) => sum + (quotaMemoryOf(m) ?? 0), 0)
  const fuelTotal = list.reduce((sum, m) => sum + finiteOrZero(m.fuel_consumed_total), 0)
  const trapsTotal = list.reduce((sum, m) => sum + sumValues(m.trap_reasons), 0)

  const previous = samples.length >= 2 ? samples[samples.length - 2] : null
  const current = samples.length >= 1 ? samples[samples.length - 1] : null
  const elapsedMs = previous && current ? current.at - previous.at : null

  return {
    pluginCount: list.length,
    memoryCurrentBytes,
    memoryPeakBytes,
    memoryQuotaBytes,
    memoryRatio: memoryQuotaBytes > 0 ? memoryCurrentBytes / memoryQuotaBytes : null,
    callsTotal: list.reduce((sum, m) => sum + finiteOrZero(m.calls_total), 0),
    callsInFlight: list.reduce((sum, m) => sum + finiteOrZero(m.calls_in_flight), 0),
    trapsTotal,
    fuelTotal,
    fuelPerSecond:
      previous && current ? ratePerSecond(previous.fuelTotal, current.fuelTotal, elapsedMs) : null,
    callsPerSecond:
      previous && current
        ? ratePerSecond(previous.callsTotal, current.callsTotal, elapsedMs)
        : null,
  }
}

/**
 * 平台内存占用排行（只统计有指标且当前占用 > 0 的插件）。
 *
 * `share` 用传入的合计作分母：没有合计时回落为排行内部之和，二者都为 0 → null。
 */
export function topMemoryConsumers(
  rows: readonly PluginRow[],
  limit = 3,
  totalBytes?: number,
): MemoryConsumer[] {
  const candidates = rows.filter(
    (row) => row.metricsAvailable && finiteOrZero(row.metrics.memory_current_bytes) > 0,
  )
  const denominator =
    isFiniteNumber(totalBytes) && totalBytes > 0
      ? totalBytes
      : candidates.reduce((sum, row) => sum + finiteOrZero(row.metrics.memory_current_bytes), 0)

  return candidates
    .map((row) => {
      const bytes = finiteOrZero(row.metrics.memory_current_bytes)
      return {
        id: row.id,
        name: row.name,
        bytes,
        share: denominator > 0 ? bytes / denominator : null,
      }
    })
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}

/** 大倍数紧凑显示（燃料是很长的计数；百万级以后截断成 1.2M） */
const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** 燃料 / 计数紧凑格式化；缺失或非有限值 → `—` */
export function formatCompact(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  return COMPACT_FORMAT.format(value)
}

/** 速率格式化（单位/秒）；`null` → `—` */
export function formatRate(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '—'
  return COMPACT_FORMAT.format(Math.round(value))
}

/**
 * 读宿主任务池累计计数（`task` 段，camelCase）。
 *
 * 快照没有该段 / 值为非数字时字段缺省——不把「没有任务池」补成 0，
 * 否则采样差分会把缺失当成「归零」并误报背压。
 */
export function taskCountersOf(snapshot: MetricsSnapshot | null): {
  rejectedTotal?: number
  droppedTotal?: number
} {
  const section = snapshot?.task
  if (!section || typeof section !== 'object' || Array.isArray(section)) return {}
  const record = section as Record<string, unknown>
  const rejected = record.jobsRejectedTotal
  const dropped = record.eventsDroppedTotal
  return {
    rejectedTotal: isFiniteNumber(rejected) ? rejected : undefined,
    droppedTotal: isFiniteNumber(dropped) ? dropped : undefined,
  }
}
