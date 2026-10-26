/**
 * settingSlider 纯函数单测（接缝：设置页滑块几何换算）
 *
 * 覆盖：步进取整（含 0.1 浮点尾巴）、clientX → 值（含夹取与未布局兜底）、
 * 值 → 填充比例（含越界夹取）。
 */
import { describe, it, expect } from 'vitest'
import { roundToStep, sliderFillPercent, sliderValueFromClientX } from '../utils/settingSlider'

describe('roundToStep', () => {
  it('小数步进按精度归整（1.55 → 1.6，不留浮点尾巴）', () => {
    expect(roundToStep(1.55, 0.1)).toBe(1.6)
    expect(roundToStep(1.6, 0.1)).toBe(1.6)
    expect(roundToStep(0.5 + 0.1, 0.1)).toBe(0.6)
  })

  it('整数步进按整数归整', () => {
    expect(roundToStep(2300, 500)).toBe(2500)
    expect(roundToStep(2499, 500)).toBe(2500)
  })
})

describe('sliderValueFromClientX', () => {
  const rect = { left: 100, width: 200 }

  it('比例居中 → 区间中点（夹取并取整）', () => {
    expect(sliderValueFromClientX(200, rect, 0, 10, 1, 99)).toBe(5)
  })

  it('落点在轨道外：夹取到 [min, max]', () => {
    expect(sliderValueFromClientX(0, rect, 0, 10, 1, 99)).toBe(0)
    expect(sliderValueFromClientX(999, rect, 0, 10, 1, 99)).toBe(10)
  })

  it('轨道宽度为 0（未布局）：返回 fallback（当前值），不产生跳变', () => {
    expect(sliderValueFromClientX(200, { left: 0, width: 0 }, 0, 10, 1, 7)).toBe(7)
  })

  it('ms 区间换算（0.5s-10s 步进 0.5s）', () => {
    // 轨道 200px，落点在 25% → 500 + 0.25 * 9500 = 2875 → 归整到 3000
    expect(sliderValueFromClientX(150, rect, 500, 10000, 500, 1000)).toBe(3000)
  })
})

describe('sliderFillPercent', () => {
  it('区间中点 → 50%', () => {
    expect(sliderFillPercent(1.25, 0.5, 2)).toBe('50%')
  })

  it('越界值夹取到 0% / 100%', () => {
    expect(sliderFillPercent(-3, 0.5, 2)).toBe('0%')
    expect(sliderFillPercent(9, 0.5, 2)).toBe('100%')
  })
})
