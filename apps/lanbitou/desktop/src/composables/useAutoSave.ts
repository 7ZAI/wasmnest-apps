import { ref } from 'vue'
import {
  MAX_AUTO_SAVE_DEBOUNCE,
  MIN_AUTO_SAVE_DEBOUNCE,
  type AutoSaveMode,
  type SaveStatus,
} from '../types'

export interface UseAutoSaveOptions {
  /** 当前自动保存模式（实时 / 失焦 / 手动） */
  mode: () => AutoSaveMode
  /** 实时模式防抖毫秒数 */
  debounceMs: () => number
  /** 实际保存动作（由调用方注入 noteId + 编辑器当前内容） */
  save: (id: string, content: string) => Promise<void>
  /** 防抖调度器（测试可注入假定时器；默认 setTimeout） */
  scheduler?: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearScheduler?: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * 自动保存：实时（防抖）/ 失焦 / 手动三种模式。
 *
 * - `schedule(id, content)` 在每次输入后调用：实时模式重置防抖计时器；
 * - `flushOnBlur()` 在编辑器失焦时调用：仅失焦模式且存在未保存内容时落盘；
 * - `saveNow(id, content)` 供 Ctrl+S / 切换笔记前强制保存，任何模式下都生效；
 * - 保存失败时状态置 `error`，但**不丢弃**调用方传进来的内容（由调用方持有编辑器状态）。
 */
export function useAutoSave(options: UseAutoSaveOptions) {
  const status = ref<SaveStatus>('idle')
  const lastError = ref<string | null>(null)

  const scheduleFn = options.scheduler ?? ((fn, delay) => setTimeout(fn, delay))
  const clearFn = options.clearScheduler ?? ((handle) => clearTimeout(handle))

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { id: string; content: string } | null = null

  function cancel(): void {
    if (timer) {
      clearFn(timer)
      timer = null
    }
  }

  function clampDelay(delay: number): number {
    if (!Number.isFinite(delay)) return MIN_AUTO_SAVE_DEBOUNCE
    return Math.min(MAX_AUTO_SAVE_DEBOUNCE, Math.max(MIN_AUTO_SAVE_DEBOUNCE, delay))
  }

  /** 立即保存；返回是否成功（失败不抛，状态可展示） */
  async function saveNow(id: string, content: string): Promise<boolean> {
    cancel()
    pending = { id, content }
    status.value = 'saving'
    lastError.value = null
    try {
      await options.save(id, content)
      pending = null
      status.value = 'saved'
      return true
    } catch (e) {
      status.value = 'error'
      lastError.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** 内容变化后调度（实时模式防抖；其余模式只标记未保存） */
  function schedule(id: string, content: string): void {
    pending = { id, content }
    status.value = 'unsaved'
    if (options.mode() !== 'realtime') return
    cancel()
    timer = scheduleFn(() => {
      timer = null
      const current = pending
      if (current) void saveNow(current.id, current.content)
    }, clampDelay(options.debounceMs()))
  }

  /** 编辑器失焦：失焦模式下落盘未保存内容 */
  function flushOnBlur(): void {
    if (options.mode() !== 'onBlur') return
    const current = pending
    if (current && status.value === 'unsaved') void saveNow(current.id, current.content)
  }

  /** 是否有尚未落盘的内容 */
  function hasPending(): boolean {
    return pending !== null
  }

  return { status, lastError, schedule, saveNow, flushOnBlur, cancel, hasPending }
}
