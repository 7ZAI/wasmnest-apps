<template>
  <div class="stepper-control">
    <button
      type="button"
      class="size-btn"
      :disabled="disabled || modelValue <= min"
      :aria-label="`${label} -1`"
      @click.stop="step(-1)"
    >-</button>
    <span class="size-value">{{ modelValue }}{{ unit }}</span>
    <button
      type="button"
      class="size-btn"
      :disabled="disabled || modelValue >= max"
      :aria-label="`${label} +1`"
      @click.stop="step(1)"
    >+</button>
  </div>
</template>

<script setup lang="ts">
/**
 * 数值步进器（#18 收敛件）——设置面步进控件共用（终端字号/字间距/快捷栏数、
 * 代码查看字号、业务设置数值项）。边界即禁用态；aria-label 按「<label> ±1」生成
 * （口径同 SettingsPage 既有实现）。
 * 类名保留 size-btn / size-value：既有测试与样式口径不动。
 */
defineOptions({ name: 'StepperControl' })

const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  /** 无障碍标签（生成「<label> -1 / +1」aria-label） */
  label: string
  /** 数值后缀（如 px），空则纯数字 */
  unit?: string
  disabled?: boolean
}>(), {
  unit: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function step(delta: number) {
  const next = Math.min(Math.max(props.modelValue + delta, props.min), props.max)
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<style scoped>
/* 尺寸随视口流式缩放：360px 小屏 36px 按钮 / 8px 间距，1200px 及以上 44px / 16px。
   与平台 --font-size-* 同一档位曲线（360 → 1200 线性插值）；设置页行内步进器
   在窄屏不再固定占掉近半行、把标签挤成多行。 */
.stepper-control {
  display: flex;
  align-items: center;
  gap: clamp(0.5rem, 0.5rem + (100vw - 360px) / 840 * 8, 1rem);
}

.size-btn {
  width: clamp(2.25rem, 2.25rem + (100vw - 360px) / 840 * 8, 2.75rem);
  height: clamp(2.25rem, 2.25rem + (100vw - 360px) / 840 * 8, 2.75rem);
  border-radius: 0.5rem;
  /* 只显示符号，不画按钮底板：暗色主题下 --mobile-bg-elevated 会形成一块黑色方块，
     与「设置项右侧的 + / − 就是两个符号」的视觉预期不符。触控目标尺寸保持不变。 */
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--mobile-accent);
  font-weight: 600;
  line-height: 1;
  -webkit-appearance: none;
  appearance: none;
  /* 取平台流式字阶（同时接受「字体大小」偏好），不再用裸 clamp 固定 */
  font-size: var(--font-size-lg);
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.size-btn:hover:not(:disabled),
.size-btn:active:not(:disabled) {
  /* hover / 按下只降透明度：不再铺一层方块底色 */
  background: transparent;
  opacity: 0.65;
}

.size-btn:disabled {
  color: var(--mobile-accent);
  opacity: 0.35;
  cursor: not-allowed;
}

.size-value {
  flex: 1;
  min-width: 3ch;
  text-align: center;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--mobile-text-primary);
}
</style>
