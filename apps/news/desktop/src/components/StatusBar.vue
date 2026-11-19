<template>
  <section class="news-status" data-news-status data-testid="news-status" aria-live="polite">
    <h3 class="news-status-title">{{ t('news.status.title') }}</h3>
    <p v-if="!rows.length" class="news-status-empty">{{ t('news.status.empty') }}</p>
    <ul v-else class="news-status-list">
      <li
        v-for="row in rows"
        :key="row.source.id"
        class="news-status-row"
        :class="{ failing: row.failing }"
        :data-news-status-source="row.source.id"
        :data-news-failing="row.failing"
        :data-testid="`news-status-source-${row.source.id}`"
      >
        <span class="news-status-dot" :class="row.tone" aria-hidden="true"></span>
        <span class="news-status-name">{{ row.source.name }}</span>
        <span class="news-status-when">{{ row.when }}</span>
        <span v-if="row.reason" class="news-status-reason" :title="row.detail">
          {{ row.reason }}
        </span>
        <span v-if="row.failing" class="news-status-badge" data-news-status-failing>
          {{ t('news.settings.sources.failing', { count: row.source.state.failCount }) }}
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 源状态条：实时视图顶部固定展示「每源最近抓取时间 + 失败标记」。
 *
 * 状态判据与后端一致：连续 3 次失败才标红；退避中显示下次重试时间。
 */
import { computed, inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { NewsSource } from '../types'
import { clockLabel, relativeLabel } from '../utils/format'
import { errorKindText } from '../utils/errors'

const props = defineProps<{ sources: NewsSource[]; now: number }>()
const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

interface Row {
  source: NewsSource
  when: string
  tone: 'ok' | 'warn' | 'bad' | 'idle'
  failing: boolean
  reason: string
  detail: string
}

const rows = computed<Row[]>(() =>
  props.sources
    .filter((source) => source.enabled)
    .map((source) => {
      const state = source.state
      const lastFetch = state.lastFetchAt ?? 0
      let when = t('news.status.never')
      if (lastFetch > 0) {
        const label = relativeLabel(lastFetch, props.now)
        when = label.count == null ? t(label.key) : t(label.key, { count: label.count })
        when = `${when} · ${clockLabel(lastFetch)}`
      }
      const failing = state.failCount >= 3
      const backoff = (state.nextRetryAt ?? 0) > props.now
      const tone: Row['tone'] = failing
        ? 'bad'
        : state.lastErrorKind
          ? 'warn'
          : lastFetch > 0
            ? 'ok'
            : 'idle'
      const reason = state.lastErrorKind
        ? errorKindText(t, state.lastErrorKind)
        : backoff
          ? `${t('news.status.backoff')} ${clockLabel(state.nextRetryAt ?? 0)}`
          : ''
      return {
        source,
        when,
        tone,
        failing,
        reason,
        detail: state.lastErrorDetail ?? '',
      }
    }),
)
</script>

<style scoped>
.news-status {
  flex: none;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.news-status-title {
  margin: 0 0 6px;
  font-size: var(--font-size-body, 13px);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}
.news-status-empty {
  margin: 0;
  font-size: var(--font-size-body, 13px);
  color: var(--text-tertiary);
}
.news-status-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.news-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--font-size-label, 12px);
  color: var(--text-tertiary);
}
.news-status-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.news-status-dot.ok {
  background: var(--color-success);
}
.news-status-dot.warn {
  background: var(--color-warning);
}
.news-status-dot.bad {
  background: var(--color-danger);
}
.news-status-name {
  color: var(--text-primary);
  font-weight: 500;
}
.news-status-when {
  font-variant-numeric: tabular-nums;
}
.news-status-reason {
  color: var(--color-danger-ink);
}
.news-status-badge {
  padding: 1px 6px;
  border-radius: var(--radius-tag, 6px);
  background: var(--color-danger-light);
  color: var(--color-danger-ink);
  font-size: var(--font-size-tag, 11px);
}
</style>
