<script setup lang="ts">
/**
 * Monitor 主界面（桌面）：运行时仪表 + 插件台账 + 选中插件详情。
 *
 * 取数在 `useMonitor`（1s 轮询 + 本次打开的采样序列）；失败语义：
 * 指标不可读时显示明确错误与重试，有旧数据时保留并标记「已过期」，
 * 不用空表冒充「没有插件」。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { MonitorPanelHandle } from '../entry'
import type { MonitorPanelRegistration, PluginRow } from '../types'
import { useMonitor } from '../composables/useMonitor'
import {
  formatBytes,
  formatNumber,
  formatRatio,
  formatUnixTime,
  describeError,
  isServiceKind,
  roleI18nKey,
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
  panels,
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
const serviceCount = computed(() => rows.value.filter((row) => isServiceKind(row.kind)).length)
const appCount = computed(() => rows.value.filter((row) => row.kind === 'business-app').length)
const roleSummaryVisible = computed(() => appCount.value + serviceCount.value > 0)
const unavailableCount = computed(() => rows.value.filter((row) => !row.metricsAvailable).length)

/** 台账过滤：全部 / 服务（L1+L2）/ 应用（L3）。只影响展示，取数始终是全量快照。 */
type LedgerFilter = 'all' | 'services' | 'apps'
const ledgerFilter = ref<LedgerFilter>('all')
const filteredRows = computed(() => {
  if (ledgerFilter.value === 'services') return rows.value.filter((row) => isServiceKind(row.kind))
  if (ledgerFilter.value === 'apps') return rows.value.filter((row) => !isServiceKind(row.kind))
  return rows.value
})
const filterOptions = computed<Array<{ id: LedgerFilter; label: string; count: number }>>(() => [
  { id: 'all', label: t('monitor.filter.all'), count: rows.value.length },
  { id: 'services', label: t('monitor.filter.services'), count: serviceCount.value },
  { id: 'apps', label: t('monitor.filter.apps'), count: appCount.value },
])

function serviceRoleText(row: PluginRow): string {
  const key = isServiceKind(row.kind) ? roleI18nKey(row.kind) : null
  return key ? t(key) : ''
}

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
  () => filteredRows.value,
  (next) => {
    if (!selectedId.value || !next.some((row) => row.id === selectedId.value)) {
      selectedId.value = next[0]?.id ?? null
    }
  },
  { immediate: true },
)
const selectedRow = computed(
  () => filteredRows.value.find((row) => row.id === selectedId.value) ?? null,
)

// ==================== 自定义监控面板（manifest 注册 + 宿主中介装载） ====================
const panelRoot = ref<HTMLElement | null>(null)
const activePanelKey = ref<string | null>(null)
const panelError = ref<string | null>(null)
let panelHandle: MonitorPanelHandle | null = null

/**
 * 装载代次：连续点两个页签会有并发装载，旧代次的结果必须丢弃——否则晚到的
 * 旧句柄会覆盖新句柄（前一个实例再也卸不掉）。与 `AppMountSlot` 的 loadSeq 同法。
 */
let panelSeq = 0

const activePanel = computed<MonitorPanelRegistration | null>(() => {
  if (!activePanelKey.value) return null
  return panels.value.find((panel) => panelKey(panel) === activePanelKey.value) ?? null
})

function panelKey(panel: MonitorPanelRegistration): string {
  return `${panel.appId}/${panel.id}`
}

async function unmountPanel(): Promise<void> {
  if (!panelHandle) return
  const handle = panelHandle
  panelHandle = null
  try {
    await handle.unmount()
  } catch (e) {
    console.error('[Monitor] panel unmount failed', e)
  }
}

async function mountPanel(panel: MonitorPanelRegistration): Promise<void> {
  const seq = ++panelSeq
  await unmountPanel()
  if (seq !== panelSeq) return
  activePanelKey.value = panelKey(panel)
  panelError.value = null
  await nextTick()
  if (seq !== panelSeq || !panelRoot.value) return
  if (!context.mountMonitorPanel) {
    panelError.value = t('monitor.panels.unsupported')
    return
  }
  try {
    const handle = await context.mountMonitorPanel(panelRoot.value, panel.appId, panel.id)
    if (seq !== panelSeq) {
      // 晚到的旧实例：自己卸掉，不写回 panelHandle（否则泄漏 / 覆盖新实例）
      try {
        await handle.unmount()
      } catch (e) {
        console.error('[Monitor] stale panel unmount failed', e)
      }
      return
    }
    panelHandle = handle
  } catch (e) {
    if (seq === panelSeq) panelError.value = describeError(e)
  }
}

