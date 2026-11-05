import { computed, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  SCRATCH_NOTE_ID,
  type Archive,
  type ArchiveDetail,
  type Note,
} from '../types'

/** 归档结果（Rust `archive_scratch` 的返回形状） */
export interface ArchiveOutcome {
  archive: Archive
  source: Note
}

/** 笔记索引与 CRUD（所有持久化经 Rust 命令面，前端不碰文件系统） */
export function useNotes(ctx: PluginContext) {
  const notes = ref<Note[]>([])
  const activeNoteId = ref<string | null>(null)
  const query = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const archives = ref<Archive[]>([])
  const archivesLoading = ref(false)

  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const activeNote = computed(() => notes.value.find((n) => n.id === activeNoteId.value) ?? null)
  /** 临时记事（默认文档）：常驻列表第一位，不受更新时间排序影响 */
  const scratchNote = computed(() => notes.value.find((n) => n.id === SCRATCH_NOTE_ID) ?? null)

  /** 排序：临时记事固定置顶，其余按更新时间倒序 */
  function sortNotes(): void {
    notes.value = [...notes.value].sort((a, b) => {
      if (a.id === SCRATCH_NOTE_ID) return -1
      if (b.id === SCRATCH_NOTE_ID) return 1
      return b.updatedAt - a.updatedAt
    })
  }

  function upsert(note: Note): void {
    const index = notes.value.findIndex((n) => n.id === note.id)
    if (index >= 0) {
      notes.value[index] = note
    } else {
      notes.value.push(note)
    }
    sortNotes()
  }

  async function refresh(): Promise<void> {
    const needle = query.value.trim()
    const result = needle
      ? await ctx.commands.execute('lanbitou.search-notes', { query: needle })
      : await ctx.commands.execute('lanbitou.list-notes')
    notes.value = [...(result as Note[])]
    sortNotes()
  }

  async function loadNotes(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await refresh()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** 搜索输入实时过滤（200ms 防抖；清空恢复全量列表） */
  function setQuery(value: string): void {
    query.value = value
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void refresh().catch((e) => {
        error.value = e instanceof Error ? e.message : String(e)
      })
    }, 200)
  }

  async function createNote(): Promise<Note> {
    const note = (await ctx.commands.execute('lanbitou.create-note')) as Note
    query.value = ''
    notes.value = [note, ...notes.value.filter((n) => n.id !== note.id)]
    activeNoteId.value = note.id
    sortNotes()
    return note
  }

  async function openNote(id: string): Promise<Note> {
    const note = (await ctx.commands.execute('lanbitou.open-note', { id })) as Note
    upsert(note)
    activeNoteId.value = id
    return note
  }

  async function saveNote(id: string, content: string): Promise<Note> {
    const note = (await ctx.commands.execute('lanbitou.save-note', { id, content })) as Note
    upsert(note)
    return note
  }

  async function deleteNote(id: string): Promise<void> {
    await ctx.commands.execute('lanbitou.delete-note', { id })
    notes.value = notes.value.filter((n) => n.id !== id)
    if (activeNoteId.value === id) {
      activeNoteId.value = notes.value[0]?.id ?? null
    }
  }

  async function renameNote(id: string, title: string): Promise<Note> {
    const note = (await ctx.commands.execute('lanbitou.rename-note', { id, title })) as Note
    upsert(note)
    return note
  }

  // ==================== 临时记事 / 归档 ====================

  /** 取默认文档（缺失时 Rust 侧自愈建空文档），并入列表 */
  async function ensureScratch(): Promise<Note> {
    const note = (await ctx.commands.execute('lanbitou.ensure-scratch')) as Note
    upsert(note)
    return note
  }

  async function loadArchives(): Promise<void> {
    archivesLoading.value = true
    try {
      const result = (await ctx.commands.execute('lanbitou.list-archives')) as Archive[]
      archives.value = [...result]
    } finally {
      archivesLoading.value = false
    }
  }

  /**
   * 归档临时记事：全部内容剪到新的归档文档，源文档清空
   *
   * 日期由前端给（本地时区）：`today` = 今天，`fallbackStart` = 正文没有日期时
   * 用作起日的创建日。
   */
  async function archiveScratch(today: string, fallbackStart: string): Promise<ArchiveOutcome> {
    const outcome = (await ctx.commands.execute('lanbitou.archive-scratch', {
      today,
      fallbackStart,
    })) as ArchiveOutcome
    upsert(outcome.source)
    archives.value = [outcome.archive, ...archives.value.filter((a) => a.id !== outcome.archive.id)]
    return outcome
  }

  async function openArchive(id: string): Promise<ArchiveDetail> {
    return (await ctx.commands.execute('lanbitou.open-archive', { id })) as ArchiveDetail
  }

  return {
    notes,
    activeNote,
    activeNoteId,
    scratchNote,
    archives,
    archivesLoading,
    query,
    loading,
    error,
    loadNotes,
    refresh,
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
  }
}
