/**
 * Monitor 插件 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错，
 * 保证两个语言文件的 key 永远同步。所有 key 以 `monitor.` 域命名，注册时经
 * 插件 ID 前缀隔离为 `com.wasmnest.monitor.monitor.*`。
 *
 * 用 type 别名而非 interface：TS 给类型别名隐式索引签名，使 MessageSchema
 * 可直接赋给 `Record<string, unknown>`。
 */
export type MessageSchema = {
  // ==================== 页面壳 ====================
  'monitor.title': string
  'monitor.subtitle': string
  'monitor.live': string
  'monitor.interval': string
  'monitor.updated': string
  'monitor.never': string
  'monitor.refresh': string
  'monitor.refreshing': string
  'monitor.stale': string
  'monitor.loading': string
  'monitor.self': string
  'monitor.hostInfoUnavailable': string

  // ==================== 装配角色 ====================
  'monitor.role.basicService': string
  'monitor.role.internalBusiness': string
  'monitor.role.businessApp': string

  // ==================== 错误 / 空态（fail-visible） ====================
  'monitor.error.title': string
  'monitor.error.hint': string
  'monitor.error.retry': string
  'monitor.empty.title': string
  'monitor.empty.hint': string

  // ==================== KPI ====================
  'monitor.kpi.plugins': string
  'monitor.kpi.pluginsValue': string
  'monitor.kpi.pluginsUnavailable': string
  'monitor.kpi.calls': string
  'monitor.kpi.inFlight': string
  'monitor.kpi.inFlightHint': string
  'monitor.kpi.traps': string
  'monitor.kpi.memoryPeak': string

  // ==================== 分区标题 ====================
  'monitor.section.plugins': string
  'monitor.section.host': string
  'monitor.section.calls': string
  'monitor.section.memory': string
  'monitor.section.lifecycle': string
  'monitor.section.traps': string
  'monitor.section.authz': string
  'monitor.section.bus': string
  'monitor.section.quota': string
  'monitor.section.histogram': string

  // ==================== 指标标签 ====================
  'monitor.metric.callsTotal': string
  'monitor.metric.inFlight': string
  'monitor.metric.avgDuration': string
  'monitor.metric.maxDuration': string
  'monitor.metric.fuel': string
  'monitor.metric.activation': string
  'monitor.metric.activationMax': string
  'monitor.metric.memoryCurrent': string
  'monitor.metric.memoryPeak': string
  'monitor.metric.memoryLimit': string
  'monitor.metric.memoryDenied': string
  'monitor.metric.tableDenied': string
  'monitor.metric.traps': string
  'monitor.metric.trapsNone': string
  'monitor.metric.authzAllow': string
  'monitor.metric.authzDeny': string
  'monitor.metric.authzApproval': string
  'monitor.metric.authzDropped': string
  'monitor.metric.busDropped': string
  'monitor.metric.busFormatRejected': string
  'monitor.metric.quotaFuel': string
  'monitor.metric.quotaMemory': string
  'monitor.metric.quotaTable': string
  'monitor.metric.quotaInstances': string
  'monitor.metric.quotaMemories': string
  'monitor.metric.quotaTables': string
  'monitor.metric.quotaNote': string
  'monitor.metric.lastEvent': string
  'monitor.metric.memoryUsage': string

  // ==================== 插件状态 ====================
  'monitor.state.running': string
  'monitor.state.degraded': string
  'monitor.state.approval': string
  'monitor.state.error': string
  'monitor.state.dormant': string
  'monitor.state.unknown': string

  // ==================== 生命周期事件 ====================
  'monitor.lifecycle.instantiate': string
  'monitor.lifecycle.activate_ok': string
  'monitor.lifecycle.activate_fail': string
  'monitor.lifecycle.deactivate': string
  'monitor.lifecycle.trap': string
  'monitor.lifecycle.degraded': string

  // ==================== Trap 原因 ====================
  'monitor.trap.fuel_exhausted': string
  'monitor.trap.stack_overflow': string
  'monitor.trap.memory_out_of_bounds': string
  'monitor.trap.unreachable': string
  'monitor.trap.host_error': string
  'monitor.trap.other': string

  // ==================== 耗时直方图桶 ====================
  'monitor.bucket.le1ms': string
  'monitor.bucket.le10ms': string
  'monitor.bucket.le100ms': string
  'monitor.bucket.le1s': string
  'monitor.bucket.le10s': string
  'monitor.bucket.gt10s': string

  // ==================== 宿主任务池（task 段） ====================
  'monitor.task.title': string
  'monitor.task.jobsSubmittedTotal': string
  'monitor.task.jobsActive': string
  'monitor.task.jobsRejectedTotal': string
  'monitor.task.unitsCompletedTotal': string
  'monitor.task.concurrentUnitsPeak': string
  'monitor.task.eventsDroppedTotal': string
  'monitor.task.poolThreads': string

  // ==================== 仪表盘 / 插件台账 / 底注 ====================
  'monitor.hero.calm': string
  'monitor.hero.attention': string
  'monitor.hero.noTraps': string
  'monitor.hero.unknown': string
  'monitor.hero.stale': string
  'monitor.hero.proof': string
  'monitor.hero.proofUnknown': string
  'monitor.hero.proofStale': string
  'monitor.hero.proofMobile': string
  'monitor.signal.title': string
  'monitor.signal.perSecond': string
  'monitor.signal.window': string
  'monitor.signal.justStarted': string
  'monitor.signal.starting': string
  'monitor.signal.inFlight': string
  'monitor.signal.note': string
  'monitor.signal.peak': string
  'monitor.ledger.title': string
  'monitor.ledger.hint': string
  'monitor.ledger.calls': string
  'monitor.ledger.select': string
  'monitor.ledger.roleSummary': string
  'monitor.ledger.metricsUnavailable': string
  'monitor.filter.all': string
  'monitor.filter.services': string
  'monitor.filter.apps': string
  'monitor.filter.aria': string
  'monitor.panels.title': string
  'monitor.panels.hint': string
  'monitor.panels.empty': string
  'monitor.panels.failed': string
  'monitor.panels.unsupported': string
  'monitor.panels.retry': string
  'monitor.inspector.usage': string
  'monitor.inspector.noTraps': string
  'monitor.inspector.noMetricsTitle': string
  'monitor.inspector.noMetricsHint': string
  'monitor.host.hint': string
  'monitor.footer.source': string
  'monitor.footer.session': string

  // ==================== 预览面 ====================
  'monitor.preview.subtitle': string
  'monitor.preview.loading': string
  'monitor.preview.empty': string
  'monitor.preview.emptyHint': string
  'monitor.preview.noPlugins': string
  'monitor.preview.noPluginsHint': string
  'monitor.preview.plugins': string
  'monitor.preview.calls': string
  'monitor.preview.inFlight': string
  'monitor.preview.traps': string
  'monitor.preview.memory': string
}
