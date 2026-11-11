/**
 * nextFilterKey 单测
 *
 * 覆盖：中段双向步进、首/尾段越界（返回 null = 交回外层翻页）、当前值不在顺序表里、
 * 以及单段顺序表（两个方向都越界）。顺序表与传输页 FILTERS 同序。
 */
import { describe, expect, it } from 'vitest'
import { nextFilterKey } from '../filterSwipe'

const ORDER = ['all', 'sending', 'receiving', 'history'] as const

describe('nextFilterKey', () => {
  it('左滑（left）前进到下一段', () => {
    expect(nextFilterKey(ORDER, 'all', 'left')).toBe('sending')
    expect(nextFilterKey(ORDER, 'sending', 'left')).toBe('receiving')
    expect(nextFilterKey(ORDER, 'receiving', 'left')).toBe('history')
  })

  it('右滑（right）回退到上一段', () => {
    expect(nextFilterKey(ORDER, 'history', 'right')).toBe('receiving')
    expect(nextFilterKey(ORDER, 'receiving', 'right')).toBe('sending')
    expect(nextFilterKey(ORDER, 'sending', 'right')).toBe('all')
  })

  it('首段再右滑越界 → null（交回外层翻页）', () => {
    expect(nextFilterKey(ORDER, 'all', 'right')).toBeNull()
  })

  it('尾段再左滑越界 → null（交回外层翻页）', () => {
    expect(nextFilterKey(ORDER, 'history', 'left')).toBeNull()
  })

  it('当前值不在顺序表里 → null（不猜相邻段）', () => {
    expect(nextFilterKey(ORDER, 'unknown' as never, 'left')).toBeNull()
    expect(nextFilterKey(ORDER, 'unknown' as never, 'right')).toBeNull()
  })

  it('单段顺序表两个方向都越界', () => {
    expect(nextFilterKey(['only'] as const, 'only', 'left')).toBeNull()
    expect(nextFilterKey(['only'] as const, 'only', 'right')).toBeNull()
  })
})
