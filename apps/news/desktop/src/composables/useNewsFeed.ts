/**
 * News 卡片流的取数与视图状态（组合式，纯 UI 编排）
 *
 * 所有数据经插件命令面取回；不直接碰网络 / 文件。错误保留分类码交给界面展示
 * （fail-visible），不静默吞成空列表。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  FeedQuery,
  FeedView,
  NewsCircle,
  NewsFeed,
  NewsItem,
  NewsOrigin,
  NewsSettings,
  NewsSource,
  RefreshOutcome,
  SourceFetchResult,
} from '../types'
import { parseError, type NewsError } from '../utils/errors'

export const FEED_VIEWS: readonly FeedView[] = ['today', 'circles', 'realtime', 'saved']

export type CopyResult = 'copied' | 'fallback'

export interface NewsFeedController {
  view: Ref<FeedView>
  circleId: Ref<string | null>
  circles: Ref<NewsCircle[]>
  sources: Ref<NewsSource[]>
  items: Ref<NewsItem[]>
  windowHours: Ref<number | null>
  generatedAt: Ref<number>
  now: Ref<number>
  readerEnabled: Ref<boolean>
  readerSettingsReady: Ref<boolean>
  lastKnownReaderEnabled: Ref<boolean | null>
  readerSettingsWarning: Ref<NewsError | null>
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  error: Ref<string | null>
  page: Ref<'settings' | null>
  selected: Ref<NewsItem | null>
  origins: Ref<NewsOrigin[]>
  detailLoading: Ref<boolean>
  lastOutcome: Ref<RefreshOutcome | null>
  failedSources: ComputedRef<SourceFetchResult[]>
  canMarkAllRead: ComputedRef<boolean>
  load: () => Promise<void>
  loadCircles: () => Promise<void>
  loadSources: () => Promise<void>
  loadSettings: () => Promise<void>
  setView: (next: FeedView) => Promise<void>
  selectCircle: (id: string | null) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  openItem: (item: NewsItem) => Promise<void>
  closeItem: () => void
  refresh: () => Promise<RefreshOutcome | null>
  refreshStale: () => Promise<void>
  markAllRead: () => Promise<number>
  toggleFavorite: () => Promise<void>
  toggleRead: () => Promise<void>
  copyLink: (url: string) => Promise<CopyResult>
  dismissBanner: () => void
  tickNow: () => void
}

function nowMs(): number {
  return Date.now()
}

/**
 * 创建卡片流控制器。
 *
 * 首次 `load()` 由界面在挂载时调用（组合式本身不启动副作用，便于组件级测试）。
 */
