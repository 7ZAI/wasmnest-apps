<template>
  <div class="news-mobile-app" data-mobile-news-app data-testid="mobile-news-root">
    <header class="news-mobile-header">
      <b>{{ currentTitle }}</b>
      <span class="news-mobile-spacer"></span>
      <button
        type="button"
        class="news-mobile-icon-btn"
        :title="t('news.toolbar.markAllRead')"
        :aria-label="t('news.toolbar.markAllRead')"
        data-mobile-news-mark-all-read
        data-testid="mobile-news-mark-all-read"
        :disabled="!canMarkAllRead"
        @click="onMarkAllRead"
      >
        <svg
          class="news-ic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m3 12 5 5L21 4" />
        </svg>
      </button>
      <button
        type="button"
        class="news-mobile-icon-btn"
        :title="t('news.toolbar.settings')"
        :aria-label="t('news.toolbar.settings')"
        data-mobile-news-settings
        data-testid="mobile-news-settings"
        @click="openSettings"
      >
        <svg
          class="news-ic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
          />
        </svg>
      </button>
    </header>

    <div
      ref="scrollEl"
      class="news-mobile-body"
      data-mobile-news-feed
      data-testid="mobile-news-feed"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div
        class="news-mobile-pull"
        :class="{ on: pullDistance > 4 || refreshing }"
        :style="{ height: `${pullDistance}px` }"
        :data-news-pulling="pullDistance > 4 || refreshing"
        data-mobile-news-pull
        data-testid="mobile-news-pull"
      >
        <span>{{ refreshing ? t('news.toolbar.refreshing') : t('news.toolbar.refresh') }}</span>
      </div>

      <p class="news-mobile-note">
        <span>{{ t(hintKey) }}</span>
        <span
          v-if="generatedAt"
          class="news-mobile-cutoff"
          data-mobile-news-cutoff
          data-testid="mobile-news-cutoff"
        >
          {{ t('news.feed.cutoff', { time: clockLabel(generatedAt) }) }}
        </span>
      </p>

      <div
        v-if="view === 'circles'"
        class="news-mobile-chips"
        data-testid="mobile-news-circle-chips"
      >
        <button
          type="button"
          class="news-mobile-chip"
          :class="{ on: circleId === null }"
          data-mobile-news-circle="all"
          data-testid="mobile-news-circle-all"
          @click="selectCircle(null)"
        >
          {{ t('news.view.allCircles') }}
        </button>
        <button
          v-for="circle in circles"
          :key="circle.id"
          type="button"
          class="news-mobile-chip"
          :class="{ on: circleId === circle.id }"
          :data-mobile-news-circle="circle.id"
          :data-testid="`mobile-news-circle-${circle.id}`"
          @click="selectCircle(circle.id)"
        >
          {{ circle.name }}
        </button>
        <button
          type="button"
          class="news-mobile-chip"
          :class="{ on: circleId === UNGROUPED_CIRCLE_ID }"
          data-mobile-news-circle="ungrouped"
          data-testid="mobile-news-circle-ungrouped"
          @click="selectCircle(UNGROUPED_CIRCLE_ID)"
        >
          {{ t('news.view.ungrouped') }}
        </button>
      </div>

      <div
        v-if="failedSources.length"
        class="news-mobile-banner"
        role="alert"
        data-mobile-news-banner
        data-testid="mobile-news-banner"
      >
        <span>{{ t('news.banner.failed', { count: failedSources.length }) }}</span>
        <button
          type="button"
          class="news-mobile-link-btn"
          data-mobile-news-banner-open
          data-testid="mobile-news-banner-open"
          @click="openSettings"
        >
          {{ t('news.banner.openSettings') }}
        </button>
      </div>

      <p
        v-if="error"
        class="news-mobile-error"
        role="alert"
        data-mobile-news-error
        data-testid="mobile-news-error"
      >
        {{ t('news.error.loadFeed', { detail: errorTextOf(t, error) }) }}
      </p>

      <template v-else>
        <section
          v-if="view === 'realtime'"
          class="news-mobile-status"
          data-mobile-news-status
          data-testid="mobile-news-status"
        >
          <h3>{{ t('news.status.title') }}</h3>
          <p v-if="!enabledSources.length" class="news-mobile-note">{{ t('news.status.empty') }}</p>
          <ul v-else>
            <li
              v-for="source in enabledSources"
              :key="source.id"
              :class="{ failing: source.state.failCount >= 3 }"
              :data-mobile-news-status-source="source.id"
              :data-testid="`mobile-news-status-source-${source.id}`"
            >
              <span class="news-mobile-status-name">{{ source.name }}</span>
              <span class="news-mobile-status-when">
                {{
                  source.state.lastFetchAt
                    ? relativeOf(source.state.lastFetchAt)
                    : t('news.status.never')
                }}
              </span>
              <span v-if="source.state.lastErrorKind" class="news-mobile-status-reason">
                {{ errorKindText(t, source.state.lastErrorKind) }}
              </span>
            </li>
          </ul>
        </section>

        <div v-if="loading && !items.length" class="news-mobile-empty" aria-busy="true">
          <span>{{ t('news.toolbar.refreshing') }}</span>
        </div>

        <div
          v-else-if="!items.length"
          class="news-mobile-empty"
          data-mobile-news-empty
          data-testid="mobile-news-empty"
        >
          <b>{{ t(emptyKeys.title) }}</b>
          <span>{{ t(emptyKeys.body) }}</span>
          <button
            type="button"
            class="news-mobile-primary"
            data-mobile-news-empty-add
            data-testid="mobile-news-empty-add"
            @click="openSettings"
          >
            {{ t('news.feed.addSource') }}
          </button>
        </div>

        <div v-else data-mobile-news-cards data-testid="mobile-news-cards">
          <NewsCard v-for="item in items" :key="item.id" :item="item" :now="now" @open="openItem" />
        </div>
      </template>
    </div>

    <nav class="news-mobile-tabbar" data-testid="mobile-news-tabbar">
      <button
        v-for="key in FEED_VIEWS"
        :key="key"
        type="button"
        class="news-mobile-tab"
        :class="{ on: view === key && !selected }"
        :aria-current="view === key && !selected ? 'page' : undefined"
        :data-mobile-news-view="key"
        :data-testid="`mobile-news-tab-${key}`"
        @click="onSelectView(key)"
      >
        {{ t(`news.view.${key}`) }}
      </button>
    </nav>

    <div
      v-if="selected"
      class="news-mobile-detail"
      data-mobile-news-detail
      data-testid="mobile-news-detail"
    >
      <div class="news-mobile-detail-head">
        <button
          type="button"
          class="news-mobile-icon-btn"
          :aria-label="t('news.toolbar.back')"
          data-mobile-news-detail-back
          data-testid="mobile-news-detail-back"
          @click="closeItem"
        >
          ←
        </button>
        <b>{{ t('news.detail.title') }}</b>
      </div>
      <div class="news-mobile-detail-body">
        <p class="news-d-kicker">
          <span>{{ selected.sourceName }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ selected.circleName }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ relativeOf(selected.publishedAt) }}</span>
        </p>
        <h2 class="news-d-title">{{ selected.title }}</h2>
        <p
          v-if="selected.summary"
          class="news-d-summary"
          data-mobile-news-detail-summary
          data-testid="mobile-news-detail-summary"
        >
          {{ selected.summary }}
        </p>
        <p
          v-else
          class="news-d-placeholder"
          data-mobile-news-detail-placeholder
          data-testid="mobile-news-detail-placeholder"
        >
          {{ t('news.detail.noSummary') }}
        </p>

        <div class="news-d-actions">
          <button
            type="button"
            class="news-d-btn"
            data-mobile-news-copy
            data-testid="mobile-news-copy"
            @click="copyLink(selected.url)"
          >
            {{ t('news.detail.copy') }}
          </button>
          <button
            type="button"
            class="news-d-btn"
            :class="{ on: selected.favorite }"
            :aria-pressed="selected.favorite"
            data-mobile-news-favorite
            data-testid="mobile-news-favorite"
            @click="toggleFavorite"
          >
            {{ selected.favorite ? t('news.detail.unfavorite') : t('news.detail.favorite') }}
          </button>
          <button
            type="button"
            class="news-d-btn"
            data-mobile-news-toggle-read
            data-testid="mobile-news-toggle-read"
            @click="toggleRead"
          >
            {{ selected.read ? t('news.detail.markUnread') : t('news.detail.markRead') }}
          </button>
          <button
            type="button"
            class="news-d-btn"
            data-mobile-news-assistant-fetch
            data-testid="mobile-news-assistant-fetch"
            @click="onAssistantFetch"
          >
            {{ t('news.detail.assistantFetch') }}
          </button>
        </div>

        <p class="news-d-hint">{{ t('news.detail.openHint') }}</p>
        <p class="news-d-link" data-mobile-news-detail-url data-testid="mobile-news-detail-url">
          {{ selected.url }}
        </p>

        <section
          v-if="origins.length"
          class="news-d-origins"
          data-mobile-news-origins
          data-testid="mobile-news-origins"
        >
          <h3>{{ t('news.detail.origins', { count: origins.length }) }}</h3>
          <ul>
            <li v-for="origin in origins" :key="origin.sourceId + origin.rawUrl">
              <span class="news-d-origin-source">{{ origin.sourceName }}</span>
              <span class="news-d-origin-title">{{ origin.sourceTitle ?? origin.rawUrl }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div
      v-if="copyFallbackUrl"
      class="news-mobile-fallback"
      role="dialog"
      data-mobile-news-copy-fallback
      data-testid="mobile-news-copy-fallback"
    >
      <p>{{ t('news.detail.copyFallbackTitle') }}</p>
      <textarea
        readonly
        :value="copyFallbackUrl"
        data-mobile-news-copy-fallback-text
        data-testid="mobile-news-copy-fallback-text"
      ></textarea>
      <button
        type="button"
        class="news-mobile-primary"
        data-testid="mobile-news-copy-fallback-close"
        @click="copyFallbackUrl = ''"
      >
        {{ t('news.detail.copyFallbackClose') }}
      </button>
    </div>

    <div
      v-if="toastText"
      class="news-mobile-toast"
      role="status"
      data-mobile-news-toast
      data-testid="mobile-news-toast"
    >
      {{ toastText }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * News 移动运行面：全屏单页 + 底部分段 + 下拉刷新 + 全屏详情浮层。
 *
 * 双端差异在这里显式呈现：没有宿主定时器 → 打开补抓、回到前台补抓、下拉刷新；
 * 复制走浏览器剪贴板，失败给可选中文本（不静默失败）。
 *
 * 返回键：详情浮层由 `onBackPressed` 消费；设置是宿主二级页，由宿主逐级返回。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import NewsCard from './NewsCard.vue'
import { bootstrapNewsFeed, FEED_VIEWS, useNewsFeed } from '../composables/useNewsFeed'
import { UNGROUPED_CIRCLE_ID, type FeedView } from '../types'
import { clockLabel, relativeLabel } from '../utils/format'
import { errorKindText, errorText as errorTextOf } from '../utils/errors'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const controller = useNewsFeed(context)
const {
  view,
  circleId,
  circles,
  sources,
  items,
  generatedAt,
  now,
  loading,
  refreshing,
  error,
  selected,
  origins,
  failedSources,
  canMarkAllRead,
  setView,
  selectCircle,
  openItem,
  closeItem,
  refresh,
  refreshStale,
  markAllRead,
  toggleFavorite,
  toggleRead,
  copyLink: copyLinkCommand,
  tickNow,
} = controller

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

const hintKey = computed(() => HINT_KEYS[view.value])
const emptyKeys = computed(() => EMPTY_KEYS[view.value])
const enabledSources = computed(() => sources.value.filter((source) => source.enabled))
const currentTitle = computed(() => {
  if (view.value !== 'circles') return t(`news.view.${view.value}`)
  if (!circleId.value) return t('news.view.circles')
  if (circleId.value === UNGROUPED_CIRCLE_ID) return t('news.view.ungrouped')
  return (
    circles.value.find((circle) => circle.id === circleId.value)?.name ?? t('news.view.circles')
  )
})

const scrollEl = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let pullStartY = 0
let pulling = false
const PULL_TRIGGER = 52

function relativeOf(at: number): string {
  const label = relativeLabel(at, now.value)
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
}

function onSelectView(next: FeedView): void {
  void setView(next)
}

function openSettings(): void {
  // 宿主二级页（header: true，带返回）；系统返回键由宿主逐级收
  context.ui.openPage('settings')
}

function onTouchStart(event: TouchEvent): void {
  const el = scrollEl.value
  if (!el || el.scrollTop > 0 || event.touches.length !== 1) {
    pulling = false
    return
  }
  pullStartY = event.touches[0].clientY
  pulling = true
}

function onTouchMove(event: TouchEvent): void {
  if (!pulling || event.touches.length !== 1) return
  const delta = event.touches[0].clientY - pullStartY
  if (delta <= 0) {
    pullDistance.value = 0
    return
  }
  // 阻尼：拉半程，避免长列表里手势与滚动打架
  pullDistance.value = Math.min(96, Math.round(delta * 0.5))
}

async function onTouchEnd(): Promise<void> {
  if (!pulling) return
  pulling = false
  const shouldRefresh = pullDistance.value >= PULL_TRIGGER
  pullDistance.value = 0
  if (shouldRefresh) await onRefresh()
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
const toastText = ref('')
const copyFallbackUrl = ref('')

function showToast(text: string): void {
  toastText.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastText.value = ''
    toastTimer = null
  }, 2200)
}

async function onRefresh(): Promise<void> {
  const outcome = await refresh()
  if (!outcome) return
  if (outcome.blocked) {
    showToast(t('news.banner.blocked'))
    return
  }
  showToast(t('news.toast.refreshed', { newItems: outcome.newItems }))
}

async function onMarkAllRead(): Promise<void> {
  try {
    const count = await markAllRead()
    showToast(t('news.toast.markedAllRead', { count }))
  } catch (e) {
    showToast(errorTextOf(t, e))
  }
}

async function copyLink(url: string): Promise<void> {
  const result = await copyLinkCommand(url)
  if (result === 'copied') {
    showToast(t('news.toast.copied'))
  } else {
    copyFallbackUrl.value = url
    showToast(t('news.toast.copyFailed'))
  }
}

async function onAssistantFetch(): Promise<void> {
  showToast(t('news.detail.assistantUnavailable'))
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') {
    tickNow()
    void refreshStale()
  }
}

