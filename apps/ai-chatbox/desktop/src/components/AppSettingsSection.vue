<template>
  <div class="space-y-5">
    <!-- 分组：代码渲染 -->
    <section>
      <h4 class="mb-2 text-xs font-medium text-[var(--text-secondary)]">
        {{ t('com.wasmnest.ai-chatbox.codeRendering') }}
      </h4>
      <div
        class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]"
      >
        <!-- 字体大小：− / 数值 / ＋（11-18px 步进 1） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.codeFontSize') }}
          </span>
          <div class="flex items-center gap-1.5">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-btn border border-[var(--border-input)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="config.codeFontSize <= CODE_FONT_SIZE_MIN"
              :aria-label="t('com.wasmnest.ai-chatbox.decrease')"
              @click="update({ codeFontSize: config.codeFontSize - 1 })"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 12H4"
                />
              </svg>
            </button>
            <span
              class="w-9 text-center text-sm text-[var(--text-primary)] tabular-nums"
              data-testid="code-font-size"
            >
              {{ config.codeFontSize }}
            </span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-btn border border-[var(--border-input)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="config.codeFontSize >= CODE_FONT_SIZE_MAX"
              :aria-label="t('com.wasmnest.ai-chatbox.increase')"
              @click="update({ codeFontSize: config.codeFontSize + 1 })"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 行距：自绘滑块（0.5-2.0，步进 0.1，即拖即存） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.codeLineHeight') }}
          </span>
          <div class="flex items-center gap-3 w-64 flex-shrink-0">
            <div
              ref="lineHeightTrack"
              class="relative h-6 flex-1 min-w-0 flex items-center cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] rounded-full"
              role="slider"
              tabindex="0"
              :aria-label="t('com.wasmnest.ai-chatbox.codeLineHeight')"
              :aria-valuemin="CODE_LINE_HEIGHT_MIN"
              :aria-valuemax="CODE_LINE_HEIGHT_MAX"
              :aria-valuenow="config.codeLineHeight"
              @pointerdown="lineHeightSlider.onPointerDown"
              @pointermove="lineHeightSlider.onPointerMove"
              @pointerup="lineHeightSlider.onPointerEnd"
              @pointercancel="lineHeightSlider.onPointerEnd"
              @keydown.left.prevent="lineHeightSlider.stepBy(-1)"
              @keydown.right.prevent="lineHeightSlider.stepBy(1)"
              @keydown.home.prevent="lineHeightSlider.stepTo(CODE_LINE_HEIGHT_MIN)"
              @keydown.end.prevent="lineHeightSlider.stepTo(CODE_LINE_HEIGHT_MAX)"
            >
              <div
                class="absolute left-0 right-0 h-1 rounded-full bg-[var(--border)] pointer-events-none"
              ></div>
              <div
                class="absolute h-1 rounded-full bg-brand pointer-events-none"
                :style="{ width: lineHeightSlider.fillPercent.value }"
              ></div>
              <div
                class="absolute w-3.5 h-3.5 rounded-full bg-brand border-2 border-[var(--bg-card)] shadow-sm pointer-events-none"
                :style="{ left: `calc(${lineHeightSlider.fillPercent.value} - 7px)` }"
              ></div>
            </div>
            <span
              class="w-10 text-right text-sm text-[var(--text-primary)] tabular-nums"
              data-testid="code-line-height"
            >
              {{ config.codeLineHeight.toFixed(1) }}
            </span>
          </div>
        </div>

        <!-- 代码主题：SDK 下拉（跟随 / 浅色 / 深色 / 具名风格） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.codeTheme') }}
          </span>
          <Select
            class="w-44 flex-shrink-0"
            size="sm"
            :model-value="config.codeTheme"
            :options="themeOptions"
            @update:model-value="onThemeChange"
          />
        </div>
      </div>
    </section>

    <!-- 分组：思考模式 -->
    <section>
      <h4 class="mb-2 text-xs font-medium text-[var(--text-secondary)]">
        {{ t('com.wasmnest.ai-chatbox.thinking') }}
      </h4>
      <div
        class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]"
      >
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.thinkingMode') }}
          </span>
          <SegmentedControl
            :options="thinkingModeOptions"
            :model-value="config.thinkingMode"
            @change="(v: string) => update({ thinkingMode: v as PluginConfig['thinkingMode'] })"
          />
        </div>

        <!-- 推理强度：仅思考模式为「强制开启」时生效 -->
        <div
          v-if="config.thinkingMode === 'enabled'"
          class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]"
        >
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.reasoningEffort') }}
          </span>
          <SegmentedControl
            :options="effortOptions"
            :model-value="config.reasoningEffort"
            @change="
              (v: string) => update({ reasoningEffort: v as PluginConfig['reasoningEffort'] })
            "
          />
        </div>

        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.showReasoning') }}
          </span>
          <SegmentedControl
            :options="showReasoningOptions"
            :model-value="config.showReasoning ? 'on' : 'off'"
            @change="(v: string) => update({ showReasoning: v === 'on' })"
          />
        </div>
      </div>
    </section>

    <!-- 分组：限流重试（429/503/529 自动重试，指数退避） -->
    <section>
      <h4 class="mb-2 text-xs font-medium text-[var(--text-secondary)]">
        {{ t('com.wasmnest.ai-chatbox.rateLimitGroup') }}
      </h4>
      <div
        class="rounded-card border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]"
      >
        <!-- 自动重试次数：− / 数值 / ＋（0-10，0 = 关闭） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.rateLimitMaxRetries') }}
          </span>
          <div class="flex items-center gap-1.5">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-btn border border-[var(--border-input)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="config.rateLimitMaxRetries <= RATE_LIMIT_MAX_RETRIES_MIN"
              :aria-label="t('com.wasmnest.ai-chatbox.decrease')"
              @click="update({ rateLimitMaxRetries: config.rateLimitMaxRetries - 1 })"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 12H4"
                />
              </svg>
            </button>
            <span
              class="w-12 text-center text-sm text-[var(--text-primary)] tabular-nums"
              data-testid="rate-limit-max-retries"
            >
              {{
                config.rateLimitMaxRetries === 0
                  ? t('com.wasmnest.ai-chatbox.rateLimitOff')
                  : config.rateLimitMaxRetries
              }}
            </span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-btn border border-[var(--border-input)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="config.rateLimitMaxRetries >= RATE_LIMIT_MAX_RETRIES_MAX"
              :aria-label="t('com.wasmnest.ai-chatbox.increase')"
              @click="update({ rateLimitMaxRetries: config.rateLimitMaxRetries + 1 })"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 初始等待：滑块 0.5s-10s（步进 0.5s，即拖即存，ms 存储） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.rateLimitInitialDelay') }}
          </span>
          <div class="flex items-center gap-3 w-64 flex-shrink-0">
            <div
              ref="initialDelayTrack"
              class="relative h-6 flex-1 min-w-0 flex items-center cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] rounded-full"
              role="slider"
              tabindex="0"
              :aria-label="t('com.wasmnest.ai-chatbox.rateLimitInitialDelay')"
              :aria-valuemin="INITIAL_DELAY_MIN"
              :aria-valuemax="INITIAL_DELAY_MAX"
              :aria-valuenow="config.rateLimitInitialDelayMs"
              @pointerdown="initialDelaySlider.onPointerDown"
              @pointermove="initialDelaySlider.onPointerMove"
              @pointerup="initialDelaySlider.onPointerEnd"
              @pointercancel="initialDelaySlider.onPointerEnd"
              @keydown.left.prevent="initialDelaySlider.stepBy(-1)"
              @keydown.right.prevent="initialDelaySlider.stepBy(1)"
              @keydown.home.prevent="initialDelaySlider.stepTo(INITIAL_DELAY_MIN)"
              @keydown.end.prevent="initialDelaySlider.stepTo(INITIAL_DELAY_MAX)"
            >
              <div
                class="absolute left-0 right-0 h-1 rounded-full bg-[var(--border)] pointer-events-none"
              ></div>
              <div
                class="absolute h-1 rounded-full bg-brand pointer-events-none"
                :style="{ width: initialDelaySlider.fillPercent.value }"
              ></div>
              <div
                class="absolute w-3.5 h-3.5 rounded-full bg-brand border-2 border-[var(--bg-card)] shadow-sm pointer-events-none"
                :style="{ left: `calc(${initialDelaySlider.fillPercent.value} - 7px)` }"
              ></div>
            </div>
            <span
              class="w-12 text-right text-sm text-[var(--text-primary)] tabular-nums"
              data-testid="rate-limit-initial-delay"
            >
              {{ fmtSeconds(config.rateLimitInitialDelayMs) }}
            </span>
          </div>
        </div>

        <!-- 最大等待：滑块 5s-60s（步进 5s，指数退避封顶值） -->
        <div class="flex items-center justify-between gap-4 px-3.5 py-2.5 min-h-[3rem]">
          <span class="text-sm text-[var(--text-primary)]">
            {{ t('com.wasmnest.ai-chatbox.rateLimitMaxDelay') }}
          </span>
          <div class="flex items-center gap-3 w-64 flex-shrink-0">
            <div
              ref="maxDelayTrack"
              class="relative h-6 flex-1 min-w-0 flex items-center cursor-pointer touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] rounded-full"
              role="slider"
              tabindex="0"
              :aria-label="t('com.wasmnest.ai-chatbox.rateLimitMaxDelay')"
              :aria-valuemin="MAX_DELAY_MIN"
              :aria-valuemax="MAX_DELAY_MAX"
              :aria-valuenow="config.rateLimitMaxDelayMs"
              @pointerdown="maxDelaySlider.onPointerDown"
              @pointermove="maxDelaySlider.onPointerMove"
              @pointerup="maxDelaySlider.onPointerEnd"
              @pointercancel="maxDelaySlider.onPointerEnd"
              @keydown.left.prevent="maxDelaySlider.stepBy(-1)"
              @keydown.right.prevent="maxDelaySlider.stepBy(1)"
              @keydown.home.prevent="maxDelaySlider.stepTo(MAX_DELAY_MIN)"
              @keydown.end.prevent="maxDelaySlider.stepTo(MAX_DELAY_MAX)"
            >
              <div
                class="absolute left-0 right-0 h-1 rounded-full bg-[var(--border)] pointer-events-none"
              ></div>
              <div
                class="absolute h-1 rounded-full bg-brand pointer-events-none"
                :style="{ width: maxDelaySlider.fillPercent.value }"
              ></div>
              <div
                class="absolute w-3.5 h-3.5 rounded-full bg-brand border-2 border-[var(--bg-card)] shadow-sm pointer-events-none"
                :style="{ left: `calc(${maxDelaySlider.fillPercent.value} - 7px)` }"
              ></div>
            </div>
            <span
              class="w-12 text-right text-sm text-[var(--text-primary)] tabular-nums"
              data-testid="rate-limit-max-delay"
            >
              {{ fmtSeconds(config.rateLimitMaxDelayMs) }}
            </span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AppSettingsSection — 桌面端应用级设置分区（设置归属：wasm-app 自持）
 *
 * 宿主已无「插件统一设置页」（原由 contributes.configuration schema 渲染），
 * 应用配置改由应用自己承载：本分区即移动端 AppSettingsSection 的桌面等价物，
 * 嵌在应用配置页的设置视图内（默认视图，设置项目直接展示、无需跳转）——同一份配置（storage key
 * `config`）与同一组取值域，分为代码渲染（字体大小 / 行距 / 高亮主题）+
 * 思考（思考模式 / 推理强度 / 显示思考过程）+ 限流重试（次数 / 初始等待 /
 * 最大等待）三组。
 *
 * 即改即存：任何变更都 emit 整表 `change`，由父级（ProviderConfigPage →
 * ChatView）经 usePluginConfig.saveConfig 写宿主 storage；父级 props 回填后重新渲染。
 */
import { computed, defineComponent, h, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import type { PluginConfig } from '../types'
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_LINE_HEIGHT_MAX,
  CODE_LINE_HEIGHT_MIN,
  RATE_LIMIT_MAX_RETRIES_MAX,
  RATE_LIMIT_MAX_RETRIES_MIN,
} from '../types'
import { roundToStep, sliderFillPercent, sliderValueFromClientX } from '../utils/settingSlider'

/** 分段选择器（自绘，不用原生控件；选中态走品牌色） */
const SegmentedControl = defineComponent({
  name: 'SegmentedControl',
  props: {
    options: { type: Array as () => { value: string; label: string }[], required: true },
    modelValue: { type: String, required: true },
  },
  emits: ['change'],
  setup(props, { emit }) {
    return () =>
      h(
        'div',
        {
          class:
            'flex items-center gap-0.5 p-0.5 rounded-btn border border-[var(--border)] bg-[var(--bg-hover)]',
        },
        (props.options as { value: string; label: string }[]).map((opt) =>
          h(
            'button',
            {
              class:
                'h-7 px-2.5 min-w-[3rem] rounded-[6px] text-xs transition-colors duration-150 ' +
                (opt.value === props.modelValue
                  ? 'bg-brand text-[var(--color-primary-contrast)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)]'),
              onClick: () => emit('change', opt.value),
            },
            opt.label,
          ),
        ),
      )
  },
})

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

const props = defineProps<{ config: PluginConfig }>()

const emit = defineEmits<{
  /** 配置变更（整表；父级即改即存写宿主 storage） */
  change: [next: PluginConfig]
}>()

const { t } = useI18n()

const config = computed(() => props.config)

function update(patch: Partial<PluginConfig>): void {
  emit('change', { ...config.value, ...patch })
}

// ==================== 滑块的 UI 取值域（与移动端设置弹层逐字一致） ====================

/** 初始等待滑块 0.5s-10s（步进 0.5s；ms 存储） */
const INITIAL_DELAY_MIN = 500
const INITIAL_DELAY_MAX = 10000
const INITIAL_DELAY_STEP = 500
/** 最大等待滑块 5s-60s（步进 5s；指数退避封顶值） */
const MAX_DELAY_MIN = 5000
const MAX_DELAY_MAX = 60000
const MAX_DELAY_STEP = 5000

type NumericConfigKey = 'codeLineHeight' | 'rateLimitInitialDelayMs' | 'rateLimitMaxDelayMs'

/**
 * 指针滑块工厂（轨道 + 填充 + thumb；pointer 捕获后拖出轨道仍持续更新，
 * 键盘可聚焦并用 ← → / Home / End 调整）
 */
function makeSlider(
  trackRef: Ref<HTMLElement | null>,
  key: NumericConfigKey,
  min: number,
  max: number,
  step: number,
) {
  let dragging = false
  const fillPercent = computed(() => sliderFillPercent(config.value[key], min, max))
  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.value?.getBoundingClientRect() ?? { left: 0, width: 0 }
    return sliderValueFromClientX(clientX, rect, min, max, step, config.value[key])
  }
  return {
    fillPercent,
    onPointerDown(e: PointerEvent): void {
      dragging = true
      // 捕获指针：拖出轨道范围仍持续更新；松手/取消统一复位
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      update({ [key]: valueFromClientX(e.clientX) })
    },
    onPointerMove(e: PointerEvent): void {
      if (!dragging) return
      update({ [key]: valueFromClientX(e.clientX) })
    },
    onPointerEnd(): void {
      dragging = false
    },
    /** 键盘：按步进增减（夹取到 [min, max]，浮点尾巴按 step 精度归整） */
    stepBy(steps: number): void {
      const next = Math.min(Math.max(config.value[key] + steps * step, min), max)
      update({ [key]: roundToStep(next, step) })
    },
    stepTo(value: number): void {
      update({ [key]: value })
    },
  }
}

const lineHeightTrack = ref<HTMLElement | null>(null)
const initialDelayTrack = ref<HTMLElement | null>(null)
const maxDelayTrack = ref<HTMLElement | null>(null)

const lineHeightSlider = makeSlider(
  lineHeightTrack,
  'codeLineHeight',
  CODE_LINE_HEIGHT_MIN,
  CODE_LINE_HEIGHT_MAX,
  0.1,
)
const initialDelaySlider = makeSlider(
  initialDelayTrack,
  'rateLimitInitialDelayMs',
  INITIAL_DELAY_MIN,
  INITIAL_DELAY_MAX,
  INITIAL_DELAY_STEP,
)
const maxDelaySlider = makeSlider(
  maxDelayTrack,
  'rateLimitMaxDelayMs',
  MAX_DELAY_MIN,
  MAX_DELAY_MAX,
  MAX_DELAY_STEP,
)

/** 毫秒 → 秒文案（整数省小数：1s / 1.5s / 30s） */
function fmtSeconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's'
}

