import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useAutoSave, type AutoSaveMode } from '../composables/useAutoSave'

vi.mock('../api', () => ({
  api: {
    updateNote: vi.fn().mockImplementation((id: string, content: string) =>
      Promise.resolve({
        id,
        title: content.split('\n')[0] || 'Untitled',
        content,
        createdAt: '2026-11-02T00:00:00Z',
        updatedAt: '2026-11-02T12:00:00Z',
      }),
    ),
  },
}))

import { api } from '../api'
const mockedUpdateNote = vi.mocked(api.updateNote)

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(overrides?: {
    noteId?: string | null
    content?: string
    mode?: AutoSaveMode
    debounceMs?: number
  }) {
    const noteId = ref(overrides?.noteId === undefined ? 'note-1' : overrides.noteId)
    const content = ref(overrides?.content ?? 'Hello')
    const mode = ref<AutoSaveMode>(overrides?.mode ?? 'realtime')
    const debounceMs = ref(overrides?.debounceMs ?? 500)
    return { ...useAutoSave(noteId, content, mode, debounceMs), noteId, content, mode }
  }

  describe('save', () => {
    it('直接保存调用 api.updateNote', async () => {
      const autoSave = setup()
      await autoSave.save()

      expect(mockedUpdateNote).toHaveBeenCalledWith('note-1', 'Hello')
      expect(autoSave.lastSaved.value).toBe('2026-11-02T12:00:00Z')
      expect(autoSave.error.value).toBeNull()
    })

    it('noteId 为 null 时不保存', async () => {
      const autoSave = setup({ noteId: null })
      await autoSave.save()

      expect(mockedUpdateNote).not.toHaveBeenCalled()
    })

    it('保存失败时设置 error', async () => {
      mockedUpdateNote.mockRejectedValueOnce(new Error('disk full'))
      const autoSave = setup()
      await autoSave.save()

      expect(autoSave.error.value).toBe('disk full')
      expect(autoSave.saving.value).toBe(false)
    })

    it('contentOverride 优先于当前 content', async () => {
      const autoSave = setup({ content: 'original' })
      await autoSave.save('overridden')

      expect(mockedUpdateNote).toHaveBeenCalledWith('note-1', 'overridden')
    })

    it('saving 状态在保存过程中为 true', async () => {
      let resolveSave: (v: any) => void
      mockedUpdateNote.mockReturnValueOnce(
        new Promise((r) => { resolveSave = r }),
      )

      const autoSave = setup()
      const savePromise = autoSave.save()
      expect(autoSave.saving.value).toBe(true)

      resolveSave!({
        id: 'note-1', title: 'Hello', content: 'Hello',
        createdAt: '', updatedAt: '2026-11-02T12:00:00Z',
      })
      await savePromise
      expect(autoSave.saving.value).toBe(false)
    })
  })

  describe('scheduleSave（realtime 模式）', () => {
    it('500ms 后触发保存', async () => {
      const autoSave = setup({ debounceMs: 500 })
      autoSave.scheduleSave()

      expect(mockedUpdateNote).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(500)
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
    })

    it('重复调度清除前一个定时器', async () => {
      const autoSave = setup({ debounceMs: 500 })
      autoSave.scheduleSave()
      await vi.advanceTimersByTimeAsync(300)
      autoSave.scheduleSave() // 重置定时器
      await vi.advanceTimersByTimeAsync(300)
      expect(mockedUpdateNote).not.toHaveBeenCalled() // 还没到 500ms
      await vi.advanceTimersByTimeAsync(200)
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
    })

    it('非 realtime 模式不调度', async () => {
      const autoSave = setup({ mode: 'manual' })
      autoSave.scheduleSave()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockedUpdateNote).not.toHaveBeenCalled()
    })
  })

  describe('flushSave', () => {
    it('立即保存并清除定时器', async () => {
      const autoSave = setup({ debounceMs: 500 })
      autoSave.scheduleSave()
      autoSave.flushSave()

      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1) // 不会重复保存
    })

    it('无定时器时也执行保存', async () => {
      const autoSave = setup()
      autoSave.flushSave()
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
    })
  })

  describe('onblur 模式', () => {
    it('scheduleSave 不触发（只响应 flushSave）', async () => {
      const autoSave = setup({ mode: 'onblur' })
      autoSave.scheduleSave()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockedUpdateNote).not.toHaveBeenCalled()

      autoSave.flushSave()
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
    })
  })

  describe('manual 模式', () => {
    it('scheduleSave 和 watch 都不触发', async () => {
      const autoSave = setup({ mode: 'manual' })
      autoSave.scheduleSave()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockedUpdateNote).not.toHaveBeenCalled()
    })

    it('flushSave 仍然有效', async () => {
      const autoSave = setup({ mode: 'manual' })
      autoSave.flushSave()
      expect(mockedUpdateNote).toHaveBeenCalledTimes(1)
    })
  })
})
