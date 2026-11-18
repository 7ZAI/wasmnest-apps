/**
 * News 卡片流的取数与视图状态（移动端）
 *
 * 数据经插件命令面取回；不直接碰网络 / 文件。错误保留原文交给界面展示
 * （fail-visible），不静默吞成空列表。
 */
import { computed, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { FeedView, NewsCircle, NewsFeed, NewsItem } from '../types'

export const FEED_VIEWS: readonly FeedView[] = ['today', 'circles', 'realtime', 'saved']

const HINT_KEYS: Record<FeedView, string> = {
  today: 'news.feed.todayHint',
  circles: 'news.feed.circlesHint',
  realtime: 'news.feed.realtimeHint',
  saved: 'news.feed.savedHint',
}

const EMPTY_KEYS: Record<FeedView, { title: string; body: string }> = {
  today: { title: 'news.feed.emptyToday.title', body: 'news.feed.emptyToday.body' },
  circles: { title: 'news.feed.emptyCircles.title', body: 'news.feed.emptyCircles.body' },
  realtime: { title: 'news.feed.emptyRealtime.title', body: 'news.feed.emptyRealtime.body' },
  saved: { title: 'news.feed.emptySaved.title', body: 'news.feed.emptySaved.body' },
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 创建卡片流控制器（首次加载由界面在挂载时调用）。 */
export function useNewsFeed(context: PluginContext) {
  const view = ref<FeedView>('today')
  const circleId = ref<string | null>(null)
  const circles = ref<NewsCircle[]>([])
  const items = ref<NewsItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selected = ref<NewsItem | null>(null)

  const hintKey = computed(() => HINT_KEYS[view.value])
  const emptyKeys = computed(() => EMPTY_KEYS[view.value])

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const feed = (await context.commands.execute('news.list-feed', {
        view: view.value,
        circleId: circleId.value,
      })) as NewsFeed
      items.value = feed.items
    } catch (e) {
      items.value = []
      error.value = errorText(e)
    } finally {
      loading.value = false
    }
  }

  async function loadCircles(): Promise<void> {
    try {
      const result = (await context.commands.execute('news.list-circles')) as {
        circles: NewsCircle[]
      }
      circles.value = result.circles
    } catch {
      circles.value = []
    }
  }

  async function setView(next: FeedView): Promise<void> {
    if (view.value === next) return
    view.value = next
    selected.value = null
    await load()
  }

  async function selectCircle(id: string): Promise<void> {
    circleId.value = id
    view.value = 'circles'
    selected.value = null
    await load()
  }

  function openItem(item: NewsItem): void {
    selected.value = item
  }

  function closeItem(): void {
    selected.value = null
  }

  async function refresh(): Promise<void> {
    // 抓取引擎尚未实现：后端显式报错，界面据此提示，不假装已刷新
    await context.commands.execute('news.refresh')
    await load()
  }

  return {
    view,
    circleId,
    circles,
    items,
    loading,
    error,
    selected,
    hintKey,
    emptyKeys,
    load,
    loadCircles,
    setView,
    selectCircle,
    openItem,
    closeItem,
    refresh,
  }
}