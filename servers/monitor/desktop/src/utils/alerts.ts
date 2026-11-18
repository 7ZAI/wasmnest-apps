/**
 * 预警引擎（桌面，纯函数）
 *
 * 输入 = 一次快照派生的平台总量 + 台账行 + 采样序列；输出 = 新的引擎状态与
 * 状态迁移（open / escalate / resolve）。**纯函数**：不碰定时器 / 存储 / 宿主，
 * 页面与单测共用同一份判据。
 *
 * 两类规则：
 * - `level`（内存占比 / 计算负载 / 插件状态）：连续越界 `breachSamples` 次才升警，
 *   连续正常 `recoverSamples` 次才解除——避免 1s 轮询下的抖动刷屏；
 *   状态类是确定性事实，用 `immediate` 跳过去抖。
 * - `event`（Trap 增量 / 任务池背压）：一次采样内出现增量即升警，窗口内累计；
 *   超过 `EVENT_ALERT_TTL_MS` 没有新增才解除。
 *
 * 阈值口径：内存规则的 `value / threshold` 是字节数（当前 / 上限），比例由消费方
 * 计算——通知里能同时给出百分比与绝对值，不丢精度。
 */
import type {
  Alert,
  AlertEngineEntry,
  AlertEngineState,
  AlertInput,
  AlertLevel,
  AlertRuleId,
  AlertSettings,
  AlertText,
  AlertTextContext,
  AlertTransition,
  PluginRow,
} from '../types'
import { formatBytes, formatNumber, formatRatio, isFiniteNumber, usageRatio } from './format'
import { quotaMemoryOf } from './platform'

/** 本应用 KV 里的设置键（改了结构就换版本号，旧键读失败回落默认值） */
export const ALERT_SETTINGS_KEY = 'monitor.alertSettings.v1'

/** 事件型预警：最后一次新增后多久自动解除（毫秒） */
export const EVENT_ALERT_TTL_MS = 60_000

/** Trap 增量达到该值即判 critical（单次采样内） */
const TRAP_CRITICAL_DELTA = 3
/** 任务池拒绝 + 丢弃合计达到该值即判 critical（单次采样内） */
const TASK_CRITICAL_DELTA = 5

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  notify: true,
  // 平台合计用绝对值（各插件配额之和不是共享池，比值没有真实上限语义）；
  // 默认 256 / 512 MiB：单插件默认配额 64 MiB，正常装机合计远低于此。
  platformMemoryWarnBytes: 256 * 1024 * 1024,
  platformMemoryCriticalBytes: 512 * 1024 * 1024,
  pluginMemoryWarn: 0.9,
  pluginMemoryCritical: 0.98,
  // 燃料单位没有绝对基准：默认关闭，由用户按机器实测填写（不猜一个假阈值）
  computeWarnFuelPerSecond: 0,
  breachSamples: 3,
  recoverSamples: 2,
  cooldownMs: 5 * 60_000,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return fallback
  return clamp(value, min, max)
}

function pickInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return fallback
  return Math.round(clamp(value, min, max))
}

/**
 * 校验 / 归一化持久化设置。
 *
 * 缺失、类型错误、越界一律回落默认值并夹到合法区间；`critical` 必须严格大于
 * `warn`（否则两条规则会互相吞掉）——损坏数据不应让预警静默失效。
 */
export function normalizeAlertSettings(raw: unknown): AlertSettings {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  const record = isRecord(value) ? value : {}
  const defaults = DEFAULT_ALERT_SETTINGS

  const platformMemoryWarnBytes = Math.round(
    pickNumber(record.platformMemoryWarnBytes, defaults.platformMemoryWarnBytes, 0, 1e12),
  )
  const platformMemoryCriticalBytes = Math.max(
    platformMemoryWarnBytes > 0 ? platformMemoryWarnBytes + 1 : 0,
    Math.round(
      pickNumber(record.platformMemoryCriticalBytes, defaults.platformMemoryCriticalBytes, 0, 1e12),
    ),
  )
  const pluginMemoryWarn = pickNumber(
    record.pluginMemoryWarn,
    defaults.pluginMemoryWarn,
    0.05,
    0.99,
  )
  const pluginMemoryCritical = Math.max(
    pluginMemoryWarn + 0.01,
    pickNumber(record.pluginMemoryCritical, defaults.pluginMemoryCritical, 0.06, 1),
  )

  return {
    enabled: pickBoolean(record.enabled, defaults.enabled),
    notify: pickBoolean(record.notify, defaults.notify),
    platformMemoryWarnBytes,
    platformMemoryCriticalBytes,
    pluginMemoryWarn,
    pluginMemoryCritical: Math.min(1, pluginMemoryCritical),
    computeWarnFuelPerSecond: pickNumber(
      record.computeWarnFuelPerSecond,
      defaults.computeWarnFuelPerSecond,
      0,
      1e15,
    ),
    breachSamples: pickInteger(record.breachSamples, defaults.breachSamples, 1, 20),
    recoverSamples: pickInteger(record.recoverSamples, defaults.recoverSamples, 1, 20),
    cooldownMs: pickInteger(record.cooldownMs, defaults.cooldownMs, 0, 3_600_000),
  }
}

