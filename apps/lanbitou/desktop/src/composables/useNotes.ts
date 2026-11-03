import { computed, ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { Note } from '../types'

/** 笔记索引与 CRUD（所有持久化经 Rust 命令面，前端不碰文件系统） */
export function useNotes(ctx: PluginContext) {
  const notes = ref<Note[]>([])
  const activeNoteId = ref<string | null>(null)
  const query = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const activeNote = computed(() => notes.value.find((n) => n.id === activeNoteId.value) ?? null)

  function sortNotes(): void {
    notes.value = [...notes.value].sort((a, b) => b.updatedAt - a.updatedAt)
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
    notes.value = (result as Note[]).sort((a, b) => b.updatedAt - a.updatedAt)
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

  return {
    notes,
    activeNote,
    activeNoteId,
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
  }
}
