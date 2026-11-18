import { describe, expect, it } from 'vitest'
import { relativeLabel } from '../utils/format'


const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeLabel', () => {
  const now = 10 * DAY

  it('一分钟内显示刚刚', () => {
    expect(relativeLabel(now - 30 * 1000, now)).toEqual({ key: 'news.relative.justNow' })
  })

  it('分钟档向下取整', () => {
    expect(relativeLabel(now - 3 * MINUTE + 1, now)).toEqual({
      key: 'news.relative.minutes',
      count: 2,
    })
  })

  it('小时档在跨天前保持小时', () => {
    expect(relativeLabel(now - 5 * HOUR, now)).toEqual({
      key: 'news.relative.hours',
      count: 5,
    })
  })

  it('超过一天切换为天', () => {
    expect(relativeLabel(now - 2 * DAY, now)).toEqual({
      key: 'news.relative.days',
      count: 2,
    })
  })

  it('未来时间按刚刚处理，不出现负值', () => {
    expect(relativeLabel(now + HOUR, now)).toEqual({ key: 'news.relative.justNow' })
  })
})
