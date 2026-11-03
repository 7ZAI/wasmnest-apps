<template>
  <div
    class="flex h-[var(--toolbar-h)] shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-card)] px-2"
    data-testid="toolbar"
  >
    <button
      type="button"
      class="toolbar-btn"
      :title="t('toggleSidebar')"
      data-testid="toggle-sidebar"
      @click="$emit('toggleSidebar')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 6h16M4 12h16M4 18h16"
        />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn"
      :title="t('newNote')"
      data-testid="new-note"
      @click="$emit('create')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 5v14m-7-7h14"
        />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn disabled:opacity-40"
      :disabled="!hasActiveNote"
      :title="t('deleteNote')"
      data-testid="delete-note"
      @click="$emit('delete')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 7l-.9 12.1A2 2 0 0116.1 21H7.9a2 2 0 01-2-1.9L5 7m4 0V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
        />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn disabled:opacity-40"
      :disabled="!hasActiveNote"
      :title="t('saveNow')"
      data-testid="save-note"
      @click="$emit('save')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zM7 3v4h8V3M7 21v-8h10v8"
        />
      </svg>
    </button>

    <span class="mx-1 h-4 w-px bg-[var(--border)]" />

    <button
      type="button"
      class="toolbar-btn disabled:opacity-40"
      :disabled="!hasActiveNote"
      :title="t('pasteFromClipboard')"
      data-testid="paste-clipboard"
      @click="$emit('paste')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn disabled:opacity-40"
      :disabled="!hasActiveNote"
      :title="t('copySelection')"
      data-testid="copy-selection"
      @click="$emit('copy')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8 7V5a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 9h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2z"
        />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn disabled:opacity-40"
      :disabled="!hasActiveNote"
      :title="t('insertTimeDivider')"
      data-testid="insert-time-divider"
      @click="$emit('insertTimeDivider')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </button>

    <div class="flex-1" />

    <span
      class="mr-2 text-[length:var(--font-size-xs)]"
      :class="statusClass"
      data-testid="save-status"
    >
      {{ statusText }}
    </span>

    <div class="flex gap-0.5 rounded-[var(--radius-button)] bg-[var(--bg-input)] p-0.5">
      <button
        v-for="mode in modes"
        :key="mode.value"
        type="button"
        class="px-2 py-1 text-[length:var(--font-size-xs)] rounded-[var(--radius-tag)] transition-colors"
        :class="
          viewMode === mode.value
            ? 'bg-[var(--color-primary)] text-[var(--color-primary-contrast)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        "
        :data-testid="`view-mode-${mode.value}`"
        @click="$emit('setViewMode', mode.value)"
      >
        {{ t(mode.label) }}
      </button>
    </div>

    <button
      type="button"
      class="toolbar-btn ml-1"
      :title="t('settings')"
      data-testid="open-settings"
      @click="$emit('openSettings')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import type { SaveStatus, ViewMode } from '../types'

const props = defineProps<{
  viewMode: ViewMode
  hasActiveNote: boolean
  saveStatus: SaveStatus
}>()

defineEmits<{
  toggleSidebar: []
  create: []
  delete: []
  save: []
  copy: []
  paste: []
  insertTimeDivider: []
  setViewMode: [mode: ViewMode]
  openSettings: []
}>()

const { t } = useI18n()

const modes: { value: ViewMode; label: string }[] = [
  { value: 'edit', label: 'editMode' },
  { value: 'split', label: 'splitMode' },
  { value: 'preview', label: 'previewMode' },
]

const statusText = computed(() => {
  const keys: Record<SaveStatus, string> = {
    idle: 'saveStatusIdle',
    unsaved: 'saveStatusUnsaved',
    saving: 'saveStatusSaving',
    saved: 'saveStatusSaved',
    error: 'saveStatusError',
  }
  return t(keys[props.saveStatus])
})

const statusClass = computed(() => {
  if (props.saveStatus === 'error') return 'text-[var(--color-danger-ink)]'
  if (props.saveStatus === 'unsaved') return 'text-[var(--text-tertiary)]'
  return 'text-[var(--text-secondary)]'
})
</script>

<style scoped>
.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 命中区对齐宿主 --action-button-size（28px → 32px）；大字号档位下图标放大后自然撑开 */
  min-width: var(--action-button-size, 32px);
  min-height: var(--action-button-size, 32px);
  padding: 6px;
  border-radius: var(--radius-button);
  color: var(--text-secondary);
  transition: background-color 0.15s;
}
.toolbar-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}
</style>