/** 严重度排序（warning < critical） */
export function severityRank(level: AlertLevel): number {
  return level === 'critical' ? 2 : 1
}

/** 单插件配额比例（只有 plugin-memory 有意义；平台合计用绝对阈值） */
export function alertRatio(alert: Alert): number | null {
  if (alert.rule !== 'plugin-memory') return null
  return usageRatio(alert.value, alert.threshold)
}

/** 新建空引擎状态 */
export function createAlertState(): AlertEngineState {
  return { entries: {} }
}

interface Observation {
  id: string
  rule: AlertRuleId
  level: AlertLevel
  mode: 'level' | 'event'
  target?: string
  value: number
  threshold: number
  state?: string
  secondary?: number
  /** level：首次越界即判警（状态类事实） */
  immediate?: boolean
  /** event：无新增后自动解除的时长 */
  ttlMs?: number
}

function alertId(rule: AlertRuleId, target?: string): string {
  return `${rule}:${target ?? '-'}`
}

/** 相邻两次采样的非负增量（计数回退 / 缺基线 → null） */
function deltaBetween(previous: number | undefined, current: number | undefined): number | null {
  if (!isFiniteNumber(previous) || !isFiniteNumber(current)) return null
  const delta = current - previous
  return delta >= 0 ? delta : null
}

/** 从一次采样输入派生全部越界观测（未越界的规则不出现在结果里） */
export function buildObservations(input: AlertInput, settings: AlertSettings): Observation[] {
  const out: Observation[] = []
  const { totals, rows, samples } = input

  const memoryTotal = totals.memoryCurrentBytes
  if (
    settings.platformMemoryCriticalBytes > 0 &&
    memoryTotal >= settings.platformMemoryCriticalBytes
  ) {
    out.push({
      id: alertId('platform-memory'),
      rule: 'platform-memory',
      level: 'critical',
      mode: 'level',
      value: memoryTotal,
      threshold: settings.platformMemoryCriticalBytes,
    })
  } else if (
    settings.platformMemoryWarnBytes > 0 &&
    memoryTotal >= settings.platformMemoryWarnBytes
  ) {
    out.push({
      id: alertId('platform-memory'),
      rule: 'platform-memory',
      level: 'warning',
      mode: 'level',
      value: memoryTotal,
      threshold: settings.platformMemoryWarnBytes,
    })
  }

  for (const row of rows) {
    if (!row.metricsAvailable) continue
    const quota = quotaMemoryOf(row.metrics)
    if (quota === null) continue
    const ratio = (row.metrics.memory_current_bytes ?? 0) / quota
    const level: AlertLevel | null =
      ratio >= settings.pluginMemoryCritical
        ? 'critical'
        : ratio >= settings.pluginMemoryWarn
          ? 'warning'
          : null
    if (level === null) continue
    out.push({
      id: alertId('plugin-memory', row.id),
      rule: 'plugin-memory',
      level,
      mode: 'level',
      target: row.id,
      value: row.metrics.memory_current_bytes ?? 0,
      threshold: quota,
    })
  }

  // 状态类：错误 / 降级。待授权留在台账与 hero 的「需关注」，不重复发预警
  for (const row of rows) {
    if (row.state !== 'error' && row.state !== 'degraded') continue
    out.push({
      id: alertId('plugin-state', row.id),
      rule: 'plugin-state',
      level: row.state === 'error' ? 'critical' : 'warning',
      mode: 'level',
      target: row.id,
      value: 1,
      threshold: 1,
      state: row.stateRaw || row.state,
      immediate: true,
    })
  }

  if (settings.computeWarnFuelPerSecond > 0 && totals.fuelPerSecond !== null) {
    const rate = totals.fuelPerSecond
    if (rate >= settings.computeWarnFuelPerSecond * 2) {
      out.push({
        id: alertId('compute-load'),
        rule: 'compute-load',
        level: 'critical',
        mode: 'level',
        value: rate,
        threshold: settings.computeWarnFuelPerSecond,
      })
    } else if (rate >= settings.computeWarnFuelPerSecond) {
      out.push({
        id: alertId('compute-load'),
        rule: 'compute-load',
        level: 'warning',
        mode: 'level',
        value: rate,
        threshold: settings.computeWarnFuelPerSecond,
      })
    }
  }

  if (samples.length >= 2) {
    const previous = samples[samples.length - 2]
    const current = samples[samples.length - 1]

    const trapDelta = deltaBetween(previous.trapsTotal, current.trapsTotal)
    if (trapDelta !== null && trapDelta > 0) {
      out.push({
        id: alertId('trap-activity'),
        rule: 'trap-activity',
        level: trapDelta >= TRAP_CRITICAL_DELTA ? 'critical' : 'warning',
        mode: 'event',
        value: trapDelta,
        threshold: 1,
        ttlMs: EVENT_ALERT_TTL_MS,
      })
    }

    const rejected = deltaBetween(previous.taskRejectedTotal, current.taskRejectedTotal) ?? 0
    const dropped = deltaBetween(previous.taskDroppedTotal, current.taskDroppedTotal) ?? 0
    if (rejected > 0 || dropped > 0) {
      out.push({
        id: alertId('task-backpressure'),
        rule: 'task-backpressure',
        level: rejected + dropped >= TASK_CRITICAL_DELTA ? 'critical' : 'warning',
        mode: 'event',
        value: rejected,
        threshold: 1,
        secondary: dropped,
        ttlMs: EVENT_ALERT_TTL_MS,
      })
    }
  }

  return out
}

