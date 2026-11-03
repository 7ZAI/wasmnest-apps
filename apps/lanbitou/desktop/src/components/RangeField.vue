<template>
  <input
    type="range"
    class="range-input"
    :min="min"
    :max="max"
    :step="step ?? 1"
    :value="modelValue"
    :aria-label="label"
    :style="{ '--range-progress': progress + '%' }"
    :data-testid="testid"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>

<script setup lang="ts">
/** token 化滑块：appearance 全自绘（轨道 / 已选段 / 滑块都用设计 token） */
import { computed } from 'vue'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  label?: string
  testid?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const progress = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((props.modelValue - props.min) / span) * 100))
})
</script>

<style scoped>
.range-input {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  margin: 6px 0;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--color-primary) 0%,
    var(--color-primary) var(--range-progress, 0%),
    var(--bg-hover) var(--range-progress, 0%),
    var(--bg-hover) 100%
  );
}
.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
}
.range-input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
}
.range-input:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, var(--color-info));
  outline-offset: 4px;
}
</style>
