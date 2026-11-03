<template>
  <div class="note-list" data-testid="note-list">
    <div
      v-if="notes.length === 0"
      class="px-4 py-8 text-center text-[length:var(--font-size-sm)] text-[var(--text-tertiary)]"
    >
      {{ searchQuery ? t('noSearchResults') : t('noNotes') }}
    </div>

    <div
      v-for="(note, index) in notes"
      :key="note.id"
      :data-testid="`note-item-${note.id}`"
      class="group relative w-full px-3 py-2.5 border-b border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
      :class="{ 'bg-[var(--bg-hover)]': note.id === activeNoteId }"
      role="button"
      tabindex="0"
      :aria-current="note.id === activeNoteId ? 'true' : undefined"
      @click="$emit('select', note.id)"
      @keydown.enter.prevent="$emit('select', note.id)"
      @keydown.space.prevent="$emit('select', note.id)"
      @keydown.down.prevent="focusSibling(index, 1)"
      @keydown.up.prevent="focusSibling(index, -1)"
    >
      <span
        v-if="note.id === activeNoteId"
        class="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-primary)]"
        aria-hidden="true"
      />
      <div v-if="editingId !== note.id" class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div
            class="truncate text-[length:var(--font-size-base)] font-medium text-[var(--text-primary)]"
          >
            {{ note.title && note.title !== 'Untitled' ? note.title : t('untitled') }}
          </div>
          <div class="mt-1 text-[length:var(--font-size-xs)] text-[var(--text-tertiary)]">
            {{ formatRelative(note.updatedAt) }}
          </div>
        </div>
        <div
          class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            class="p-1 rounded-[var(--radius-tag)] hover:bg-[var(--bg-input)] text-[var(--text-secondary)]"
            :title="t('renameNote')"
            :data-testid="`note-rename-${note.id}`"
            @click.stop="startRename(note)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.4a2 2 0 012.8 2.8L11.8 15.8 8 17l1.2-3.8 8.4-8.4z"
              />
            </svg>
          </button>
          <button
            type="button"
            class="p-1 rounded-[var(--radius-tag)] hover:bg-[var(--bg-input)] text-[var(--color-danger-ink)]"
            :title="t('deleteNote')"
            :data-testid="`note-delete-${note.id}`"
            @click.stop="$emit('delete', note.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.9 12.1A2 2 0 0116.1 21H7.9a2 2 0 01-2-1.9L5 7m4 0V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <div v-else class="flex items-center gap-1" @click.stop>
        <input
          ref="renameInput"
          v-model="editingTitle"
          type="text"
          class="flex-1 min-w-0 px-2 py-1 text-[length:var(--font-size-base)] bg-[var(--bg-input)] border border-[var(--border-input)] rounded-[var(--radius-input)] text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]"
          :data-testid="`note-title-input-${note.id}`"
          @keydown.enter.prevent="commitRename(note.id)"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename(note.id)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import type { Note } from '../types'

const props = defineProps<{
  notes: Note[]
  activeNoteId: string | null
  searchQuery?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
  rename: [id: string, title: string]
}>()

const { t, ctx } = useI18n()

const editingId = ref<string | null>(null)
const editingTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(note: Note): void {
  editingId.value = note.id
  editingTitle.value = note.title === 'Untitled' ? '' : note.title
  void nextTick(() => {
    const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
    input?.focus()
    input?.select()
  })
}

function commitRename(id: string): void {
  if (editingId.value !== id) return
  const title = editingTitle.value.trim()
  editingId.value = null
  if (title !== '') emit('rename', id, title)
}

function cancelRename(): void {
  editingId.value = null
}

function focusSibling(index: number, delta: number): void {
  const target = props.notes[index + delta]
  if (!target) return
  const nodes = document.querySelectorAll<HTMLElement>('[data-testid^="note-item-"]')
  nodes[index + delta]?.focus()
}

function formatRelative(timestamp: number): string {
  if (!timestamp) return t('never')
  const date = new Date(timestamp)
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (diffMins < 1) return t('justNow')
  if (diffMins < 60) return t('minutesAgo', { count: diffMins })
  const hours = Math.floor(diffMins / 60)
  if (hours < 24) return t('hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('daysAgo', { count: days })
  const locale = ctx?.i18n.getI18n()?.global?.locale?.value ?? 'zh-CN'
  return date.toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN')
}
</script>