type AlertEntry = AlertEngineEntry

function toEntry(observation: Observation, now: number, settings: AlertSettings): AlertEntry {
  const openNow =
    observation.mode === 'event' || observation.immediate === true || settings.breachSamples <= 1
  return {
    alert: {
      id: observation.id,
      rule: observation.rule,
      level: observation.level,
      target: observation.target,
      value: observation.value,
      threshold: observation.threshold,
      state: observation.state,
      secondary: observation.secondary,
      since: now,
      updatedAt: now,
    },
    active: openNow,
    mode: observation.mode,
    ttlMs: observation.ttlMs ?? 0,
    immediate: observation.immediate === true,
    breaches: 1,
    healthy: 0,
  }
}

function applyObservation(
  entry: AlertEntry,
  observation: Observation,
  now: number,
  settings: AlertSettings,
  transitions: AlertTransition[],
): void {
  entry.mode = observation.mode
  entry.ttlMs = observation.ttlMs ?? 0
  entry.immediate = observation.immediate === true

  if (observation.mode === 'event') {
    const escalated =
      entry.active && severityRank(observation.level) > severityRank(entry.alert.level)
    const next: Alert = {
      ...entry.alert,
      level: escalated ? observation.level : entry.alert.level,
      value: (entry.active ? entry.alert.value : 0) + observation.value,
      threshold: observation.threshold,
      secondary:
        observation.secondary === undefined
          ? entry.alert.secondary
          : (entry.active ? (entry.alert.secondary ?? 0) : 0) + observation.secondary,
      updatedAt: now,
    }
    entry.alert = next
    entry.healthy = 0
    if (!entry.active) {
      entry.active = true
      entry.breaches = 1
      transitions.push({ type: 'open', alert: next, at: now })
      return
    }
    if (escalated) transitions.push({ type: 'escalate', alert: next, at: now })
    return
  }

  const escalated =
    entry.active && severityRank(observation.level) > severityRank(entry.alert.level)
  const next: Alert = {
    ...entry.alert,
    level: observation.level,
    value: observation.value,
    threshold: observation.threshold,
    state: observation.state,
    secondary: observation.secondary,
    updatedAt: now,
  }
  entry.alert = next
  entry.healthy = 0

  if (!entry.active) {
    entry.breaches += 1
    const required = entry.immediate ? 1 : settings.breachSamples
    if (entry.breaches >= required) {
      entry.active = true
      transitions.push({ type: 'open', alert: next, at: now })
    }
    return
  }
  if (escalated) transitions.push({ type: 'escalate', alert: next, at: now })
}

function resolveEntry(entry: AlertEntry, now: number, transitions: AlertTransition[]): void {
  transitions.push({ type: 'resolve', alert: { ...entry.alert, updatedAt: now }, at: now })
}

/**
 * 评估一次：返回新状态 + 迁移。
 *
 * `rows` / `samples` 只读；引擎不依赖 Vue，可直接在测试里驱动。
 */
