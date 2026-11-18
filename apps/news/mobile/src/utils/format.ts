/**
 * 相对时间标签（纯函数，可单测）
 *
 * 返回 i18n key 与插值参数，不拼接最终文案。时间统一为 Unix 毫秒。
 */

export interface RelativeLabel {
  key: string
  count?: number
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 把时间点转成相对标签；负数（时钟偏差）按「刚刚」处理。 */
export function relativeLabel(at: number, now: number = Date.now()): RelativeLabel {
  const delta = Math.max(0, now - at)
  if (delta < MINUTE) return { key: 'news.relative.justNow' }
  if (delta < HOUR) return { key: 'news.relative.minutes', count: Math.floor(delta / MINUTE) }
  if (delta < DAY) return { key: 'news.relative.hours', count: Math.floor(delta / HOUR) }
  return { key: 'news.relative.days', count: Math.floor(delta / DAY) }
}