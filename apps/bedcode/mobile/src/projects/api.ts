/**
 * 项目域取数面（只经插件命令，不直连网络）
 *
 * 桌面端把项目 / 运行 / Agent 的移动消费面放在 `/api/projects`、`/api/runs`、
 * `/api/runs/start`、`/api/agents`；移动插件命令面（`bedcode.list-projects` 等）
 * 负责带 JWT 请求并把信封 `{code, message, data}` 原样交回。本文件只做
 * 「命令 → 领域形状」的归一，失败语义仍由 `ensureCommandOk` 统一（code!==0
 * 抛 `message || fallbackKey`，界面 `t()` 原样展示）。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { ensureCommandOk, type CommandResult } from '../host/errors'
import { normalizeRunStatus, type AgentEntry, type ProjectView, type RunView } from './types'

/** 项目列表；失败抛服务端 message 或 `project.loadFailed` */
export async function fetchProjects(context: PluginContext): Promise<ProjectView[]> {
  const res = ensureCommandOk(
    (await context.commands.execute('bedcode.list-projects')) as CommandResult<{
      projects?: ProjectView[]
    }>,
    'project.loadFailed',
  )
  return Array.isArray(res?.data?.projects) ? res!.data!.projects! : []
}

/** 运行列表；`projectId` 缺省 = 全部运行（排障用），项目详情页始终带 id */
export async function fetchRuns(context: PluginContext, projectId?: string): Promise<RunView[]> {
  const res = ensureCommandOk(
    (await context.commands.execute(
      'bedcode.list-runs',
      projectId ? { projectId } : {},
    )) as CommandResult<{ runs?: RunView[] }>,
    'project.runsLoadFailed',
  )
  const runs = Array.isArray(res?.data?.runs) ? res!.data!.runs! : []
  // 状态线形状归一（Error 是 `{error}` 对象，见 types.normalizeRunStatus）
  return runs.map((run) => ({ ...run, status: normalizeRunStatus(run.status) }))
}

/** 可启动 agent（注册表 + 探测就绪度）；失败抛 `project.agentsLoadFailed` */
export async function fetchAgents(context: PluginContext): Promise<AgentEntry[]> {
  const res = ensureCommandOk(
    (await context.commands.execute('bedcode.list-agents')) as CommandResult<{
      agents?: AgentEntry[]
    }>,
    'project.agentsLoadFailed',
  )
  return Array.isArray(res?.data?.agents) ? res!.data!.agents! : []
}

/** 启动运行（项目 × agent）→ 新运行 id / 名称 */
export async function startRun(
  context: PluginContext,
  projectId: string,
  agentId: string,
): Promise<{ runId: string; name: string }> {
  const res = ensureCommandOk(
    (await context.commands.execute('bedcode.start-run', { projectId, agentId })) as CommandResult<{
      runId?: string
      name?: string
    }>,
    'project.run.startFailed',
  )
  const runId = res?.data?.runId
  if (!runId) throw new Error('project.run.startFailed')
  return { runId, name: res?.data?.name || runId }
}

/**
 * 停止运行（`bedcode.stop-session`）
 *
 * 运行是会话的容器化投影（`sessionId` 即 `runId`），停止仍走冻结的兼容命令面；
 * 终态由桌面端 PTY 退出事件收尾，本端随后重取运行列表。
 */
export async function stopRun(context: PluginContext, runId: string): Promise<void> {
  ensureCommandOk(
    (await context.commands.execute('bedcode.stop-session', { sessionId: runId })) as CommandResult,
    'project.run.stopFailed',
  )
}
