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

/** 宿主附加的插件元数据（`plugin_meta` 段；旧宿主可缺省） */
export interface PluginMeta {
  name?: string
  kind?: string
  monitorPanels?: Array<{ id: string; title: string; order?: number }>
}

/** 一条已注册的自定义监控面板（manifest 元数据 + 属主应用） */
export interface MonitorPanelRegistration {
  appId: string
  appName: string
  id: string
  title: string
  order: number
}

/** 全量快照：`plugins` 为插件维度，`plugin_meta` 为展示元数据，其余键为系统维度段 */
export type MetricsSnapshot = {
  plugins: Record<string, PluginMetricsSnapshot>
  plugin_meta?: Record<string, PluginMeta>
} & Record<string, unknown>

/** 插件指标行（name / kind 来自宿主 `plugin_meta`；缺失时回落 plugin_id） */
export interface PluginMetricRow {
  id: string
  name?: string
  kind?: string
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
