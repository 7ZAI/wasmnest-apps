<script setup lang="ts">
/**
 * Monitor 主界面（移动端）：运行时仪表卡 + 指标摘要 + 可展开插件台账。
 *
 * 移动端没有宿主插件清单命令：标题只显示 plugin_id，不伪造应用名 / 运行态。
 * 指标失败保留旧数据（stale），空表只在「无错误且无数据」时出现。
 */
import { computed, inject, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { PluginMetricRow } from '../types'
import { useMonitor } from '../composables/useMonitor'
import { formatBytes, formatNumber, formatUnixTime, sumValues } from '../utils/format'
import PluginCardMobile from './PluginCardMobile.vue'
import MiniSignal from './MiniSignal.vue'

const NAMESPACE = 'com.wasmnest.monitor'
const { t, locale } = useI18n()
const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const context = inject<PluginContext>('pluginContext')!

const { rows, systems, summary, error, loading, lastUpdated, samples, refresh, start, stop } =
  useMonitor(context, { intervalMs: 1000, includeTask: false })

const localeTag = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
const initialLoading = computed(() => loading.value && lastUpdated.value === null)

const updatedText = computed(() =>
  lastUpdated.value === null
    ? tx('monitor.never')
    : tx('monitor.updated', { time: formatUnixTime(lastUpdated.value / 1000, localeTag.value) }),
)

const trapTotalOf = (row: PluginMetricRow): number => sumValues(row.metrics.trap_reasons)
const attentionRows = computed(() => rows.value.filter((row) => trapTotalOf(row) > 0))
const attentionCount = computed(() => attentionRows.value.length)

/** 有 Trap 的插件先出现：手机屏幕小，先看需要处理的那一个 */
const orderedRows = computed(() =>
  [...rows.value].sort((a, b) => {
    const delta = trapTotalOf(b) - trapTotalOf(a)
    if (delta !== 0) return delta
    return a.id.localeCompare(b.id)
  }),
)

const heroLead = computed(() => {
  if (error.value)
    return rows.value.length > 0 ? tx('monitor.hero.stale') : tx('monitor.error.title')
  if (initialLoading.value) return tx('monitor.loading')
  if (rows.value.length === 0) return tx('monitor.empty.title')
  if (attentionCount.value > 0) return tx('monitor.hero.attention', { count: attentionCount.value })
  return tx('monitor.hero.calm')
})

const heroProof = computed(() => {
  if (error.value && rows.value.length > 0) return tx('monitor.hero.proofStale')
  if (error.value) return tx('monitor.error.hint')
  if (initialLoading.value) return tx('monitor.hero.proofMobile')
  if (rows.value.length === 0) return tx('monitor.empty.hint')
  return tx('monitor.hero.proof', {
    plugins: formatNumber(summary.value.pluginCount),
    calls: formatNumber(summary.value.callsTotal),
    traps: formatNumber(summary.value.trapsTotal),
  })
})

const heroTone = computed(() => {
  if (error.value) return 'is-danger'
  if (initialLoading.value || rows.value.length === 0) return 'is-neutral'
  if (attentionCount.value > 0) return 'is-warning'
  return 'is-success'
})

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <div class="mnm" data-testid="mobile-monitor-view">
    <div class="mnm-scroll">
      <div class="mnm-inner">
        <!-- ==================== 运行时仪表 ==================== -->
        <section
          class="mnm-hero"
          :class="heroTone"
          aria-labelledby="mnm-lead"
          :data-testid="
            !initialLoading && rows.length === 0 && !error ? 'mobile-monitor-empty' : undefined
          "
        >
          <h1 id="mnm-lead" class="mnm-lead mnm-rise">{{ heroLead }}</h1>
          <p class="mnm-proof mnm-rise">{{ heroProof }}</p>

          <div class="mnm-meta mnm-rise">
            <span
              v-if="!error && lastUpdated !== null"
              class="mnm-live"
              data-testid="mobile-monitor-live"
            >
              <span class="mnm-live-dot" aria-hidden="true"></span>
              {{ tx('monitor.live') }}
            </span>
            <span
              v-if="error && rows.length > 0"
              class="mnm-stale"
              data-testid="mobile-monitor-stale"
            >
              <span class="mnm-state-dot is-warning" aria-hidden="true"></span>
              {{ tx('monitor.stale') }}
            </span>
            <span class="mnm-updated" data-testid="mobile-monitor-updated">{{ updatedText }}</span>
            <button
              type="button"
              class="mnm-refresh"
              :disabled="loading"
              data-testid="mobile-monitor-refresh"
              @click="refresh"
            >
              <svg
                class="mnm-refresh-icon"
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
              {{ loading ? tx('monitor.refreshing') : tx('monitor.refresh') }}
            </button>
          </div>

          <div v-if="error" class="mnm-error" role="alert" data-testid="mobile-monitor-error">
            <p class="mnm-error-message">{{ error }}</p>
            <button
              type="button"
              class="mnm-error-retry"
              data-testid="mobile-monitor-error-retry"
              @click="refresh"
            >
              {{ tx('monitor.error.retry') }}
            </button>
          </div>

          <div v-if="!initialLoading && rows.length > 0" class="mnm-signal mnm-rise" data-ui>
            <MiniSignal :samples="samples" :interval-ms="1000" />
          </div>
          <div v-else-if="initialLoading" class="mnm-signal-skeleton" aria-hidden="true">
            <span class="mnm-skeleton is-rate"></span>
            <span class="mnm-skeleton is-chart"></span>
          </div>
        </section>

        <!-- ==================== 摘要 ==================== -->
        <section
          v-if="!initialLoading && rows.length > 0"
          class="mnm-summary mnm-rise"
          data-ui
          aria-label="summary"
        >
          <div class="mnm-vital" data-testid="mobile-monitor-kpi-plugins">
            <span class="mnm-vital-value">{{ formatNumber(summary.pluginCount) }}</span>
            <span class="mnm-vital-label">{{ tx('monitor.kpi.plugins') }}</span>
          </div>
          <div class="mnm-vital" data-testid="mobile-monitor-kpi-calls">
            <span class="mnm-vital-value">{{ formatNumber(summary.callsTotal) }}</span>
            <span class="mnm-vital-label">{{ tx('monitor.kpi.calls') }}</span>
          </div>
          <div class="mnm-vital" data-testid="mobile-monitor-kpi-inflight">
            <span class="mnm-vital-value">{{ formatNumber(summary.callsInFlight) }}</span>
            <span class="mnm-vital-label">{{ tx('monitor.kpi.inFlight') }}</span>
            <span class="mnm-vital-note">{{ tx('monitor.kpi.inFlightHint') }}</span>
          </div>
          <div class="mnm-vital" data-testid="mobile-monitor-kpi-traps">
            <span class="mnm-vital-value" :class="{ 'is-danger': summary.trapsTotal > 0 }">
              {{ formatNumber(summary.trapsTotal) }}
            </span>
            <span class="mnm-vital-label">{{ tx('monitor.kpi.traps') }}</span>
          </div>
          <div class="mnm-vital is-wide" data-testid="mobile-monitor-kpi-memory">
            <span class="mnm-vital-value">{{ formatBytes(summary.memoryPeakBytes) }}</span>
            <span class="mnm-vital-label">{{ tx('monitor.kpi.memoryPeak') }}</span>
          </div>
        </section>

        <!-- ==================== 加载骨架 ==================== -->
        <div
          v-if="initialLoading"
          class="mnm-loading"
          data-testid="mobile-monitor-loading"
          aria-busy="true"
        >
          <div class="mnm-skeleton is-summary" aria-hidden="true"></div>
          <div class="mnm-skeleton is-panel" aria-hidden="true"></div>
          <p class="mnm-visually-hidden">{{ tx('monitor.loading') }}</p>
        </div>

        <!-- ==================== 插件台账 ==================== -->
        <template v-if="!initialLoading && rows.length > 0">
          <section class="mnm-plugins">
            <header class="mnm-section-head">
              <h2 class="mnm-section-title">{{ tx('monitor.ledger.title') }}</h2>
              <p class="mnm-section-hint">{{ tx('monitor.ledger.hint') }}</p>
              <p class="mnm-section-note">{{ tx('monitor.hero.proofMobile') }}</p>
            </header>
            <div class="mnm-plugin-panel" data-testid="mobile-monitor-plugin-list" data-ui>
              <PluginCardMobile
                v-for="(row, index) in orderedRows"
                :key="row.id"
                :row="row"
                :self-id="context.id"
                :row-index="index"
              />
            </div>
          </section>

          <section
            v-if="systems.length > 0"
            class="mnm-host"
            data-testid="mobile-monitor-system-list"
            data-ui
          >
            <header class="mnm-section-head">
              <h2 class="mnm-section-title">{{ tx('monitor.section.host') }}</h2>
            </header>
            <div class="mnm-host-panel">
              <section v-for="section in systems" :key="section.id" class="mnm-host-section">
                <h3 class="mnm-host-title">{{ section.id }}</h3>
                <dl class="mnm-kv">
                  <div v-for="[key, value] in Object.entries(section.data)" :key="key">
                    <dt>{{ key }}</dt>
                    <dd>{{ typeof value === 'number' ? formatNumber(value) : String(value) }}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </section>
        </template>

        <!-- ==================== 收束 ==================== -->
        <footer class="mnm-footer">
          <p class="mnm-footer-brand">
            WasmNest <span>{{ tx('monitor.title') }}</span>
          </p>
          <p class="mnm-footer-note">{{ tx('monitor.signal.note') }}</p>
          <p class="mnm-footer-note">{{ tx('monitor.footer.source') }}</p>
          <p class="mnm-footer-note">{{ tx('monitor.footer.session') }}</p>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mnm {
  --mnm-ink: var(--mobile-text-primary);
  --mnm-ink-2: color-mix(in srgb, var(--mobile-text-primary) 78%, var(--mobile-bg-primary));
  --mnm-ink-3: color-mix(in srgb, var(--mobile-text-primary) 66%, var(--mobile-bg-primary));
  --mnm-band: var(--mobile-text-primary);
  --mnm-band-ink: var(--mobile-bg-primary);
  --mnm-band-muted: color-mix(in srgb, var(--mobile-bg-primary) 72%, var(--mobile-text-primary));
  --mnm-band-faint: color-mix(in srgb, var(--mobile-bg-primary) 44%, var(--mobile-text-primary));
  --mnm-band-surface: color-mix(in srgb, var(--mobile-bg-primary) 9%, var(--mobile-text-primary));
  --mnm-band-success: color-mix(in srgb, var(--mobile-success) 62%, var(--mobile-bg-primary));
  --mnm-band-warning: color-mix(in srgb, var(--mobile-warning) 62%, var(--mobile-bg-primary));
  --mnm-band-danger: color-mix(in srgb, var(--mobile-error) 62%, var(--mobile-bg-primary));
  --mnm-success-ink: color-mix(in srgb, var(--mobile-success) 72%, var(--mobile-text-primary));
  --mnm-warning-ink: color-mix(in srgb, var(--mobile-warning) 72%, var(--mobile-text-primary));
  --mnm-danger-ink: color-mix(in srgb, var(--mobile-error) 72%, var(--mobile-text-primary));
  --mnm-tone: var(--mnm-band-faint);
  height: 100%;
  min-height: 0;
  background: var(--mobile-bg-primary);
  color: var(--mnm-ink);
  font-size: 15px;
  line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
}

.mnm :focus-visible {
  outline: 2px solid var(--mnm-ink);
  outline-offset: 2px;
}

.mnm-hero :focus-visible {
  outline-color: var(--mnm-band-ink);
}

.mnm-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.mnm-inner {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 8px 12px calc(24px + env(safe-area-inset-bottom, 0px));
}

.mnm-inner > * {
  flex-shrink: 0;
}

/* ==================== 运行时仪表卡 ==================== */

.mnm-hero {
  background: var(--mnm-band);
  color: var(--mnm-band-ink);
  border-radius: 16px;
  padding: 16px;
}

.mnm-hero.is-success {
  --mnm-tone: var(--mnm-band-success);
}

.mnm-hero.is-warning {
  --mnm-tone: var(--mnm-band-warning);
}

.mnm-hero.is-danger {
  --mnm-tone: var(--mnm-band-danger);
}

.mnm-lead {
  margin: 0;
  font-size: clamp(30px, 8.5vw, 36px);
  font-weight: 600;
  line-height: 1.06;
  letter-spacing: -0.035em;
  text-wrap: balance;
  color: var(--mnm-band-ink);
}

.mnm-lead::before {
  content: '';
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 10px;
  border-radius: 50%;
  background: var(--mnm-tone);
  vertical-align: 0.32em;
}

.mnm-proof {
  margin: 10px 0 0;
  max-width: 38ch;
  font-size: 15px;
  line-height: 1.55;
  color: var(--mnm-band-muted);
}

.mnm-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-band-muted);
}

