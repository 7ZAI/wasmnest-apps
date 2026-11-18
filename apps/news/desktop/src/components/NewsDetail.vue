<template>
  <aside class="news-detail" data-news-detail>
    <header class="news-detail-head">
      <span class="news-detail-title">{{ t('news.detail.title') }}</span>
      <button type="button" class="news-icon-btn" :aria-label="t('news.toolbar.close')" @click="emit('close')">
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
      </p>
      <h2 class="news-detail-heading">{{ item.title }}</h2>
      <p v-if="item.summary" class="news-detail-summary">{{ item.summary }}</p>
      <div class="news-detail-actions">
        <button type="button" class="news-btn" data-news-copy @click="emit('copy', item.url)">
          {{ t('news.detail.copyLink') }}
        </button>
      </div>
      <p class="news-detail-link">{{ item.url }}</p>
      <p class="news-detail-status">{{ t('news.detail.sourceHealthy') }} · {{ item.originCount }}</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
/** 信息条详情（桌面卡片流的右侧抽屉内容）。 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NewsItem } from '../types'
import { relativeLabel } from '../utils/format'

const props = defineProps<{ item: NewsItem; now?: number }>()
const emit = defineEmits<{ close: []; copy: [url: string] }>()
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
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.news-detail-head .news-icon-btn {
  margin-inline-start: auto;
}
.news-icon-btn {
  width: 30px;
  height: 30px;
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
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
}
.news-detail-heading {
  margin: 10px 0 10px;
  font-size: 24px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.news-detail-summary {
  margin: 0 0 20px;
  max-width: 62ch;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--text-primary);
  text-wrap: pretty;
}
.news-detail-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.news-btn {
  min-height: 30px;
  height: auto;
  padding: 4px 0 2px;
  border: 0;
  border-bottom: 1px solid var(--border-strong);
  border-radius: 0;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.news-btn:hover {
  border-bottom-color: var(--text-primary);
  color: var(--text-primary);
}
.news-btn:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: 2px;
}
.news-detail-link {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
  word-break: break-all;
  user-select: all;
}
.news-detail-status {
  margin: 20px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-secondary);
}
</style>