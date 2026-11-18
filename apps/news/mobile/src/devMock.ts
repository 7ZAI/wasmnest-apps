/**
 * News 移动端 dev-shell 领域种子数据（SDK PluginDevMock 协议）
 *
 * 仅 dev-shell 浏览器演示消费；真实宿主忽略该导出。种子用于看卡片流的真实
 * 形态（真实宿主无源时是空态）。
 */
import type { NewsCircle, NewsItem } from './types'

const now = Date.now()

const CIRCLES: NewsCircle[] = [
  { id: 'world', name: '世界', weight: 1, sourceCount: 2 },
  { id: 'ai', name: 'AI', weight: 1.5, sourceCount: 2 },
  { id: 'dev', name: '开发', weight: 1, sourceCount: 1 },
]

const ITEMS: NewsItem[] = [
  {
    id: 'seed-1',
    title: '开源模型发布新的多模态权重，社区开始复现评测',
    summary: '模型卡提供了图像、音频与文本的联合训练细节，社区在 24 小时内提交了多份复现结果。',
    url: 'https://example.com/news/seed-1',
    sourceId: 'hn',
    sourceName: 'Hacker News',
    circleId: 'ai',
    circleName: 'AI',
    publishedAt: now - 35 * 60 * 1000,
    seenAt: now - 30 * 60 * 1000,
    read: false,
    favorite: false,
    originCount: 2,
  },
  {
    id: 'seed-2',
    title: '浏览器平台新增滚动状态查询，粘性表头不再依赖脚本',
    summary: '容器查询与 scroll-state 的组合让粘性分组标题可以纯 CSS 感知自身是否被吸顶。',
    url: 'https://example.com/news/seed-2',
    sourceId: 'web',
    sourceName: 'Web.dev',
    circleId: 'dev',
    circleName: '开发',
    publishedAt: now - 2 * 60 * 60 * 1000,
    seenAt: now - 90 * 60 * 1000,
    read: true,
    favorite: false,
    originCount: 1,
  },
  {
    id: 'seed-3',
    title: '跨端桌面框架发布运行时打包方案，插件改为按需取用',
    summary: '宿主运行时与 SDK 拆成两条版本轴，应用侧用 lock 文件钉住兼容组合。',
    url: 'https://example.com/news/seed-3',
    sourceId: 'hn',
    sourceName: 'Hacker News',
    circleId: 'dev',
    circleName: '开发',
    publishedAt: now - 5 * 60 * 60 * 1000,
    seenAt: now - 4 * 60 * 60 * 1000,
    read: false,
    favorite: false,
    originCount: 1,
  },
]

export const devMock = {
  circles: CIRCLES,
  items: ITEMS,
  feed: {
    items: ITEMS,
    windowHours: 24,
    generatedAt: now,
  },
}

export default devMock