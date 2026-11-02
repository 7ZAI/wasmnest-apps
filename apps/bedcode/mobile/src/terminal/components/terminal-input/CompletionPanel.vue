<template>
  <!-- `/` 命令补全弹层：输入框上方，点选即填充输入框（复用 agentPresets 本地数据，零延迟） -->
  <transition name="completion-fade">
    <div v-if="visible" class="completion-panel" @mousedown.prevent>
      <button v-for="cmd in items" :key="cmd" class="completion-item" @click="$emit('select', cmd)">
        <span class="completion-cmd">{{ cmd }}</span>
      </button>
    </div>
  </transition>
</template>

<script setup lang="ts">
/**
 * `/` 命令补全弹层（issue #19 从 TerminalInputBar 拆出）
 *
 * 候选与可见性由父组件计算（依赖输入文本与焦点），本组件只负责渲染与选择。
 */
defineOptions({ name: 'TerminalCompletionPanel' })

defineProps<{
  visible: boolean
  items: string[]
}>()

defineEmits<{
  select: [command: string]
}>()
</script>

<style scoped>
/* ==================== `/` Command Completion ==================== */

.completion-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 0.5rem);
  z-index: 50;
  background: var(--mobile-bg-card);
  border: 1px solid var(--mobile-border);
  border-radius: 0.875rem;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.15);
  overflow-y: auto;
  /* 紧凑布局：面板内边距 + 圆角块式项（分隔线已移除） */
  padding: 0.25rem;
  max-height: clamp(7rem, 26vh, 12rem);
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.completion-panel::-webkit-scrollbar {
  display: none;
  width: 0;
}

.completion-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  /* 触控下限保持 44px，上限收紧让列表更紧凑 */
  height: clamp(2.75rem, 8vw, 2.875rem);
  padding: 0 0.75rem;
  background: transparent;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.completion-item:active {
  background: var(--mobile-accent-muted);
}

.completion-cmd {
  font-family: 'Courier New', monospace;
  font-size: var(--font-size-sm);
  color: var(--mobile-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.completion-fade-enter-active,
.completion-fade-leave-active {
  transition: opacity 0.15s ease;
}

.completion-fade-enter-from,
.completion-fade-leave-to {
  opacity: 0;
}
</style>
