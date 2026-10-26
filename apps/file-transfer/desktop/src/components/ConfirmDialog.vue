<script setup lang="ts">
/**
 * ConfirmDialog — 挂载包自持的通用两步确认框
 *
 * 旧宿主全局弹窗（context.ui.showDialog）退役后，破坏性操作的二次确认
 * 由应用自带遮罩/卡片渲染；遮罩点击等同取消（撤销中禁用）。
 */
defineProps<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="ft-confirm-overlay" @click.self="!busy && emit('cancel')">
      <div class="ft-confirm-sheet" role="dialog" aria-modal="true">
        <div class="ft-confirm-head">
          <span class="ft-dialog-title">{{ title }}</span>
        </div>
        <p class="ft-confirm-body">{{ message }}</p>
        <div class="ft-dialog-actions">
          <button class="ft-btn" :disabled="busy" @click="emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button
            class="ft-btn"
            :class="danger ? 'ft-confirm-danger' : 'ft-btn--primary'"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ft-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
}

.ft-confirm-sheet {
  width: min(440px, calc(100vw - 48px));
  border-radius: 12px;
  background: var(--bg-elevated, var(--bg-card, #1c1a16));
  padding: 20px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}

.ft-confirm-body {
  margin: 14px 0 20px;
  color: var(--text-primary);
  font-size: var(--font-size-label);
  line-height: 1.6;
}

.ft-confirm-danger {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: #fff;
}

.ft-confirm-danger:hover {
  background: var(--color-danger);
  border-color: var(--color-danger);
  opacity: 0.9;
}
</style>
