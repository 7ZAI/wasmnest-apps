<template>
  <div
    ref="rootEl"
    class="lanbitou-root relative flex h-full overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)]"
    :data-theme="themeOverride"
    data-testid="lanbitou-root"
  >
    <!-- 左侧：笔记 / 归档 -->
    <aside
      v-if="showSidebar"
      class="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]"
      data-testid="sidebar"
    >
      <!-- 分区切换：笔记（临时记事 + 其它笔记） / 归档（固定文件夹里的只读记录） -->
      <div class="flex gap-1 border-b border-[var(--border)] p-2" data-testid="sidebar-tabs">
        <button
          v-for="tab in sidebarTabs"
          :key="tab.value"
          type="button"
          class="flex-1 rounded-[var(--radius-tag)] px-2 py-1 text-[length:var(--font-size-sm)] transition-colors"
          :class="
            sidebarTab === tab.value
              ? 'bg-[var(--color-primary)] font-medium text-[var(--color-primary-contrast)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          "
          :data-testid="`sidebar-tab-${tab.value}`"
          :aria-selected="sidebarTab === tab.value"
          @click="switchTab(tab.value)"
        >
          {{ t(tab.label) }}
        </button>
      </div>

      <div v-if="sidebarTab === 'notes'" class="space-y-2 border-b border-[var(--border)] p-2">
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
          v-if="sidebarTab === 'notes'"
          :notes="notes"
          :active-note-id="activeNoteId"
          :search-query="searchQuery"
          :scratch-id="SCRATCH_NOTE_ID"
          @select="handleSelect"
          @delete="requestDelete"
          @rename="handleRename"
        />
        <ArchiveList
          v-else
          :archives="archives"
          :active-id="archiveView?.archive.id ?? null"
          :loading="archivesLoading"
          @select="handleOpenArchive"
        />
      </div>
    </aside>

    <!-- 右侧：工具栏 + 编辑/预览 + 状态栏 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <Toolbar
        :view-mode="viewMode"
        :has-active-note="activeNote !== null && archiveView === null"
        :save-status="autoSave.status.value"
        :archive-mode="archiveView !== null"
        :can-archive="canArchive"
        :archiving="archiving"
        @toggle-sidebar="showSidebar = !showSidebar"
        @create="handleCreate"
        @delete="requestDeleteActive"
        @save="saveActive"
        @copy="copySelection"
        @paste="pasteFromClipboard"
        @insert-time-divider="insertDividerAtCursor"
        @archive="requestArchive"
        @set-view-mode="viewMode = $event"
        @open-settings="showSettings = true"
      />

      <!-- 归档只读提示条：标题 = 时间范围，右侧一键回到笔记 -->
      <div
        v-if="archiveView"
        class="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-[length:var(--font-size-xs)] text-[var(--text-secondary)]"
        data-testid="archive-banner"
      >
        <span class="truncate font-medium text-[var(--text-primary)]">
          {{ archiveView.archive.title }}
        </span>
        <span class="shrink-0 rounded-[var(--radius-tag)] bg-[var(--bg-input)] px-1.5 py-0.5">
          {{ t('archiveReadOnly') }}
        </span>
        <span class="flex-1" />
        <button
          type="button"
          class="shrink-0 rounded-[var(--radius-tag)] px-2 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          data-testid="archive-close"
          @click="closeArchive"
        >
          {{ t('backToNotes') }}
        </button>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- 归档：只读面（源码 + 预览同宽分屏，与笔记同一套版式） -->
        <template v-if="archiveView">
          <div
            v-if="viewMode !== 'preview'"
            class="min-w-0 flex-1 overflow-hidden"
            :class="{ 'border-r border-[var(--border)]': viewMode === 'split' }"
          >
            <CodeEditor
              ref="archiveEditorRef"
              :model-value="archiveView.content"
              :document-id="`archive:${archiveView.archive.id}`"
              :font-size="settings.fontSize"
              :font-family="settings.fontFamily"
              read-only
            />
          </div>
          <div v-if="viewMode !== 'edit'" class="min-w-0 flex-1 overflow-y-auto p-4">
            <MarkdownPreview :content="archiveView.content" />
          </div>
        </template>

        <template v-else-if="activeNote">
          <div
            v-if="viewMode !== 'preview'"
            class="min-w-0 flex-1 overflow-hidden"
            :class="{ 'border-r border-[var(--border)]': viewMode === 'split' }"
          >
            <CodeEditor
              ref="editorRef"
              :model-value="editorContent"
              :document-id="activeNoteId"
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
        :char-count="displayCharCount"
        :word-count="displayWordCount"
        :updated-at="archiveView ? null : (activeNote?.updatedAt ?? null)"
        :toast="toast"
        :error-text="archiveView === null && autoSave.status.value === 'error' ? t('saveFailed') : ''"
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

    <ConfirmDialog
      v-if="archiveConfirm"
      :title="t('archiveConfirmTitle')"
      :body="t('archiveConfirmBody')"
      :confirm-text="t('archiveScratch')"
      :cancel-text="t('cancel')"
      @confirm="confirmArchive"
      @cancel="archiveConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import ArchiveList from './components/ArchiveList.vue'
