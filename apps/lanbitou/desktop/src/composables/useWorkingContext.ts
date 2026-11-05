import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { DEFAULT_CONTEXT, type CursorPosition, type WorkingContext } from '../types'

const CONTEXT_SAVE_DEBOUNCE_MS = 300

/** 归一化工作上下文（缺项 / 非法值回退默认值） */
export function normalizeContext(raw: unknown): WorkingContext {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const cursor = r.cursorPosition as Partial<CursorPosition> | null | undefined
  const cursorPosition =
    cursor &&
    typeof cursor === 'object' &&
    Number.isFinite(cursor.line) &&
    Number.isFinite(cursor.ch)
      ? { line: Number(cursor.line), ch: Number(cursor.ch) }
      : null

  return {
    lastOpenedNoteId:
      typeof r.lastOpenedNoteId === 'string' && r.lastOpenedNoteId !== ''
        ? r.lastOpenedNoteId
        : null,
    cursorPosition,
    scrollPosition: Number.isFinite(r.scrollPosition as number)
      ? Math.max(0, Number(r.scrollPosition))
      : null,
    lastEditTimestamp: Number.isFinite(r.lastEditTimestamp as number)
      ? Number(r.lastEditTimestamp)
      : null,
    deletedDividerNotes: Array.isArray(r.deletedDividerNotes)
      ? r.deletedDividerNotes.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

/** 工作上下文读写（Rust 侧持久化到 context.json；写入防抖 300ms） */
export function useWorkingContext(ctx: PluginContext) {
  const context = ref<WorkingContext>(normalizeContext(DEFAULT_CONTEXT))
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    const raw = await ctx.commands.execute('lanbitou.read-context')
    context.value = normalizeContext(raw)
  }

  function cancelPending(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function flush(): Promise<void> {
    cancelPending()
    await ctx.commands.execute('lanbitou.save-context', { context: context.value })
  }

  function scheduleSave(): void {
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      void ctx.commands.execute('lanbitou.save-context', { context: context.value }).catch((e) => {
        // 上下文是「恢复现场」的辅助数据：写失败不阻断编辑，但必须留痕
        console.error('[Lanbitou] save context failed:', e)
      })
    }, CONTEXT_SAVE_DEBOUNCE_MS)
  }

  /** 合并字段并安排落盘 */
  function patch(partial: Partial<WorkingContext>): void {
    context.value = { ...context.value, ...partial }
    scheduleSave()
  }

  /** 标记手动删除了分隔符（该笔记后续不再自动插入） */
  function markDividerDeleted(noteId: string): void {
    if (context.value.deletedDividerNotes.includes(noteId)) return
    patch({ deletedDividerNotes: [...context.value.deletedDividerNotes, noteId] })
  }

  return { context, load, patch, flush, cancelPending, markDividerDeleted }
}