watch(
  panels,
  (list) => {
    if (list.length === 0) {
      void unmountPanel()
      activePanelKey.value = null
      return
    }
    const current = activePanelKey.value
    if (!current || !list.some((panel) => panelKey(panel) === current)) {
      void mountPanel(list[0])
    }
  },
  { immediate: true },
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
onBeforeUnmount(() => {
  stop()
  // 先让在途装载作废（晚到结果会自卸），再卸已挂载实例
  panelSeq += 1
  void unmountPanel()
})
</script>

<template>
  <div class="mn-view mn-page" data-testid="monitor-view">
    <!-- ==================== 页头（身份 / 标题 / 只读说明） ==================== -->
    <!-- 标题原先只在页脚出现：滚动到底才知道自己在哪一页。页头承载身份与只读
         口径，页脚只留数据来源 / 采样口径等脚注。 -->
    <header class="mn-topbar">
      <div class="mn-wrap mn-topbar-inner">
        <div class="mn-topbar-id">
          <span class="mn-brand">WasmNest</span>
          <span class="mn-brand-divider" aria-hidden="true"></span>
          <h1 class="mn-page-title">{{ t('monitor.title') }}</h1>
        </div>
        <p class="mn-page-sub">{{ t('monitor.subtitle') }}</p>
      </div>
    </header>

    <!-- ==================== 运行时仪表 ==================== -->
    <section
      class="mn-hero"
      :class="heroTone"
      aria-labelledby="monitor-lead"
      :data-testid="!initialLoading && rows.length === 0 && !error ? 'monitor-empty' : undefined"
    >
      <div class="mn-wrap mn-hero-inner">
        <div class="mn-hero-head">
          <h2 id="monitor-lead" class="mn-hero-title mn-rise">{{ heroLead }}</h2>

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
            <span
              v-if="unavailableCount > 0"
              class="mn-vital-note is-warning"
              data-testid="monitor-kpi-unavailable"
            >
              {{ t('monitor.kpi.pluginsUnavailable', { n: unavailableCount }) }}
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
          <p v-if="roleSummaryVisible" class="mn-role-summary" data-testid="monitor-role-summary">
            {{ t('monitor.ledger.roleSummary', { apps: appCount, services: serviceCount }) }}
          </p>
          <div class="mn-filter" role="group" :aria-label="t('monitor.filter.aria')" data-ui>
            <button
              v-for="option in filterOptions"
              :key="option.id"
              type="button"
              class="mn-filter-btn"
              :class="{ 'is-active': ledgerFilter === option.id }"
              :aria-pressed="ledgerFilter === option.id"
              :data-testid="`monitor-filter-${option.id}`"
              @click="ledgerFilter = option.id"
            >
              {{ option.label }} <span class="mn-filter-count">{{ option.count }}</span>
            </button>
          </div>
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
            v-for="(row, index) in filteredRows"
            :key="row.id"
            type="button"
            class="mn-ledger-row"
            :class="{ 'is-selected': row.id === selectedId }"
            :style="{ '--row-index': index }"
            :data-testid="`monitor-plugin-${row.id}`"
            :data-plugin-id="row.id"
            :data-state="row.state"
            :data-metrics-available="row.metricsAvailable"
            :aria-current="row.id === selectedId ? 'true' : undefined"
            aria-controls="monitor-inspector"
            @click="selectedId = row.id"
          >
            <div class="mn-ledger-top">
              <span class="mn-state-dot" :class="`is-${row.state}`" aria-hidden="true"></span>
              <span class="mn-ledger-name">{{ row.name }}</span>
              <span v-if="row.version" class="mn-ledger-version">{{ row.version }}</span>
              <span
                v-if="serviceRoleText(row)"
                class="mn-role"
                :data-testid="`monitor-role-${row.id}`"
                >{{ serviceRoleText(row) }}</span
              >
              <span v-if="row.id === context.id" class="mn-tag">{{ t('monitor.self') }}</span>
              <span class="mn-ledger-state" :data-testid="`monitor-state-${row.id}`">
                {{ t(`monitor.state.${row.state}`) }}
              </span>
            </div>

            <div class="mn-ledger-id">{{ row.id }}</div>

            <div v-if="row.metricsAvailable" class="mn-ledger-meta">
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
            <div v-else class="mn-ledger-meta">
              <span class="mn-ledger-unavailable">
                {{ t('monitor.ledger.metricsUnavailable') }}
              </span>
            </div>

            <div v-if="row.metricsAvailable" class="mn-waterline is-compact" aria-hidden="true">
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

    <!-- ==================== 自定义监控面板（manifest 注册 + 宿主中介装载） ==================== -->
    <section v-if="!initialLoading" class="mn-wrap mn-panels-section" data-testid="monitor-panels">
      <header class="mn-section-head mn-rise">
        <div>
          <h2 class="mn-section-title">{{ t('monitor.panels.title') }}</h2>
          <p class="mn-section-hint">{{ t('monitor.panels.hint') }}</p>
        </div>
      </header>
      <div v-if="panels.length > 0" class="mn-panel-tabs" role="tablist" data-ui>
        <button
          v-for="panel in panels"
          :key="panelKey(panel)"
          type="button"
          class="mn-panel-tab"
          :class="{ 'is-active': panelKey(panel) === activePanelKey }"
          role="tab"
          :aria-selected="panelKey(panel) === activePanelKey"
          :data-testid="`monitor-panel-tab-${panel.appId}-${panel.id}`"
          @click="mountPanel(panel)"
        >
          {{ panel.title }}
        </button>
      </div>
      <div v-if="activePanel" class="mn-panel-host" data-ui>
        <p v-if="panelError" class="mn-panel-error" role="alert" data-testid="monitor-panel-error">
          {{ t('monitor.panels.failed', { title: activePanel.title }) }}
          <span class="mn-panel-error-detail">{{ panelError }}</span>
          <button type="button" class="mn-panel-retry" @click="mountPanel(activePanel)">
            {{ t('monitor.panels.retry') }}
          </button>
        </p>
        <div
          v-show="!panelError"
          ref="panelRoot"
          class="mn-panel-root"
          :data-panel-app="activePanel.appId"
          :data-panel-id="activePanel.id"
        ></div>
      </div>
      <p v-else class="mn-panel-empty" data-testid="monitor-panels-empty">
        {{ t('monitor.panels.empty') }}
      </p>
    </section>

    <!-- ==================== 收束（脚注：数据来源 / 采样口径 / 会话寿命） ==================== -->
    <footer class="mn-wrap mn-footer">
      <p class="mn-footer-note">{{ t('monitor.footer.source') }}</p>
      <p class="mn-footer-note">{{ t('monitor.signal.note') }}</p>
      <p class="mn-footer-note">{{ t('monitor.footer.session') }}</p>
    </footer>
  </div>
</template>
