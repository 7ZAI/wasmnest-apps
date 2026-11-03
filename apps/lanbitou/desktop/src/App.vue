<template>
  <div
    ref="rootEl"
    class="lanbitou-root relative flex h-full overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)]"
    :data-theme="themeOverride"
    data-testid="lanbitou-root"
  >
    <!-- 左侧：笔记列表 -->
    <aside
      v-if="showSidebar"
      class="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]"
      data-testid="sidebar"
    >
      <div class="space-y-2 border-b border-[var(--border)] p-2">
        <button
          type="button"
          class="w-full rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3 py-2 text-[length:var(--font-size-sm)] font-medium text-[var(--color-primary-contrast)] transition-colors hover:bg-[var(--color-primary-hover)]"
          data-testid="sidebar-new-note"
          @click="handleCreate"
        >
          {{ t('newNote') }}
        </button>
        <div class="relative">
          <input
            ref="searchEl"
            v-model="searchInput"
            type="text"
            :placeholder="t('searchPlaceholder')"
            :aria-label="t('searchPlaceholder')"
            class="w-full rounded-[var(--radius-input)] border border-[var(--border-input)] bg-[var(--bg-input)] px-2 py-1.5 pr-8 text-[length:var(--font-size-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary)]"
            data-testid="search-input"
          />
          <button
            v-if="searchInput"
            type="button"
            class="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[var(--radius-tag)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            :title="t('clearSearch')"
            :aria-label="t('clearSearch')"
            data-testid="search-clear"
            @click="clearSearch"
          >
            <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        <NoteList
          :notes="notes"
          :active-note-id="activeNoteId"
          :search-query="searchQuery"
          @select="handleSelect"
          @delete="requestDelete"
          @rename="handleRename"
        />
      </div>
    </aside>

    <!-- 右侧：工具栏 + 编辑/预览 + 状态栏 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <Toolbar
        :view-mode="viewMode"
        :has-active-note="activeNote !== null"
        :save-status="autoSave.status.value"
        @toggle-sidebar="showSidebar = !showSidebar"
        @create="handleCreate"
        @delete="requestDeleteActive"
        @save="saveActive"
        @copy="copySelection"
        @paste="pasteFromClipboard"
        @insert-time-divider="insertDividerAtCursor"
        @set-view-mode="viewMode = $event"
        @open-settings="showSettings = true"
      />

      <div class="flex flex-1 overflow-hidden">
        <template v-if="activeNote">
          <div
            v-if="viewMode !== 'preview'"
            class="min-w-0 flex-1 overflow-hidden"
            :class="{ 'border-r border-[var(--border)]': viewMode === 'split' }"
          >
            <CodeEditor
              ref="editorRef"
              :model-value="editorContent"
              :font-size="settings.fontSize"
              :font-family="settings.fontFamily"
              @update:model-value="onContentChange"
              @cursor-change="onCursorChange"
              @scroll-change="onScrollChange"
              @blur="autoSave.flushOnBlur()"
            />
          </div>
          <div v-if="viewMode !== 'edit'" class="min-w-0 flex-1 overflow-y-auto p-4">
            <MarkdownPreview :content="editorContent" />
          </div>
        </template>

        <div
          v-else
          class="flex flex-1 items-center justify-center text-[var(--text-tertiary)]"
          data-testid="empty-state"
        >
          <div class="text-center">
            <p class="mb-1 text-[length:var(--font-size-lg)]">{{ t('noNotes') }}</p>
            <p class="text-[length:var(--font-size-sm)]">{{ t('noNotesHint') }}</p>
            <button
              type="button"
              class="mt-4 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-4 py-2 text-[length:var(--font-size-sm)] font-medium text-[var(--color-primary-contrast)] transition-colors hover:bg-[var(--color-primary-hover)]"
              data-testid="empty-create-note"
              @click="handleCreate"
            >
              {{ t('newNote') }}
            </button>
          </div>
        </div>
      </div>

      <StatusBar
        :char-count="charCount"
        :word-count="wordCount"
        :updated-at="activeNote?.updatedAt ?? null"
        :toast="toast"
        :error-text="autoSave.status.value === 'error' ? t('saveFailed') : ''"
      />
    </main>

    <SettingsDialog
      v-if="showSettings"
      :settings="settings"
      @close="closeSettings"
      @save="handleSaveSettings"
      @language-change="applyLocale"
    />

    <ConfirmDialog
      v-if="deleteTarget"
      :title="t('deleteConfirmTitle')"
      :body="t('deleteConfirmBody', { title: displayTitle(deleteTarget) })"
      :confirm-text="t('deleteNote')"
      :cancel-text="t('cancel')"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import CodeEditor from './components/CodeEditor.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import NoteList from './components/NoteList.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StatusBar from './components/StatusBar.vue'
