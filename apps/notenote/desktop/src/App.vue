<template>
  <div class="notenote-root app-theme-root" :data-palette="'warm'">
    <aside class="notenote-sidebar" v-show="sidebarVisible">
      <div class="p-3 border-b border-[var(--border)]">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-sm font-semibold text-[var(--text-primary)]">{{ t('app.title') }}</h1>
          <button
            class="px-2 py-1 text-xs rounded-btn bg-brand text-white hover:bg-[var(--color-primary-hover)]"
            @click="createNote"
          >
            + {{ t('app.newNote') }}
          </button>
        </div>
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          :placeholder="t('app.searchPlaceholder')"
          class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:shadow-input-focus"
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="displayedNotes.length === 0" class="p-4 text-center text-sm text-[var(--text-tertiary)]">
          <p>{{ t('app.emptyTitle') }}</p>
          <p class="mt-1 text-xs">{{ t('app.emptyHint') }}</p>
        </div>
        <div
          v-for="note in displayedNotes"
          :key="note.id"
          class="group px-3 py-2 cursor-pointer border-b border-[var(--border)] hover:bg-hover flex items-start gap-2"
          :class="{ 'bg-brand/10 border-l-2 border-l-brand': note.id === activeNoteId }"
          @click="selectNote(note.id)"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-[var(--text-primary)] truncate">{{ note.title }}</div>
            <div class="text-xs text-[var(--text-tertiary)] mt-0.5">
              {{ formatTime(note.updatedAt) }}
            </div>
          </div>
          <div class="hidden group-hover:flex items-center gap-1 shrink-0">
            <button
              class="p-1 rounded hover:bg-hover text-[var(--text-tertiary)]"
              :title="t('app.rename')"
              @click.stop="startRename(note)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
              </svg>
            </button>
            <button
              class="p-1 rounded hover:bg-hover text-red-400"
              :title="t('app.deleteNote')"
              @click.stop="confirmDelete(note)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>

    <main class="notenote-main">
      <div class="notenote-toolbar">
        <button
          class="p-1.5 rounded-btn hover:bg-hover text-[var(--text-secondary)]"
          :title="t('app.toggleSidebar')"
          @click="sidebarVisible = !sidebarVisible"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <line x1="6" y1="2" x2="6" y2="14" />
          </svg>
        </button>

        <div class="flex items-center gap-1 ml-2">
          <span v-if="autoSave.saving.value" class="text-xs text-[var(--text-tertiary)]">{{ t('save.saving') }}</span>
          <span v-else-if="autoSave.lastSaved.value" class="text-xs text-green-500">{{ t('save.saved') }}</span>
          <span v-else-if="autoSave.error.value" class="text-xs text-red-400">{{ t('save.failed') }}</span>
        </div>

        <div class="flex-1" />

        <div class="flex items-center gap-1">
          <button
            v-for="mode in (['edit', 'split', 'preview'] as const)"
            :key="mode"
            class="px-2 py-1 text-xs rounded-btn"
            :class="viewMode === mode ? 'bg-brand text-white' : 'hover:bg-hover text-[var(--text-secondary)]'"
            @click="viewMode = mode"
          >
            {{ t(`view.${mode}`) }}
          </button>
        </div>

        <button
          class="p-1.5 rounded-btn hover:bg-hover text-[var(--text-secondary)]"
          :title="t('timeDivider.insert')"
          @click="insertTimeDividerManual"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4v4l3 2" />
          </svg>
        </button>

        <button
          class="p-1.5 rounded-btn hover:bg-hover text-[var(--text-secondary)]"
          :title="t('clipboard.paste')"
          @click="pasteFromClipboard"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="4" y="4" width="8" height="10" rx="1" />
            <path d="M6 4V2h4v2M6 8h4M6 11h2" />
          </svg>
        </button>

        <button
          class="p-1.5 rounded-btn hover:bg-hover text-[var(--text-secondary)]"
          :title="t('clipboard.copy')"
          :disabled="!hasSelection"
          @click="copySelectionToClipboard"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="4" width="8" height="10" rx="1" />
            <path d="M6 4V2h8v8h-2" />
          </svg>
        </button>

        <button
          class="p-1.5 rounded-btn hover:bg-hover text-[var(--text-secondary)]"
          :title="t('app.settings')"
          @click="showSettings = true"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
        </button>
      </div>

      <div class="notenote-editor-area">
        <div
          v-if="viewMode === 'edit' || viewMode === 'split'"
          class="notenote-editor-pane"
        >
          <CodeEditor
            ref="editorRef"
            :model-value="activeNoteContent"
            :font-size="session.settings.value.fontSize"
            :font-family="session.settings.value.fontFamily"
            @update:model-value="onContentChange"
            @blur="onEditorBlur"
          />
        </div>
        <div
          v-if="viewMode === 'preview' || viewMode === 'split'"
          class="notenote-preview-pane"
        >
          <MarkdownPreview :content="activeNoteContent" />
        </div>
      </div>

      <div class="notenote-statusbar" v-if="activeNote">
        <div class="flex items-center gap-4">
          <span>{{ t('status.words') }}: {{ wordCount }}</span>
          <span>{{ t('status.chars') }}: {{ charCount }}</span>
        </div>
        <div>
          {{ t('status.modified') }}: {{ formatTime(activeNote.updatedAt) }}
        </div>
      </div>
    </main>

    <!-- Settings Dialog -->
    <div
      v-if="showSettings"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click.self="showSettings = false"
    >
      <div class="bg-card rounded-card p-6 w-[480px] max-h-[80vh] overflow-y-auto shadow-card-hover">
        <h2 class="text-lg font-semibold mb-4 text-[var(--text-primary)]">{{ t('settings.title') }}</h2>

        <div class="space-y-4">
          <div>
            <label class="block text-sm text-[var(--text-secondary)] mb-1">{{ t('settings.autoSaveMode') }}</label>
            <select v-model="draftSettings.autoSaveMode" class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]">
              <option value="realtime">{{ t('settings.autoSaveRealtime') }}</option>
              <option value="onblur">{{ t('settings.autoSaveOnBlur') }}</option>
              <option value="manual">{{ t('settings.autoSaveManual') }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm text-[var(--text-secondary)] mb-1">{{ t('settings.fontSize') }}</label>
            <input
              type="range"
              min="12"
              max="24"
              v-model.number="draftSettings.fontSize"
              class="w-full"
            />
            <span class="text-xs text-[var(--text-tertiary)]">{{ draftSettings.fontSize }}px</span>
          </div>

          <div>
            <label class="block text-sm text-[var(--text-secondary)] mb-1">{{ t('settings.theme') }}</label>
            <select v-model="draftSettings.theme" class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]">
              <option value="system">{{ t('settings.themeSystem') }}</option>
              <option value="light">{{ t('settings.themeLight') }}</option>
              <option value="dark">{{ t('settings.themeDark') }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm text-[var(--text-secondary)] mb-1">{{ t('settings.language') }}</label>
            <select v-model="draftLocale" class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]">
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>

          <fieldset class="border border-[var(--border)] rounded p-3 space-y-2">
            <legend class="text-sm font-medium text-[var(--text-primary)] px-1">{{ t('settings.timeDivider') }}</legend>
            <div class="flex items-center gap-2">
              <input type="checkbox" v-model="draftSettings.timeDivider.enabled" id="td-enabled" />
              <label for="td-enabled" class="text-sm text-[var(--text-secondary)]">{{ t('settings.timeDividerEnabled') }}</label>
            </div>
            <div>
              <label class="block text-xs text-[var(--text-tertiary)] mb-1">{{ t('settings.timeDividerFormat') }}</label>
              <input
                type="text"
                v-model="draftSettings.timeDivider.format"
                class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label class="block text-xs text-[var(--text-tertiary)] mb-1">{{ t('settings.timeDividerPosition') }}</label>
              <select v-model="draftSettings.timeDivider.position" class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]">
                <option value="top">{{ t('settings.timeDividerPositionTop') }}</option>
                <option value="bottom">{{ t('settings.timeDividerPositionBottom') }}</option>
                <option value="cursor">{{ t('settings.timeDividerPositionCursor') }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-[var(--text-tertiary)] mb-1">{{ t('settings.timeDividerInterval') }}</label>
              <select v-model.number="draftSettings.timeDivider.triggerInterval" class="w-full px-2 py-1 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)]">
                <option :value="1">1</option>
                <option :value="5">5</option>
                <option :value="10">10</option>
                <option :value="30">30</option>
              </select>
            </div>
          </fieldset>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button
            class="px-3 py-1.5 text-sm rounded-btn hover:bg-hover text-[var(--text-secondary)]"
            @click="showSettings = false"
          >
            {{ t('settings.cancel') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded-btn bg-brand text-white hover:bg-[var(--color-primary-hover)]"
            @click="applySettings"
          >
            {{ t('settings.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div
      v-if="deleteTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click.self="deleteTarget = null"
    >
      <div class="bg-card rounded-card p-6 w-[360px] shadow-card-hover">
        <h2 class="text-lg font-semibold mb-2 text-[var(--text-primary)]">{{ t('confirm.deleteTitle') }}</h2>
        <p class="text-sm text-[var(--text-secondary)] mb-4">{{ t('confirm.deleteMsg') }}</p>
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 text-sm rounded-btn hover:bg-hover text-[var(--text-secondary)]"
            @click="deleteTarget = null"
          >
            {{ t('confirm.cancel') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded-btn bg-red-500 text-white hover:bg-red-600"
            @click="executeDelete"
          >
            {{ t('confirm.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Rename Dialog -->
    <div
      v-if="renameTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click.self="renameTarget = null"
    >
      <div class="bg-card rounded-card p-6 w-[360px] shadow-card-hover">
        <h2 class="text-lg font-semibold mb-2 text-[var(--text-primary)]">{{ t('app.rename') }}</h2>
        <input
          ref="renameInputRef"
          v-model="renameTitle"
          type="text"
          class="w-full px-2 py-1.5 text-sm rounded-input bg-input border border-[var(--border-input)] text-[var(--text-primary)] focus:outline-none focus:shadow-input-focus mb-4"
          @keydown.enter="executeRename"
        />
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 text-sm rounded-btn hover:bg-hover text-[var(--text-secondary)]"
            @click="renameTarget = null"
          >
            {{ t('settings.cancel') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded-btn bg-brand text-white hover:bg-[var(--color-primary-hover)]"
            @click="executeRename"
          >
            {{ t('settings.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, watch, nextTick, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { Note, AppSettings } from './types'
import { DEFAULT_SETTINGS } from './types'
import CodeEditor from './components/CodeEditor.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import { initApi, api } from './api'
import { useAutoSave, type AutoSaveMode } from './composables/useAutoSave'
import { useTimeDivider } from './composables/useTimeDivider'
import { useSessionRestore } from './composables/useSessionRestore'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'

const { t, locale } = useI18n()
const pluginCtx = inject<PluginContext>('pluginContext')!
initApi(pluginCtx)

const session = useSessionRestore()
const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)

const notes = ref<Note[]>([])
const activeNoteId = ref<string | null>(null)
const activeNoteContent = ref('')
const searchQuery = ref('')
const sidebarVisible = ref(true)
const viewMode = ref<'edit' | 'preview' | 'split'>('split')
const showSettings = ref(false)
const deleteTarget = ref<Note | null>(null)
const renameTarget = ref<Note | null>(null)
const renameTitle = ref('')
const draftLocale = ref(locale.value)

const draftSettings = ref<AppSettings>({ ...DEFAULT_SETTINGS })

const autoSaveMode = computed(() => session.settings.value.autoSaveMode ?? 'realtime' as AutoSaveMode)
const debounceMs = computed(() => session.settings.value.autoSaveDebounce ?? 500)

const autoSave = useAutoSave(activeNoteId, activeNoteContent, autoSaveMode, debounceMs)

const timeDivider = useTimeDivider(
  session.context,
  computed(() => session.settings.value.timeDivider),
  computed(() => locale.value),
)

const activeNote = computed(() => notes.value.find((n) => n.id === activeNoteId.value) ?? null)

const displayedNotes = computed(() => {
  if (!searchQuery.value.trim()) return notes.value
  const q = searchQuery.value.toLowerCase()
  return notes.value.filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
  )
})

const wordCount = computed(() => {
  const text = activeNoteContent.value.trim()
  if (!text) return 0
  return text.split(/\s+/).length
})

const charCount = computed(() => activeNoteContent.value.length)

async function loadNotes() {
  try {
    notes.value = await api.listNotes()
  } catch (e) {
    console.error('[NoteNote] Failed to load notes:', e)
  }
}

async function createNote() {
  try {
    const id = crypto.randomUUID()
    const note = await api.createNote(id)
    notes.value.unshift(note)
    await selectNote(note.id)
  } catch (e) {
    console.error('[NoteNote] Failed to create note:', e)
  }
}

async function selectNote(id: string) {
  activeNoteId.value = id
  try {
    const note = await api.readNote(id)
    let content = note.content

    timeDivider.checkAndPrepare(id)
    if (timeDivider.pendingDivider.value) {
      content = timeDivider.applyDivider(content)
      timeDivider.pendingDivider.value = null
    }

    activeNoteContent.value = content
    const existing = notes.value.find((n) => n.id === id)
    if (existing) {
      existing.title = note.title
      existing.content = content
      existing.updatedAt = note.updatedAt
    }

    session.updateContext({ lastOpenedNoteId: id })
    session.persistContext()
  } catch (e) {
    console.error('[NoteNote] Failed to read note:', e)
    activeNoteContent.value = ''
  }
}

function onContentChange(content: string) {
  activeNoteContent.value = content
  session.updateContext({})
}

function onEditorBlur() {
  if (autoSaveMode.value === 'onblur') {
    autoSave.flushSave()
  }
}

function confirmDelete(note: Note) {
  deleteTarget.value = note
}

async function executeDelete() {
  if (!deleteTarget.value) return
  const id = deleteTarget.value.id
  deleteTarget.value = null
  try {
    await api.deleteNote(id)
    notes.value = notes.value.filter((n) => n.id !== id)
    if (activeNoteId.value === id) {
      activeNoteId.value = null
      activeNoteContent.value = ''
      if (notes.value.length > 0) {
        await selectNote(notes.value[0].id)
      }
    }
  } catch (e) {
    console.error('[NoteNote] Failed to delete note:', e)
  }
}

function startRename(note: Note) {
  renameTarget.value = note
  renameTitle.value = note.title
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

async function executeRename() {
  if (!renameTarget.value || !renameTitle.value.trim()) return
  const id = renameTarget.value.id
  const title = renameTitle.value.trim()
  renameTarget.value = null
  try {
    const note = await api.renameNote(id, title)
    const existing = notes.value.find((n) => n.id === id)
    if (existing) {
      existing.title = note.title
    }
    if (activeNoteId.value === id) {
      activeNoteContent.value = note.content
    }
  } catch (e) {
    console.error('[NoteNote] Failed to rename note:', e)
  }
}

function insertTimeDividerManual() {
  if (!activeNoteId.value) return
  const divider = timeDivider.generateDivider()
  const content = activeNoteContent.value
  activeNoteContent.value = `${content}\n\n${divider}`
}

const hasSelection = computed(() => {
  const editor = editorRef.value
  if (!editor) return false
  return editor.getSelection().length > 0
})

async function pasteFromClipboard() {
  if (!activeNoteId.value) return
  try {
    const result = await api.clipboardRead()
    if (result.text) {
      const editor = editorRef.value
      if (editor) {
        editor.insertTextAtCursor(result.text)
      } else {
        activeNoteContent.value += result.text
      }
    }
  } catch (e) {
    console.error('[NoteNote] Clipboard read failed:', e)
  }
}

async function copySelectionToClipboard() {
  const editor = editorRef.value
  if (!editor) return
  const selected = editor.getSelection()
  if (!selected) return
  try {
    await api.clipboardWrite(selected)
  } catch (e) {
    console.error('[NoteNote] Clipboard write failed:', e)
  }
}

function applySettings() {
  const s = draftSettings.value
  session.settings.value = { ...s }
  locale.value = draftLocale.value
  session.persistSettings()
  showSettings.value = false
}

watch(showSettings, (open) => {
  if (open) {
    draftSettings.value = JSON.parse(JSON.stringify(toRaw(session.settings.value)))
    draftLocale.value = locale.value
  }
})

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

useKeyboardShortcuts({
  onSave: () => autoSave.flushSave(),
  onNewNote: () => createNote(),
  onBold: () => {
    // handled by CodeMirror's default keymap
  },
  onItalic: () => {
    // handled by CodeMirror's default keymap
  },
  onTimeDivider: () => insertTimeDividerManual(),
  onToggleSidebar: () => { sidebarVisible.value = !sidebarVisible.value },
  onFind: () => { searchInputRef.value?.focus() },
})

onMounted(async () => {
  await session.load()
  viewMode.value = session.settings.value.viewMode ?? 'split'
  await loadNotes()
  const ctx = session.context.value
  if (ctx.lastOpenedNoteId && notes.value.find((n) => n.id === ctx.lastOpenedNoteId)) {
    await selectNote(ctx.lastOpenedNoteId)
  } else if (notes.value.length > 0) {
    await selectNote(notes.value[0].id)
  }
})
</script>
