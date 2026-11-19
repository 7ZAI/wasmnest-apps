<template>
  <!-- 多任务卡片只读预览面：只展示标题与条目数，无任何可聚焦控件 -->
  <div class="news-preview" data-news-preview>
    <div class="news-preview-head">
      <span class="news-preview-title">{{ t('news.preview.title') }}</span>
      <span v-if="total > 0" class="news-preview-count">{{ total }}</span>
    </div>
    <p v-if="total === 0" class="news-preview-empty">{{ t('news.preview.empty') }}</p>
    <ul v-else class="news-preview-list">
      <li v-for="item in items.slice(0, 3)" :key="item.id">{{ item.title }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 预览面（mountPreview）：只读一次 `news.list-feed`，拿不到数据就显示自己的空态。
 *
 * 禁止：写存储、启动轮询 / 通知、发起抓取。DOM 内不含 button / input / a 等
 * 可聚焦控件（卡片本身是唯一动作层）。
 */
import { onMounted, ref } from 'vue'
import type { AppPreviewEnv } from '../entry'
import type { NewsFeed, NewsItem } from '../types'
import { translate as t } from '../i18n'

const props = defineProps<{ env: AppPreviewEnv }>()

const items = ref<NewsItem[]>([])
const total = ref(0)

onMounted(async () => {
  try {
    const feed = await props.env.appInvoke<NewsFeed>('news.list-feed', { view: 'today' })
    items.value = feed.items
    total.value = feed.items.length
  } catch {
    // 预览拿不到数据 = 诚实空态；宿主超时后自行回退品牌卡
    items.value = []
    total.value = 0
  }
})
</script>

<style scoped>
.news-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary, inherit);
}
.news-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, inherit);
}
.news-preview-count {
  font-variant-numeric: tabular-nums;
}
.news-preview-empty {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary, inherit);
}
.news-preview-list {
  margin: 0;
  padding-inline-start: 14px;
  font-size: 11.5px;
  line-height: 1.5;
}
.news-preview-list li {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
</style>