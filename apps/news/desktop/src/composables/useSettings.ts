/**
 * 设置页的取数与写路径（组合式）
 *
 * 与卡片流共用同一套命令面；每次写成功后由调用方决定是否刷新列表
 * （源 / 圈子 / 凭据变更会影响排序与可用性）。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  AiBatchSummaryResult,
  ClearMode,
  ClearedStats,
  CredentialSummary,
  FetchLogEntry,
  NewsCircle,
  NewsSettings,
  NewsSource,
  ReaderStats,
  SourceFetchResult,
} from '../types'
import { parseError } from '../utils/errors'
import { clampWeight } from '../utils/format'

/** 新建 / 更新源的提交形状（与 Rust `NewSource` / `UpdateSource` 对齐）。 */
export interface SourceDraft {
  id?: string
  name: string
  kind: string
  url: string
  circleId?: string | null
  weight: number
  enabled?: boolean
  authId?: string | null
}

/** 凭据提交形状。 */
export interface CredentialDraft {
  id?: string
  kind: string
  label: string
  cookie?: string
  bearer?: string
  csrfToken?: string
}

export interface AutostartState {
  /** 宿主是否提供读取能力；false 时界面只显示指路文案 */
  readable: boolean
  enabled: boolean | null
}

export interface SettingsController {
  sources: Ref<NewsSource[]>
  circles: Ref<NewsCircle[]>
  credentials: Ref<CredentialSummary[]>
  settings: Ref<NewsSettings | null>
  log: Ref<FetchLogEntry[]>
  readerStats: Ref<ReaderStats | null>
  loading: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string | null>
  autostart: Ref<AutostartState>
  aiProgress: Ref<{ done: number; total: number } | null>
  loadAll: () => Promise<void>
  loadLog: () => Promise<void>
  addSource: (draft: SourceDraft) => Promise<void>
  updateSource: (draft: SourceDraft) => Promise<void>
  deleteSource: (id: string) => Promise<void>
  retrySource: (id: string) => Promise<SourceFetchResult>
  addCircle: (name: string, weight: number) => Promise<void>
  updateCircle: (id: string, name: string, weight: number) => Promise<void>
  deleteCircle: (id: string) => Promise<void>
  saveCredential: (draft: CredentialDraft) => Promise<void>
  deleteCredential: (id: string) => Promise<void>
  saveAi: (patch: {
    aiEnabled: boolean
    aiBaseUrl: string
    aiModel: string
    aiApiKey?: string
  }) => Promise<void>
  saveReaderEnabled: (enabled: boolean) => Promise<void>
  clearReaderCache: (mode: ClearMode) => Promise<ClearedStats>
  summarize: (itemIds: string[]) => Promise<AiBatchSummaryResult>
  exportJson: () => Promise<string>
  loadAutostart: () => Promise<void>
}

/** AI 批量摘要的分片大小：分片是为了给出可见进度，不是为了绕过上限。 */
const AI_CHUNK = 5

function nowMs(): number {
  return Date.now()
}

function errorMessage(error: unknown): string {
  const parsed = parseError(error)
  return parsed.detail ? `${parsed.code}: ${parsed.detail}` : parsed.code
}

/**
 * @param context 插件上下文（命令面）
 * @param invokeHost 宿主面命令（只读白名单），用于读取自启状态；不可用时传 undefined
 */
