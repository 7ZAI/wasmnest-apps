import { describe, expect, it } from 'vitest'
import {
  clampFloatPosition,
  resolveDefaultFloatPosition,
} from '@nest-shared/ui/float-position'

const container = { width: 1200, height: 800 }
const size = { width: 52, height: 52 }

describe('float-position', () => {
  it('默认位置落在右下角并保留边距', () => {
    expect(resolveDefaultFloatPosition(container, size, 16)).toEqual({ x: 1132, y: 732 })
  })

  it('越界坐标夹紧到容器内', () => {
    expect(clampFloatPosition({ x: -40, y: -20 }, container, size, 12)).toEqual({ x: 12, y: 12 })
    expect(clampFloatPosition({ x: 5000, y: 5000 }, container, size, 12)).toEqual({
      x: 1136,
      y: 736,
    })
  })

  it('容器小于浮球时退化为最小边距', () => {
    const small = { width: 40, height: 40 }
    expect(clampFloatPosition({ x: 10, y: 10 }, small, size, 12)).toEqual({ x: 12, y: 12 })
  })

  it('非法坐标回落到默认位置', () => {
    expect(clampFloatPosition({ x: Number.NaN, y: 10 }, container, size, 16)).toEqual({
      x: 1132,
      y: 732,
    })
  })
})