import Toolbar from './components/Toolbar.vue'
import { readClipboard, writeClipboard } from './clipboard'
import { useAutoSave } from './composables/useAutoSave'
import { useI18n } from './composables/useI18n'
import { useNotes } from './composables/useNotes'
import { useSettings } from './composables/useSettings'
import {
  buildInsertion,
  dividerRemoved,
  formatDivider,
  insertAtCursor,
  shouldAutoInsert,
} from './composables/useTimeDivider'
import { useWorkingContext } from './composables/useWorkingContext'
import type { CursorPosition, Locale, Note, NoteSettings, ViewMode } from './types'

const { t, ctx } = useI18n()
if (!ctx) throw new Error('pluginContext not provided')

const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null)
/** 应用根元素（SelectField 的浮层 Teleport 目标：在根内继承应用主题 token） */
const rootEl = ref<HTMLElement | null>(null)
provide('appRootEl', rootEl)
const editorContent = ref('')
const previousContent = ref('')
const searchInput = ref('')
/** 搜索框元素（Ctrl/Cmd+F 聚焦用；v-model 的 ref 不能直接 focus） */
const searchEl = ref<HTMLInputElement | null>(null)
/** 窄窗自动收起侧栏（≤920px）；用户仍可用工具栏按钮手动展开 */
const narrowViewportQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 920px)')
    : null
const showSidebar = ref(!narrowViewportQuery?.matches)
const showSettings = ref(false)
const viewMode = ref<ViewMode>('split')
const deleteTarget = ref<Note | null>(null)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const { settings, loaded: settingsLoaded, load: loadSettings, save: saveSettings } =
  useSettings(ctx)

/** 视图模式属于工作偏好：切换即持久化（旧版存 settings.viewMode，重启恢复） */
watch(viewMode, (mode) => {
  if (!settingsLoaded.value || settings.value.viewMode === mode) return
  void saveSettings({ ...settings.value, viewMode: mode }).catch((e) => {
    console.error('[Lanbitou] persist view mode failed:', e)
  })
})
const {
  context,
  load: loadContext,
  patch: patchContext,
  flush: flushContext,
  cancelPending: cancelContextSave,
  markDividerDeleted,
} = useWorkingContext(ctx)
const {
  notes,
  activeNote,
  activeNoteId,
  query: searchQuery,
  loadNotes,
  setQuery,
  createNote,
  openNote,
  saveNote,
  deleteNote,
  renameNote,
} = useNotes(ctx)

/** 搜索框 → 列表查询（200ms 防抖在 setQuery 内） */
watch(searchInput, (value) => setQuery(value))

function clearSearch(): void {
  searchInput.value = ''
  setQuery('')
}

const autoSave = useAutoSave({
  mode: () => settings.value.autoSaveMode,
  debounceMs: () => settings.value.autoSaveDebounce,
  save: async (id, content) => {
    await saveNote(id, content)
  },
})

const themeOverride = computed(() =>
  settings.value.theme === 'system' ? undefined : settings.value.theme,
)

const charCount = computed(() => editorContent.value.length)
const wordCount = computed(() => countWords(editorContent.value))

/** 中文按字、拉丁按词计数（状态栏口径） */
function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  const cjk = (trimmed.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
  const latin = trimmed
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return cjk + latin
}

function displayTitle(note: Note): string {
  return note.title && note.title !== 'Untitled' ? note.title : t('untitled')
}

function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
    toastTimer = null
  }, 2400)
}

function applyLocale(locale: Locale): void {
  const instance = ctx!.i18n.getI18n() as {
    global?: { locale?: { value: string } }
  }
  if (instance?.global?.locale) instance.global.locale.value = locale
}

// ==================== 内容与保存 ====================

function onContentChange(value: string): void {
  const previous = previousContent.value
  // 程序化写入（打开笔记 / 自动插入分隔符）会回流同值事件：不算用户编辑
  if (value === previous) return
  editorContent.value = value
  previousContent.value = value

  const noteId = activeNoteId.value
  if (!noteId) return

  if (dividerRemoved(previous, value, settings.value.timeDivider.format)) {
    markDividerDeleted(noteId)
  }
  patchContext({ lastEditTimestamp: Date.now() })
  autoSave.schedule(noteId, value)
}

