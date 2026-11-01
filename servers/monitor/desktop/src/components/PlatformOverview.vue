<script setup lang="ts">
/**
 * 平台总览（桌面）：全部已加载 wasm 的内存 / 计算负载合计。
 *
 * 口径只来自快照求和：
 * - 内存 = 线性内存合计（不是宿主进程 RSS）；上限 = 各插件配额之和（不是共享池）；
 * - 计算负载 = 燃料消耗速率——宿主没有进程级 CPU 契约，页面不把代理指标叫成 CPU；
 * - 速率没有两个采样点时为 `—`（基线建立中），不用 0 冒充。
 */
import { computed, inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { MemoryConsumer, PlatformTotals } from '../types'
import { formatBytes, formatRatio } from '../utils/format'
import { formatCompact, formatRate } from '../utils/platform'

const props = defineProps<{
  totals: PlatformTotals
  consumers: MemoryConsumer[]
}>()

const context = inject<MonitorAppContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const memoryTone = computed<'ok' | 'warn' | 'danger'>(() => {
  const ratio = props.totals.memoryRatio
  if (ratio === null) return 'ok'
  if (ratio >= 0.95) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
})

const memoryText = computed(() => {
  if (props.totals.memoryQuotaBytes <= 0) return t('monitor.overview.memoryUnbounded')
  return `${formatBytes(props.totals.memoryCurrentBytes)} / ${formatBytes(props.totals.memoryQuotaBytes)}`
})

const memoryRatioText = computed(() =>
  props.totals.memoryRatio === null ? '—' : formatRatio(props.totals.memoryRatio),
)

const memoryScale = computed(() => {
  const ratio = props.totals.memoryRatio
  if (ratio === null) return 0
  return Math.min(1, Math.max(0, ratio))
})

const consumersTotal = computed(() =>
  props.consumers.reduce((sum, consumer) => sum + consumer.bytes, 0),
)

/** 排行条刻度用平台合计（不是排行内部之和），与右侧百分比同一分母 */
const consumerBase = computed(() =>
  props.totals.memoryCurrentBytes > 0 ? props.totals.memoryCurrentBytes : consumersTotal.value,
)
</script>

<template>
  <section class="mn-overview" data-testid="monitor-overview">
    <div class="mn-overview-grid">
      <div class="mn-overview-card is-wide" data-testid="monitor-overview-memory">
        <span class="mn-overview-label">{{ t('monitor.overview.memory') }}</span>
        <span class="mn-overview-value">{{ formatBytes(props.totals.memoryCurrentBytes) }}</span>
        <span class="mn-overview-note" data-testid="monitor-overview-memory-note">
          {{ memoryText }}
        </span>
        <div class="mn-overview-gauge" aria-hidden="true">
          <div
            class="mn-overview-gauge-fill"
            :class="`is-${memoryTone}`"
            :style="{ transform: `scaleX(${memoryScale})` }"
          ></div>
        </div>
        <span
          class="mn-overview-ratio"
          :class="`is-${memoryTone}`"
          data-testid="monitor-overview-memory-ratio"
        >
          {{ memoryRatioText }}
        </span>
      </div>

      <div class="mn-overview-card" data-testid="monitor-overview-peak">
        <span class="mn-overview-label">{{ t('monitor.overview.peak') }}</span>
        <span class="mn-overview-value">{{ formatBytes(props.totals.memoryPeakBytes) }}</span>
        <span class="mn-overview-note">
          {{ t('monitor.overview.plugins', { n: props.totals.pluginCount }) }}
        </span>
      </div>

      <div class="mn-overview-card" data-testid="monitor-overview-compute">
        <span class="mn-overview-label">{{ t('monitor.overview.compute') }}</span>
        <span class="mn-overview-value">
          {{ formatRate(props.totals.fuelPerSecond) }}
          <span v-if="props.totals.fuelPerSecond !== null" class="mn-overview-unit">
            {{ t('monitor.overview.perSecond') }}
          </span>
        </span>
        <span class="mn-overview-note">{{ t('monitor.overview.computeHint') }}</span>
      </div>

      <div class="mn-overview-card" data-testid="monitor-overview-calls">
        <span class="mn-overview-label">{{ t('monitor.overview.callsRate') }}</span>
        <span class="mn-overview-value">
          {{ formatRate(props.totals.callsPerSecond) }}
          <span v-if="props.totals.callsPerSecond !== null" class="mn-overview-unit">
            {{ t('monitor.overview.perSecond') }}
          </span>
        </span>
        <span class="mn-overview-note">
          {{ t('monitor.overview.callsNote', { n: formatCompact(props.totals.callsTotal) }) }}
        </span>
      </div>
    </div>

    <div
      v-if="props.consumers.length > 0"
      class="mn-consumers"
      data-testid="monitor-overview-consumers"
    >
      <span class="mn-consumers-title">{{ t('monitor.overview.consumers') }}</span>
      <ol class="mn-consumer-list">
        <li v-for="consumer in props.consumers" :key="consumer.id" class="mn-consumer-row">
          <span class="mn-consumer-name" :title="consumer.id">{{ consumer.name }}</span>
          <span class="mn-consumer-value">{{ formatBytes(consumer.bytes) }}</span>
          <span class="mn-consumer-share">
            {{ consumer.share === null ? '—' : formatRatio(consumer.share) }}
          </span>
          <span class="mn-consumer-bar" aria-hidden="true">
            <span
              class="mn-consumer-bar-fill"
              :style="{
                transform: `scaleX(${consumerBase > 0 ? Math.min(1, consumer.bytes / consumerBase) : 0})`,
              }"
            ></span>
          </span>
        </li>
      </ol>
    </div>

    <p class="mn-overview-gap" data-testid="monitor-overview-host-gap">
      {{ t('monitor.overview.hostGap') }}
    </p>
  </section>
</template>
