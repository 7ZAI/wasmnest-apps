<template>
  <div class="news-ms-weight" :class="{ 'is-disabled': disabled }">
    <input
      :value="text"
      class="news-ms-weight-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      role="spinbutton"
      :aria-valuenow="modelValue"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuetext="text || undefined"
      :aria-label="ariaLabel"
      :disabled="disabled"
      v-bind="$attrs"
      @input="onInput"
      @blur="commit"
      @keydown.enter.prevent="commit"
      @keydown.up.prevent="stepBy(1)"
      @keydown.down.prevent="stepBy(-1)"
    />
    <span class="news-ms-weight-steppers">
      <button
        type="button"
        class="news-ms-weight-step"
        :disabled="disabled || atMax"
        :aria-label="t('news.settings.weight.increase')"
        data-testid="mobile-news-weight-increase"
        @click="stepBy(1)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7.5 6 4.5l3 3" />
        </svg>
      </button>
      <button
        type="button"
        class="news-ms-weight-step"
        :disabled="disabled || atMin"
        :aria-label="t('news.settings.weight.decrease')"
        data-testid="mobile-news-weight-decrease"
        @click="stepBy(-1)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4.5 6 7.5l3-3" />
        </svg>
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * 移动端权重步进器（0.5 – 2.0，步进 0.1）：原生数字输入的 spinner 由系统绘制、点不中，
 * 也不吃应用 token，因此自绘。键入只按上下界钳制并保留一位小数，失焦或回车时提交。
 */
import { computed, inject, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    ariaLabel?: string
  }>(),
  { min: 0.5, max: 2, step: 0.1, disabled: false, ariaLabel: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

const text = ref(format(props.modelValue))
const editing = ref(false)

watch(
  () => props.modelValue,
  (next) => {
    if (!editing.value) text.value = format(next)
  },
)

const atMin = computed(() => props.modelValue <= props.min)
const atMax = computed(() => props.modelValue >= props.max)

function clamp(value: number): number {
  return Math.round(Math.min(props.max, Math.max(props.min, value)) * 10) / 10
}

function format(value: number): string {
  return clamp(value).toFixed(1)
}

function parseDraft(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? clamp(parsed) : null
}

function onInput(event: Event): void {
  const element = event.target as HTMLInputElement
  editing.value = true
  text.value = element.value
  const parsed = parseDraft(element.value)
  if (parsed !== null) emit('update:modelValue', parsed)
}

function commit(): void {
  editing.value = false
  const next = parseDraft(text.value) ?? clamp(props.modelValue)
  text.value = format(next)
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function stepBy(direction: number): void {
  if (props.disabled) return
  const base = parseDraft(text.value) ?? props.modelValue
  const next = clamp(base + direction * props.step)
  editing.value = false
  text.value = format(next)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.news-ms-weight {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--news-border-strong);
  border-radius: var(--news-radius-control);
  background: var(--news-bg-input);
}
.news-ms-weight:focus-within {
  border-color: var(--news-accent);
  outline: 2px solid var(--news-accent);
  outline-offset: 1px;
}
.news-ms-weight.is-disabled {
  opacity: 0.5;
}
.news-ms-weight-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 12px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--news-text-primary);
  font-family: inherit;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.news-ms-weight-steppers {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: 32px;
  border-left: 1px solid var(--news-border-strong);
}
.news-ms-weight-step {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--news-text-secondary);
  cursor: pointer;
}
.news-ms-weight-step:hover:not(:disabled) {
  color: var(--news-text-primary);
}
.news-ms-weight-step:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.news-ms-weight-step svg {
  width: 12px;
  height: 12px;
}
.news-ms-weight-step + .news-ms-weight-step {
  border-top: 1px solid var(--news-border-strong);
}
</style>
