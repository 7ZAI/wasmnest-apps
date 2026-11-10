/**
 * 项目域状态与编排（项目列表 → 项目内运行 → 终端）
 *
 * 归属：本仓业务语义（项目是桌面端一级容器，移动端是只读消费方 + 运行启动）。
 * 取数只经 `./api`（插件命令面）；本 composable 不碰网络 / 导航 / 弹窗，错误以
 * 字符串槽位保留并由页面 `t()` 展示（与 host 域错误口径一致）。
 *
 * 刷新策略：
 * - 页签可见 / 手动刷新：列表页重取项目；详情页重取运行 + 项目统计（最近活动、
 *   活跃运行数随运行状态变化）；
 * - 会话生命周期事件（`session_status` / `session_stopped` / `session_removed`）：
 *   300ms 合并后按当前页刷新——运行是会话的投影，事件仍由会话域发出；
 * - 相对时间由 30s ticker 推进，不为每一行挂独立定时器。
 */
import { computed, ref, type Ref } from 'vue'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import {
  fetchAgents,
  fetchProjects,
  fetchRuns,
  startRun as startRunCommand,
  stopRun as stopRunCommand,
} from './api'
import type { AgentEntry, ProjectView, RunView } from './types'
import { refreshSessionDirectory } from '../host/sessionDirectory'

/** 错误对象 → 展示文本（i18n key 或原始 message；与 host 域同口径） */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 记住正在查看的项目 id（模块级）
 *
 * 终端是整页沉浸态，打开时 AppRoot 会卸载页签容器（本页随之卸载）；从终端返回
 * 时本页重新挂载，若不留痕就会掉回项目列表。只记 id 不记对象：重挂载后项目
 * 数据要按最新状态重取，缓存旧对象会显示过期的活跃运行数。
 */
let rememberedProjectId: string | null = null

/** 清除终端返回时的项目记忆（断开连接 / 测试隔离用） */
export function clearRememberedProject(): void {
  rememberedProjectId = null
}

