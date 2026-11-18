<template>
  <!-- 设置面板遮罩：点击关闭 -->
  <transition name="settings-backdrop">
    <div
      v-if="open"
      class="absolute inset-0 top-10 z-20 bg-black/25"
      data-testid="terminal-settings-backdrop"
      @click="emit('update:open', false)"
    ></div>
  </transition>

  <!-- 设置面板：从右侧滑出（父容器需 relative；top-10 让开 40px 工具条） -->
  <transition name="settings-panel">
    <aside
      v-if="open"
      class="absolute top-10 right-0 bottom-0 z-30 w-64 flex flex-col bg-[var(--bg-card)] border-l border-[var(--border)] shadow-xl"
      data-testid="terminal-settings-panel"
    >
      <div
        class="h-10 shrink-0 px-4 flex items-center justify-between border-b border-[var(--border)]"
      >
        <span class="text-[calc(13px*var(--ui-scale))] font-semibold text-[var(--text-primary)]">
          {{ t('session.terminal.settings') }}
        </span>
        <button
          class="w-6 h-6 shrink-0 rounded-[6px] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          :title="t('session.terminal.close')"
          data-testid="terminal-settings-close"
          @click="emit('update:open', false)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-5">
        <!-- 终端主题 -->
        <div>
          <span
            class="block mb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >{{ t('session.terminal.theme') }}</span
          >
          <select
            class="w-full h-8 rounded-[6px] px-2 cursor-pointer text-[calc(12px*var(--ui-scale))] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-brand"
            :value="theme"
            data-testid="terminal-theme-select"
            @change="emit('update:theme', ($event.target as HTMLSelectElement).value)"
            @click.stop
            @mousedown.stop
          >
            <option v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 字体大小 -->
        <div>
          <span
            class="block mb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >{{ t('session.terminal.fontSize') }}</span
          >
          <select
            class="w-full h-8 rounded-[6px] px-2 cursor-pointer text-[calc(12px*var(--ui-scale))] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-brand"
            :value="fontSize"
            data-testid="terminal-font-size-select"
            @change="emit('update:fontSize', Number(($event.target as HTMLSelectElement).value))"
            @click.stop
            @mousedown.stop
          >
            <option v-for="opt in fontSizeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 字间距（xterm letterSpacing 选项：格宽同步膨胀，网格保持对齐） -->
        <div>
          <span
            class="block mb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
            >{{ t('session.terminal.letterSpacing') }}</span
          >
          <select
            class="w-full h-8 rounded-[6px] px-2 cursor-pointer text-[calc(12px*var(--ui-scale))] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-brand"
            :value="letterSpacing"
            data-testid="terminal-letter-spacing-select"
            @change="
              emit('update:letterSpacing', Number(($event.target as HTMLSelectElement).value))
            "
            @click.stop
            @mousedown.stop
          >
            <option v-for="opt in letterSpacingOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 背景图片 -->
        <div class="space-y-3">
          <div>
            <span
              class="block mb-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
              >{{ t('session.terminal.bgImage') }}</span
            >
            <div class="flex items-center gap-2">
              <button
                class="wb-btn-ghost !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                data-testid="terminal-bg-pick"
                @click="emit('pick-bg')"
                @mousedown.stop
              >
                {{ t('session.terminal.bgImageSelect') }}
              </button>
              <button
                v-if="hasBgImage"
                class="wb-btn-ghost !h-7 !px-2.5 text-[calc(11px*var(--ui-scale))]"
                data-testid="terminal-bg-remove"
                @click="emit('remove-bg')"
                @mousedown.stop
              >
                {{ t('session.terminal.bgImageRemove') }}
              </button>
            </div>
            <span
              v-if="bgImageName"
              class="block mt-1 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] truncate"
            >
              {{ bgImageName }}
            </span>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">{{
                t('session.terminal.bgImageOpacity')
              }}</span>
              <span class="wb-mono">{{ bgOpacity }}%</span>
            </div>
            <input
              :value="bgOpacity"
              type="range"
              min="0"
              max="100"
              step="1"
              class="w-full h-1 appearance-none bg-[var(--border-strong)] cursor-pointer accent-[var(--color-primary)]"
              data-testid="terminal-bg-opacity"
              @input="emit('update:bgOpacity', Number(($event.target as HTMLInputElement).value))"
              @click.stop
            />
          </div>
        </div>
      </div>
    </aside>
  </transition>
</template>

<script setup lang="ts">
/**
 * 终端设置抽屉（工作台终端 pane 与独立终端窗口共用）
 *
 * 纯受控：取值经 props 传入、改动经 emit 回抛。为什么不做成自持状态：
 * 主题/字号/字间距的**真值在 `TerminalPreview` 暴露的 ref 上**（改了要立刻
 * 作用到 xterm 并按既有防抖链持久化），面板不该成为第二份状态源。
 */
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

interface SelectOption {
  value: string | number
  label: string
}

defineProps<{
  open: boolean
  theme: string
  fontSize: number
  letterSpacing: number
  bgOpacity: number
  hasBgImage: boolean
  bgImageName: string
  themeOptions: SelectOption[]
  fontSizeOptions: SelectOption[]
  letterSpacingOptions: SelectOption[]
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'update:theme': [string]
  'update:fontSize': [number]
  'update:letterSpacing': [number]
  'update:bgOpacity': [number]
  'pick-bg': []
  'remove-bg': []
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, unknown>) => context.i18n.t(key, params)
</script>

<style scoped>
/* 设置面板滑出过渡：will-change 提升为独立合成层，避免动画期间页面抖动 */
.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: transform 0.25s ease;
  will-change: transform;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  transform: translateX(100%);
}

/* 设置面板遮罩淡入淡出 */
.settings-backdrop-enter-active,
.settings-backdrop-leave-active {
  transition: opacity 0.2s ease;
  will-change: opacity;
}
</style>
