<script setup lang="ts">
/**
 * Monitor 主界面（桌面）：实时指标看板
 *
 * 取数在 `useMonitor`（1s 轮询 + 卸载清理）；本组件只负责布局与状态呈现。
 * 失败语义：指标不可读时显示明确错误与重试，不用空表冒充「没有插件」；
 * 有旧数据时保留并标记「已过期」。
 */
import { computed, inject, onBeforeUnmount, onMounted } from 'vue'
import type { MonitorAppContext } from '../appContext'
import { useMonitor } from '../composables/useMonitor'
import { formatBytes, formatNumber, formatUnixTime } from '../utils/format'
import i18n from '../i18n'
import PluginCard from './PluginCard.vue'
import SystemPanel from './SystemPanel.vue'

const context = inject<MonitorAppContext>('pluginContext')!

const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const {
  rows,
  systems,
  summary,
  error,
  hostInfoWarning,
  loading,
  lastUpdated,
  refresh,
  start,
  stop,
} = useMonitor(context, { intervalMs: 1000 })

const localeTag = computed(() => (i18n.global.locale.value === 'en' ? 'en-US' : 'zh-CN'))

const updatedText = computed(() =>
  lastUpdated.value === null
    ? t('monitor.never')
    : t('monitor.updated', { time: formatUnixTime(lastUpdated.value / 1000, localeTag.value) }),
)

const runningCount = computed(() => rows.value.filter((row) => row.state === 'running').length)

/** 宿主清单不可用时状态全是 unknown：运行中数量显示 `—`，不把「查不到」说成 0 */
const runningText = computed(() =>
  rows.value.some((row) => row.state !== 'unknown') ? String(runningCount.value) : '—',
)

