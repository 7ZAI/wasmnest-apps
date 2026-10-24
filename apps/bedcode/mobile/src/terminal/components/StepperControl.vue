<template>
  <div class="stepper-control">
    <button
      type="button"
      class="size-btn"
      :disabled="disabled || modelValue <= min"
      :aria-label="`${label} -1`"
      @click.stop="step(-1)"
    >-</button>
    <span class="size-value">{{ modelValue }}{{ unit }}</span>
    <button
      type="button"
      class="size-btn"
      :disabled="disabled || modelValue >= max"
      :aria-label="`${label} +1`"
      @click.stop="step(1)"
    >+</button>
  </div>
</template>

<script setup lang="ts">
/**
 * 数值步进器（#18 收敛件）——设置面步进控件共用（终端字号/字间距/快捷栏数、
 * 代码查看字号、业务设置数值项）。边界即禁用态；aria-label 按「<label> ±1」生成
 * （口径同 SettingsPage 既有实现）。
 * 类名保留 size-btn / size-value：既有测试与样式口径不动。
 */
defineOptions({ name: 'StepperControl' })

const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  /** 无障碍标签（生成「<label> -1 / +1」aria-label） */
  label: string
  /** 数值后缀（如 px），空则纯数字 */
  unit?: string
  disabled?: boolean
}>(), {
  unit: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function step(delta: number) {
  const next = Math.min(Math.max(props.modelValue + delta, props.min), props.max)
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<style scoped>
.stepper-control {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.size-btn {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 1px solid var(--mobile-border);
  color: var(--mobile-text-primary);
  font-size: clamp(1rem, 1.25rem, 1.5rem);
  cursor: pointer;
  transition: all 0.2s ease;
}

.size-btn:hover:not(:disabled) {
  background: var(--mobile-bg-hover);
}

.size-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.size-value {
  flex: 1;
  min-width: 3ch;
  text-align: center;
  font-size: clamp(1rem, 1.125rem, 1.25rem);
  font-weight: 500;
  color: var(--mobile-text-primary);
}
</style>
