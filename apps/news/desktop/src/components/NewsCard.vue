<template>
  <button
    type="button"
    class="news-card"
    :class="{ 'is-read': item.read }"
    :data-news-item="item.id"
    :data-testid="`news-item-${item.id}`"
    @click="emit('open', item)"
  >
    <span class="news-card-meta">
      <span class="news-card-avatar" aria-hidden="true">{{ avatarChar }}</span>
      <span class="news-card-source">{{ item.sourceName }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ item.circleName }}</span>
      <span aria-hidden="true">·</span>
      <span class="news-time" data-news-time>{{ relative }}</span>
      <span
        v-if="item.originCount > 1"
        class="news-source-count"
        data-news-origin-count
        data-testid="news-origin-count"
      >
        · {{ t('news.card.sources', { count: item.originCount }) }}
      </span>
      <span
        v-if="item.favorite"
        class="news-card-flag"
        :title="t('news.detail.favorite')"
        :aria-label="t('news.detail.favorite')"
      >
        <svg class="news-card-star" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path
            d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"
          />
        </svg>
      </span>
    </span>
    <span v-if="!item.read" class="news-card-sr">{{ t('news.card.unread') }}</span>
    <span class="news-card-title">{{ item.title }}</span>
    <span v-if="item.summary" class="news-card-summary">{{ item.summary }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * 信息条（编辑列表）：来源 / 圈子 / 时间一行，标题主导，两行摘要。
 *
 * 整条是一个 button（唯一动作层）。未读与已读的区别靠三处轻量标识：
 * 左侧强调色竖条、源名首字块（扫读锚点）、星标（收藏）；不加大段状态文字。
 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NewsItem } from '../types'
import { relativeLabel } from '../utils/format'

const props = defineProps<{ item: NewsItem; now?: number }>()
const emit = defineEmits<{ open: [item: NewsItem] }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

/** 时间基准用发布时间（新闻的「新旧」由发布时间决定）。 */
const relative = computed(() => {
  const label = relativeLabel(props.item.publishedAt, props.now ?? Date.now())
  return label.count == null ? t(label.key) : t(label.key, { count: label.count })
})

/** 源标识块：取源名首字符，给列表一个扫读锚点（真 favicon 需要后端抓取，暂缺）。 */
const avatarChar = computed(() => props.item.sourceName.trim().charAt(0) || '·')
</script>

<style scoped>
.news-card {
  position: relative;
  display: block;
  width: 100%;
  padding: 12px 14px 13px 18px;
  text-align: start;
  /* 条目之间用块面 + 间距分层（不使用 1px 横线：密集横线在暗底上像 ladder） */
  border: 0;
  border-radius: var(--radius-card, 10px);
  background: var(--bg-card);
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s;
}
/* 未读标识：左侧竖条 + 标题字重（未读与已读只差这一点）。
   竖条用中性色而不是强调色——一屏十条全是竖条时，强调色会退化成背景噪声，
   真正的强调色只留给选中态。 */
.news-card:not(.is-read)::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inset-block: 10px;
  width: 3px;
  border-start-start-radius: 3px;
  border-end-start-radius: 3px;
  background: var(--text-tertiary);
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
  font-size: var(--font-size-label, 12px);
  color: var(--text-secondary);
}
.news-card-source {
  color: var(--text-primary);
  font-weight: 500;
}
/* 源标识块：源名首字符，给列表一个扫读锚点 */
.news-card-avatar {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-tag, 11px);
  font-weight: 600;
  line-height: 1;
}
.news-time {
  font-variant-numeric: tabular-nums;
}
.news-source-count {
  color: var(--text-tertiary);
}
.news-card-flag {
  display: inline-flex;
  color: var(--color-info);
}
.news-card-star {
  width: 13px;
  height: 13px;
}
/* 未读的无障碍标记（视觉由左侧竖条承担，文字只给读屏） */
.news-card-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.news-card-title {
  display: -webkit-box;
  margin: 5px 0 3px;
  font-size: var(--font-size-xl, 16px);
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
  font-size: var(--font-size-lg, 14px);
  line-height: 1.6;
  color: var(--text-primary);
  text-wrap: pretty;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.news-card.is-read .news-card-summary {
  color: var(--text-secondary);
}
</style>
