import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useNotes } from '../composables/useNotes'
import type { Note } from '../types'

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `title-${id}`,
    content: `content-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    filePath: `/notes/${id}.md`,
    ...overrides,
  }
}

function createContext(handlers: Record<string, (args: any) => any>) {
  const calls: { command: string; args: any }[] = []
  const context = {
    id: 'com.wasmnest.lanbitou',
    commands: {
      execute: async (command: string, ...args: any[]) => {
        calls.push({ command, args })
        const handler = handlers[command]
        if (!handler) throw new Error(`unexpected command: ${command}`)
        return handler(args[0])
      },
    },
  } as unknown as PluginContext
  return { context, calls }
}

describe('useNotes', () => {
  it('loadNotes 按 updatedAt 降序排列', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('a', { updatedAt: 1 }), note('b', { updatedAt: 3 })],
    })
    const api = useNotes(context)
    await api.loadNotes()
    expect(api.notes.value.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('createNote 插入列表并设为激活', async () => {
    const created = note('new', { title: 'Untitled', content: '' })
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('old')],
      'lanbitou.create-note': () => created,
    })
    const api = useNotes(context)
    await api.loadNotes()
    const result = await api.createNote()

    expect(result.id).toBe('new')
    expect(api.activeNoteId.value).toBe('new')
    expect(api.notes.value[0].id).toBe('new')
  })

  it('saveNote 用命令返回的标题与时间更新列表', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('a')],
      'lanbitou.save-note': (args) =>
        note('a', { content: args.content, title: '新标题', updatedAt: 9999 }),
    })
    const api = useNotes(context)
    await api.loadNotes()

    const saved = await api.saveNote('a', '# 新标题\n正文')
    expect(saved.title).toBe('新标题')
    expect(api.notes.value[0].title).toBe('新标题')
    expect(api.notes.value[0].updatedAt).toBe(9999)
  })

  it('openNote 拉取正文并设为激活', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('a')],
      'lanbitou.open-note': (args) => note(args.id, { content: '完整正文' }),
    })
    const api = useNotes(context)
    await api.loadNotes()

    const opened = await api.openNote('a')
    expect(opened.content).toBe('完整正文')
    expect(api.activeNote.value?.content).toBe('完整正文')
  })

  it('deleteNote 移除笔记并选中下一条', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('a', { updatedAt: 2 }), note('b')],
      'lanbitou.delete-note': () => ({ success: true }),
    })
    const api = useNotes(context)
    await api.loadNotes()
    api.activeNoteId.value = 'a'

    await api.deleteNote('a')
    expect(api.notes.value.map((n) => n.id)).toEqual(['b'])
    expect(api.activeNoteId.value).toBe('b')
  })

  it('renameNote 更新标题与正文首行', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [note('a')],
      'lanbitou.rename-note': (args) =>
        note('a', { title: args.title, content: `${args.title}\n正文` }),
    })
    const api = useNotes(context)
    await api.loadNotes()

    const renamed = await api.renameNote('a', '会议记录')
    expect(renamed.title).toBe('会议记录')
    expect(api.notes.value[0].content.startsWith('会议记录')).toBe(true)
  })

  it('搜索走 search-notes 命令；清空恢复 list-notes', async () => {
    vi.useFakeTimers()
    try {
      const { context, calls } = createContext({
        'lanbitou.list-notes': () => [note('a'), note('b')],
        'lanbitou.search-notes': (args) =>
          [note('a'), note('b')].filter((n) => n.title.includes(args.query)),
      })
      const api = useNotes(context)
      await api.loadNotes()

      api.setQuery('title-a')
      await vi.advanceTimersByTimeAsync(200)
      expect(calls[calls.length - 1]).toEqual({
        command: 'lanbitou.search-notes',
        args: [{ query: 'title-a' }],
      })
      expect(api.notes.value.map((n) => n.id)).toEqual(['a'])

      api.setQuery('')
      await vi.advanceTimersByTimeAsync(200)
      expect(calls[calls.length - 1]?.command).toBe('lanbitou.list-notes')
      expect(api.notes.value).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('list-notes 失败时记录错误且不抛出', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => {
        throw new Error('boom')
      },
    })
    const api = useNotes(context)
    await api.loadNotes()
    expect(api.error.value).toBe('boom')
    expect(api.notes.value).toEqual([])
  })
})
