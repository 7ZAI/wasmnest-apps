/**
 * 项目与运行数据层（ADR 0003 / issue #23 M2）
 *
 * 取数红线与本仓其余域一致：**只经 `context.commands.execute`**——
 * - 项目：`project.list` / `project.get` / `project.create` / `project.open` /
 *   `project.rename` / `project.remove` / `project.pick-dir`
 * - 运行：`run.list` / `run.start`；停止与输入仍走 `session.*`（运行是会话的
 *   容器化投影，`sessionId` 即 `runId`）
 * - agent 清单：`agent.list-agents`（能力与二进制名的后端唯一真源）+
 *   `agent.get-state`（安装探测，用于标注「未安装」）
 *
 * 目录选择**只走宿主对话框命令**（`project.pick-dir` → 宿主 `fs:pick` 权限门与
 * 选中路径授权校验），前端不直连 fs / dialog 插件：那是资源访问红线
 * （docs/FRONTEND.md §4）。
 *
 * 本模块只做「取数 + 编排」，不含文案与弹窗：错误上抛由视图层转成用户可见提示。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

/** 项目视图（`project.*` 命令的 ProjectView，与后端 `project::ops::view_json` 同形） */
export interface ProjectView {
  id: string
  /** 执行环境：linux / wsl2 / windows */
  environment: string
  wslDistro: string | null
  workingDir: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  /** 派生：非终态运行数 */
  activeRuns: number
  /** 派生：全部运行数（含历史） */
  runCount: number
  /** 派生：最近活动时间（无运行 = null） */
  lastActivityAt: string | null
  /** 派生：最近活动的 agent（无 = null） */
  lastAgentId: string | null
}

/** 运行视图（`run.list` 的 RunView，与 `session::view::run_json` 同形） */
export interface RunView {
  id: string
  projectId: string | null
  configId: string
  agentId: string | null
  agentSessionId: string | null
  /** M3 起由首条消息 / agent 自报标题填充；M2 恒为 null */
  title: string | null
  name: string
  /** 'idle' | 'starting' | 'running' | 'waitingInput' | 'stopping' | 'stopped' | 'error' */
  status: string
  model: string | null
  createdAt: string
  startedAt: string | null
  stoppedAt: string | null
  updatedAt: string
  /** 非终态（与项目卡片「活跃运行数」同一判据） */
  active: boolean
  /** 事件账本被截断（M3 才有写入方；M2 恒 false） */
  truncated: boolean
}

/** 可启动的 agent（后端注册表 + 探测状态） */
export interface AgentEntry {
  id: string
  displayName: string
  /** 启动命令（会话配置的 command 字段值；后端注册表给出） */
  binary: string
  /**
   * 就绪度：`ready` = 探测确认已装；`missing` = 确认未装（界面给「去安装」）；
   * `unknown` = 探测未完成或无结论（允许尝试启动，不谎称未安装）
   */
  readiness: 'ready' | 'missing' | 'unknown'
}

/** 建项目草稿（`project.create` 入参） */
export interface ProjectDraft {
  environment: string
  workingDir: string
  name?: string
  wslDistro?: string
}

/** 建项目结果：`created=false` = 该目录已有项目（被带到已有项目） */
export interface CreateProjectResult {
  project: ProjectView
  created: boolean
}

/** 运行是否可看终端（非终态才有字节可看；终态的 PTY 已回收） */
export function isLiveRun(status: string): boolean {
  return status !== 'stopped' && status !== 'error'
}

/**
 * 相对时间文案（纯函数：key + 参数交视图层 `t()` 渲染）
 *
 * 只给出「多久之前」的四档（刚刚 / 分钟 / 小时 / 天）；时间戳缺失或不可解析
 * 返回 `null`（调用方显示「暂无活动」，不显示 `NaN 分钟前`）。
 */
export function relativeTimeSpec(
  iso: string | null | undefined,
  nowMs: number,
): { key: string; params: Record<string, number> } | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return null
  const diffSec = Math.max(0, Math.floor((nowMs - at) / 1000))
  if (diffSec < 60) return { key: 'project.time.justNow', params: {} }
  if (diffSec < 3600)
    return { key: 'project.time.minutesAgo', params: { n: Math.floor(diffSec / 60) } }
  if (diffSec < 86_400) {
    return { key: 'project.time.hoursAgo', params: { n: Math.floor(diffSec / 3600) } }
  }
  return { key: 'project.time.daysAgo', params: { n: Math.floor(diffSec / 86_400) } }
}

