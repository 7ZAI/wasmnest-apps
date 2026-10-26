<script setup lang="ts">
/**
 * Monitor · 多任务卡片只读预览面（`mountPreview` 契约）
 *
 * - 只读：仅经 `env.appInvoke('monitor.snapshot')` 取一次数；不写存储、不发事件、
 *   不启动轮询 / 定时器；
 * - 点时刻：先渲染可读骨架，`onMounted` 里异步取一次；失败显示诚实空态；
 * - 无交互：DOM 内没有任何可聚焦控件（无 button / a[href] / 输入 / tabindex）；
 * - 轻量：不 import 主界面 / composable（不复用主实例状态），只调纯函数。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AppPreviewEnv } from '../entry'
import i18n, { MESSAGE_NAMESPACE } from '../i18n'
import { formatBytes, formatNumber, normalizeSnapshot, summarize } from '../utils/format'

const props = defineProps<{ env: AppPreviewEnv }>()

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})

type Summary = ReturnType<typeof summarize>

const loading = ref(true)
const failed = ref(false)
const summary = ref<Summary | null>(null)
let disposed = false

const hasData = computed(() => summary.value !== null && summary.value.pluginCount > 0)

async function load(): Promise<void> {
  try {
    const raw = await props.env.appInvoke<unknown>('monitor.snapshot')
    if (disposed) return
    summary.value = summarize(normalizeSnapshot(raw))
  } catch {
    if (!disposed) failed.value = true
  } finally {
    if (!disposed) loading.value = false
  }
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  disposed = true
})
</script>

<template>
  <div class="mnpv" :data-theme="env.theme" :data-locale="env.locale" :lang="env.locale">
    <div class="mnpv-head">
      <span class="mnpv-brand">{{ t('monitor.title') }}</span>
      <span class="mnpv-sub">{{ t('monitor.preview.subtitle') }}</span>
    </div>

    <div v-if="loading" class="mnpv-state">
      <span class="mnpv-state-text">{{ t('monitor.preview.loading') }}</span>
      <span class="mnpv-skeleton" aria-hidden="true"></span>
      <span class="mnpv-skeleton mnpv-skeleton-short" aria-hidden="true"></span>
    </div>

    <div v-else-if="failed || !summary" class="mnpv-state">
      <span class="mnpv-state-text">{{ t('monitor.preview.empty') }}</span>
      <span class="mnpv-hint">{{ t('monitor.preview.emptyHint') }}</span>
    </div>

    <div v-else-if="!hasData" class="mnpv-state">
      <span class="mnpv-state-text">{{ t('monitor.preview.noPlugins') }}</span>
    </div>

    <div v-else class="mnpv-grid">
      <div class="mnpv-stat">
        <span class="mnpv-value">{{ formatNumber(summary.pluginCount) }}</span>
        <span class="mnpv-label">{{ t('monitor.preview.plugins') }}</span>
      </div>
      <div class="mnpv-stat">
        <span class="mnpv-value">{{ formatNumber(summary.callsTotal) }}</span>
        <span class="mnpv-label">{{ t('monitor.preview.calls') }}</span>
      </div>
      <div class="mnpv-stat">
        <span class="mnpv-value">{{ formatNumber(summary.callsInFlight) }}</span>
        <span class="mnpv-label">{{ t('monitor.preview.inFlight') }}</span>
      </div>
      <div class="mnpv-stat">
        <span class="mnpv-value" :class="{ 'is-danger': summary.trapsTotal > 0 }">
          {{ formatNumber(summary.trapsTotal) }}
        </span>
        <span class="mnpv-label">{{ t('monitor.preview.traps') }}</span>
      </div>
      <div class="mnpv-stat mnpv-stat-wide">
        <span class="mnpv-value">{{ formatBytes(summary.memoryPeakBytes) }}</span>
        <span class="mnpv-label">{{ t('monitor.preview.memory') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 预览面是装饰层：token-bound、双主题自动跟随；不写 :root 覆盖 */
.mnpv {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  color: var(--text-primary);
  font-family: inherit;
  overflow: hidden;
}

.mnpv-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.mnpv-brand {
  font-size: calc(12px * var(--ui-scale));
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mnpv-sub {
  font-size: calc(9.5px * var(--ui-scale));
  color: var(--text-tertiary);
  white-space: nowrap;
}

.mnpv-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mnpv-state-text {
  font-size: calc(11px * var(--ui-scale));
  color: var(--text-secondary);
}

.mnpv-hint {
  font-size: calc(9.5px * var(--ui-scale));
  color: var(--text-tertiary);
}

.mnpv-skeleton {
  height: 8px;
  border-radius: 4px;
  background: var(--bg-hover);
}

.mnpv-skeleton-short {
  width: 56%;
}

.mnpv-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.mnpv-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.mnpv-stat-wide {
  grid-column: span 4;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.mnpv-value {
  font-variant-numeric: tabular-nums;
  font-size: calc(15px * var(--ui-scale));
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mnpv-value.is-danger {
  color: var(--color-danger-ink);
}

.mnpv-label {
  font-size: calc(9px * var(--ui-scale));
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
