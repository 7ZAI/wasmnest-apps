<template>
  <!-- 快捷键条 - 常驻显示最常用的快捷键和自定义命令：
       固定显示，不随输入框焦点收起；只有快捷键面板（快捷键弹层）可手动开合 -->
  <div v-if="items.length > 0" class="quick-bar" @mousedown.prevent>
    <button
      v-for="item in items"
      :key="item.type + '-' + item.key"
      class="quick-bar-btn"
      :class="quickBarClass(item.category)"
      @click="$emit('select', item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 快捷键条（issue #19 从 TerminalInputBar 拆出）
 *
 * 纯展示 + 选择事件：项目排序 / 数量 / 频次统计都在 inputAssistant store，
 * 点击语义（快捷键 vs 快捷命令）由父组件分发。
 */
import type { QuickBarItem } from '../../inputAssistant'

defineOptions({ name: 'TerminalQuickBar' })

defineProps<{
  items: QuickBarItem[]
}>()

defineEmits<{
  select: [item: QuickBarItem]
}>()

/** 根据 category 返回 quick bar 按钮的样式类 */
function quickBarClass(category: string): string {
  const map: Record<string, string> = {
    enter: 'quick-bar-enter',
    del: 'quick-bar-del',
    arrow: 'quick-bar-arrow',
    shortcut: 'quick-bar-shortcut',
    custom: 'quick-bar-custom',
  }
  return map[category] || 'quick-bar-shortcut'
}
</script>

<style scoped>
/* ==================== Quick Bar ==================== */

.quick-bar {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.375rem;
  padding-bottom: 0.375rem;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  position: relative;
  z-index: 40;
  /* RTL 布局：首项渲染在右侧，新项目从左侧添加，右对齐方便拇指操作 */
  direction: rtl;
}

.quick-bar::-webkit-scrollbar {
  display: none;
  width: 0;
}

.quick-bar-btn {
  height: var(--quickbar-btn-h);
  padding: 0 0.5rem;
  font-size: var(--quickbar-font);
  font-weight: 500;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid;
  /* 父容器 RTL 布局，按钮文本保持 LTR */
  direction: ltr;
}

.quick-bar-shortcut {
  background: var(--mobile-shortcut-bg);
  border-color: var(--mobile-shortcut-border);
  color: var(--mobile-shortcut-color);
}

.quick-bar-shortcut:active {
  transform: scale(0.93);
  background: var(--mobile-shortcut-active-bg);
}

.quick-bar-custom {
  background: var(--mobile-custom-cmd-bg);
  border-color: var(--mobile-custom-cmd-border);
  color: var(--mobile-custom-cmd-color);
}

.quick-bar-custom:active {
  transform: scale(0.93);
  background: var(--mobile-custom-cmd-active-bg);
}

.quick-bar-enter {
  background: var(--mobile-confirm-bg);
  border-color: var(--mobile-confirm-border);
  color: var(--mobile-confirm-color);
}

.quick-bar-enter:active {
  transform: scale(0.93);
  background: var(--mobile-confirm-bg);
  filter: brightness(1.2);
}

.quick-bar-del {
  background: var(--mobile-danger-bg);
  border-color: var(--mobile-danger-border);
  color: var(--mobile-danger-color);
}

.quick-bar-del:active {
  transform: scale(0.93);
  background: var(--mobile-danger-bg);
  filter: brightness(1.2);
}

.quick-bar-arrow {
  background: var(--mobile-arrow-bg);
  border-color: var(--mobile-arrow-border);
  color: var(--mobile-arrow-color);
}

.quick-bar-arrow:active {
  transform: scale(0.93);
  background: var(--mobile-arrow-active-bg);
}
</style>
