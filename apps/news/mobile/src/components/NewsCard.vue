<template>
  <button
    type="button"
    class="news-mobile-card"
    :class="{ 'is-read': item.read }"
    :data-mobile-news-item="item.id"
    :data-testid="`mobile-news-item-${item.id}`"
    @click="emit('open', item)"
  >
    <span class="news-mobile-card-meta">
      <span class="news-mobile-card-source">{{ item.sourceName }}</span>
      <span aria-hidden="true">·</span>
      <span class="news-mobile-time">{{ relative }}</span>
      <span
        v-if="item.originCount > 1"
        class="news-mobile-origin"
        data-mobile-news-origin-count
        data-testid="mobile-news-origin-count"
      >
        · {{ t('news.card.sources', { count: item.originCount }) }}
      </span>
      <svg
        v-if="item.favorite"
        class="news-mobile-flag"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6 4h12v17l-6-4-6 4z" />
      </svg>
    </span>
    <span class="news-mobile-card-title">{{ item.title }}</span>
    <span v-if="item.summary" class="news-mobile-card-summary">{{ item.summary }}</span>
  </button>
</template>

<script setup lang="ts">
/** 移动端信息条：来源 / 时间一行，标题主导，两行摘要。整条是一个 button。 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { NewsItem } from '../types'
import { relativeLabel } from '../utils/format'

const props = defineProps<{ item: NewsItem; now?: number }>()
const emit = defineEmits<{ open: [item: NewsItem] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const relative = computed(() => {
  const label = relativeLabel(props.item.publishedAt, props.now ?? Date.now())
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
})
</script>

<style scoped>
.news-mobile-card {
  display: block;
  width: 100%;
  padding: 16px 0;
  text-align: start;
  border: 0;
  border-bottom: 1px solid var(--news-border);
  background: none;
  color: inherit;
  cursor: pointer;
}
.news-mobile-card:active {
  background: var(--news-bg-hover);
}
.news-mobile-card:focus-visible {
  outline: 2px solid var(--news-accent);
  outline-offset: -2px;
}
/* 签名细节：来源行前的 4px 墨蓝 tick，列表 / 状态 / 详情三处一致 */
.news-mobile-card-meta {
  display: flex;
  align-items: center;
  gap: var(--news-space-2);
  flex-wrap: wrap;
  font-family: var(--news-font-mono);
  font-size: var(--news-text-meta);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--news-text-tertiary);
}
.news-mobile-card-meta::before {
  content: '';
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 1px;
  background: var(--news-accent);
}
.news-mobile-card-source {
  font-family: var(--news-font-body);
  font-size: 12px;
  color: var(--news-text-secondary);
  font-weight: 500;
}
.news-mobile-time,
.news-mobile-origin {
  white-space: nowrap;
}
.news-mobile-flag {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--news-accent-ink);
}
.news-mobile-card-title {
  display: -webkit-box;
  margin: var(--news-space-2) 0;
  font-family: var(--news-font-display);
  font-size: 16px;
  line-height: 1.45;
  font-weight: 600;
  letter-spacing: 0.005em;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.news-mobile-card.is-read .news-mobile-card-title {
  color: var(--news-text-secondary);
  font-weight: 400;
}
.news-mobile-card-summary {
  display: -webkit-box;
  margin: 0;
  font-size: var(--news-text-body);
  line-height: 1.65;
  color: var(--news-text-secondary);
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
