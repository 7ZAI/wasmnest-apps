import type { MessageSchema } from './messages'

/** 中文（默认）翻译 */
const zhCN: MessageSchema = {
  'news.view.today': '今日',
  'news.view.circles': '圈子',
  'news.view.realtime': '实时',
  'news.view.saved': '收藏',

  'news.toolbar.settings': '设置',
  'news.toolbar.close': '关闭',
  'news.toolbar.back': '返回',

  'news.feed.todayHint': '滚动 24 小时',
  'news.feed.circlesHint': '按圈子权重排序',
  'news.feed.realtimeHint': '最近 6 小时',
  'news.feed.savedHint': '收藏不会过期',

  'news.feed.emptyToday.title': '过去 24 小时还没有内容',
  'news.feed.emptyToday.body': '下拉刷新，或去设置添加一个源。',
  'news.feed.emptyCircles.title': '这个圈子还没有内容',
  'news.feed.emptyCircles.body': '给圈子添加源后，抓到的条目会出现在这里。',
  'news.feed.emptyRealtime.title': '最近 6 小时还没有内容',
  'news.feed.emptyRealtime.body': '刷新一次，或等待下一轮自动抓取。',
  'news.feed.emptySaved.title': '还没有收藏',
  'news.feed.emptySaved.body': 'v1 骨架尚未接入收藏写入；后续版本在信息条详情里提供。',

  'news.card.unread': '未读',
  'news.card.read': '已读',
  'news.card.sources': '{count} 个来源',

  'news.detail.title': '信息条',
  'news.detail.copyLink': '复制链接',
  'news.detail.sourceHealthy': '来源正常',

  'news.settings.title': '设置',
  'news.settings.sources': '源管理',
  'news.settings.circles': '圈子管理',
  'news.settings.general': '抓取与显示',
  'news.settings.notWired': '该分区尚未接入：v1 骨架只提供挂载与四段浏览。',

  'news.error.loadFeed': '加载失败：{detail}',
  'news.toast.copied': '链接已复制',
  'news.toast.copyFailed': '复制失败，请手动选择链接文本',
  'news.toast.refreshUnavailable': '刷新尚未接入：抓取引擎将在后续实现。',

  'news.relative.justNow': '刚刚',
  'news.relative.minutes': '{count} 分钟前',
  'news.relative.hours': '{count} 小时前',
  'news.relative.days': '{count} 天前',
}

export default zhCN