export function evaluateAlerts(
  previousState: AlertEngineState,
  input: AlertInput,
  settings: AlertSettings,
): { state: AlertEngineState; transitions: AlertTransition[] } {
  const transitions: AlertTransition[] = []
  const now = input.now

  // 总开关关闭：清空状态（不通知「恢复」，也不留幽灵告警）
  if (!settings.enabled) {
    return { state: createAlertState(), transitions: [] }
  }

  const entries: Record<string, AlertEntry> = {}
  for (const [id, entry] of Object.entries(previousState.entries)) {
    entries[id] = { ...entry, alert: { ...entry.alert } }
  }

  const observations = buildObservations(input, settings)
  const byId = new Map(observations.map((observation) => [observation.id, observation]))

  for (const [id, entry] of Object.entries(entries)) {
    const observation = byId.get(id)
    if (observation) {
      applyObservation(entry, observation, now, settings, transitions)
      continue
    }

    if (!entry.active) {
      delete entries[id]
      continue
    }
    entry.healthy += 1
    const recovered =
      entry.mode === 'event'
        ? now - entry.alert.updatedAt >= entry.ttlMs
        : entry.healthy >= settings.recoverSamples
    if (recovered) {
      resolveEntry(entry, now, transitions)
      delete entries[id]
    }
  }

  for (const observation of observations) {
    if (entries[observation.id]) continue
    const entry = toEntry(observation, now, settings)
    entries[observation.id] = entry
    if (entry.active) {
      transitions.push({ type: 'open', alert: entry.alert, at: now })
    }
  }

  return { state: { entries }, transitions }
}

/** 活动预警排序：critical 优先，其次按插件名 / 规则稳定排序 */
export function sortAlerts(alerts: readonly Alert[], rows: readonly PluginRow[]): Alert[] {
  const names = new Map(rows.map((row) => [row.id, row.name]))
  return [...alerts].sort((a, b) => {
    const rank = severityRank(b.level) - severityRank(a.level)
    if (rank !== 0) return rank
    const nameDiff = (names.get(a.target ?? '') ?? a.target ?? '').localeCompare(
      names.get(b.target ?? '') ?? b.target ?? '',
    )
    if (nameDiff !== 0) return nameDiff
    return a.id.localeCompare(b.id)
  })
}

/** 活动预警计数 */
export function countAlerts(alerts: readonly Alert[]): { warning: number; critical: number } {
  let warning = 0
  let critical = 0
  for (const alert of alerts) {
    if (alert.level === 'critical') critical += 1
    else warning += 1
  }
  return { warning, critical }
}

/** 预警文案（页面与系统通知共用）。
 *
 * `nameOf` 缺失名称时回落 plugin_id；`t` 由调用方注入（页面走 app i18n，
 * 单测走直返 key 的桩）。
 */
export function alertMessage(alert: Alert, context: AlertTextContext): AlertText {
  const { t, nameOf } = context
  const name = alert.target ? nameOf(alert.target) : ''
  const ratio = alertRatio(alert)

  switch (alert.rule) {
    case 'platform-memory':
      return {
        title: t('monitor.alerts.rule.platformMemory'),
        body: t('monitor.alerts.body.platformMemory', {
          current: formatBytes(alert.value),
          threshold: formatBytes(alert.threshold),
        }),
      }
    case 'plugin-memory':
      return {
        title: t('monitor.alerts.rule.pluginMemory', { name }),
        body: t('monitor.alerts.body.pluginMemory', {
          ratio: formatRatio(ratio),
          current: formatBytes(alert.value),
          quota: formatBytes(alert.threshold),
        }),
      }
    case 'plugin-state':
      return {
        title: t('monitor.alerts.rule.pluginState', { name }),
        body: t('monitor.alerts.body.pluginState', {
          state: t(`monitor.state.${alert.state ?? ''}`),
        }),
      }
    case 'trap-activity':
      return {
        title: t('monitor.alerts.rule.traps'),
        body: t('monitor.alerts.body.traps', { n: formatNumber(alert.value) }),
      }
    case 'compute-load':
      return {
        title: t('monitor.alerts.rule.computeLoad'),
        body: t('monitor.alerts.body.computeLoad', {
          rate: formatNumber(alert.value),
          threshold: formatNumber(alert.threshold),
        }),
      }
    case 'task-backpressure':
      return {
        title: t('monitor.alerts.rule.taskBackpressure'),
        body: t('monitor.alerts.body.taskBackpressure', {
          rejected: formatNumber(alert.value),
          dropped: formatNumber(alert.secondary ?? 0),
        }),
      }
  }
}

/** 已解除预警的文案（沿用原规则标题 + 恢复说明） */
export function resolvedMessage(
  alert: Alert,
  context: AlertTextContext,
  resolvedAt: number,
): AlertText {
  const base = alertMessage(alert, context)
  return {
    title: context.t('monitor.alerts.resolved'),
    body: context.t('monitor.alerts.body.recovered', {
      title: base.title,
      since: formatNumber(Math.max(0, resolvedAt - alert.since) / 1000),
    }),
  }
}
