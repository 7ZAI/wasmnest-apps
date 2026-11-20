<template>
  <div class="news-app" :class="{ 'has-drawer': !!selected }" data-testid="news-view">
    <header class="news-top">
      <div class="news-seg" role="tablist" aria-label="news">
        <button
          v-for="key in FEED_VIEWS"
          :key="key"
          type="button"
          role="tab"
          :class="{ on: view === key && !page && !selected }"
          :aria-selected="view === key && !page && !selected"
          :data-news-view="key"
          :data-testid="`news-view-${key}`"
          @click="onSelectView(key)"
        >
          {{ t(`news.view.${key}`) }}
        </button>
      </div>
      <div class="news-tools">
        <button
          type="button"
          class="news-icon-btn"
          :disabled="refreshing"
          :title="refreshing ? t('news.toolbar.refreshing') : t('news.toolbar.refresh')"
          :aria-label="t('news.toolbar.refresh')"
          data-news-refresh
          data-testid="news-refresh"
          @click="onRefresh"
        >
          <svg
            class="news-ic"
            :class="{ spinning: refreshing }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <button
          type="button"
          class="news-icon-btn"
          :title="t('news.toolbar.markAllRead')"
          :aria-label="t('news.toolbar.markAllRead')"
          data-news-mark-all-read
          data-testid="news-mark-all-read"
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
          class="news-icon-btn"
          :title="t('news.toolbar.settings')"
          :aria-label="t('news.toolbar.settings')"
          data-news-open-settings
          data-testid="news-open-settings"
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
      </div>
    </header>

    <main
      v-if="page === 'settings'"
      class="news-page"
      data-news-page="settings"
      data-testid="news-page-settings"
    >
      <SettingsPanel
        :version="props.version"
        :reader-enabled="readerEnabled"
        :reader-settings-warning="readerSettingsWarning?.code ?? null"
        :invoke-host="props.env?.invoke"
        @close="closeSettings"
        @changed="onSettingsChanged"
        @toast="showToast"
      />
    </main>

    <main v-else class="news-feed" data-news-feed data-testid="news-feed">
      <div class="news-feed-inner">
        <div class="news-feed-note">
          <b>{{ currentTitle }}</b>
          <span>{{ t(hintKey) }}</span>
          <span
            v-if="generatedAt"
            class="news-feed-cutoff"
            data-news-cutoff
            data-testid="news-cutoff"
          >
            {{ t('news.feed.cutoff', { time: clockLabel(generatedAt) }) }}
          </span>
          <span v-if="items.length" class="news-feed-count">
            {{ t('news.feed.count', { count: items.length }) }}
          </span>
        </div>

        <div v-if="view === 'circles'" class="news-chips" role="tablist">
          <button
            type="button"
            role="tab"
            class="news-chip"
            :class="{ on: circleId === null }"
            :aria-selected="circleId === null"
            data-news-circle-filter="all"
            data-testid="news-chip-all"
            @click="selectCircle(null)"
          >
            {{ t('news.view.allCircles') }}
          </button>
          <button
            v-for="circle in circles"
            :key="circle.id"
            type="button"
            role="tab"
            class="news-chip"
            :class="{ on: circleId === circle.id }"
            :aria-selected="circleId === circle.id"
            :data-news-circle="circle.id"
            :data-testid="`news-chip-${circle.id}`"
            @click="selectCircle(circle.id)"
          >
            {{ circle.name }}
          </button>
          <button
            type="button"
            role="tab"
            class="news-chip"
            :class="{ on: circleId === UNGROUPED_CIRCLE_ID }"
            :aria-selected="circleId === UNGROUPED_CIRCLE_ID"
            data-news-circle="ungrouped"
            data-testid="news-chip-ungrouped"
            @click="selectCircle(UNGROUPED_CIRCLE_ID)"
          >
            {{ t('news.view.ungrouped') }}
          </button>
        </div>

        <div
          v-if="failedSources.length"
          class="news-banner"
          role="alert"
          data-news-banner
          data-testid="news-banner"
        >
          <span>{{ t('news.banner.failed', { count: failedSources.length }) }}</span>
          <button
            type="button"
            class="news-link-btn"
            data-news-banner-open
            data-testid="news-banner-open"
            @click="openSettings"
          >
            {{ t('news.banner.openSettings') }}
          </button>
          <button
            type="button"
            class="news-link-btn"
            data-news-banner-dismiss
            data-testid="news-banner-dismiss"
            @click="dismissBanner"
          >
            {{ t('news.toolbar.close') }}
          </button>
        </div>

        <p v-if="error" class="news-error" role="alert" data-news-error data-testid="news-error">
          {{ t('news.error.loadFeed', { detail: errorTextOf(t, error) }) }}
        </p>

        <template v-else>
          <p
            v-if="readerSettingsWarning"
            class="news-note"
            role="status"
            data-news-reader-settings-warning
            data-testid="news-reader-settings-warning"
          >
            {{ t('news.reader.settingsLoadFailed') }}
          </p>

          <StatusBar v-if="view === 'realtime'" :sources="sources" :now="now" />

          <div v-if="loading && !items.length" class="news-loading" aria-busy="true">
            <span v-for="n in 3" :key="n" class="news-skeleton"></span>
          </div>

          <div
            v-else-if="!items.length"
            class="news-empty"
            data-news-empty
            data-testid="news-empty"
          >
            <b>{{ t(emptyKeys.title) }}</b>
            <span>{{ t(emptyKeys.body) }}</span>
            <div class="news-empty-actions">
              <button
                type="button"
                class="news-primary"
                data-news-empty-add
                data-testid="news-empty-add"
                @click="openSettings"
              >
                {{ t('news.feed.addSource') }}
              </button>
              <button
                type="button"
                class="news-link-btn"
                data-news-empty-refresh
                data-testid="news-empty-refresh"
                @click="onRefresh"
              >
                {{ t('news.toolbar.refresh') }}
              </button>
            </div>
            <div v-if="sources.length" class="news-empty-sources">
              <h4>{{ t('news.feed.emptySourcesTitle') }}</h4>
              <p>{{ t('news.feed.emptySourcesBody') }}</p>
              <ul>
                <li v-for="source in sources.slice(0, 3)" :key="source.id">
                  <span class="news-empty-source-name">{{ source.name }}</span>
                  <span class="news-empty-source-url">{{ source.url }}</span>
                </li>
              </ul>
            </div>
            <div class="news-empty-kinds">
              <span v-for="kind in EMPTY_KINDS" :key="kind" class="news-empty-kind">
                {{ t(`news.settings.sources.kind.${kind}`) }}
              </span>
            </div>
          </div>

          <div v-else class="news-cards" data-news-cards data-testid="news-cards">
            <NewsCard
              v-for="item in items"
              :key="item.id"
              :item="item"
              :now="now"
              @open="openItem"
            />
          </div>
        </template>
      </div>
    </main>

    <template v-if="selected">
      <button
        type="button"
        class="news-scrim"
        :aria-label="t('news.toolbar.close')"
        data-news-scrim
        data-testid="news-scrim"
        @click="closeItem"
      ></button>
      <div class="news-drawer">
        <NewsDetail
          :item="selected"
          :origins="origins"
          :now="now"
          :reader-enabled="readerEntryEnabled"
          @close="closeItem"
          @copy="copyLink"
          @toggle-favorite="toggleFavorite"
          @toggle-read="toggleRead"
          @assistant-fetch="onAssistantFetch"
          @open-settings="openReaderSettings"
          @toast="showToast"
        />
      </div>
    </template>

    <div
      v-if="copyFallbackUrl"
      class="news-fallback"
      role="dialog"
      data-news-copy-fallback
      data-testid="news-copy-fallback"
    >
      <p>{{ t('news.detail.copyFallbackTitle') }}</p>
      <textarea readonly :value="copyFallbackUrl" data-news-copy-fallback-text></textarea>
      <button
        type="button"
        class="news-primary"
        data-testid="news-copy-fallback-close"
        @click="copyFallbackUrl = ''"
      >
        {{ t('news.detail.copyFallbackClose') }}
      </button>
    </div>

    <div v-if="toastText" class="news-toast" role="status" data-news-toast data-testid="news-toast">
      {{ toastText }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * News 桌面主界面：今日 / 圈子 / 实时 / 收藏四段 + 详情抽屉 + 设置页。
 *
 * 数据经 `useNewsFeed` 走插件命令面；空态给「去添加源」，失败给 banner 与源状态，
 * 复制失败给可选中文本——三条都是「不静默」的落点。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import NewsCard from './NewsCard.vue'
import NewsDetail from './NewsDetail.vue'
import SettingsPanel from './SettingsPanel.vue'
import StatusBar from './StatusBar.vue'
import { bootstrapNewsFeed, FEED_VIEWS, useNewsFeed } from '../composables/useNewsFeed'
import { UNGROUPED_CIRCLE_ID, type FeedView } from '../types'
import { clockLabel } from '../utils/format'
import { errorText as errorTextOf } from '../utils/errors'

const props = defineProps<{
  version: string
  env?: {
    invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  }
}>()

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
  page,
  selected,
  origins,
  failedSources,
  canMarkAllRead,
  load,
  loadCircles,
  loadSources,
  loadSettings,
  readerEnabled,
  readerSettingsReady,
  readerSettingsWarning,
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
  copyLink: copyLinkCommand,
  dismissBanner,
  tickNow,
} = controller