let backSub: { dispose(): void } | null = null

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  clockTimer = setInterval(tickNow, 60_000)
  void bootstrapNewsFeed(controller)
  void refreshStale()
  backSub = context.ui.onBackPressed(() => {
    if (copyFallbackUrl.value) {
      copyFallbackUrl.value = ''
      return true
    }
    if (selected.value) {
      closeItem()
      return true
    }
    return false
  })
})

onBeforeUnmount(() => {
  backSub?.dispose()
  backSub = null
  document.removeEventListener('visibilitychange', onVisibility)
  if (toastTimer) clearTimeout(toastTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.news-mobile-pull {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 0;
  overflow: hidden;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--news-text-tertiary);
  transition: height 0.12s ease-out;
}
.news-mobile-cutoff {
  margin-inline-start: var(--news-space-2);
  font-family: var(--news-font-mono);
  color: var(--news-text-tertiary);
}
.news-mobile-banner {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  margin: var(--news-space-2) 0 var(--news-space-3);
  padding: 12px;
  border-inline-start: 2px solid var(--news-accent);
  border-radius: var(--news-radius-control);
  background: var(--news-accent-soft);
  color: var(--news-accent-ink);
  font-size: 12px;
  line-height: 1.5;
}
.news-mobile-link-btn {
  min-height: 24px;
  border: 0;
  background: none;
  padding: 2px 0;
  color: var(--news-accent-ink);
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.news-mobile-status {
  margin: var(--news-space-1) 0 var(--news-space-3);
  padding: var(--news-space-4);
  border: 1px solid var(--news-border);
  border-radius: var(--news-radius-card);
  background: var(--news-bg-card);
}
.news-mobile-status h3 {
  margin: 0 0 var(--news-space-3);
  font-family: var(--news-font-display);
  font-size: var(--news-text-title);
  font-weight: 600;
  color: var(--news-text-primary);
}
.news-mobile-status ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}
.news-mobile-status li {
  display: flex;
  align-items: baseline;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  padding: var(--news-space-2) 0;
  border-bottom: 1px solid var(--news-border);
  font-size: 12px;
  line-height: 1.5;
  color: var(--news-text-tertiary);
}
.news-mobile-status li:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.news-mobile-status li::before {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 1px;
  background: var(--news-accent);
}
.news-mobile-status li.failing .news-mobile-status-name {
  color: var(--news-danger);
}
.news-mobile-status-name {
  font-size: var(--news-text-body);
  font-weight: 500;
  color: var(--news-text-secondary);
}
.news-mobile-status-when,
.news-mobile-status-reason {
  font-family: var(--news-font-mono);
  font-size: var(--news-text-meta);
  font-variant-numeric: tabular-nums;
}
.news-mobile-status-reason {
  color: var(--news-danger);
}
.news-mobile-empty .news-mobile-primary {
  margin-top: var(--news-space-4);
}
.news-mobile-primary {
  height: 44px;
  padding: 0 var(--news-space-4);
  border: 0;
  border-radius: var(--news-radius-control);
  background: var(--news-accent);
  color: var(--news-on-accent);
  font-size: var(--news-text-body);
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    opacity 100ms ease-out;
}
.news-mobile-primary:active {
  transform: scale(0.98);
}
.news-d-kicker {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  margin: 0;
  font-family: var(--news-font-mono);
  font-size: var(--news-text-meta);
  font-variant-numeric: tabular-nums;
  color: var(--news-text-tertiary);
}
.news-d-kicker::before {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 1px;
  background: var(--news-accent);
}
.news-d-title {
  margin: var(--news-space-3) 0;
  font-family: var(--news-font-display);
  font-size: var(--news-text-headline);
  line-height: 1.38;
  font-weight: 600;
  text-wrap: balance;
}
.news-d-summary {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--news-text-primary);
  text-wrap: pretty;
}
.news-d-placeholder {
  margin: 0 0 20px;
  font-size: var(--news-text-body);
  line-height: 1.7;
  color: var(--news-text-tertiary);
}
.news-d-actions {
  display: flex;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  margin-bottom: var(--news-space-4);
}
.news-d-btn {
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: none;
  color: var(--news-text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.news-d-btn:active {
  background: var(--news-bg-hover);
}
.news-d-btn.on {
  border-color: var(--news-accent);
  background: var(--news-accent-soft);
  color: var(--news-accent-ink);
}
.news-d-hint {
  margin: 0 0 var(--news-space-2);
  font-size: 12px;
  color: var(--news-text-tertiary);
}
.news-d-link {
  margin: 0 0 20px;
  padding: 12px;
  border: 1px solid var(--news-border);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-card);
  font-family: var(--news-font-mono);
  font-size: var(--news-text-meta);
  line-height: 1.6;
  color: var(--news-text-tertiary);
  word-break: break-all;
  user-select: all;
}
.news-d-origins {
  padding-top: var(--news-space-3);
  border-top: 1px solid var(--news-border);
}
.news-d-origins h3 {
  margin: 0 0 var(--news-space-2);
  font-family: var(--news-font-display);
  font-size: var(--news-text-body);
  font-weight: 600;
  color: var(--news-text-secondary);
}
.news-d-origins ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--news-space-2);
}
.news-d-origins li {
  display: flex;
  flex-direction: column;
  gap: var(--news-space-1);
  padding: var(--news-space-2) 0;
  border-bottom: 1px solid var(--news-border);
}
.news-d-origins li:last-child {
  border-bottom: 0;
}
.news-d-origin-source {
  font-family: var(--news-font-mono);
  font-size: var(--news-text-meta);
  font-weight: 500;
  color: var(--news-text-tertiary);
}
.news-d-origin-title {
  font-size: var(--news-text-body);
  color: var(--news-text-primary);
}
.news-mobile-fallback {
  position: absolute;
  inset-inline: var(--news-space-3);
  bottom: 76px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: var(--news-space-3);
  padding: var(--news-space-4);
  border: 1px solid var(--news-border);
  border-radius: var(--news-radius-card);
  background: var(--news-bg-card);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
}
.news-mobile-fallback p {
  margin: 0;
  font-size: var(--news-text-body);
  color: var(--news-text-secondary);
}
.news-mobile-fallback textarea {
  width: 100%;
  min-height: 62px;
  padding: var(--news-space-2);
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-input);
  color: var(--news-text-primary);
  font-size: 12px;
  user-select: all;
}
</style>
