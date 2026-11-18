/**
 * News 前端领域类型（与 Rust `wasmnest-news-core::domain` 的 wire 形状一致）
 *
 * 时间字段统一为 Unix 毫秒；`read` / `favorite` 是信息条的用户态，`originCount`
 * 是跨源去重后的来源数（>= 1）。
 */

export type FeedView = 'today' | 'circles' | 'realtime' | 'saved'

export interface NewsOrigin {
  sourceId: string
  sourceName: string
  rawUrl: string
  sourceTitle?: string
  publishedAt?: number
}

export interface NewsItem {
  id: string
  title: string
  url: string
  summary?: string
  publishedAt: number
  firstSeenAt: number
  lang?: string
  author?: string
  sourceId: string
  sourceName: string
  circleId?: string
  circleName: string
  read: boolean
  favorite: boolean
  favoritedAt?: number
  originCount: number
  score: number
  origins?: NewsOrigin[]
}

export interface NewsCircle {
  id: string
  name: string
  weight: number
  sortOrder: number
  createdAt: number
  sourceCount: number
}

export interface NewsSourceState {
  lastFetchAt?: number
  lastOkAt?: number
  nextRetryAt?: number
  failCount: number
  lastErrorKind?: string
  lastErrorDetail?: string
  etag?: string
  lastModified?: string
}

export interface NewsSource {
  id: string
  name: string
  kind: string
  url: string
  circleId?: string
  weight: number
  enabled: boolean
  authId?: string
  experimental: boolean
  hasCredential: boolean
  state: NewsSourceState
}

export interface NewsFeed {
  items: NewsItem[]
  windowHours: number | null
  generatedAt: number
}

export interface NewsSettings {
  aiEnabled: boolean
  aiBaseUrl: string
  aiModel: string
  aiApiKeyTail: string
  aiApiKeyLen: number
}

export interface SourceFetchResult {
  sourceId: string
  sourceName: string
  ok: boolean
  newItems: number
  parsedItems: number
  httpStatus?: number
  errorKind?: string
  errorDetail?: string
  nextRetryAt?: number
  durationMs: number
  skipped?: string
}

export interface RefreshOutcome {
  results: SourceFetchResult[]
  failed: number
  newItems: number
  skipped: number
  blocked?: string
}

export interface FetchLogEntry {
  id: number
  sourceId: string
  sourceName: string
  startedAt: number
  durationMs: number
  ok: boolean
  httpStatus?: number
  errorKind?: string
  itemCount?: number
}

export interface CredentialSummary {
  id: string
  kind: string
  label: string
  tail: string
  len: number
  createdAt: number
  updatedAt: number
}

export interface AiSummaryResult {
  itemId: string
  ok: boolean
  summary?: string
  errorKind?: string
  errorDetail?: string
}

export interface AiBatchSummaryResult {
  results: AiSummaryResult[]
  okCount: number
  failedCount: number
}

export interface FeedQuery {
  view: FeedView
  circleId?: string | null
}

/** 「未分组」伪圈子 id（与 Rust `UNGROUPED_CIRCLE_ID` 同值）。 */
export const UNGROUPED_CIRCLE_ID = '__ungrouped__'

/** 表单可选的源种类（`html-list` 只服务内置源，不出现在表单里）。 */
export const SELECTABLE_KINDS = [
  'rss',
  'hn',
  'reddit',
  'youtube-rss',
  'x-graphql',
  'ig-graphql',
] as const

/** 实验性种类（私有接口，随时可能失效）。 */
export const EXPERIMENTAL_KINDS = ['x-graphql', 'ig-graphql'] as const
