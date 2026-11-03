<template>
  <div class="app-field" :data-testid="testid">
    <label v-if="label" :for="inputId" class="app-field-label">
      {{ label }}
      <span v-if="required" class="app-field-req" aria-hidden="true">*</span>
    </label>

    <div class="relative">
      <input
        :id="inputId"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        class="app-control"
        :class="{ 'app-control-invalid': !!error, 'pr-16': !!$slots.suffix }"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="onInput"
      />
      <div
        v-if="$slots.suffix"
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
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string
  help?: string
  testid?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  required: false,
  testid: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const inputId = `app-field-${useId()}`
const describedBy = computed(() => {
  if (props.error) return `${inputId}-error`
  if (props.help) return `${inputId}-help`
  return undefined
})

function onInput(event: Event): void {
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