// ==================== 代码主题（SDK 下拉） ====================

const themeOptions = computed<SegmentedOption<PluginConfig['codeTheme']>[]>(() => [
  { value: 'auto', label: t('com.wasmnest.ai-chatbox.codeThemeAuto') },
  { value: 'light', label: t('com.wasmnest.ai-chatbox.codeThemeLight') },
  { value: 'dark', label: t('com.wasmnest.ai-chatbox.codeThemeDark') },
  { value: 'github-light', label: t('com.wasmnest.ai-chatbox.codeThemeGithubLight') },
  { value: 'github-dark', label: t('com.wasmnest.ai-chatbox.codeThemeGithubDark') },
  { value: 'dracula', label: t('com.wasmnest.ai-chatbox.codeThemeDracula') },
])

function onThemeChange(value: string | number): void {
  update({ codeTheme: String(value) as PluginConfig['codeTheme'] })
}

// ==================== 思考模式 / 限流重试 选项 ====================

const thinkingModeOptions = computed<SegmentedOption<PluginConfig['thinkingMode']>[]>(() => [
  { value: 'default', label: t('com.wasmnest.ai-chatbox.thinkingDefault') },
  { value: 'enabled', label: t('com.wasmnest.ai-chatbox.thinkingEnabled') },
  { value: 'disabled', label: t('com.wasmnest.ai-chatbox.thinkingDisabled') },
])

const effortOptions = computed<SegmentedOption<PluginConfig['reasoningEffort']>[]>(() => [
  { value: 'low', label: t('com.wasmnest.ai-chatbox.effortLow') },
  { value: 'high', label: t('com.wasmnest.ai-chatbox.effortHigh') },
  { value: 'max', label: t('com.wasmnest.ai-chatbox.effortMax') },
])

const showReasoningOptions = computed<SegmentedOption<'on' | 'off'>[]>(() => [
  { value: 'on', label: t('com.wasmnest.ai-chatbox.show') },
  { value: 'off', label: t('com.wasmnest.ai-chatbox.hide') },
])
</script>
