/**
 * News 前端领域类型（与 Rust `wasmnest-news-core::domain` 的 wire 形状一致）
 *
 * 时间字段统一为 Unix 毫秒；`read` / `favorite` 是信息条的用户态，`originCount`
 * 是跨源去重后的来源数（>= 1）。
 */

export type FeedView = 'today' | 'circles' | 'realtime' | 'saved'

export interface NewsItem {
  id: string
  title: string
  summary: string
  url: string
  sourceId: string
  sourceName: string
  circleId: string
  circleName: string
  publishedAt: number
  seenAt: number
  read: boolean
  favorite: boolean
  originCount: number
}

export interface NewsCircle {
  id: string
  name: string
  weight: number
  sourceCount: number
}

export interface NewsSource {
  id: string
  name: string
  kind: string
  circleId: string
  enabled: boolean
  lastError?: string
}

export interface NewsFeed {
  items: NewsItem[]
  windowHours: number
  generatedAt: number
}

export interface NewsSettings {
  refreshIntervalMinutes: number
  aiSummaryEnabled: boolean
  aiEndpoint: string
  aiModel: string
}

export interface FeedQuery {
  view: FeedView
  circleId?: string | null
}