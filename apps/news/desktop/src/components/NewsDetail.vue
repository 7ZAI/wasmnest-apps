<template>
  <aside class="news-detail" data-news-detail data-testid="news-detail">
    <header class="news-detail-head">
      <span class="news-detail-title">{{ t('news.detail.title') }}</span>
      <button
        type="button"
        class="news-icon-btn"
        :aria-label="t('news.toolbar.close')"
        data-news-detail-close
        data-testid="news-detail-close"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>
    <div class="news-detail-body">
      <p class="news-detail-kicker">
        <span>{{ item.sourceName }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ item.circleName }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ published }}</span>
        <span v-if="item.author" aria-hidden="true">·</span>
        <span v-if="item.author">{{ item.author }}</span>
      </p>
      <h2 class="news-detail-heading">{{ item.title }}</h2>

      <p v-if="item.summary" class="news-detail-summary" data-news-detail-summary>
        {{ item.summary }}
      </p>
      <p v-else class="news-detail-placeholder" data-news-detail-placeholder>
        {{ t('news.detail.noSummary') }}
      </p>

      <div class="news-detail-actions">
        <button
          type="button"
          class="news-detail-primary"
          data-news-copy
          data-testid="news-copy"
          @click="emit('copy', item.url)"
        >
          {{ t('news.detail.copy') }}
        </button>
        <button
          type="button"
          class="news-btn"
          :class="{ on: item.favorite }"
          :aria-pressed="item.favorite"
          data-news-favorite
          data-testid="news-favorite"
          @click="emit('toggle-favorite')"
        >
          {{ item.favorite ? t('news.detail.unfavorite') : t('news.detail.favorite') }}
        </button>
        <button
          type="button"
          class="news-btn"
          :aria-pressed="item.read"
          data-news-toggle-read
          data-testid="news-toggle-read"
          @click="emit('toggle-read')"
        >
          {{ item.read ? t('news.detail.markUnread') : t('news.detail.markRead') }}
        </button>
        <button
          type="button"
          class="news-btn"
          data-news-assistant-fetch
          data-testid="news-assistant-fetch"
          :title="t('news.detail.assistantUnavailable')"
          @click="emit('assistant-fetch')"
        >
          {{ t('news.detail.assistantFetch') }}
        </button>
      </div>

      <p class="news-detail-hint">{{ t('news.detail.openHint') }}</p>
      <p class="news-detail-link" data-news-detail-url data-testid="news-detail-url">
        {{ item.url }}
      </p>

      <details
        v-if="origins.length"
        class="news-detail-origins"
        data-news-origins
        data-testid="news-origins"
      >
        <summary>{{ t('news.detail.origins', { count: origins.length }) }}</summary>
        <ul>
          <li v-for="origin in origins" :key="origin.sourceId + origin.rawUrl">
            <span class="news-detail-origin-source">{{ origin.sourceName }}</span>
            <span class="news-detail-origin-title">{{ origin.sourceTitle ?? origin.rawUrl }}</span>
            <span class="news-detail-origin-url">{{ origin.rawUrl }}</span>
          </li>
        </ul>
      </details>
    </div>
  </aside>
</template>

<script setup lang="ts">
/** 信息条详情（桌面卡片流的右侧抽屉内容）：纯文本，不内嵌原文。 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NewsItem, NewsOrigin } from '../types'
import { relativeLabel } from '../utils/format'

const props = defineProps<{ item: NewsItem; origins: NewsOrigin[]; now?: number }>()
const emit = defineEmits<{
  close: []
  copy: [url: string]
  'toggle-favorite': []
  'toggle-read': []
  'assistant-fetch': []
}>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const published = computed(() => {
  const label = relativeLabel(props.item.publishedAt, props.now ?? Date.now())
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
})
</script>

<style scoped>
.news-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-card);
  border-inline-start: 1px solid var(--border);
  box-shadow: -14px 0 34px rgb(0 0 0 / 0.12);
}
.news-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 48px;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid var(--border);
}
.news-detail-title {
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.news-detail-head .news-icon-btn {
  margin-inline-start: auto;
}
.news-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-button, 8px);
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
}
.news-icon-btn:hover {
  color: var(--text-primary);
}
.news-icon-btn:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
.news-detail-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 28px 44px;
}
.news-detail-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0;
  font-size: var(--font-size-label, 12px);
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
}
.news-detail-heading {
  margin: 10px 0 12px;
  font-size: calc(26px * var(--ui-scale, 1));
  line-height: 1.28;
  font-weight: 650;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.news-detail-summary {
  margin: 0 0 20px;
  max-width: 62ch;
  font-size: calc(15px * var(--ui-scale, 1));
  line-height: 1.75;
  color: var(--text-primary);
  text-wrap: pretty;
}
.news-detail-placeholder {
  margin: 0 0 20px;
  font-size: var(--font-size-body, 13px);
  line-height: 1.7;
  color: var(--text-tertiary);
}
.news-detail-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
/* 主动作（复制链接）实心，其余动作保持次级：抽屉里只留一个主操作 */
.news-detail-primary {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-button, 8px);
  background: var(--color-primary);
  color: var(--bg-page);
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  cursor: pointer;
}
.news-detail-primary:hover {
  background: var(--color-primary-hover);
}
.news-btn {
  min-height: 32px;
  height: auto;
  padding: 4px 0 2px;
  border: 0;
  border-bottom: 1px solid var(--border-strong);
  border-radius: 0;
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-size-body, 13px);
  cursor: pointer;
}
.news-btn:hover {
  border-bottom-color: var(--text-primary);
  color: var(--text-primary);
}
.news-btn.on {
  color: var(--color-info);
  border-bottom-color: var(--color-info);
}
.news-btn:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
.news-detail-hint {
  margin: 0 0 6px;
  font-size: var(--font-size-label, 12px);
  color: var(--text-tertiary);
}
.news-detail-link {
  margin: 0 0 20px;
  padding: 0;
  font-size: var(--font-size-label, 12px);
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-all;
  user-select: all;
}
.news-detail-origins {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
/* 其它来源默认收起：抽屉首屏只留标题、摘要与一个主动作 */
.news-detail-origins summary {
  cursor: pointer;
  font-size: var(--font-size-label, 12px);
  font-weight: 600;
  color: var(--text-secondary);
}
.news-detail-origins summary::marker {
  color: var(--text-tertiary);
}
.news-detail-origins[open] summary {
  margin-bottom: 8px;
}
.news-detail-origins ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.news-detail-origins li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.news-detail-origin-source {
  font-size: var(--font-size-label, 12px);
  font-weight: 600;
  color: var(--text-secondary);
}
.news-detail-origin-title {
  font-size: var(--font-size-body, 13px);
  color: var(--text-primary);
}
.news-detail-origin-url {
  font-size: var(--font-size-tag, 11px);
  color: var(--text-tertiary);
  word-break: break-all;
  user-select: all;
}
</style>
