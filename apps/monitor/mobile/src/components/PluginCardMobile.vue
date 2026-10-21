<script setup lang="ts">
/**
 * 移动端插件台账行：摘要常显（内存水位 / 调用 / Trap），完整指标收进原生 details。
 * 移动端没有宿主清单：标题显示 plugin_id 短形式，不伪造应用名 / 运行态。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginMetricRow } from '../types'
import {
  averageUs,
  formatBytes,
  formatDurationUs,
  formatNumber,
  formatRatio,
  formatUnixTime,
  latestLifecycle,
  nonZeroEntries,
  shortPluginId,
  sumValues,
  usageRatio,
} from '../utils/format'

const props = defineProps<{ row: PluginMetricRow; selfId?: string; rowIndex?: number }>()

const NAMESPACE = 'com.wasmnest.monitor'
const { t, locale } = useI18n()
const tx = (key: string, params?: Record<string, unknown>): string =>
  t(`${NAMESPACE}.${key}`, params ?? {})

const LIFECYCLE_KEYS = [
  'instantiate',
  'activate_ok',
  'activate_fail',
  'deactivate',
  'trap',
  'degraded',
] as const
const TRAP_KEYS = [
  'fuel_exhausted',
  'stack_overflow',
  'memory_out_of_bounds',
  'unreachable',
  'host_error',
  'other',
] as const
const BUCKET_KEYS = ['le1ms', 'le10ms', 'le100ms', 'le1s', 'le10s', 'gt10s'] as const
const BUCKET_COLORS = [
  'var(--mnm-success-ink)',
  'var(--mnm-success-ink)',
  'var(--color-info-ink)',
  'var(--mnm-warning-ink)',
  'var(--mnm-danger-ink)',
  'var(--mnm-danger-ink)',
] as const
const QUOTA_SPECS = [
  { key: 'fuel_per_call', label: 'monitor.metric.quotaFuel', unit: 'number' },
  { key: 'memory_bytes', label: 'monitor.metric.quotaMemory', unit: 'bytes' },
  { key: 'table_entries', label: 'monitor.metric.quotaTable', unit: 'number' },
  { key: 'instances', label: 'monitor.metric.quotaInstances', unit: 'number' },
  { key: 'memories', label: 'monitor.metric.quotaMemories', unit: 'number' },
  { key: 'tables', label: 'monitor.metric.quotaTables', unit: 'number' },
] as const

const metrics = computed(() => props.row.metrics)
const isSelf = computed(() => !!props.selfId && props.row.id === props.selfId)
/** 折叠时不渲染详情：WebKit 下隐藏的 details 内容仍可能被几何探测/读屏看到 */
const open = ref(false)
function onToggle(event: Event): void {
  open.value = (event.currentTarget as HTMLDetailsElement).open
}
const localeTag = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))

const trapEntries = computed(() => nonZeroEntries(metrics.value.trap_reasons, TRAP_KEYS))
const trapTotal = computed(() => sumValues(metrics.value.trap_reasons))
const trapText = computed(() =>
  trapEntries.value
    .map((trap) => `${trapLabel(trap.key)} · ${formatNumber(trap.value)}`)
    .join(' · '),
)

const quotaMemory = computed(() => quotaValue('memory_bytes'))
const memoryRatio = computed(() =>
  usageRatio(metrics.value.memory_current_bytes, quotaMemory.value),
)
const memoryScale = computed(() =>
  memoryRatio.value === null ? 0 : Math.min(1, Math.max(0, memoryRatio.value)),
)
const memoryTone = computed(() => {
  const ratio = memoryRatio.value
  if (ratio === null) return 'is-ok'
  if (ratio >= 0.95) return 'is-danger'
  if (ratio >= 0.8) return 'is-warn'
  return 'is-ok'
})

const avgCallUs = computed(() =>
  averageUs(metrics.value.call_duration_us_total, metrics.value.calls_total),
)
const latest = computed(() => latestLifecycle(metrics.value.lifecycle_last_unix))
const authz = computed(() => metrics.value.authz ?? {})
const bus = computed(() => metrics.value.bus ?? {})

