<script setup lang="ts">
/**
 * Monitor 主界面（移动端）：实时指标看板
 *
 * 取数在 `useMonitor`（1s 轮询 + 卸载清理）；移动端没有宿主插件清单命令，
 * 因此只展示 plugin_id + 指标，不伪造应用名 / 运行态。`task` 系统段按端裁剪。
 * 失败语义：指标不可读时显示明确错误与重试，不用空表冒充正常；有旧数据时
 * 保留并标记「已过期」。
 */
import { computed, inject, onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useMonitor } from '../composables/useMonitor'
import { formatBytes, formatNumber, formatUnixTime } from '../utils/format'
import PluginCardMobile from './PluginCardMobile.vue'

const NAMESPACE = 'com.wasmnest.monitor'
const { t, locale } = useI18n()

const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const context = inject<PluginContext>('pluginContext')!
const safeArea = inject<Ref<{ top: number; bottom: number; navigationBar: number }> | undefined>(
  'safeArea',
  undefined,
)

const { rows, systems, summary, error, loading, lastUpdated, refresh, start, stop } = useMonitor(
  context,
  { intervalMs: 1000, includeTask: false },
)

const localeTag = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
const headerStyle = computed(() => ({
  paddingTop: `calc(${safeArea?.value?.top ?? 0}px + 8px)`,
}))

const updatedText = computed(() =>
  lastUpdated.value === null
    ? tx('monitor.never')
    : tx('monitor.updated', { time: formatUnixTime(lastUpdated.value / 1000, localeTag.value) }),
)

