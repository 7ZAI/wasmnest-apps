<script setup lang="ts">
/**
 * 浮球
 *
 * 常驻在应用容器右下角；拖拽移动、点击开合小窗。位置由父级夹紧并持久化，
 * 组件本身只上报意图。
 */
import { ref } from 'vue'
import NestMascot from './NestMascot.vue'
import type { MascotState } from '../ui/mascot-state'

const props = withDefaults(
  defineProps<{
    state: MascotState
    x: number
    y: number
    expanded?: boolean
    motionEnabled?: boolean
    label: string
    size?: number
  }>(),
  {
    expanded: false,
    motionEnabled: true,
    size: 52,
  },
)

const emit = defineEmits<{ toggle: []; move: [x: number, y: number] }>()

const dragging = ref(false)
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let moved = false

function onPointerDown(event: PointerEvent): void {
  dragging.value = true
  moved = false
  startX = event.clientX
  startY = event.clientY
  originX = props.x
  originY = props.y
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
  emit('move', originX + dx, originY + dy)
}

function onPointerUp(): void {
  if (!dragging.value) return
  dragging.value = false
  if (!moved) emit('toggle')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('toggle')
  }
}
</script>

<template>
  <button
    type="button"
    class="nest-floatball"
    data-testid="nest-floatball"
    :class="{ 'nest-floatball--dragging': dragging, 'nest-floatball--open': expanded }"
    :style="{ left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` }"
    :aria-label="label"
    :aria-expanded="expanded"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <NestMascot :state="state" :size="size - 14" :motion-enabled="motionEnabled" />
  </button>
</template>

<style scoped>
.nest-floatball {
  position: absolute;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--nest-border);
  border-radius: 50%;
  background: var(--nest-surface);
  box-shadow: var(--nest-shadow-1);
  cursor: grab;
  touch-action: none;
  transition:
    box-shadow var(--nest-motion-fast) ease,
    border-color var(--nest-motion-fast) ease;
}

.nest-floatball:hover {
  border-color: var(--nest-border-strong);
}

.nest-floatball:focus-visible {
  outline: var(--nest-focus-width) solid var(--nest-focus);
  outline-offset: var(--nest-focus-offset);
}

.nest-floatball--open {
  border-color: var(--nest-accent);
}

.nest-floatball--dragging {
  cursor: grabbing;
  box-shadow: var(--nest-shadow-1), 0 6px 18px rgba(0, 0, 0, 0.12);
}
</style>