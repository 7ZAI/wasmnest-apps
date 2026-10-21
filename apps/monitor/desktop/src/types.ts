/**
 * Monitor 数据形状（桌面端）
 *
 * **字段形状即宿主契约**：`PluginMetricsSnapshot` 与能力仓
 * `wasmnest-host-kit/src/metrics.rs` 的同名结构逐字段对应（snake_case，无
 * serde rename）。宿主新增字段时前端无需同步类型即可多拿到（索引签名允许
 * 未知段），但这里列出的字段是 v1 页面读取面。
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

/** 装配角色（manifest `type`；旧宿主缺省时落 unknown，不猜成应用） */
export type PluginKindRole = 'basic-service' | 'internal-business' | 'business-app' | 'unknown'

/** 桌面宿主 `plugin_list_loaded` 条目（只取页面用到的字段） */
export interface HostPluginInfo {
  id: string
  name: string
  version?: string
  /** 产物形态：rust / rust-ts / wasm / ts-only */
  pluginType?: string
  /** 装配角色（L1 基础服务 / L2 内部业务 / L3 应用） */
  kind?: string
  state?: { state?: string; error?: string } | string
}

/** 壳展示态（与宿主 `AppDisplayState` 同口径） */
export type PluginDisplayState =
  'running' | 'degraded' | 'approval' | 'error' | 'dormant' | 'unknown'

/** 合并后的插件行（指标 + 宿主清单状态） */
export interface PluginRow {
  id: string
  name: string
  version?: string
  kind: PluginKindRole
  state: PluginDisplayState
  stateRaw: string
  stateError?: string
  /**
   * 是否有运行时指标。宿主清单里存在、但未实例化（装载失败 / 待授权等）的
   * wasm 插件也会出行，此时为 false，页面不得用零值冒充真实指标。
   */
  metricsAvailable: boolean
  metrics: PluginMetricsSnapshot
}

/** 非插件维度段（宿主任务池等） */
export interface SystemSection {
  id: string
  data: Record<string, unknown>
}

/**
 * 本次打开期间的采样点（仅前端内存，不落盘、不上报）。
 * 速率为相邻采样的差值；页面卸载即丢失，属于实时展示而非历史持久化。
 */
export interface RuntimeSample {
  at: number
  callsTotal: number
  callsInFlight: number
  trapsTotal: number
}

/** 宿主任务池快照（`task` 段，camelCase；桌面端展示） */
export interface TaskMetrics {
  jobsSubmittedTotal?: number
  jobsActive?: number
  jobsRejectedTotal?: number
  unitsCompletedTotal?: number
  concurrentUnitsPeak?: number
  eventsDroppedTotal?: number
  poolThreads?: number
}
