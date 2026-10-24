<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div
        v-if="visible"
        class="fixed inset-0 flex items-end justify-center mobile-ui"
        :style="{ zIndex: zIndex }"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-[var(--mobile-overlay-light)]" @click="emit('close')"></div>
        <div class="relative bg-[var(--mobile-bg-card)] border border-[var(--mobile-border)] rounded-t-2xl w-full max-w-lg max-h-[min(85vh,44rem)] flex flex-col shadow-xl modal-panel">
          <!-- 拖拽指示条 -->
          <div class="flex justify-center pt-2">
            <div class="w-10 h-1 rounded-full bg-[var(--mobile-border)]"></div>
          </div>

          <!-- Header -->
          <div class="flex items-center justify-between px-4 pt-2 pb-3">
            <span class="font-semibold text-[var(--mobile-text-primary)] text-base">{{ t('codeViewer.settingsTitle') }}</span>
            <button class="icon-btn" :aria-label="t('file.close')" @click="emit('close')">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Tab 切换：排版 / 代码主题（形态对齐快捷键配置弹窗） -->
          <div class="px-4 pb-3 flex-shrink-0">
            <div class="segmented">
              <button
                class="segmented-btn"
                :class="{ active: activeTab === 'editor' }"
                @click="activeTab = 'editor'"
              >
                {{ t('codeViewer.tabEditor') }}
              </button>
              <button
                class="segmented-btn"
                :class="{ active: activeTab === 'theme' }"
                @click="activeTab = 'theme'"
              >
                {{ t('codeViewer.tabTheme') }}
              </button>
            </div>
          </div>

          <!-- ==================== Tab: 排版 ==================== -->
          <template v-if="activeTab === 'editor'">
            <div class="settings-content" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
              <!-- 字体大小 -->
              <div class="settings-section">
                <label class="settings-label">{{ t('codeViewer.fontSize') }}</label>
                <div class="font-size-control">
                  <button class="size-btn" :disabled="store.settings.fontSize <= 6" @click.stop="apply({ fontSize: store.settings.fontSize - 1 })">-</button>
                  <span class="size-value">{{ store.settings.fontSize }}px</span>
                  <button class="size-btn" :disabled="store.settings.fontSize >= 24" @click.stop="apply({ fontSize: store.settings.fontSize + 1 })">+</button>
                </div>
              </div>

              <!-- 行间距 -->
              <div class="settings-section">
                <label class="settings-label">{{ t('codeViewer.lineHeight') }}</label>
                <div class="slider-control">
                  <span class="slider-value">{{ store.settings.lineHeight.toFixed(1) }}</span>
                  <input
                    type="range"
                    class="slider-track"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    :value="store.settings.lineHeight"
                    @input="apply({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <span class="slider-range-label">0.5 – 2.5</span>
                </div>
              </div>

              <!-- Tab 缩进 -->
              <div class="settings-section">
                <label class="settings-label">{{ t('codeViewer.tabIndent') }}</label>
                <div class="tab-size-group">
                  <button
                    v-for="size in [2, 4, 8]"
                    :key="size"
                    class="tab-size-btn"
                    :class="{ active: store.settings.tabSize === size }"
                    @click.stop="apply({ tabSize: size })"
                  >{{ size }}</button>
                </div>
              </div>

              <!-- 行号显示 -->
              <div class="settings-section">
                <div class="toggle-row">
                  <span class="settings-label" style="margin-bottom:0">{{ t('codeViewer.lineNumbers') }}</span>
                  <button
                    class="toggle-btn"
                    :class="{ active: store.settings.showLineNumbers }"
                    :aria-pressed="store.settings.showLineNumbers"
                    @click.stop="apply({ showLineNumbers: !store.settings.showLineNumbers })"
                  >
                    <span
                      class="toggle-thumb"
                      :class="{ on: store.settings.showLineNumbers }"
                    ></span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- ==================== Tab: 代码主题 ==================== -->
          <template v-else>
            <div class="settings-content" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
              <div class="settings-section">
                <label class="settings-label">{{ t('codeViewer.codeTheme') }}</label>
                <div class="theme-grid">
                  <button
                    v-for="(config, id) in CODE_THEMES"
                    :key="id"
                    class="theme-btn"
                    :class="{ active: store.settings.theme === id }"
                    @click.stop="apply({ theme: id })"
                  >
                    <span class="theme-preview" :style="{ background: config.background, color: config.foreground }">Aa</span>
                    <span class="theme-name">{{ resolveThemeLabel(config.label, t) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * CodeViewerSettingsModal - 代码查看设置弹窗（#17 范式统一：bottom sheet + 即改即存）
 *
 * 无草稿：控件直接读写 codeViewer store，每次交互立即 saveSettings 持久化并生效
 * （查看器实时反应即预览；持久化失败由 store toast 显性提示）；无确认/取消 footer，
 * 关闭不丢已生效修改。Tab 不再每次打开重置：无丢稿风险后，停留页即用户上下文。
 */
import { ref } from 'vue'
import { useFileExplorerHost } from '../host'
import { useSwipeTabs } from '../composables/useSwipeTabs'
import { useCodeViewerStore, CODE_THEMES, type CodeViewerSettings } from '../stores/codeViewer'
import { resolveThemeLabel } from '../utils/themeLabel'

const { t } = useFileExplorerHost()

const props = withDefaults(defineProps<{
  visible: boolean
  /** 覆盖层 z-index，默认 100（bottom sheet 层级）；嵌套在高层级弹窗中时应传入更高值 */
  zIndex?: number
}>(), {
  zIndex: 100,
})

const emit = defineEmits<{
  close: []
}>()

const store = useCodeViewerStore()

// ==================== Tab 状态 ====================

/** 设置分组 Tab：排版（字体/行距/缩进/行号）与代码主题 */
type SettingsTab = 'editor' | 'theme'
const activeTab = ref<SettingsTab>('editor')

// 内容区左右滑动切换 Tab：左滑 → 代码主题，右滑 → 排版
const { onTouchStart, onTouchMove, onTouchEnd } = useSwipeTabs((dir) => {
  if (dir === 'left' && activeTab.value === 'editor') activeTab.value = 'theme'
  else if (dir === 'right' && activeTab.value === 'theme') activeTab.value = 'editor'
})

/** 即改即存出口：以 store 当前值为基线合并 patch，整包保存（内存态即时生效） */
function apply(patch: Partial<CodeViewerSettings>) {
  store.saveSettings({ ...store.settings, ...patch })
}
</script>

<style scoped>
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  color: var(--mobile-text-muted);
  transition: all 0.15s ease;
}

.icon-btn:hover,
.icon-btn:active {
  background: var(--mobile-accent-muted);
  color: var(--mobile-text-primary);
}

.settings-content {
  --size-btn: 2.75rem;
  --thumb-size: clamp(1.25rem, 1.5rem, 1.75rem); /* 默认 24px，满足手指滑动触摸目标 */
  --toggle-w: clamp(2.25rem, 2.75rem, 3.25rem);
  --toggle-h: clamp(1.25rem, 1.5rem, 1.75rem);

  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 1rem calc(var(--safe-area-bottom, 0px) + 1rem);
}

/* 分段控件（同快捷键配置弹窗） */
.segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--mobile-bg-elevated);
  border: 1px solid var(--mobile-border);
  border-radius: 0.75rem;
}