export function useNewsFeed(context: PluginContext): NewsFeedController {
  const view = ref<FeedView>('today')
  const circleId = ref<string | null>(null)
  const circles = ref<NewsCircle[]>([])
  const sources = ref<NewsSource[]>([])
  const items = ref<NewsItem[]>([])
  const windowHours = ref<number | null>(24)
  const generatedAt = ref(0)
  const now = ref(nowMs())
  const readerEnabled = ref(true)
  const readerSettingsReady = ref(false)
  const lastKnownReaderEnabled = ref<boolean | null>(null)
  const readerSettingsWarning = ref<NewsError | null>(null)
  const loading = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)
  const page = ref<'settings' | null>(null)
  const selected = ref<NewsItem | null>(null)
  const origins = ref<NewsOrigin[]>([])
  const detailLoading = ref(false)
  const lastOutcome = ref<RefreshOutcome | null>(null)

  const failedSources = computed<SourceFetchResult[]>(() =>
    (lastOutcome.value?.results ?? []).filter(
      (result) => !result.ok && !result.skipped,
    ),
  )
  const canMarkAllRead = computed(() => items.value.some((item) => !item.read))

  function query(): FeedQuery {
    return { view: view.value, circleId: circleId.value }
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const feed = (await context.commands.execute('news.list-feed', {
        ...query(),
        nowMs: nowMs(),
      })) as NewsFeed
      items.value = feed.items ?? []
      windowHours.value = feed.windowHours
      generatedAt.value = feed.generatedAt
      now.value = nowMs()
    } catch (e) {
      items.value = []
      const parsed = parseError(e)
      error.value = parsed.detail ? `${parsed.code}: ${parsed.detail}` : parsed.code
    } finally {
      loading.value = false
    }
  }

  async function loadCircles(): Promise<void> {
    try {
      const result = (await context.commands.execute('news.list-circles')) as {
        circles: NewsCircle[]
      }
      circles.value = result.circles ?? []
    } catch {
      // 圈子列表取不到不影响主列表；切换圈子入口保持空
      circles.value = []
    }
  }

  async function loadSources(): Promise<void> {
    try {
      const result = (await context.commands.execute('news.list-sources')) as {
        sources: NewsSource[]
      }
      sources.value = result.sources ?? []
    } catch {
      sources.value = []
    }
  }

  async function loadSettings(): Promise<void> {
    try {
      const settings = (await context.commands.execute('news.get-settings')) as NewsSettings
      const enabled = !!settings.readerEnabled
      readerEnabled.value = enabled
      lastKnownReaderEnabled.value = enabled
      readerSettingsWarning.value = null
    } catch (e) {
      readerEnabled.value = lastKnownReaderEnabled.value ?? true
      readerSettingsWarning.value = parseError(e)
    } finally {
      readerSettingsReady.value = true
    }
  }

  async function setView(next: FeedView): Promise<void> {
    view.value = next
    page.value = null
    selected.value = null
    if (next !== 'circles') circleId.value = null
    await load()
  }

  async function selectCircle(id: string | null): Promise<void> {
    circleId.value = id
    view.value = 'circles'
    page.value = null
    selected.value = null
    await load()
  }

  function openSettings(): void {
    page.value = 'settings'
    selected.value = null
  }

  function closeSettings(): void {
    page.value = null
  }

  async function openItem(item: NewsItem): Promise<void> {
    selected.value = item
    origins.value = item.origins ?? []
    if (!item.read) {
      // 打开即已读：先本地置位（列表立即反馈），失败时回滚由后端状态覆盖
      item.read = true
      try {
        await context.commands.execute('news.mark-read', {
          itemId: item.id,
          read: true,
          nowMs: nowMs(),
        })
      } catch {
        await load()
      }
    }
    detailLoading.value = true
    try {
      const detail = (await context.commands.execute('news.get-item', {
        itemId: item.id,
        nowMs: nowMs(),
      })) as { item: NewsItem; origins: NewsOrigin[] } | null
      if (detail) {
        selected.value = detail.item
        origins.value = detail.origins ?? []
      }
    } catch {
      // 详情取不到仍可展示列表里已有的字段（标题 / 来源 / 链接）
    } finally {
      detailLoading.value = false
    }
  }

  function closeItem(): void {
    selected.value = null
    origins.value = []
  }

  function applyOutcome(outcome: RefreshOutcome): void {
    lastOutcome.value = outcome
  }

  async function refresh(): Promise<RefreshOutcome | null> {
    refreshing.value = true
    try {
      const outcome = (await context.commands.execute('news.refresh-all', {
        nowMs: nowMs(),
      })) as RefreshOutcome
      applyOutcome(outcome)
      await Promise.all([load(), loadSources(), loadCircles()])
      return outcome
    } catch (e) {
      const parsed = parseError(e)
      error.value = parsed.detail ? `${parsed.code}: ${parsed.detail}` : parsed.code
      return null
    } finally {
      refreshing.value = false
    }
  }

  /** 回前台 / 首次挂载的补抓：只抓陈旧的源，退避中的不动。 */
  async function refreshStale(): Promise<void> {
    try {
      const outcome = (await context.commands.execute('news.refresh-stale', {
        nowMs: nowMs(),
      })) as RefreshOutcome
      if (outcome.newItems > 0 || outcome.failed > 0) {
        applyOutcome(outcome)
        await load()
      }
      await loadSources()
    } catch {
      // 补抓失败不影响首屏；错误经源状态与抓取记录暴露
    }
  }

  async function markAllRead(): Promise<number> {
    const result = (await context.commands.execute('news.mark-all-read', {
      ...query(),
      nowMs: nowMs(),
    })) as { count: number }
    items.value = items.value.map((item) => ({ ...item, read: true }))
    return result.count
  }

  async function toggleFavorite(): Promise<void> {
    const item = selected.value
    if (!item) return
    const next = !item.favorite
    await context.commands.execute('news.set-favorite', {
      itemId: item.id,
      favorite: next,
      nowMs: nowMs(),
    })
    item.favorite = next
    const listItem = items.value.find((entry) => entry.id === item.id)
    if (listItem) listItem.favorite = next
    if (view.value === 'saved' && !next) {
      items.value = items.value.filter((entry) => entry.id !== item.id)
    }
  }

  async function toggleRead(): Promise<void> {
    const item = selected.value
    if (!item) return
    const next = !item.read
    await context.commands.execute('news.mark-read', {
      itemId: item.id,
      read: next,
      nowMs: nowMs(),
    })
    item.read = next
    const listItem = items.value.find((entry) => entry.id === item.id)
    if (listItem) listItem.read = next
  }

  /**
   * 复制链接：先走后端系统剪贴板（桌面），本端不支持时回退浏览器剪贴板。
   * 两条路都失败 = 返回 `fallback`，界面给出可选中的链接文本。
   */
  async function copyLink(url: string): Promise<CopyResult> {
    try {
      await context.commands.execute('news.copy-link', { url })
      return 'copied'
    } catch (e) {
      if (parseError(e).code !== 'port.unsupported') {
        // 桌面剪贴板后端真的失败了，再试一次浏览器通道
      }
    }
    try {
      if (!navigator.clipboard?.writeText) return 'fallback'
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch {
      return 'fallback'
    }
  }

  function dismissBanner(): void {
    lastOutcome.value = null
  }

  function tickNow(): void {
    now.value = nowMs()
  }

  return {
    view,
    circleId,
    circles,
    sources,
    items,
    windowHours,
    generatedAt,
    now,
    readerEnabled,
    readerSettingsReady,
    lastKnownReaderEnabled,
    readerSettingsWarning,
    loading,
    refreshing,
    error,
    page,
    selected,
    origins,
    detailLoading,
    lastOutcome,
    failedSources,
    canMarkAllRead,
    load,
    loadCircles,
    loadSources,
    loadSettings,
    setView,
    selectCircle,
    openSettings,
    closeSettings,
    openItem,
    closeItem,
    refresh,
    refreshStale,
    markAllRead,
    toggleFavorite,
    toggleRead,
    copyLink,
    dismissBanner,
    tickNow,
  }
}

/** 供界面挂载时并行拉取首屏数据。 */
export async function bootstrapNewsFeed(controller: NewsFeedController): Promise<void> {
  await Promise.all([
    controller.load(),
    controller.loadCircles(),
    controller.loadSources(),
    controller.loadSettings(),
  ])
}

/** 供源 / 圈子变更后刷新全部派生数据。 */
export async function reloadAll(controller: NewsFeedController): Promise<void> {
  await Promise.all([
    controller.loadCircles(),
    controller.loadSources(),
    controller.load(),
    controller.loadSettings(),
  ])
}
