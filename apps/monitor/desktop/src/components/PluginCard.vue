<script setup lang="ts">
/**
 * 单插件指标卡（桌面）
 *
 * 数据只来自 `PluginMetricsSnapshot`（字段形状 = 宿主契约）+ 宿主清单状态；
 * 组件不做取数。所有「无数据」路径显示 `—`，不把缺失说成 0。
 *
 * 诚实边界：`quota.*` 是宿主配额**上限**，不是实时占用（wasmtime 不暴露每
 * Store 的 memories/tables 实时数量）——占用条只拿内存 current / 上限作比。
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
  latestLifecycle,
  nonZeroEntries,
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

/** 直方图桶语义色：快 → 慢 */
const BUCKET_COLORS = [
  'var(--color-success)',
  'var(--color-success)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-danger)',
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

const stateLabel = computed(() => t(`monitor.state.${props.row.state}`))

const stateChipClass = computed(() => stateChip(props.row.state))
const stateDotClass = computed(() => `mn-state-dot is-${props.row.state}`)

const callsInFlight = computed(() => metrics.value.calls_in_flight ?? 0)
const avgCallUs = computed(() =>
  averageUs(metrics.value.call_duration_us_total, metrics.value.calls_total),
)

const quotaMemory = computed(() => quotaValue('memory_bytes'))
const memoryRatio = computed(() =>
  usageRatio(metrics.value.memory_current_bytes, quotaMemory.value),
)
const memoryPercent = computed(() =>
  memoryRatio.value === null ? 0 : Math.min(100, Math.max(0, memoryRatio.value * 100)),
)
/** 占用条用 scaleX 绘制（避免动画 width 触发布局） */
const memoryScale = computed(() => memoryPercent.value / 100)
const memoryTone = computed<'ok' | 'warn' | 'danger'>(() => {
  const ratio = memoryRatio.value
  if (ratio === null) return 'ok'
  if (ratio >= 0.95) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
})

const trapEntries = computed(() => nonZeroEntries(metrics.value.trap_reasons, TRAP_KEYS))
const trapTotal = computed(() => sumValues(metrics.value.trap_reasons))

const latest = computed(() => latestLifecycle(metrics.value.lifecycle_last_unix))

const authz = computed(() => metrics.value.authz ?? {})
const bus = computed(() => metrics.value.bus ?? {})

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

const buckets = computed(() =>
  BUCKET_KEYS.map((key, index) => ({
    key,
    count: metrics.value.call_duration_buckets?.[index] ?? 0,
  })),
)
const bucketTotal = computed(() => buckets.value.reduce((sum, bucket) => sum + bucket.count, 0))
const bucketSegments = computed(() =>
  buckets.value
    .map((bucket, index) => ({
      ...bucket,
      color: BUCKET_COLORS[index],
      percent: bucketTotal.value > 0 ? (bucket.count / bucketTotal.value) * 100 : 0,
    }))
    .filter((bucket) => bucket.count > 0),
)
const histogramLabel = computed(() =>
  bucketSegments.value
    .map((bucket) => `${t(`monitor.bucket.${bucket.key}`)}: ${bucket.count}`)
    .join(', '),
)

function stateChip(state: PluginDisplayState): string {
  switch (state) {
    case 'running':
      return 'mn-chip mn-chip-success'
    case 'degraded':
    case 'approval':
      return 'mn-chip mn-chip-warning'
    case 'error':
      return 'mn-chip mn-chip-danger'
    default:
      return 'mn-chip mn-chip-neutral'
  }
}

function lifecycleValue(key: string): number {
  return metrics.value.lifecycle?.[key] ?? 0
}

function quotaValue(key: string): number | null {
  const raw = metrics.value.quota?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function lifecycleLabel(key: string): string {
  return (LIFECYCLE_KEYS as readonly string[]).includes(key) ? t(`monitor.lifecycle.${key}`) : key
}

function trapLabel(key: string): string {
  return (TRAP_KEYS as readonly string[]).includes(key) ? t(`monitor.trap.${key}`) : key
}
</script>

<template>
  <article
    class="mn-card p-4 min-w-0"
    :data-testid="`monitor-plugin-${row.id}`"
    :data-plugin-id="row.id"
    :data-state="row.state"
  >
    <!-- ==================== 头部：名称 / id / 状态 ==================== -->
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <span :class="stateDotClass" aria-hidden="true"></span>
          <h3
            class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)] truncate"
            :title="row.name"
          >
            {{ row.name }}
          </h3>
          <span v-if="selfId && row.id === selfId" class="mn-chip mn-chip-neutral">
            {{ t('monitor.self') }}
          </span>
          <span v-if="row.version" class="mn-chip mn-chip-neutral">{{ row.version }}</span>
        </div>
        <div
          class="mt-0.5 mn-mono text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
          :title="row.id"
        >
          {{ row.id }}
        </div>
      </div>
      <span :class="stateChipClass" :data-testid="`monitor-state-${row.id}`">{{ stateLabel }}</span>
    </header>

    <p
      v-if="row.stateError"
      class="mt-2 text-[calc(10.5px*var(--ui-scale))] text-[var(--color-danger-ink)] break-words"
    >
      {{ row.stateError }}
    </p>

    <!-- ==================== 内存 ==================== -->
    <section class="mt-4">
      <div class="flex items-baseline justify-between gap-2">
        <span class="mn-label">{{ t('monitor.section.memory') }}</span>
        <span class="mn-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]">
          {{ formatBytes(metrics.memory_current_bytes) }} /
          {{ formatBytes(metrics.memory_peak_bytes) }}
        </span>
      </div>
      <div
        class="mn-track mt-1.5"
        role="progressbar"
        :aria-valuenow="memoryRatio === null ? undefined : Math.round(memoryPercent)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="t('monitor.metric.memoryUsage')"
        :data-testid="`monitor-memory-${row.id}`"
      >
        <div
          v-if="memoryRatio !== null"
          class="mn-track-fill"
          :class="`is-${memoryTone}`"
          :style="{ transform: `scaleX(${memoryScale})` }"
        ></div>
      </div>
      <div class="mt-1 flex items-center justify-between gap-2 mn-label">
        <span>
          {{ t('monitor.metric.memoryLimit') }}:
          <span class="mn-mono">{{ quotaMemory === null ? '—' : formatBytes(quotaMemory) }}</span>
        </span>
        <span
          v-if="memoryRatio !== null"
          class="mn-mono"
          :data-testid="`monitor-memory-ratio-${row.id}`"
        >
          {{ formatRatio(memoryRatio) }}
        </span>
      </div>
      <div
        v-if="
          (metrics.memory_grow_denied_total ?? 0) > 0 || (metrics.table_grow_denied_total ?? 0) > 0
        "
        class="mt-1.5 flex flex-wrap gap-1.5"
      >
        <span v-if="(metrics.memory_grow_denied_total ?? 0) > 0" class="mn-chip mn-chip-warning">
          {{
            t('monitor.metric.memoryDenied', { n: formatNumber(metrics.memory_grow_denied_total) })
          }}
        </span>
        <span v-if="(metrics.table_grow_denied_total ?? 0) > 0" class="mn-chip mn-chip-warning">
          {{
            t('monitor.metric.tableDenied', { n: formatNumber(metrics.table_grow_denied_total) })
          }}
        </span>
      </div>
    </section>

    <!-- ==================== 调用 / 耗时 ==================== -->
    <section class="mt-4">
      <div class="mn-label mb-1.5">{{ t('monitor.section.calls') }}</div>
      <div class="grid grid-cols-3 gap-3">
        <div class="min-w-0">
          <div class="mn-label">{{ t('monitor.metric.callsTotal') }}</div>
          <div
            class="mn-mono text-[calc(12px*var(--ui-scale))] font-semibold text-[var(--text-primary)]"
          >
            {{ formatNumber(metrics.calls_total) }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="mn-label">{{ t('monitor.metric.avgDuration') }}</div>
          <div class="mn-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
            {{ formatDurationUs(avgCallUs) }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="mn-label">{{ t('monitor.metric.maxDuration') }}</div>
          <div class="mn-mono text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
            {{ formatDurationUs(metrics.call_duration_us_max) }}
          </div>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 mn-label">
        <span>
          {{ t('monitor.metric.inFlight') }}:
          <span class="mn-mono" :data-testid="`monitor-inflight-${row.id}`">{{
            formatNumber(callsInFlight)
          }}</span>
        </span>
        <span>
          {{ t('monitor.metric.fuel') }}:
          <span class="mn-mono">{{ formatNumber(metrics.fuel_consumed_total) }}</span>
        </span>
        <span>
          {{ t('monitor.metric.activation') }}:
          <span class="mn-mono">{{ formatDurationUs(metrics.activation_us_total) }}</span>
        </span>
        <span>
          {{ t('monitor.metric.activationMax') }}:
          <span class="mn-mono">{{ formatDurationUs(metrics.activation_us_max) }}</span>
        </span>
      </div>

      <!-- 耗时直方图：真实桶计数，不是装饰条；无调用时显示 — -->
      <div class="mt-2.5">
        <div class="flex items-center justify-between gap-2 mn-label">
          <span>{{ t('monitor.section.histogram') }}</span>
        </div>
        <div
          v-if="bucketTotal > 0"
          class="mt-1 flex h-2 w-full overflow-hidden rounded-full"
          role="img"
          :aria-label="histogramLabel"
          :data-testid="`monitor-histogram-${row.id}`"
        >
          <div
            v-for="segment in bucketSegments"
            :key="segment.key"
            :style="{ width: `${segment.percent}%`, background: segment.color }"
          ></div>
        </div>
        <div v-else class="mt-1 mn-label">—</div>
        <div v-if="bucketSegments.length > 0" class="mt-1 flex flex-wrap gap-x-2 gap-y-1 mn-label">
          <span
            v-for="segment in bucketSegments"
            :key="segment.key"
            class="inline-flex items-center gap-1"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-sm flex-shrink-0"
              :style="{ background: segment.color }"
              aria-hidden="true"
            ></span>
            <span>{{ t(`monitor.bucket.${segment.key}`) }}</span>
            <span class="mn-mono">{{ formatNumber(segment.count) }}</span>
          </span>
        </div>
      </div>
    </section>

    <!-- ==================== Trap 原因 ==================== -->
    <section class="mt-4">
      <div class="flex items-center justify-between gap-2">
        <span class="mn-label">{{ t('monitor.section.traps') }}</span>
        <span
          class="mn-mono text-[calc(11px*var(--ui-scale))]"
          :class="trapTotal > 0 ? 'text-[var(--color-danger-ink)]' : 'text-[var(--text-secondary)]'"
        >
          {{ formatNumber(trapTotal) }}
        </span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1.5" :data-testid="`monitor-traps-${row.id}`">
        <span v-for="trap in trapEntries" :key="trap.key" class="mn-chip mn-chip-danger">
          {{ trapLabel(trap.key) }} · {{ formatNumber(trap.value) }}
        </span>
        <span v-if="trapEntries.length === 0" class="mn-chip mn-chip-success">
          {{ t('monitor.metric.trapsNone') }}
        </span>
      </div>
    </section>

    <!-- ==================== 生命周期 ==================== -->
    <section class="mt-4">
      <div class="mn-label mb-1.5">{{ t('monitor.section.lifecycle') }}</div>
      <div class="grid grid-cols-3 gap-x-3 gap-y-2">
        <div v-for="key in LIFECYCLE_KEYS" :key="key" class="min-w-0">
          <div class="mn-label truncate">{{ lifecycleLabel(key) }}</div>
          <div class="mn-mono text-[calc(11.5px*var(--ui-scale))] text-[var(--text-primary)]">
            {{ formatNumber(lifecycleValue(key)) }}
          </div>
        </div>
      </div>
      <div v-if="latest" class="mt-1.5 mn-label">
        {{
          t('monitor.metric.lastEvent', {
            event: lifecycleLabel(latest.key),
            time: formatUnixTime(latest.unix, localeTag),
          })
        }}
      </div>
    </section>

    <!-- ==================== 授权决策 / 总线 ==================== -->
    <div class="mt-4 grid grid-cols-2 gap-4">
      <section class="min-w-0">
        <div class="mn-label mb-1">{{ t('monitor.section.authz') }}</div>
        <dl class="space-y-1 text-[calc(10.5px*var(--ui-scale))]">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.authzAllow') }}
            </dt>
            <dd class="mn-mono text-[var(--text-secondary)]">{{ formatNumber(authz.allow) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.authzDeny') }}
            </dt>
            <dd
              class="mn-mono"
              :class="
                (authz.deny ?? 0) > 0
                  ? 'text-[var(--color-danger-ink)]'
                  : 'text-[var(--text-secondary)]'
              "
            >
              {{ formatNumber(authz.deny) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.authzApproval') }}
            </dt>
            <dd class="mn-mono text-[var(--text-secondary)]">
              {{ formatNumber(authz.require_approval) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.authzDropped') }}
            </dt>
            <dd
              class="mn-mono"
              :class="
                (authz.records_dropped ?? 0) > 0
                  ? 'text-[var(--color-warning-ink)]'
                  : 'text-[var(--text-secondary)]'
              "
            >
              {{ formatNumber(authz.records_dropped) }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="min-w-0">
        <div class="mn-label mb-1">{{ t('monitor.section.bus') }}</div>
        <dl class="space-y-1 text-[calc(10.5px*var(--ui-scale))]">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.busDropped') }}
            </dt>
            <dd
              class="mn-mono"
              :class="
                (bus.dropped ?? 0) > 0
                  ? 'text-[var(--color-warning-ink)]'
                  : 'text-[var(--text-secondary)]'
              "
            >
              {{ formatNumber(bus.dropped) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-[var(--text-tertiary)] truncate">
              {{ t('monitor.metric.busFormatRejected') }}
            </dt>
            <dd class="mn-mono text-[var(--text-secondary)]">
              {{ formatNumber(bus.format_rejected) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <!-- ==================== 配额上限（可折叠；默认收起避免每卡重复长列表） ==================== -->
    <details
      class="mt-4 border-t border-[var(--border)] pt-3"
      :data-testid="`monitor-quota-${row.id}`"
    >
      <summary
        class="mn-label cursor-pointer select-none"
        :data-testid="`monitor-quota-toggle-${row.id}`"
      >
        {{ t('monitor.section.quota') }}
      </summary>
      <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[calc(10.5px*var(--ui-scale))]">
        <div
          v-for="entry in quotaEntries"
          :key="entry.key"
          class="flex items-center justify-between gap-2 min-w-0"
        >
          <span class="text-[var(--text-tertiary)] truncate">{{ entry.label }}</span>
          <span class="mn-mono text-[var(--text-secondary)] flex-shrink-0">{{ entry.value }}</span>
        </div>
      </div>
      <p class="mt-2 mn-label" :data-testid="`monitor-quota-note-${row.id}`">
        {{ t('monitor.metric.quotaNote') }}
      </p>
    </details>
  </article>
</template>
