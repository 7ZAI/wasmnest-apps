<template>
  <div class="segmented">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="segmented-btn"
      :class="{ active: modelValue === tab.key }"
      :aria-pressed="modelValue === tab.key"
      @click="emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
      <span v-if="tab.badge !== undefined" class="segmented-badge">{{ tab.badge }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 分段选择器（#18 收敛件）——设置/配置类弹窗的 Tab 切换共用
 * （终端设置 / 代码查看设置 / 快捷键配置）。
 * 类名保留 segmented / segmented-btn：既有测试与样式口径不动；aria-pressed 承载选中态。
 */
defineOptions({ name: 'SegmentedTabs' })

defineProps<{
  tabs: { key: string; label: string; badge?: string | number }[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()
</script>

<style scoped>
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

.segmented-badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3125rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  border-radius: 9999px;
  background: var(--mobile-accent-muted);
  color: var(--mobile-accent);
}
</style>
