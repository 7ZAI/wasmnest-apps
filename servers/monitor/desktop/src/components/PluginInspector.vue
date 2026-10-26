<script setup lang="ts">
/**
 * 选中插件的完整指标（桌面）。
 *
 * 数据只来自 `PluginMetricsSnapshot` + 宿主清单状态；所有「无数据」路径显示 `—`。
 * 诚实边界：`quota.*` 是宿主配额上限，不是实时占用；水位只用内存 current / 上限。
 */
import { computed, inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { PluginDisplayState, PluginRow } from '../types'
import i18n from '../i18n'
import {
  averageUs,
  formatBytes,
  formatDurationUs,
  formatNumber,
  formatRatio,
  formatUnixTime,
  isServiceKind,
  latestLifecycle,
  nonZeroEntries,
  roleI18nKey,
  sumValues,
  usageRatio,
} from '../utils/format'

const props = defineProps<{ row: PluginRow; selfId?: string }>()
const context = inject<MonitorAppContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

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
  'var(--color-success-ink)',
  'var(--color-success-ink)',
  'var(--color-info-ink)',
  'var(--color-warning-ink)',
  'var(--color-danger-ink)',
  'var(--color-danger-ink)',
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
const localeTag = computed(() => (i18n.global.locale.value === 'en' ? 'en-US' : 'zh-CN'))
const isSelf = computed(() => !!props.selfId && props.row.id === props.selfId)
const roleText = computed(() => {
  if (!isServiceKind(props.row.kind)) return ''
  const key = roleI18nKey(props.row.kind)
  return key ? t(key) : ''
})

const quotaMemory = computed(() => quotaValue('memory_bytes'))
const memoryRatio = computed(() =>
  usageRatio(metrics.value.memory_current_bytes, quotaMemory.value),
)
const memoryPercent = computed(() =>
  memoryRatio.value === null ? 0 : Math.min(100, Math.max(0, memoryRatio.value * 100)),
)
const memoryScale = computed(() => memoryPercent.value / 100)
const memoryTone = computed<'ok' | 'warn' | 'danger'>(() => {
  const ratio = memoryRatio.value
  if (ratio === null) return 'ok'
  if (ratio >= 0.95) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
})

const callsInFlight = computed(() => metrics.value.calls_in_flight ?? 0)
const avgCallUs = computed(() =>
  averageUs(metrics.value.call_duration_us_total, metrics.value.calls_total),
)
const trapEntries = computed(() => nonZeroEntries(metrics.value.trap_reasons, TRAP_KEYS))
const trapTotal = computed(() => sumValues(metrics.value.trap_reasons))
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
    .map((bucket) => `${t(`monitor.bucket.${bucket.key}`)}: ${bucket.count}`)
    .join(', '),
)

const quotaEntries = computed(() =>
  QUOTA_SPECS.map((spec) => {
    const raw = quotaValue(spec.key)
    return {
      key: spec.key,
      label: t(spec.label),
      value: raw === null ? '—' : spec.unit === 'bytes' ? formatBytes(raw) : formatNumber(raw),
    }
  }),
)

