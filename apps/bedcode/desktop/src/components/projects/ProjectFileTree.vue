<template>
  <div class="flex flex-col h-full min-h-0" data-testid="project-files">
    <!-- 根目录 + 动作：路径是唯一的「这棵树从哪来」提示，窄栏用截断 + title 兜底 -->
    <div
      class="h-8 px-2 shrink-0 flex items-center gap-1 border-b border-[var(--border)]"
      data-testid="project-files-toolbar"
    >
      <span
        class="min-w-0 flex-1 truncate wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
        :title="workingDir"
        data-testid="project-files-root"
      >
        {{ workingDir }}
      </span>
      <button
        class="wb-tree-action"
        :title="t('project.files.refresh')"
        :aria-label="t('project.files.refresh')"
        data-testid="files-refresh"
        @click="reload"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
      <button
        class="wb-tree-action"
        :title="t('project.files.collapseAll')"
        :aria-label="t('project.files.collapseAll')"
        data-testid="files-collapse-all"
        @click="collapseAll"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M5 15l7-7 7 7"
          />
        </svg>
      </button>
    </div>

    <!-- 加载 / 错误 / 空态：全部显性，空白面板不冒充「没有文件」 -->
    <div
      v-if="isLoading"
      class="flex-1 flex items-center justify-center gap-2"
      data-testid="files-loading"
    >
      <svg
        class="w-4 h-4 animate-spin text-[var(--text-secondary)]"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="2"
        ></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"></path>
      </svg>
      <span class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
        {{ t('project.files.loading') }}
      </span>
    </div>

    <div
      v-else-if="error"
      class="flex-1 min-h-0 overflow-y-auto px-3 py-4 text-center"
      data-testid="files-error"
    >
      <p class="text-[calc(12px*var(--ui-scale))] text-[var(--text-primary)]">
        {{ errorText }}
      </p>
      <button class="wb-btn-ghost mt-3" data-testid="files-retry" @click="reload">
        {{ t('project.files.retry') }}
      </button>
    </div>

    <div
      v-else-if="tree.length === 0"
      class="flex-1 flex items-center justify-center px-6 text-center"
      data-testid="files-empty"
    >
      <p class="text-[calc(11.5px*var(--ui-scale))] text-[var(--text-secondary)]">
        {{ t('project.files.empty') }}
      </p>
    </div>

    <div
      v-else
      class="flex-1 min-h-0 overflow-y-auto px-1 py-1"
      role="tree"
      :aria-label="t('project.files.title')"
      data-testid="project-file-tree"
    >
      <ProjectFileTreeNode
        v-for="node in tree"
        :key="node.path || node.name"
        :node="node"
        :depth="0"
        @toggle="onToggle"
        @open="(name, path) => emit('open', name, path)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 项目文件树（工作台右栏「文件」页签）
 *
 * 生命周期：页签可见时才读根目录（`active`），收起面板或停在「变更」页签不触发
 * 取数——也就不在用户没看到文件树时弹 fs 授权框。树状态留在本组件：页签切换
 * 用 `v-show` 保活，不因一次切走就丢掉展开态与已加载的子目录。
 */
import { computed, inject, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import ProjectFileTreeNode from './ProjectFileTreeNode.vue'
import { useProjectFiles } from '@/composables/useProjectFiles'
import { resolvePluginErrorText } from '@/utils/pluginError'

const props = defineProps<{
  projectId: string
  workingDir: string
  /** 当前页签是否可见：不可见不取数 */
  active: boolean
}>()

const emit = defineEmits<{
  open: [name: string, path: string]
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const { tree, isLoading, error, loadRoot, toggleNode, collapseAll, reset } = useProjectFiles(
  context,
  computed(() => props.projectId),
)

/** 错误文案：优先错误信封业务码，兜底本域文案（技术细节只进 console，不进界面） */
const errorText = computed(() =>
  resolvePluginErrorText(context, error.value, 'project.files.loadFailed'),
)

watch(
  () => props.projectId,
  () => {
    // 项目切换：清空旧树；若页签可见立即读新项目
    reset()
    if (props.active) void loadRoot()
  },
)

watch(
  () => props.active,
  (active) => {
    if (active) void loadRoot()
  },
  { immediate: true },
)

function reload(): void {
  void loadRoot(true)
}

async function onToggle(node: Parameters<typeof toggleNode>[0]): Promise<void> {
  try {
    await toggleNode(node)
  } catch (e) {
    console.error('[Project Files] load children failed:', e)
    toast.error(resolvePluginErrorText(context, e, 'project.files.loadFailed'))
  }
}
</script>

<style scoped>
.wb-tree-action {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.wb-tree-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.wb-tree-action:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>