const buckets = computed(() =>
  BUCKET_KEYS.map((key, index) => ({
    key,
    count: metrics.value.call_duration_buckets?.[index] ?? 0,
    color: BUCKET_COLORS[index],
  })),
)
const bucketTotal = computed(() => buckets.value.reduce((sum, bucket) => sum + bucket.count, 0))
const bucketSegments = computed(() =>
  buckets.value
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      ...bucket,
      percent: bucketTotal.value > 0 ? (bucket.count / bucketTotal.value) * 100 : 0,
    })),
)
const histogramLabel = computed(() =>
  bucketSegments.value
    .map((bucket) => `${tx(`monitor.bucket.${bucket.key}`)}: ${bucket.count}`)
    .join(', '),
)
const quotaEntries = computed(() =>
  QUOTA_SPECS.map((spec) => {
    const raw = quotaValue(spec.key)
    return {
      key: spec.key,
      label: tx(spec.label),
      value: raw === null ? '—' : spec.unit === 'bytes' ? formatBytes(raw) : formatNumber(raw),
    }
  }),
)
const growDeniedText = computed(() => {
  const parts: string[] = []
  if ((metrics.value.memory_grow_denied_total ?? 0) > 0) {
    parts.push(
      tx('monitor.metric.memoryDenied', {
        n: formatNumber(metrics.value.memory_grow_denied_total),
      }),
    )
  }
  if ((metrics.value.table_grow_denied_total ?? 0) > 0) {
    parts.push(
      tx('monitor.metric.tableDenied', { n: formatNumber(metrics.value.table_grow_denied_total) }),
    )
  }
  return parts.join(' · ')
})

function quotaValue(key: string): number | null {
  const raw = metrics.value.quota?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}
function lifecycleValue(key: string): number {
  return metrics.value.lifecycle?.[key] ?? 0
}
function lifecycleLabel(key: string): string {
  return (LIFECYCLE_KEYS as readonly string[]).includes(key) ? tx(`monitor.lifecycle.${key}`) : key
}
function trapLabel(key: string): string {
  return (TRAP_KEYS as readonly string[]).includes(key) ? tx(`monitor.trap.${key}`) : key
}
</script>

