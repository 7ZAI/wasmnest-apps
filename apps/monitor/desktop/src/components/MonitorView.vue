<script setup lang="ts">
/**
 * Monitor 主界面（桌面）：运行时仪表 + 插件台账 + 选中插件详情。
 *
 * 取数在 `useMonitor`（1s 轮询 + 本次打开的采样序列）；失败语义：
 * 指标不可读时显示明确错误与重试，有旧数据时保留并标记「已过期」，
 * 不用空表冒充「没有插件」。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { PluginRow } from '../types'
import { useMonitor } from '../composables/useMonitor'
import {
  formatBytes,
  formatNumber,
  formatRatio,
  formatUnixTime,
  sumValues,
  usageRatio,
} from '../utils/format'
import i18n from '../i18n'
import PluginInspector from './PluginInspector.vue'
import RuntimeSignal from './RuntimeSignal.vue'
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
  samples,
  refresh,
  start,
  stop,
} = useMonitor(context, { intervalMs: 1000 })

const localeTag = computed(() => (i18n.global.locale.value === 'en' ? 'en-US' : 'zh-CN'))
const initialLoading = computed(() => loading.value && lastUpdated.value === null)

const updatedText = computed(() =>
  lastUpdated.value === null
    ? t('monitor.never')
    : t('monitor.updated', { time: formatUnixTime(lastUpdated.value / 1000, localeTag.value) }),
)

const runningCount = computed(() => rows.value.filter((row) => row.state === 'running').length)
const runningText = computed(() =>
  rows.value.some((row) => row.state !== 'unknown') ? String(runningCount.value) : '—',
)
const statesKnown = computed(() => rows.value.some((row) => row.state !== 'unknown'))

const attentionRows = computed(() =>
  rows.value.filter((row) => {
    if (row.state === 'degraded' || row.state === 'error' || row.state === 'approval') return true
    return sumValues(row.metrics.trap_reasons) > 0
  }),
)
const attentionCount = computed(() => attentionRows.value.length)

const heroLead = computed(() => {
  if (error.value) return rows.value.length > 0 ? t('monitor.hero.stale') : t('monitor.error.title')
  if (initialLoading.value) return t('monitor.loading')
  if (rows.value.length === 0) return t('monitor.empty.title')
  if (attentionCount.value > 0) return t('monitor.hero.attention', { count: attentionCount.value })
  if (!statesKnown.value) return t('monitor.hero.unknown')
  return t('monitor.hero.calm')
})

const heroProof = computed(() => {
  if (error.value && rows.value.length > 0) return t('monitor.hero.proofStale')
  if (error.value) return t('monitor.error.hint')
  if (initialLoading.value) return t('monitor.subtitle')
  if (rows.value.length === 0) return t('monitor.empty.hint')
  if (!statesKnown.value && hostInfoWarning.value) return t('monitor.hero.proofUnknown')
  return t('monitor.hero.proof', {
    plugins: formatNumber(summary.value.pluginCount),
    calls: formatNumber(summary.value.callsTotal),
    traps: formatNumber(summary.value.trapsTotal),
  })
})

const heroTone = computed(() => {
  if (error.value) return 'is-danger'
  if (initialLoading.value) return 'is-neutral'
  if (rows.value.length === 0) return 'is-neutral'
  if (attentionCount.value > 0) return 'is-warning'
  if (!statesKnown.value) return 'is-warning'
  return 'is-success'
})

const selectedId = ref<string | null>(null)
watch(
  () => rows.value.map((row) => row.id),
  (ids) => {
    if (!selectedId.value || !ids.includes(selectedId.value)) selectedId.value = ids[0] ?? null
  },
  { immediate: true },
)
const selectedRow = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? rows.value[0] ?? null,
)

function quotaMemoryOf(row: PluginRow): number | null {
  const raw = row.metrics.quota?.memory_bytes
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}
function memoryRatioOf(row: PluginRow): number | null {
  return usageRatio(row.metrics.memory_current_bytes, quotaMemoryOf(row))
}
function memoryScaleOf(row: PluginRow): number {
  const ratio = memoryRatioOf(row)
  if (ratio === null) return 0
  return Math.min(1, Math.max(0, ratio))
}
function memoryToneOf(row: PluginRow): 'ok' | 'warn' | 'danger' {
  const ratio = memoryRatioOf(row)
  if (ratio === null) return 'ok'
  if (ratio >= 0.95) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}
function trapTotalOf(row: PluginRow): number {
  return sumValues(row.metrics.trap_reasons)
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div class="mn-view mn-page" data-testid="monitor-view">
    <!-- ==================== 运行时仪表 ==================== -->
    <section
      class="mn-hero"
      :class="heroTone"
      aria-labelledby="monitor-lead"
      :data-testid="!initialLoading && rows.length === 0 && !error ? 'monitor-empty' : undefined"
    >
      <div class="mn-wrap mn-hero-inner">
        <div class="mn-hero-head">
          <h1 id="monitor-lead" class="mn-hero-title mn-rise">{{ heroLead }}</h1>

          <div class="mn-hero-actions">
            <span v-if="!error && lastUpdated !== null" class="mn-live" data-testid="monitor-live">
              <span class="mn-live-dot" aria-hidden="true"></span>
              {{ t('monitor.live') }}
            </span>
            <span v-if="error && rows.length > 0" class="mn-stale" data-testid="monitor-stale">
              <span class="mn-state-dot is-warning" aria-hidden="true"></span>
              {{ t('monitor.stale') }}
            </span>
            <span class="mn-updated" data-testid="monitor-updated">{{ updatedText }}</span>
            <button
              type="button"
              class="mn-refresh"
              :disabled="loading"
              data-testid="monitor-refresh"
              @click="refresh"
            >
              <svg
                class="mn-refresh-icon"
                :class="{ 'is-spinning': loading }"
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
              {{ loading ? t('monitor.refreshing') : t('monitor.refresh') }}
            </button>
          </div>
        </div>

        <p class="mn-proof mn-rise">{{ heroProof }}</p>

        <div v-if="error" class="mn-error" role="alert" data-testid="monitor-error">
          <p class="mn-error-message">{{ error }}</p>
          <button
            type="button"
            class="mn-error-retry"
            data-testid="monitor-error-retry"
            @click="refresh"
          >
            {{ t('monitor.error.retry') }}
          </button>
        </div>

        <div v-if="!initialLoading && rows.length > 0" class="mn-hero-cols mn-rise">
          <div class="mn-hero-signal" data-ui>
            <RuntimeSignal :samples="samples" :interval-ms="1000" />
          </div>
        </div>
        <div v-else-if="initialLoading" class="mn-hero-cols" aria-hidden="true">
          <div class="mn-signal-skeleton">
            <span class="mn-skeleton-block is-title"></span>
            <span class="mn-skeleton-block is-chart"></span>
          </div>
        </div>

        <div v-if="!initialLoading && rows.length > 0" class="mn-vitals mn-rise" data-ui>
          <div class="mn-vital" data-testid="monitor-kpi-plugins">
            <span class="mn-vital-value">{{ formatNumber(summary.pluginCount) }}</span>
            <span class="mn-vital-label">{{ t('monitor.kpi.plugins') }}</span>
            <span class="mn-vital-note">
              {{
                t('monitor.kpi.pluginsValue', { running: runningText, total: summary.pluginCount })
              }}
            </span>
          </div>
          <div class="mn-vital" data-testid="monitor-kpi-calls">
            <span class="mn-vital-value">{{ formatNumber(summary.callsTotal) }}</span>
            <span class="mn-vital-label">{{ t('monitor.kpi.calls') }}</span>
          </div>
          <div class="mn-vital" data-testid="monitor-kpi-inflight">
            <span class="mn-vital-value">{{ formatNumber(summary.callsInFlight) }}</span>
            <span class="mn-vital-label">{{ t('monitor.kpi.inFlight') }}</span>
            <span class="mn-vital-note">{{ t('monitor.kpi.inFlightHint') }}</span>
          </div>
          <div class="mn-vital" data-testid="monitor-kpi-traps">
            <span class="mn-vital-value" :class="{ 'is-danger': summary.trapsTotal > 0 }">
              {{ formatNumber(summary.trapsTotal) }}
            </span>
            <span class="mn-vital-label">{{ t('monitor.kpi.traps') }}</span>
          </div>
          <div class="mn-vital" data-testid="monitor-kpi-memory">
            <span class="mn-vital-value">{{ formatBytes(summary.memoryPeakBytes) }}</span>
            <span class="mn-vital-label">{{ t('monitor.kpi.memoryPeak') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 加载骨架 ==================== -->
    <div
      v-if="initialLoading"
      class="mn-wrap mn-loading"
      data-testid="monitor-loading"
      aria-busy="true"
    >
      <div class="mn-loading-grid" aria-hidden="true">
        <div class="mn-loading-list">
          <span v-for="i in 4" :key="i" class="mn-skeleton-block is-row"></span>
        </div>
        <span class="mn-skeleton-block is-panel"></span>
      </div>
      <p class="mn-visually-hidden">{{ t('monitor.loading') }}</p>
    </div>

    <!-- ==================== 插件台账 ==================== -->
    <section
      v-if="!initialLoading && rows.length > 0"
      class="mn-wrap mn-ledger-section"
      aria-labelledby="plugins-title"
    >
      <header class="mn-section-head mn-rise">
        <div>
          <h2 id="plugins-title" class="mn-section-title">{{ t('monitor.ledger.title') }}</h2>
          <p class="mn-section-hint">{{ t('monitor.ledger.hint') }}</p>
        </div>
        <p
          v-if="hostInfoWarning && !error"
          class="mn-host-warning"
          data-testid="monitor-host-warning"
        >
          {{ t('monitor.hostInfoUnavailable') }}
          <span class="mn-host-warning-detail">{{ hostInfoWarning }}</span>
        </p>
      </header>

      <div class="mn-ledger-layout">
        <div class="mn-ledger" data-testid="monitor-plugin-list" data-ui>
          <button
            v-for="(row, index) in rows"
            :key="row.id"
            type="button"
            class="mn-ledger-row"
            :class="{ 'is-selected': row.id === selectedId }"
            :style="{ '--row-index': index }"
            :data-testid="`monitor-plugin-${row.id}`"
            :data-plugin-id="row.id"
            :data-state="row.state"
            :aria-current="row.id === selectedId ? 'true' : undefined"
            aria-controls="monitor-inspector"
            @click="selectedId = row.id"
          >
            <div class="mn-ledger-top">
              <span class="mn-state-dot" :class="`is-${row.state}`" aria-hidden="true"></span>
              <span class="mn-ledger-name">{{ row.name }}</span>
              <span v-if="row.version" class="mn-ledger-version">{{ row.version }}</span>
              <span v-if="row.id === context.id" class="mn-tag">{{ t('monitor.self') }}</span>
              <span class="mn-ledger-state" :data-testid="`monitor-state-${row.id}`">
                {{ t(`monitor.state.${row.state}`) }}
              </span>
            </div>

            <div class="mn-ledger-id">{{ row.id }}</div>

            <div class="mn-ledger-meta">
              <span class="mn-ledger-mem">
                {{ formatBytes(row.metrics.memory_current_bytes) }}
                <span class="mn-muted">
                  / {{ quotaMemoryOf(row) === null ? '—' : formatBytes(quotaMemoryOf(row)) }}
                </span>
              </span>
              <span class="mn-muted">
                {{ memoryRatioOf(row) === null ? '—' : formatRatio(memoryRatioOf(row)) }}
              </span>
              <span class="mn-ledger-calls">
                {{ t('monitor.ledger.calls', { n: formatNumber(row.metrics.calls_total) }) }}
              </span>
              <span v-if="trapTotalOf(row) > 0" class="mn-ledger-alert">
                {{ formatNumber(trapTotalOf(row)) }} Trap
              </span>
            </div>

            <div class="mn-waterline is-compact" aria-hidden="true">
              <div
                v-if="memoryRatioOf(row) !== null"
                class="mn-waterline-fill"
                :class="`is-${memoryToneOf(row)}`"
                :style="{ transform: `scaleX(${memoryScaleOf(row)})` }"
              ></div>
            </div>
          </button>
        </div>

        <div id="monitor-inspector" class="mn-inspector-slot">
          <PluginInspector
            v-if="selectedRow"
            :key="selectedRow.id"
            :row="selectedRow"
            :self-id="context.id"
          />
        </div>

        <section
          v-if="systems.length > 0"
          class="mn-host-section"
          data-ui
          data-testid="monitor-system-list"
        >
          <header class="mn-section-head">
            <div>
              <h2 class="mn-section-title">{{ t('monitor.section.host') }}</h2>
              <p class="mn-section-hint">{{ t('monitor.host.hint') }}</p>
            </div>
          </header>
          <SystemPanel :sections="systems" />
        </section>
      </div>
    </section>

    <!-- ==================== 收束 ==================== -->
    <footer class="mn-wrap mn-footer">
      <div class="mn-footer-brand">
        <span>WasmNest</span>
        <span class="mn-footer-sub">{{ t('monitor.title') }}</span>
      </div>
      <div class="mn-footer-meta">
        <span>{{ t('monitor.footer.source') }}</span>
        <span>{{ t('monitor.signal.note') }}</span>
        <span>{{ t('monitor.footer.session') }}</span>
      </div>
    </footer>
  </div>
</template>
