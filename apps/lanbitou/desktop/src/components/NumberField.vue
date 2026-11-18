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
      :inputmode="inputMode"
      autocomplete="off"
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
import { computed, ref, watch } from 'vue'
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

/** 步长（非法值回退 1；小数步长时允许输入小数点） */
const stepSize = computed(() => {
  const step = props.step ?? 1
  return Number.isFinite(step) && step > 0 ? step : 1
})
const allowDecimal = computed(() => stepSize.value < 1)
const allowNegative = computed(() => props.min < 0)
const inputMode = computed(() => (allowDecimal.value ? 'decimal' : 'numeric'))

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

/** 按步长对齐并夹紧（去掉 0.1 步进的浮点噪声） */
function align(value: number): number {
  const steps = Math.round((value - props.min) / stepSize.value)
  const aligned = props.min + steps * stepSize.value
  return Number(clamp(aligned).toFixed(6))
}

/**
 * 输入框文本 → 合法草稿
 *
 * 只剔除非法字符，**不**在每次击键时夹紧：夹紧会把「输入 3000」变成
 * 「3 → 30 → 300 → 上限」，用户无法继续输入。夹紧发生在失焦 / 步进时。
 * 小数点与负号按 step / min 决定是否允许（此前一律删除，`12.5` 会变 `125`）。
 */
function cleanDraft(raw: string): string {
  let text = raw
  if (!allowNegative.value) text = text.replace(/-/g, '')
  if (!allowDecimal.value) text = text.replace(/\./g, '')
  text = text.replace(/[^\d.-]/g, '')
  const negative = text.startsWith('-')
  const body = text.replace(/-/g, '')
  const [integer, ...fraction] = body.split('.')
  const decimal = allowDecimal.value && fraction.length > 0 ? `.${fraction.join('')}` : ''
  return `${negative ? '-' : ''}${integer}${decimal}`
}

/** 草稿 → 数字；空串 / 只有符号 / 只有小数点 → null（不把空输入当 0） */
function parseDraft(text: string): number | null {
  if (text === '' || text === '-' || text === '.' || text === '-.') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function onInput(event: Event): void {
  const cleaned = cleanDraft((event.target as HTMLInputElement).value)
  draft.value = cleaned
  const value = parseDraft(cleaned)
  if (value !== null) emit('update:modelValue', value)
}

function commit(): void {
  const next = align(parseDraft(draft.value) ?? props.modelValue)
  draft.value = String(next)
  emit('update:modelValue', next)
}

function stepBy(delta: number): void {
  const next = align(props.modelValue + delta * stepSize.value)
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