async function saveActive(): Promise<boolean> {
  const note = activeNote.value
  if (!note) return false
  const ok = await autoSave.saveNow(note.id, editorContent.value)
  if (!ok) showToast(t('saveFailed'))
  else patchContext({ lastEditTimestamp: Date.now() })
  return ok
}

/** 切换 / 新建 / 删除前落盘；失败时中止操作，避免覆盖未保存内容 */
async function flushPendingSave(): Promise<boolean> {
  if (!activeNoteId.value || !autoSave.hasPending()) return true
  return saveActive()
}

// ==================== 笔记操作 ====================

async function handleSelect(id: string): Promise<void> {
  if (id === activeNoteId.value) return
  if (!(await flushPendingSave())) return

  try {
    const note = await openNote(id)
    loadNoteIntoEditor(note)
    patchContext({ lastOpenedNoteId: id })
    await nextTick()
    editorRef.value?.focus()
    maybeAutoInsertDivider(note)
  } catch (e) {
    showToast(t('saveFailed'))
    console.error('[Lanbitou] open note failed:', e)
  }
}

async function handleCreate(): Promise<void> {
  if (!(await flushPendingSave())) return
  try {
    const note = await createNote()
    searchInput.value = ''
    setQuery('')
    loadNoteIntoEditor(note)
    patchContext({ lastOpenedNoteId: note.id, cursorPosition: null, scrollPosition: null })
    await nextTick()
    editorRef.value?.focus()
  } catch (e) {
    console.error('[Lanbitou] create note failed:', e)
    showToast(t('saveFailed'))
  }
}

function requestDeleteActive(): void {
  if (activeNote.value) deleteTarget.value = activeNote.value
}

function requestDelete(id: string): void {
  deleteTarget.value = notes.value.find((n) => n.id === id) ?? null
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return

  const deletingActive = activeNoteId.value === target.id
  if (deletingActive) autoSave.cancel()

  try {
    await deleteNote(target.id)
  } catch (e) {
    console.error('[Lanbitou] delete note failed:', e)
    showToast(t('saveFailed'))
    return
  }

  if (deletingActive) {
    editorContent.value = ''
    previousContent.value = ''
    const nextId = activeNoteId.value
    if (nextId) {
      const note = await openNote(nextId)
      loadNoteIntoEditor(note)
      await nextTick()
      editorRef.value?.focus()
    }
  }
  patchContext({ lastOpenedNoteId: activeNoteId.value, cursorPosition: null, scrollPosition: null })
}

async function handleRename(id: string, title: string): Promise<void> {
  try {
    const note = await renameNote(id, title)
    if (id === activeNoteId.value) {
      loadNoteIntoEditor(note)
      // 重命名已由 Rust 落盘：同步保存状态，避免状态栏停在“未保存”
      await autoSave.saveNow(id, note.content)
    }
  } catch (e) {
    console.error('[Lanbitou] rename failed:', e)
    showToast(t('saveFailed'))
  }
}

function loadNoteIntoEditor(note: Note): void {
  editorContent.value = note.content
  previousContent.value = note.content
}

// ==================== 时间分隔符 ====================

function dividerText(): string {
  return formatDivider(new Date(), settings.value.timeDivider.format, settings.value.language)
}

function applyContent(content: string, cursor: CursorPosition | null): void {
  editorContent.value = content
  previousContent.value = content
  if (cursor) editorRef.value?.setCursor(cursor)
}

function insertDividerAtCursor(): void {
  const note = activeNote.value
  if (!note) return
  const cursor = editorRef.value?.getCursor() ?? null
  const result = insertAtCursor(editorContent.value, dividerText(), cursor)
  applyContent(result.content, result.cursor)
  void autoSave.saveNow(note.id, result.content)
}

function maybeAutoInsertDivider(note: Note): void {
  const td = settings.value.timeDivider
  const now = Date.now()
  if (
    !shouldAutoInsert({
      settings: td,
      noteId: note.id,
      deletedDividerNotes: context.value.deletedDividerNotes,
      lastEditTimestamp: context.value.lastEditTimestamp,
      now,
    })
  ) {
    return
  }

  const cursor = td.position === 'cursor' ? (editorRef.value?.getCursor() ?? null) : null
  const result = buildInsertion(editorContent.value, dividerText(), td.position, cursor)
  applyContent(result.content, result.cursor)
  void autoSave.saveNow(note.id, result.content)
}