.segmented-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  height: 2.25rem;
  font-size: var(--font-size-sm);
  font-weight: 500;
  border-radius: 0.5rem;
  color: var(--mobile-text-muted);
  transition: all 0.2s ease;
  background: none;
  border: none;
  cursor: pointer;
}

.segmented-btn.active {
  background: var(--mobile-bg-card);
  color: var(--mobile-text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.settings-section {
  margin-bottom: 1.5rem;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-label {
  display: block;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--mobile-text-muted);
  margin-bottom: 0.75rem;
}

/* 字体大小控制 */
.font-size-control {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.size-btn {
  width: var(--size-btn);
  height: var(--size-btn);
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 1px solid var(--mobile-border);
  color: var(--mobile-text-primary);
  font-size: clamp(1rem, 1.25rem, 1.5rem);
  cursor: pointer;
  transition: all 0.2s ease;
}

.size-btn:hover:not(:disabled) {
  background: var(--mobile-bg-hover);
}

.size-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.size-value {
  flex: 1;
  text-align: center;
  font-size: clamp(1rem, 1.125rem, 1.25rem);
  font-weight: 500;
  color: var(--mobile-text-primary);
}

/* 主题网格 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(0.375rem, 0.5rem, 0.75rem);
}

.theme-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  padding: clamp(0.5rem, 0.75rem, 1rem) clamp(0.375rem, 0.5rem, 0.75rem);
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-btn:hover {
  background: var(--mobile-bg-hover);
}

.theme-btn.active {
  border-color: var(--mobile-accent);
  background: var(--mobile-accent-muted);
  box-shadow: 0 0 12px var(--mobile-accent-muted);
}

.theme-preview {
  width: 100%;
  padding: 0.5rem;
  border-radius: 0.375rem;
  text-align: center;
  font-size: clamp(0.75rem, 0.875rem, 1rem);
  font-weight: 600;
  font-family: 'Fira Code', 'JetBrains Mono', monospace;
}

.theme-name {
  font-size: clamp(0.625rem, 0.75rem, 0.875rem);
  color: var(--mobile-text-muted);
}

.theme-btn.active .theme-name {
  color: var(--mobile-accent);
  font-weight: 600;
}

/* Tab 缩进按钮组 */
.tab-size-group {
  display: flex;
  gap: clamp(0.375rem, 0.5rem, 0.75rem);
}

.tab-size-btn {
  flex: 1;
  padding: clamp(0.5rem, 0.625rem, 0.75rem);
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 2px solid transparent;
  color: var(--mobile-text-secondary);
  font-size: clamp(0.75rem, 0.875rem, 1rem);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-size-btn:hover {
  background: var(--mobile-bg-hover);
}

.tab-size-btn.active {
  border-color: var(--mobile-accent);
  background: var(--mobile-accent-muted);
  color: var(--mobile-accent);
  font-weight: 600;
}

/* 行号 toggle */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 行间距滑块 */
.slider-control {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.slider-value {
  font-size: clamp(1rem, 1.125rem, 1.25rem);
  font-weight: 500;
  color: var(--mobile-text-primary);
}

.slider-track {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: clamp(4px, 6px, 8px);
  border-radius: 3px;
  background: var(--mobile-bg-elevated);
  outline: none;
  cursor: pointer;
}

.slider-track::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: var(--mobile-accent);
  border: none;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease;
}

.slider-track::-webkit-slider-thumb:active {
  transform: scale(1.15);
}

.slider-track::-moz-range-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  border-radius: 50%;
  background: var(--mobile-accent);
  border: none;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.slider-track::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--mobile-bg-elevated);
}

.slider-range-label {
  font-size: clamp(0.625rem, 0.75rem, 0.875rem);
  color: var(--mobile-text-muted);
  text-align: right;
}

/* 开关样式与桌面端 SettingsView 对齐：方形墨色轨道 + 方形滑块（尺寸保留移动端 clamp 触控规格） */
.toggle-btn {
  width: var(--toggle-w);
  height: var(--toggle-h);
  border-radius: 0.25rem;
  background: var(--mobile-bg-primary);
  border: 1px solid var(--mobile-border-hover);
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
}

.toggle-btn.active {
  background: var(--mobile-accent);
  border-color: var(--mobile-accent);
}

.toggle-thumb {
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: calc(var(--toggle-h) - 0.5rem);
  height: calc(var(--toggle-h) - 0.5rem);
  border-radius: 0.125rem;
  background: var(--mobile-bg-tertiary);
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.toggle-thumb.on {
  transform: translateX(calc(var(--toggle-w) - var(--toggle-h)));
  background: var(--mobile-text-on-accent);
}
</style>