.mnm-live,
.mnm-stale {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--mnm-band-ink);
  white-space: nowrap;
}

.mnm-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mnm-band-success);
  animation: mnm-live-pulse 1.8s ease-in-out infinite;
}

.mnm-stale .mnm-state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mnm-band-warning);
}

.mnm-updated {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mnm-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  margin-left: auto;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--mnm-band-ink);
  color: var(--mnm-band);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.mnm-refresh:active:not(:disabled) {
  transform: scale(0.98);
}

.mnm-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.mnm-refresh-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.mnm-refresh-icon.is-spinning {
  animation: mnm-spin 900ms linear infinite;
}

.mnm-error {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--mobile-error) 22%, var(--mnm-band));
}

.mnm-error-message {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--mnm-band-ink);
  overflow-wrap: anywhere;
}

.mnm-error-retry {
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  background: var(--mnm-band-ink);
  color: var(--mnm-band);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.mnm-signal {
  margin-top: 16px;
}

.mnm-signal-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.mnm-signal-skeleton .is-rate {
  width: 110px;
  height: 24px;
  background: var(--mnm-band-surface);
}

.mnm-signal-skeleton .is-chart {
  width: 100%;
  height: 64px;
  background: var(--mnm-band-surface);
}

/* ==================== 摘要 ==================== */

.mnm-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 18px;
  margin-top: 10px;
  padding: 16px;
  border-radius: 14px;
  background: var(--mobile-bg-card);
}

