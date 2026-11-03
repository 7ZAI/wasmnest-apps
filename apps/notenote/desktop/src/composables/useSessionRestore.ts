import { ref, type Ref } from 'vue'
import { api } from '../api'
import type { WorkingContext, AppSettings } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_CONTEXT } from '../types'

export function useSessionRestore() {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const context = ref<WorkingContext>({ ...DEFAULT_CONTEXT })
  const loaded = ref(false)

  async function load() {
    try {
      const [s, c] = await Promise.all([
        api.readSettings().catch(() => ({ ...DEFAULT_SETTINGS })),
        api.readContext().catch(() => ({ ...DEFAULT_CONTEXT })),
      ])
      settings.value = { ...DEFAULT_SETTINGS, ...s }
      context.value = { ...DEFAULT_CONTEXT, ...c }
    } catch (e) {
      console.error('[SessionRestore] load failed:', e)
    }
    loaded.value = true
  }

  async function persistSettings() {
    try {
      await api.saveSettings(settings.value)
    } catch (e) {
      console.error('[SessionRestore] save settings failed:', e)
    }
  }

  async function persistContext() {
    try {
      await api.saveContext(context.value)
    } catch (e) {
      console.error('[SessionRestore] save context failed:', e)
    }
  }

  function updateContext(patch: Partial<WorkingContext>) {
    Object.assign(context.value, patch)
    context.value.lastEditTimestamp = Date.now()
  }

  return { settings, context, loaded, load, persistSettings, persistContext, updateContext }
}
