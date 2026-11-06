<template>
  <header class="header">
    <button class="back-btn" @click="$emit('back')">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <div class="header-title-area">
      <h1 class="header-title">{{ sessionName }}</h1>
      <!-- 便捷功能教程入口：跟随标题文字（间距固定），标题截断时保持可见 -->
      <button class="help-btn" @click="$emit('action', 'help')" :title="t('terminalHelp.title')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9.5 9.5a2.6 2.6 0 115.1 1c-1.1.7-1.6 1.3-1.6 2.6m0 3h.01"
          />
        </svg>
      </button>
      <transition name="mode-badge">
        <span v-if="isSelectionMode" class="selection-mode-badge">{{
          t('terminal.selectMode')
        }}</span>
      </transition>
    </div>
    <!-- 常驻工具按钮：图标 / 文案 / 按钮类由 headerTools 表驱动（新增工具项只改表，
         不再维护两份 SVG 与两条 v-if 链） -->
    <button
      v-for="item in visibleItems"
      :key="item.key"
      :class="buttonClass(item.key)"
      :title="toolTitle(item.key)"
      @click="emitAction(item.key)"
    >
      <ToolIcon :name="item.key" />
    </button>
    <!-- 溢出菜单按钮 -->
    <div v-if="overflowItems.length > 0" class="overflow-menu-wrapper">
      <button
        class="overflow-btn"
        :class="{ active: showOverflowMenu }"
        :title="t('terminal.moreTools')"
        @click.stop="showOverflowMenu = !showOverflowMenu"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      <transition name="overflow-menu">
        <div v-if="showOverflowMenu" class="overflow-menu" @click.stop>
          <button
            v-for="item in overflowItems"
            :key="item.key"
            class="overflow-menu-item"
            :class="{ active: item.key === 'folder' && showSidebar }"
            @click="emitAction(item.key)"
          >
            <ToolIcon :name="item.key" size="menu" />
            <span>{{ toolTitle(item.key) }}</span>
          </button>
        </div>
      </transition>
    </div>
    <!-- 点击溢出菜单外部关闭 -->
    <div v-if="showOverflowMenu" class="overflow-backdrop" @click="showOverflowMenu = false"></div>
  </header>
</template>

<script setup lang="ts">
/**
 * 终端页头部 - 返回按钮、会话名、工具栏、溢出菜单
 *
 * 工具栏按钮通过 emit('action', key) 通知父组件，不管理弹窗状态
 */
defineOptions({ name: 'TerminalHeader' })

import { ref, computed } from 'vue'
import type { ToolbarItemConfig } from './TerminalSettingsModal.vue'
import { t } from '../host'
import { HEADER_TOOL_LABEL_KEYS } from '../headerTools'
import ToolIcon from './ToolIcon.vue'

const props = defineProps<{
  sessionName: string
  isSelectionMode: boolean
  visibleItems: ToolbarItemConfig[]
  allItems: ToolbarItemConfig[]
  showSidebar: boolean
}>()

const emit = defineEmits<{
  back: []
  action: [key: string]
}>()

const showOverflowMenu = ref(false)

const overflowItems = computed(() => {
  const visibleKeys = new Set(props.visibleItems.map((item) => item.key))
  return props.allItems.filter((item) => !visibleKeys.has(item.key))
})

/** 工具项文案：表里没有的 key 回落到清单自带 label（新增项可先不登记文案） */
function toolTitle(key: string): string {
  const labelKey = HEADER_TOOL_LABEL_KEYS[key]
  if (labelKey) return t(labelKey)
  const item = props.allItems.find((i) => i.key === key)
  return item ? t(item.label) : key
}

/** 常驻按钮样式：绝大多数是 tool-btn，task / folder 有专属底色与激活态 */
function buttonClass(key: string): string {
  if (key === 'task') return 'task-btn'
  if (key === 'folder') return props.showSidebar ? 'folder-btn active' : 'folder-btn'
  return 'tool-btn'
}

function emitAction(key: string) {
  showOverflowMenu.value = false
  emit('action', key)
}
</script>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--mobile-terminal-header);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--mobile-border);
  flex-shrink: 0;
  /* z-index 高于 movable-area，键盘避让时遮挡上移的终端内容 */
  position: relative;
  z-index: 25;
}

.back-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.5rem;
  margin-left: -0.5rem;
  color: var(--mobile-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn:hover {
  color: var(--mobile-accent);
}

.help-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.5rem;
  color: var(--mobile-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.help-btn:hover {
  color: var(--mobile-accent);
}

.header-title-area {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--mobile-text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-btn,
.task-btn,
.folder-btn,
.overflow-btn {
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.5rem;
  border-radius: 0.5rem;
  background: var(--mobile-bg-elevated);
  border: 1px solid var(--mobile-border);
  color: var(--mobile-text-secondary);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-btn:hover,
.task-btn:hover,
.folder-btn:hover,
.overflow-btn:hover {
  border-color: color-mix(in srgb, var(--mobile-accent) 30%, transparent);
}

.task-btn {
  position: relative;
}

.folder-btn.active {
  color: var(--mobile-accent);
  border-color: var(--mobile-border-active);
  background: var(--mobile-accent-muted);
}

.overflow-menu-wrapper {
  position: relative;
}

.overflow-btn.active {
  color: var(--mobile-accent);
  border-color: var(--mobile-border-active);
  background: var(--mobile-accent-muted);
}

.overflow-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  /* 自适应宽度：手机窄屏 ~10.5rem，平板放大到 ~13rem，文字永不换行 */
  min-width: clamp(10.5rem, 10.5rem + (100vw - 360px) / 800 * 40, 13rem);
  max-width: min(80vw, 16rem);
  background: var(--mobile-bg-secondary);
  border: 1px solid var(--mobile-border);
  border-radius: 0.75rem;
  padding: 0.375rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 30;
}

.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: none;
  border: none;
  color: var(--mobile-text-primary);
  font-size: var(--font-size-base);
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
  white-space: nowrap;
}

.overflow-menu-item:hover {
  background: var(--mobile-bg-hover);
}

.overflow-menu-item.active {
  color: var(--mobile-accent);
}

.overflow-backdrop {
  position: fixed;
  inset: 0;
  z-index: 29;
}

.overflow-menu-enter-active,
.overflow-menu-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.overflow-menu-enter-from,
.overflow-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}

.selection-mode-badge {
  flex-shrink: 0;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--mobile-accent) 20%, transparent);
  color: var(--mobile-accent);
  font-size: var(--font-size-sm);
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--mobile-accent) 30%, transparent);
}

.mode-badge-enter-active,
.mode-badge-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.mode-badge-enter-from,
.mode-badge-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
