<script setup lang="ts">
/**
 * 单插件指标卡（移动端）
 *
 * 移动端拿不到宿主插件清单，标题显示 plugin_id（短形式）——不伪造应用名 /
 * 运行态。默认只展示「内存 / 调用 / Trap」三块；生命周期、授权、总线、配额
 * 与耗时分布收进「更多指标」（原生 details，触控目标 ≥44px）。
 */
import { computed } from 'vue'
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

const props = defineProps<{ row: PluginMetricRow; selfId?: string }>()

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
  'var(--mobile-success)',
  'var(--mobile-success)',
  'var(--mobile-accent)',
  'var(--mobile-warning)',
  'var(--mobile-error)',
  'var(--mobile-error)',
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
const isSelf = computed(() => props.selfId !== undefined && props.row.id === props.selfId)

const localeTag = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))

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
const memoryTone = computed(() => {
  const ratio = memoryRatio.value
  if (ratio === null) return 'bg-[var(--mobile-success)]'
  if (ratio >= 0.95) return 'bg-[var(--mobile-error)]'
  if (ratio >= 0.8) return 'bg-[var(--mobile-warning)]'
  return 'bg-[var(--mobile-success)]'
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
      label: tx(spec.label),
      value: raw === null ? '—' : spec.unit === 'bytes' ? formatBytes(raw) : formatNumber(raw),
    }
  }),
)

