<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { EventView } from '@/composables/orchestration/types'
import { eventTone, toneDotClass, toneTextClass } from '@/utils/orchestrationTone'

const props = defineProps<{ events: EventView[] }>()
const t = useAppI18n()

const ordered = computed(() => [...props.events].sort((a, b) => a.seq - b.seq))

const ACTIVE_EVENTS = new Set(['dispatched', 'node_running', 'awaiting_input', 'verifying'])

function label(kind: string): string {
  const key = `orchestration.event.${kind}`
  const text = t(key)
  return text === key ? kind : text
}

function time(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleTimeString()
}

function fullTime(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleString()
}
</script>

<template>
  <div
    class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] p-3"
    data-testid="orchestration-timeline"
  >
    <div
      v-if="ordered.length === 0"
      class="flex min-h-40 items-center justify-center text-xs text-[var(--text-tertiary)]"
    >
      {{ t('orchestration.timeline.empty') }}
    </div>
    <ol v-else class="max-h-72 overflow-auto pr-1">
      <li
        v-for="(event, index) in ordered"
        :key="event.seq"
        class="relative flex items-start gap-2.5 py-1.5"
        :data-event-kind="event.kind"
      >
        <!-- 时间线轨：圆点 + 连接线；颜色只表达事件语义，不承担正文对比度 -->
        <span class="relative flex w-3 shrink-0 justify-center self-stretch">
          <span
            v-if="index < ordered.length - 1"
            class="absolute bottom-[-6px] top-3 w-px bg-[var(--border)]"
            aria-hidden="true"
          ></span>
          <span
            class="relative mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-[var(--bg-card)]"
            :class="[
              toneDotClass[eventTone(event.kind)],
              ACTIVE_EVENTS.has(event.kind) ? 'animate-pulse' : '',
            ]"
            aria-hidden="true"
          ></span>
        </span>
        <span
          class="wb-mono w-16 shrink-0 pt-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
          :title="fullTime(event.at)"
          >{{ time(event.at) }}</span
        >
        <span
          class="min-w-0 flex-1 text-[calc(11px*var(--ui-scale))] leading-relaxed text-[var(--text-primary)]"
        >
          <span :class="toneTextClass[eventTone(event.kind)]">{{ label(event.kind) }}</span>
          <span v-if="event.nodeKey" class="wb-mono text-[var(--text-secondary)]">
            · {{ event.nodeKey }}<template v-if="event.attempt"> #{{ event.attempt }}</template>
          </span>
        </span>
      </li>
    </ol>
  </div>
</template>
