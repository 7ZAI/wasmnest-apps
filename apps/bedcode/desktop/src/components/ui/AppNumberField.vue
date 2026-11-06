<template>
  <div class="app-field">
    <label v-if="label" :for="inputId" class="app-field-label">
      {{ label }}
      <span v-if="required" class="app-field-req" aria-hidden="true">*</span>
    </label>

    <div class="app-number">
      <input
        :id="inputId"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :value="text"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="!label ? ariaLabel : undefined"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-testid="testid || undefined"
        class="app-control app-number-input"
        @input="onInput"
        @blur="onBlur"
        @keydown.up.prevent="stepBy(step)"
        @keydown.down.prevent="stepBy(-step)"
      />
      <span class="app-number-steps">
        <button
          type="button"
          class="app-number-step"
          :disabled="disabled || atMin"
          :aria-label="decreaseLabel"
          @click="stepBy(-step)"
        >
          −
        </button>
        <button
          type="button"
          class="app-number-step"
          :disabled="disabled || atMax"
          :aria-label="increaseLabel"
          @click="stepBy(step)"
        >
          +
        </button>
      </span>
    </div>

    <p v-if="error" :id="`${inputId}-error`" class="app-field-msg app-field-msg-error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="help" :id="`${inputId}-help`" class="app-field-msg">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * 数字字段（原生 UI 禁令：不使用 `input[type=number]`）
 *
 * 系统步进器在 WebView 里由宿主绘制，箭头大小、滚轮行为、深浅色都不受 token 控制；
 * 这里保留**文本输入**（允许项）承载键盘输入，右侧给一对显式 ± 按钮。数值解析、
 * 范围钳制与上下方向键都在组件内收口，对外只发 `number | null`。
 *
 * `allowEmpty` = 允许空值（可选超时等），空时对外发 `null`；否则失焦回填上次值。
 */
interface Props {
  modelValue: number | null
  label?: string
  min?: number
  max?: number
  step?: number
  allowEmpty?: boolean
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string
  help?: string
  ariaLabel?: string
  testid?: string
  decreaseLabel?: string
  increaseLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  min: undefined,
  max: undefined,
  step: 1,
  allowEmpty: false,
  placeholder: '',
  disabled: false,
  required: false,
  error: '',
  help: '',
  ariaLabel: '',
  testid: '',
  decreaseLabel: 'Decrease',
  increaseLabel: 'Increase',
})

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const inputId = `app-number-${useId()}`

const text = computed(() => (props.modelValue === null ? '' : String(props.modelValue)))

// 空值两侧都不算触顶/触底：否则 `?? min` / `?? max` 让两个步进按钮同时禁用，
// stepBy 里对 null 的处理永远到不了（M36）。
const atMin = computed(
  () => props.modelValue !== null && props.min !== undefined && props.modelValue <= props.min,
)
const atMax = computed(
  () => props.modelValue !== null && props.max !== undefined && props.modelValue >= props.max,
)

const describedBy = computed(() => {
  if (props.error) return `${inputId}-error`
  if (props.help) return `${inputId}-help`
  return undefined
})

function clamp(value: number): number {
  let next = Math.trunc(value)
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  return next
}

function emitValue(value: number | null): void {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function stepBy(delta: number): void {
  if (props.disabled) return
  // 空值（可选项）第一次点 ± 直接落到最小值，而不是「最小值 + 一步」跳过 1
  if (props.modelValue === null) {
    emitValue(clamp(props.min ?? 0))
    return
  }
  emitValue(clamp(props.modelValue + delta))
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement
  // 只接受十进制整数：粘贴 "1e3" / "3.5" / 负号时先清洗，避免 NaN 流进计划
  const cleaned = input.value.replace(/[^\d]/g, '')
  if (cleaned !== input.value) input.value = cleaned
  if (cleaned === '') {
    if (props.allowEmpty) emitValue(null)
    return
  }
  // 输入过程中就钳制：越界值不得先 emit 给计划（M36）。
  emitValue(clamp(Number(cleaned)))
}

function onBlur(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.value.trim() === '') {
    if (props.allowEmpty) {
      emitValue(null)
      return
    }
    // 必填项被清空：失焦回填上次值（没有上次值则落 min / 0）
    const fallback = props.modelValue ?? props.min ?? 0
    input.value = String(fallback)
    emitValue(fallback)
    return
  }
  const next = clamp(Number(input.value))
  input.value = String(next)
  emitValue(next)
}
</script>

<style scoped>
.app-field {
  display: flex;
  flex-direction: column;
  gap: calc(6px * var(--ui-scale));
  min-width: 0;
}

.app-field-label {
  font-size: calc(11.5px * var(--ui-scale));
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--text-secondary);
}

.app-field-req {
  margin-left: 2px;
  color: var(--color-danger);
}

.app-number {
  position: relative;
  display: flex;
}

.app-control {
  width: 100%;
  height: var(--input-height);
  padding: 0 calc(11px * var(--ui-scale));
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: calc(12.5px * var(--ui-scale));
  line-height: 1.4;
  outline: none;
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease,
    background-color 200ms ease;
}

.app-number-input {
  padding-right: calc(52px * var(--ui-scale));
  font-variant-numeric: tabular-nums;
}

.app-control::placeholder {
  color: var(--text-tertiary);
}

.app-control:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.app-control:focus-visible {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-input-focus);
}

.app-control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 步进按钮：与输入框同高、贴右；只占内容宽度，不撑高字段 */
.app-number-steps {
  position: absolute;
  top: 1px;
  right: 1px;
  bottom: 1px;
  display: flex;
  overflow: hidden;
  border-left: 1px solid var(--border-input);
  border-radius: 0 calc(var(--radius-input) - 1px) calc(var(--radius-input) - 1px) 0;
}

.app-number-step {
  width: calc(24px * var(--ui-scale));
  color: var(--text-secondary);
  font-size: calc(13px * var(--ui-scale));
  line-height: 1;
  background: var(--bg-input);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.app-number-step + .app-number-step {
  border-left: 1px solid var(--border-input);
}

.app-number-step:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.app-number-step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.app-number-step:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.app-field-msg {
  font-size: calc(11px * var(--ui-scale));
  line-height: 1.45;
  color: var(--text-tertiary);
}

.app-field-msg-error {
  color: var(--color-danger-ink);
}
</style>
