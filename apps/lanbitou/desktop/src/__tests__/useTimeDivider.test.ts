import { describe, expect, it } from 'vitest'
import {
  buildInsertion,
  countDividers,
  dividerRemoved,
  formatDivider,
  insertAtCursor,
  shouldAutoInsert,
} from '../composables/useTimeDivider'
import type { TimeDividerSettings } from '../types'

const FORMAT = '--- {{date}} {{weekday}} {{time}} ---'

function settings(overrides: Partial<TimeDividerSettings> = {}): TimeDividerSettings {
  return {
    enabled: true,
    format: FORMAT,
    position: 'bottom',
    triggerInterval: 5,
    ...overrides,
  }
}

describe('formatDivider', () => {
  const date = new Date(2026, 10, 2, 14, 30, 15) // 2026-11-02 周一 14:30:15 本地时间

  it('替换全部模板变量（zh-CN 星期）', () => {
    expect(formatDivider(date, '--- {{date}} {{weekday}} {{time}} ---', 'zh-CN')).toBe(
      '--- 2026-11-02 周一 14:30 ---',
    )
    expect(formatDivider(date, '{{datetime}}', 'zh-CN')).toBe('2026-11-02 14:30:15')
    expect(formatDivider(date, '{{timestamp}}', 'zh-CN')).toBe(
      String(Math.floor(date.getTime() / 1000)),
    )
  })

  it('星期名按语言本地化（en）', () => {
    expect(formatDivider(date, '{{weekday}}', 'en')).toBe('Mon')
  })

  it('未知变量原样保留', () => {
    expect(formatDivider(date, '{{unknown}}', 'zh-CN')).toBe('{{unknown}}')
  })
})

describe('divider detection', () => {
  it('统计正文中的分隔符行', () => {
    const content = `正文\n\n--- 2026-11-02 周一 14:30 ---\n\n更多`
    expect(countDividers(content, FORMAT)).toBe(1)
  })

  it('自定义格式也能识别', () => {
    const format = '## {{date}} {{time}}'
    const content = '正文\n## 2026-11-02 14:30\n'
    expect(countDividers(content, format)).toBe(1)
  })

  it('用户删除分隔符后判定为 removed', () => {
    const before = '正文\n\n--- 2026-11-02 周一 14:30 ---\n'
    const after = '正文\n'
    expect(dividerRemoved(before, after, FORMAT)).toBe(true)
    expect(dividerRemoved(after, before, FORMAT)).toBe(false)
  })
})

describe('shouldAutoInsert', () => {
  const now = 1_700_000_000_000
  const base = {
    settings: settings(),
    noteId: 'note-1',
    deletedDividerNotes: [] as string[],
    lastEditTimestamp: now - 6 * 60_000,
    now,
  }

  it('超过触发间隔时插入', () => {
    expect(shouldAutoInsert(base)).toBe(true)
  })

  it('未超过触发间隔时不插入', () => {
    expect(shouldAutoInsert({ ...base, lastEditTimestamp: now - 60_000 })).toBe(false)
  })

  it('关闭开关 / 间隔为 0 时不插入', () => {
    expect(shouldAutoInsert({ ...base, settings: settings({ enabled: false }) })).toBe(false)
    expect(shouldAutoInsert({ ...base, settings: settings({ triggerInterval: 0 }) })).toBe(false)
  })

  it('用户已手动删除分隔符的笔记不再插入', () => {
    expect(shouldAutoInsert({ ...base, deletedDividerNotes: ['note-1'] })).toBe(false)
  })

  it('没有上次编辑时间时不插入', () => {
    expect(shouldAutoInsert({ ...base, lastEditTimestamp: null })).toBe(false)
  })
})

describe('buildInsertion', () => {
  it('底部插入（默认）', () => {
    expect(buildInsertion('正文', 'DIV', 'bottom', null).content).toBe('正文\n\nDIV')
  })

  it('顶部插入', () => {
    expect(buildInsertion('正文', 'DIV', 'top', null).content).toBe('DIV\n\n正文')
  })

  it('空笔记只写分隔符', () => {
    expect(buildInsertion('', 'DIV', 'bottom', null).content).toBe('DIV')
    expect(buildInsertion('   ', 'DIV', 'top', null).content).toBe('DIV')
  })

  it('光标处插入并返回新光标', () => {
    const result = buildInsertion('abc', 'DIV', 'cursor', { line: 1, ch: 1 })
    expect(result.content).toBe('aDIVbc')
    expect(result.cursor).toEqual({ line: 1, ch: 4 })
  })
})

describe('insertAtCursor', () => {
  it('多行插入后光标落在最后一行', () => {
    const result = insertAtCursor('ab\ncd', 'X\nY', { line: 1, ch: 1 })
    expect(result.content).toBe('aX\nYb\ncd')
    expect(result.cursor).toEqual({ line: 2, ch: 1 })
  })

  it('光标越界时收敛到行尾', () => {
    const result = insertAtCursor('ab', 'Z', { line: 99, ch: 99 })
    expect(result.content).toBe('abZ')
  })
})
