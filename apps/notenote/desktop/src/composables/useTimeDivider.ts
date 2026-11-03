import { ref, type Ref } from 'vue'
import type { WorkingContext } from '../types'

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function formatTimeDivider(
  template: string,
  date: Date,
  locale: string,
): string {
  const yyyy = date.getFullYear().toString()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  const weekdays = locale === 'zh-CN' ? WEEKDAY_ZH : WEEKDAY_EN
  const weekday = weekdays[date.getDay()]

  return template
    .replace('{{date}}', `${yyyy}-${mm}-${dd}`)
    .replace('{{time}}', `${hh}:${mi}`)
    .replace('{{datetime}}', `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`)
    .replace('{{timestamp}}', date.getTime().toString())
    .replace('{{weekday}}', weekday)
}

export function useTimeDivider(
  context: Ref<WorkingContext>,
  settings: Ref<{ format: string; position: string; triggerInterval: number; enabled: boolean }>,
  locale: Ref<string>,
) {
  const pendingDivider = ref<string | null>(null)

  function shouldInsert(): boolean {
    if (!settings.value.enabled) return false
    const lastEdit = context.value.lastEditTimestamp
    if (!lastEdit) return false
    const now = Date.now()
    const diffMinutes = (now - lastEdit) / (1000 * 60)
    return diffMinutes >= settings.value.triggerInterval
  }

  function isNoteExcluded(noteId: string): boolean {
    return context.value.deletedDividerNotes.includes(noteId)
  }

  function generateDivider(): string {
    return formatTimeDivider(settings.value.format, new Date(), locale.value)
  }

  function checkAndPrepare(noteId: string | null) {
    pendingDivider.value = null
    if (!noteId) return
    if (!shouldInsert()) return
    if (isNoteExcluded(noteId)) return
    pendingDivider.value = generateDivider()
  }

  function applyDivider(content: string): string {
    const divider = pendingDivider.value
    if (!divider) return content
    const pos = settings.value.position
    if (pos === 'top') {
      return `${divider}\n\n${content}`
    }
    return `${content}\n\n${divider}`
  }

  function markDividerDeleted(noteId: string) {
    if (!context.value.deletedDividerNotes.includes(noteId)) {
      context.value.deletedDividerNotes.push(noteId)
    }
  }

  function insertDividerAtCursor(content: string, cursorLine: number): string {
    const divider = generateDivider()
    const lines = content.split('\n')
    lines.splice(cursorLine, 0, divider)
    return lines.join('\n')
  }

  return {
    pendingDivider,
    checkAndPrepare,
    applyDivider,
    markDividerDeleted,
    insertDividerAtCursor,
    generateDivider,
  }
}
