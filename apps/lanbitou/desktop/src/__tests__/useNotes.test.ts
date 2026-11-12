import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useNotes } from '../composables/useNotes'
import { SCRATCH_NOTE_ID, type Archive, type Note } from '../types'

function archive(id: string, overrides: Partial<Archive> = {}): Archive {
  return { id, title: id, fileName: `${id}.md`, size: 128, ...overrides }
}

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

  // ==================== 临时记事 / 归档 ====================

  it('临时记事固定置顶：即使更新时间最旧也不参与倒序', async () => {
    const { context } = createContext({
      'lanbitou.list-notes': () => [
        note('a', { updatedAt: 9 }),
        { ...note(SCRATCH_NOTE_ID, { updatedAt: 1 }), title: '--- 2026-01-01 ---' },
        note('b', { updatedAt: 5 }),
      ],
    })
    const api = useNotes(context)
    await api.loadNotes()

    expect(api.notes.value.map((n) => n.id)).toEqual([SCRATCH_NOTE_ID, 'a', 'b'])
    expect(api.scratchNote.value?.id).toBe(SCRATCH_NOTE_ID)
  })

  it('ensureScratch 取默认文档并入列表', async () => {
    const { context, calls } = createContext({
      'lanbitou.ensure-scratch': () => note(SCRATCH_NOTE_ID, { content: '今天' }),
    })
    const api = useNotes(context)

    const scratch = await api.ensureScratch()
    expect(scratch.id).toBe(SCRATCH_NOTE_ID)
    expect(calls[0].command).toBe('lanbitou.ensure-scratch')
    expect(api.notes.value[0].id).toBe(SCRATCH_NOTE_ID)
  })

  it('archiveScratch 传入本地日期、归档前置、源文档同步清空', async () => {
    const { context, calls } = createContext({
      'lanbitou.list-notes': () => [note(SCRATCH_NOTE_ID, { content: '旧内容' })],
      'lanbitou.archive-scratch': () => ({
        archive: archive('2026-10-01_2026-11-04'),
        source: note(SCRATCH_NOTE_ID, { content: '' }),
      }),
    })
    const api = useNotes(context)
    await api.loadNotes()

    const outcome = await api.archiveScratch('2026-11-04', '2026-11-01')
    expect(calls[calls.length - 1]).toEqual({
      command: 'lanbitou.archive-scratch',
      args: [{ today: '2026-11-04', fallbackStart: '2026-11-01' }],
    })
    expect(outcome.archive.id).toBe('2026-10-01_2026-11-04')
    expect(api.archives.value[0].id).toBe('2026-10-01_2026-11-04')
    expect(api.scratchNote.value?.content).toBe('')
  })

  it('newest first 的归档清单：重复收同一份不重复入列', async () => {
    const { context } = createContext({
      'lanbitou.list-archives': () => [archive('2026-11-01_2026-11-04'), archive('2026-10-01_2026-10-31')],
      'lanbitou.archive-scratch': () => ({
        archive: archive('2026-11-01_2026-11-04'),
        source: note(SCRATCH_NOTE_ID),
      }),
    })
    const api = useNotes(context)
    await api.loadArchives()
    expect(api.archives.value.map((a) => a.id)).toEqual([
      '2026-11-01_2026-11-04',
      '2026-10-01_2026-10-31',
    ])

    await api.archiveScratch('2026-11-04', '2026-11-04')
    expect(api.archives.value.map((a) => a.id)).toEqual([
      '2026-11-01_2026-11-04',
      '2026-10-01_2026-10-31',
    ])
  })

  it('openArchive 走 open-archive 命令并把归档正文带回', async () => {
    const { context, calls } = createContext({
      'lanbitou.open-archive': (args) => ({
        archive: archive(args.id),
        content: `正文-${args.id}`,
      }),
    })
    const api = useNotes(context)

    const detail = await api.openArchive('2026-10-01_2026-11-04')
    expect(detail.content).toBe('正文-2026-10-01_2026-11-04')
    expect(calls[0]).toEqual({
      command: 'lanbitou.open-archive',
      args: [{ id: '2026-10-01_2026-11-04' }],
    })
  })
})
