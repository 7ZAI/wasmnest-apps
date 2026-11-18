/**
 * News 插件 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错，
 * 保证两个语言文件的 key 永远同步。所有 key 以 `news.` 域命名，注册时经插件 ID
 * 前缀隔离为 `com.wasmnest.news.news.*`。
 */

export type MessageSchema = {
  // ==================== 顶栏分段 ====================
  'news.view.today': string
  'news.view.circles': string
  'news.view.realtime': string
  'news.view.saved': string

  // ==================== 工具栏 ====================
  'news.toolbar.refresh': string

  'news.toolbar.settings': string
  'news.toolbar.close': string
  'news.toolbar.back': string

  // ==================== 订阅流表头提示 ====================
  'news.feed.todayHint': string
  'news.feed.circlesHint': string
  'news.feed.realtimeHint': string
  'news.feed.savedHint': string

  // ==================== 空态 ====================
  'news.feed.emptyToday.title': string
  'news.feed.emptyToday.body': string
  'news.feed.emptyCircles.title': string
  'news.feed.emptyCircles.body': string
  'news.feed.emptyRealtime.title': string
  'news.feed.emptyRealtime.body': string
  'news.feed.emptySaved.title': string
  'news.feed.emptySaved.body': string

  // ==================== 卡片 ====================
  'news.card.unread': string
  'news.card.read': string
  'news.card.sources': string

  // ==================== 详情 ====================
  'news.detail.title': string
  'news.detail.copyLink': string

  'news.detail.sourceHealthy': string

  // ==================== 设置 ====================
  'news.settings.title': string
  'news.settings.sources': string
  'news.settings.circles': string
  'news.settings.general': string
  'news.settings.notWired': string

  // ==================== 错误与提示 ====================
  'news.error.loadFeed': string
  'news.toast.copied': string
  'news.toast.copyFailed': string
  'news.toast.refreshUnavailable': string


  // ==================== 相对时间 ====================
  'news.relative.justNow': string
  'news.relative.minutes': string
  'news.relative.hours': string
  'news.relative.days': string

  // ==================== 多任务卡片预览面 ====================
  'news.preview.title': string
  'news.preview.empty': string

}