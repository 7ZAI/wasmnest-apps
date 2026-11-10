/**
 * 会话目录：宿主 `activeSessions` 与项目运行（`bedcode.list-runs`）的合并只读视图
 *
 * ## 为什么需要本模块
 *
 * 桌面 `/api/sessions` 自 2026-11-07 起带 `scope:"session"`（用户 2026-11-06 裁定
 * 「两套入口不互相透出」）：只列**无项目归属**的终端会话，项目运行归 `/api/runs`。
 * 宿主投影 `activeSessions` 以该面为 HTTP 源，因而对项目运行失明——创建事件
 * （`session:created`）会 upsert 一次，但重连对账的全量替换又会把它抹掉。
 * 终端订阅门控、任务面板、存活徽标若只读 `activeSessions`，「桌面先起运行 /
 * 移动重连后」就会把项目运行判成不存在（不订阅、输入 drop、无法入队）。
 *
 * ## 合并口径
 *
 * - `bedcode.list-runs` 无参 = 全量运行（含项目运行；桌面 `run.list` 语义），
 *   映射为会话形状补缺；
 * - 宿主 `activeSessions` 同 id 时**优先**（WS 事件比拉取更新；且带任务槽字段）；
 * - 去重按 `id`（`sessionId` 即 `runId`，同一 id 空间）。
 *
 * ## 刷新与失败口径
 *
 * 会话事件（`session_status` / `session_stopped` / `session_removed`）300ms 合并、
 * 重连（`reconnected`）与调用点按需触发；取数只经插件命令，不直连网络。
 * 拉取失败**保留旧值**只留痕——一次网络失败不等于运行全没了，不能因此把
 * 终端/任务面判成不可用。认证丢失（`reauth_rejected` / 未配对）清空运行侧。
 */
import { ref, watch } from 'vue'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import { fetchRuns } from '../projects/api'
import type { RunView } from '../projects/types'

/** 合并视图条目（宿主会话字段原样保留；运行条目补齐 configId / projectId / agentId） */
export interface DirectorySession {
  id: string
  name?: string
  status?: string
  config_id?: string
  configId?: string
  projectId?: string | null
  agentId?: string | null
  [key: string]: unknown
}

/** 项目运行侧（最近一次成功拉取；失败保留旧值） */
const projectRuns = ref<RunView[]>([])

let ctx: PluginContext | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
/** 代际：dispose / 重新 init 后到达的旧响应不得回填 */
let generation = 0
/** 当前激活期的订阅（dispose 时统一摘除） */
let activeDisposables: Disposable[] = []

/** 单条运行 → 会话形状（与 `SessionInfoView` 消费点兼容：config_id / configId 双键） */
export function runToSession(run: RunView): DirectorySession {
  return {
    id: run.id,
    name: run.title || run.name,
    status: run.status,
    configId: run.configId,
    config_id: run.configId,
    projectId: run.projectId,
    agentId: run.agentId,
  }
}

/**
 * 合并会话列表（每次调用现算；消费方按需包局部 computed）
 *
 * 不做模块级 computed：它会缓存首次求值时读到的宿主 api 引用，宿主共享运行时
 * 换实例（测试替身重装 / 热重载）后不再失效。调用方在自己的 computed 里包一层，
 * 同一渲染周期内仍然只算一次。
 *
 * 宿主会话优先；项目运行补缺。两个来源都未就绪时为空数组（不做假数据）。
 */
export function getDirectorySessions(): DirectorySession[] {
  const api = getMobileApi()
  const hostSessions = (api?.activeSessions?.value ?? []) as DirectorySession[]
  const merged = new Map<string, DirectorySession>()
  for (const run of projectRuns.value) merged.set(run.id, runToSession(run))
  for (const session of hostSessions) merged.set(session.id, session)
  return [...merged.values()]
}

/** 按 id 查会话（终端页 / 任务面板的统一入口；无 → undefined） */
export function directorySessionById(id: string): DirectorySession | undefined {
  return getDirectorySessions().find((session) => session.id === id)
}

/**
 * 运行列表拉取（配对后才发；失败保留旧值只留痕）
 *
 * `force` = 等当前在途请求结束后再拉一次（P1-4）：`startRun` 刚成功的场景里，
 * 在途刷新可能是在运行创建之前发出的，复用它会把刚启动的运行漏掉，目录合并
 * 视图出现瞬时真空 → 终端页 `isSessionActive` 抖动并触发重复订阅。
 */
export async function refreshSessionDirectory(opts?: { force?: boolean }): Promise<void> {
  const activeCtx = ctx
  if (!activeCtx) return
  if (!getMobileApi()?.isPaired?.value) return
  // 非强制：复用在途请求；强制：等它落定后再新起一轮（不在途则直接拉）。
  // 代际变更（dispose/重新 init）时 finally 不会清 inflight——用 promise 身份
  // 比对退出等待，防止死循环。
  while (inflight) {
    if (!opts?.force) return inflight
    const pending = inflight
    await pending
    if (inflight === pending) break
  }
  const gen = generation
  inflight = (async () => {
    try {
      const runs = await fetchRuns(activeCtx)
      if (gen === generation) projectRuns.value = runs
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      activeCtx.logger.warn(`[session-directory] refresh runs failed: ${message}`)
    } finally {
      if (gen === generation) inflight = null
    }
  })()
  return inflight
}

/** 会话事件 → 合并刷新（高频事件只拉一次） */
export function scheduleSessionDirectoryRefresh(): void {
  if (debounceTimer !== null) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void refreshSessionDirectory()
  }, 300)
}

/**
 * 激活期初始化（项目域 activate 调用；幂等，重复调用先拆旧订阅）
 *
 * @returns dispose：摘订阅 / 停定时器 / 清运行侧状态
 */
export function initSessionDirectory(context: PluginContext): Disposable {
  disposeSessionDirectory()
  ctx = context
  const api = getMobileApi()
  const disposables: Disposable[] = []
  activeDisposables = disposables

  disposables.push(
    api.onSessionEvent((event) => {
      // `session_status` 同时覆盖创建/恢复（宿主 SDK 无独立 session_created
      // 事件）；启动运行后 `useProjects.startRun` 另有 force 刷新兜底。
      if (
        event.type === 'session_status' ||
        event.type === 'session_stopped' ||
        event.type === 'session_removed'
      ) {
        scheduleSessionDirectoryRefresh()
      }
    }),
  )
  disposables.push(
    api.onConnectionEvent((event) => {
      if (event.type === 'reconnected') {
        scheduleSessionDirectoryRefresh()
      } else if (event.type === 'reauth_rejected') {
        projectRuns.value = []
      }
    }),
  )
  // 配对完成 → 补拉；断开 / 掉认证 → 清运行侧（受保护端点已不可用）
  const stopPairWatch = watch(
    () => getMobileApi()?.isPaired?.value === true,
    (paired) => {
      if (paired) void refreshSessionDirectory()
      else projectRuns.value = []
    },
    { immediate: true },
  )
  disposables.push({ dispose: stopPairWatch })

  return {
    dispose() {
      disposeSessionDirectory()
    },
  }
}

/** 拆除：订阅与状态一起收掉（幂等） */
export function disposeSessionDirectory(): void {
  generation += 1
  for (const disposable of activeDisposables) disposable.dispose()
  activeDisposables = []
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  inflight = null
  ctx = null
  projectRuns.value = []
}
