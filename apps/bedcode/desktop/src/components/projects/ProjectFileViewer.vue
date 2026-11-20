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
          class="wb-mono shrink-0 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          data-testid="project-file-viewer-lines"
        >
          {{ t('project.fileViewer.lines', { n: lineCount }) }}
        </span>
        <span
          v-if="highlightTooLarge"
          class="shrink-0 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
          data-testid="project-file-viewer-highlight-skipped"
        >
          {{ t('project.fileViewer.highlightSkipped') }}
        </span>
      </div>
    </template>

    <div data-testid="project-file-viewer">
      <ProjectFileContent
        test-id-prefix="project-file-viewer"
        :is-loading="isLoading"
        :has-error="!!error"
        :error-text="errorText"
        :content="content"
        :highlighted-html="highlightedHtml"
        :line-numbers="lineNumbers"
        :gutter-width="gutterWidth"
        @retry="load"
      />
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
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
import { computed, inject, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import PluginModal from '@/components/PluginModal.vue'
import ProjectFileContent from './ProjectFileContent.vue'
import { useProjectFileContent } from '@/composables/useProjectFileContent'

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

const path = computed(() => props.path)
const {
  isLoading,
  error,
  errorText,
  content,
  fileName,
  highlightedHtml,
  highlightTooLarge,
  lineCount,
  lineNumbers,
  gutterWidth,
  load,
  invalidate,
} = useProjectFileContent(
  context,
  computed(() => props.projectId),
  path,
)

watch(
  () => [props.modelValue, props.path, props.projectId] as const,
  () => {
    if (props.modelValue) {
      void load()
    } else {
      invalidate()
    }
  },
  { immediate: true },
)

async function copyPath(): Promise<void> {
  if (!props.path) return
  try {
    await navigator.clipboard.writeText(props.path)
    toast.success(t('project.fileViewer.copied'))
  } catch (e) {
    console.error('[Project File Viewer] clipboard unavailable:', e)
  }
}
</script>
