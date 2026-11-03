<template>
  <div class="number-field">
    <button
      type="button"
      class="number-step"
      :aria-label="t('decrease')"
      :title="t('decrease')"
      :disabled="disabled || modelValue <= min"
      @click="stepBy(-1)"
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-width="2" d="M5 12h14" />
      </svg>
    </button>
    <input
      ref="inputEl"
      type="text"
      inputmode="numeric"
      class="number-input"
      :value="draft"
      :disabled="disabled"
      :aria-label="label"
      :data-testid="testid"
      @input="onInput"
      @blur="commit"
      @keydown.up.prevent="stepBy(1)"
      @keydown.down.prevent="stepBy(-1)"
    />
    <button
      type="button"
      class="number-step"
      :aria-label="t('increase')"
      :title="t('increase')"
      :disabled="disabled || modelValue >= max"
      @click="stepBy(1)"
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-width="2" d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/** 数字输入 + 显式步进按钮（替代 input[type=number] 的系统步进器） */
import { ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  label?: string
  testid?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const { t } = useI18n()
const inputEl = ref<HTMLInputElement | null>(null)
const draft = ref(String(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    if (inputEl.value !== document.activeElement) draft.value = String(value)
  },
)

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.replace(/[^\d]/g, '')
  draft.value = raw
  if (raw === '') return
  const value = Number(raw)
  if (Number.isFinite(value)) emit('update:modelValue', value)
}

function commit(): void {
  const value = Number(draft.value)
  const next = clamp(Number.isFinite(value) ? Math.round(value) : props.modelValue)
  draft.value = String(next)
  emit('update:modelValue', next)
}

function stepBy(delta: number): void {
  const next = clamp(props.modelValue + delta * (props.step ?? 1))
  draft.value = String(next)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.number-field {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.number-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  flex-shrink: 0;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-input);
  color: var(--text-secondary);
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}
.number-step svg {
  width: 14px;
  height: 14px;
}
.number-step:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.number-step:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.number-input {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  text-align: center;
  outline: none;
}
.number-input:focus {
  border-color: var(--color-primary);
}
</style>
