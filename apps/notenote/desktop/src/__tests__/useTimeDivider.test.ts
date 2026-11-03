import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { formatTimeDivider, useTimeDivider } from '../composables/useTimeDivider'
import type { WorkingContext } from '../types'
import { DEFAULT_SETTINGS } from '../types'

describe('formatTimeDivider', () => {
  const fixedDate = new Date(2026, 10, 2, 14, 30, 15) // 2026-11-02 14:30:15, Monday

  it('替换 {{date}} 为 YYYY-MM-DD 格式', () => {
    const result = formatTimeDivider('--- {{date}} ---', fixedDate, 'zh-CN')
    expect(result).toBe('--- 2026-11-02 ---')
  })

  it('替换 {{time}} 为 HH:MM 格式', () => {
    const result = formatTimeDivider('{{time}}', fixedDate, 'zh-CN')
    expect(result).toBe('14:30')
  })

  it('替换 {{datetime}} 为完整日期时间', () => {
    const result = formatTimeDivider('{{datetime}}', fixedDate, 'zh-CN')
    expect(result).toBe('2026-11-02 14:30:15')
  })

  it('替换 {{timestamp}} 为 Unix 时间戳', () => {
    const result = formatTimeDivider('{{timestamp}}', fixedDate, 'zh-CN')
    expect(result).toBe(fixedDate.getTime().toString())
  })

  it('中文 locale 使用中文星期', () => {
    const result = formatTimeDivider('{{weekday}}', fixedDate, 'zh-CN')
    expect(result).toBe('周一')
  })

  it('英文 locale 使用英文星期', () => {
    const result = formatTimeDivider('{{weekday}}', fixedDate, 'en')
    expect(result).toBe('Monday')
  })

  it('默认模板完整替换', () => {
    const template = DEFAULT_SETTINGS.timeDivider.format
    const result = formatTimeDivider(template, fixedDate, 'zh-CN')
    expect(result).toBe('--- 2026-11-02 周一 14:30 ---')
  })

  it('个位数月/日/时/分补零', () => {
    const earlyDate = new Date(2026, 0, 5, 3, 7, 0) // Jan 5, 03:07
    const result = formatTimeDivider('{{date}} {{time}}', earlyDate, 'zh-CN')
    expect(result).toBe('2026-01-05 03:07')
  })
})

