<template>
  <PluginModal
    :model-value="modelValue"
    size="full"
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <template #header>
      <div class="flex items-center gap-2 min-w-0 pr-8">
        <span
          class="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]"
          data-testid="project-file-viewer-name"
        >
          {{ fileName || name }}
        </span>
        <span
          v-if="!isLoading && !error && lineCount > 0"
          class="wb-mono shrink-0 text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
          data-testid="project-file-viewer-lines"
        >
          {{ t('project.fileViewer.lines', { n: lineCount }) }}
        </span>
      </div>
    </template>

    <div data-testid="project-file-viewer">
      <div
        v-if="isLoading"
        class="py-16 flex items-center justify-center gap-2"
        data-testid="project-file-viewer-loading"
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
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v2a6 6 0 00-6 6H4z"
          ></path>
        </svg>
        <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">
          {{ t('project.fileViewer.loading') }}
        </span>
      </div>

      <div v-else-if="error" class="py-10 px-2 text-center" data-testid="project-file-viewer-error">
        <p class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)]">
          {{ errorText }}
        </p>
        <button class="wb-btn-ghost mt-3" data-testid="file-viewer-retry" @click="load">
          {{ t('project.files.retry') }}
        </button>
      </div>

      <div
        v-else-if="content === ''"
        class="py-16 text-center text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]"
        data-testid="project-file-viewer-empty"
      >
        {{ t('project.fileViewer.empty') }}
      </div>

      <div
        v-else
        class="max-h-[58vh] overflow-auto rounded-input border border-[var(--border)] bg-[var(--bg-page)]"
        data-testid="project-file-viewer-content"
      >
        <div class="flex min-w-max items-stretch">
          <!-- 行号：与正文同一排版参数，单独一列 sticky 在左侧；用整串文本而不是 N 个 span，避免大文件撑爆 DOM -->
          <pre
            class="wb-code wb-code-gutter shrink-0 select-none text-[var(--text-tertiary)]"
            :style="{ width: gutterWidth }"
            aria-hidden="true"
            >{{ lineNumbers }}</pre>
          <pre class="wb-code wb-code-body"><code>{{ content }}</code></pre>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate wb-mono text-[calc(10.5px*var(--ui-scale))] text-[var(--text-tertiary)]"
          :title="path"
        >
          {{ path }}
        </span>
        <button class="wb-btn-ghost" data-testid="file-viewer-copy-path" @click="copyPath">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          {{ t('project.fileViewer.copyPath') }}
        </button>
        <button
          class="wb-btn-ghost"
          data-testid="file-viewer-close"
          @click="emit('update:modelValue', false)"
        >
          {{ t('project.fileViewer.close') }}
        </button>
      </div>
    </template>
  </PluginModal>
</template>

<script setup lang="ts">
/**
 * 项目文件只读查看器（工作台右栏文件页签点开）
 *
 * 移动端文件弹窗的桌面等价物：文件名 + 行数 + 等宽正文（行号列 Sticky）。
 * 桌面工程没有 shiki/marked 依赖，这里不做语法高亮与 Markdown 渲染——先把
 * 「看得见文件内容」做到，高亮是后续增强，不在拉取链路上新增第三方包。
 *
 * 读文件走 `project.file-content`（后端复用 file_browse 的 2MB 上限、越界与
 * 二进制判定）；错误显性展示，不用空正文冒充「文件是空的」。
 */
import { computed, inject, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import { useProjectFiles } from '@/composables/useProjectFiles'
import { resolvePluginErrorText } from '@/utils/pluginError'

const props = defineProps<{
  modelValue: boolean
  projectId: string
  path: string
  name: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const { readFile } = useProjectFiles(
  context,
  computed(() => props.projectId),
)

const isLoading = ref(false)
const error = ref<unknown>(null)
const content = ref('')
const fileName = ref('')
let loadSeq = 0

const errorText = computed(() =>
  resolvePluginErrorText(context, error.value, 'project.fileViewer.loadFailed'),
)

const lineCount = computed(() => (content.value === '' ? 0 : content.value.split('\n').length))
const lineNumbers = computed(() =>
  Array.from({ length: lineCount.value }, (_, index) => index + 1).join('\n'),
)
const gutterWidth = computed(
  () => `calc(${Math.max(2, String(lineCount.value).length)}ch + 1.5rem)`,
)

async function load(): Promise<void> {
  if (!props.modelValue || !props.path) return
  const seq = ++loadSeq
  isLoading.value = true
  error.value = null
  content.value = ''
  fileName.value = ''
  try {
    const result = await readFile(props.path)
    if (seq !== loadSeq) return
    content.value = result.content
    fileName.value = result.fileName
  } catch (e) {
    if (seq !== loadSeq) return
    console.error('[Project File Viewer] read file failed:', e)
    error.value = e
  } finally {
    if (seq === loadSeq) isLoading.value = false
  }
}

watch(
  () => [props.modelValue, props.path, props.projectId] as const,
  () => {
    if (props.modelValue) void load()
  },
  { immediate: true },
)

async function copyPath(): Promise<void> {
  if (!props.path) return
  try {
    await navigator.clipboard.writeText(props.path)
    toast.success(t('project.fileViewer.copied'))
  } catch (e) {
    // 剪贴板不可用不影响阅读：路径就在底栏可选中复制
    console.error('[Project File Viewer] clipboard unavailable:', e)
  }
}
</script>

<style scoped>
.wb-code {
  margin: 0;
  font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: calc(12px * var(--ui-scale));
  line-height: 1.6;
  tab-size: 4;
}

.wb-code-gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0.75rem 0.75rem;
  text-align: right;
  background: var(--bg-page);
  border-right: 1px solid var(--border);
}

.wb-code-body {
  padding: 0.75rem 1rem;
  color: var(--text-primary);
}

.wb-code-body code {
  font: inherit;
  white-space: pre;
}
</style>
