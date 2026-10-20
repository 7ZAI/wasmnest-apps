/**
 * Monitor 桌面测试夹具：只写与断言相关的字段，其余给 0 / 空映射。
 * 形状与宿主 `PluginMetricsSnapshot` 一致（snake_case）。
 */
import type { MonitorAppContext } from '../appContext'
import type { HostPluginInfo, MetricsSnapshot, PluginMetricsSnapshot } from '../types'

export function metrics(overrides: Partial<PluginMetricsSnapshot> = {}): PluginMetricsSnapshot {
  return {
    memory_current_bytes: 0,
    memory_peak_bytes: 0,
    calls_total: 0,
    calls_in_flight: 0,
    fuel_consumed_total: 0,
    call_duration_us_total: 0,
    call_duration_us_max: 0,
    call_duration_buckets: [0, 0, 0, 0, 0, 0],
    lifecycle: {},
    lifecycle_last_unix: {},
    trap_reasons: {},
    memory_grow_denied_total: 0,
    table_grow_denied_total: 0,
    activation_us_total: 0,
    activation_us_max: 0,
    quota: {},
    authz: {},
    bus: {},
    ...overrides,
  }
}

export function snapshot(
  plugins: Record<string, PluginMetricsSnapshot>,
  extra: Record<string, unknown> = {},
): MetricsSnapshot {
  return { plugins, ...extra }
}

export function info(overrides: Partial<HostPluginInfo> = {}): HostPluginInfo {
  return {
    id: 'com.wasmnest.a',
    name: 'App A',
    version: '0.0.1',
    state: { state: 'activated' },
    ...overrides,
  }
}

/** 页面上下文桩：i18n.t 直返 key（插值参数附在 key 后，便于断言文案内容） */
export function makeContext(
  execute: (command: string, ...args: unknown[]) => Promise<unknown>,
  hostInvoke: (command: string) => Promise<unknown> = async () => [],
): MonitorAppContext {
  return {
    id: 'com.wasmnest.monitor',
    commands: { execute },
    hostInvoke,
    i18n: {
      t: (key: string, params?: Record<string, unknown>) =>
        params && Object.keys(params).length > 0
          ? `${key}(${Object.entries(params)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(',')})`
          : key,
      getI18n: () => undefined,
    },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
    storage: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      flush: async () => {},
    },
  } as unknown as MonitorAppContext
}
