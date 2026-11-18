<template>
  <div class="news-mobile-app" data-news-mobile-app>
    <header class="news-mobile-header">
      <b>{{ currentTitle }}</b>
      <span class="news-mobile-spacer"></span>
      <button
        type="button"
        class="news-mobile-icon-btn"
        :title="t('news.toolbar.settings')"
        :aria-label="t('news.toolbar.settings')"
        data-news-mobile-settings
        @click="openSettings"
      >
        <svg class="news-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </svg>
      </button>
    </header>

    <div class="news-mobile-body">
      <p class="news-mobile-note">{{ t(hintKey) }}</p>

      <div v-if="view === 'circles' && circles.length" class="news-mobile-chips">
        <button
          v-for="circle in circles"
          :key="circle.id"
          type="button"
          class="news-mobile-chip"
          :class="{ on: circleId === circle.id }"
          :data-news-mobile-circle="circle.id"
          @click="selectCircle(circle.id)"
        >
          {{ circle.name }}
        </button>
      </div>

      <p v-if="error" class="news-mobile-error" role="alert" data-news-mobile-error>
        {{ t('news.error.loadFeed', { detail: error }) }}
      </p>

      <div v-else-if="!items.length" class="news-mobile-empty" data-news-mobile-empty>
        <b>{{ t(emptyKeys.title) }}</b>
        <span>{{ t(emptyKeys.body) }}</span>
      </div>

      <div v-else data-news-mobile-cards>
        <NewsCard v-for="item in items" :key="item.id" :item="item" @open="openItem" />
      </div>
    </div>

    <nav class="news-mobile-tabbar">
      <button
        v-for="key in FEED_VIEWS"
        :key="key"
        type="button"
        class="news-mobile-tab"
        :class="{ on: view === key && !selected }"
        :aria-current="view === key && !selected ? 'page' : undefined"
        :data-news-mobile-view="key"
        @click="onSelectView(key)"
      >
        {{ t(`news.view.${key}`) }}
      </button>
    </nav>

    <div v-if="selected" class="news-mobile-detail" data-news-mobile-detail>
      <div class="news-mobile-detail-head">
        <button
          type="button"
          class="news-mobile-icon-btn"
          :aria-label="t('news.toolbar.back')"
          data-news-mobile-detail-back
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
        <p v-if="selected.summary" class="news-d-summary">{{ selected.summary }}</p>
        <button type="button" class="news-d-btn" data-news-mobile-copy @click="copyLink(selected.url)">
          {{ t('news.detail.copyLink') }}
        </button>
        <p class="news-d-link">{{ selected.url }}</p>
        <p class="news-d-status">{{ t('news.detail.sourceHealthy') }} · {{ selected.originCount }}</p>
      </div>
    </div>

    <div v-if="toastText" class="news-mobile-toast" role="status" data-news-mobile-toast>
      {{ toastText }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * News 移动运行面（卡片流）：顶栏标题 + 卡片列表 + 底栏四段 + 全屏详情。
 *
 * 详情是应用自持浮层：Android 返回键经 `context.ui.onBackPressed` 先收详情，
 * 未打开详情时不消费，交宿主兜底。设置走宿主二级页（registerRoute settings）。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import NewsCard from './NewsCard.vue'
import { FEED_VIEWS, useNewsFeed } from '../composables/useNewsFeed'
import type { FeedView } from '../types'
import { relativeLabel } from '../utils/format'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const controller = useNewsFeed(context)
const { view, circleId, circles, items, error, selected, hintKey, emptyKeys, setView, selectCircle, openItem, closeItem } =
  controller

const currentTitle = computed(() => {
  if (view.value !== 'circles' || !circleId.value) return t(`news.view.${view.value}`)
  const circle = circles.value.find((c) => c.id === circleId.value)
  return circle ? circle.name : t('news.view.circles')
})

function relativeOf(at: number): string {
  const label = relativeLabel(at)
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
}

function onSelectView(next: FeedView): void {
  void setView(next)
}

function openSettings(): void {
  // 宿主二级页（header: true，带返回）；不需要应用自绘页头
  context.ui.openPage('settings')
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
const toastText = ref('')

function showToast(text: string): void {
  toastText.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastText.value = ''
    toastTimer = null
  }, 2200)
}

async function copyLink(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    showToast(t('news.toast.copyFailed'))
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    showToast(t('news.toast.copied'))
  } catch {
    showToast(t('news.toast.copyFailed'))
  }
}

let backSub: { dispose(): void } | null = null

onMounted(() => {
  void Promise.all([controller.load(), controller.loadCircles()])
  backSub = context.ui.onBackPressed(() => {
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
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style scoped>
.news-d-kicker {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin: 0;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--news-text-tertiary);
}
.news-d-title {
  margin: 10px 0 10px;
  font-size: 22px;
  line-height: 1.32;
  font-weight: 650;
  letter-spacing: -0.012em;
  text-wrap: balance;
}
.news-d-summary {
  margin: 0 0 18px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--news-text-primary);
  text-wrap: pretty;
}
.news-d-btn {
  min-height: 32px;
  height: auto;
  padding: 4px 0 2px;
  border: 0;
  border-bottom: 1px solid var(--news-border-strong);
  border-radius: 0;
  background: none;
  color: var(--news-text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.news-d-btn:active {
  border-bottom-color: var(--news-text-primary);
  color: var(--news-text-primary);
}
.news-d-btn:focus-visible {
  outline: 2px solid var(--news-accent);
  outline-offset: 2px;
}
.news-d-link {
  margin: 16px 0 0;
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  line-height: 1.5;
  color: var(--news-text-tertiary);
  word-break: break-all;
  user-select: all;
}
.news-d-status {
  margin: 20px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--news-border);
  font-size: 11.5px;
  color: var(--news-text-secondary);
}
</style>