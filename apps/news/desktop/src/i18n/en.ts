import type { MessageSchema } from './messages'

/** English 翻译（与 zh-CN 的 key 由 MessageSchema 编译期强制同步） */
const en: MessageSchema = {
  'news.view.today': 'Today',
  'news.view.circles': 'Circles',
  'news.view.realtime': 'Realtime',
  'news.view.saved': 'Saved',

  'news.toolbar.refresh': 'Refresh',

  'news.toolbar.settings': 'Settings',
  'news.toolbar.close': 'Close',
  'news.toolbar.back': 'Back',

  'news.feed.todayHint': 'Rolling 24 hours · ranked by source weight and freshness',
  'news.feed.circlesHint': 'Circle weight decides ranking inside the group',
  'news.feed.realtimeHint': 'Last 6 hours · by first-seen time',
  'news.feed.savedHint': 'Saved items never expire',

  'news.feed.emptyToday.title': 'Nothing in the past 24 hours',
  'news.feed.emptyToday.body': 'Refresh above, or add a source in settings.',
  'news.feed.emptyCircles.title': 'This circle has no items yet',
  'news.feed.emptyCircles.body': 'Add a source to the circle and fetched items show up here.',
  'news.feed.emptyRealtime.title': 'Nothing in the last 6 hours',
  'news.feed.emptyRealtime.body': 'Refresh once, or wait for the next automatic round.',
  'news.feed.emptySaved.title': 'Nothing saved yet',
  'news.feed.emptySaved.body': 'Saving is not wired yet in the v1 skeleton; a later version adds it to the item detail.',

  'news.card.unread': 'Unread',
  'news.card.read': 'Read',
  'news.card.sources': '{count} sources',

  'news.detail.title': 'Item',
  'news.detail.copyLink': 'Copy link',

  'news.detail.sourceHealthy': 'Sources healthy',

  'news.settings.title': 'Settings',
  'news.settings.sources': 'Sources',
  'news.settings.circles': 'Circles',
  'news.settings.general': 'Fetching & display',
  'news.settings.notWired': 'Not wired yet: the v1 skeleton only ships mounting and the four tabs.',

  'news.error.loadFeed': 'Load failed: {detail}',
  'news.toast.copied': 'Link copied',
  'news.toast.copyFailed': 'Copy failed; select the link text manually',
  'news.toast.refreshUnavailable': 'Refresh is not wired yet: the fetch engine comes later.',


  'news.relative.justNow': 'just now',
  'news.relative.minutes': '{count}m ago',
  'news.relative.hours': '{count}h ago',
  'news.relative.days': '{count}d ago',

  'news.preview.title': 'News',
  'news.preview.empty': 'No items',

}

export default en