/**
 * 预警设置的读写（桌面）
 *
 * 设置存本应用 KV（`monitor.alertSettings.v1`）。读取失败用默认阈值继续跑，
 * 并把原因显性留在设置区——**不因存储坏了就静默关掉预警**。
 */
import { ref } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { AlertSettings } from '../types'
import { ALERT_SETTINGS_KEY, DEFAULT_ALERT_SETTINGS, normalizeAlertSettings } from '../utils/alerts'
import { describeError } from '../utils/format'

export function useAlertSettings(context: Pick<MonitorAppContext, 'storage'>) {
  const settings = ref<AlertSettings>({ ...DEFAULT_ALERT_SETTINGS })
  /** 首次读取完成（未完成前不评估，避免拿默认值误报一轮） */
  const ready = ref(false)
  const warning = ref<string | null>(null)

  async function load(): Promise<void> {
    try {
      const raw = await context.storage.get<unknown>(ALERT_SETTINGS_KEY)
      settings.value = normalizeAlertSettings(raw)
      warning.value = null
    } catch (e) {
      settings.value = { ...DEFAULT_ALERT_SETTINGS }
      warning.value = describeError(e)
    } finally {
      ready.value = true
    }
  }

  /** 局部更新并落盘（归一化后再写，越界值不会进存储） */
  async function update(patch: Partial<AlertSettings>): Promise<void> {
    settings.value = normalizeAlertSettings({ ...settings.value, ...patch })
    try {
      await context.storage.set(ALERT_SETTINGS_KEY, settings.value)
      warning.value = null
    } catch (e) {
      warning.value = describeError(e)
    }
  }

  /** 恢复默认值（同样落盘，避免「界面上改了、下次又变回来」） */
  async function reset(): Promise<void> {
    settings.value = { ...DEFAULT_ALERT_SETTINGS }
    try {
      await context.storage.set(ALERT_SETTINGS_KEY, settings.value)
      warning.value = null
    } catch (e) {
      warning.value = describeError(e)
    }
  }

  return { settings, ready, warning, load, update, reset }
}
