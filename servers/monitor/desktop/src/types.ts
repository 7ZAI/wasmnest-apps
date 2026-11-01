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
  /** 产物形态：frontend / backend / full（语言无关三档，wasmnest-apps#21；旧值已退役） */
  pluginType?: string
  /** 装配角色（L1 基础服务 / L2 内部业务 / L3 应用） */
  kind?: string
  /** 扩展点声明（monitorPanels 用于自定义面板页签） */
  contributes?: {
    monitorPanels?: Array<{ id: string; title: string; order?: number }>
  }
  state?: { state?: string; error?: string } | string
}

/** 一条已注册的自定义监控面板（manifest 元数据 + 属主应用） */
export interface MonitorPanelRegistration {
  appId: string
  appName: string
  id: string
  title: string
  order: number
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
 *
 * 平台总量字段可缺省：旧快照 / 测试夹具只给调用与 Trap 时，速率按 `null`
 * 处理（不把「没有基线」说成 0）。
 */
export interface RuntimeSample {
  at: number
  callsTotal: number
  callsInFlight: number
  trapsTotal: number
  /** 所有插件的 wasm 线性内存合计（字节） */
  memoryCurrentBytes?: number
  /** 所有插件的 wasm 线性内存峰值合计（字节） */
  memoryPeakBytes?: number
  /** 所有插件的燃料消耗合计（宿主计数单位） */
  fuelTotal?: number
  /** 宿主任务池累计拒绝数（`task` 段；快照没有该段时缺省） */
  taskRejectedTotal?: number
  /** 宿主任务池累计事件丢弃数（`task` 段；快照没有该段时缺省） */
  taskDroppedTotal?: number
}

/**
 * 平台总览（全部 wasm 插件的合计 / 比值）。
 *
 * 只从快照求和，不做估算：`memoryQuotaBytes` 是各插件配额之和（不是共享池），
 * 作为「平台 wasm 内存已用 / 全部上限」的聚合刻度；快照未声明配额时为 0，
 * 比值落 `null`（UI 显示 —，不冒充 0%）。
 */
export interface PlatformTotals {
  pluginCount: number
  memoryCurrentBytes: number
  memoryPeakBytes: number
  memoryQuotaBytes: number
  /** `memoryCurrentBytes / memoryQuotaBytes`；分母 0 → null */
  memoryRatio: number | null
  callsTotal: number
  callsInFlight: number
  trapsTotal: number
  fuelTotal: number
  /** 相邻采样的燃料速率（宿主计数单位/秒）；无基线 / 计数回退 → null */
  fuelPerSecond: number | null
  /** 相邻采样的调用速率（次/秒）；无基线 / 计数回退 → null */
  callsPerSecond: number | null
}

/** 平台内存占用排行条目（台账行派生，只用于总览展示） */
export interface MemoryConsumer {
  id: string
  name: string
  bytes: number
  /** 占平台 wasm 内存合计的比例；合计为 0 → null */
  share: number | null
}

/** 预警等级（warning = 关注；critical = 需立即处理） */
export type AlertLevel = 'warning' | 'critical'

/** 预警规则 id（稳定字面；通知抑制 / 测试断言都按它） */
export type AlertRuleId =
  | 'platform-memory'
  | 'plugin-memory'
  | 'plugin-state'
  | 'trap-activity'
  | 'compute-load'
  | 'task-backpressure'

/** 一条活动 / 已解除的预警 */
export interface Alert {
  /** `<rule>:<target|->`，同一目标同一规则只保留一条 */
  id: string
  rule: AlertRuleId
  level: AlertLevel
  /** 插件维度规则的目标 plugin_id */
  target?: string
  /** 触发值（比值 / 速率 / 计数，单位随规则） */
  value: number
  /** 触发阈值（与 value 同单位） */
  threshold: number
  /** 附加状态字面（plugin-state 规则：宿主状态原值） */
  state?: string
  /** 附加热力值（task-backpressure：事件丢弃增量） */
  secondary?: number
  /** 首次越界时间（毫秒；持续时长从这里算） */
  since: number
  /** 最近一次更新（越界刷新 / 升级 / 事件累计） */
  updatedAt: number
}

/** 已解除的预警（页面本次打开期间保留最近若干条） */
export interface ResolvedAlert extends Alert {
  resolvedAt: number
}

/** 预警状态迁移（引擎输出；通知只在 open / escalate 时发送） */
export interface AlertTransition {
  type: 'open' | 'escalate' | 'resolve'
  alert: Alert
  at: number
}

/** 引擎内部条目（页面只整体传递状态，不读内部字段） */
export interface AlertEngineEntry {
  alert: Alert
  active: boolean
  mode: 'level' | 'event'
  ttlMs: number
  immediate: boolean
  breaches: number
  healthy: number
}

/** 引擎状态（纯数据，可直接单测） */
export interface AlertEngineState {
  entries: Record<string, AlertEngineEntry>
}

/** 一次评估的输入（快照派生 + 采样序列） */
export interface AlertInput {
  now: number
  totals: PlatformTotals
  rows: readonly PluginRow[]
  samples: readonly RuntimeSample[]
}

/** 预警文案（页面列表 / 系统通知共用） */
export interface AlertText {
  title: string
  body: string
}

/** 文案上下文：`t` 走 app i18n，`nameOf` 把 plugin_id 补成应用名 */
export interface AlertTextContext {
  t: (key: string, params?: Record<string, unknown>) => string
  nameOf: (id: string) => string
}

/**
 * 预警阈值设置（用户可改；存本应用 KV）。
 *
 * 比值统一 0..1；`computeWarnFuelPerSecond = 0` 表示关闭该规则（燃料单位没有
 * 绝对基准，不猜默认阈值）。
 */
export interface AlertSettings {
  /** 总开关（关闭 = 不评估、不通知） */
  enabled: boolean
  /** 是否经宿主投递系统通知（宿主支持时才可见；页内告警始终保留） */
  notify: boolean
  /** 平台 wasm 内存合计预警阈值（字节）；0 = 关闭 */
  platformMemoryWarnBytes: number
  /** 平台 wasm 内存合计严重阈值（字节）；0 = 关闭 */
  platformMemoryCriticalBytes: number
  pluginMemoryWarn: number
  pluginMemoryCritical: number
  /** 计算负载预警阈值（燃料/秒）；0 = 关闭 */
  computeWarnFuelPerSecond: number
  /** 连续越界多少次才升警（去抖） */
  breachSamples: number
  /** 连续正常多少次才解除（防抖回） */
  recoverSamples: number
  /** 同一预警重复通知的最小间隔（毫秒） */
  cooldownMs: number
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
