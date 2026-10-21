/**
 * Monitor（移动端）i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错。
 * 注册时宿主自动加插件 ID 前缀（`com.wasmnest.monitor.<key>`）；组件侧用同一
 * 命名空间取 key（见 MonitorView 的 `tx`）。
 */
export type MessageSchema = {
  'monitor.title': string
  'monitor.live': string
  'monitor.interval': string
  'monitor.updated': string
  'monitor.never': string
  'monitor.refresh': string
  'monitor.refreshing': string
  'monitor.stale': string
  'monitor.loading': string
  'monitor.self': string

  'monitor.error.title': string
  'monitor.error.hint': string
  'monitor.error.retry': string
  'monitor.empty.title': string
  'monitor.empty.hint': string

  'monitor.kpi.plugins': string
  'monitor.kpi.pluginsValue': string
  'monitor.kpi.calls': string
  'monitor.kpi.inFlight': string
  'monitor.kpi.inFlightHint': string
  'monitor.kpi.traps': string
  'monitor.kpi.memoryPeak': string

  'monitor.section.plugins': string
  'monitor.section.host': string
  'monitor.section.memory': string
  'monitor.section.calls': string
  'monitor.section.traps': string
  'monitor.section.lifecycle': string
  'monitor.section.authz': string
  'monitor.section.bus': string
  'monitor.section.quota': string
  'monitor.section.histogram': string

  'monitor.metric.callsTotal': string
  'monitor.metric.inFlight': string
  'monitor.metric.avgDuration': string
  'monitor.metric.maxDuration': string
  'monitor.metric.fuel': string
  'monitor.metric.activation': string
  'monitor.metric.activationMax': string
  'monitor.metric.memoryPeak': string
  'monitor.metric.memoryLimit': string
  'monitor.metric.memoryUsage': string
  'monitor.metric.memoryDenied': string
  'monitor.metric.tableDenied': string
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
  'monitor.metric.more': string

  'monitor.lifecycle.instantiate': string
  'monitor.lifecycle.activate_ok': string
  'monitor.lifecycle.activate_fail': string
  'monitor.lifecycle.deactivate': string
  'monitor.lifecycle.trap': string
  'monitor.lifecycle.degraded': string

  'monitor.trap.fuel_exhausted': string
  'monitor.trap.stack_overflow': string
  'monitor.trap.memory_out_of_bounds': string
  'monitor.trap.unreachable': string
  'monitor.trap.host_error': string
  'monitor.trap.other': string

  'monitor.bucket.le1ms': string
  'monitor.bucket.le10ms': string
  'monitor.bucket.le100ms': string
  'monitor.bucket.le1s': string
  'monitor.bucket.le10s': string
  'monitor.bucket.gt10s': string

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
  'monitor.inspector.usage': string
  'monitor.inspector.noTraps': string
  'monitor.footer.source': string
  'monitor.footer.session': string
}
