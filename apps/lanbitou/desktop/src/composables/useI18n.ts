import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 组件内 i18n 取词（统一走注入的 pluginContext；缺失时回退 key，便于测试） */
export function useI18n() {
  const ctx = inject<PluginContext>('pluginContext') ?? null

  function t(key: string, params?: Record<string, unknown>): string {
    return ctx ? ctx.i18n.t(key, params) : key
  }

  return { t, ctx }
}