import CodeEditor from './components/CodeEditor.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import MarkdownPreview from './components/MarkdownPreview.vue'
import NoteList from './components/NoteList.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StatusBar from './components/StatusBar.vue'
import Toolbar from './components/Toolbar.vue'
import { localDateString } from './archive'
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
import {
  SCRATCH_NOTE_ID,
  type ArchiveDetail,
  type CursorPosition,
  type Locale,
  type Note,
  type NoteSettings,
  type SidebarTab,
  type ViewMode,
} from './types'

const { t, ctx } = useI18n()
if (!ctx) throw new Error('pluginContext not provided')

const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null)
/** 归档只读面的编辑器（与笔记编辑器不同实例，内容也不同源） */
const archiveEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null)
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
const sidebarTab = ref<SidebarTab>('notes')
/** 当前打开的归档（null = 在笔记面）；只读不改写 */
const archiveView = ref<ArchiveDetail | null>(null)
const archiveConfirm = ref(false)
const archiving = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const sidebarTabs: { value: SidebarTab; label: string }[] = [
  { value: 'notes', label: 'tabNotes' },
  { value: 'archives', label: 'tabArchives' },
]

const {
  settings,
  loaded: settingsLoaded,
  load: loadSettings,
  save: saveSettings,
} = useSettings(ctx)

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
  scratchNote,
  archives,
  archivesLoading,
  query: searchQuery,
  loadNotes,
  setQuery,
  createNote,
  openNote,
  saveNote,
  deleteNote,
  renameNote,
  ensureScratch,
  loadArchives,
  archiveScratch,
  openArchive,
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

/** 状态栏口径：归档面统计归档正文，笔记面统计编辑器 */
const displayContent = computed(() => archiveView.value?.content ?? editorContent.value)
const displayCharCount = computed(() => displayContent.value.length)
const displayWordCount = computed(() => countWords(displayContent.value))

/** 可归档：临时记事存在且有正文（归档只针对它） */
const canArchive = computed(() => {
  if (activeNote.value?.id === SCRATCH_NOTE_ID) return editorContent.value.trim().length > 0
  return (scratchNote.value?.content.trim().length ?? 0) > 0
})

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
  // 临时记事是默认文档：名字固定，不随正文首行变
  if (note.id === SCRATCH_NOTE_ID) return t('scratchNote')
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
  if (id === activeNoteId.value && archiveView.value === null) return
  if (!(await flushPendingSave())) return
  archiveView.value = null

  try {
    const note = await openNote(id)
    loadNoteIntoEditor(note)
    patchContext({ lastOpenedNoteId: id })
    await nextTick()
    editorRef.value?.focus()
    maybeAutoInsertDivider(note)
  } catch (e) {
    showToast(t('openFailed'))
    console.error('[Lanbitou] open note failed:', e)
  }
}

