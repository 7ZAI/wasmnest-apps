/**
 * News dev-shell 领域种子数据（SDK PluginDevMock 协议）
 *
 * 只被 dev-shell 浏览器演示消费；真实宿主忽略该导出，无需条件编译。
 * 种子用于在 dev-shell 里看卡片流的真实形态（真实宿主无源时是空态）。
 */
import type { NewsCircle, NewsItem, NewsSource } from './types'

const now = Date.now()

const CIRCLES: NewsCircle[] = [
  {
    id: 'circle-tech',
    name: '科技',
    weight: 1,
    sortOrder: 0,
    createdAt: now - 86_400_000,
    sourceCount: 2,
  },
  {
    id: 'circle-world',
    name: '国际',
    weight: 1.2,
    sortOrder: 1,
    createdAt: now - 86_400_000,
    sourceCount: 1,
  },
]

const SOURCES: NewsSource[] = [
  {
    id: 'src-hn-top',
    name: 'Hacker News Top',
    kind: 'hn',
    url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    circleId: 'circle-tech',
    weight: 1,
    enabled: true,
    experimental: false,
    hasCredential: false,
    state: { failCount: 0, lastFetchAt: now - 3 * 60_000, lastOkAt: now - 3 * 60_000 },
  },
  {
    id: 'src-guardian-world',
    name: 'The Guardian World',
    kind: 'rss',
    url: 'https://www.theguardian.com/world/rss',
    circleId: 'circle-world',
    weight: 1,
    enabled: true,
    experimental: false,
    hasCredential: false,
    state: {
      failCount: 3,
      lastFetchAt: now - 20 * 60_000,
      lastOkAt: now - 3 * 3_600_000,
      lastErrorKind: 'parse.no_feed',
      lastErrorDetail: 'response is not XML (does it require login?)',
      nextRetryAt: now + 30 * 60_000,
    },
  },
]

const ITEMS: NewsItem[] = [
  {
    id: 'seed-1',
    title: '开源模型发布新的多模态权重，社区开始复现评测',
    summary: '模型卡提供了图像、音频与文本的联合训练细节，社区在 24 小时内提交了多份复现结果。',
    url: 'https://example.com/news/seed-1',
    publishedAt: now - 35 * 60 * 1000,
    firstSeenAt: now - 30 * 60 * 1000,
    sourceId: 'src-hn-top',
    sourceName: 'Hacker News Top',
    circleId: 'circle-tech',
    circleName: '科技',
    read: false,
    favorite: false,
    originCount: 2,
    score: 1.42,
  },
  {
    id: 'seed-2',
    title: '浏览器平台新增滚动状态查询，粘性表头不再依赖脚本',
    summary: '容器查询与 scroll-state 的组合让粘性分组标题可以纯 CSS 感知自身是否被吸顶。',
    url: 'https://example.com/news/seed-2',
    publishedAt: now - 2 * 60 * 60 * 1000,
    firstSeenAt: now - 90 * 60 * 1000,
    sourceId: 'src-hn-top',
    sourceName: 'Hacker News Top',
    circleId: 'circle-tech',
    circleName: '科技',
    read: true,
    favorite: true,
    favoritedAt: now - 60 * 60 * 1000,
    originCount: 1,
    score: 0.91,
  },
  {
    id: 'seed-3',
    title: '多国就新一轮气候融资框架达成初步一致',
    summary: '谈判在最后一天把损失与损害基金的触发条件写入附件，仍需各国议会批准。',
    url: 'https://example.com/news/seed-3',
    publishedAt: now - 5 * 60 * 60 * 1000,
    firstSeenAt: now - 4 * 60 * 60 * 1000,
    sourceId: 'src-guardian-world',
    sourceName: 'The Guardian World',
    circleId: 'circle-world',
    circleName: '国际',
    read: false,
    favorite: false,
    originCount: 1,
    score: 0.44,
  },
]

export const devMock = {
  circles: CIRCLES,
  sources: SOURCES,
  items: ITEMS,
  feed: {
    items: ITEMS,
    windowHours: 24,
    generatedAt: now,
  },
}

export default devMock