/**
 * 运行 → 终端组件所需的最小会话形状
 *
 * `TerminalPreview` 只认 `SessionInfo`（id / name / status / 时间戳），运行视图
 * 恰好同源（同一张表、同一套状态机），故直接投影，不新建一套终端接入路径
 * ——「终端页签渲染的是同一条 PTY 的真实字节」这条 spec 要求的落法就是复用。
 */
export function runAsSession(run: RunView): {
  id: string
  name: string
  config_id: string
  configId: string
  status: string
  created_at: string
  createdAt: string
  startedAt?: string
  stoppedAt?: string
} {
  return {
    id: run.id,
    name: run.name,
    config_id: run.configId,
    configId: run.configId,
    status: run.status,
    created_at: run.createdAt,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? undefined,
    stoppedAt: run.stoppedAt ?? undefined,
  }
}

/** 环境徽标（与会话页同口径：wsl2 / linux / 其余按 win 展示） */
export function envBadge(environment: string | null | undefined): string {
  const value = (environment ?? '').toLowerCase()
  if (value === 'wsl2') return 'wsl2'
  if (value === 'linux') return 'linux'
  return 'win'
}

/** 探测状态 → 就绪度（`ok` = 已装；`not-installed` = 确认未装；其余无结论） */
function readinessOf(status: string | null | undefined): AgentEntry['readiness'] {
  if (status === 'ok') return 'ready'
  if (status === 'not-installed') return 'missing'
  return 'unknown'
}