async function handleCreate(): Promise<void> {
  if (!(await flushPendingSave())) return
  archiveView.value = null
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
  // 重命名 = 从磁盘读正文、改首行、写回：先把待保存内容落盘，
  // 否则磁盘旧内容会覆盖编辑器里尚未保存的编辑（manual / onBlur 模式必现）
  if (!(await flushPendingSave())) return
  try {
    const note = await renameNote(id, title)
    if (id === activeNoteId.value) {
      loadNoteIntoEditor(note)
      // 重命名已由 Rust 落盘：再存一次同内容只为同步保存状态，
      // 避免状态栏停在“未保存”（pending 已在上面 flush 清空，不会覆盖编辑）
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

// ==================== 归档 ====================

function switchTab(tab: SidebarTab): void {
  sidebarTab.value = tab
  // 回到笔记分区 = 回到编辑面（归档只是查看，不能拦住编辑）
  if (tab === 'notes' && archiveView.value) closeArchive()
}

async function handleOpenArchive(id: string): Promise<void> {
  if (archiveView.value?.archive.id === id) return
  if (!(await flushPendingSave())) return
  try {
    archiveView.value = await openArchive(id)
    sidebarTab.value = 'archives'
  } catch (e) {
    console.error('[Lanbitou] open archive failed:', e)
    showToast(t('openArchiveFailed'))
  }
}

function closeArchive(): void {
  archiveView.value = null
  void nextTick(() => {
    if (activeNote.value) editorRef.value?.focus()
  })
}

function requestArchive(): void {
  if (!canArchive.value || archiving.value) return
  archiveConfirm.value = true
}

/** 归档 = 把临时记事的全部内容剪进新的归档文档，源文档清空 */
async function confirmArchive(): Promise<void> {
  archiveConfirm.value = false
  if (archiving.value) return
  archiving.value = true
  try {
    if (!(await flushPendingSave())) return
    const createdAt = scratchNote.value?.createdAt ?? 0
    const outcome = await archiveScratch(
      localDateString(),
      localDateString(createdAt > 0 ? new Date(createdAt) : new Date()),
    )
    // 源文档被剪空：正在看它时同步编辑器，并清掉待保存状态（否则空内容会被再次写盘）
    if (activeNoteId.value === SCRATCH_NOTE_ID) {
      autoSave.cancel()
      loadNoteIntoEditor(outcome.source)
    }
    patchContext({ lastEditTimestamp: null })
    showToast(t('archivedTo', { name: outcome.archive.title }))
    await loadArchives()
  } catch (e) {
    console.error('[Lanbitou] archive failed:', e)
    showToast(t('archiveFailed'))
  } finally {
    archiving.value = false
  }
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
  // 归档面也要能复制：从归档编辑器取选区
  const editor = archiveView.value ? archiveEditorRef.value : editorRef.value
  const selection = editor?.getSelection() ?? ''
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
  if (archiveView.value) return
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

/** 事件是否发生在编辑器内（编辑器自己的快捷键优先：Ctrl+F 查找等） */
function isEditorEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return !!target?.closest?.('.cm-editor')
}

function focusSidebarSearch(): void {
  showSidebar.value = true
  sidebarTab.value = 'notes'
  void nextTick(() => {
    searchEl.value?.focus()
    searchEl.value?.select()
  })
}

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return

  const key = event.key.toLowerCase()
  const inEditor = isEditorEvent(event)

  if (key === 's') {
    event.preventDefault()
    if (!archiveView.value) void saveActive()
  } else if (key === 'n') {
    event.preventDefault()
    void handleCreate()
  } else if (key === 'f') {
    // 编辑器内让给 CodeMirror 的查找面板（常规编辑器行为）；
    // 编辑器外 / Ctrl+Shift+F 仍搜笔记标题与正文
    if (inEditor && !event.shiftKey) return
    event.preventDefault()
    focusSidebarSearch()
  } else if (event.shiftKey && key === 't') {
    event.preventDefault()
    if (!archiveView.value) insertDividerAtCursor()
  } else if (key === '\\') {
    // 侧栏显隐（旧版 Ctrl/Cmd+\ 行为）
    event.preventDefault()
    showSidebar.value = !showSidebar.value
  }
}

async function restoreSession(): Promise<void> {
  // 默认进入临时记事（用户口径：默认文档一直打开）；上次的光标 / 滚动只在它仍是
  // 当前文档时恢复，别把其它笔记的定位带过来。
  const target = scratchNote.value ?? notes.value[0] ?? null
  if (!target) return

  const note = await openNote(target.id)
  loadNoteIntoEditor(note)
  patchContext({ lastOpenedNoteId: note.id })
  await nextTick()

  if (note.id === context.value.lastOpenedNoteId) {
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
    // 默认文档自愈（activate 已建过；这里幂等），并把归档清单预热
    await ensureScratch()
    await restoreSession()
  } catch (e) {
    console.error('[Lanbitou] initial load failed:', e)
    showToast(t('saveFailed'))
  }

  try {
    await loadArchives()
  } catch (e) {
    // 归档列表读失败不阻断编辑（侧栏显示空态 + 控制台留痕）
    console.error('[Lanbitou] load archives failed:', e)
  }

  document.addEventListener('keydown', onKeydown)
})

/**
 * 卸载前落盘：待保存正文 + 工作上下文
 *
 * 宿主 `mountApp` 返回的 `unmount()` 是 async，会先 await 本方法再卸载；
 * `onBeforeUnmount` 里的调用只是「应用被直接卸载」时的兜底（重复执行是幂等的）。
 */
async function flushAll(): Promise<void> {
  try {
    if (activeNoteId.value && autoSave.hasPending()) {
      await autoSave.saveNow(activeNoteId.value, editorContent.value)
    }
  } finally {
    cancelContextSave()
    await flushContext().catch((e) => {
      console.error('[Lanbitou] flush context failed:', e)
    })
  }
}

defineExpose({ flushAll })

onBeforeUnmount(() => {
  narrowViewportQuery?.removeEventListener('change', onNarrowViewportChange)
  document.removeEventListener('keydown', onKeydown)
  if (toastTimer) clearTimeout(toastTimer)
  void flushAll()
})
</script>

<style scoped>
/* 应用是定高壳：禁止根容器被任何 scrollIntoView 带着滚（内容各自滚动）。
   overflow: clip 不生成可编程滚动区；旧 WebKit 不支持时回退到上面工具类的 hidden。 */
.lanbitou-root {
  overflow: clip;
}
</style>
