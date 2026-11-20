<script setup lang="ts">
/**
 * 工具调用卡片流（票 13 / spec §5.7）
 *
 * 渲染会话的工具调用卡片：工具名、目标应用、参数摘要、风险标记、状态；
 * write / danger 的确认卡（批准 / 拒绝，danger 第二次展示影响范围）。
 * 纯展示组件：状态由会话的 toolCards 驱动，决定经 emit 回会话。
 */
import type { ConfirmationDecision, ToolCardState } from '../tools/types'
import { riskLabelKey } from '../tools/risk'

const props = defineProps<{
  cards: ToolCardState[]
  t: (key: string, params?: Record<string, unknown>) => string
}>()

const emit = defineEmits<{
  (e: 'confirm', id: string, decision: ConfirmationDecision): void
}>()

function stateLabel(card: ToolCardState): string {
  const map: Record<ToolCardState['state'], string> = {
    running: props.t('assistant.tool.running'),
    awaiting: props.t('assistant.tool.awaiting'),
    done: props.t('assistant.tool.done'),
    error: props.t('assistant.tool.error'),
    rejected: props.t('assistant.tool.rejected'),
    stopped: props.t('assistant.tool.stopped'),
  }
  return map[card.state]
}
</script>

<template>
  <div v-if="cards.length > 0" class="nest-tools" data-testid="nest-tool-cards">
    <div
      v-for="card in cards"
      :key="card.id"
      class="nest-tool"
      :class="`nest-tool--${card.state}`"
      data-testid="nest-tool-card"
    >
      <div class="nest-tool__head">
        <span class="nest-tool__name" data-testid="nest-tool-name">{{ card.label }}</span>
        <span v-if="card.appId" class="nest-tool__app">{{ card.appId }}</span>
        <span class="nest-tool__risk" :data-risk="card.risk">{{ t(riskLabelKey(card.risk)) }}</span>
        <span class="nest-tool__state">{{ stateLabel(card) }}</span>
      </div>

      <div v-if="card.argsSummary" class="nest-tool__args">
        <span class="nest-tool__label">{{ t('assistant.tool.args') }}</span>
        <code>{{ card.argsSummary }}</code>
      </div>

      <!-- 确认卡：write 一轮 / danger 两轮（第二次展示影响范围） -->
      <div v-if="card.state === 'awaiting' && card.confirmation" class="nest-tool__confirm">
        <p class="nest-tool__confirm-text">
          {{
            card.confirmation.stage === 2
              ? t('assistant.tool.confirmAgain')
              : t('assistant.tool.confirmPrompt', { label: card.label })
          }}
        </p>
        <p v-if="card.confirmation.impact" class="nest-tool__impact">
          {{ t('assistant.tool.impact') }}：{{ card.confirmation.impact }}
        </p>
        <div class="nest-tool__confirm-actions">
          <button
            type="button"
            class="nest-tool__btn nest-tool__btn--approve"
            data-testid="nest-tool-approve"
            @click="emit('confirm', card.id, 'approve')"
          >
            {{ t('assistant.tool.confirm') }}
          </button>
          <button
            type="button"
            class="nest-tool__btn nest-tool__btn--reject"
            data-testid="nest-tool-reject"
            @click="emit('confirm', card.id, 'reject')"
          >
            {{ t('assistant.tool.reject') }}
          </button>
        </div>
      </div>

      <p v-if="card.resultSummary && card.state === 'done'" class="nest-tool__result">
        <span class="nest-tool__label">{{ t('assistant.tool.result') }}</span>
        <code>{{ card.resultSummary }}</code>
      </p>
      <p v-if="card.errorMessage" class="nest-tool__error">{{ card.errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.nest-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
}

.nest-tool {
  border: 1px solid var(--nest-border);
  border-radius: 10px;
  background: var(--nest-surface-2);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--nest-text);
}

.nest-tool--awaiting {
  border-color: var(--nest-accent);
}

.nest-tool--error,
.nest-tool--rejected {
  border-color: #b91c1c;
}

.nest-tool--stopped {
  border-style: dashed;
}

.nest-tool__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nest-tool__name {
  font-weight: 600;
}

.nest-tool__app {
  color: var(--nest-muted);
}

.nest-tool__risk {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--nest-border);
  color: var(--nest-muted);
}

.nest-tool__risk[data-risk='write'] {
  border-color: #d97706;
  color: #fbbf24;
}

.nest-tool__risk[data-risk='danger'] {
  border-color: #b91c1c;
  color: #fca5a5;
}

.nest-tool__state {
  margin-left: auto;
  color: var(--nest-muted);
}

.nest-tool__args,
.nest-tool__result {
  margin: 6px 0 0;
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.nest-tool__label {
  color: var(--nest-muted);
  flex-shrink: 0;
}

.nest-tool__args code,
.nest-tool__result code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  word-break: break-all;
  color: var(--nest-muted);
}

.nest-tool__confirm {
  margin-top: 8px;
  padding: 8px;
  border-radius: 8px;
  background: var(--nest-surface);
}

.nest-tool__confirm-text {
  margin: 0;
  font-size: 12px;
}

.nest-tool__impact {
  margin: 6px 0 0;
  font-size: 12px;
  color: #fca5a5;
}

.nest-tool__confirm-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.nest-tool__btn {
  border-radius: 8px;
  padding: 5px 14px;
  cursor: pointer;
  font-size: 12px;
  border: 1px solid;
}

.nest-tool__btn--approve {
  border-color: var(--nest-accent);
  background: var(--nest-accent);
  color: var(--nest-surface);
}

.nest-tool__btn--reject {
  border-color: #b91c1c;
  background: transparent;
  color: #fca5a5;
}

.nest-tool__error {
  margin: 6px 0 0;
  color: #fca5a5;
  font-size: 12px;
}
</style>
