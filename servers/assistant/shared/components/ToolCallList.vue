<script setup lang="ts">
/**
 * 工具调用卡列表（共享组件，双端同构 · 票 13 / spec §5.7）
 *
 * 每张卡显示：工具名、目标应用、风险档、状态；`ui` 档显示「正在打开」，
 * 拒绝 / 失败 / 急停显示原因。卡片由会话运行时按 toolCallId 原地更新，
 * 本组件只渲染，不发命令。
 */
import type { ToolCallCard } from '@nest-shared/tools/types'

defineProps<{
  cards: ToolCallCard[]
  t: (key: string) => string
}>()
</script>

<template>
  <div v-if="cards.length > 0" class="nest-tools" data-testid="nest-tool-cards">
    <div
      v-for="card in cards"
      :key="card.toolCallId"
      class="nest-tool"
      :class="`nest-tool--${card.status}`"
      data-testid="nest-tool-card"
      :data-tool-id="card.toolId"
      :data-risk="card.risk"
      :data-status="card.status"
    >
      <div class="nest-tool__head">
        <span class="nest-tool__label">{{ card.label }}</span>
        <span class="nest-tool__risk" :class="`nest-tool__risk--${card.risk}`">
          {{ t(`assistant.tools.risk.${card.risk}`) }}
        </span>
        <span v-if="card.appId" class="nest-tool__app">{{ card.appId }}</span>
        <span class="nest-tool__status">
          <template v-if="card.status === 'running' && card.notice === 'opening'">
            {{ t('assistant.tools.card.opening') }}
          </template>
          <template v-else>{{ t(`assistant.tools.card.${card.status}`) }}</template>
        </span>
      </div>
      <p v-if="card.errorMessage" class="nest-tool__error">{{ card.errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.nest-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 16px 8px;
  max-height: 30vh;
  overflow-y: auto;
}

.nest-tool {
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--nest-surface-2, #2a2f3a);
  font-size: 12px;
}

.nest-tool--error,
.nest-tool--blocked {
  border-color: var(--nest-error, #c0392b);
}

.nest-tool__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nest-tool__label {
  font-weight: 600;
  color: var(--nest-text, #e8eaf0);
}

.nest-tool__risk {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  border: 1px solid var(--nest-border, #3a4150);
  color: var(--nest-muted, #8a8f98);
}

.nest-tool__risk--write {
  color: var(--nest-warn, #d8a657);
  border-color: var(--nest-warn, #d8a657);
}

.nest-tool__risk--danger {
  color: var(--nest-error-text, #f0b4ae);
  border-color: var(--nest-error, #c0392b);
}

.nest-tool__app {
  color: var(--nest-muted, #8a8f98);
  font-family: ui-monospace, monospace;
}

.nest-tool__status {
  margin-left: auto;
  color: var(--nest-muted, #8a8f98);
}

.nest-tool--ok .nest-tool__status {
  color: var(--nest-ok, #6fbf73);
}

.nest-tool--error .nest-tool__status,
.nest-tool--blocked .nest-tool__status {
  color: var(--nest-error-text, #f0b4ae);
}

.nest-tool__error {
  margin: 6px 0 0;
  color: var(--nest-error-text, #f0b4ae);
  line-height: 1.5;
}
</style>
