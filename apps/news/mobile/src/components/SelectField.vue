<template>
  <div ref="root" class="news-ms-select" :class="{ 'is-disabled': disabled }">
    <button
      type="button"
      class="news-ms-select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      :disabled="disabled"
      v-bind="$attrs"
      @click="toggle"
      @keydown.down.prevent="openList(1)"
      @keydown.up.prevent="openList(-1)"
      @keydown.enter.prevent="onEnter"
      @keydown.esc="close"
    >
      <span class="news-ms-select-value">{{ selectedLabel }}</span>
      <svg class="news-ms-select-chevron" viewBox="0 0 12 12" aria-hidden="true" fill="none">
        <path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
    <div v-if="open" class="news-ms-select-menu" role="listbox" :aria-label="ariaLabel">
      <button
        v-for="(option, index) in options"
        :key="String(option.value)"
        type="button"
        role="option"
        class="news-ms-select-option"
        :class="{ 'is-current': index === activeIndex, 'is-selected': option.value === modelValue }"
        :aria-selected="option.value === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 移动端下拉选择：原生 `<select>` 由系统绘制，不吃应用 token，深浅色与字号跟随宿主时
 * 会脱钩，因此按应用自己的皮肤自绘。选项在文档流内展开，避免设置页滚动容器裁剪菜单。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: ReadonlyArray<{ value: string; label: string }>
    disabled?: boolean
    ariaLabel?: string
  }>(),
  { disabled: false, ariaLabel: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)

const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? '',
)

function close(): void {
  open.value = false
}

function openList(direction: number): void {
  if (props.disabled) return
  const current = props.options.findIndex((option) => option.value === props.modelValue)
  activeIndex.value = Math.min(
    props.options.length - 1,
    Math.max(0, (current >= 0 ? current : 0) + direction),
  )
  open.value = true
}

function toggle(): void {
  if (open.value) close()
  else openList(0)
}

function choose(value: string): void {
  emit('update:modelValue', value)
  close()
}

function onEnter(): void {
  if (!open.value) {
    openList(0)
    return
  }
  const option = props.options[activeIndex.value]
  if (option) choose(option.value)
}

function onDocumentPointer(event: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close()
  },
)
</script>

<style scoped>
.news-ms-select {
  position: relative;
  min-width: 0;
}
.news-ms-select.is-disabled {
  opacity: 0.5;
}
.news-ms-select-trigger {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: var(--news-space-2);
  padding: 0 12px;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-input);
  color: var(--news-text-primary);
  font-family: inherit;
  font-size: var(--news-text-body);
  text-align: start;
  cursor: pointer;
}
.news-ms-select-trigger:focus-visible {
  border-color: var(--news-accent);
  outline: 2px solid var(--news-accent);
  outline-offset: 1px;
}
.news-ms-select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.news-ms-select-chevron {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--news-text-secondary);
}
.news-ms-select-menu {
  display: flex;
  flex-direction: column;
  margin-top: var(--news-space-1);
  padding: var(--news-space-1);
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-card);
  box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
}
.news-ms-select-option {
  min-height: 40px;
  padding: var(--news-space-2) var(--news-space-3);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--news-text-primary);
  font-size: var(--news-text-body);
  text-align: start;
  cursor: pointer;
}
.news-ms-select-option.is-current {
  background: var(--news-accent-soft);
}
.news-ms-select-option.is-selected {
  color: var(--news-accent-ink);
  font-weight: 600;
}
</style>
