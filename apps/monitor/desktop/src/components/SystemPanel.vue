<script setup lang="ts">
/**
 * 非插件维度指标段（桌面）：`task` 段按已知键翻译，其余段按原始键名展示。
 *
 * 这些段由宿主 `MetricsRegistry::register_source` 注册（当前为 host-task 的
 * `task`）；段缺失 = 该维度未注册（不是 0），组件不伪造。
 */
import { inject } from 'vue'
import type { MonitorAppContext } from '../appContext'
import type { SystemSection } from '../types'
import { formatNumber } from '../utils/format'

const props = defineProps<{ sections: SystemSection[] }>()

const context = inject<MonitorAppContext>('pluginContext')!

const t = (key: string, params?: Record<string, unknown>): string => context.i18n.t(key, params)

const TASK_KEYS = [
  'jobsSubmittedTotal',
  'jobsActive',
  'jobsRejectedTotal',
  'unitsCompletedTotal',
  'concurrentUnitsPeak',
  'eventsDroppedTotal',
  'poolThreads',
] as const

function titleOf(section: SystemSection): string {
  return section.id === 'task' ? t('monitor.task.title') : section.id
}

function entriesOf(section: SystemSection): Array<{ key: string; label: string; value: string }> {
  if (section.id === 'task') {
    return TASK_KEYS.map((key) => ({
      key,
      label: t(`monitor.task.${key}`),
      value: formatNumber(section.data[key] as number | undefined),
    }))
  }
  return Object.entries(section.data).map(([key, value]) => ({
    key,
    label: key,
    value:
      typeof value === 'number'
        ? formatNumber(value)
        : typeof value === 'string'
          ? value
          : JSON.stringify(value),
  }))
}
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
    <section
      v-for="section in props.sections"
      :key="section.id"
      class="mn-card p-4 min-w-0"
      :data-testid="`monitor-system-${section.id}`"
    >
      <h3 class="text-[calc(12px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
        {{ titleOf(section) }}
      </h3>
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        <div v-for="entry in entriesOf(section)" :key="entry.key" class="min-w-0">
          <div class="mn-label truncate">{{ entry.label }}</div>
          <div
            class="mn-mono text-[calc(11.5px*var(--ui-scale))] text-[var(--text-primary)] truncate"
          >
            {{ entry.value }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
