<template>
  <Transition name="confirm-fade" appear>
    <div
      class="absolute inset-0 z-[60] flex items-center justify-center p-6"
      data-testid="confirm-dialog"
    >
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @mousedown="$emit('cancel')" />

      <div
        ref="cardEl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        class="relative w-full max-w-xs rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)]"
      >
        <h4
          id="confirm-dialog-title"
          class="mb-2 text-[length:var(--font-size-base)] font-medium text-[var(--text-primary)]"
        >
          {{ title }}
        </h4>
        <p
          class="mb-5 text-[length:var(--font-size-sm)] leading-relaxed break-words text-[var(--text-secondary)]"
        >
          {{ body }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="h-8 rounded-[var(--radius-button)] bg-[var(--bg-hover)] px-4 text-[length:var(--font-size-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
            data-testid="confirm-cancel"
            @click="$emit('cancel')"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="h-8 rounded-[var(--radius-button)] bg-[var(--color-danger-ink)] px-4 text-[length:var(--font-size-sm)] text-[var(--color-primary-contrast)] transition-opacity hover:opacity-90"
            data-testid="confirm-ok"
            @click="$emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useModalFocus } from '../composables/useModalFocus'

defineProps<{
  title: string
  body: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const cardEl = ref<HTMLElement | null>(null)
useModalFocus(cardEl, () => emit('cancel'))
</script>

<style scoped>
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.2s;
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
