<template>
  <div
    ref="trackEl"
    class="range-field"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :data-testid="testid"
    :style="{ '--range-progress': progress + '%' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @keydown="onKeydown"
  >
    <div class="range-track" aria-hidden="true" />
    <div class="range-thumb" aria-hidden="true" :style="{ left: progress + '%' }" />
  </div>
</template>

<script setup lang="ts">
/**
 * token 化滑块（不依赖 `input[type=range]`）
 *
 * 原生 range 的轨道 / 滑块由浏览器绘制（`::-webkit-slider-thumb` 只能部分覆盖），
 * 在宿主主题与 `--ui-scale` 下不可控；本仓 UI 规范禁用原生 range。这里用
 * `role="slider"` + 指针事件 + 键盘（←/→/Home/End/PageUp/PageDown）自绘，
 * 视觉全部走设计 token。
 *
 * 键盘契约与原生 range 对齐：方向键 ±step，PageUp/PageDown ±10×step，Home/End 到端点。
 */
import { computed, ref } from 'vue'

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

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)

const stepSize = computed(() => {
  const step = props.step ?? 1
  return Number.isFinite(step) && step > 0 ? step : 1
})

const progress = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((props.modelValue - props.min) / span) * 100))
})

/** 按 step 对齐并夹到 [min, max]；去掉浮点噪声（0.1 步进时避免 0.30000000000000004） */
function snap(value: number): number {
  const clamped = Math.min(props.max, Math.max(props.min, value))
  const steps = Math.round((clamped - props.min) / stepSize.value)
  const snapped = props.min + steps * stepSize.value
  return Number(Math.min(props.max, Math.max(props.min, snapped)).toFixed(6))
}

function emitValue(next: number): void {
  const value = snap(next)
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** 指针横坐标 → 值（按轨道实测宽度换算，不依赖滚动位置） */
function valueFromClientX(clientX: number): number {
  const el = trackEl.value
  if (!el) return props.modelValue
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return props.modelValue
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return props.min + ratio * (props.max - props.min)
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== undefined && event.button !== 0) return
  dragging.value = true
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  trackEl.value?.focus()
  emitValue(valueFromClientX(event.clientX))
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  emitValue(valueFromClientX(event.clientX))
}

function endDrag(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
}

function onKeydown(event: KeyboardEvent): void {
  const delta = stepSize.value
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      emitValue(props.modelValue - delta)
      break
    case 'ArrowRight':
    case 'ArrowUp':
      emitValue(props.modelValue + delta)
      break
    case 'PageDown':
      emitValue(props.modelValue - delta * 10)
      break
    case 'PageUp':
      emitValue(props.modelValue + delta * 10)
      break
    case 'Home':
      emitValue(props.min)
      break
    case 'End':
      emitValue(props.max)
      break
    default:
      return
  }
  event.preventDefault()
}
</script>

<style scoped>
.range-field {
  position: relative;
  height: 20px;
  margin: 6px 0;
  cursor: pointer;
  touch-action: none;
  outline: none;
}
.range-track {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 6px;
  border-radius: 999px;
  transform: translateY(-50%);
  background: linear-gradient(
    to right,
    var(--color-primary) 0%,
    var(--color-primary) var(--range-progress, 0%),
    var(--bg-hover) var(--range-progress, 0%),
    var(--bg-hover) 100%
  );
}
.range-thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.range-field:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, var(--color-info));
  outline-offset: 4px;
  border-radius: 999px;
}
</style>
