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
  /** 所有插件的 wasm 线性内存合计（字节） */
  memoryCurrentBytes?: number
  /** 所有插件的 wasm 线性内存峰值合计（字节） */
  memoryPeakBytes?: number
  /** 所有插件的燃料消耗合计（宿主计数单位） */
  fuelTotal?: number
}

/**
 * 平台总览（全部 wasm 插件的合计 / 比值）。
 *
 * 口径与桌面一致：内存 = 线性内存合计（不是宿主进程 RSS）；配额 = 各插件配额之和；
 * 计算负载用燃料速率代理（宿主没有进程级 CPU 契约，不把代理叫成 CPU）。
 * 宿主进程的整机口径在 `process` 段（见 `HostProcessMetrics`），两套口径不可相加。
 */
export interface PlatformTotals {
  pluginCount: number
  memoryCurrentBytes: number
  memoryPeakBytes: number
  memoryQuotaBytes: number
  /** `memoryCurrentBytes / memoryQuotaBytes`；分母 0 → null */
  memoryRatio: number | null
  callsTotal: number
  fuelTotal: number
  /** 相邻采样的燃料速率；无基线 / 计数回退 → null */
  fuelPerSecond: number | null
  /** 相邻采样的调用速率；无基线 / 计数回退 → null */
  callsPerSecond: number | null
}

/**
 * 宿主进程角色（`process` 段的 `role`）
 *
 * 移动端只有 `host`（本进程）与 `other`（本进程派生的子进程）：WebView 渲染进程
 * 是独立 uid、挂在 `webview_zygote` 下，不属于本进程树 ⇒ `webview.present` 恒 false。
 */
export type ProcessRoleTag = 'host' | 'webview' | 'network' | 'gpu' | 'other'

/** 单个进程读数（`pssBytes` / `cpuPercent` 为 null 是有语义的缺失，不是 0） */
export interface ProcessSample {
  pid: number
  name: string
  role: ProcessRoleTag
  rssBytes?: number
  pssBytes?: number | null
  cpuPercent?: number | null
}

/** 一组进程的合计（宿主已求和；缺项即 null） */
export interface ProcessScope {
  processCount?: number
  rssBytes?: number
  pssBytes?: number | null
  cpuPercent?: number | null
}

/**
 * 宿主进程指标（快照 `process` 段，与 wasm 的 `plugins` 段分开）
 *
 * 移动端口径：只覆盖**本进程**（宿主 Rust + wasm 运行时）。WebView 渲染进程不可归属
 * （`webview.present === false`），所以 `tree` **不含** WebView——页面文案必须写明。
 */
export interface HostProcessMetrics {
  available: boolean
  /** `available = false` 时的原因（如 iOS 无 procfs） */
  reason?: string
  sampledAtUnixMs?: number
  cpuWindowMs?: number | null
  cores?: number | null
  self?: ProcessSample | null
  webview?: ProcessScope & {
    present: boolean
    reason?: string
    processes?: ProcessSample[]
  }
  otherChildren?: ProcessScope & { processes?: ProcessSample[] }
  tree?: ProcessScope
}

/**
 * WebView JS 堆（浏览器自报；Android WebView = Chromium 专有的 `performance.memory`）
 *
 * 与进程口径**分开**：这只是 JS 堆，不含 DOM / 图片 / 原生内存。未开启跨源隔离时
 * Chromium 会量化（实测 `usedJSHeapSize` 按 ~10 MB 取整、上限固定 1.5 GB），
 * 因此 `quantized = true` 时页面要写「粗粒度」，不可当精确值。WebKitGTK / WKWebView
 * 根本没有这个 API → `null`。
 */
export interface WebviewHeap {
  usedBytes: number
  totalBytes: number | null
  limitBytes: number | null
  /** 值被浏览器量化（非跨源隔离）时为 true */
  quantized: boolean
}
