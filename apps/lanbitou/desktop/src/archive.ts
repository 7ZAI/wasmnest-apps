/**
 * 归档相关的纯函数（日期口径 + 展示）
 *
 * **为什么日期在前端算**：wasm 侧拿不到本地时区（宿主只给 Unix 毫秒），
 * 归档名要的是「我今天」这个本地语义，所以 `today` / `fallbackStart` 由这里生成，
 * 后端只做「正文里最早日期 → 起日」的解析与命名（见 `rust/src/store.rs`）。
 */

/** 本地日期 `YYYY-MM-DD`（用本地时区，不用 `toISOString()` 的 UTC 日） */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 归档名解析成两端日期（`2026-01-01_2026-02-01` 或单日 `2026-02-01`） */
export function archiveRange(archiveId: string): { start: string; end: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:_(\d{4}-\d{2}-\d{2}))?/.exec(archiveId)
  if (!match) return null
  const start = match[1]
  const end = match[2] ?? match[1]
  return { start, end }
}

/** 字节数 → 人类可读（归档列表右侧的体积标签） */
export function formatArchiveSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
