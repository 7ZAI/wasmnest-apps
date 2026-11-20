/**
 * 插件命令错误的解析与本地化。
 *
 * 后端契约：`Err` 的消息形如 `<分类码>: <原因>`，分类码是稳定字面量
 * （`net.denied` / `parse.no_feed` / `ai.disabled` …）。界面按 `news.error.<码>`
 * 取文案，原文放进 `detail` 供排查——不把英文原文直接当主文案。
 */

export interface NewsError {
  code: string
  detail: string
}

/** 分类码白名单：命中才当分类码，避免把任意 `xxx: yyy` 误判。 */
const KNOWN_CODES = [
  'net.denied',
  'net.failed',
  'http.status',
  'auth.expired',
  'parse.no_feed',
  'parse.unexpected_shape',
  'rate.limited',
  'ai.auth',
  'ai.failed',
  'ai.disabled',
  'assistant.fetch-unavailable',
  'invalid.argument',
  'source.unavailable',
  'port.unsupported',
  'storage.failed',
  'clock.unavailable',
  'refresh.debounced',
  'reader.disabled',
  'extract.unsupported',
  'extract.no_content',
  'extract.encoding',
  'extract.too_large',
  'extract.failed',
  'reader.storage_full',
]

/** 解析后端错误消息。 */
export function parseError(error: unknown): NewsError {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const idx = raw.indexOf(':')
  if (idx > 0) {
    const code = raw.slice(0, idx).trim()
    if (KNOWN_CODES.includes(code)) {
      return { code, detail: raw.slice(idx + 1).trim() }
    }
  }
  return { code: 'unknown', detail: raw }
}

/**
 * 取本地化文案。
 *
 * `detail` 追加在括号里（可读性优先：先给分类，再给原始原因）。
 */
export function errorText(
  t: (key: string, params?: Record<string, unknown>) => string,
  error: unknown,
): string {
  const parsed = parseError(error)
  const base = t(`news.error.${parsed.code}`)
  if (!parsed.detail) return base
  return `${base}（${parsed.detail}）`
}

/** 只取分类码对应文案（不带原文，用在窄容器里）。 */
export function errorKindText(
  t: (key: string, params?: Record<string, unknown>) => string,
  code: string | undefined,
): string {
  if (!code) return ''
  const known = KNOWN_CODES.includes(code) ? code : 'unknown'
  return t(`news.error.${known}`)
}