export function useSettings(
  context: PluginContext,
  invokeHost?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>,
): SettingsController {
  const sources = ref<NewsSource[]>([])
  const circles = ref<NewsCircle[]>([])
  const credentials = ref<CredentialSummary[]>([])
  const settings = ref<NewsSettings | null>(null)
  const log = ref<FetchLogEntry[]>([])
  const readerStats = ref<ReaderStats | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const autostart = ref<AutostartState>({ readable: false, enabled: null })
  const aiProgress = ref<{ done: number; total: number } | null>(null)

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const results = await Promise.allSettled([
        loadSources(),
        loadCircles(),
        loadCredentials(),
        loadSettings(),
        loadLog(),
        loadReaderStats(),
      ])
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        error.value = errorMessage(failure.reason)
      }
    } finally {
      loading.value = false
    }
  }

  async function loadSources(): Promise<void> {
    const result = (await context.commands.execute('news.list-sources')) as {
      sources: NewsSource[]
    }
    sources.value = result.sources ?? []
  }

  async function loadCircles(): Promise<void> {
    const result = (await context.commands.execute('news.list-circles')) as {
      circles: NewsCircle[]
    }
    circles.value = result.circles ?? []
  }

  async function loadCredentials(): Promise<void> {
    const result = (await context.commands.execute('news.list-credentials')) as {
      credentials: CredentialSummary[]
    }
    credentials.value = result.credentials ?? []
  }

  async function loadSettings(): Promise<void> {
    settings.value = (await context.commands.execute('news.get-settings')) as NewsSettings
  }

  async function loadReaderStats(): Promise<void> {
    try {
      readerStats.value = (await context.commands.execute('news.reader-stats')) as ReaderStats
    } catch {
      readerStats.value = null
    }
  }

  async function loadLog(): Promise<void> {
    const result = (await context.commands.execute('news.list-fetch-log', {
      limit: 200,
    })) as { entries: FetchLogEntry[] }
    log.value = result.entries ?? []
  }

  async function guard<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true
    error.value = null
    try {
      return await action()
    } catch (e) {
      error.value = errorMessage(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  async function addSource(draft: SourceDraft): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.add-source', {
        name: draft.name.trim(),
        kind: draft.kind,
        url: draft.url.trim(),
        circleId: draft.circleId ?? undefined,
        weight: clampWeight(draft.weight),
        authId: draft.authId ?? undefined,
        nowMs: nowMs(),
      })
      await Promise.all([loadSources(), loadCircles()])
    })
  }

  async function updateSource(draft: SourceDraft): Promise<void> {
    if (!draft.id) throw new Error('invalid.argument: source id is required')
    await guard(async () => {
      await context.commands.execute('news.update-source', {
        id: draft.id,
        name: draft.name.trim(),
        url: draft.url.trim(),
        circleId: draft.circleId ?? null,
        weight: clampWeight(draft.weight),
        enabled: draft.enabled ?? true,
        authId: draft.authId ?? null,
        nowMs: nowMs(),
      })
      await Promise.all([loadSources(), loadCircles()])
    })
  }

  async function deleteSource(id: string): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.delete-source', { id })
      await Promise.all([loadSources(), loadCircles()])
    })
  }

  async function retrySource(id: string): Promise<SourceFetchResult> {
    return guard(async () => {
      const result = (await context.commands.execute('news.refresh-source', {
        sourceId: id,
        nowMs: nowMs(),
      })) as SourceFetchResult
      await Promise.all([loadSources(), loadLog()])
      return result
    })
  }

  async function addCircle(name: string, weight: number): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.add-circle', {
        name: name.trim(),
        weight: clampWeight(weight),
        nowMs: nowMs(),
      })
      await loadCircles()
    })
  }

  async function updateCircle(id: string, name: string, weight: number): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.update-circle', {
        id,
        name: name.trim(),
        weight: clampWeight(weight),
      })
      await Promise.all([loadCircles(), loadSources()])
    })
  }

  async function deleteCircle(id: string): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.delete-circle', { id })
      await Promise.all([loadCircles(), loadSources()])
    })
  }

  async function saveCredential(draft: CredentialDraft): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.save-credential', {
        id: draft.id,
        kind: draft.kind,
        label: draft.label.trim(),
        secret: {
          cookie: draft.cookie?.trim() || undefined,
          bearer: draft.bearer?.trim() || undefined,
          csrfToken: draft.csrfToken?.trim() || undefined,
        },
        nowMs: nowMs(),
      })
      await Promise.all([loadCredentials(), loadSources()])
    })
  }

  async function deleteCredential(id: string): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.delete-credential', { id, nowMs: nowMs() })
      await Promise.all([loadCredentials(), loadSources()])
    })
  }

  async function saveAi(patch: {
    aiEnabled: boolean
    aiBaseUrl: string
    aiModel: string
    aiApiKey?: string
  }): Promise<void> {
    await guard(async () => {
      const payload: Record<string, unknown> = {
        aiEnabled: patch.aiEnabled,
        aiBaseUrl: patch.aiBaseUrl.trim(),
        aiModel: patch.aiModel.trim(),
      }
      // 空密钥 = 保持已保存的 Key：整个字段不发，避免后端把空串当成「清空」
      const key = patch.aiApiKey?.trim()
      if (key) payload.aiApiKey = key
      await context.commands.execute('news.set-settings', payload)
      await loadSettings()
    })
  }

  async function saveReaderEnabled(enabled: boolean): Promise<void> {
    await guard(async () => {
      await context.commands.execute('news.set-settings', { readerEnabled: enabled })
      await loadSettings()
    })
  }

  async function clearReaderCache(mode: ClearMode): Promise<ClearedStats> {
    return guard(async () => {
      const result = (await context.commands.execute('news.clear-reader-cache', {
        mode,
      })) as ClearedStats
      await loadReaderStats()
      return result
    })
  }

  /** 分片批量摘要：每片结束更新进度，单片失败不影响后续片。 */
  async function summarize(itemIds: string[]): Promise<AiBatchSummaryResult> {
    const total = itemIds.length
    const aggregated: AiBatchSummaryResult = { results: [], okCount: 0, failedCount: 0 }
    if (total === 0) return aggregated
    aiProgress.value = { done: 0, total }
    try {
      for (let start = 0; start < total; start += AI_CHUNK) {
        const chunk = itemIds.slice(start, start + AI_CHUNK)
        const part = (await context.commands.execute('news.ai-summarize', {
          itemIds: chunk,
          nowMs: nowMs(),
        })) as AiBatchSummaryResult
        aggregated.results.push(...part.results)
        aggregated.okCount += part.okCount
        aggregated.failedCount += part.failedCount
        aiProgress.value = {
          done: Math.min(total, start + chunk.length),
          total,
        }
      }
      return aggregated
    } finally {
      aiProgress.value = null
    }
  }

  async function exportJson(): Promise<string> {
    return guard(async () => {
      const result = (await context.commands.execute('news.export-json', {
        nowMs: nowMs(),
      })) as { json: string }
      return result.json
    })
  }

  /**
   * 自启状态：宿主面只读清单里有 `autostart` 字段就用它，否则显性标记不可读
   * （应用内没有任何修改自启的入口）。
   */
  async function loadAutostart(): Promise<void> {
    if (!invokeHost) {
      autostart.value = { readable: false, enabled: null }
      return
    }
    try {
      const list = await invokeHost<Array<{ id?: string; autostart?: boolean }>>(
        'plugin_list_loaded',
      )
      const entry = Array.isArray(list)
        ? list.find((item) => item.id === 'com.wasmnest.news')
        : undefined
      if (entry && typeof entry.autostart === 'boolean') {
        autostart.value = { readable: true, enabled: entry.autostart }
      } else {
        autostart.value = { readable: false, enabled: null }
      }
    } catch {
      autostart.value = { readable: false, enabled: null }
    }
  }

  return {
    sources,
    circles,
    credentials,
    settings,
    log,
    readerStats,
    loading,
    busy,
    error,
    autostart,
    aiProgress,
    loadAll,
    loadLog,
    addSource,
    updateSource,
    deleteSource,
    retrySource,
    addCircle,
    updateCircle,
    deleteCircle,
    saveCredential,
    deleteCredential,
    saveAi,
    saveReaderEnabled,
    clearReaderCache,
    summarize,
    exportJson,
    loadAutostart,
  }
}
