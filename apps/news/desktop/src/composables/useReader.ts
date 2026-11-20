import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { ClearMode, ClearedStats, ReaderStats, ReaderView } from '../types'
import { parseError, type NewsError } from '../utils/errors'

export type ReaderStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface ReaderController {
  status: Ref<ReaderStatus>
  view: Ref<ReaderView | null>
  error: Ref<NewsError | null>
  stats: Ref<ReaderStats | null>
  open: (itemId: string, force?: boolean) => Promise<void>
  archive: (itemId: string) => Promise<void>
  retry: (itemId: string) => Promise<void>
  reset: () => void
  loadStats: () => Promise<void>
  clear: (mode: ClearMode) => Promise<ClearedStats>
}

export function useReader(context: PluginContext): ReaderController {
  const status = ref<ReaderStatus>('idle')
  const view = ref<ReaderView | null>(null)
  const error = ref<NewsError | null>(null)
  const stats = ref<ReaderStats | null>(null)

  function applyView(next: ReaderView): void {
    view.value = next
    if (next.state === 'failed') {
      status.value = 'failed'
      error.value = {
        code: next.errorKind ?? 'unknown',
        detail: next.errorDetail ?? '',
      }
      return
    }
    status.value = 'ready'
    error.value = next.stale
      ? { code: next.errorKind ?? 'unknown', detail: next.errorDetail ?? '' }
      : null
  }

  async function open(itemId: string, force = false): Promise<void> {
    status.value = 'loading'
    view.value = null
    error.value = null
    try {
      const payload: Record<string, unknown> = { itemId, nowMs: Date.now() }
      if (force) payload.force = true
      const next = (await context.commands.execute('news.read-item', payload)) as ReaderView
      applyView(next)
    } catch (e) {
      status.value = 'failed'
      error.value = parseError(e)
    }
  }

  async function archive(itemId: string): Promise<void> {
    try {
      const next = (await context.commands.execute('news.archive-item-content', {
        itemId,
        nowMs: Date.now(),
      })) as ReaderView
      applyView(next)
    } catch (e) {
      status.value = 'failed'
      error.value = parseError(e)
    }
  }

  async function retry(itemId: string): Promise<void> {
    await open(itemId, true)
  }

  function reset(): void {
    status.value = 'idle'
    view.value = null
    error.value = null
  }

  async function loadStats(): Promise<void> {
    try {
      stats.value = (await context.commands.execute('news.reader-stats')) as ReaderStats
    } catch {
      stats.value = null
    }
  }

  async function clear(mode: ClearMode): Promise<ClearedStats> {
    const result = (await context.commands.execute('news.clear-reader-cache', {
      mode,
    })) as ClearedStats
    await loadStats()
    return result
  }

  return { status, view, error, stats, open, archive, retry, reset, loadStats, clear }
}