const readerEntryEnabled = computed(() => readerSettingsReady.value && readerEnabled.value)

const HINT_KEYS: Record<FeedView, string> = {
  today: 'news.feed.todayHint',
  circles: 'news.feed.circlesHint',
  realtime: 'news.feed.realtimeHint',
  saved: 'news.feed.savedHint',
}

/** 空态里点明可添加的源类型（真实支持的能力，取自设置页同一份 kind 文案） */
const EMPTY_KINDS = ['rss', 'youtube-rss', 'hn', 'reddit'] as const

const EMPTY_KEYS: Record<FeedView, { title: string; body: string }> = {
  today: { title: 'news.feed.emptyToday.title', body: 'news.feed.emptyToday.body' },
  circles: { title: 'news.feed.emptyCircles.title', body: 'news.feed.emptyCircles.body' },
  realtime: { title: 'news.feed.emptyRealtime.title', body: 'news.feed.emptyRealtime.body' },
  saved: { title: 'news.feed.emptySaved.title', body: 'news.feed.emptySaved.body' },
}

const hintKey = computed(() => HINT_KEYS[view.value])
const emptyKeys = computed(() => EMPTY_KEYS[view.value])
const currentTitle = computed(() => {
  if (view.value !== 'circles') return t(`news.view.${view.value}`)
  if (!circleId.value) return t('news.view.circles')
  if (circleId.value === UNGROUPED_CIRCLE_ID) return t('news.view.ungrouped')
  return (
    circles.value.find((circle) => circle.id === circleId.value)?.name ?? t('news.view.circles')
  )
})

