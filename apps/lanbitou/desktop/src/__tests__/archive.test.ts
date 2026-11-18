import { describe, expect, it } from 'vitest'
import { archiveRange, formatArchiveSize, localDateString } from '../archive'

describe('localDateString', () => {
  it('用本地时区格式化，补零到 YYYY-MM-DD', () => {
    // 本地时间构造，避免依赖测试机时区
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(localDateString(new Date(2026, 10, 4, 0, 5))).toBe('2026-11-04')
    expect(localDateString(new Date(2026, 11, 31, 12))).toBe('2026-12-31')
  })

  it('不因 UTC 换算把跨日算错（本地 00:30 仍是当天）', () => {
    const local = new Date(2026, 10, 4, 0, 30)
    expect(localDateString(local)).toBe('2026-11-04')
    // toISOString 在东八区会回退到前一天，这正是不能直接用它做归档名的原因
    expect(local.toISOString().slice(0, 10)).toBe('2026-11-03')
  })
})

describe('archiveRange', () => {
  it('解析区间名与单日名', () => {
    expect(archiveRange('2026-10-01_2026-11-04')).toEqual({
      start: '2026-10-01',
      end: '2026-11-04',
    })
    expect(archiveRange('2026-11-04')).toEqual({ start: '2026-11-04', end: '2026-11-04' })
  })

  it('同名二次归档的后缀不影响区间解析', () => {
    expect(archiveRange('2026-11-04_2')).toEqual({ start: '2026-11-04', end: '2026-11-04' })
  })

  it('非日期名返回 null（列表不误判）', () => {
    expect(archiveRange('notes')).toBeNull()
    expect(archiveRange('2026-11_2026-11-04')).toBeNull()
  })
})

describe('formatArchiveSize', () => {
  it('按 B / KB / MB 归一', () => {
    expect(formatArchiveSize(0)).toBe('0 B')
    expect(formatArchiveSize(512)).toBe('512 B')
    expect(formatArchiveSize(2048)).toBe('2.0 KB')
    expect(formatArchiveSize(12 * 1024)).toBe('12 KB')
    expect(formatArchiveSize(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })

  it('非法输入不抛也不显示 NaN', () => {
    expect(formatArchiveSize(Number.NaN)).toBe('0 B')
    expect(formatArchiveSize(-1)).toBe('0 B')
  })
})