const buckets = computed(() =>
  BUCKET_KEYS.map((key, index) => ({
    key,
    count: metrics.value.call_duration_buckets?.[index] ?? 0,
  })).map((bucket, index) => ({
    ...bucket,
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
  <article
    class="rounded-[var(--radius-card)] border border-[var(--mobile-border)] bg-[var(--mobile-bg-card)] p-3 min-w-0"
    :data-testid="`mobile-monitor-plugin-${row.id}`"
    :data-plugin-id="row.id"
  >
    <!-- ==================== 头部 ==================== -->
    <header class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5 min-w-0">
          <h3
            class="text-[var(--font-size-base)] font-semibold text-[var(--mobile-text-primary)] truncate"
          >
            {{ shortPluginId(row.id) }}
          </h3>
          <span
            v-if="isSelf"
            class="flex-shrink-0 rounded-[var(--radius-tag)] bg-[var(--mobile-accent-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-text-secondary)]"
          >
            {{ tx('monitor.self') }}
          </span>
        </div>
        <div
          class="mt-0.5 font-mono text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate"
          :title="row.id"
        >
          {{ row.id }}
        </div>
      </div>
      <span
        class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)] flex-shrink-0"
      >
        {{ formatNumber(metrics.calls_total) }}
      </span>
    </header>

    <!-- ==================== 内存 ==================== -->
    <section class="mt-3">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.section.memory') }}
        </span>
        <span class="font-mono text-[var(--font-size-xs)] text-[var(--mobile-text-secondary)]">
          {{ formatBytes(metrics.memory_current_bytes) }} /
          {{ formatBytes(metrics.memory_peak_bytes) }}
        </span>
      </div>
      <div
        class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--mobile-bg-elevated)]"
        role="progressbar"
        :aria-valuenow="memoryRatio === null ? undefined : Math.round(memoryPercent)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="tx('monitor.metric.memoryUsage')"
      >
        <div
          v-if="memoryRatio !== null"
          class="h-full w-full origin-left rounded-full transition-transform duration-300"
          :class="memoryTone"
          :style="{ transform: `scaleX(${memoryScale})` }"
        ></div>
      </div>
      <div
        class="mt-1 flex items-center justify-between gap-2 text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]"
      >
        <span>
          {{ tx('monitor.metric.memoryLimit') }}:
          <span class="font-mono">{{ quotaMemory === null ? '—' : formatBytes(quotaMemory) }}</span>
        </span>
        <span v-if="memoryRatio !== null" class="font-mono">{{ formatRatio(memoryRatio) }}</span>
      </div>
      <div
        v-if="
          (metrics.memory_grow_denied_total ?? 0) > 0 || (metrics.table_grow_denied_total ?? 0) > 0
        "
        class="mt-1.5 flex flex-wrap gap-1.5"
      >
        <span
          v-if="(metrics.memory_grow_denied_total ?? 0) > 0"
          class="rounded-[var(--radius-tag)] bg-[var(--mobile-warning-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-warning)]"
        >
          {{
            tx('monitor.metric.memoryDenied', { n: formatNumber(metrics.memory_grow_denied_total) })
          }}
        </span>
        <span
          v-if="(metrics.table_grow_denied_total ?? 0) > 0"
          class="rounded-[var(--radius-tag)] bg-[var(--mobile-warning-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-warning)]"
        >
          {{
            tx('monitor.metric.tableDenied', { n: formatNumber(metrics.table_grow_denied_total) })
          }}
        </span>
      </div>
    </section>

    <!-- ==================== 调用 / 耗时 ==================== -->
    <section class="mt-3 grid grid-cols-4 gap-2">
      <div class="min-w-0">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate">
          {{ tx('monitor.metric.callsTotal') }}
        </div>
        <div class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">
          {{ formatNumber(metrics.calls_total) }}
        </div>
      </div>
      <div class="min-w-0">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate">
          {{ tx('monitor.metric.inFlight') }}
        </div>
        <div class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">
          {{ formatNumber(metrics.calls_in_flight) }}
        </div>
      </div>
      <div class="min-w-0">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate">
          {{ tx('monitor.metric.avgDuration') }}
        </div>
        <div class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">
          {{ formatDurationUs(avgCallUs) }}
        </div>
      </div>
      <div class="min-w-0">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate">
          {{ tx('monitor.metric.maxDuration') }}
        </div>
        <div class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">
          {{ formatDurationUs(metrics.call_duration_us_max) }}
        </div>
      </div>
    </section>

    <!-- ==================== Trap ==================== -->
    <section class="mt-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.section.traps') }}
        </span>
        <span
          class="font-mono text-[var(--font-size-sm)]"
          :class="
            trapTotal > 0 ? 'text-[var(--mobile-error)]' : 'text-[var(--mobile-text-secondary)]'
          "
        >
          {{ formatNumber(trapTotal) }}
        </span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <span
          v-for="trap in trapEntries"
          :key="trap.key"
          class="rounded-[var(--radius-tag)] bg-[var(--mobile-error-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-error)]"
        >
          {{ trapLabel(trap.key) }} · {{ formatNumber(trap.value) }}
        </span>
        <span
          v-if="trapEntries.length === 0"
          class="rounded-[var(--radius-tag)] bg-[var(--mobile-success-muted)] px-1.5 py-0.5 text-[var(--font-size-xs)] text-[var(--mobile-success)]"
        >
          {{ tx('monitor.metric.trapsNone') }}
        </span>
      </div>
    </section>

    <!-- ==================== 更多指标（原生 details） ==================== -->
    <details class="mt-3 border-t border-[var(--mobile-border)] pt-2">
      <summary
        class="flex min-h-[44px] cursor-pointer select-none items-center text-[var(--font-size-sm)] text-[var(--mobile-text-secondary)]"
      >
        {{ tx('monitor.metric.more') }}
      </summary>

      <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[var(--font-size-xs)]">
        <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-[var(--mobile-text-muted)] truncate">{{
            tx('monitor.metric.fuel')
          }}</span>
          <span class="font-mono text-[var(--mobile-text-secondary)]">{{
            formatNumber(metrics.fuel_consumed_total)
          }}</span>
        </div>
        <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-[var(--mobile-text-muted)] truncate">{{
            tx('monitor.metric.activation')
          }}</span>
          <span class="font-mono text-[var(--mobile-text-secondary)]">{{
            formatDurationUs(metrics.activation_us_total)
          }}</span>
        </div>
        <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-[var(--mobile-text-muted)] truncate">{{
            tx('monitor.metric.activationMax')
          }}</span>
          <span class="font-mono text-[var(--mobile-text-secondary)]">{{
            formatDurationUs(metrics.activation_us_max)
          }}</span>
        </div>
        <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-[var(--mobile-text-muted)] truncate">{{
            tx('monitor.metric.authzDeny')
          }}</span>
          <span
            class="font-mono"
            :class="
              (authz.deny ?? 0) > 0
                ? 'text-[var(--mobile-error)]'
                : 'text-[var(--mobile-text-secondary)]'
            "
          >
            {{ formatNumber(authz.deny) }}
          </span>
        </div>
      </div>

      <!-- 生命周期 -->
      <section class="mt-3">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.section.lifecycle') }}
        </div>
        <div class="mt-1 grid grid-cols-3 gap-x-3 gap-y-1.5">
          <div v-for="key in LIFECYCLE_KEYS" :key="key" class="min-w-0">
            <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)] truncate">
              {{ lifecycleLabel(key) }}
            </div>
            <div class="font-mono text-[var(--font-size-sm)] text-[var(--mobile-text-primary)]">
              {{ formatNumber(lifecycleValue(key)) }}
            </div>
          </div>
        </div>
        <div v-if="latest" class="mt-1 text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{
            tx('monitor.metric.lastEvent', {
              event: lifecycleLabel(latest.key),
              time: formatUnixTime(latest.unix, localeTag),
            })
          }}
        </div>
      </section>

      <!-- 授权 / 总线 -->
      <div class="mt-3 grid grid-cols-2 gap-3">
        <section class="min-w-0">
          <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
            {{ tx('monitor.section.authz') }}
          </div>
          <dl class="mt-1 space-y-1 text-[var(--font-size-xs)]">
            <div class="flex items-center justify-between gap-2">
              <dt class="text-[var(--mobile-text-muted)] truncate">
                {{ tx('monitor.metric.authzAllow') }}
              </dt>
              <dd class="font-mono text-[var(--mobile-text-secondary)]">
                {{ formatNumber(authz.allow) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-[var(--mobile-text-muted)] truncate">
                {{ tx('monitor.metric.authzApproval') }}
              </dt>
              <dd class="font-mono text-[var(--mobile-text-secondary)]">
                {{ formatNumber(authz.require_approval) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-[var(--mobile-text-muted)] truncate">
                {{ tx('monitor.metric.authzDropped') }}
              </dt>
              <dd class="font-mono text-[var(--mobile-text-secondary)]">
                {{ formatNumber(authz.records_dropped) }}
              </dd>
            </div>
          </dl>
        </section>
        <section class="min-w-0">
          <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
            {{ tx('monitor.section.bus') }}
          </div>
          <dl class="mt-1 space-y-1 text-[var(--font-size-xs)]">
            <div class="flex items-center justify-between gap-2">
              <dt class="text-[var(--mobile-text-muted)] truncate">
                {{ tx('monitor.metric.busDropped') }}
              </dt>
              <dd
                class="font-mono"
                :class="
                  (bus.dropped ?? 0) > 0
                    ? 'text-[var(--mobile-warning)]'
                    : 'text-[var(--mobile-text-secondary)]'
                "
              >
                {{ formatNumber(bus.dropped) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-[var(--mobile-text-muted)] truncate">
                {{ tx('monitor.metric.busFormatRejected') }}
              </dt>
              <dd class="font-mono text-[var(--mobile-text-secondary)]">
                {{ formatNumber(bus.format_rejected) }}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <!-- 耗时分布 -->
      <section class="mt-3">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.section.histogram') }}
        </div>
        <div v-if="bucketTotal > 0" class="mt-1 flex h-2 w-full overflow-hidden rounded-full">
          <div
            v-for="segment in bucketSegments"
            :key="segment.key"
            :style="{ width: `${segment.percent}%`, background: segment.color }"
          ></div>
        </div>
        <div v-else class="mt-1 text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">—</div>
        <div
          v-if="bucketSegments.length > 0"
          class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]"
        >
          <span
            v-for="segment in bucketSegments"
            :key="segment.key"
            class="inline-flex items-center gap-1"
          >
            <span
              class="inline-block h-1.5 w-1.5 rounded-sm flex-shrink-0"
              :style="{ background: segment.color }"
              aria-hidden="true"
            ></span>
            <span>{{ tx(`monitor.bucket.${segment.key}`) }}</span>
            <span class="font-mono">{{ formatNumber(segment.count) }}</span>
          </span>
        </div>
      </section>

      <!-- 配额上限 -->
      <section class="mt-3">
        <div class="text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.section.quota') }}
        </div>
        <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[var(--font-size-xs)]">
          <div
            v-for="entry in quotaEntries"
            :key="entry.key"
            class="flex items-center justify-between gap-2 min-w-0"
          >
            <span class="text-[var(--mobile-text-muted)] truncate">{{ entry.label }}</span>
            <span class="font-mono text-[var(--mobile-text-secondary)] flex-shrink-0">{{
              entry.value
            }}</span>
          </div>
        </div>
        <p class="mt-1.5 text-[var(--font-size-xs)] text-[var(--mobile-text-muted)]">
          {{ tx('monitor.metric.quotaNote') }}
        </p>
      </section>
    </details>
  </article>
</template>