const copyFallbackUrl = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
const toastText = ref('')

function showToast(text: string): void {
  toastText.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastText.value = ''
    toastTimer = null
  }, 2600)
}

function onSelectView(next: FeedView): void {
  void setView(next)
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
    const detail = errorTextOf(t, e)
    showToast(detail)
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
  // 反向代抓：宿主未提供该能力，入口固定显性提示，不发请求
  showToast(t('news.detail.assistantUnavailable'))
}

function openReaderSettings(): void {
  closeItem()
  openSettings()
}

async function onSettingsChanged(): Promise<void> {
  await Promise.all([loadCircles(), loadSources(), load(), loadSettings()])
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (copyFallbackUrl.value) {
    copyFallbackUrl.value = ''
  } else if (selected.value) {
    closeItem()
  } else if (page.value === 'settings') {
    closeSettings()
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') {
    tickNow()
    void refreshStale()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibility)
  clockTimer = setInterval(tickNow, 60_000)
  await bootstrapNewsFeed(controller)
  void refreshStale()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
  if (toastTimer) clearTimeout(toastTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.news-primary {
  height: 34px;
  margin-top: 12px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-button, 8px);
  background: var(--color-primary);
  color: var(--bg-page);
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  cursor: pointer;
}
.news-link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-label, 12px);
  cursor: pointer;
}
.news-link-btn:hover {
  color: var(--text-primary);
}
/* 抓取失败横幅：安静的提示行，不抢版面焦点。
   失败明细在「设置 → 源」逐源列出，红色留给那里真正需要用户处理的地方。 */
.news-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 8px 0 12px;
  padding: 9px 12px;
  border-radius: var(--radius-card, 10px);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--font-size-label, 12px);
}
.news-feed-cutoff,
.news-feed-count {
  font-size: var(--font-size-tag, 11px);
  color: var(--text-tertiary);
}
.news-feed-count {
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
}
.spinning {
  animation: news-spin 0.9s linear infinite;
}
@keyframes news-spin {
  to {
    transform: rotate(360deg);
  }
}
.news-fallback {
  position: absolute;
  inset-inline: 24px;
  bottom: 24px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 520px;
  margin-inline: auto;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-card, 10px);
  background: var(--bg-card);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
}
.news-fallback p {
  margin: 0;
  font-size: var(--font-size-body, 13px);
  color: var(--text-secondary);
}
.news-fallback textarea {
  width: 100%;
  min-height: 58px;
  padding: 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-button, 8px);
  background: var(--bg-page);
  color: var(--text-primary);
  font-size: var(--font-size-label, 12px);
  resize: vertical;
  user-select: all;
}
.news-fallback .news-primary {
  margin-top: 0;
  align-self: flex-end;
}
</style>