.mnm-vital {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mnm-vital.is-wide {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mnm-vital-value {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.mnm-vital-value.is-danger {
  color: var(--mnm-danger-ink);
}

.mnm-vital-label {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-2);
}

.mnm-vital-note {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-3);
}

.mnm-vital.is-wide .mnm-vital-label {
  margin-top: 0;
}

/* ==================== 台账 ==================== */

.mnm-plugins {
  margin-top: 26px;
}

.mnm-section-head {
  padding: 0 2px 10px;
}

.mnm-section-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.03em;
  color: var(--mnm-ink);
}

.mnm-section-hint {
  margin: 6px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--mnm-ink-2);
}

.mnm-section-note {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--mnm-ink-2);
}

.mnm-plugin-panel {
  overflow: hidden;
  border-radius: 14px;
  background: var(--mobile-bg-card);
}

.mnm-host {
  margin-top: 26px;
}

.mnm-host-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  border-radius: 14px;
  background: var(--mobile-bg-card);
}

.mnm-host-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--mnm-ink);
}

.mnm-kv {
  display: grid;
  gap: 6px;
  margin: 0;
}

.mnm-kv > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mnm-kv dt {
  font-size: 13px;
  line-height: 1.45;
  color: var(--mnm-ink-2);
}

.mnm-kv dd {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
}

