<script setup lang="ts">
import { computed } from 'vue'
import AgentIcon from '@/agents/components/AgentIcon.vue'
import { agentChips, agentDisplay } from '@/utils/orchestrationAgent'
import type { AgentProfileView } from '@/composables/orchestration/types'
import StatusBadge from './StatusBadge.vue'
import { useAppI18n } from '@/composables/useAppI18n'
import type { ActionView, NodeView } from '@/composables/orchestration/types'
import { statusTone } from '@/composables/orchestration/types'
import { toneBarClass, toneTextClass } from '@/utils/orchestrationTone'

const props = defineProps<{
  node: NodeView
  agentProfiles?: AgentProfileView[]
  actions: ActionView[]
  selected?: boolean
}>()
const emit = defineEmits<{
  select: [key: string]
  retry: [key: string]
  skip: [key: string]
  openTerminal: [runId: string]
}>()
const t = useAppI18n()
const display = computed(() => agentDisplay(props.node, props.agentProfiles ?? []))

const retryAction = computed(() => props.actions.find((action) => action.kind === 'retry-node'))
const skipAction = computed(() => props.actions.find((action) => action.kind === 'skip-node'))

const acceptanceText = computed(() => {
  const acceptance = props.node.acceptance
  if (acceptance.type === 'command') return acceptance.command.join(' ')
  if (acceptance.type === 'verdict') return t('orchestration.planEditor.acceptanceVerdict')
  return t('orchestration.planEditor.acceptanceNone')
})

function actionTitle(action: ActionView | undefined, key: string): string {
  if (!action) return t(key)
  if (action.reason) return t(`orchestration.reason.${action.reason}`)
  return t(key)
}
</script>

<template>
  <div
    class="relative cursor-pointer overflow-hidden rounded-card border bg-[var(--bg-card)] p-3 pl-4 transition-[border-color,box-shadow] duration-200 hover:shadow-card-hover"
    :class="
      selected
        ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)] ring-offset-1 ring-offset-[var(--bg-page)]'
        : 'border-[var(--border)]'
    "
    data-testid="orchestration-plan-node"
    :data-node-key="node.key"
    :data-status="node.status"
    @click="emit('select', node.key)"
  >
    <!-- 左侧状态条：列表里快速扫节点健康度（颜色只做辅助，状态文字仍是主信息） -->
    <span
      class="absolute inset-y-0 left-0 w-0.5"
      :class="toneBarClass[statusTone(node.status)]"
      aria-hidden="true"
    ></span>

    <div class="flex flex-wrap items-center gap-2">
      <span
        class="wb-mono rounded-tag border border-[var(--border)] bg-[var(--bg-page)] px-1.5 py-0.5 text-[calc(10px*var(--ui-scale))] text-[var(--text-tertiary)]"
        >{{ node.key }}</span
      >
      <span
        class="min-w-0 truncate text-[calc(12.5px*var(--ui-scale))] font-medium text-[var(--text-primary)]"
        >{{ node.title }}</span
      >
      <span data-testid="orchestration-node-status">
        <StatusBadge :status="node.status" kind="node" />
      </span>
      <span class="wb-mono ml-auto text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
        {{
          t('orchestration.detail.nodeAttempt', { attempt: node.attempt, max: node.maxAttempts })
        }}
      </span>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-3 text-[calc(11px*var(--ui-scale))]">
      <span data-testid="orchestration-node-agent" class="min-w-0">
        <span class="inline-flex min-w-0 items-center gap-1 text-[var(--text-primary)]">
          <AgentIcon :adapter="display.cli" :size="13" />
          <span class="truncate font-medium">{{ display.name }}</span>
          <span class="wb-mono text-[var(--text-tertiary)]">{{
            agentChips(display).join(' · ')
          }}</span>
        </span>
      </span>
      <span class="wb-mono text-[var(--text-secondary)]" data-testid="orchestration-node-role">{{
        t(`orchestration.role.${node.role}`)
      }}</span>
      <span
        v-if="node.dependsOn.length"
        class="wb-mono inline-flex items-center gap-1 text-[var(--text-tertiary)]"
      >
        <svg
          class="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M3 12h18m0 0l-6-6m6 6l-6 6"
          />
        </svg>
        {{ node.dependsOn.join(', ') }}
      </span>
    </div>

    <p
      v-if="node.matchReason"
      class="mt-1.5 text-[calc(11px*var(--ui-scale))] leading-relaxed text-[var(--text-tertiary)]"
      data-testid="orchestration-node-match-reason"
    >
      <span class="font-medium text-[var(--text-secondary)]"
        >{{ t('orchestration.detail.matchReason') }}:</span
      >
      {{ node.matchReason }}
    </p>

    <dl class="mt-2 grid gap-x-6 gap-y-1 text-[calc(11px*var(--ui-scale))] md:grid-cols-2">
      <div class="flex min-w-0 gap-1.5">
        <dt class="shrink-0 text-[var(--text-tertiary)]">{{ t('orchestration.detail.scope') }}</dt>
        <dd class="wb-mono min-w-0 truncate text-[var(--text-secondary)]">
          {{
            node.writeScope.length ? node.writeScope.join(', ') : t('orchestration.detail.readOnly')
          }}
        </dd>
      </div>
      <div class="flex min-w-0 gap-1.5">
        <dt class="shrink-0 text-[var(--text-tertiary)]">
          {{ t('orchestration.detail.acceptance') }}
        </dt>
        <dd class="wb-mono min-w-0 truncate text-[var(--text-secondary)]">{{ acceptanceText }}</dd>
      </div>
      <div v-if="node.failureReason" class="flex min-w-0 gap-1.5 md:col-span-2">
        <dt class="shrink-0 text-[var(--text-tertiary)]">
          {{ t('orchestration.detail.failure') }}
        </dt>
        <dd class="min-w-0" :class="toneTextClass[statusTone('failed')]">
          {{ t(`orchestration.reason.${node.failureReason}`) }}
        </dd>
      </div>
    </dl>

    <div class="mt-2.5 flex flex-wrap items-center gap-2">
      <button
        v-if="retryAction"
        class="wb-btn-ghost"
        :disabled="!retryAction.enabled"
        :title="actionTitle(retryAction, 'orchestration.detail.retry')"
        data-testid="orchestration-node-retry"
        @click.stop="emit('retry', node.key)"
      >
        {{ t('orchestration.detail.retry') }}
      </button>
      <button
        v-if="skipAction"
        class="wb-btn-ghost"
        :disabled="!skipAction.enabled"
        :title="actionTitle(skipAction, 'orchestration.detail.skip')"
        data-testid="orchestration-node-skip"
        @click.stop="emit('skip', node.key)"
      >
        {{ t('orchestration.detail.skip') }}
      </button>
      <button
        v-if="node.runId"
        class="wb-btn-ghost"
        data-testid="orchestration-open-terminal"
        @click.stop="emit('openTerminal', node.runId)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M8 9l3 3-3 3m5 0h3M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z"
          />
        </svg>
        {{ t('orchestration.detail.openTerminal') }}
      </button>
    </div>
  </div>
</template>
