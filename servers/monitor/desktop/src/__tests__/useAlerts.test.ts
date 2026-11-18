import { describe, it, expect, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import type { PlatformTotals, PluginRow, RuntimeSample } from '../types'
import { useAlerts } from '../composables/useAlerts'
import { DEFAULT_ALERT_SETTINGS, normalizeAlertSettings } from '../utils/alerts'
import { platformTotals } from '../utils/platform'
import { metrics, snapshot } from './fixtures'

const t = (key: string, params?: Record<string, unknown>): string =>
  params && Object.keys(params).length > 0
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')})`
    : key

const MIB = 1024 * 1024
/** 平台内存规则按绝对合计判：300 MiB > 默认 256 MiB 预警线，配额给足避免单插件规则干扰 */
const breaching = () =>
  snapshot({
    a: metrics({ memory_current_bytes: 300 * MIB, quota: { memory_bytes: 4096 * MIB } }),
  })

function setup(options: { notify?: ReturnType<typeof vi.fn>; notifyEnabled?: boolean } = {}) {
  const current = ref(breaching())
  const totals = computed<PlatformTotals>(() => platformTotals(current.value))
  const rows = ref<PluginRow[]>([])
  const samples = ref<RuntimeSample[]>([])
  const lastUpdated = ref<number | null>(null)
  const settings = ref(
    normalizeAlertSettings({
      ...DEFAULT_ALERT_SETTINGS,
      breachSamples: 1,
      recoverSamples: 1,
      notify: options.notifyEnabled ?? true,
    }),
  )
  const ready = ref(true)
  const notify = options.notify ?? vi.fn(async () => ({ delivered: true }))

  const api = useAlerts({
    totals,
    rows,
    samples,
    lastUpdated,
    settings,
    ready,
    t,
    nameOf: (id) => `name:${id}`,
    notify,
  })

  return { api, current, settings, ready, lastUpdated, notify }
}

const healthy = snapshot({
  a: metrics({ memory_current_bytes: 100, quota: { memory_bytes: 1000 } }),
})

describe('useAlerts（调度 / 通知抑制 / 解除）', () => {
  it('采样触发评估：越界升警并投递一次系统通知', async () => {
    const { api, lastUpdated, notify } = setup()

    lastUpdated.value = 1000
    await nextTick()
    await Promise.resolve()

    expect(api.active.value).toHaveLength(1)
    expect(api.active.value[0].id).toBe('platform-memory:-')
    expect(api.summary.value).toEqual({ warning: 1, critical: 0 })
    expect(notify).toHaveBeenCalledTimes(1)
    const payload = notify.mock.calls[0][0]
    expect(payload.title).toBe('monitor.alerts.notifyTitle')
    expect(payload.body).toContain('monitor.alerts.rule.platformMemory')
  })

  it('同一预警不重复通知（open 只发一次）', async () => {
    const { api, lastUpdated, notify } = setup()

    lastUpdated.value = 1000
    await nextTick()
    lastUpdated.value = 2000
    await nextTick()
    await Promise.resolve()

    expect(api.active.value).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('解除后写入最近解除列表；冷却期内重新升警不再通知', async () => {
    const { api, current, lastUpdated, notify } = setup()

    lastUpdated.value = 1000
    await nextTick()
    await Promise.resolve()

    current.value = healthy
    lastUpdated.value = 2000
    await nextTick()
    expect(api.active.value).toHaveLength(0)
    expect(api.resolved.value).toHaveLength(1)
    expect(api.resolved.value[0].resolvedAt).toBe(2000)

    // 冷却期内（默认 5 分钟）重新越界：页内升警但不重复弹通知
    current.value = breaching()
    lastUpdated.value = 3000
    await nextTick()
    await Promise.resolve()
    expect(api.active.value).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)

    // 超过冷却期后再次升警 → 允许通知
    current.value = healthy
    lastUpdated.value = 4000
    await nextTick()
    current.value = breaching()
    lastUpdated.value = 1000 + DEFAULT_ALERT_SETTINGS.cooldownMs + 1
    await nextTick()
    await Promise.resolve()
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('通知开关关闭：只做页内预警', async () => {
    const { api, lastUpdated, notify } = setup({ notifyEnabled: false })

    lastUpdated.value = 1000
    await nextTick()
    await Promise.resolve()

    expect(api.active.value).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('宿主返回未授权：给出可读提示（不当作投递成功）', async () => {
    const notify = vi.fn(async () => ({ delivered: false, reason: 'permission' }))
    const { api, lastUpdated } = setup({ notify })

    lastUpdated.value = 1000
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()

    expect(api.notifyWarning.value).toBe('monitor.alerts.notifyDenied')
  })

  it('投递抛错：保留页内预警并暴露原因', async () => {
    const notify = vi.fn(async () => {
      throw new Error('host notify unavailable')
    })
    const { api, lastUpdated } = setup({ notify })

    lastUpdated.value = 1000
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()

    expect(api.active.value).toHaveLength(1)
    expect(api.notifyWarning.value).toContain('host notify unavailable')
  })

  it('设置未读完不评估（避免默认阈值误报）', async () => {
    const { api, ready, lastUpdated } = setup()
    ready.value = false

    lastUpdated.value = 1000
    await nextTick()

    expect(api.active.value).toHaveLength(0)
  })

  it('关掉总开关立即清空页内预警', async () => {
    const { api, settings, lastUpdated } = setup()

    lastUpdated.value = 1000
    await nextTick()
    expect(api.active.value).toHaveLength(1)

    settings.value = normalizeAlertSettings({ ...settings.value, enabled: false })
    await nextTick()

    expect(api.active.value).toHaveLength(0)
    expect(api.notifyWarning.value).toBeNull()
  })
})
