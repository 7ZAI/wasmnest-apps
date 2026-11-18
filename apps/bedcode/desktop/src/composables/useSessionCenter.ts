/**
 * 会话中心数据与编排（票 13）
 *
 * 取数红线（spec D2）：只经 PluginContext 与插件命令通道——
 * - 会话运行时状态：命令通道 `session.list`（本插件登记域视图；票 08 起宿主
 *   不再有会话数据命令面，**不**经 `context.session.list()`）
 * - 会话配置 CRUD：插件命令通道 `session.config.*`（真源在本插件私有库）
 * - 创建 / 停止：`session.create` / `session.close`（插件 WASM 编排 → host-session 原语）
 * - 终端窗口：`context.session.openTerminal / closeTerminal / isTerminalOpen /
 *   predictTerminalSize`（窗口本体与渲染管线留宿主，spec D3）
 *
 * **禁止**直调宿主领域命令（`list_sessions` / `start_session` 等）——那层门面是
 * 宿主 UI 的兼容接缝，出现即评审退回（插件工程契约测试 C4 强校验）。
 *
 * 本模块只做「取数 + 编排 + 终端窗口生命周期跟随」，不含文案与弹窗：
 * 错误上抛由视图层决定用户可见提示（错误文案一律 i18n，禁硬编码）。
 *
 * **两条状态口径别混用**（2026-11-06 修正）：
 * - `isRunningStatus` = 仍持有 PTY（非 stopped/error）→ 决定删除前是否先 close、
 *   终端窗口是否跟随关闭
 * - `isRunningStatusCounted` = 真正运行中（running/starting/waitingInput）→ 只用于
 *   「运行中的会话」计数，与后端 `list_running_sessions` 同源
 *
 * 两者都先经 `normalizeSessionStatus` 归一：`session.list` 的错误态是对象而非
 * 字符串，直接比对会把所有历史错误会话误算成运行中（虚报计数的根因）。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 会话配置（插件私有库真源行，camelCase 与宿主 DTO 逐字同形） */
export interface SessionConfigDto {
  id: string
  name: string
  environment: string
  wslDistro?: string | null
  workingDir: string
  command: string
  autoStart: boolean
}

/** 会话运行时记录（宿主 `SessionInfo` 对外视图子集，camelCase） */
export interface SessionDto {
  id: string
  configId: string
  name: string
  /**
   * 已归一的状态字符串：'idle' | 'starting' | 'running' | 'waitingInput' |
   * 'stopping' | 'stopped' | 'error'
   *
   * 线形态上错误态是对象 `{ error }`（见 `normalizeSessionStatus`），
   * `loadSessions()` 已归一，故此处恒为字符串。
   */
  status: string
  createdAt?: string
  startedAt?: string | null
  stoppedAt?: string | null
}

/** 配置写入草稿（`session.config.upsert` 入参；`id` 缺省 = 新建） */
export interface ConfigDraft {
  id?: string
  name: string
  environment: string
  wslDistro?: string
  workingDir: string
  command: string
  autoStart?: boolean
}

/**
 * 会话状态线形状 → 展示字符串
 *
 * `session.list` 走的是 `view_json`，它把状态按宿主 externally-tagged 形态原样
 * 出线：`SessionStatus::Error` 是 **对象** `{ "error": "…" }` 而非字符串
 * （`rust/src/session/view.rs` 的 `error_status_keeps_its_payload_shape` 单测钉死了这一点）。
 * 不归一就直接比对字符串，`status !== 'error'` 恒为真 → 每条历史错误会话都被
 * 算成「运行中」（实测桌面端因此虚报出三十余个）。
 *
 * 口径与 `useProjects.ts::normalizeRunStatus` 一致：对象带 `error` 键即错误态，
 * 其余缺失/异常值一律降级 `'idle'`（非终态但也不计入运行数，见下）。
 */
export function normalizeSessionStatus(status: unknown): string {
  if (typeof status === 'string' && status) return status
  if (status && typeof status === 'object' && 'error' in status) return 'error'
  return 'idle'
}

/**
 * 「仍持有 PTY」的判定：只有 stopped / error 之外才算（与宿主
 * `SessionsFallbackView` 同口径）。调用方据此决定操作语义——删除前是否要先
 * `session.close`、终端窗口是否还要跟随关闭。
 *
 * 注意它**不是**计数口径：`idle` / `stopping` 这里算「未终止」，但不进
 * 「运行中的会话」计数（见 `isRunningStatusCounted`）。
 */
export function isRunningStatus(status: unknown): boolean {
  const normalized = normalizeSessionStatus(status)
  return normalized !== 'stopped' && normalized !== 'error'
}

/**
 * 「运行中的会话」计数口径：只认真正占着 PTY 的三个状态。
 *
 * 与后端 `task/state.rs::list_running_sessions` 和关窗守卫
 * `ops::needs_close_confirmation`（Running / Starting / WaitingInput）逐字同源。
 * 早先这里沿用「非终态即运行」的宽口径，于是 `idle` / `stopping` 这类过渡态
 * 也被算进 Tab 计数，与后端同一份数据给出不同的数。
 */
export function isRunningStatusCounted(status: unknown): boolean {
  const normalized = normalizeSessionStatus(status)
  return normalized === 'running' || normalized === 'starting' || normalized === 'waitingInput'
}

/** 终端窗口可查看的判定（宿主会话页原语义：仅 running / waitingInput 可看） */
export function isViewableStatus(status: unknown): boolean {
  const normalized = normalizeSessionStatus(status)
  return normalized === 'running' || normalized === 'waitingInput'
}

