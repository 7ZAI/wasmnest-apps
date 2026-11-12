<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import { statusTone } from '@/composables/orchestration/types'
import { toneBadgeClass, toneDotClass } from '@/utils/orchestrationTone'

const props = withDefaults(
  defineProps<{
    status: string
    kind?: 'orchestration' | 'node'
    testid?: string
  }>(),
  { kind: 'orchestration', testid: '' },
)

const t = useAppI18n()
const tone = computed(() => statusTone(props.status))
const label = computed(() =>
  t(
    props.kind === 'node'
      ? `orchestration.nodeStatus.${props.status}`
      : `orchestration.status.${props.status}`,
  ),
)
</script>

<template>
  <span
    class="wb-mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-tag border px-1.5 py-0.5 text-[calc(11px*var(--ui-scale))] leading-tight"
    :class="toneBadgeClass[tone]"
    :data-status="status"
    :data-testid="testid || undefined"
  >
    <span
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="[toneDotClass[tone], tone === 'active' ? 'animate-pulse' : '']"
      aria-hidden="true"
    ></span>
    {{ label }}
  </span>
</template>