/* ==================== 加载 / 空态 / 收束 ==================== */

.mnm-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.mnm-skeleton {
  display: block;
  border-radius: 14px;
  background: var(--mobile-bg-card);
}

.mnm-skeleton.is-summary {
  height: 176px;
}

.mnm-skeleton.is-panel {
  height: 380px;
}

.mnm-footer {
  margin-top: auto;
  padding: 28px 2px 0;
}

.mnm-footer-brand {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--mnm-ink-2);
}

.mnm-footer-brand span {
  margin-left: 6px;
  font-weight: 400;
  color: var(--mnm-ink-3);
}

.mnm-footer-note {
  margin: 3px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--mnm-ink-2);
}

.mnm-visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mnm-rise {
  animation: mnm-rise 560ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.mnm-lead.mnm-rise {
  animation-delay: 30ms;
}

.mnm-proof.mnm-rise {
  animation-delay: 100ms;
}

.mnm-meta.mnm-rise {
  animation-delay: 160ms;
}

.mnm-signal.mnm-rise {
  animation-delay: 190ms;
}

.mnm-summary.mnm-rise {
  animation-delay: 120ms;
}

@keyframes mnm-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes mnm-live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.32;
  }
}

@keyframes mnm-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mnm-rise,
  .mnm-live-dot,
  .mnm-refresh-icon.is-spinning {
    animation: none !important;
  }

  .mnm-refresh {
    transition: none !important;
  }
}
</style>