// ==================== 剪贴板 ====================

async function copySelection(): Promise<void> {
  const selection = editorRef.value?.getSelection() ?? ''
  if (!selection) return
  try {
    await writeClipboard(ctx!, selection)
    showToast(t('copied'))
  } catch (e) {
    console.error('[Lanbitou] clipboard write failed:', e)
    showToast(t('saveFailed'))
  }
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await readClipboard(ctx!)
    if (!text) {
      showToast(t('pasteEmpty'))
      return
    }
    editorRef.value?.insertAtCursor(text)
  } catch (e) {
    console.error('[Lanbitou] clipboard read failed:', e)
    showToast(t('clipboardReadFailed'))
  }
}

// ==================== 编辑器状态跟踪 ====================

function onCursorChange(position: CursorPosition): void {
  patchContext({ cursorPosition: position })
}

function onScrollChange(scrollTop: number): void {
  patchContext({ scrollPosition: Math.round(scrollTop) })
}

// ==================== 设置 ====================

async function handleSaveSettings(next: NoteSettings): Promise<void> {
  try {
    await saveSettings(next)
    applyLocale(next.language)
    showSettings.value = false
  } catch (e) {
    console.error('[Lanbitou] save settings failed:', e)
    showToast(t('saveFailed'))
  }
}

function closeSettings(): void {
  applyLocale(settings.value.language)
  showSettings.value = false
}

// ==================== 生命周期 ====================

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return

  const key = event.key.toLowerCase()
  if (key === 's') {
    event.preventDefault()
    void saveActive()
  } else if (key === 'n') {
    event.preventDefault()
    void handleCreate()
  } else if (event.shiftKey && key === 't') {
    event.preventDefault()
    insertDividerAtCursor()
  } else if (key === 'f') {
    // 查找：展开侧栏并聚焦搜索框（旧版 Ctrl/Cmd+F 行为）
    event.preventDefault()
    showSidebar.value = true
    void nextTick(() => {
      searchEl.value?.focus()
      searchEl.value?.select()
    })
  } else if (key === '\\') {
    // 侧栏显隐（旧版 Ctrl/Cmd+\ 行为）
    event.preventDefault()
    showSidebar.value = !showSidebar.value
  }
}

async function restoreSession(): Promise<void> {
  const targetId = context.value.lastOpenedNoteId
  const target = (targetId && notes.value.find((n) => n.id === targetId)) || notes.value[0] || null
  if (!target) return

  const note = await openNote(target.id)
  loadNoteIntoEditor(note)
  patchContext({ lastOpenedNoteId: note.id })
  await nextTick()

  if (target.id === targetId) {
    if (context.value.cursorPosition) editorRef.value?.setCursor(context.value.cursorPosition)
    if (context.value.scrollPosition !== null) {
      editorRef.value?.setScrollTop(context.value.scrollPosition)
    }
  }
  editorRef.value?.focus()

  // 距上次编辑超过阈值 → 自动插入时间分隔符（spec §23）
  maybeAutoInsertDivider(note)
}

function onNarrowViewportChange(event: MediaQueryListEvent): void {
  showSidebar.value = !event.matches
}

onMounted(async () => {
  narrowViewportQuery?.addEventListener('change', onNarrowViewportChange)
  try {
    await Promise.all([loadSettings(), loadContext()])
  } catch (e) {
    console.error('[Lanbitou] load settings/context failed:', e)
  }
  applyLocale(settings.value.language)
  viewMode.value = settings.value.viewMode

  try {
    await loadNotes()
    await restoreSession()
  } catch (e) {
    console.error('[Lanbitou] initial load failed:', e)
    showToast(t('saveFailed'))
  }

  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  narrowViewportQuery?.removeEventListener('change', onNarrowViewportChange)
  document.removeEventListener('keydown', onKeydown)
  if (toastTimer) clearTimeout(toastTimer)
  if (activeNoteId.value && autoSave.hasPending()) {
    void autoSave.saveNow(activeNoteId.value, editorContent.value)
  }
  cancelContextSave()
  void flushContext()
})
</script>

<style scoped>
/* 应用是定高壳：禁止根容器被任何 scrollIntoView 带着滚（内容各自滚动）。
   overflow: clip 不生成可编程滚动区；旧 WebKit 不支持时回退到上面工具类的 hidden。 */
.lanbitou-root {
  overflow: clip;
}
</style>
