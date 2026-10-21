/**
 * Monitor 数据形状（移动端）
 *
 * 字段形状即宿主契约（与能力仓 `wasmnest-host-kit/src/metrics.rs` 的
 * `PluginMetricsSnapshot` 逐字段对应，snake_case）。移动端不从宿主拿插件清单
 * （PluginContext 只有本应用命令面），因此行只有 plugin_id + 指标，不伪造名称 / 状态。
 */

/** 单插件指标（宿主 `PluginMetricsSnapshot`） */
export interface PluginMetricsSnapshot {
  memory_current_bytes: number
  memory_peak_bytes: number
  calls_total: number
  calls_in_flight: number
  fuel_consumed_total: number
  call_duration_us_total: number
  call_duration_us_max: number
  call_duration_buckets: number[]
  lifecycle: Record<string, number>
  lifecycle_last_unix: Record<string, number>
  trap_reasons: Record<string, number>
  memory_grow_denied_total: number
  table_grow_denied_total: number
  activation_us_total: number
  activation_us_max: number
  quota: Record<string, number>
  authz: Record<string, number>
  bus: Record<string, number>
}

/** 全量快照：`plugins` 为插件维度，其余键为系统维度段（如 `task`） */
export type MetricsSnapshot = {
  plugins: Record<string, PluginMetricsSnapshot>
} & Record<string, unknown>

/** 插件指标行（移动端无宿主清单，name = plugin_id） */
export interface PluginMetricRow {
  id: string
  metrics: PluginMetricsSnapshot
}

/** 非插件维度段（移动端默认隐藏 `task`，见 useMonitor includeTask） */
export interface SystemSection {
  id: string
  data: Record<string, unknown>
}

/**
 * 本次打开期间的采样点（仅前端内存，不落盘、不上报）。
 * 速率为相邻采样的差值；页面卸载即丢失。
 */
export interface RuntimeSample {
  at: number
  callsTotal: number
  callsInFlight: number
  trapsTotal: number
}