const growDeniedText = computed(() => {
  const parts: string[] = []
  if ((metrics.value.memory_grow_denied_total ?? 0) > 0) {
    parts.push(
      t('monitor.metric.memoryDenied', { n: formatNumber(metrics.value.memory_grow_denied_total) }),
    )
  }
  if ((metrics.value.table_grow_denied_total ?? 0) > 0) {
    parts.push(
      t('monitor.metric.tableDenied', { n: formatNumber(metrics.value.table_grow_denied_total) }),
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
  return (LIFECYCLE_KEYS as readonly string[]).includes(key) ? t(`monitor.lifecycle.${key}`) : key
}

function trapLabel(key: string): string {
  return (TRAP_KEYS as readonly string[]).includes(key) ? t(`monitor.trap.${key}`) : key
}

function stateTone(state: PluginDisplayState): string {
  if (state === 'running') return 'is-success'
  if (state === 'degraded' || state === 'approval') return 'is-warning'
  if (state === 'error') return 'is-danger'
  return 'is-neutral'
}
</script>

<template>
  <article
    class="mn-inspector"
    data-ui
    data-testid="monitor-inspector"
    :data-plugin-id="row.id"
    :aria-labelledby="`monitor-inspector-title-${row.id}`"
  >
    <header class="mn-inspector-head">
      <div class="mn-inspector-identity">
        <h3 :id="`monitor-inspector-title-${row.id}`" class="mn-inspector-name">{{ row.name }}</h3>
        <p class="mn-inspector-id">
          {{ row.id }}
          <span v-if="row.version"> · {{ row.version }}</span>
        </p>
      </div>
      <div class="mn-inspector-status">
        <span class="mn-state" :class="stateTone(row.state)">
          <span class="mn-state-dot" aria-hidden="true"></span>
          {{ t(`monitor.state.${row.state}`) }}
        </span>
        <span v-if="roleText" class="mn-role" data-testid="monitor-inspector-role">{{
          roleText
        }}</span>
        <span v-if="isSelf" class="mn-tag">{{ t('monitor.self') }}</span>
      </div>
    </header>

    <p v-if="row.stateError" class="mn-inspector-error">{{ row.stateError }}</p>

    <template v-if="row.metricsAvailable">
      <!-- 内存水位 -->
      <section class="mn-inspector-memory" :aria-label="t('monitor.section.memory')">
        <div class="mn-memory-head">
          <p class="mn-memory-value">
            {{ formatBytes(metrics.memory_current_bytes) }}
            <span class="mn-memory-limit"
              >/ {{ quotaMemory === null ? '—' : formatBytes(quotaMemory) }}</span
            >
          </p>
          <span class="mn-memory-share" :data-testid="`monitor-memory-ratio-${row.id}`">
            {{
              memoryRatio === null
                ? '—'
                : t('monitor.inspector.usage', { ratio: formatRatio(memoryRatio) })
            }}
          </span>
        </div>
        <div
          class="mn-waterline"
          role="progressbar"
          :aria-valuenow="memoryRatio === null ? undefined : Math.round(memoryPercent)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('monitor.metric.memoryUsage')"
          :data-testid="`monitor-memory-${row.id}`"
        >
          <div
            v-if="memoryRatio !== null"
            class="mn-waterline-fill"
            :class="`is-${memoryTone}`"
            :style="{ transform: `scaleX(${memoryScale})` }"
          ></div>
        </div>
        <div class="mn-memory-notes">
          <span
            >{{ t('monitor.metric.memoryPeak') }} {{ formatBytes(metrics.memory_peak_bytes) }}</span
          >
          <span v-if="growDeniedText" class="is-warning">{{ growDeniedText }}</span>
        </div>
      </section>

      <!-- 调用 / 耗时 -->
      <section class="mn-sheet" aria-labelledby="calls-label">
        <div class="mn-sheet-head">
          <h4 id="calls-label" class="mn-sheet-title">{{ t('monitor.section.calls') }}</h4>
          <span class="mn-inflight">
            {{ t('monitor.metric.inFlight') }}
            <b :data-testid="`monitor-inflight-${row.id}`">{{ formatNumber(callsInFlight) }}</b>
          </span>
        </div>
        <div class="mn-numbers">
          <div class="mn-number is-lead">
            <span class="mn-number-value">{{ formatNumber(metrics.calls_total) }}</span>
            <span class="mn-number-label">{{ t('monitor.metric.callsTotal') }}</span>
          </div>
          <div class="mn-number">
            <span class="mn-number-value">{{ formatDurationUs(avgCallUs) }}</span>
            <span class="mn-number-label">{{ t('monitor.metric.avgDuration') }}</span>
          </div>
          <div class="mn-number">
            <span class="mn-number-value">{{
              formatDurationUs(metrics.call_duration_us_max)
            }}</span>
            <span class="mn-number-label">{{ t('monitor.metric.maxDuration') }}</span>
          </div>
        </div>
        <div class="mn-inline-notes">
          <span
            >{{ t('monitor.metric.fuel') }} {{ formatNumber(metrics.fuel_consumed_total) }}</span
          >
          <span
            >{{ t('monitor.metric.activation') }}
            {{ formatDurationUs(metrics.activation_us_total) }}</span
          >
          <span
            >{{ t('monitor.metric.activationMax') }}
            {{ formatDurationUs(metrics.activation_us_max) }}</span
          >
        </div>
      </section>

      <!-- 耗时分布 -->
      <section class="mn-sheet" aria-labelledby="histogram-label">
        <div class="mn-sheet-head">
          <h4 id="histogram-label" class="mn-sheet-title">{{ t('monitor.section.histogram') }}</h4>
          <span class="mn-sheet-aside">{{
            t('monitor.ledger.calls', { n: formatNumber(bucketTotal) })
          }}</span>
        </div>
        <div :data-testid="`monitor-histogram-${row.id}`">
          <div v-if="bucketTotal > 0" class="mn-histogram" role="img" :aria-label="histogramLabel">
            <span
              v-for="segment in bucketSegments"
              :key="segment.key"
              class="mn-histogram-segment"
              :style="{ width: `${segment.percent}%`, background: segment.color }"
            ></span>
          </div>
          <p v-else class="mn-empty-line">—</p>
          <div v-if="bucketSegments.length > 0" class="mn-histogram-legend">
            <span v-for="segment in bucketSegments" :key="segment.key" class="mn-legend-item">
              <span
                class="mn-legend-dot"
                :style="{ background: segment.color }"
                aria-hidden="true"
              ></span>
              <span>{{ t(`monitor.bucket.${segment.key}`) }}</span>
              <b>{{ formatNumber(segment.count) }}</b>
            </span>
          </div>
        </div>
      </section>

      <!-- Trap 原因 -->
      <section class="mn-sheet" aria-labelledby="traps-label">
        <div class="mn-sheet-head">
          <h4 id="traps-label" class="mn-sheet-title">{{ t('monitor.section.traps') }}</h4>
          <span class="mn-sheet-aside" :class="{ 'is-danger': trapTotal > 0 }">{{
            formatNumber(trapTotal)
          }}</span>
        </div>
        <div :data-testid="`monitor-traps-${row.id}`">
          <ul v-if="trapEntries.length > 0" class="mn-trap-list">
            <li v-for="trap in trapEntries" :key="trap.key">
              <span>{{ trapLabel(trap.key) }}</span>
              <b>{{ formatNumber(trap.value) }}</b>
            </li>
          </ul>
          <p v-else class="mn-ok-line">
            <span class="mn-state-dot is-success" aria-hidden="true"></span>
            {{ t('monitor.inspector.noTraps') }}
          </p>
        </div>
      </section>

      <!-- 生命周期 -->
      <section class="mn-sheet" aria-labelledby="lifecycle-label">
        <div class="mn-sheet-head">
          <h4 id="lifecycle-label" class="mn-sheet-title">{{ t('monitor.section.lifecycle') }}</h4>
          <span v-if="latest" class="mn-sheet-aside">
            {{
              t('monitor.metric.lastEvent', {
                event: lifecycleLabel(latest.key),
                time: formatUnixTime(latest.unix, localeTag),
              })
            }}
          </span>
        </div>
        <div class="mn-lifecycle">
          <div v-for="key in LIFECYCLE_KEYS" :key="key" class="mn-lifecycle-item">
            <span class="mn-number-value is-small">{{ formatNumber(lifecycleValue(key)) }}</span>
            <span class="mn-number-label">{{ lifecycleLabel(key) }}</span>
          </div>
        </div>
      </section>

      <!-- 授权 / 总线 -->
      <div class="mn-split">
        <section class="mn-sheet" aria-labelledby="authz-label">
          <h4 id="authz-label" class="mn-sheet-title">{{ t('monitor.section.authz') }}</h4>
          <dl class="mn-kv">
            <div>
              <dt>{{ t('monitor.metric.authzAllow') }}</dt>
              <dd>{{ formatNumber(authz.allow) }}</dd>
            </div>
            <div>
              <dt>{{ t('monitor.metric.authzDeny') }}</dt>
              <dd :class="{ 'is-danger': (authz.deny ?? 0) > 0 }">
                {{ formatNumber(authz.deny) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('monitor.metric.authzApproval') }}</dt>
              <dd>{{ formatNumber(authz.require_approval) }}</dd>
            </div>
            <div>
              <dt>{{ t('monitor.metric.authzDropped') }}</dt>
              <dd :class="{ 'is-warning': (authz.records_dropped ?? 0) > 0 }">
                {{ formatNumber(authz.records_dropped) }}
              </dd>
            </div>
          </dl>
        </section>
        <section class="mn-sheet" aria-labelledby="bus-label">
          <h4 id="bus-label" class="mn-sheet-title">{{ t('monitor.section.bus') }}</h4>
          <dl class="mn-kv">
            <div>
              <dt>{{ t('monitor.metric.busDropped') }}</dt>
              <dd :class="{ 'is-warning': (bus.dropped ?? 0) > 0 }">
                {{ formatNumber(bus.dropped) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('monitor.metric.busFormatRejected') }}</dt>
              <dd>{{ formatNumber(bus.format_rejected) }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <details class="mn-quota" :data-testid="`monitor-quota-${row.id}`">
        <summary class="mn-quota-summary" :data-testid="`monitor-quota-toggle-${row.id}`">
          <span>{{ t('monitor.section.quota') }}</span>
          <span class="mn-chevron" aria-hidden="true"></span>
        </summary>
        <div class="mn-quota-body">
          <div class="mn-quota-grid">
            <div v-for="entry in quotaEntries" :key="entry.key" class="mn-kv-row">
              <span>{{ entry.label }}</span>
              <b>{{ entry.value }}</b>
            </div>
          </div>
          <p class="mn-quota-note" :data-testid="`monitor-quota-note-${row.id}`">
            {{ t('monitor.metric.quotaNote') }}
          </p>
        </div>
      </details>
    </template>

    <section v-else class="mn-inspector-unavailable" data-testid="monitor-metrics-unavailable">
      <h4 class="mn-sheet-title">{{ t('monitor.inspector.noMetricsTitle') }}</h4>
      <p class="mn-empty-line">{{ t('monitor.inspector.noMetricsHint') }}</p>
    </section>
  </article>
</template>