const initialLoading = computed(() => loading.value && lastUpdated.value === null)

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col bg-[var(--mobile-bg-primary)] text-[var(--mobile-text-primary)]"
    data-testid="mobile-monitor-view"
  >
    <!-- ==================== 页头 ==================== -->
    <header
      class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--mobile-border)] bg-[var(--mobile-bg-secondary)] px-4 pb-2"
      :style="headerStyle"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h1 class="text-[var(--font-size-lg)] font-semibold truncate">
            {{ tx('monitor.title') }}
          </h1>
          <span
            class="flex flex-shrink-0 items-center gap-1 rounded-[var(--radius-tag)] bg-[var(--mobile-success-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-success)]"
          >
            <span
              class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--mobile-success)] motion-safe:animate-pulse"
              aria-hidden="true"
            ></span>
            {{ tx('monitor.live') }}
          </span>
        </div>
        <div
          class="mt-0.5 font-mono text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate"
        >
          {{ updatedText }} · {{ tx('monitor.interval', { seconds: 1 }) }}
        </div>
      </div>

      <button
        type="button"
        class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--radius-button)] text-[var(--mobile-text-secondary)] transition-colors active:bg-[var(--mobile-bg-elevated)] disabled:opacity-50"
        :disabled="initialLoading"
        :aria-label="initialLoading ? tx('monitor.refreshing') : tx('monitor.refresh')"
        data-testid="mobile-monitor-refresh"
        @click="refresh"
      >
        <svg
          class="h-5 w-5"
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
      </button>
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto px-3 py-3">
      <div class="space-y-3 pb-[calc(var(--safe-area-bottom,0px)+16px)]">
        <!-- ==================== 错误（fail-visible） ==================== -->
        <div
          v-if="error"
          class="rounded-[var(--radius-card)] border border-[var(--mobile-error)] bg-[var(--mobile-error-muted)] p-3"
          role="alert"
          data-testid="mobile-monitor-error"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div
                class="text-[var(--font-size-base)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ tx('monitor.error.title') }}
              </div>
              <p
                class="mt-1 break-words font-mono text-[var(--font-size-xs)] text-[var(--mobile-error)]"
              >
                {{ error }}
              </p>
              <p class="mt-1 text-[var(--font-size-xs)] text-[var(--mobile-text-secondary)]">
                {{ tx('monitor.error.hint') }}
              </p>
            </div>
            <button
              type="button"
              class="flex min-h-[44px] flex-shrink-0 items-center rounded-[var(--radius-button)] border border-[var(--mobile-border)] px-3 text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)] transition-colors active:bg-[var(--mobile-bg-elevated)]"
              data-testid="mobile-monitor-error-retry"
              @click="refresh"
            >
              {{ tx('monitor.error.retry') }}
            </button>
          </div>
        </div>

        <div
          v-if="error && rows.length > 0"
          class="rounded-[var(--radius-tag)] bg-[var(--mobile-warning-muted)] px-2 py-1 text-[var(--font-size-xs)] text-[var(--mobile-warning)]"
          data-testid="mobile-monitor-stale"
        >
          {{ tx('monitor.stale') }}
        </div>

        <!-- ==================== 首屏骨架 ==================== -->
        <div
          v-if="initialLoading"
          class="space-y-2"
          data-testid="mobile-monitor-loading"
          aria-busy="true"
        >
          <div class="text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)]">
            {{ tx('monitor.loading') }}
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="i in 4"
              :key="i"
              class="h-16 rounded-[var(--radius-card)] bg-[var(--mobile-bg-card)] motion-safe:animate-pulse"
            ></div>
          </div>
          <div
            class="h-40 rounded-[var(--radius-card)] bg-[var(--mobile-bg-card)] motion-safe:animate-pulse"
          ></div>
        </div>

        <template v-else-if="rows.length > 0">
          <!-- ==================== KPI ==================== -->
          <section class="grid grid-cols-2 gap-2" aria-label="summary">
            <div
              class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] px-3 py-2"
              data-testid="mobile-monitor-kpi-plugins"
            >
              <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
                {{ tx('monitor.kpi.plugins') }}
              </div>
              <div
                class="mt-0.5 font-mono text-[var(--font-size-lg)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ formatNumber(summary.pluginCount) }}
              </div>
            </div>
            <div
              class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] px-3 py-2"
              data-testid="mobile-monitor-kpi-calls"
            >
              <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
                {{ tx('monitor.kpi.calls') }}
              </div>
              <div
                class="mt-0.5 font-mono text-[var(--font-size-lg)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ formatNumber(summary.callsTotal) }}
              </div>
            </div>
            <div
              class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] px-3 py-2"
              data-testid="mobile-monitor-kpi-inflight"
            >
              <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
                {{ tx('monitor.kpi.inFlight') }}
              </div>
              <div
                class="mt-0.5 font-mono text-[var(--font-size-lg)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ formatNumber(summary.callsInFlight) }}
              </div>
            </div>
            <div
              class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] px-3 py-2"
              data-testid="mobile-monitor-kpi-traps"
            >
              <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
                {{ tx('monitor.kpi.traps') }}
              </div>
              <div
                class="mt-0.5 font-mono text-[var(--font-size-lg)] font-semibold"
                :class="
                  summary.trapsTotal > 0
                    ? 'text-[var(--mobile-error)]'
                    : 'text-[var(--mobile-text-primary)]'
                "
              >
                {{ formatNumber(summary.trapsTotal) }}
              </div>
            </div>
            <div
              class="col-span-2 flex items-baseline justify-between rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] px-3 py-2"
              data-testid="mobile-monitor-kpi-memory"
            >
              <span class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">{{
                tx('monitor.kpi.memoryPeak')
              }}</span>
              <span
                class="font-mono text-[var(--font-size-lg)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ formatBytes(summary.memoryPeakBytes) }}
              </span>
            </div>
          </section>

          <!-- ==================== 插件卡 ==================== -->
          <section class="space-y-2" data-testid="mobile-monitor-plugin-list">
            <h2
              class="text-[var(--font-size-sm)] font-semibold text-[var(--mobile-text-secondary)]"
            >
              {{ tx('monitor.section.plugins') }}
            </h2>
            <PluginCardMobile v-for="row in rows" :key="row.id" :row="row" :self-id="context.id" />
          </section>

          <!-- ==================== 其他宿主维度（task 已按端裁剪） ==================== -->
          <section
            v-if="systems.length > 0"
            class="space-y-2"
            data-testid="mobile-monitor-system-list"
          >
            <h2
              class="text-[var(--font-size-sm)] font-semibold text-[var(--mobile-text-secondary)]"
            >
              {{ tx('monitor.section.host') }}
            </h2>
            <div
              v-for="section in systems"
              :key="section.id"
              class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] p-3"
            >
              <div
                class="text-[var(--font-size-base)] font-semibold text-[var(--mobile-text-primary)]"
              >
                {{ section.id }}
              </div>
              <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[var(--font-size-xs)]">
                <div
                  v-for="[key, value] in Object.entries(section.data)"
                  :key="key"
                  class="flex items-center justify-between gap-2 min-w-0"
                >
                  <span class="font-mono text-[var(--mobile-text-muted)] truncate">{{ key }}</span>
                  <span class="font-mono text-[var(--mobile-text-secondary)] flex-shrink-0">
                    {{ typeof value === 'number' ? formatNumber(value) : String(value) }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- ==================== 诚实空态（错误态不叠加空表） ==================== -->
        <div
          v-else-if="!error"
          class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] p-5 text-center"
          data-testid="mobile-monitor-empty"
        >
          <div class="text-[var(--font-size-base)] font-semibold text-[var(--mobile-text-primary)]">
            {{ tx('monitor.empty.title') }}
          </div>
          <p class="mt-1 text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)]">
            {{ tx('monitor.empty.hint') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
