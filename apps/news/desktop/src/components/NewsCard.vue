<template>
  <button
    type="button"
    class="news-card"
    :class="{ 'is-read': item.read }"
    :data-news-item="item.id"
    @click="emit('open', item)"
  >
    <span class="news-card-meta">
      <span class="news-card-source">{{ item.sourceName }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ item.circleName }}</span>
      <span aria-hidden="true">·</span>
      <span class="news-time">{{ relative }}</span>
      <span v-if="item.originCount > 1" class="news-source-count">
        · {{ t('news.card.sources', { count: item.originCount }) }}
      </span>
    </span>
    <span class="news-card-title">{{ item.title }}</span>
    <span v-if="item.summary" class="news-card-summary">{{ item.summary }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * 信息条（编辑列表）：来源 / 圈子 / 时间一行，标题主导，两行摘要。
 *
 * 整条是一个 button（唯一动作层）。未读与已读只靠标题字重和颜色区分，
 * 不加彩色圆点、状态文字或多余徽标，避免与内容抢注意力。
 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
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
.news-card {
  display: block;
  width: 100%;
  padding: 12px 0 13px;
  text-align: start;
  border: 0;
  border-bottom: 1px solid var(--border-strong);
  background: none;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s;
}
.news-card:hover {
  background: var(--bg-hover);
}
.news-card:focus-visible {
  outline: 2px solid var(--color-info);
  outline-offset: -2px;
}
.news-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-tertiary);
}
.news-card-source {
  color: var(--text-secondary);
  font-weight: 500;
}
.news-time {
  font-variant-numeric: tabular-nums;
}
.news-source-count {
  color: var(--text-tertiary);
}
.news-card-title {
  display: -webkit-box;
  margin: 5px 0 3px;
  font-size: 15.5px;
  line-height: 1.4;
  font-weight: 600;
  text-wrap: balance;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.news-card.is-read .news-card-title {
  color: var(--text-secondary);
  font-weight: 400;
}
.news-card-summary {
  display: -webkit-box;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  text-wrap: pretty;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>