<template>
  <div class="wb-tree-node">
    <div
      class="wb-tree-row"
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      role="treeitem"
      :aria-level="depth + 1"
      :aria-expanded="node.type === 'folder' ? !!node.expanded : undefined"
      :title="node.path || node.name"
      tabindex="0"
      data-testid="file-tree-item"
      :data-node-type="node.type"
      :data-path="node.path"
      @click="activate"
      @keydown.enter.prevent="activate"
      @keydown.space.prevent="activate"
    >
      <!-- 展开箭头（文件夹）/ 占位（文件）：保证同层名称左对齐 -->
      <span class="w-3 h-3 shrink-0 flex items-center justify-center text-[var(--text-tertiary)]">
        <svg v-if="node.loading" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="2"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
          ></path>
        </svg>
        <svg
          v-else-if="node.type === 'folder'"
          class="w-3 h-3 transition-transform duration-150"
          :class="node.expanded && 'rotate-90'"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </span>

      <!-- 类型图标：文件夹开合两态，文件用文档轮廓 -->
      <svg
        v-if="node.type === 'folder'"
        class="w-3.5 h-3.5 shrink-0 text-[var(--color-primary)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          v-if="node.expanded"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.688-6.75l-.75-1.5a2.25 2.25 0 00-2.013-1.25H6.75A2.25 2.25 0 004.5 5.25v4.5m17.25 3v6.75a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25v-6.75"
        />
        <path
          v-else
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M2.25 6.75A2.25 2.25 0 014.5 4.5h4.19c.6 0 1.17.24 1.59.66l1.06 1.06c.42.42.99.66 1.59.66h4.57a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75z"
        />
      </svg>
      <svg
        v-else
        class="w-3.5 h-3.5 shrink-0 text-[var(--text-tertiary)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>

      <span
        class="min-w-0 flex-1 truncate text-[calc(12px*var(--ui-scale))]"
        :class="
          node.type === 'folder' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        "
      >
        {{ node.name }}
      </span>
    </div>

    <!-- 子节点：文件夹展开才挂载，收起不保留 DOM（children 缓存留在数据层） -->
    <div v-if="node.type === 'folder' && node.expanded && node.children?.length" role="group">
      <ProjectFileTreeNode
        v-for="child in node.children"
        :key="child.path || child.name"
        :node="child"
        :depth="depth + 1"
        @toggle="(target) => emit('toggle', target)"
        @open="(name, path) => emit('open', name, path)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 项目文件树节点（递归）
 *
 * 只负责展示与交互：展开/加载/读文件全部由父级 `ProjectFileTree` 的 composable
 * 承担。行是 `role="treeitem"` + `tabindex=0`，Enter / Space 与点击同义——
 * 文件树要能全程键盘走完（ui-ux-pro-max「Keyboard Navigation」：焦点可见、
 * 顺序与视觉一致）。
 */
import type { ProjectFileNode } from '@/composables/useProjectFiles'

defineOptions({ name: 'ProjectFileTreeNode' })

const props = defineProps<{
  node: ProjectFileNode
  depth: number
}>()

const emit = defineEmits<{
  toggle: [node: ProjectFileNode]
  open: [name: string, path: string]
}>()

function activate(): void {
  if (props.node.type === 'folder') {
    emit('toggle', props.node)
    return
  }
  emit('open', props.node.name, props.node.path || props.node.name)
}
</script>

<style scoped>
.wb-tree-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 24px;
  padding-right: 0.5rem;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: background-color 120ms ease;
}

.wb-tree-row:hover {
  background: var(--bg-hover);
}

.wb-tree-row:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>
