<template>
  <div class="app-field">
    <label v-if="label" :for="inputId" class="app-field-label">
      {{ label }}
      <span v-if="required" class="app-field-req" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <textarea
        v-if="multiline"
        :id="inputId"
        :value="modelValue"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        class="app-control app-textarea"
        :class="{ 'app-control-invalid': !!error }"
        :aria-label="!label ? ariaLabel : undefined"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-testid="testid || undefined"
        @input="onInput"
        @change="onChange"
      />
      <input
        v-else
        :id="inputId"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        class="app-control"
        :class="{ 'app-control-invalid': !!error, 'pr-16': !!$slots.suffix }"
        :aria-label="!label ? ariaLabel : undefined"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-testid="testid || undefined"
        @input="onInput"
        @change="onChange"
      />
      <div
        v-if="$slots.suffix && !multiline"
        class="absolute inset-y-0 right-2.5 flex items-center gap-1 text-[var(--text-tertiary)]"
      >
        <slot name="suffix" />
      </div>
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
 * 表单文本框（插件内自持，token 绑定）
 *
 * 为什么自己写而不是继续用 `components/TextInput.vue`：那个是宿主 `Input.vue` 的
 * 逐类复制，依赖 `rounded-input` / `shadow-input-focus` 这类 token 别名——本工程
 * Tailwind 早先没映射它们，于是圆角、品牌焦点框、焦点环全是死类（看起来像没皮肤
 * 的原生输入框）。本组件把视觉状态写成 scoped CSS 直接引 token，不再依赖主题
 * 扩展是否配全；主题切换、`--ui-scale` 缩放都随之生效。
 *
 * 原生 UI 边界（skill: Native UI Ban）：`<input type=text|password|email|url>` 属
 * 允许项，但必须走 token 样式——即本组件；`type=number/date/color/...` 一律不用
 * （数字用 `AppNumberField`，日期用 `@vuepic/vue-datepicker`）。
 */
interface Props {
  modelValue: string
  label?: string
  type?: 'text' | 'password' | 'email' | 'url'
  /** 多行文本：渲染 textarea（同一套 token 外观，行高与内边距单独适配） */
  multiline?: boolean
  rows?: number
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string
  help?: string
  /** 无可见标签时的可读名称（紧凑表单用） */
  ariaLabel?: string
  /** 落在实际控件上，E2E / 单测可直接 setValue 或 typeInto */
  testid?: string
  /**
   * 只在 change（失焦/回车）时向外提交。
   * 用于「输入过程中不能重排原文」的字段（空格分隔 argv、逐行写集）：
   * 受控值在输入期间保持不变，Vue 不会回写 DOM，用户可正常键入。
   */
  commitOnChange?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  type: 'text',
  multiline: false,
  rows: 3,
  placeholder: '',
  disabled: false,
  required: false,
  error: '',
  help: '',
  testid: '',
  ariaLabel: '',
  commitOnChange: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const inputId = `app-field-${useId()}`
const describedBy = computed(() => {
  if (props.error) return `${inputId}-error`
  if (props.help) return `${inputId}-help`
  return undefined
})

function onInput(event: Event): void {
  if (props.commitOnChange) return
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onChange(event: Event): void {
  if (!props.commitOnChange) return
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
/**
 * 字段骨架：标签 / 控件 / 提示三层，间距与字号随 --ui-scale 缩放。
 * 视觉全部落 token（`--bg-input`、`--border-input`、`--radius-input`、
 * `--shadow-input-focus`、`--color-primary`），深浅色与主题预设自动跟随。
 */
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

.app-control::placeholder {
  color: var(--text-tertiary);
}

/* 多行：高度交给 rows，垂直内边距与行高单独给；允许用户纵向拉伸 */
.app-textarea {
  height: auto;
  min-height: var(--input-height);
  padding: calc(8px * var(--ui-scale)) calc(11px * var(--ui-scale));
  line-height: 1.5;
  resize: vertical;
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

.app-control-invalid,
.app-control-invalid:hover:not(:disabled) {
  border-color: var(--color-danger);
}

.app-control-invalid:focus-visible {
  border-color: var(--color-danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-danger) 18%, transparent);
}

.app-field-msg {
  font-size: calc(11px * var(--ui-scale));
  line-height: 1.45;
  color: var(--text-tertiary);
}

.app-field-msg-error {
  color: var(--color-danger);
}
</style>