<template>
  <details
    class="mnm-plugin"
    :style="{ '--row-index': rowIndex ?? 0 }"
    :data-testid="`mobile-monitor-plugin-${row.id}`"
    :data-plugin-id="row.id"
    @toggle="onToggle"
  >
    <summary class="mnm-plugin-summary">
      <div class="mnm-plugin-top">
        <span class="mnm-plugin-name">{{ shortPluginId(row.id) }}</span>
        <span v-if="isSelf" class="mnm-tag">{{ tx('monitor.self') }}</span>
        <svg
          class="mnm-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </div>

      <div class="mnm-plugin-id">{{ row.id }}</div>

      <div class="mnm-plugin-meta">
        <span class="mnm-plugin-mem">
          {{ formatBytes(metrics.memory_current_bytes) }}
          <span class="mnm-muted"
            >/ {{ quotaMemory === null ? '—' : formatBytes(quotaMemory) }}</span
          >
        </span>
        <span class="mnm-muted">
          {{ memoryRatio === null ? '—' : formatRatio(memoryRatio) }}
        </span>
        <span>{{ tx('monitor.ledger.calls', { n: formatNumber(metrics.calls_total) }) }}</span>
      </div>

      <p v-if="trapTotal > 0" class="mnm-plugin-traps">{{ trapText }}</p>

      <div class="mnm-plugin-track" aria-hidden="true">
        <div
          v-if="memoryRatio !== null"
          class="mnm-plugin-fill"
          :class="memoryTone"
          :style="{ transform: `scaleX(${memoryScale})` }"
        ></div>
      </div>
    </summary>

    <div v-if="open" class="mnm-detail">
      <section class="mnm-detail-section">
        <div class="mnm-detail-head">
          <h4>{{ tx('monitor.section.calls') }}</h4>
          <span class="mnm-inflight">
            {{ tx('monitor.metric.inFlight') }} <b>{{ formatNumber(metrics.calls_in_flight) }}</b>
          </span>
        </div>
        <div class="mnm-numbers">
          <div class="mnm-number">
            <span class="mnm-number-value is-lead">{{ formatNumber(metrics.calls_total) }}</span>
            <span class="mnm-number-label">{{ tx('monitor.metric.callsTotal') }}</span>
          </div>
          <div class="mnm-number">
            <span class="mnm-number-value">{{ formatDurationUs(avgCallUs) }}</span>
            <span class="mnm-number-label">{{ tx('monitor.metric.avgDuration') }}</span>
          </div>
          <div class="mnm-number">
            <span class="mnm-number-value">{{
              formatDurationUs(metrics.call_duration_us_max)
            }}</span>
            <span class="mnm-number-label">{{ tx('monitor.metric.maxDuration') }}</span>
          </div>
        </div>
        <p class="mnm-inline-notes">
          {{ tx('monitor.metric.fuel') }} {{ formatNumber(metrics.fuel_consumed_total) }} ·
          {{ tx('monitor.metric.activation') }}
          {{ formatDurationUs(metrics.activation_us_total) }} ·
          {{ tx('monitor.metric.activationMax') }} {{ formatDurationUs(metrics.activation_us_max) }}
        </p>
        <p v-if="growDeniedText" class="mnm-detail-warning">{{ growDeniedText }}</p>
      </section>

      <section class="mnm-detail-section">
        <div class="mnm-detail-head">
          <h4>{{ tx('monitor.section.histogram') }}</h4>
          <span class="mnm-detail-aside">{{
            tx('monitor.ledger.calls', { n: formatNumber(bucketTotal) })
          }}</span>
        </div>
        <div v-if="bucketTotal > 0" class="mnm-histogram" role="img" :aria-label="histogramLabel">
          <span
            v-for="segment in bucketSegments"
            :key="segment.key"
            :style="{ width: `${segment.percent}%`, background: segment.color }"
          ></span>
        </div>
        <p v-else class="mnm-empty-line">—</p>
        <div v-if="bucketSegments.length > 0" class="mnm-legend">
          <span v-for="segment in bucketSegments" :key="segment.key" class="mnm-legend-item">
            <span
              class="mnm-legend-dot"
              :style="{ background: segment.color }"
              aria-hidden="true"
            ></span>
            <span>{{ tx(`monitor.bucket.${segment.key}`) }}</span>
            <b>{{ formatNumber(segment.count) }}</b>
          </span>
        </div>
      </section>

      <section class="mnm-detail-section">
        <div class="mnm-detail-head">
          <h4>{{ tx('monitor.section.lifecycle') }}</h4>
          <span v-if="latest" class="mnm-detail-aside">
            {{
              tx('monitor.metric.lastEvent', {
                event: lifecycleLabel(latest.key),
                time: formatUnixTime(latest.unix, localeTag),
              })
            }}
          </span>
        </div>
        <div class="mnm-lifecycle">
          <div v-for="key in LIFECYCLE_KEYS" :key="key">
            <span class="mnm-number-value">{{ formatNumber(lifecycleValue(key)) }}</span>
            <span class="mnm-number-label">{{ lifecycleLabel(key) }}</span>
          </div>
        </div>
      </section>

      <div class="mnm-split">
        <section class="mnm-detail-section">
          <h4>{{ tx('monitor.section.authz') }}</h4>
          <dl class="mnm-kv">
            <div>
              <dt>{{ tx('monitor.metric.authzAllow') }}</dt>
              <dd>{{ formatNumber(authz.allow) }}</dd>
            </div>
            <div>
              <dt>{{ tx('monitor.metric.authzDeny') }}</dt>
              <dd :class="{ 'is-danger': (authz.deny ?? 0) > 0 }">
                {{ formatNumber(authz.deny) }}
              </dd>
            </div>
            <div>
              <dt>{{ tx('monitor.metric.authzApproval') }}</dt>
              <dd>{{ formatNumber(authz.require_approval) }}</dd>
            </div>
            <div>
              <dt>{{ tx('monitor.metric.authzDropped') }}</dt>
              <dd :class="{ 'is-warning': (authz.records_dropped ?? 0) > 0 }">
                {{ formatNumber(authz.records_dropped) }}
              </dd>
            </div>
          </dl>
        </section>
        <section class="mnm-detail-section">
          <h4>{{ tx('monitor.section.bus') }}</h4>
          <dl class="mnm-kv">
            <div>
              <dt>{{ tx('monitor.metric.busDropped') }}</dt>
              <dd :class="{ 'is-warning': (bus.dropped ?? 0) > 0 }">
                {{ formatNumber(bus.dropped) }}
              </dd>
            </div>
            <div>
              <dt>{{ tx('monitor.metric.busFormatRejected') }}</dt>
              <dd>{{ formatNumber(bus.format_rejected) }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="mnm-detail-section">
        <h4>{{ tx('monitor.section.quota') }}</h4>
        <dl class="mnm-kv">
          <div v-for="entry in quotaEntries" :key="entry.key">
            <dt>{{ entry.label }}</dt>
            <dd>{{ entry.value }}</dd>
          </div>
        </dl>
        <p class="mnm-quota-note">{{ tx('monitor.metric.quotaNote') }}</p>
      </section>
    </div>
  </details>
</template>

<style scoped>
.mnm-plugin {
  --row-index: 0;
  animation: mnm-row-in 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  animation-delay: calc(80ms + var(--row-index) * 55ms);
}

.mnm-plugin + .mnm-plugin {
  margin-top: 2px;
}

.mnm-plugin-summary {
  list-style: none;
  display: block;
  padding: 14px 16px 12px;
  cursor: pointer;
  transition: background-color 160ms ease;
  -webkit-tap-highlight-color: transparent;
}

.mnm-plugin-summary::-webkit-details-marker {
  display: none;
}

.mnm-plugin-summary:active {
  background: var(--mobile-bg-primary);
}

.mnm-plugin-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mnm-plugin-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--mnm-ink);
}