export function useProjects(context: PluginContext) {
  const api = getMobileApi()
  const logger = context.logger

  const projects = ref<ProjectView[]>([])
  const currentProject = ref<ProjectView | null>(null)
  const runs = ref<RunView[]>([])
  const agents = ref<AgentEntry[]>([])
  const now = ref(Date.now())

  const loadingProjects = ref(false)
  const loadingRuns = ref(false)
  const loadingAgents = ref(false)
  const loadedProjects = ref(false)
  const startingAgentId = ref<string | null>(null)

  /** 页面级错误槽（i18n key 或服务端原文；渲染一律 t(...)） */
  const loadError = ref('')
  const agentsError = ref('')

  const activeRunCount = computed(() => runs.value.filter((run) => run.active).length)
  const isStarting = computed(() => startingAgentId.value !== null)

  // ==================== 取数 ====================

  async function loadProjects(): Promise<void> {
    loadingProjects.value = true
    loadError.value = ''
    try {
      projects.value = await fetchProjects(context)
      loadedProjects.value = true
    } catch (error) {
      loadError.value = errText(error)
      logger.error(`[projects] load projects failed: ${loadError.value}`)
      throw error
    } finally {
      loadingProjects.value = false
    }
  }

  async function loadRuns(projectId: string): Promise<void> {
    loadingRuns.value = true
    loadError.value = ''
    try {
      const nextRuns = await fetchRuns(context, projectId)
      // 返回 / 切项目后旧请求才回来：只接受仍属于当前项目的运行列表
      if (currentProject.value?.id === projectId) runs.value = nextRuns
    } catch (error) {
      if (currentProject.value?.id === projectId) loadError.value = errText(error)
      logger.error(`[projects] load runs failed: ${errText(error)}`)
      throw error
    } finally {
      loadingRuns.value = false
    }
  }

  /**
   * 详情页刷新：运行列表 + 项目统计一次对齐
   *
   * 项目被桌面端移除时把当前项目置空并抛出「已不存在」——停留在幽灵项目详情
   * 比退回列表更糟（任何动作都会失败）。
   */
  async function refreshCurrent(): Promise<void> {
    const project = currentProject.value
    if (!project) {
      await loadProjects()
      return
    }
    loadingRuns.value = true
    loadError.value = ''
    try {
      const [nextRuns, nextProjects] = await Promise.all([
        fetchRuns(context, project.id),
        fetchProjects(context),
      ])
      projects.value = nextProjects
      // 用户已返回列表 / 切到别的项目：这次响应只用来刷新项目列表，不回填详情
      if (currentProject.value?.id !== project.id) return
      runs.value = nextRuns
      const found = nextProjects.find((item) => item.id === project.id) ?? null
      if (!found) {
        currentProject.value = null
        clearRememberedProject()
        throw new Error('project.error.notFound')
      }
      currentProject.value = found
    } catch (error) {
      // 项目已不存在（currentProject 已被置空）→ 退回列表并让页面 toast；
      // 不能在列表上留一条错误卡挡住其余项目。
      if (currentProject.value) loadError.value = errText(error)
      logger.error(`[projects] refresh project failed: ${errText(error)}`)
      throw error
    } finally {
      loadingRuns.value = false
    }
  }

  async function openProject(project: ProjectView): Promise<void> {
    currentProject.value = project
    rememberedProjectId = project.id
    runs.value = []
    await loadRuns(project.id)
  }

  function backToList(): void {
    currentProject.value = null
    clearRememberedProject()
    runs.value = []
    loadError.value = ''
    void loadProjects().catch(() => {
      // 错误已进 loadError / 日志；列表页会显性展示
    })
  }

  /**
   * 恢复上次查看的项目（终端返回时本页重挂载）
   *
   * 项目已被桌面端移除时安静退回列表：恢复失败不该挡住首屏。
   */
  async function restoreSelection(): Promise<void> {
    if (!rememberedProjectId) return
    const project = projects.value.find((item) => item.id === rememberedProjectId) ?? null
    if (!project) {
      clearRememberedProject()
      return
    }
    await openProject(project)
  }

  /** 断开连接 / 退出登录：清掉详情选择、列表与错误槽（不取数） */
  function resetSelection(): void {
    currentProject.value = null
    clearRememberedProject()
    runs.value = []
    projects.value = []
    loadedProjects.value = false
    loadError.value = ''
    agentsError.value = ''
  }

  async function loadAgents(): Promise<void> {
    loadingAgents.value = true
    agentsError.value = ''
    try {
      agents.value = await fetchAgents(context)
    } catch (error) {
      agentsError.value = errText(error)
      logger.error(`[projects] load agents failed: ${agentsError.value}`)
      throw error
    } finally {
      loadingAgents.value = false
    }
  }

  // ==================== 动作 ====================

  async function startRun(
    agentId: string,
    grid?: { cols: number; rows: number },
  ): Promise<{ runId: string; name: string }> {
    const project = currentProject.value
    if (!project) throw new Error('project.error.notFound')
    if (startingAgentId.value) throw new Error('project.run.starting')
    startingAgentId.value = agentId
    try {
      const created = await startRunCommand(context, project.id, agentId, grid)
      await refreshCurrent().catch((error) => {
        // 启动已成功：刷新失败不能把用户报成「启动失败」，留日志并返回 id
        logger.warn(`[projects] refresh after start failed: ${errText(error)}`)
      })
      // 会话目录的运行侧不会因 `session_created` 自动刷新（宿主 /api/sessions 不带
      // 项目运行），这里主动补一次：否则刚启动的运行在目录合并视图里瞬时真空，
      // 终端页 isSessionActive 会 false→true 抖动并触发第二次 subscribe（P1-4）。
      await refreshSessionDirectory({ force: true }).catch((error) => {
        logger.warn(`[projects] refresh session directory failed: ${errText(error)}`)
      })
      return created
    } finally {
      startingAgentId.value = null
    }
  }

  async function stopRun(run: RunView): Promise<void> {
    await stopRunCommand(context, run.id)
    await refreshCurrent()
  }

  // ==================== 生命周期 ====================

  /** 会话事件 → 合并刷新（运行是会话投影，事件仍由会话域发出） */
  function subscribe(isActive?: () => boolean): Disposable[] {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (): void => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        // 页签不可见时不后台取数：切回页签时 `active` watcher 会补一次
        if (isActive && !isActive()) return
        const task = currentProject.value ? refreshCurrent() : loadProjects()
        void task.catch((error) => {
          // 自动刷新失败不打断界面；错误槽由取数函数写入，日志已落
          logger.warn(`[projects] auto refresh failed: ${errText(error)}`)
        })
      }, 300)
    }
    const disposable = api.onSessionEvent((event) => {
      if (
        event.type === 'session_status' ||
        event.type === 'session_stopped' ||
        event.type === 'session_removed'
      ) {
        schedule()
      }
    })
    return [
      disposable,
      {
        dispose() {
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
        },
      },
    ]
  }

  let ticker: ReturnType<typeof setInterval> | null = null

  function startTicker(): void {
    if (ticker !== null) return
    ticker = setInterval(() => {
      now.value = Date.now()
    }, 30_000)
  }

  function stopTicker(): void {
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
  }

  return {
    // state
    projects,
    currentProject: currentProject as Ref<ProjectView | null>,
    runs,
    agents,
    now,
    loadingProjects,
    loadingRuns,
    loadingAgents,
    loadedProjects,
    startingAgentId,
    isStarting,
    activeRunCount,
    loadError,
    agentsError,
    // actions
    loadProjects,
    loadRuns,
    refreshCurrent,
    openProject,
    backToList,
    restoreSelection,
    resetSelection,
    loadAgents,
    startRun,
    stopRun,
    subscribe,
    startTicker,
    stopTicker,
  }
}
