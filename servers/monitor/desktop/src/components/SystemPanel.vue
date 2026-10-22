<script setup lang="ts">
/**
 * 非插件维度指标段（桌面）：`task` 段按已知键翻译，其余段按原始键名展示。
 *
 * 段缺失 = 该维度未注册（不是 0），组件不伪造。
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

function entriesOf(
  section: SystemSection,
): Array<{ key: string; label: string; value: string; warning: boolean }> {
  if (section.id === 'task') {
    return TASK_KEYS.map((key) => {
      const value = section.data[key] as number | undefined
      return {
        key,
        label: t(`monitor.task.${key}`),
        value: formatNumber(value),
        warning:
          (key === 'jobsRejectedTotal' || key === 'eventsDroppedTotal') &&
          typeof value === 'number' &&
          value > 0,
      }
    })
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
    warning: false,
  }))
}
</script>

<template>
  <div class="mn-system" data-ui>
    <section
      v-for="section in props.sections"
      :key="section.id"
      class="mn-system-section"
      :data-testid="`monitor-system-${section.id}`"
    >
      <h3 v-if="props.sections.length > 1 || section.id !== 'task'" class="mn-system-title">
        {{ titleOf(section) }}
      </h3>
      <dl class="mn-system-grid">
        <div v-for="entry in entriesOf(section)" :key="entry.key" class="mn-system-item">
          <dd class="mn-system-value" :class="{ 'is-warning': entry.warning }">
            {{ entry.value }}
          </dd>
          <dt class="mn-system-label">{{ entry.label }}</dt>
        </div>
      </dl>
    </section>
  </div>
</template>
