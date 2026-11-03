<template>
  <div class="select-field">
    <button
      :id="id"
      ref="triggerEl"
      type="button"
      class="select-trigger"
      :class="{ 'select-trigger--open': open }"
      :disabled="disabled"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="activeDescendant"
      :data-testid="testid"
      @click="toggle"
      @keydown.down.prevent="onArrowDown"
      @keydown.up.prevent="onArrowUp"
      @keydown.enter.prevent="onEnter"
      @keydown.space.prevent="onEnter"
      @keydown.esc="onEscape"
      @keydown.tab="close"
    >
      <span class="truncate" :class="{ 'select-placeholder': selectedLabel === '' }">
        {{ selectedLabel }}
      </span>
      <svg
        class="select-chevron"
        :class="{ 'select-chevron--open': open }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Teleport v-if="open && appRoot" :to="appRoot">
      <div
        ref="panelEl"
        class="select-panel"
        :style="panelStyle"
        role="listbox"
        :aria-label="label"
        :data-testid="testid ? `${testid}-panel` : undefined"
        @keydown.esc.stop.prevent="close"
      >
        <ul :id="listId" class="select-options">
          <li
            v-for="(option, index) in options"
            :id="`${listId}-option-${index}`"
            :key="String(option.value)"
            :data-testid="testid ? `${testid}-option-${String(option.value)}` : undefined"
            role="option"
            :aria-selected="option.value === modelValue"
            class="select-option"
            :class="{
              'select-option--selected': option.value === modelValue,
              'select-option--hovered': option.value === hovered,
            }"
            :data-active="option.value === hovered"
            @mouseenter="setHovered(option.value)"
            @click="pick(option.value)"
          >
            <span class="truncate">{{ option.label }}</span>
            <svg
              v-if="option.value === modelValue"
              class="select-check"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
/**
 * token 化下拉选择（替代原生 <select>）
 *
 * 浮层 Teleport 到 `.lanbitou-root`（注入的 `appRootEl`）而不是 body：
 * - 继承应用自己的主题 token（应用主题与宿主主题可以不同）；
 * - 固定定位 + 视口坐标，不受设置弹窗滚动容器裁剪。
 */
import { computed, inject, nextTick, onBeforeUnmount, ref, type Ref } from 'vue'

interface SelectOption {
  value: T
  label: string
}

const props = defineProps<{
  modelValue: T
  options: SelectOption[]
  id?: string
  label?: string
  testid?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const appRoot = inject<Ref<HTMLElement | null>>('appRootEl', ref(null))
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const open = ref(false)
const hovered = ref<T | null>(null)
const panelStyle = ref<Record<string, string>>({})
const listId = `select-list-${Math.random().toString(36).slice(2, 9)}`

const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? '',
)

const activeDescendant = computed(() => {
  if (!open.value || hovered.value === null) return undefined
  const index = props.options.findIndex((option) => option.value === hovered.value)
  return index >= 0 ? `${listId}-option-${index}` : undefined
})

function toggle(): void {
  open.value ? close() : show()
}

function show(): void {
  if (props.disabled) return
  hovered.value = props.modelValue
  open.value = true
  void nextTick(() => {
    updatePosition()
    panelEl.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  })
  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
}

function close(): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}

function onDocumentMouseDown(event: MouseEvent): void {
  const target = event.target as Node | null
  if (!target) return
  if (triggerEl.value?.contains(target) || panelEl.value?.contains(target)) return
  close()
}

function pick(value: T): void {
  emit('update:modelValue', value)
  close()
  triggerEl.value?.focus()
}

function setHovered(value: T): void {
  hovered.value = value
}

function updatePosition(): void {
  const trigger = triggerEl.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const gap = 4
  const maxHeight = 240
  const estimated = Math.min(maxHeight, props.options.length * 30 + 8)
  const spaceBelow = window.innerHeight - rect.bottom - 8
  const placeAbove = spaceBelow < estimated && rect.top > estimated + 8
  const width = Math.max(rect.width, 120)
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  panelStyle.value = {
    left: `${left}px`,
    top: `${placeAbove ? rect.top - estimated - gap : rect.bottom + gap}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  }
}

function move(delta: number): void {
  if (!open.value) {
    show()
    return
  }
  const values = props.options.map((option) => option.value)
  if (values.length === 0) return
  const current = hovered.value
  const index = current === null ? -1 : values.indexOf(current)
  const nextIndex = index === -1 ? 0 : (index + delta + values.length) % values.length
  hovered.value = values[nextIndex]
  void nextTick(() => {
    panelEl.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  })
}

function onArrowDown(): void {
  move(1)
}

function onArrowUp(): void {
  move(-1)
}

function onEnter(): void {
  if (!open.value) {
    show()
    return
  }
  if (hovered.value !== null) pick(hovered.value)
}

/** 只有下拉打开时才消费 Escape；关闭态让事件冒泡给父级弹窗 */
function onEscape(event: KeyboardEvent): void {
  if (!open.value) return
  event.preventDefault()
  event.stopPropagation()
  close()
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<style scoped>
.select-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 6px 8px;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  text-align: left;
  outline: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.select-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.select-trigger--open,
.select-trigger:focus-visible {
  border-color: var(--color-primary);
}
.select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.select-placeholder {
  color: var(--text-tertiary);
}
.select-chevron {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 0.15s ease;
}
.select-chevron--open {
  transform: rotate(180deg);
}

.select-panel {
  position: fixed;
  z-index: 70;
  overflow: hidden;
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.select-options {
  max-height: inherit;
  overflow-y: auto;
  padding: 4px 0;
  margin: 0;
  list-style: none;
}
.select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 6px 10px;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.select-option--hovered {
  background: var(--bg-hover);
}
.select-option--selected {
  font-weight: 500;
}
.select-check {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
  color: var(--color-primary);
}
</style>