.mnm-tag {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--mobile-bg-primary);
  color: var(--mnm-ink-2);
  font-size: 13px;
  line-height: 1.35;
  white-space: nowrap;
}

.mnm-chevron {
  width: 18px;
  height: 18px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--mnm-ink-3);
  transition: transform 180ms ease;
}

.mnm-plugin[open] .mnm-chevron {
  transform: rotate(180deg);
}

.mnm-plugin-id {
  margin-top: 2px;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.45;
  color: var(--mnm-ink-3);
}

.mnm-plugin-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-2);
}

.mnm-plugin-mem {
  color: var(--mnm-ink);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.mnm-muted {
  color: var(--mnm-ink-3);
}

.mnm-plugin-traps {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-danger-ink);
  font-weight: 500;
}

.mnm-plugin-track {
  height: 6px;
  margin-top: 9px;
  border-radius: 3px;
  background: var(--mobile-bg-primary);
  overflow: hidden;
}

.mnm-plugin-fill {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transition: transform 360ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.mnm-plugin-fill.is-ok {
  background: var(--mnm-success-ink);
}

.mnm-plugin-fill.is-warn {
  background: var(--mnm-warning-ink);
}

.mnm-plugin-fill.is-danger {
  background: var(--mnm-danger-ink);
}

/* ==================== 展开详情 ==================== */

.mnm-detail {
  margin: 0 10px 10px;
  padding: 14px;
  border-radius: 10px;
  background: var(--mobile-bg-primary);
  animation: mnm-detail-in 220ms ease-out both;
}

.mnm-detail-section {
  min-width: 0;
}

.mnm-detail-section + .mnm-detail-section,
.mnm-detail-section + .mnm-split,
.mnm-split + .mnm-detail-section {
  margin-top: 20px;
}

.mnm-detail h4 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--mnm-ink);
}

.mnm-detail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.mnm-detail-head h4 {
  margin: 0;
}

.mnm-detail-aside {
  max-width: 60%;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mnm-inflight {
  font-size: 13px;
  color: var(--mnm-ink-2);
  white-space: nowrap;
}

.mnm-inflight b {
  margin-left: 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
}

.mnm-numbers {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.mnm-number {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mnm-number-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.mnm-number-value.is-lead {
  font-size: 24px;
}

.mnm-number-label {
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-3);
}

.mnm-inline-notes {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--mnm-ink-2);
  font-variant-numeric: tabular-nums;
}

.mnm-detail-warning {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-warning-ink);
}

.mnm-histogram {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--mobile-bg-elevated);
}

.mnm-histogram > span {
  height: 100%;
  min-width: 2px;
}

.mnm-empty-line {
  margin: 0;
  font-size: 15px;
  color: var(--mnm-ink-3);
}

.mnm-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 14px;
  margin-top: 10px;
}

.mnm-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mnm-ink-2);
  font-variant-numeric: tabular-nums;
}

.mnm-legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex-shrink: 0;
}

.mnm-legend-item b {
  margin-left: auto;
  font-weight: 500;
  color: var(--mnm-ink);
}

.mnm-lifecycle {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 14px;
}

.mnm-lifecycle > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mnm-split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 20px;
}

.mnm-kv {
  display: grid;
  gap: 5px;
  margin: 0;
}

.mnm-kv > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.mnm-kv dt {
  font-size: 13px;
  line-height: 1.45;
  color: var(--mnm-ink-3);
}

.mnm-kv dd {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--mnm-ink);
  font-variant-numeric: tabular-nums;
}

.mnm-kv dd.is-danger {
  color: var(--mnm-danger-ink);
}

.mnm-kv dd.is-warning {
  color: var(--mnm-warning-ink);
}

.mnm-quota-note {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--mnm-ink-3);
}

@keyframes mnm-detail-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes mnm-row-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mnm-plugin,
  .mnm-detail {
    animation: none !important;
  }

  .mnm-chevron,
  .mnm-plugin-summary,
  .mnm-plugin-fill {
    transition: none !important;
  }
}
</style>
