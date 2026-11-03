import { ref, watch, type Ref } from 'vue'
import { api } from '../api'

export type AutoSaveMode = 'realtime' | 'onblur' | 'manual'

export function useAutoSave(
  noteId: Ref<string | null>,
  content: Ref<string>,
  mode: Ref<AutoSaveMode>,
  debounceMs: Ref<number>,
) {
  const saving = ref(false)
  const lastSaved = ref<string | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function save(contentOverride?: string) {
    const id = noteId.value
    if (!id) return
    saving.value = true
    error.value = null
    try {
      const c = contentOverride ?? content.value
      const note = await api.updateNote(id, c)
      lastSaved.value = note.updatedAt
    } catch (e: any) {
      error.value = e?.message ?? 'Save failed'
      console.error('[AutoSave] save failed:', e)
    } finally {
      saving.value = false
    }
  }

  function scheduleSave() {
    if (mode.value !== 'realtime') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(), debounceMs.value)
  }

  function flushSave() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    save()
  }

  watch(content, () => {
    if (mode.value === 'realtime') {
      scheduleSave()
    }
  })

  return { saving, lastSaved, error, save, scheduleSave, flushSave }
}
