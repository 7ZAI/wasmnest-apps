<template>
  <div class="news-app">
    <header class="news-top">
      <div class="news-seg" role="tablist" aria-label="news">
        <button
          v-for="key in FEED_VIEWS"
          :key="key"
          type="button"
          role="tab"
          :class="{ on: view === key && !page }"
          :aria-selected="view === key && !page"
          :data-news-view="key"
          @click="onSelectView(key)"
        >
          {{ t(`news.view.${key}`) }}
        </button>
      </div>
      <div class="news-tools">
        <button
          type="button"
          class="news-icon-btn"
          :title="t('news.toolbar.refresh')"
          :aria-label="t('news.toolbar.refresh')"
          data-news-refresh
          @click="onRefresh"
        >
          <svg class="news-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <button
          type="button"
          class="news-icon-btn"
          :title="t('news.toolbar.settings')"
          :aria-label="t('news.toolbar.settings')"
          data-news-open-settings
          @click="openSettings"
        >
          <svg class="news-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
          </svg>
        </button>
      </div>
    </header>

    <main v-if="page === 'settings'" class="news-page" data-news-page="settings">
      <SettingsPanel @close="closeSettings" />
    </main>

    <main v-else class="news-feed">
      <div class="news-feed-inner">
        <div class="news-feed-note">
          <b>{{ currentTitle }}</b>
          <span>{{ t(hintKey) }}</span>
        </div>

        <div v-if="view === 'circles' && circles.length" class="news-chips">
          <button
            v-for="circle in circles"
            :key="circle.id"
            type="button"
            class="news-chip"
            :class="{ on: circleId === circle.id }"
            :data-news-circle="circle.id"
            @click="selectCircle(circle.id)"
          >
            {{ circle.name }}
          </button>
        </div>

        <p v-if="error" class="news-error" role="alert" data-news-error>
          {{ t('news.error.loadFeed', { detail: error }) }}
        </p>

        <div v-else-if="loading && !items.length" class="news-loading" aria-busy="true">
          <span v-for="n in 3" :key="n" class="news-skeleton"></span>
        </div>

        <div v-else-if="!items.length" class="news-empty" data-news-empty>
          <b>{{ t(emptyKeys.title) }}</b>
          <span>{{ t(emptyKeys.body) }}</span>
        </div>

        <div v-else class="news-cards" data-news-cards>
          <NewsCard v-for="item in items" :key="item.id" :item="item" @open="openItem" />
        </div>
      </div>
    </main>

    <template v-if="selected">
      <button
        type="button"
        class="news-scrim"
        :aria-label="t('news.toolbar.close')"
        data-news-scrim
        @click="closeItem"
      ></button>
      <div class="news-drawer">
        <NewsDetail :item="selected" @close="closeItem" @copy="copyLink" />
      </div>
    </template>

    <div v-if="toastText" class="news-toast" role="status" data-news-toast>{{ toastText }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * News 桌面卡片流（B 变体）：四段控（今日 / 圈子 / 实时 / 收藏）+ 单列卡片 + 右侧抽屉详情。
 *
 * 数据经 `useNewsFeed` 走插件命令面；点卡片记下当前条目再打开抽屉，抽屉关闭
 * 只清选中态，不重新请求。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import NewsCard from './NewsCard.vue'
import NewsDetail from './NewsDetail.vue'
import SettingsPanel from './SettingsPanel.vue'
import { bootstrapNewsFeed, FEED_VIEWS, useNewsFeed } from '../composables/useNewsFeed'
import type { FeedView } from '../types'

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const controller = useNewsFeed(context)
const {
  view,
  circleId,
  circles,
  items,
  loading,
  error,
  page,
  selected,
  hintKey,
  emptyKeys,
  setView,
  selectCircle,
  openSettings,
  closeSettings,
  openItem,
  closeItem,
} = controller

const currentTitle = computed(() => {
  if (view.value !== 'circles' || !circleId.value) return t(`news.view.${view.value}`)
  const circle = circles.value.find((c) => c.id === circleId.value)
  return circle ? circle.name : t('news.view.circles')
})

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

function onSelectView(next: FeedView): void {
  void setView(next)
}

async function onRefresh(): Promise<void> {
  // 抓取引擎尚未实现：后端显式报错，这里按提示展示，不假装刷新成功
  try {
    await controller.refresh()
  } catch {
    showToast(t('news.toast.refreshUnavailable'))
  }
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

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (selected.value) {
    closeItem()
  } else if (page.value === 'settings') {
    closeSettings()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void bootstrapNewsFeed(controller)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>