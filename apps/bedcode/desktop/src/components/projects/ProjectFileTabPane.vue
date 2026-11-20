<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="flex-1 min-h-0">
      <ProjectFileContent
        variant="panel"
        test-id-prefix="project-file-tab"
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
    <div
      class="h-6 shrink-0 flex items-center gap-2 px-2 border-t border-[var(--border)] bg-[var(--bg-card)]"
    >
      <span
        class="min-w-0 flex-1 truncate wb-mono text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
        :title="path"
      >
        {{ path }}
      </span>
      <span
        v-if="highlightTooLarge"
        class="shrink-0 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >
        {{ t('project.fileViewer.highlightSkipped') }}
      </span>
      <span
        v-if="!isLoading && !error && lineCount > 0"
        class="wb-mono shrink-0 text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
      >
        {{ t('project.fileViewer.lines', { n: lineCount }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import ProjectFileContent from './ProjectFileContent.vue'
import { useProjectFileContent } from '@/composables/useProjectFileContent'

const props = defineProps<{
  projectId: string
  path: string
  active: boolean
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

const pathRef = computed(() => props.path)
const {
  isLoading,
  error,
  errorText,
  content,
  highlightedHtml,
  highlightTooLarge,
  lineCount,
  lineNumbers,
  gutterWidth,
  load,
} = useProjectFileContent(
  context,
  computed(() => props.projectId),
  pathRef,
)

let started = false

watch(
  () => props.active,
  (active) => {
    if (!active || started) return
    started = true
    void load()
  },
  { immediate: true },
)
</script>
