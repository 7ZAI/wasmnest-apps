/**
 * News 移动端 i18n 消息类型（唯一 key 来源）
 *
 * zh-CN 与 en 两个语言文件都必须实现该类型：新增 / 遗漏 key 在编译期即报错。
 */
export type MessageSchema = {
  'news.view.today': string
  'news.view.circles': string
  'news.view.realtime': string
  'news.view.saved': string

  'news.toolbar.settings': string
  'news.toolbar.close': string
  'news.toolbar.back': string

  'news.feed.todayHint': string
  'news.feed.circlesHint': string
  'news.feed.realtimeHint': string
  'news.feed.savedHint': string

  'news.feed.emptyToday.title': string
  'news.feed.emptyToday.body': string
  'news.feed.emptyCircles.title': string
  'news.feed.emptyCircles.body': string
  'news.feed.emptyRealtime.title': string
  'news.feed.emptyRealtime.body': string
  'news.feed.emptySaved.title': string
  'news.feed.emptySaved.body': string

  'news.card.unread': string
  'news.card.read': string
  'news.card.sources': string

  'news.detail.title': string
  'news.detail.copyLink': string
  'news.detail.sourceHealthy': string

  'news.settings.title': string
  'news.settings.sources': string
  'news.settings.circles': string
  'news.settings.general': string
  'news.settings.notWired': string

  'news.error.loadFeed': string
  'news.toast.copied': string
  'news.toast.copyFailed': string
  'news.toast.refreshUnavailable': string

  'news.relative.justNow': string
  'news.relative.minutes': string
  'news.relative.hours': string
  'news.relative.days': string
}