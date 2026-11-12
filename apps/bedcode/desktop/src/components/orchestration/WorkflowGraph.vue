<script setup lang="ts">
import { computed } from 'vue'
import AgentIcon from '@/agents/components/AgentIcon.vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { NodeView } from '@/composables/orchestration/types'
import { statusTone } from '@/composables/orchestration/types'
import { toneDotClass, toneNodeClass } from '@/utils/orchestrationTone'
import type { Plan } from '@/utils/orchestrationPlan'
import { layoutWorkflow } from '@/utils/workflowLayout'
import { agentDisplay } from '@/utils/orchestrationAgent'
import type { AgentProfileView } from '@/composables/orchestration/types'

const props = defineProps<{
  plan: Plan | null
  nodes: NodeView[]
  agentProfiles?: AgentProfileView[]
  selectedKey?: string
}>()
const emit = defineEmits<{ select: [key: string] }>()
const t = useAppI18n()

const layout = computed(() => layoutWorkflow(props.plan))
const nodesByKey = computed(() => new Map(props.nodes.map((node) => [node.key, node])))

const LEGEND_STATES = ['pending', 'running', 'succeeded', 'failed'] as const

function statusOf(key: string): string {
  return nodesByKey.value.get(key)?.status ?? 'pending'
}

function toneClass(key: string): string {
  return toneNodeClass[statusTone(statusOf(key))]
}

function statusLabel(status: string): string {
  const key = `orchestration.nodeStatus.${status}`
  const text = t(key)
  return text === key ? status : text
}

function displayOf(key: string) {
  const node = nodesByKey.value.get(key)
  return node
    ? agentDisplay(node, props.agentProfiles ?? [])
    : { key, cli: 'unknown', name: key, model: null, thinkingLevel: null }
}

function roleLabel(role: string): string {
  const key = `orchestration.role.${role}`
  const text = t(key)
  return text === key ? role : text
}

function edgeActive(from: string, to: string): boolean {
  return !!props.selectedKey && (from === props.selectedKey || to === props.selectedKey)
}
</script>

<template>
  <div
    class="overflow-hidden rounded-card border border-[var(--border)] bg-[var(--bg-card)]"
    data-testid="orchestration-workflow"
  >
    <div
      v-if="layout.nodes.length === 0"
      class="flex min-h-40 items-center justify-center p-6 text-xs text-[var(--text-tertiary)]"
    >
      {{ t('orchestration.detail.noPlan') }}
    </div>
    <template v-else>
      <div class="workflow-canvas overflow-auto">
        <div class="relative" :style="{ width: layout.width + 'px', height: layout.height + 'px' }">
          <svg
            class="pointer-events-none absolute inset-0"
            :width="layout.width"
            :height="layout.height"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="orch-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="var(--border-strong)" />
              </marker>
              <marker
                id="orch-arrow-active"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="var(--color-primary)" />
              </marker>
            </defs>
            <path
              v-for="edge in layout.edges"
              :key="`${edge.from}->${edge.to}`"
              :d="edge.path"
              fill="none"
              :stroke="
                edgeActive(edge.from, edge.to) ? 'var(--color-primary)' : 'var(--border-strong)'
              "
              :stroke-width="edgeActive(edge.from, edge.to) ? 2 : 1.5"
              :marker-end="
                edgeActive(edge.from, edge.to) ? 'url(#orch-arrow-active)' : 'url(#orch-arrow)'
              "
              :opacity="edgeActive(edge.from, edge.to) ? 1 : 0.75"
              data-testid="orchestration-workflow-edge"
            />
          </svg>
          <button
            v-for="position in layout.nodes"
            :key="position.key"
            type="button"
            class="absolute flex flex-col justify-center gap-1 rounded-btn border px-3 text-left transition-[border-color,background-color,box-shadow] duration-200 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            :class="[
              toneClass(position.key),
              selectedKey === position.key
                ? 'ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--bg-card)]'
                : '',
            ]"
            :style="{
              left: position.x + 'px',
              top: position.y + 'px',
              width: position.width + 'px',
              height: position.height + 'px',
            }"
            :title="`${nodesByKey.get(position.key)?.title ?? position.key} · ${statusLabel(
              statusOf(position.key),
            )}`"
            :aria-pressed="selectedKey === position.key"
            data-testid="orchestration-workflow-node"
            :data-node-key="position.key"
            :data-status="statusOf(position.key)"
            @click="emit('select', position.key)"
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <AgentIcon :adapter="displayOf(position.key).cli" :size="14" />
              <span class="truncate text-[calc(12px*var(--ui-scale))] font-medium">{{
                nodesByKey.get(position.key)?.title ?? position.key
              }}</span>
            </span>
            <span
              class="wb-mono flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >
              <span class="truncate">
                {{ displayOf(position.key).name }} ·
                {{ roleLabel(nodesByKey.get(position.key)?.role ?? '') }} ·
                {{ statusLabel(statusOf(position.key)) }}
              </span>
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                :class="toneDotClass[statusTone(statusOf(position.key))]"
                aria-hidden="true"
              ></span>
            </span>
          </button>
        </div>
      </div>
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-2 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >
        <span class="wb-mono">{{ t('orchestration.detail.legend') }}</span>
        <span v-for="state in LEGEND_STATES" :key="state" class="inline-flex items-center gap-1">
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="toneDotClass[statusTone(state)]"
            aria-hidden="true"
          ></span>
          {{ statusLabel(state) }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 点阵画布：给绝对定位节点一个可感知的坐标背景，同时不引入位图资源 */
.workflow-canvas {
  background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0);
  background-size: 16px 16px;
}
</style>
