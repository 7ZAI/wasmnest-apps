<template>
  <div class="news-weight" :class="{ 'is-disabled': disabled }">
    <input
      :value="text"
      class="news-weight-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      role="spinbutton"
      :aria-valuenow="modelValue"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuetext="text || undefined"
      :disabled="disabled"
      :aria-label="ariaLabel"
      v-bind="$attrs"
      @input="onInput"
      @blur="commit"
      @keydown.enter.prevent="commit"
      @keydown.up.prevent="stepBy(1)"
      @keydown.down.prevent="stepBy(-1)"
    />
    <span class="news-weight-steppers">
      <button
        type="button"
        class="news-weight-step"
        :disabled="disabled || atMax"
        :aria-label="t('news.settings.weight.increase')"
        data-news-weight-increase
        @click="stepBy(1)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 7.5 6 4.5l3 3"
          />
        </svg>
      </button>
      <button
        type="button"
        class="news-weight-step"
        :disabled="disabled || atMin"
        :aria-label="t('news.settings.weight.decrease')"
        data-news-weight-decrease
        @click="stepBy(-1)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 4.5 6 7.5l3-3"
          />
        </svg>
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * 权重输入（0.5 – 2.0，步进 0.1）
 *
 * 为什么自绘而不是原生 `<input type="number">`：原生 spinner 由浏览器绘制，箭头
 * 只有几像素、点不中，也不吃宿主 token 与 `--ui-scale`（原生 UI 禁令同口径）。
 * 宿主共享的 NumberField 只支持整数步进（内部对值取整），权重要 0.1 步进，
 * 因此这里按同样的交互形态自绘一个 token 皮肤的小步进器。
 *
 * 取值口径：键入不做「吸附到步进网格」，只按 min/max 硬钳制并保留一位小数；
 * 失焦 / 回车时提交钳制后的值，清空输入不提交（保留原值）。
 */
import { computed, inject, ref, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    /** 没有外置 label 时必须给（无障碍名称） */
    ariaLabel?: string
  }>(),
  {
    min: 0.5,
    max: 2,
    step: 0.1,
    disabled: false,
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
  (e: 'commit', value: number): void
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)

/** 用户正在编辑的原始文本；非编辑态跟随 modelValue 回显 */
const text = ref(format(props.modelValue))
const editing = ref(false)

watch(
  () => props.modelValue,
  (next) => {
    if (editing.value) return
    text.value = format(next)
  },
)

const atMin = computed(() => props.modelValue <= props.min)
const atMax = computed(() => props.modelValue >= props.max)

/** 钳制到设计域并保留一位小数 */
function clamp(value: number): number {
  const bounded = Math.min(props.max, Math.max(props.min, value))
  return Math.round(bounded * 10) / 10
}

/** 回显格式：一位小数，与列表里的权重显示一致 */
function format(value: number): string {
  return clamp(value).toFixed(1)
}

/** 解析输入文本；空 / 非法返回 null（不提交） */
function parseDraft(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d*\.?\d*$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return clamp(parsed)
}

function onInput(event: Event): void {
  const el = event.target as HTMLInputElement
  editing.value = true
  text.value = el.value
  const parsed = parseDraft(el.value)
  if (parsed !== null) emit('update:modelValue', parsed)
}

function commit(): void {
  editing.value = false
  const parsed = parseDraft(text.value)
  const next = parsed ?? clamp(props.modelValue)
  text.value = format(next)
  if (next !== props.modelValue) emit('update:modelValue', next)
  emit('commit', next)
}

function stepBy(direction: number): void {
  if (props.disabled) return
  const base = parseDraft(text.value) ?? props.modelValue
  const next = clamp(base + direction * props.step)
  editing.value = false
  text.value = format(next)
  emit('update:modelValue', next)
  emit('commit', next)
}
</script>

<style scoped>
.news-weight {
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  overflow: hidden;
  border: 1px solid var(--border-input, var(--border));
  border-radius: var(--radius-button, 8px);
  background: var(--bg-page);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.news-weight:focus-within {
  border-color: var(--color-info);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-info) 18%, transparent);
}
.news-weight.is-disabled {
  opacity: 0.5;
}
.news-weight-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 10px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body, 13px);
  font-variant-numeric: tabular-nums;
}
.news-weight-steppers {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: 26px;
  border-left: 1px solid var(--border-input, var(--border));
}
.news-weight-step {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.news-weight-step:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.news-weight-step:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.news-weight-step svg {
  width: 12px;
  height: 12px;
}
.news-weight-step + .news-weight-step {
  border-top: 1px solid var(--border-input, var(--border));
}
</style>
