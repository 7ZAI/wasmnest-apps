<script setup lang="ts">
import { computed } from 'vue'
import AgentBadge from './AgentBadge.vue'
import type { NodeView } from '@/composables/orchestration/types'
import type { AgentProfileView } from '@/composables/orchestration/types'
import { agentDisplay } from '@/utils/orchestrationAgent'
import { useAppI18n } from '@/composables/useAppI18n'

const props = defineProps<{
  nodes: NodeView[]
  agentProfiles?: AgentProfileView[]
  selectedAgent?: string
}>()
const emit = defineEmits<{ select: [agentId: string] }>()
const t = useAppI18n()

interface Participant {
  agentId: string
  cli: string
  displayName: string
  total: number
  succeeded: number
  active: number
  failed: number
}

const participants = computed<Participant[]>(() => {
  const order: string[] = []
  const byAgent = new Map<string, Participant>()
  for (const node of props.nodes) {
    const display = agentDisplay(node, props.agentProfiles ?? [])
    let entry = byAgent.get(display.key)
    if (!entry) {
      entry = {
        agentId: display.key,
        cli: display.cli,
        displayName: display.name,
        total: 0,
        succeeded: 0,
        active: 0,
        failed: 0,
      }
      byAgent.set(display.key, entry)
      order.push(display.key)
    }
    entry.total += 1
    if (node.status === 'succeeded') entry.succeeded += 1
    if (node.status === 'failed') entry.failed += 1
    if (['dispatching', 'running', 'awaiting-input', 'verifying'].includes(node.status)) {
      entry.active += 1
    }
  }
  return order.map((id) => byAgent.get(id)!).filter(Boolean)
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="orchestration-participants">
    <button
      v-for="participant in participants"
      :key="participant.agentId"
      type="button"
      class="flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      :class="
        selectedAgent === participant.agentId
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
          : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
      "
      :aria-pressed="selectedAgent === participant.agentId"
      data-testid="orchestration-participant"
      :data-agent="participant.agentId"
      @click="emit('select', participant.agentId)"
    >
      <span data-testid="orchestration-participant-agent">
        <AgentBadge :cli="participant.cli" :name="participant.displayName" :size="14" />
      </span>
      <span
        class="wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)]"
        data-testid="orchestration-participant-count"
      >
        {{ participant.succeeded }}/{{ participant.total }}
      </span>
      <span
        v-if="participant.active"
        class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--color-info-ink)]"
      >
        {{ t('orchestration.detail.participantActive', { n: participant.active }) }}
      </span>
      <span
        v-if="participant.failed"
        class="wb-mono text-[calc(10px*var(--ui-scale))] text-[var(--color-danger-ink)]"
      >
        {{ t('orchestration.detail.participantFailed', { n: participant.failed }) }}
      </span>
    </button>
    <span v-if="participants.length === 0" class="text-xs text-[var(--text-tertiary)]">—</span>
  </div>
</template>