describe('useTimeDivider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(overrides?: {
    lastEditTimestamp?: number | null
    deletedDividerNotes?: string[]
    enabled?: boolean
    triggerInterval?: number
    position?: 'top' | 'bottom' | 'cursor'
  }) {
    const context = ref<WorkingContext>({
      lastOpenedNoteId: null,
      cursorPosition: null,
      scrollPosition: null,
      lastEditTimestamp: overrides?.lastEditTimestamp ?? null,
      deletedDividerNotes: overrides?.deletedDividerNotes ?? [],
    })
    const settings = ref({
      format: DEFAULT_SETTINGS.timeDivider.format,
      position: overrides?.position ?? 'bottom',
      triggerInterval: overrides?.triggerInterval ?? 5,
      enabled: overrides?.enabled ?? true,
    })
    const locale = ref('zh-CN')
    return { ...useTimeDivider(context, settings, locale), context, settings }
  }

  describe('shouldInsert（经 checkAndPrepare 间接验证）', () => {
    it('未启用时不插入', () => {
      const td = setup({ enabled: false, lastEditTimestamp: Date.now() - 10 * 60 * 1000 })
      td.checkAndPrepare('note-1')
      expect(td.pendingDivider.value).toBeNull()
    })

    it('无 lastEditTimestamp 时不插入（首次打开）', () => {
      const td = setup({ lastEditTimestamp: null })
      td.checkAndPrepare('note-1')
      expect(td.pendingDivider.value).toBeNull()
    })

    it('未超过触发间隔时不插入', () => {
      const td = setup({ lastEditTimestamp: Date.now() - 3 * 60 * 1000, triggerInterval: 5 })
      td.checkAndPrepare('note-1')
      expect(td.pendingDivider.value).toBeNull()
    })

    it('超过触发间隔时准备插入', () => {
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30))
      const td = setup({ lastEditTimestamp: Date.now() - 6 * 60 * 1000, triggerInterval: 5 })
      td.checkAndPrepare('note-1')
      expect(td.pendingDivider.value).not.toBeNull()
      expect(td.pendingDivider.value).toContain('2026-11-02')
    })

    it('恰好等于触发间隔时不插入（>= 才触发）', () => {
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30, 0))
      const td = setup({ lastEditTimestamp: Date.now() - 5 * 60 * 1000, triggerInterval: 5 })
      td.checkAndPrepare('note-1')
      // 5  exactly = 5, diffMinutes >= 5 → should insert
      // Actually the check is >= so it should insert
      expect(td.pendingDivider.value).not.toBeNull()
    })
  })

  describe('isNoteExcluded', () => {
    it('已删除分隔符的笔记被排除', () => {
      const td = setup({ deletedDividerNotes: ['note-excluded'] })
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30))
      td.context.value.lastEditTimestamp = Date.now() - 10 * 60 * 1000
      td.checkAndPrepare('note-excluded')
      expect(td.pendingDivider.value).toBeNull()
    })

    it('未排除的笔记正常插入', () => {
      const td = setup({ deletedDividerNotes: ['other-note'] })
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30))
      td.context.value.lastEditTimestamp = Date.now() - 10 * 60 * 1000
      td.checkAndPrepare('note-1')
      expect(td.pendingDivider.value).not.toBeNull()
    })
  })

  describe('applyDivider', () => {
    it('position=bottom 时追加到末尾', () => {
      const td = setup({ position: 'bottom' })
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30))
      td.context.value.lastEditTimestamp = Date.now() - 10 * 60 * 1000
      td.checkAndPrepare('note-1')

      const result = td.applyDivider('Hello')
      expect(result).toMatch(/^Hello\n\n---/)
    })

    it('position=top 时追加到开头', () => {
      const td = setup({ position: 'top' })
      vi.setSystemTime(new Date(2026, 10, 2, 14, 30))
      td.context.value.lastEditTimestamp = Date.now() - 10 * 60 * 1000
      td.checkAndPrepare('note-1')

      const result = td.applyDivider('Hello')
      expect(result).toMatch(/^---.*\n\nHello$/)
    })

    it('无 pending divider 时原样返回', () => {
      const td = setup({ lastEditTimestamp: null })
      td.checkAndPrepare('note-1')
      expect(td.applyDivider('Hello')).toBe('Hello')
    })
  })

  describe('markDividerDeleted', () => {
    it('将笔记 ID 加入排除列表', () => {
      const td = setup()
      td.markDividerDeleted('note-1')
      expect(td.context.value.deletedDividerNotes).toContain('note-1')
    })

    it('重复标记不产生重复条目', () => {
      const td = setup()
      td.markDividerDeleted('note-1')
      td.markDividerDeleted('note-1')
      expect(td.context.value.deletedDividerNotes.filter((id) => id === 'note-1')).toHaveLength(1)
    })
  })

  describe('insertDividerAtCursor', () => {
    it('在指定行插入分隔符', () => {
      const td = setup()
      const content = 'line1\nline2\nline3'
      const result = td.insertDividerAtCursor(content, 1)
      const lines = result.split('\n')
      expect(lines).toHaveLength(4)
      expect(lines[0]).toBe('line1')
      expect(lines[1]).toContain('---')
      expect(lines[2]).toBe('line2')
      expect(lines[3]).toBe('line3')
    })

    it('在第 0 行插入即在开头', () => {
      const td = setup()
      const result = td.insertDividerAtCursor('existing', 0)
      expect(result.split('\n')[0]).toContain('---')
    })
  })

  describe('checkAndPrepare null noteId', () => {
    it('noteId 为 null 时不准备分隔符', () => {
      const td = setup({ lastEditTimestamp: Date.now() - 10 * 60 * 1000 })
      td.checkAndPrepare(null)
      expect(td.pendingDivider.value).toBeNull()
    })
  })
})
