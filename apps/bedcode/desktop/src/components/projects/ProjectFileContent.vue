<template>
  <div :class="variant === 'panel' ? 'h-full min-h-0' : ''">
    <div
      v-if="isLoading"
      class="flex items-center justify-center gap-2"
      :class="variant === 'panel' ? 'h-full' : 'py-16'"
      :data-testid="`${testIdPrefix}-loading`"
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
      <span class="text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]">
        {{ t('project.fileViewer.loading') }}
      </span>
    </div>

    <div
      v-else-if="hasError"
      class="px-2 text-center"
      :class="variant === 'panel' ? 'h-full flex flex-col items-center justify-center' : 'py-10'"
      :data-testid="`${testIdPrefix}-error`"
    >
      <p class="text-[calc(12.5px*var(--ui-scale))] text-[var(--text-primary)]">
        {{ errorText }}
      </p>
      <button
        class="wb-btn-ghost mt-3"
        :data-testid="`${testIdPrefix}-retry`"
        @click="emit('retry')"
      >
        {{ t('project.files.retry') }}
      </button>
    </div>

    <div
      v-else-if="content === ''"
      class="text-center text-[calc(12px*var(--ui-scale))] text-[var(--text-secondary)]"
      :class="variant === 'panel' ? 'h-full flex items-center justify-center' : 'py-16'"
      :data-testid="`${testIdPrefix}-empty`"
    >
      {{ t('project.fileViewer.empty') }}
    </div>

    <div
      v-else
      :class="
        variant === 'panel'
          ? 'h-full overflow-auto'
          : 'max-h-[58vh] overflow-auto rounded-input border border-[var(--border)] bg-[var(--bg-page)]'
      "
      :data-testid="`${testIdPrefix}-content`"
    >
      <div class="flex min-w-max items-stretch">
        <pre
          class="wb-code wb-code-gutter shrink-0 select-none text-[var(--text-tertiary)]"
          :style="{ width: gutterWidth }"
          aria-hidden="true"
          >{{ lineNumbers }}</pre>
        <div
          v-if="highlightedHtml"
          class="wb-code wb-code-host"
          :data-testid="`${testIdPrefix}-highlighted`"
          v-html="highlightedHtml"
        ></div>
        <pre v-else class="wb-code wb-code-body"><code>{{ content }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

withDefaults(
  defineProps<{
    isLoading: boolean
    hasError: boolean
    errorText: string
    content: string
    highlightedHtml: string
    lineNumbers: string
    gutterWidth: string
    variant?: 'modal' | 'panel'
    testIdPrefix?: string
  }>(),
  { variant: 'modal', testIdPrefix: 'project-file-viewer' },
)

const emit = defineEmits<{
  retry: []
}>()

const context = inject<PluginContext>('pluginContext')!
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)
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

.wb-code-host :deep(.shiki) {
  margin: 0;
  padding: 0.75rem 1rem;
  font: inherit;
  background: transparent;
  color: var(--shiki-light);
}

.wb-code-host :deep(code) {
  font: inherit;
  white-space: pre;
}

.wb-code-host :deep(.shiki span) {
  color: var(--shiki-light);
}
</style>

<style>
html.dark .wb-code-host .shiki,
html.dark .wb-code-host .shiki span {
  color: var(--shiki-dark);
}
</style>
