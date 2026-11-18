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

/**
 * 根据 category 返回 quick bar 按钮的样式类
 *
 * 只有 enter / del 带自己的外观规则；arrow / shortcut / custom 落在 `.quick-bar-btn`
 * 的基础键帽上（类名保留为分类钩子，便于选择器与后续扩展，不再各配一套配色）。
 */
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

/* 键帽：终端里的物理按键。等宽字 + 中性底 + 发丝边，
   按下只改变底色（不缩放、不调亮度）——手指按住时键帽不该在手底下「跳」。 */
.quick-bar-btn {
  height: var(--quickbar-btn-h);
  padding: 0 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--quickbar-font);
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
  white-space: nowrap;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mobile-border);
  background: var(--mobile-bg-elevated);
  color: var(--mobile-text-secondary);
  /* 父容器 RTL 布局，按钮文本保持 LTR */
  direction: ltr;
}

.quick-bar-btn:active {
  background: var(--mobile-group-row-active);
  color: var(--mobile-text-primary);
}

/* 五类键帽只保留两种重点：Enter 是主操作（accent），Del 是毁坏性操作（红字）。
   箭头 / 快捷键 / 自定义命令共用中性键帽——终端里最常按的恰恰是最不该上色的那排。 */
.quick-bar-enter {
  color: var(--mobile-accent);
  border-color: color-mix(in srgb, var(--mobile-accent) 35%, transparent);
  background: var(--mobile-accent-muted);
}

.quick-bar-enter:active {
  background: var(--mobile-accent-secondary);
  color: var(--mobile-accent);
}

.quick-bar-del {
  color: var(--mobile-error);
}

.quick-bar-del:active {
  color: var(--mobile-error);
  border-color: color-mix(in srgb, var(--mobile-error) 35%, transparent);
  background: var(--mobile-group-row-active);
}
</style>
