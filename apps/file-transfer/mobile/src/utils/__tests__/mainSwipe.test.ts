/**
 * resolveMainSwipe 单测
 *
 * 覆盖：中段双向切页、最左端再右滑无动作、最右端再左滑前进到设置页、
 * 以及「越界但不是右端页」的兜底（顺序表被裁剪时不应凭空跳设置）。
 */
import { describe, expect, it } from 'vitest'
import { resolveMainSwipe } from '../mainSwipe'
import type { MainTab } from '../../types'

const ORDER: readonly MainTab[] = ['devices', 'browse', 'transfers']

describe('resolveMainSwipe', () => {
  it('中段左滑切到右侧相邻页', () => {
    expect(resolveMainSwipe(ORDER, 'devices', 'left')).toEqual({ type: 'tab', tab: 'browse' })
    expect(resolveMainSwipe(ORDER, 'browse', 'left')).toEqual({ type: 'tab', tab: 'transfers' })
  })

  it('中段右滑切到左侧相邻页', () => {
    expect(resolveMainSwipe(ORDER, 'transfers', 'right')).toEqual({ type: 'tab', tab: 'browse' })
    expect(resolveMainSwipe(ORDER, 'browse', 'right')).toEqual({ type: 'tab', tab: 'devices' })
  })

  it('最左端（探索连接）再右滑：没有上一页，不导航', () => {
    expect(resolveMainSwipe(ORDER, 'devices', 'right')).toEqual({ type: 'none' })
  })

  it('最右端（传输）再左滑：前进到设置页', () => {
    expect(resolveMainSwipe(ORDER, 'transfers', 'left')).toEqual({ type: 'settings' })
  })

  it('右端由顺序表决定（不写死 transfers）：裁剪后的末位页左滑同样去设置', () => {
    expect(resolveMainSwipe(['devices', 'browse'] as const, 'browse', 'left')).toEqual({
      type: 'settings',
    })
  })

  it('当前页不在顺序表里：不导航', () => {
    expect(resolveMainSwipe([], 'browse', 'left')).toEqual({ type: 'none' })
  })
})