export function useSessionCenter(context: PluginContext) {
  const configs = ref<SessionConfigDto[]>([])
  const sessions = ref<SessionDto[]>([])
  const isLoading = ref(true)
  /** 每秒刷新一次，用于运行时长显示 */
  const now = ref(Date.now())

  const runningSessions = computed<SessionDto[]>(() =>
    sessions.value.filter((s) => isRunningStatusCounted(s.status)),
  )

  // ==================== 取数 ====================

  /** 配置列表：插件私有库真源（命令通道） */
  async function loadConfigs(): Promise<void> {
    const raw = await context.commands.execute('session.config.list', {})
    configs.value = Array.isArray(raw) ? (raw as SessionConfigDto[]) : []
  }

  /**
   * 会话列表：本插件登记域真源（命令通道 → `session-list` 视图面）
   *
   * `session.list` 返回**全量**登记（含终态历史），且 `status` 是宿主 wire 形态
   * ——错误态为对象 `{ "error": "…" }`。这里统一归一成字符串再进响应式数据，
   * 下游（过滤 / 状态点 / 删除语义）才不必各自重复防御。
   */
  async function loadSessions(): Promise<void> {
    const raw = (await context.commands.execute('session.list', {})) as {
      sessions?: Array<SessionDto & { status: unknown }>
    } | null
    const rows = Array.isArray(raw?.sessions) ? raw.sessions : []
    sessions.value = rows.map((row) => ({
      ...row,
      status: normalizeSessionStatus(row.status),
    }))
  }

  /** 全量加载（配置 + 会话）：任一失败上抛，由调用方提示 */
  async function load(): Promise<void> {
    await Promise.all([loadConfigs(), loadSessions()])
  }

  // ==================== 会话编排 ====================

  /**
   * 启动会话：先预测宿主终端窗口网格（PTY 以正确行列 openpty，避免开窗后重排），
   * 再经插件命令通道 `session.create`（命名唯一化 / config→launch 映射 / 两阶段
   * 决策在本插件 WASM 完成）创建并启动，最后刷新列表。
   */
  async function startConfig(configId: string): Promise<void> {
    const size = await context.session.predictTerminalSize()
    await context.commands.execute('session.create', {
      configId,
      cols: size?.cols,
      rows: size?.rows,
      start: true,
    })
    await loadSessions()
  }

  /**
   * 打开（或聚焦）终端窗口。
   *
   * @returns `true` = 新建窗口（调用方显示就绪 loading）；`false` = 未运行（调用方提示）
   */
  async function viewTerminal(session: SessionDto): Promise<boolean> {
    if (!isViewableStatus(session.status)) return false
    await context.session.openTerminal({ id: session.id, name: session.name })
    return true
  }

  /** 停止会话（保留记录）：`session.close` 由插件 WASM 转 host-session 原语 */
  async function stopSession(sessionId: string): Promise<void> {
    await context.commands.execute('session.close', { sessionId })
    await context.session.closeTerminal(sessionId)
    await loadSessions()
  }

  /** 移除会话（连同记录）：`session.action.remove` */
  async function removeSession(sessionId: string): Promise<void> {
    await context.commands.execute('session.action.remove', { sessionId })
    await context.session.closeTerminal(sessionId)
    await loadSessions()
  }

  /** 重启会话（同一 id 重建并启动） */
  async function restartSession(sessionId: string): Promise<void> {
    await context.commands.execute('session.action.restart', { sessionId })
    await loadSessions()
  }

  // ==================== 配置编排 ====================

  /** 写入配置（`id` 命中即覆盖，未命中显性报错；缺省 id 新建） */
  async function saveConfig(draft: ConfigDraft): Promise<void> {
    await context.commands.execute('session.config.upsert', draft)
    await loadConfigs()
  }

  /** 删除配置 */
  async function removeConfig(id: string): Promise<void> {
    await context.commands.execute('session.config.delete', { id })
    await loadConfigs()
  }

  // ==================== 终端窗口生命周期跟随 ====================

  /** 该会话是否已有打开的终端窗口（宿主登记事实；调用方据此决定是否显示 loading） */
  function isTerminalOpen(sessionId: string): boolean {
    return context.session.isTerminalOpen(sessionId)
  }

  // 会话停止 / 出错 / 被移除 → 关闭其终端窗口（宿主会话页原语义）：
  // 窗口本体留宿主，但「何时该关」是会话编排的一部分，故由本模块跟随
  watch(
    sessions,
    (next, prev) => {
      if (!prev) return
      for (const oldSession of prev) {
        const current = next.find((s) => s.id === oldSession.id)
        const wasRunning = isViewableStatus(oldSession.status)
        const nowGone = !current
        const nowDead = current !== undefined && !isRunningStatus(current.status)
        if ((wasRunning && nowDead) || nowGone) {
          void context.session.closeTerminal(oldSession.id)
        }
      }
    },
    { deep: true },
  )

  // ==================== 运行时长计时 ====================

  let timer: ReturnType<typeof setInterval> | null = null

  function startTicker(): void {
    if (timer !== null) return
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function stopTicker(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    configs: configs as Ref<SessionConfigDto[]>,
    sessions: sessions as Ref<SessionDto[]>,
    runningSessions: runningSessions as ComputedRef<SessionDto[]>,
    isLoading,
    now,
    load,
    loadConfigs,
    loadSessions,
    startConfig,
    viewTerminal,
    stopSession,
    removeSession,
    restartSession,
    saveConfig,
    removeConfig,
    isTerminalOpen,
    startTicker,
    stopTicker,
  }
}

export type SessionCenter = ReturnType<typeof useSessionCenter>
