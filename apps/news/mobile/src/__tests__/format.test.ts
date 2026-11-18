import { describe, expect, it } from 'vitest'
import {
  clampWeight,
  clockLabel,
  durationLabel,
  maskLabel,
  relativeLabel,
  weightLabel,
} from '../utils/format'
import { errorKindText, parseError } from '../utils/errors'

const MINUTE = 60 * 1000

describe('移动端展示函数', () => {
  it('相对时间分档', () => {
    const now = 1_000_000_000_000
    expect(relativeLabel(now - 10_000, now)).toEqual({ key: 'news.relative.justNow' })
    expect(relativeLabel(now - 5 * MINUTE, now)).toEqual({
      key: 'news.relative.minutes',
      count: 5,
    })
  })

  it('时钟与耗时格式', () => {
    expect(clockLabel(0)).toBe('')
    expect(durationLabel(340)).toBe('340ms')
    expect(durationLabel(1200)).toBe('1.2s')
  })

  it('密钥掩码只留末四位与长度', () => {
    expect(maskLabel('abcd', 32)).toBe('···abcd (32)')
  })

  it('权重夹取', () => {
    expect(clampWeight(5)).toBe(2)
    expect(weightLabel(1.26)).toBe('1.3')
  })

  it('错误分类码可翻文案', () => {
    const t = (key: string) => key
    expect(errorKindText(t, 'net.denied')).toBe('news.error.net.denied')
    expect(errorKindText(t, 'weird.code')).toBe('news.error.unknown')
    expect(parseError(new Error('parse.no_feed: empty')).code).toBe('parse.no_feed')
  })
})
