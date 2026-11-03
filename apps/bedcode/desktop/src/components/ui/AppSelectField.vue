<template>
  <div class="app-field" :data-testid="testid">
    <span v-if="label" :id="labelId" class="app-field-label">
      {{ label }}
      <span v-if="required" class="app-field-req" aria-hidden="true">*</span>
    </span>

    <SelectRoot :model-value="rootValue" :disabled="disabled" @update:model-value="onUpdate">
      <SelectTrigger
        class="app-control app-select-trigger"
        :class="{ 'app-control-invalid': !!error }"
        :aria-labelledby="label ? labelId : undefined"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
      >
        <span class="app-select-text" :class="{ 'app-select-placeholder': !selectedLabel }">
          {{ selectedLabel || placeholder || '' }}
        </span>
        <SelectIcon class="app-select-chevron" aria-hidden="true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </SelectIcon>
      </SelectTrigger>

      <SelectPortal>
        <SelectContent position="popper" :side-offset="4" class="app-select-content">
          <SelectViewport>
            <!-- 占位项 = 「未选」，用哨兵值占位（reka-ui 不接受空字符串作为选项值） -->
            <SelectItem
              v-if="placeholder !== undefined"
              :value="EMPTY_VALUE"
              class="app-select-item"
            >
              <SelectItemText>{{ placeholder }}</SelectItemText>
            </SelectItem>
            <SelectItem
              v-for="option in options"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
              class="app-select-item"
            >
              <SelectItemText>{{ option.label }}</SelectItemText>
              <SelectItemIndicator class="app-select-check" aria-hidden="true">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.25"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <p v-if="error" :id="`${labelId}-error`" class="app-field-msg app-field-msg-error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="help" :id="`${labelId}-help`" class="app-field-msg">{{ help }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 下拉选择（reka-ui 原语 + token 皮肤）
 *
 * 原生 UI 禁令（skill: Native UI Ban）下 `<select>` 不可用：它的选项面板由系统绘制，
 * 不吃 token、不吃 `--ui-scale`。这里用 reka-ui（开源 headless，Vue 3 版 Radix UI）
 * 的 Select 原语接管**交互与无障碍**（键盘 ←/→/Home/End、输入首字母跳转、
 * `role=listbox` + `aria-activedescendant`、焦点回填、外点关闭），视觉全部由本组件
 * 的 scoped CSS 绑定 token 决定——组件库不自带样式，不存在「另一套设计系统」。
 *
 * 定位：reka-ui 走 floating 定位（`position="popper"`）。宿主曾给根元素加过 `zoom`
 * 导致 SDK Select 需要自校准补偿（见平台 `ui/zoom-compensation.ts`），该 zoom 已于
 * issue 06 移除、宿主样式里无 `zoom` 声明，故此处不重复补偿；若根级 zoom 回归，
 * 需要用同一套 F 因子包一层（风险点已记入交付说明）。
 */
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport,
  useId,
} from 'reka-ui'
import { computed } from 'vue'

export interface AppSelectOption {
  value: string | number
  label: string
  disabled?: boolean
}

interface Props {
  modelValue: string | number
  options: AppSelectOption[]
  label?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string
  help?: string
  testid?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  required: false,
  testid: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

/**
 * 「未选」哨兵值
 *
 * reka-ui 的 SelectItem 不接受空字符串（会把占位当真实选项匹配失败），所以用私有
 * 哨兵在组件边界做映射：对外始终是 `''`，内部只在穿过原语时替换。
 */
const EMPTY_VALUE = '__app_select_empty__'

const labelId = `app-select-${useId()}`

const rootValue = computed(() => {
  if (props.placeholder === undefined) return props.modelValue
  return props.modelValue === '' || props.modelValue === null ? EMPTY_VALUE : props.modelValue
})

function onUpdate(value: unknown): void {
  emit('update:modelValue', value === EMPTY_VALUE ? '' : (value as string | number))
}

const describedBy = computed(() => {
  if (props.error) return `${labelId}-error`
  if (props.help) return `${labelId}-help`
  return undefined
})

/**
 * 触发器上的可读文案
 *
 * 不用原语的 `SelectValue`：它的文本来自已挂载的 `SelectItem`（面板未展开过时是空的），
 * 弹窗首次打开会先闪一个空框。标签本来就在 options 里，直接算更稳。
 */
const selectedLabel = computed(() => {
  if (props.modelValue === '' && props.placeholder !== undefined) return ''
  const hit = props.options.find((option) => option.value === props.modelValue)
  return hit?.label ?? ''
})
</script>

<style scoped>
/**
 * 与 `AppTextField` 共用字段骨架与 `.app-control` 外观（同一套 token、同一套焦点态），
 * 保证并排的文本框与下拉看起来是一套控件；只在触发器右侧留出箭头位。
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

.app-control:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.app-control:focus-visible,
.app-select-trigger:focus-visible {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-input-focus);
}

.app-control:disabled,
.app-select-trigger:disabled {
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

/* 触发器：左文本右箭头，与输入框同一套外观 */
.app-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(8px * var(--ui-scale));
  text-align: left;
  cursor: pointer;
}

.app-select-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 未选时文本用 tertiary（与 input 的 placeholder 同色） */
.app-select-placeholder {
  color: var(--text-tertiary);
}

.app-select-chevron {
  display: flex;
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition:
    transform 200ms ease,
    color 200ms ease;
}

.app-select-trigger:hover .app-select-chevron,
.app-select-trigger[data-state='open'] .app-select-chevron {
  color: var(--text-secondary);
}

.app-select-trigger[data-state='open'] .app-select-chevron {
  transform: rotate(180deg);
}

/**
 * 选项面板：z-60 = 弹窗（z-50）之上的下拉层（safe-stack 的 Dropdown 档在弹窗内需抬一级）
 * 宽度跟随触发器（reka-ui 注入 `--reka-select-trigger-width`）。
 */
.app-select-content {
  z-index: 60;
  min-width: var(--reka-select-trigger-width);
  max-height: var(--reka-select-content-available-height, 280px);
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  /* 弹窗与面板同底色时，单靠投影在深色主题下几乎分不出层级 → 加 1px 硬边 */
  background: var(--bg-card);
  box-shadow:
    var(--shadow-card),
    0 0 0 1px color-mix(in srgb, var(--border-strong) 55%, transparent);
  color: var(--text-primary);
}

.app-select-content[data-state='open'] {
  animation: app-select-in 120ms ease-out;
}

.app-select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(8px * var(--ui-scale));
  padding: calc(6px * var(--ui-scale)) calc(9px * var(--ui-scale));
  border-radius: calc(var(--radius-input) - 4px);
  font-size: calc(12.5px * var(--ui-scale));
  line-height: 1.35;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.app-select-item[data-highlighted] {
  background: var(--bg-hover);
  color: var(--color-primary);
}

.app-select-item[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.app-select-check {
  display: flex;
  flex-shrink: 0;
  color: var(--color-primary);
}

.app-field-msg {
  font-size: calc(11px * var(--ui-scale));
  line-height: 1.45;
  color: var(--text-tertiary);
}

.app-field-msg-error {
  color: var(--color-danger);
}

@keyframes app-select-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-select-content[data-state='open'] {
    animation: none;
  }

  .app-select-chevron {
    transition: none;
  }
}
</style>