const initialLoading = computed(() => loading.value && lastUpdated.value === null)

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div
    class="flex flex-col h-full min-h-0 bg-[var(--bg-page)] text-[var(--text-primary)]"
    data-testid="monitor-view"
  >
    <!-- ==================== 页头 ==================== -->
    <header
      class="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 h-14 border-b border-[var(--border)] bg-[var(--bg-page)] flex-shrink-0"
    >
      <div class="flex items-center gap-3 min-w-0">
        <h1 class="text-[calc(14px*var(--ui-scale))] font-semibold tracking-tight truncate">
          {{ t('monitor.title') }}
        </h1>
        <span class="mn-chip mn-chip-success" data-testid="monitor-live">
          <span class="mn-state-dot is-running mn-live-dot" aria-hidden="true"></span>
          {{ t('monitor.live') }}
        </span>
        <span
          class="text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)] hidden sm:inline"
        >
          {{ t('monitor.subtitle') }} · {{ t('monitor.interval', { seconds: 1 }) }}
        </span>
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <span
          class="mn-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)] tabular-nums"
          data-testid="monitor-updated"
        >
          {{ updatedText }}
        </span>
        <button
          type="button"
          class="mn-btn"
          :disabled="initialLoading"
          data-testid="monitor-refresh"
          @click="refresh"
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6" />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2"
            />
          </svg>
          {{ initialLoading ? t('monitor.refreshing') : t('monitor.refresh') }}
        </button>
      </div>
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-[1240px] mx-auto px-5 py-5 space-y-5">
        <!-- ==================== 可恢复的错误（fail-visible） ==================== -->
        <div
          v-if="error"
          class="mn-card p-4 border-l-[3px]"
          :style="{ borderLeftColor: 'var(--color-danger)' }"
          role="alert"
          data-testid="monitor-error"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 min-w-0">
              <svg
                class="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-danger-ink)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                />
              </svg>
              <div class="min-w-0">
                <div
                  class="text-[calc(12.5px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
                >
                  {{ t('monitor.error.title') }}
                </div>
                <p
                  class="mt-1 mn-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--color-danger-ink)] break-words"
                >
                  {{ error }}
                </p>
                <p class="mt-1 text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]">
                  {{ t('monitor.error.hint') }}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="mn-btn flex-shrink-0"
              data-testid="monitor-error-retry"
              @click="refresh"
            >
              {{ t('monitor.error.retry') }}
            </button>
          </div>
        </div>

        <!-- 有旧数据时的过期标记：继续展示，但明确说明不是当前值 -->
        <div
          v-if="error && rows.length > 0"
          class="mn-chip mn-chip-warning"
          data-testid="monitor-stale"
        >
          {{ t('monitor.stale') }}
        </div>

        <!-- 宿主清单软失败：指标仍可用，只降级名称 / 状态 -->
        <div
          v-if="hostInfoWarning && !error"
          class="text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
          data-testid="monitor-host-warning"
        >
          {{ t('monitor.hostInfoUnavailable') }}
          <span class="mn-mono">· {{ hostInfoWarning }}</span>
        </div>

        <!-- ==================== 首屏骨架 ==================== -->
        <div v-if="initialLoading" class="space-y-3" data-testid="monitor-loading" aria-busy="true">
          <div class="mn-label">{{ t('monitor.loading') }}</div>
          <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <div v-for="i in 5" :key="i" class="mn-card p-4 h-[76px] motion-safe:animate-pulse">
              <div class="mn-skeleton h-2.5 w-16"></div>
            </div>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div v-for="i in 4" :key="i" class="mn-card p-4 h-[240px] motion-safe:animate-pulse">
              <div class="mn-skeleton h-3 w-32"></div>
            </div>
          </div>
        </div>

        <template v-else-if="rows.length > 0">
          <!-- ==================== KPI ==================== -->
          <section
            class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3"
            aria-label="summary"
          >
            <div class="mn-card px-4 py-3 min-w-0" data-testid="monitor-kpi-plugins">
              <div class="mn-label">{{ t('monitor.kpi.plugins') }}</div>
              <div class="mn-kpi-value mt-0.5">{{ formatNumber(summary.pluginCount) }}</div>
              <div class="mn-label mt-0.5">
                {{
                  t('monitor.kpi.pluginsValue', {
                    running: runningText,
                    total: summary.pluginCount,
                  })
                }}
              </div>
            </div>
            <div class="mn-card px-4 py-3 min-w-0" data-testid="monitor-kpi-calls">
              <div class="mn-label">{{ t('monitor.kpi.calls') }}</div>
              <div class="mn-kpi-value mt-0.5">{{ formatNumber(summary.callsTotal) }}</div>
            </div>
            <div class="mn-card px-4 py-3 min-w-0" data-testid="monitor-kpi-inflight">
              <div class="mn-label">{{ t('monitor.kpi.inFlight') }}</div>
              <div class="mn-kpi-value mt-0.5">{{ formatNumber(summary.callsInFlight) }}</div>
            </div>
            <div class="mn-card px-4 py-3 min-w-0" data-testid="monitor-kpi-traps">
              <div class="mn-label">{{ t('monitor.kpi.traps') }}</div>
              <div class="mn-kpi-value mt-0.5" :class="summary.trapsTotal > 0 ? 'is-danger' : ''">
                {{ formatNumber(summary.trapsTotal) }}
              </div>
            </div>
            <div class="mn-card px-4 py-3 min-w-0" data-testid="monitor-kpi-memory">
              <div class="mn-label">{{ t('monitor.kpi.memoryPeak') }}</div>
              <div class="mn-kpi-value mt-0.5">{{ formatBytes(summary.memoryPeakBytes) }}</div>
            </div>
          </section>

          <!-- ==================== 插件卡 ==================== -->
          <section>
            <h2 class="mn-section-title mb-2">{{ t('monitor.section.plugins') }}</h2>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="monitor-plugin-list">
              <PluginCard v-for="row in rows" :key="row.id" :row="row" :self-id="context.id" />
            </div>
          </section>

          <!-- ==================== 宿主维度 ==================== -->
          <section v-if="systems.length > 0" data-testid="monitor-system-list">
            <h2 class="mn-section-title mb-2">{{ t('monitor.section.host') }}</h2>
            <SystemPanel :sections="systems" />
          </section>
        </template>

        <!-- ==================== 诚实的空态（无错误、无数据；错误态不叠加空表） ==================== -->
        <div v-else-if="!error" class="mn-card p-6 text-center" data-testid="monitor-empty">
          <div class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
            {{ t('monitor.empty.title') }}
          </div>
          <p class="mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
            {{ t('monitor.empty.hint') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
