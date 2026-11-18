import { describe, expect, it } from 'vitest'
import { relativeLabel } from '../utils/format'


const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeLabel（移动端）', () => {
  const now = 10 * DAY

  it('覆盖刚刚 / 分钟 / 小时 / 天四档', () => {
    expect(relativeLabel(now - 10 * 1000, now)).toEqual({ key: 'news.relative.justNow' })
    expect(relativeLabel(now - 3 * MINUTE, now)).toEqual({ key: 'news.relative.minutes', count: 3 })
    expect(relativeLabel(now - 5 * HOUR, now)).toEqual({ key: 'news.relative.hours', count: 5 })
    expect(relativeLabel(now - 2 * DAY, now)).toEqual({ key: 'news.relative.days', count: 2 })
  })

  it('未来时间按刚刚处理', () => {
    expect(relativeLabel(now + MINUTE, now)).toEqual({ key: 'news.relative.justNow' })
  })
})
