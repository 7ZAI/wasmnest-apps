<template>
  <div>
    <label class="repeatable-label mb-1.5 block">{{ t('toolbox.repeatable') }}</label>
    <!-- 分段选择：选中态是「浮起的一格」（surface step + 发丝高光），不是第二颗主按钮。
         卡片里真正的动作只有底部那颗实底 CTA。 -->
    <div class="repeatable-seg flex gap-1 p-1">
      <button
        type="button"
        class="repeatable-opt flex-1 min-h-10 flex items-center justify-center py-2 font-medium transition-colors"
        :class="{ 'repeatable-opt--on': modelValue }"
        :aria-pressed="modelValue"
        @click="emit('update:modelValue', true)"
      >
        {{ t('toolbox.repeatableOn') }}
      </button>
      <button
        type="button"
        class="repeatable-opt flex-1 min-h-10 flex items-center justify-center py-2 font-medium transition-colors"
        :class="{ 'repeatable-opt--on': !modelValue }"
        :aria-pressed="!modelValue"
        @click="emit('update:modelValue', false)"
      >
        {{ t('toolbox.repeatableOff') }}
      </button>
    </div>
    <p class="repeatable-hint mt-1.5" style="color: var(--mobile-text-muted)">
      {{ modelValue ? t('toolbox.repeatableOnHint') : t('toolbox.repeatableOffHint') }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * RepeatableToggle - 预设任务「可重复/不可重复」属性选择
 *
 * 自绘 segmented 双按钮（禁原生控件外观），供创建/编辑预设任务入口复用
 * （TaskEditDialog 与 PresetTasksView 顶部编辑区）。
 */
import { t } from '../host'

defineProps<{
  /** 当前值：true=可重复，false=不可重复 */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<style scoped>
.repeatable-label {
  font-size: var(--font-size-sm);
  color: var(--mobile-text-muted);
}

.repeatable-seg {
  border-radius: var(--bc-radius-control);
  background: var(--mobile-bg-primary);
  border: 1px solid var(--mobile-border);
}

.repeatable-opt {
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: var(--mobile-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  transition:
    background-color var(--bc-dur-fast) var(--bc-ease),
    color var(--bc-dur-fast) var(--bc-ease);
}

.repeatable-opt--on {
  background: var(--mobile-bg-elevated);
  color: var(--mobile-text-primary);
  border-color: var(--mobile-border-active);
}

.repeatable-hint {
  font-size: var(--font-size-sm);
  line-height: 1.45;
}
</style>