export function useProjects(context: PluginContext) {
  const projects = ref<ProjectView[]>([])
  const project = ref<ProjectView | null>(null)
  const runs = ref<RunView[]>([])
  const agents = ref<AgentEntry[]>([])
  const isLoading = ref(true)
  /** 每秒推进，供相对时间渲染 */
  const now = ref(Date.now())

  const activeRunCount = computed(() => runs.value.filter((run) => run.active).length)

  // ==================== 取数 ====================

  /** 项目列表（后端已按最近活动倒序） */
  async function loadProjects(): Promise<void> {
    const raw = (await context.commands.execute('project.list', {})) as {
      projects?: ProjectView[]
    } | null
    projects.value = Array.isArray(raw?.projects) ? raw!.projects! : []
  }

  /**
   * 单项目。未知 id → `null`（视图层按「项目不存在」提示）
   *
   * `project.get` 对未知 id 返回 JSON null 而不是报错：被删掉的项目不该让
   * 工作台整页炸掉，它该显示一条可读的「已不存在」。
   */
  async function loadProject(id: string): Promise<ProjectView | null> {
    const raw = (await context.commands.execute('project.get', { id })) as ProjectView | null
    project.value = raw ?? null
    return project.value
  }

  /** 运行列表（最新在前由后端保证） */
  async function loadRuns(projectId: string): Promise<void> {
    const raw = (await context.commands.execute('run.list', { projectId })) as {
      runs?: RunView[]
    } | null
    runs.value = Array.isArray(raw?.runs) ? raw!.runs! : []
  }

  /**
   * 可启动 agent 清单：注册表（id / 展示名 / 二进制）+ 安装探测（就绪度）
   *
   * 探测失败**不阻断**：清单来自注册表，探测只用来标注「未安装」。取不到探测
   * 时全部按 `unknown`（允许尝试启动），而不是把整张清单打成空。
   */
  async function loadAgents(): Promise<void> {
    const listed = (await context.commands.execute('agent.list-agents', {})) as {
      agents?: { id?: string; displayName?: string; binary?: string }[]
    } | null
    const detection = await context.commands
      .execute('agent.get-state', {})
      .then((raw) => raw as { state?: { clis?: Record<string, { status?: string }> } } | null)
      .catch(() => null)
    const clis = detection?.state?.clis ?? {}
    agents.value = (listed?.agents ?? [])
      .filter(
        (agent): agent is { id: string; displayName?: string; binary?: string } =>
          typeof agent?.id === 'string' && agent.id.length > 0,
      )
      .map((agent) => ({
        id: agent.id,
        displayName: agent.displayName || agent.id,
        binary: agent.binary || agent.id,
        readiness: readinessOf(clis[agent.id]?.status),
      }))
  }

  /** 工作台全量（项目 + 运行 + agent）：任一步失败上抛，由视图层提示 */
  async function loadWorkbench(projectId: string): Promise<void> {
    await Promise.all([loadProject(projectId), loadRuns(projectId), loadAgents()])
  }

  // ==================== 项目编排 ====================

  /** 建项目（同目录同环境已存在 → `created:false` 并返回既有项目） */
  async function createProject(draft: ProjectDraft): Promise<CreateProjectResult> {
    const raw = (await context.commands.execute('project.create', {
      environment: draft.environment,
      workingDir: draft.workingDir,
      name: draft.name || undefined,
      wslDistro: draft.wslDistro || undefined,
    })) as CreateProjectResult | null
    if (!raw?.project) throw new Error('project.create returned no project')
    await loadProjects()
    return raw
  }

  /** 打开项目（刷新最近打开时间，列表顺序随之变化） */
  async function openProject(id: string): Promise<ProjectView> {
    const raw = (await context.commands.execute('project.open', { id })) as ProjectView | null
    if (!raw?.id) throw new Error('project.open returned no project')
    project.value = raw
    return raw
  }

  /** 改名（只改展示名，与目录解耦） */
  async function renameProject(id: string, name: string): Promise<ProjectView> {
    const raw = (await context.commands.execute('project.rename', {
      id,
      name,
    })) as ProjectView | null
    if (!raw?.id) throw new Error('project.rename returned no project')
    if (project.value?.id === id) project.value = raw
    await loadProjects()
    return raw
  }

  /** 移除项目（不动磁盘文件；有活跃运行时后端显性拒绝） */
  async function removeProject(id: string): Promise<{ removed: boolean; runsRemoved: number }> {
    const raw = (await context.commands.execute('project.remove', { id })) as {
      removed?: boolean
      runsRemoved?: number
    } | null
    await loadProjects()
    return { removed: raw?.removed === true, runsRemoved: raw?.runsRemoved ?? 0 }
  }

  /** 宿主目录选择框：返回选中路径；取消 → `null`（取消不是错误） */
  async function pickDirectory(): Promise<string | null> {
    const raw = (await context.commands.execute('project.pick-dir', {})) as {
      picked?: boolean
      path?: string
    } | null
    if (raw?.picked !== true) return null
    const path = (raw.path ?? '').trim()
    return path.length > 0 ? path : null
  }

  // ==================== 运行编排 ====================

  /**
   * 从项目启动一条运行：后端按（项目, agent）取/建启动参数并走唯一启动链
   *
   * 先预测终端网格再启动（PTY 以正确行列 openpty，避免开终端后重排）——与
   * 会话页的启动口径一致。
   */
  async function startRun(
    projectId: string,
    agentId: string,
  ): Promise<{ runId: string; name: string }> {
    const size = await context.session.predictTerminalSize()
    const raw = (await context.commands.execute('run.start', {
      projectId,
      agentId,
      cols: size?.cols,
      rows: size?.rows,
    })) as { runId?: string; name?: string } | null
    if (!raw?.runId) throw new Error('run.start returned no runId')
    await Promise.all([loadRuns(projectId), loadProject(projectId)])
    return { runId: raw.runId, name: raw.name ?? '' }
  }

  /** 停止运行（`session.close`：登记 Stopping + kill PTY，终态由退出事件收尾） */
  async function stopRun(runId: string, projectId: string): Promise<void> {
    await context.commands.execute('session.close', { sessionId: runId })
    await context.session.closeTerminal(runId)
    await Promise.all([loadRuns(projectId), loadProject(projectId)])
  }

  /** 把运行拉到独立终端窗口（窗口本体归宿主，本域只发起） */
  async function openRunWindow(run: RunView): Promise<void> {
    await context.session.openTerminal({ id: run.id, name: run.name })
  }

  // ==================== 相对时间计时 ====================

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
    projects: projects as Ref<ProjectView[]>,
    project: project as Ref<ProjectView | null>,
    runs: runs as Ref<RunView[]>,
    agents: agents as Ref<AgentEntry[]>,
    activeRunCount: activeRunCount as ComputedRef<number>,
    isLoading,
    now,
    loadProjects,
    loadProject,
    loadRuns,
    loadAgents,
    loadWorkbench,
    createProject,
    openProject,
    renameProject,
    removeProject,
    pickDirectory,
    startRun,
    stopRun,
    openRunWindow,
    startTicker,
    stopTicker,
  }
}

export type ProjectsDomain = ReturnType<typeof useProjects>
