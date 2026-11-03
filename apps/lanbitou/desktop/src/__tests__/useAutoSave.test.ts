import { describe, expect, it, vi } from 'vitest'
import { useAutoSave } from '../composables/useAutoSave'
import type { AutoSaveMode } from '../types'

/** 手动调度器：测试里显式触发防抖回调 */
function fakeScheduler() {
  const tasks: { fn: () => void; delay: number; cancelled: boolean }[] = []
  return {
    tasks,
    scheduler: (fn: () => void, delay: number) => {
      const task = { fn, delay, cancelled: false }
      tasks.push(task)
      return task as unknown as ReturnType<typeof setTimeout>
    },
    clearScheduler: (handle: ReturnType<typeof setTimeout>) => {
      ;(handle as unknown as { cancelled: boolean }).cancelled = true
    },
    runLast() {
      const task = tasks[tasks.length - 1]
      if (task && !task.cancelled) task.fn()
    },
  }
}

function setup(mode: AutoSaveMode, save = vi.fn().mockResolvedValue(undefined)) {
  const fake = fakeScheduler()
  const api = useAutoSave({
    mode: () => mode,
    debounceMs: () => 500,
    save,
    scheduler: fake.scheduler,
    clearScheduler: fake.clearScheduler,
  })
  return { api, save, fake }
}

describe('useAutoSave', () => {
  it('实时模式：防抖后保存真实内容', async () => {
    const { api, save, fake } = setup('realtime')
    api.schedule('note-1', '真实内容')
    expect(api.status.value).toBe('unsaved')
    expect(save).not.toHaveBeenCalled()

    fake.runLast()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('note-1', '真实内容'))
    await vi.waitFor(() => expect(api.status.value).toBe('saved'))
  })

  it('实时模式：连续输入重置计时器，只保存最后一次', async () => {
    const { api, save, fake } = setup('realtime')
    api.schedule('note-1', 'a')
    api.schedule('note-1', 'ab')
    api.schedule('note-1', 'abc')

    expect(fake.tasks.filter((t) => !t.cancelled)).toHaveLength(1)
    fake.runLast()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith('note-1', 'abc')
  })

  it('失焦模式：输入不自动落盘，失焦时才保存', async () => {
    const { api, save, fake } = setup('onBlur')
    api.schedule('note-1', 'abc')
    fake.runLast()
    expect(save).not.toHaveBeenCalled()

    api.flushOnBlur()
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('note-1', 'abc'))
  })

  it('手动模式：schedule 不落盘，saveNow 才保存', async () => {
    const { api, save } = setup('manual')
    api.schedule('note-1', 'abc')
    expect(save).not.toHaveBeenCalled()

    const ok = await api.saveNow('note-1', 'abc')
    expect(ok).toBe(true)
    expect(save).toHaveBeenCalledWith('note-1', 'abc')
  })

  it('保存失败：状态置 error，内容不丢（由调用方持有）', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('disk full'))
    const { api, fake } = setup('realtime', failing)
    api.schedule('note-1', '重要内容')
    fake.runLast()
    await vi.waitFor(() => expect(api.status.value).toBe('error'))
    expect(api.lastError.value).toBe('disk full')
    expect(api.hasPending()).toBe(true)
  })

  it('防抖延迟收敛到 [100, 5000]', async () => {
    const fake = fakeScheduler()
    const api = useAutoSave({
      mode: () => 'realtime',
      debounceMs: () => 10_000,
      save: vi.fn().mockResolvedValue(undefined),
      scheduler: fake.scheduler,
      clearScheduler: fake.clearScheduler,
    })
    api.schedule('n', 'x')
    expect(fake.tasks[0].delay).toBe(5000)
  })
})
