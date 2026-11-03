<template>
  <Modal
    :model-value="modelValue"
    :title="t('project.run.pickAgent')"
    size="md"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="group-row-sub mb-3">{{ t('project.run.pickAgentHint') }}</p>

    <div v-if="loading" class="flex items-center justify-center gap-3 py-8">
      <span class="picker-spinner" aria-hidden="true"></span>
      <span class="group-row-sub">{{ t('project.loading') }}</span>
    </div>

    <div v-else-if="error" class="flex flex-col items-center gap-3 py-6 text-center">
      <p class="group-row-sub">{{ t(error) }}</p>
      <button type="button" class="picker-retry" @click="$emit('refresh')">
        {{ t('project.retry') }}
      </button>
    </div>

    <div v-else-if="agents.length === 0" class="py-6 text-center">
      <p class="group-row-sub">{{ t('project.run.noAgents') }}</p>
    </div>

    <div v-else class="space-y-2">
      <button
        v-for="agent in agents"
        :key="agent.id"
        type="button"
        class="agent-row w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors active:opacity-80"
        :class="{ 'agent-row--missing': agent.readiness === 'missing' }"
        :style="{ borderColor: 'var(--mobile-border)' }"
        :aria-disabled="agent.readiness === 'missing' || !!startingAgentId"
        :data-testid="`mobile-agent-${agent.id}`"
        @click="$emit('pick', agent)"
      >
        <span class="config-icon chip-cyan" aria-hidden="true">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.6"
              d="M9 3h6a2 2 0 012 2v2h1a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h1V5a2 2 0 012-2z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.6"
              d="M9 12h6M12 9v6"
            />
          </svg>
        </span>

        <div class="flex-1 min-w-0">
          <div class="group-row-title truncate">{{ agent.displayName }}</div>
          <div class="group-row-sub font-mono truncate mt-0.5">{{ agent.binary }}</div>
        </div>

        <span v-if="agent.readiness === 'missing'" class="status-badge badge-zinc shrink-0">
          {{ t('project.run.agentMissing') }}
        </span>
        <span v-else-if="agent.readiness === 'unknown'" class="status-badge badge-cyan shrink-0">
          {{ t('project.run.agentUnknown') }}
        </span>

        <span
          v-if="startingAgentId === agent.id"
          class="picker-spinner shrink-0"
          aria-hidden="true"
        ></span>
      </button>
    </div>

    <p v-if="hasMissing && !loading && !error" class="picker-note mt-3">
      {{ t('project.run.installOnDesktop') }}
    </p>
  </Modal>
</template>

<script setup lang="ts">
/**
 * Agent 选择器（新建运行）
 *
 * 就绪度来自桌面 `/api/agents`：`missing` 行保留在列表里（用户要知道缺什么），
 * 但整行降透明度并由父级在点击时给出「去桌面端安装」提示——不渲染灰按钮假装
 * 可启动，也不静默隐藏。`unknown` 允许尝试启动（探测没结论，不谎称未安装）。
 */
import { computed } from 'vue'
import { useHostPage } from '../../host/useHostPage'
import Modal from '../../host/components/ui/Modal.vue'
import type { AgentEntry } from '../types'

const props = defineProps<{
  modelValue: boolean
  agents: AgentEntry[]
  loading: boolean
  error: string
  startingAgentId: string | null
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
  pick: [agent: AgentEntry]
  refresh: []
}>()

const t = useHostPage().t

const hasMissing = computed(() => props.agents.some((agent) => agent.readiness === 'missing'))
</script>

<style scoped>
.agent-row--missing {
  opacity: 0.6;
}

.picker-spinner {
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  border: 2px solid var(--mobile-accent);
  border-top-color: transparent;
  animation: picker-spin 0.8s linear infinite;
}

@keyframes picker-spin {
  to {
    transform: rotate(360deg);
  }
}

.picker-retry {
  height: 2.5rem;
  padding: 0 1rem;
  border-radius: 0.75rem;
  font-size: var(--font-size-base);
  color: var(--mobile-accent);
  background: var(--mobile-accent-muted);
}

.picker-note {
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--mobile-text-disabled);
}

@media (prefers-reduced-motion: reduce) {
  .picker-spinner {
    animation: none;
  }
}
</style>
