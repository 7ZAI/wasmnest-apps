import type { CursorPosition, DividerPosition, Locale, TimeDividerSettings } from '../types'

const WEEKDAYS: Record<Locale, string[]> = {
  'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 模板变量替换（{{date}} / {{time}} / {{datetime}} / {{weekday}} / {{timestamp}}） */
export function formatDivider(date: Date, format: string, locale: Locale): string {
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())

  const values: Record<string, string> = {
    date: `${y}-${mo}-${d}`,
    time: `${h}:${mi}`,
    datetime: `${y}-${mo}-${d} ${h}:${mi}:${s}`,
    weekday: WEEKDAYS[locale][date.getDay()],
    timestamp: String(Math.floor(date.getTime() / 1000)),
  }

  return format.replace(
    /\{\{\s*(date|time|datetime|weekday|timestamp)\s*\}\}/g,
    (_, key: string) => values[key] ?? '',
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 分隔符行判定：把格式模板的变量位置换成通配，构造整行正则。
 * 用于「用户是否手动删除了分隔符」的比较（spec §24）。
 */
export function dividerLinePattern(format: string): RegExp {
  const source = format
    .split(/\{\{\s*(?:date|time|datetime|weekday|timestamp)\s*\}\}/)
    .map(escapeRegExp)
    .join('.+?')
  return new RegExp(`^\\s*${source}\\s*$`)
}

/** 统计正文中分隔符行数 */
export function countDividers(content: string, format: string): number {
  const pattern = dividerLinePattern(format)
  return content.split('\n').filter((line) => pattern.test(line)).length
}

/** 内容编辑后分隔符数量减少 ⇒ 视为用户手动删除 */
export function dividerRemoved(previous: string, next: string, format: string): boolean {
  return countDividers(next, format) < countDividers(previous, format)
}

/** 是否应自动插入：开关开、间隔 > 0、该笔记未被用户标记跳过、距上次编辑超过阈值 */
export function shouldAutoInsert(options: {
  settings: TimeDividerSettings
  noteId: string
  deletedDividerNotes: string[]
  lastEditTimestamp: number | null
  now: number
}): boolean {
  const { settings, noteId, deletedDividerNotes, lastEditTimestamp, now } = options
  if (!settings.enabled) return false
  if (settings.triggerInterval <= 0) return false
  if (deletedDividerNotes.includes(noteId)) return false
  if (lastEditTimestamp === null) return false
  return now - lastEditTimestamp >= settings.triggerInterval * 60_000
}

export interface InsertResult {
  content: string
  cursor: CursorPosition | null
}

/** 在光标处插入文本（用于手动插入分隔符 / 粘贴剪贴板） */
export function insertAtCursor(
  content: string,
  text: string,
  cursor: CursorPosition | null,
): InsertResult {
  const lines = content.split('\n')
  const line = Math.min(Math.max(cursor?.line ?? lines.length, 1), lines.length)
  const ch = Math.min(Math.max(cursor?.ch ?? 0, 0), lines[line - 1].length)
  const before = lines.slice(0, line - 1).join('\n')
  const current = lines[line - 1]
  const after = lines.slice(line).join('\n')

  const head = before ? `${before}\n` : ''
  const tail = after ? `\n${after}` : ''
  const inserted = `${head}${current.slice(0, ch)}${text}${current.slice(ch)}${tail}`

  const insertedLines = text.split('\n')
  const nextCursor =
    insertedLines.length === 1
      ? { line, ch: ch + text.length }
      : {
          line: line + insertedLines.length - 1,
          ch: insertedLines[insertedLines.length - 1].length,
        }

  return { content: inserted, cursor: nextCursor }
}

/** 按配置位置插入分隔符（top / bottom / cursor） */
export function buildInsertion(
  content: string,
  divider: string,
  position: DividerPosition,
  cursor: CursorPosition | null,
): InsertResult {
  if (position === 'cursor') {
    return insertAtCursor(content, divider, cursor)
  }
  if (position === 'top') {
    return {
      content: content.trim() === '' ? divider : `${divider}\n\n${content}`,
      cursor: null,
    }
  }
  const trimmed = content.trimEnd()
  return {
    content: trimmed === '' ? divider : `${trimmed}\n\n${divider}`,
    cursor: null,
  }
}

/** 时间分隔符组合式 API（纯函数见上，供单测） */
export function useTimeDivider() {
  function format(date: Date, settings: TimeDividerSettings, locale: Locale): string {
    return formatDivider(date, settings.format, locale)
  }

  return {
    format,
    countDividers,
    dividerRemoved,
    shouldAutoInsert,
    buildInsertion,
    insertAtCursor,
  }
}
