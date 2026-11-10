/**
 * 项目域线形状与展示派生（ADR 0003：项目 → 运行 → 终端）
 *
 * 形状真源在桌面端：
 * - 项目 = `project::ops::view_json`（`ProjectView`，camelCase）
 * - 运行 = `session::view::run_json`（`RunView`，与桌面工作台同形）
 * - Agent = `projects_http::agent_views`（`{id, displayName, binary, readiness}`）
 *
 * 本文件只做「类型 + 纯函数」，不取数、不碰组件——native 单测可覆盖时间 / 状态 /
 * 环境徽标的分支，界面层不必为这些映射写模板 if/else。
 */

/** 项目视图（`GET /api/projects` 的 `data.projects[]`） */
export interface ProjectView {
  id: string
  /** 执行环境：linux / wsl2 / windows */
  environment: string
  wslDistro?: string | null
  workingDir: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string | null
  /** 派生：非终态运行数 */
  activeRuns: number
  /** 派生：全部运行数（含历史） */
  runCount: number
  /** 派生：最近活动时间（无运行 = null） */
  lastActivityAt: string | null
  /** 派生：最近活动的 agent（无 = null） */
  lastAgentId: string | null
}

/** 运行视图（`GET /api/runs?projectId=…` 的 `data.runs[]`） */
export interface RunView {
  id: string
  projectId: string | null
  configId: string
  agentId: string | null
  agentSessionId: string | null
  title: string | null
  name: string
  /** idle | starting | running | waitingInput | stopping | stopped | error */
  status: string
  model: string | null
  createdAt: string
  startedAt: string | null
  stoppedAt: string | null
  updatedAt: string
  /** 非终态（与项目卡片「活跃运行数」同一判据） */
  active: boolean
  truncated: boolean
  bridgeSeenAt: string | null
  bridgeConnected: boolean
}

/** 可启动 agent（注册表 + 探测就绪度） */
export interface AgentEntry {
  id: string
  displayName: string
  binary: string
  /** ready = 已装；missing = 确认未装；unknown = 探测无结论（允许尝试） */
  readiness: 'ready' | 'missing' | 'unknown'
}

/** 相对时间文案描述（key + 参数交界面 `t()` 渲染） */
export interface RelativeTimeSpec {
  key: string
  params: Record<string, number>
}

/**
 * 相对时间：四档（刚刚 / 分钟 / 小时 / 天）
 *
 * 缺失或不可解析返回 `null`（界面显示「暂无活动」而不是 `NaN 分钟前`）。
 */
export function relativeTimeSpec(
  iso: string | null | undefined,
  nowMs: number,
): RelativeTimeSpec | null {
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

/** 执行环境 → 徽标文字（三取值固定；未知环境按原样大写，不伪造） */
export function envLabel(environment: string | null | undefined): string {
  switch ((environment ?? '').toLowerCase()) {
    case 'wsl2':
      return 'WSL2'
    case 'linux':
      return 'Linux'
    case 'windows':
      return 'Windows'
    default:
      return (environment ?? '').toUpperCase() || '—'
  }
}

/** 环境徽标的语义色类（wsl2 紫 / linux 青 / windows 琥珀 / 其余锌） */
export function envChipClass(environment: string | null | undefined): string {
  switch ((environment ?? '').toLowerCase()) {
    case 'wsl2':
      return 'chip-violet'
    case 'linux':
      return 'chip-cyan'
    case 'windows':
      return 'chip-amber'
    default:
      return 'chip-zinc'
  }
}

/**
 * 运行状态线形状 → 展示字符串
 *
 * 桌面插件 `run_json` 自 2026-11-04 起直接出字符串标签（`wire_name`），不再出
 * externally-tagged `{error: …}`；这里仍兜住旧 wasm 载荷（普通态是 `"running"`，
 * 旧 `Error` 变体是 `{"error": "…"}`）。界面只认字符串，不归一会让错误运行
 * 被显示成「空闲」、甚至被 `isLiveRun` 判成存活。
 */
export function normalizeRunStatus(status: unknown): string {
  if (typeof status === 'string' && status) return status
  if (status && typeof status === 'object' && 'error' in status) return 'error'
  return 'idle'
}

/** 运行状态 → 文案键（与移动端既有会话状态同一文案族，缺项落在 project.*） */
export function runStatusLabelKey(status: string): string {
  switch (status) {
    case 'starting':
      return 'project.status.starting'
    case 'running':
      return 'hub.statusRunning'
    case 'waitingInput':
      return 'hub.statusWaiting'
    case 'stopping':
      return 'project.status.stopping'
    case 'stopped':
      return 'hub.statusStopped'
    case 'error':
      return 'project.status.error'
    default:
      return 'project.status.idle'
  }
}

/** 运行状态 → 状态徽章样式（badge-*） */
export function runStatusBadgeClass(status: string): string {
  switch (status) {
    case 'running':
      return 'badge-emerald'
    case 'waitingInput':
    case 'stopping':
      return 'badge-amber'
    case 'starting':
      return 'badge-cyan'
    case 'error':
      return 'badge-red'
    default:
      return 'badge-zinc'
  }
}

/** 运行状态 → 图标 chip 样式（chip-*） */
export function runStatusChipClass(status: string): string {
  switch (status) {
    case 'running':
      return 'chip-emerald'
    case 'waitingInput':
    case 'stopping':
      return 'chip-amber'
    case 'starting':
      return 'chip-cyan'
    case 'error':
      return 'chip-red'
    default:
      return 'chip-zinc'
  }
}

/** 该运行现在能否打开终端（终态运行的 PTY 已回收，订阅必空） */
export function canOpenTerminal(run: Pick<RunView, 'active'>): boolean {
  return run.active
}

/**
 * 移动端运行列表只保留活着的运行
 *
 * 已停止 / 出错的运行是历史记录（PTY 已回收，点开也只有空终端），项目详情不展示。
 * 判据与项目卡「活跃运行数」同源：后端 `active` = 非终态，前端不再解析状态枚举。
 */
export function liveRuns(runs: RunView[]): RunView[] {
  return runs.filter((run) => run.active)
}

/** agent 是否可尝试启动（只有确认未安装才禁用） */
export function agentStartable(agent: Pick<AgentEntry, 'readiness'>): boolean {
  return agent.readiness !== 'missing'
}
