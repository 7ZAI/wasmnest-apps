import { describe, it, expect, vi } from 'vitest'
import { useAlertSettings } from '../composables/useAlertSettings'
import type { MonitorAppContext } from '../appContext'
import { ALERT_SETTINGS_KEY, DEFAULT_ALERT_SETTINGS, normalizeAlertSettings } from '../utils/alerts'

function storageContext(get: () => Promise<unknown>, set = vi.fn(async () => {})) {
  return {
    storage: {
      get: vi.fn(get),
      set,
      delete: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
    },
  } as unknown as Pick<MonitorAppContext, 'storage'>
}

describe('useAlertSettings（KV 读写）', () => {
  it('键名稳定（改了要换版本号）', () => {
    expect(ALERT_SETTINGS_KEY).toBe('monitor.alertSettings.v1')
  })

  it('读取存储并归一化；未存储 → 默认值', async () => {
    const stored = normalizeAlertSettings({
      ...DEFAULT_ALERT_SETTINGS,
      platformMemoryWarnBytes: 700 * 1024 * 1024,
      notify: false,
    })
    const fromStore = useAlertSettings(storageContext(async () => stored))
    await fromStore.load()
    expect(fromStore.ready.value).toBe(true)
    expect(fromStore.settings.value.platformMemoryWarnBytes).toBe(700 * 1024 * 1024)
    expect(fromStore.settings.value.notify).toBe(false)
    expect(fromStore.warning.value).toBeNull()

    const empty = useAlertSettings(storageContext(async () => undefined))
    await empty.load()
    expect(empty.settings.value).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(empty.warning.value).toBeNull()
  })

  it('读取失败：用默认值继续跑，并把原因显性保留', async () => {
    const ctx = storageContext(async () => {
      throw new Error('kv unavailable')
    })
    const api = useAlertSettings(ctx)
    await api.load()
    expect(api.ready.value).toBe(true)
    expect(api.settings.value).toEqual(DEFAULT_ALERT_SETTINGS)
    expect(api.warning.value).toContain('kv unavailable')
  })

  it('局部更新：归一化后写回同一键', async () => {
    const set = vi.fn(async () => {})
    const api = useAlertSettings(storageContext(async () => undefined, set))
    await api.load()

    await api.update({
      platformMemoryWarnBytes: 700 * 1024 * 1024,
      platformMemoryCriticalBytes: 600 * 1024 * 1024,
    })

    expect(set).toHaveBeenCalledTimes(1)
    const [key, value] = set.mock.calls[0] as unknown as [string, unknown]
    expect(key).toBe(ALERT_SETTINGS_KEY)
    // critical 必须严格大于 warn
    expect((value as { platformMemoryCriticalBytes: number }).platformMemoryCriticalBytes).toBe(
      700 * 1024 * 1024 + 1,
    )
    expect(api.settings.value.platformMemoryWarnBytes).toBe(700 * 1024 * 1024)
  })

  it('写失败：设置仍在内存生效，原因写进 warning', async () => {
    const set = vi.fn(async () => {
      throw new Error('disk full')
    })
    const api = useAlertSettings(storageContext(async () => undefined, set))
    await api.load()
    await api.update({ notify: false })

    expect(api.settings.value.notify).toBe(false)
    expect(api.warning.value).toContain('disk full')
  })

  it('恢复默认：内存与存储同时回到默认值', async () => {
    const set = vi.fn(async () => {})
    const api = useAlertSettings(storageContext(async () => undefined, set))
    await api.load()
    await api.update({ notify: false })

    await api.reset()

    expect(api.settings.value).toEqual(DEFAULT_ALERT_SETTINGS)
    const lastCall = set.mock.calls[set.mock.calls.length - 1] as unknown as [string, unknown]
    expect(lastCall[0]).toBe(ALERT_SETTINGS_KEY)
    expect(lastCall[1]).toEqual(DEFAULT_ALERT_SETTINGS)
  })
})
