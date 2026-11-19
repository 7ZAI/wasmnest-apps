<script setup lang="ts">
/**
 * 首次使用非人声明（票 11 / spec §2.1、§5.5）
 *
 * 进入对话后首次展示：明确 Nest 是系统助手、不是人，不替代真实关系与
 * 专业帮助。用户点「我知道了」后写设置标记（firstRun.noticeShown），
 * 不再弹出（重设数据 / 清库后按新用户对待，重新声明）。
 *
 * 纯展示组件：只吃 props 与 emit，状态由宿主页面（ChatView）持有，
 * 保持共享核端无关（D3）。
 */
defineProps<{
  title: string
  body: string
  dismissLabel: string
}>()

const emit = defineEmits<{
  (e: 'dismiss'): void
}>()

function onDismiss(): void {
  emit('dismiss')
}
</script>

<template>
  <div class="nest-notice" data-testid="nest-first-run-notice">
    <div class="nest-notice__head">
      <span class="nest-notice__icon" aria-hidden="true">🪺</span>
      <strong class="nest-notice__title">{{ title }}</strong>
    </div>
    <p class="nest-notice__body">{{ body }}</p>
    <div class="nest-notice__actions">
      <button
        type="button"
        class="nest-notice__dismiss"
        data-testid="nest-notice-dismiss"
        @click="onDismiss"
      >
        {{ dismissLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.nest-notice {
  margin: 12px 16px 0;
  padding: 12px 14px;
  border: 1px solid var(--nest-border, #3a4150);
  border-radius: 10px;
  background: var(--nest-surface-2, #2a2f3a);
  color: var(--nest-text, #e8eaf0);
}

.nest-notice__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nest-notice__icon {
  font-size: 16px;
}

.nest-notice__title {
  font-size: 14px;
}

.nest-notice__body {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--nest-muted, #aab0bb);
}

.nest-notice__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.nest-notice__dismiss {
  border: 1px solid var(--nest-accent, #4f7cff);
  background: transparent;
  color: var(--nest-accent, #4f7cff);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.nest-notice__dismiss:hover {
  background: var(--nest-accent, #4f7cff);
  color: var(--nest-surface, #232833);
}
</style>
