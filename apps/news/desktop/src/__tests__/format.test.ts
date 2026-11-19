import { describe, expect, it } from 'vitest'
import {
  clampWeight,
  clockLabel,
  durationLabel,
  maskLabel,
  relativeLabel,
  stampLabel,
  weightLabel,
} from '../utils/format'
import { errorText, parseError } from '../utils/errors'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeLabel', () => {
  const now = 1_000_000_000_000

  it('一分钟内显示「刚刚」', () => {
    expect(relativeLabel(now - 30 * 1000, now)).toEqual({ key: 'news.relative.justNow' })
  })

  it('分钟 / 小时 / 天分档', () => {
    expect(relativeLabel(now - 5 * MINUTE, now)).toEqual({
      key: 'news.relative.minutes',
      count: 5,
    })
    expect(relativeLabel(now - 3 * HOUR, now)).toEqual({ key: 'news.relative.hours', count: 3 })
    expect(relativeLabel(now - 2 * DAY, now)).toEqual({ key: 'news.relative.days', count: 2 })
  })

  it('未来时间按刚刚处理，不出现负数', () => {
    expect(relativeLabel(now + 10 * MINUTE, now)).toEqual({ key: 'news.relative.justNow' })
  })
})

describe('clock / stamp / duration', () => {
  it('非法时间返回空串', () => {
    expect(clockLabel(0)).toBe('')
    expect(clockLabel(Number.NaN)).toBe('')
    expect(stampLabel(0)).toBe('')
  })

  it('耗时按毫秒 / 秒分档', () => {
    expect(durationLabel(0)).toBe('0ms')
    expect(durationLabel(340)).toBe('340ms')
    expect(durationLabel(1200)).toBe('1.2s')
  })
})

describe('maskLabel', () => {
  it('只显示末四位与长度', () => {
    expect(maskLabel('', 0)).toBe('')
    expect(maskLabel('abcd', 32)).toBe('···abcd (32)')
    expect(maskLabel('', 8)).toBe('···· (8)')
  })
})

describe('weight', () => {
  it('夹取到 0.5–2.0 且显示一位小数', () => {
    expect(clampWeight(0.1)).toBe(0.5)
    expect(clampWeight(9)).toBe(2)
    expect(clampWeight(Number.NaN)).toBe(1)
    expect(weightLabel(1.29999)).toBe('1.3')
  })
})

describe('parseError', () => {
  it('识别分类码并保留原因', () => {
    expect(parseError(new Error('net.denied: plugin -> https://e.com'))).toEqual({
      code: 'net.denied',
      detail: 'plugin -> https://e.com',
    })
  })

  it('未知前缀不当分类码', () => {
    expect(parseError(new Error('something: else'))).toEqual({
      code: 'unknown',
      detail: 'something: else',
    })
  })

  it('errorText 拼分类文案与原文', () => {
    const t = (key: string) => key
    expect(errorText(t, new Error('parse.no_feed: empty'))).toBe(
      'news.error.parse.no_feed（empty）',
    )
  })
})
