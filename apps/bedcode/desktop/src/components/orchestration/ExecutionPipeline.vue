<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type {
  EventView,
  NodeView,
  OrchestrationStatusColor,
} from '@/composables/orchestration/types'
import { statusTone } from '@/composables/orchestration/types'
import { toneBarClass, toneTextClass } from '@/utils/orchestrationTone'
import { pipelineLanes } from '@/utils/pipelineLanes'
import { agentDisplay } from '@/utils/orchestrationAgent'
import type { AgentProfileView } from '@/composables/orchestration/types'

const props = defineProps<{
  nodes: NodeView[]
  events: EventView[]
  agentProfiles?: AgentProfileView[]
  startedAt: string | null
  now: number
  selectedKey?: string
}>()
const emit = defineEmits<{ select: [key: string] }>()
const t = useAppI18n()

const layout = computed(() =>
  pipelineLanes(
    props.nodes.map((node) => ({
      key: node.key,
      title: node.title,
      status: node.status,
      attempt: node.attempt,
      dispatchedAt: node.dispatchedAt,
      startedAt: node.startedAt,
      endedAt: node.endedAt,
    })),
    props.events,
    props.startedAt,
    props.now,
  ),
)

const nodeByKey = computed(() => new Map(props.nodes.map((node) => [node.key, node])))

/**
 * pending / blocked 且从未派发的节点不画「假进度条」：
 * pipelineLanes 会按创建时刻兜底出一段 `ready` 区间，铺满整条轨道会让人误以为
 * 节点已经在跑。未开始的节点只保留空轨道 + 灰色结果文字。
 */
function segmentsFor(lane: {
  nodeKey: string
  segments: { stage: string; startMs: number; endMs: number }[]
}) {
  const node = nodeByKey.value.get(lane.nodeKey)
  const neverStarted =
    !!node && ['pending', 'blocked'].includes(node.status) && !node.dispatchedAt && !node.startedAt
  return neverStarted ? [] : lane.segments
}

const STAGE_TONE: Record<string, OrchestrationStatusColor> = {
  ready: 'info',
  dispatching: 'active',
  running: 'active',
  'awaiting-input': 'warn',
  verifying: 'info',
}

function agentNameOf(nodeKey: string): string {
  const node = nodeByKey.value.get(nodeKey)
  return node ? agentDisplay(node, props.agentProfiles ?? []).name : ''
}

function stageClass(stage: string): string {
  return toneBarClass[STAGE_TONE[stage] ?? 'neutral']
}

function stageLabel(stage: string): string {
  const key = `orchestration.nodeStatus.${stage}`
  const text = t(key)
  return text === key ? stage : text
}

function statusLabel(status: string): string {
  const key = `orchestration.nodeStatus.${status}`
  const text = t(key)
  return text === key ? status : text
}

function resultClass(result: string | null, status: string): string {
  return toneTextClass[statusTone(result ?? status)]
}

function segmentStyle(startMs: number, endMs: number) {
  const duration = Math.max(1, layout.value.durationMs)
  return {
    left: ((startMs - layout.value.startMs) / duration) * 100 + '%',
    width: Math.max(0.4, ((endMs - startMs) / duration) * 100) + '%',
  }
}

const durationText = computed(() => {
  const seconds = layout.value.durationMs / 1000
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)
})
</script>

<template>
  <div
    class="overflow-hidden rounded-card border border-[var(--border)] bg-[var(--bg-card)]"
    data-testid="orchestration-pipeline"
  >
    <div
      v-if="layout.lanes.length === 0"
      class="flex min-h-40 items-center justify-center p-6 text-xs text-[var(--text-tertiary)]"
    >
      {{ t('orchestration.detail.noPlan') }}
    </div>
    <template v-else>
      <div class="space-y-1 p-2">
        <button
          v-for="lane in layout.lanes"
          :key="lane.nodeKey"
          type="button"
          class="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          :class="
            selectedKey === lane.nodeKey
              ? 'bg-[var(--color-primary-light)]'
              : 'hover:bg-[var(--bg-hover)]'
          "
          :aria-pressed="selectedKey === lane.nodeKey"
          data-testid="orchestration-pipeline-lane"
          :data-node-key="lane.nodeKey"
          :data-status="lane.status"
          @click="emit('select', lane.nodeKey)"
        >
          <span
            class="wb-mono w-32 shrink-0 truncate text-[calc(11px*var(--ui-scale))] text-[var(--text-primary)]"
            :title="`${agentNameOf(lane.nodeKey)} · ${lane.title}`"
            ><span class="text-[var(--text-tertiary)]">{{ agentNameOf(lane.nodeKey) }} · </span
            >{{ lane.title }}<span v-if="lane.attempt"> #{{ lane.attempt }}</span></span
          >
          <span class="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <span
              v-for="(segment, index) in segmentsFor(lane)"
              :key="index"
              class="absolute inset-y-0 rounded-full"
              :class="stageClass(segment.stage)"
              :style="segmentStyle(segment.startMs, segment.endMs)"
              :title="stageLabel(segment.stage)"
              data-testid="orchestration-pipeline-segment"
              :data-stage="segment.stage"
            ></span>
          </span>
          <span
            class="wb-mono w-16 shrink-0 text-right text-[calc(11px*var(--ui-scale))]"
            :class="resultClass(lane.result, lane.status)"
            data-testid="orchestration-pipeline-result"
            >{{ statusLabel(lane.result ?? lane.status) }}</span
          >
        </button>
      </div>
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >
        <span class="wb-mono">{{ t('orchestration.detail.pipeline') }}</span>
        <span class="wb-mono" data-testid="orchestration-pipeline-duration">
          {{ t('orchestration.pipeline.duration', { seconds: durationText }) }}
        </span>
      </div>
    </template>
  </div>
</template>
