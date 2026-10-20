/**
 * Monitor（移动端）测试夹具。
 */
import { createI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { messages } from '../i18n'
import type { MetricsSnapshot, PluginMetricsSnapshot } from '../types'

export const NAMESPACE = 'com.wasmnest.monitor'

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

/** 与宿主注册语义一致的测试 i18n：消息 key = `<插件 id>.<原 key>` */
export function makeI18n(locale = 'zh-CN') {
  const prefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages['zh-CN'])) {
    prefixed[`${NAMESPACE}.${key}`] = value
  }
  const enPrefixed: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages.en)) {
    enPrefixed[`${NAMESPACE}.${key}`] = value
  }
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': prefixed, en: enPrefixed },
  })
}

/** 移动端组件测试上下文（只用到 id / commands） */
export function makeContext(
  execute: (command: string, ...args: unknown[]) => Promise<unknown>,
): PluginContext {
  return {
    id: NAMESPACE,
    commands: { execute },
  } as unknown as PluginContext
}
