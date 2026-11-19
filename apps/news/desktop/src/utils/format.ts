/**
 * 展示层纯函数（可单测）：相对时间、绝对时间、耗时与掩码。
 *
 * 返回 i18n key 与插值参数，不拼接最终文案——文案归语言文件，调用方用
 * `t(label.key, { count })` 渲染。时间统一为 Unix 毫秒。
 */

export interface RelativeLabel {
  key: string
  count?: number
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 把时间点转成相对标签。
 *
 * 负数（时钟偏差 / 未来时间）按「刚刚」处理，不显示负值。
 */
export function relativeLabel(at: number, now: number = Date.now()): RelativeLabel {
  const delta = Math.max(0, now - at)
  if (delta < MINUTE) return { key: 'news.relative.justNow' }
  if (delta < HOUR) return { key: 'news.relative.minutes', count: Math.floor(delta / MINUTE) }
  if (delta < DAY) return { key: 'news.relative.hours', count: Math.floor(delta / HOUR) }
  return { key: 'news.relative.days', count: Math.floor(delta / DAY) }
}

/** 本地时钟 `HH:MM`；无效值返回空串，界面不显示占位噪声。 */
export function clockLabel(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 日期 + 时刻（抓取记录用），如 `11-18 09:30`。 */
export function stampLabel(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${clockLabel(at)}`
}

/** 耗时：`1.2s` / `340ms`。 */
export function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 密钥掩码：`···abcd (32)`；空值返回空串。 */
export function maskLabel(tail: string, length: number): string {
  if (!length) return ''
  return tail ? `···${tail} (${length})` : `···· (${length})`
}

/** 把权重夹到设计域（0.5 – 2.0）；非数字回落 1.0。 */
export function clampWeight(raw: number): number {
  if (!Number.isFinite(raw)) return 1
  return Math.min(2, Math.max(0.5, raw))
}

/** 权重显示：一位小数，避免 `1.2999999` 这种浮点噪声。 */
export function weightLabel(weight: number): string {
  return clampWeight(weight).toFixed(1)
}
