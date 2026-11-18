<template>
  <button
    type="button"
    class="news-m-card"
    :class="{ 'is-read': item.read }"
    :data-news-mobile-item="item.id"
    @click="emit('open', item)"
  >
    <span class="news-m-card-meta">
      <span class="news-m-card-source">{{ item.sourceName }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ item.circleName }}</span>
      <span aria-hidden="true">·</span>
      <span class="news-m-time">{{ relative }}</span>
      <span v-if="item.originCount > 1" class="news-m-source-count">
        · {{ t('news.card.sources', { count: item.originCount }) }}
      </span>
    </span>
    <span class="news-m-card-title">{{ item.title }}</span>
    <span v-if="item.summary" class="news-m-card-summary">{{ item.summary }}</span>
  </button>
</template>

<script setup lang="ts">
/** 移动端信息条（编辑列表）：来源 / 圈子 / 时间一行，标题主导，两行摘要。 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { NewsItem } from '../types'
import { relativeLabel } from '../utils/format'

const props = defineProps<{ item: NewsItem; now?: number }>()
const emit = defineEmits<{ open: [item: NewsItem] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const relative = computed(() => {
  const label = relativeLabel(props.item.seenAt, props.now ?? Date.now())
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
})
</script>

<style scoped>
.news-m-card {
  display: block;
  width: 100%;
  padding: 12px 14px 13px;
  text-align: start;
  border: 0;
  border-bottom: 1px solid var(--news-border-strong);
  background: none;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s;
}
.news-m-card:active {
  background: var(--news-bg-hover);
}
.news-m-card:focus-visible {
  outline: 2px solid var(--news-accent);
  outline-offset: -2px;
}
.news-m-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--news-text-tertiary);
}
.news-m-card-source {
  color: var(--news-text-secondary);
  font-weight: 500;
}
.news-m-time {
  font-variant-numeric: tabular-nums;
}
.news-m-source-count {
  color: var(--news-text-tertiary);
}
.news-m-card-title {
  display: -webkit-box;
  margin: 5px 0 3px;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  text-wrap: balance;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.news-m-card.is-read .news-m-card-title {
  color: var(--news-text-secondary);
  font-weight: 400;
}
.news-m-card-summary {
  display: -webkit-box;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--news-text-secondary);
  text-wrap: pretty;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>