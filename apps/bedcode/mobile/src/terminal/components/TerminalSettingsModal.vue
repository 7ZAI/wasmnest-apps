<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div
        v-if="visible"
        class="fixed inset-0 z-[100] flex items-end justify-center mobile-ui"
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
            <span class="font-semibold text-[var(--mobile-text-primary)] text-base">{{ t('terminal.terminalSettings') }}</span>
            <button class="icon-btn" :aria-label="t('common.button.close')" @click="emit('close')">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Tab 切换：外观 / 杂项配置（形态对齐快捷键配置弹窗） -->
          <div class="px-4 pb-3 flex-shrink-0">
            <div class="segmented">
              <button
                class="segmented-btn"
                :class="{ active: activeTab === 'appearance' }"
                @click="activeTab = 'appearance'"
              >
                {{ t('terminal.tabAppearance') }}
              </button>
              <button
                class="segmented-btn"
                :class="{ active: activeTab === 'misc' }"
                @click="activeTab = 'misc'"
              >
                {{ t('terminal.tabMisc') }}
              </button>
            </div>
          </div>

          <!-- ==================== Tab: 外观 ==================== -->
          <template v-if="activeTab === 'appearance'">
            <div class="settings-content" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
              <!-- Font Size -->
              <div class="settings-section">
                <label class="settings-label">{{ t('terminal.fontSize') }}</label>
                <div class="font-size-control">
                  <button class="size-btn" :disabled="fontSize <= 10" @click.stop="emitChange({ fontSize: fontSize - 1 })">-</button>
                  <span class="size-value">{{ fontSize }}px</span>
                  <button class="size-btn" :disabled="fontSize >= 24" @click.stop="emitChange({ fontSize: fontSize + 1 })">+</button>
                </div>
              </div>

              <!-- Letter Spacing（字间距）：xterm letterSpacing 选项，格宽同步膨胀；
                   小屏/小字号下 CJK 字间留白仅剩字体字怀，可加间距拉开 -->
              <div class="settings-section">
                <label class="settings-label">{{ t('terminal.letterSpacing') }}</label>
                <div class="font-size-control">
                  <button class="size-btn" :disabled="letterSpacing <= 0" @click.stop="emitChange({ letterSpacing: letterSpacing - 1 })">-</button>
                  <span class="size-value">{{ letterSpacing }}px</span>
                  <button class="size-btn" :disabled="letterSpacing >= 4" @click.stop="emitChange({ letterSpacing: letterSpacing + 1 })">+</button>
                </div>
              </div>

              <!-- Theme -->
              <div class="settings-section">
                <label class="settings-label">{{ t('terminal.theme') }}</label>
                <div class="theme-grid">
                  <button
                    v-for="(theme, name) in TERMINAL_THEMES"
                    :key="name"
                    class="theme-btn"
                    :class="{ active: currentThemeKey === name }"
                    @click.stop="selectTheme(name)"
                  >
                    <span class="theme-preview" :style="getThemePreviewStyle(name)">Aa</span>
                    <span class="theme-name">{{ resolveThemeLabel(theme.label, t) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- ==================== Tab: 杂项配置 ==================== -->
          <template v-else>
            <div class="settings-content" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
              <!-- Quick Bar Count -->
              <div class="settings-section">
                <label class="settings-label">{{ t('terminal.shortcutCount') }}</label>
                <div class="font-size-control">
                  <button class="size-btn" :disabled="quickBarCount <= 3" @click.stop="emitChange({ quickBarCount: quickBarCount - 1 })">-</button>
                  <span class="size-value">{{ quickBarCount }}</span>
                  <button class="size-btn" :disabled="quickBarCount >= 10" @click.stop="emitChange({ quickBarCount: quickBarCount + 1 })">+</button>
                </div>
              </div>

              <!-- Header Toolbar Items -->
              <div class="settings-section">
                <label class="settings-label">{{ t('terminal.persistentToolbar') }}</label>
                <p class="settings-hint">{{ t('terminal.persistentToolbarHint') }}</p>
                <div class="toolbar-toggle-grid">
                  <button
                    v-for="item in allToolbarItems"
                    :key="item.key"
                    class="toolbar-toggle-btn"
                    :class="{ active: toolbarItems.includes(item.key) }"
                    @click.stop="toggleToolbarItem(item.key)"
                  >
                    <span>{{ t(item.label) }}</span>
                  </button>
                </div>
              </div>

              <!-- 新手引导开关：开启后下次进入终端页重新展示引导 -->
              <div class="settings-section onboarding-row">
                <div class="min-w-0">
                  <label class="settings-label">{{ t('terminal.onboardingToggle') }}</label>
                  <p class="settings-hint">{{ t('terminal.onboardingToggleHint') }}</p>
                </div>
                <Toggle
                  :model-value="onboardingPending"
                  class="flex-shrink-0"
                  @update:model-value="emitChange({ onboardingPending: $event })"
                />
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
 * 终端设置弹窗（#17 范式统一）—— bottom sheet + 即改即存
 *
 * 组件完全受控：当前值一律来自 props（父层真源），每次交互立即 emit('change', 全量
 * 设置)，由 TerminalView 持久化并应用——终端即时重排，本身就是字号/主题预览。
 * 无草稿、无确认/取消 footer：关闭（遮罩 / 关闭钮）不会丢任何已生效修改。
 * Tab 不再每次打开重置：无丢稿风险后，停留页即用户上下文。
 */
defineOptions({ name: 'TerminalSettingsModal' })

import { computed, ref } from 'vue'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useSwipeTabs } from '@binblink/wasmnest-plugin-sdk-mobile/ui/swipe-tabs'
import { t } from '../host'
import { TERMINAL_THEMES, resolveThemeLabel } from '../config/themes'
import Toggle from './Toggle.vue'

/** 设置分组 Tab：外观（字体/主题）与杂项配置（快捷栏/工具栏） */
type SettingsTab = 'appearance' | 'misc'

export interface TerminalSettings {
  fontSize: number
  theme: string
  isThemeUserSet: boolean
  /** 字间距（px，0-4）：映射 xterm letterSpacing 选项，格宽同步膨胀 */
  letterSpacing: number
  quickBarCount: number
  toolbarItems: string[]
  /** 终端新手引导待展示：开启后下次进入终端页重新弹出 */
  onboardingPending: boolean
}

export interface ToolbarItemConfig {
  key: string
  label: string
  icon: string
}

const props = defineProps<{
  visible: boolean
  fontSize: number
  theme: string
  isThemeUserSet: boolean
  letterSpacing: number
  quickBarCount: number
  toolbarItems: string[]
  allToolbarItems: ToolbarItemConfig[]
  onboardingPending: boolean
}>()

const emit = defineEmits<{
  change: [settings: TerminalSettings]
  close: []
}>()

/** App 当前是否深色（宿主主题投影；system 主题的解析依据） */
const isSystemDark = getMobileApi().isDark

const activeTab = ref<SettingsTab>('appearance')

// 内容区左右滑动切换 Tab：左滑 → 杂项配置，右滑 → 外观
const { onTouchStart, onTouchMove, onTouchEnd } = useSwipeTabs((dir) => {
  if (dir === 'left' && activeTab.value === 'appearance') activeTab.value = 'misc'
  else if (dir === 'right' && activeTab.value === 'misc') activeTab.value = 'appearance'
})

/** 当前主题选择键：未手动指定时选中 system 项 */
const currentThemeKey = computed(() => (props.isThemeUserSet ? props.theme : 'system'))

/** 即改即存出口：以 props 当前值为基线合并 patch，emit 全量设置（父层持久化 + 应用） */
function emitChange(patch: Partial<TerminalSettings>) {
  emit('change', {
    fontSize: props.fontSize,
    theme: props.theme,
    isThemeUserSet: props.isThemeUserSet,
    letterSpacing: props.letterSpacing,
    quickBarCount: props.quickBarCount,
    toolbarItems: [...props.toolbarItems],
    onboardingPending: props.onboardingPending,
    ...patch,
  })
}

/** 主题选择：system 折算为当前外观解析值并解除手动指定；具名主题直接锁定 */
function selectTheme(name: string) {
  if (name === 'system') {
    emitChange({ theme: isSystemDark.value ? 'dark' : 'light', isThemeUserSet: false })
  } else {
    emitChange({ theme: name, isThemeUserSet: true })
  }
}

function toggleToolbarItem(key: string) {
  const items = props.toolbarItems.includes(key)
    ? props.toolbarItems.filter((k) => k !== key)
    : [...props.toolbarItems, key]
  emitChange({ toolbarItems: items })
}

function getThemePreviewStyle(themeName: string): { background: string; color: string } {
  if (themeName === 'system') {
    const resolved = isSystemDark.value ? 'dark' : 'light'
    const th = TERMINAL_THEMES[resolved]
    return { background: th.background, color: th.foreground }
  }
  const th = TERMINAL_THEMES[themeName]
  return { background: th.background, color: th.foreground }
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

.settings-content {
  --size-btn: 2.75rem;

  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 1rem calc(var(--safe-area-bottom, 0px) + 1rem);
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
}

.theme-name {
  font-size: clamp(0.625rem, 0.75rem, 0.875rem);
  color: var(--mobile-text-muted);
}

.theme-btn.active .theme-name {
  color: var(--mobile-accent);
  font-weight: 600;
}

.settings-hint {
  font-size: clamp(0.625rem, 0.75rem, 0.875rem);
  color: var(--mobile-text-muted);
  margin: 0 0 0.75rem;
}

.toolbar-toggle-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(0.375rem, 0.5rem, 0.75rem);
}

.toolbar-toggle-btn {
  padding: clamp(0.375rem, 0.5rem, 0.75rem);
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 2px solid transparent;
  color: var(--mobile-text-muted);
  font-size: clamp(0.6875rem, 0.8rem, 0.9375rem);
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}

.toolbar-toggle-btn:hover {
  background: var(--mobile-bg-hover);
}

.toolbar-toggle-btn.active {
  border-color: var(--mobile-accent);
  background: var(--mobile-accent-muted);
  color: var(--mobile-accent);
  font-weight: 600;
}

/* 新手引导开关行：文案左、开关右（44px 触控目标由 Toggle 自身保证） */
.onboarding-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.onboarding-row .settings-label {
  margin-bottom: 0.25rem;
}

.onboarding-row .settings-hint {
  margin: 0;
}
</style>
