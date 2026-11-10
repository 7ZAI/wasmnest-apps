<script setup lang="ts">
/**
 * 任务历史视图 — 四 Tab 侧边栏视图
 *
 * Tab1 当前任务：创建新任务（选择运行中会话）+ 执行中的任务列表
 *              + 执行任务（各会话待执行队列）
 * Tab2 任务日志：筛选条（状态/agent/来源/时间范围）+ 分页任务列表 + 行内详情展开
 * Tab3 定时任务：新建表单（会话配置/触发时间/prompts 列表）+ 任务列表 + 删除
 * Tab4 统计：筛选条件下任务统计（状态分布 / 完成数 / 终态数 / 成功率 / 平均耗时）
 *
 * 通过 inject('pluginContext') 获取 PluginContext，
 * 调用 Rust 后端命令查询数据，监听事件实时更新
 */
import { ref, onMounted, onUnmounted, inject, computed, watch, nextTick } from 'vue'
// 开源 Vue3 日期/时间选择组件（替代原生 datetime-local，样式随宿主主题定制）
import Datepicker from '@vuepic/vue-datepicker'
// 宿主共享下拉组件（替代原生 <select>，经 SDK 引用，样式随宿主主题 token）
import Select from '@binblink/wasmnest-plugin-sdk-desktop/ui'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import router from '@/router'
// 任务日志表格 / 详情复用 Agent 管理日志的视觉真源（同一份 `ah-*` 样式）。
// 插件 CSS 由 vite 内联进单文件包、模块求值即注入 <style>；本视图单独 import
// 一份，保证「从侧边栏直接进 Agent 任务、没先开过 Agent 管理」时样式也在。
import '../agents/hub-styles.css'
import AgentIcon from '../agents/components/AgentIcon.vue'
import SessionTranscript from '../agents/components/SessionTranscript.vue'
import ResumeSessionDialog from '../agents/components/ResumeSessionDialog.vue'
import { useResumeSession } from '../agents/composables/useResumeSession'
import { abbreviateProject, formatTokens } from '../agents/utils/format'
import type { NormalizedEventView, UsageSessionRow } from '../agents/types'

const context = inject<PluginContext>('pluginContext')!
// i18n：与 TaskQueueModal 一致，经 context.i18n 自动加插件 ID 前缀
const t = (key: string, params?: Record<string, any>) => context.i18n.t(key, params)

// ==================== Types ====================

interface TaskRecord {
  id: string
  description: string | null
  status: string
  agent: string | null
  source: string | null
  session_id: string
  claude_sid: string | null
  working_dir: string | null
  auto_approve: number
  exit_reason: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  input_tokens: number | null
  output_tokens: number | null
}

/**
 * 任务日志详情载荷（`session.task.log-session` 返回）
 *
 * `reason` 是**机器可读的「看不到内容」分类**（guest `task/log.rs`）：
 * null = 读到转写；其余三档界面各给对应文案与出路，不用空对话冒充「无内容」。
 * `cliSessionId` / `adapter` 即使未索引也会返回——「恢复会话」不依赖日志索引。
 */
interface TaskLogDetail {
  task: TaskRecord
  adapter: string
  cliSessionId: string
  resolvedBy: 'run' | 'claude_sid' | 'none'
  reason: 'no-cli-session' | 'not-indexed' | 'unreadable' | null
  log: {
    events: NormalizedEventView[]
    eventsTruncated: boolean
    raw: string[]
    rawTruncated: boolean
    skippedLines: number
  } | null
}

interface QueueItem {
  id: string
  prompt: string
  position: number
  status: string
  created_at: string
}

interface ScheduledJob {
  id: string
  name: string | null
  project_id: string | null
  agent_id: string | null
  config_id: string | null
  trigger_at: string
  prompts: string[]
  status: string
  session_id: string | null
  created_at: string
  executed_at: string | null
  error: string | null
}

interface HistoryStats {
  total: number
  by_status: Record<string, number>
  completed: number
  terminal: number
  success_rate: number
  avg_duration_seconds: number
}

/** 运行中的会话（后端 list-running-sessions 返回，queue 为前端按需加载） */
interface RunningSession {
  session_id: string
  name: string
  config_id: string
  project_id?: string
  project_name?: string
  working_dir: string
  status: string
  task_status: string
  description: string
  started_at: string | null
  agent: string
  queue_count: number
  queue: QueueItem[]
  auto_execute: boolean
  auto_answer: boolean
  /** 任务域适配标记（后端 running-sessions 载荷；工具栏入口判据同源） */
  is_supported?: boolean
}

/** 任务队列（后端 config-queues-list 返回：按配置分组的未绑定会话批次） */
interface ConfigQueue {
  id: string
  config_id: string
  name: string
  workingDir: string
  auto_mode: boolean
  tasks: QueueItem[]
  created_at: string
}

/** 预设任务（一次性消耗；可携带项目 + agent 目标） */
interface PresetItem {
  id: string
  project_id: string | null
  agent_id: string | null
  prompt: string
  created_at: string
}

/** 任务目标（项目 × 受支持 agent；后端 `session.task.targets` 的唯一选择源） */
interface TaskTarget {
  project_id: string
  project_name: string | null
  environment: string | null
  working_dir: string | null
  agent_id: string
  agent_name: string | null
  supported: boolean
  config_id: string | null
  active_session_id: string | null
  active_status: string | null
  pending_count: number
  pending_session_id: string
  pending_tasks: QueueItem[]
}

// ==================== State ====================

type TabKey = 'current' | 'records' | 'scheduled' | 'stats'
const activeTab = ref<TabKey>('current')

// Tab1 当前任务
const runningSessions = ref<RunningSession[]>([])
const currentLoading = ref(false)
// 任务目标（项目 × agent）：取代「选择执行会话」；无目标 = 保存为预设
const targets = ref<TaskTarget[]>([])
const createProjectId = ref('')
const createAgentId = ref('')
// 目标已有活跃运行时仍可强制保存为预设（预设可重复投递到同一目标）
const createAsPreset = ref(false)
// 初始默认选择是否已定：仅首次加载时自动选中优先目标，之后一律保留用户选择
let defaultTargetSelected = false
const createPrompt = ref('')
// 创建任务输入框元素引用：提交清空后重置高度为单行
const createPromptEl = ref<HTMLTextAreaElement | null>(null)
const creatingTask = ref(false)
const createError = ref('')
// Tab1 预设任务（无会话/未选会话时创建，加入队列后自动移除）
const presets = ref<PresetItem[]>([])
const presetError = ref('')
// Tab1 任务队列（按配置分组的未绑定会话批次）
const configQueues = ref<ConfigQueue[]>([])
const configQueueError = ref('')
// 预设入队目标（预设未绑定项目/agent 时的回退选择）
const presetProjectId = ref('')
const presetAgentId = ref('')
// 启动中的队列 id（按钮 loading + 防重复点击）
const startingQueueId = ref('')
// 任务行内编辑（任务队列 / 执行任务区共用；scope = 队列 id 或会话 id，占位键同语义）
const editingTaskScope = ref('')
const editingTaskId = ref('')
const editingTaskText = ref('')

// Tab2 任务记录
const tasks = ref<TaskRecord[]>([])
const total = ref(0)
const limit = 10
const offset = ref(0)
const loading = ref(false)
const stats = ref<HistoryStats | null>(null)

// 任务日志详情（二级页）：点行进入，读该任务的 CLI 会话转写。
// 与「行内展开」不同，详情是独立一页（头卡 + 任务记录 / 原始 JSONL 页签）——
// 与 Agent 管理的会话日志详情同构（见 agents/components/SessionLogsTab.vue）。
const openedTask = ref<TaskRecord | null>(null)
const logDetail = ref<TaskLogDetail | null>(null)
const logLoading = ref(false)
/** 命令本身失败（与「有分类原因的读不到」区分：那种走 logDetail.reason） */
const logError = ref('')
const logTab = ref<'chat' | 'raw'>('chat')
/** 「未索引」时的一键扫描在途（进度文案 + 防重入） */
const usageScanning = ref(false)

const filterStatus = ref('')
const filterAgent = ref('')
const filterSource = ref('')
const filterSince = ref<Date | null>(null)
const filterUntil = ref<Date | null>(null)

// Tab3 定时任务
const jobs = ref<ScheduledJob[]>([])
const jobsLoading = ref(false)
// 历史区段默认折叠：执行档案不占主视图，展开后仍可查看/清理
const finishedCollapsed = ref(true)
// 渲染项：分组头（进行中 / 历史）+ 卡片，单循环内插区段头
interface RenderedJobItem {
  header: boolean
  group: 'active' | 'finished'
  job?: ScheduledJob
}
const showForm = ref(false)
const creatingJob = ref(false)
const formName = ref('')
const formProjectId = ref('')
const formAgentId = ref('')
const formTriggerAt = ref<Date | null>(null)
// 任务内容：任务卡片列表（一条任务一个卡片，支持逐条添加/删除，与队列弹窗一致）
const formPrompts = ref<string[]>([])
const newPrompt = ref('')
// 添加任务输入框元素引用：添加卡片后重置高度为单行
const newPromptEl = ref<HTMLTextAreaElement | null>(null)
const errorMessage = ref('')
// missed / failed 任务重新设置（重置回 pending，可选改触发时间）
const resettingId = ref<string | null>(null)
const resetTriggerAt = ref<Date | null>(null)

// 输入/下拉框统一样式（与宿主 TerminalWindowView 的控件保持一致）
const controlCls =
  'w-full h-8 px-2 rounded-[6px] border border-[var(--border-input)] bg-[var(--bg-input)] ' +
  'text-xs text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)] transition-colors duration-200'

// ==================== 自动增高 textarea（任务内容输入统一使用） ====================

// 不含固定高度（controlCls 的 h-8）：高度由内容决定，最多 10 行（200px = 10 × 20px 行高）后内部滚动
const textareaCls =
  'w-full px-2 py-1.5 rounded-[6px] border border-[var(--border-input)] bg-[var(--bg-input)] ' +
  'text-xs text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)] transition-colors duration-200 ' +
  'resize-none overflow-y-auto leading-5 max-h-[200px]'

// 10 行上限（与 textareaCls 的 max-h-[200px] 保持一致）
const TEXTAREA_MAX_HEIGHT = 200

// 高度自适应：先置 auto 再取 scrollHeight，钳制到上限后由 overflow-y 滚动
function autosizeTextarea(el: unknown) {
  const t = el as HTMLTextAreaElement | null
  if (!t) return
  t.style.height = 'auto'
  t.style.height = `${Math.min(t.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
}

// 任务输入键位统一：Enter 提交（IME 组词中的回车不触发），Shift+Enter 换行
function submitOnEnter(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      handler()
    }
  }
}

// ==================== 日期选择器（@vuepic/vue-datepicker） ====================

// 深色模式跟随宿主（documentElement.dark class，见宿主 useTheme composable），
// MutationObserver 监听宿主主题切换，Datepicker 的 dark prop 随之联动
const isDark = ref(document.documentElement.classList.contains('dark'))
let themeObserver: MutationObserver | null = null

// 输入/回填格式（date-fns token），与筛选条/定时任务的显示习惯一致
const dateFormat = 'yyyy-MM-dd HH:mm'

// 跟随宿主语言（zh-CN / en），供 Datepicker 渲染对应语言的日历与星期/月份文案
const dateLocale = computed(() => context.i18n.getI18n()?.global?.locale?.value ?? 'zh-CN')

// Datepicker 底部操作按钮文本：v9 默认英文（Select/Cancel/Now），不跟随 locale，需按当前语言传入
const dpSelectText = computed(() => t('task.confirm'))
const dpCancelText = computed(() => t('task.cancel'))
const dpNowLabel = computed(() => t('task.datepickerNow'))

// 筛选变化防抖：Datepicker 的 update:model-value 在手动输入时逐字符触发，
// 聚合成一次重载避免高频请求（原生 datetime-local 的 change 语义在提交时触发一次）
let filterDebounce: ReturnType<typeof setTimeout> | null = null

// Date 对象 → UTC "YYYY-MM-DD HH:MM:SS"（与后端 SQLite datetime 同格式）
function dateToUtc(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

function onFilterChangedDebounced() {
  if (filterDebounce) clearTimeout(filterDebounce)
  filterDebounce = setTimeout(onFilterChanged, 300)
}

// ==================== 状态展示 ====================

const statusLabel: Record<string, string> = {
  idle: t('task.idle'),
  in_progress: t('task.inProgress'),
  asking: t('task.asking'),
  retrying: t('task.retrying'),
  completed: t('task.completed'),
  interrupted: t('task.interrupted'),
  pending: t('task.pending'),
}

const statusColor: Record<string, string> = {
  idle: 'text-[var(--text-tertiary)]',
  in_progress: 'text-[var(--color-info-ink)]',
  asking: 'text-[var(--color-warning-ink)]',
  retrying: 'text-[var(--color-warning-ink)]',
  completed: 'text-[var(--color-success-ink)]',
  interrupted: 'text-[var(--color-danger-ink)]',
  pending: 'text-[var(--text-tertiary)]',
}

const statusDot: Record<string, string> = {
  idle: 'bg-[var(--text-tertiary)]',
  in_progress: 'bg-[var(--color-info)]',
  asking: 'bg-[var(--color-warning)]',
  retrying: 'bg-[var(--color-warning)] animate-pulse',
  completed: 'bg-[var(--color-success)]',
  interrupted: 'bg-[var(--color-danger)]',
  pending: 'bg-[var(--text-tertiary)]',
}

const scheduledStatusLabel: Record<string, string> = {
  pending: t('task.pending'),
  creating: t('task.scheduledStatusCreating'),
  executed: t('task.scheduledStatusExecuted'),
  failed: t('task.scheduledStatusFailed'),
  missed: t('task.scheduledStatusMissed'),
}

function scheduledStatusBadge(status: string): string {
  const base =
    'inline-flex items-center h-5 px-2 rounded-full text-[calc(11px*var(--ui-scale))] font-medium'
  const colors: Record<string, string> = {
    pending: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
    creating: 'bg-[var(--color-info-light)] text-[var(--color-info-ink)]',
    executed: 'bg-[var(--color-success-light)] text-[var(--color-success-ink)]',
    failed: 'bg-[var(--color-danger-light)] text-[var(--color-danger-ink)]',
    missed: 'bg-[var(--color-warning-light)] text-[var(--color-warning-ink)]',
  }
  return `${base} ${colors[status] || colors.pending}`
}

// 进行中：等待触发 / 正在创建会话；历史：已执行 / 错过 / 失败（终态）
const activeJobs = computed(() =>
  jobs.value.filter((j) => ['pending', 'creating'].includes(j.status)),
)
const finishedJobs = computed(() =>
  jobs.value.filter((j) => ['executed', 'missed', 'failed'].includes(j.status)),
)
const executedCount = computed(
  () => finishedJobs.value.filter((j) => j.status === 'executed').length,
)

// 分组渲染：进行中在前，历史在后（折叠时不渲染卡片，仅保留区段头）
const renderedJobItems = computed<RenderedJobItem[]>(() => {
  const items: RenderedJobItem[] = []
  if (activeJobs.value.length > 0) {
    items.push({ header: true, group: 'active' })
    items.push(...activeJobs.value.map((job) => ({ header: false, group: 'active' as const, job })))
  }
  if (finishedJobs.value.length > 0) {
    items.push({ header: true, group: 'finished' })
    if (!finishedCollapsed.value) {
      items.push(
        ...finishedJobs.value.map((job) => ({ header: false, group: 'finished' as const, job })),
      )
    }
  }
  return items
})

const tabs: { key: TabKey; label: string }[] = [
  { key: 'current', label: t('task.tabsCurrent') },
  { key: 'records', label: t('task.tabsRecords') },
  { key: 'scheduled', label: t('task.tabsScheduled') },
  { key: 'stats', label: t('task.tabsStats') },
]

// ==================== 当前任务（Tab1） ====================

// 执行中的任务（in_progress / asking / retrying）
const activeTasks = computed(() =>
  runningSessions.value.filter((s) =>
    ['in_progress', 'asking', 'retrying'].includes(s.task_status),
  ),
)
// 有待执行队列的会话（执行任务区段）
const executingSessions = computed(() => runningSessions.value.filter((s) => s.queue.length > 0))

// 运行标签：项目名 · agent（会话名只在无项目归属时兜底）
function sessionLabel(s: RunningSession): string {
  const project = s.project_name || baseName(s.working_dir)
  const base = project || s.name || (s.session_id ? s.session_id.slice(0, 8) : '')
  return s.agent && s.agent !== 'unknown' ? `${base} · ${s.agent}` : base
}

// 任务目标：项目 × agent（取代「选择执行会话」）
function targetLabel(target: TaskTarget): string {
  const project = target.project_name || baseName(target.working_dir || '') || target.project_id
  const agent = target.agent_name || target.agent_id
  return `${project} · ${agent}`
}

const projectOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const target of targets.value) {
    const project = target.project_name || baseName(target.working_dir || '') || target.project_id
    seen.set(target.project_id, project)
  }
  return [
    { value: '', label: t('task.projectPlaceholder') },
    ...[...seen.entries()].map(([value, label]) => ({ value, label })),
  ]
})

function agentOptionsFor(projectId: string) {
  const list = targets.value.filter((target) => target.project_id === projectId)
  return [
    { value: '', label: t('task.agentPlaceholder') },
    ...list.map((target) => ({
      value: target.agent_id,
      label: target.agent_name || target.agent_id,
    })),
  ]
}

const createAgentOptions = computed(() => agentOptionsFor(createProjectId.value))
const presetAgentOptions = computed(() => agentOptionsFor(presetProjectId.value))
const formAgentOptions = computed(() => agentOptionsFor(formProjectId.value))

/** 当前选中的目标（项目 + agent 都选中才命中） */
function findTarget(projectId: string, agentId: string): TaskTarget | undefined {
  if (!projectId || !agentId) return undefined
  return targets.value.find(
    (target) => target.project_id === projectId && target.agent_id === agentId,
  )
}

const createTarget = computed(() => findTarget(createProjectId.value, createAgentId.value))
/** 目标无活跃运行时挂起的任务（界面显性提示「等待运行」） */
const pendingTargets = computed(() =>
  targets.value.filter((target) => (target.pending_count ?? 0) > 0),
)
const pendingError = ref('')

/** 删除「等待运行」里的任务（占位键作为队列作用域，与真实会话同一套命令） */
async function removePendingTask(target: TaskTarget, item: QueueItem) {
  pendingError.value = ''
  try {
    await context.commands.execute('session.task.queue-remove', {
      session_id: target.pending_session_id,
      task_id: item.id,
    })
    await Promise.all([loadTargets(), loadRunningSessions()])
  } catch (e) {
    console.error('[Session Center/task] Failed to remove pending task:', e)
    pendingError.value = t('task.removeFailed')
  }
}
const presetTarget = computed(() => findTarget(presetProjectId.value, presetAgentId.value))
const formTarget = computed(() => findTarget(formProjectId.value, formAgentId.value))

/** 预设自己的目标（预设行上的项目 + agent 优先） */
function presetTargetOf(preset: PresetItem): TaskTarget | undefined {
  return findTarget(preset.project_id ?? '', preset.agent_id ?? '')
}

/** 预设行目标文案：绑定目标 / 未绑定 */
function presetTargetLabel(preset: PresetItem): string {
  const target = presetTargetOf(preset)
  return target ? targetLabel(target) : t('task.targetUnbound')
}

// 任务队列标签：配置名（空则工作目录基名，再兜底配置 id）
function queueLabel(q: ConfigQueue): string {
  const base = baseName(q.workingDir)
  return q.name || base || q.config_id
}

async function loadTargets(opts: { silent?: boolean } = {}) {
  try {
    const result: any = await context.commands.execute('session.task.targets')
    targets.value = (result?.targets as TaskTarget[]) ?? []
    // 失效选择回退：项目/agent 任一不在清单里就清空 agent（保留项目让用户重选）
    if (
      createProjectId.value &&
      !targets.value.some(
        (target) =>
          target.project_id === createProjectId.value && target.agent_id === createAgentId.value,
      )
    ) {
      createAgentId.value = ''
    }
    if (
      presetProjectId.value &&
      !targets.value.some(
        (target) =>
          target.project_id === presetProjectId.value && target.agent_id === presetAgentId.value,
      )
    ) {
      presetAgentId.value = ''
    }
    if (
      formProjectId.value &&
      !targets.value.some(
        (target) =>
          target.project_id === formProjectId.value && target.agent_id === formAgentId.value,
      )
    ) {
      formAgentId.value = ''
    }
    if (!defaultTargetSelected && targets.value.length > 0) {
      defaultTargetSelected = true
      const preferred =
        targets.value.find((target) => target.active_session_id || target.pending_count > 0) ||
        targets.value[0]
      createProjectId.value = preferred.project_id
      createAgentId.value = preferred.agent_id
    }
  } catch (e) {
    console.error('[Session Center/task] Failed to load task targets:', e)
    if (!opts.silent) createError.value = t('task.loadFailed')
  }
}

async function loadRunningSessions(opts: { silent?: boolean } = {}) {
  // silent：点击下拉触发的刷新不置 loading —— 置 loading 会禁用 select，
  // 原生下拉在禁用瞬间无法展开（表现为“点击只闪加载、下拉不弹出”）
  if (!opts.silent) currentLoading.value = true
  try {
    const result: any = await context.commands.execute('session.task.running-sessions')
    const sessions: RunningSession[] = (result?.sessions ?? []).map((s: any) => ({
      ...s,
      queue: [],
    }))

    // 逐个加载待执行队列（仅当会话存在 pending 项，避免无谓请求）
    await Promise.all(
      sessions.map(async (s) => {
        if ((s.queue_count ?? 0) > 0) {
          try {
            const q: any = await context.commands.execute('session.task.queue-list', {
              session_id: s.session_id,
            })
            s.queue = (q?.tasks as QueueItem[]) ?? []
          } catch (e) {
            console.error(
              '[Session Center/task] Failed to load queue for session:',
              s.session_id,
              e,
            )
          }
        }
        return s
      }),
    )
    runningSessions.value = sessions

    // 首次加载：有目标时默认选中优先目标（活跃运行/等待任务优先）；
    // 之后仅修正失效选择（目标消失 → 清空 agent），不覆盖用户选择
    if (!defaultTargetSelected && targets.value.length > 0) {
      defaultTargetSelected = true
      const preferred =
        targets.value.find((target) => target.active_session_id || target.pending_count > 0) ||
        targets.value[0]
      createProjectId.value = preferred.project_id
      createAgentId.value = preferred.agent_id
    } else if (
      createProjectId.value &&
      !targets.value.some(
        (target) =>
          target.project_id === createProjectId.value && target.agent_id === createAgentId.value,
      )
    ) {
      createAgentId.value = ''
    }
  } catch (e) {
    console.error('[Session Center/task] Failed to load running sessions:', e)
  } finally {
    if (!opts.silent) currentLoading.value = false
  }
}

// 点击下拉：静默刷新目标与运行列表（后台更新选项，不打断原生下拉展开）
function onTargetSelectFocus() {
  void Promise.all([loadTargets({ silent: true }), loadRunningSessions({ silent: true })])
}

// 创建新任务：选了项目 + agent → 加入该目标队列（有活跃运行直接投递，
// 没有则等待运行）；未选目标或勾选「保存为预设」→ 保存为预设任务。
async function createTask() {
  const prompt = createPrompt.value.trim()
  if (!prompt) return
  const target = createTarget.value
  creatingTask.value = true
  createError.value = ''
  try {
    if (!target || createAsPreset.value) {
      await context.commands.execute('session.task.preset-create', {
        prompt,
        project_id: target?.project_id ?? '',
        agent_id: target?.agent_id ?? '',
      })
    } else {
      await context.commands.execute('session.task.queue-add', {
        project_id: target.project_id,
        agent_id: target.agent_id,
        prompt,
      })
    }
    createPrompt.value = ''
    createAsPreset.value = false
    // 清空后把输入框高度重置回单行
    await nextTick()
    autosizeTextarea(createPromptEl.value)
    // 立即刷新展示（事件广播会兜底刷新，这里先给用户即时反馈）
    await Promise.all([loadTargets(), loadRunningSessions(), loadConfigQueues(), loadPresets()])
  } catch (e) {
    console.error('[Session Center/task] Failed to create task:', e)
    createError.value = target ? t('task.createTaskFailed') : t('task.createPresetFailed')
  } finally {
    creatingTask.value = false
  }
}

// ==================== 预设任务（Tab1） ====================

async function loadPresets() {
  try {
    const result: any = await context.commands.execute('session.task.preset-list')
    presets.value = (result?.presets as PresetItem[]) || []
  } catch (e) {
    console.error('[Session Center/task] Failed to load presets:', e)
    presetError.value = t('task.loadFailed')
  }
}

// 把预设任务加入目标队列（一次性消耗，加入后预设自动移除）
//
// 预设自带项目 + agent 时优先用自带目标；未绑定的预设用上方回退选择。
// 目标没有活跃运行时后端挂到占位队列（等待运行），不会丢任务。
async function addPresetToQueue(presetId: string) {
  const preset = presets.value.find((item) => item.id === presetId)
  const own = preset ? presetTargetOf(preset) : undefined
  const target = own ?? presetTarget.value
  if (!target) {
    presetError.value = t('task.presetTargetHint')
    return
  }
  presetError.value = ''
  try {
    await context.commands.execute('session.task.preset-enqueue', {
      preset_id: presetId,
      project_id: target.project_id,
      agent_id: target.agent_id,
    })
    // 事件广播（preset/queue-changed）兜底，此处直接刷新即时反馈
    await Promise.all([loadPresets(), loadTargets(), loadConfigQueues(), loadRunningSessions()])
  } catch (e) {
    console.error('[Session Center/task] Failed to add preset to queue:', e)
    presetError.value = t('task.addPresetFailed')
  }
}

// ==================== 任务队列（Tab1） ====================

async function loadConfigQueues() {
  try {
    const result: any = await context.commands.execute('session.task.config-queues-list')
    configQueues.value = (result?.queues as ConfigQueue[]) ?? []
  } catch (e) {
    console.error('[Session Center/task] Failed to load config queues:', e)
    configQueueError.value = t('task.loadFailed')
  }
}

// 启动队列：后端按队列配置新建会话并迁移整队任务执行（自动模式下任务间自动轮换会话）
async function startConfigQueue(queueId: string) {
  if (startingQueueId.value) return
  startingQueueId.value = queueId
  configQueueError.value = ''
  try {
    await context.commands.execute('session.task.config-queue-start', { queue_id: queueId })
    // 启动后队列离开 ready 列表、新会话出现在运行中/执行任务区
    await Promise.all([loadConfigQueues(), loadRunningSessions()])
  } catch (e) {
    console.error('[Session Center/task] Failed to start config queue:', e)
    configQueueError.value = t('task.queueStartFailed')
  } finally {
    startingQueueId.value = ''
  }
}

// 队列「自动模式」开关（乐观更新，失败回滚；开启且队列已有任务时后端已自动启动）
async function toggleConfigQueueAutoMode(q: ConfigQueue) {
  const prev = q.auto_mode
  q.auto_mode = !prev
  configQueueError.value = ''
  try {
    const result: any = await context.commands.execute('session.task.config-queue-set-auto', {
      queue_id: q.id,
      auto_mode: q.auto_mode,
    })
    q.auto_mode = result?.auto_mode ?? q.auto_mode
    await Promise.all([loadConfigQueues(), loadRunningSessions()])
  } catch (e) {
    console.error('[Session Center/task] Failed to set config queue auto mode:', e)
    q.auto_mode = prev
    configQueueError.value = t('task.queueAutoFailed')
  }
}

// ==================== 未执行任务行内编辑（任务队列 / 执行任务区共用） ====================

// 进入编辑态：预填当前 prompt（Esc 取消 / 回车保存，与预设编辑同键位）
function startEditTask(scopeKey: string, item: QueueItem) {
  editingTaskScope.value = scopeKey
  editingTaskId.value = item.id
  editingTaskText.value = item.prompt
}

// 保存改写（仅 pending 可改；scope = 队列 id / 会话 id——queue-update 的
// session_id 用占位键即命中队列内的任务行）
async function saveEditTask() {
  const prompt = editingTaskText.value.trim()
  if (!editingTaskScope.value || !editingTaskId.value || !prompt) {
    editingTaskId.value = ''
    return
  }
  configQueueError.value = ''
  try {
    await context.commands.execute('session.task.queue-update', {
      session_id: editingTaskScope.value,
      task_id: editingTaskId.value,
      prompt,
    })
    editingTaskId.value = ''
    editingTaskScope.value = ''
    // 刷新任务队列区 + 执行任务区（随 running-sessions 重载）
    await Promise.all([loadConfigQueues(), loadRunningSessions()])
  } catch (e) {
    console.error('[Session Center/task] Failed to update task:', e)
    configQueueError.value = t('task.updateFailed')
  }
}

function cancelEditTask() {
  editingTaskId.value = ''
  editingTaskScope.value = ''
}

async function deletePreset(presetId: string) {
  presetError.value = ''
  try {
    await context.commands.execute('session.task.preset-delete', { preset_id: presetId })
    await loadPresets()
  } catch (e) {
    console.error('[Session Center/task] Failed to delete preset:', e)
    presetError.value = t('task.deletePresetFailed')
  }
}

// ==================== 预设任务编辑（行内编辑：输入框 + 保存/取消） ====================

const editingPresetId = ref<string | null>(null)
const editingPresetText = ref('')
const editingPresetProjectId = ref('')
const editingPresetAgentId = ref('')
const editingPresetAgentOptions = computed(() => agentOptionsFor(editingPresetProjectId.value))

// 进入编辑态：预填当前内容与目标，回车保存 / Esc 取消
function startEditPreset(p: PresetItem) {
  editingPresetId.value = p.id
  editingPresetText.value = p.prompt
  editingPresetProjectId.value = p.project_id ?? ''
  editingPresetAgentId.value = p.agent_id ?? ''
}

async function saveEditPreset() {
  const prompt = editingPresetText.value.trim()
  if (!editingPresetId.value || !prompt) {
    editingPresetId.value = null
    return
  }
  presetError.value = ''
  try {
    await context.commands.execute('session.task.preset-update', {
      preset_id: editingPresetId.value,
      prompt,
      project_id: editingPresetProjectId.value,
      agent_id: editingPresetAgentId.value,
    })
    editingPresetId.value = null
    // 事件广播（preset-changed）兜底，此处直接刷新即时反馈
    await loadPresets()
  } catch (e) {
    console.error('[Session Center/task] Failed to update preset:', e)
    presetError.value = t('task.updateFailed')
  }
}

function cancelEditPreset() {
  editingPresetId.value = null
  editingPresetText.value = ''
  editingPresetProjectId.value = ''
  editingPresetAgentId.value = ''
}

// ==================== 筛选选项与统计（Tab2/Tab4） ====================

const statusOptions = ['', 'idle', 'in_progress', 'asking', 'retrying', 'completed', 'interrupted']
const agentOptions = ['', 'pi', 'opencode', 'codex', 'claude', 'unknown']
const sourceOptions = ['', 'user', 'queue', 'scheduled']

// 来源固定三种（手动输入/自动任务/定时任务）：预存被消费后归为自动任务，
// 历史遗留的 preset 行同样按自动任务显示，与筛选条件保持一致
const sourceLabel: Record<string, string> = {
  user: t('task.sourceUser'),
  queue: t('task.sourceQueue'),
  preset: t('task.sourceQueue'),
  scheduled: t('task.sourceScheduled'),
}

// 筛选下拉选项（value 保持内部值，展示中文/可读标签）
const filterStatusOptions = statusOptions
  .slice(1)
  .map((s) => ({ value: s, label: statusLabel[s] || s }))
const filterAgentOptions = agentOptions.slice(1).map((a) => ({ value: a, label: a }))
const filterSourceOptions = sourceOptions
  .slice(1)
  .map((s) => ({ value: s, label: sourceLabel[s] || s }))

const knownStatuses = ['idle', 'in_progress', 'asking', 'retrying', 'completed', 'interrupted']
const statusStatsList = computed(() =>
  knownStatuses
    .filter((s) => (stats.value?.by_status?.[s] ?? 0) > 0)
    .map((s) => ({ key: s, label: statusLabel[s] || s, count: stats.value!.by_status![s] })),
)

const pageFrom = computed(() => (total.value === 0 ? 0 : offset.value + 1))
const pageTo = computed(() => offset.value + tasks.value.length)
const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + tasks.value.length < total.value)

// ==================== 数据加载（Tab2 任务记录） ====================

function buildFilter() {
  return {
    status: filterStatus.value || undefined,
    agent: filterAgent.value || undefined,
    source: filterSource.value || undefined,
    since: dateToUtc(filterSince.value) || undefined,
    until: dateToUtc(filterUntil.value) || undefined,
  }
}

async function loadTasks() {
  loading.value = true
  try {
    const result = await context.commands.execute('session.task.history-list', {
      ...buildFilter(),
      limit,
      offset: offset.value,
    })
    tasks.value = result?.tasks ?? []
    total.value = result?.total ?? 0
  } catch (e) {
    console.error('[Session Center/task] Failed to load history:', e)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const result = await context.commands.execute('session.task.history-stats', buildFilter())
    stats.value = result ?? null
  } catch (e) {
    console.error('[Session Center/task] Failed to load stats:', e)
  }
}

async function refreshRecords() {
  await Promise.all([loadTasks(), loadStats()])
}

// 筛选变化：重置到第一页并重载（统计随筛选刷新）
function onFilterChanged() {
  offset.value = 0
  refreshRecords()
}

// 切到对应 tab 时加载最新数据（事件刷新可能因未挂载而遗漏）
watch(activeTab, (tab) => {
  if (tab === 'current') {
    loadRunningSessions()
    loadConfigQueues()
  }
  if (tab === 'stats') loadStats()
})

function resetFilters() {
  filterStatus.value = ''
  filterAgent.value = ''
  filterSource.value = ''
  filterSince.value = null
  filterUntil.value = null
  onFilterChanged()
}

function prevPage() {
  if (hasPrev.value) {
    offset.value = Math.max(0, offset.value - limit)
    loadTasks()
  }
}

function nextPage() {
  if (hasNext.value) {
    offset.value += limit
    loadTasks()
  }
}

// 点击行：展开/收起详情
// ==================== 任务日志详情（二级页） ====================

/**
 * 打开某条任务的日志详情
 *
 * 任务行本身不存对话：详情经 `session.task.log-session` 由后端把任务行解析成
 * CLI 会话 id（运行记录 agent_session_id / 任务行 claude_sid），再复用 Agent
 * 管理日志的同一份转写解析（对话事件流 + 原始 JSONL）。
 */
async function openTaskLog(task: TaskRecord) {
  openedTask.value = task
  logTab.value = 'chat'
  logDetail.value = null
  logError.value = ''
  await loadTaskLog()
}

/** 关闭详情，回到表格（不重置筛选/分页：回来还是原样） */
function closeTaskLog() {
  openedTask.value = null
  logDetail.value = null
  logError.value = ''
}

/** 读一次详情（打开 / 扫描后重试共用） */
async function loadTaskLog() {
  const task = openedTask.value
  if (!task) return
  logLoading.value = true
  logError.value = ''
  try {
    const data = await context.commands.execute('session.task.log-session', { task_id: task.id })
    logDetail.value = data as TaskLogDetail
  } catch (e) {
    console.error('[Session Center/task] Failed to load task log:', e)
    logDetail.value = null
    logError.value = t('task.log.loadFailed')
  } finally {
    logLoading.value = false
  }
}

/**
 * 「未索引」→ 发起会话日志扫描并等它落定后重试
 *
 * 扫描是 Agent 管理的同一套流程（批量目录授权 → 枚举 → 解析入库）；发起后
 * 轮询状态直到脱离 syncing（guest 侧另有失活守卫，最长约 2 分钟），再重读详情。
 * 轮询上限比 guest 失活窗口留出余量，避免界面先停表而扫描其实已完成。
 */
async function scanUsageAndRetry() {
  if (usageScanning.value) return
  usageScanning.value = true
  logError.value = ''
  try {
    await context.commands.execute('agent.scan-usage', {})
    const deadline = Date.now() + 180_000
    let status = ''
    while (Date.now() < deadline) {
      const state = (await context.commands.execute('agent.get-usage-state', {})) as {
        state?: { status?: string }
      } | null
      status = state?.state?.status ?? ''
      if (status !== 'syncing') break
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    // 扫描没落地就给出路（拒绝授权 / 扫描失败都不是「未索引」，别让用户空等）
    if (status === 'auth-required') {
      logError.value = t('task.log.scanAuthRequired')
      return
    }
    if (status === 'error' || status === '') {
      logError.value = t('task.log.scanFailed')
      return
    }
    await loadTaskLog()
  } catch (e) {
    console.error('[Session Center/task] Failed to scan usage logs:', e)
    logError.value = t('task.log.scanFailed')
  } finally {
    usageScanning.value = false
  }
}

// ==================== 详情 → 恢复会话 ====================
const resume = useResumeSession(context)
/** 能否恢复：解析出 CLI 会话 id（未索引也能生成 resume 命令） */
const canResumeTask = computed(() => !!logDetail.value?.adapter && !!logDetail.value?.cliSessionId)
/** 恢复按钮的提示：不可恢复时说明原因，不留一个点了没反应的按钮 */
const resumeTaskTip = computed(() =>
  canResumeTask.value ? t('task.log.resumeTip') : t('task.log.resumeUnavailable'),
)

/** 分类原因 → 文案（三种「看不到内容」的成因各不相同，文案也不合并） */
const reasonText = computed(() => {
  switch (logDetail.value?.reason) {
    case 'no-cli-session':
      return t('task.log.noSession')
    case 'not-indexed':
      return t('task.log.notIndexed')
    case 'unreadable':
      return t('task.log.unreadable')
    default:
      return ''
  }
})

/**
 * 恢复该任务的 CLI 会话
 *
 * 复用 Agent 管理的恢复弹窗与同一条会话创建链：工作目录取任务行记录的工程目录，
 * 恢复命令由 guest 注册表按 (adapter, cliSessionId) 生成（前端不维护第二份映射）。
 * 详情载荷的字段名与 UsageSessionRow 不同（任务域 wire），这里只做形状适配。
 */
function resumeTask() {
  const detail = logDetail.value
  const task = openedTask.value
  if (!detail || !task || !canResumeTask.value) return
  const row: UsageSessionRow = {
    id: 0,
    adapter: detail.adapter as UsageSessionRow['adapter'],
    cli_session_id: detail.cliSessionId,
    project: task.working_dir,
    title: task.description,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    model: null,
    tokens_in: task.input_tokens ?? 0,
    tokens_out: task.output_tokens ?? 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_reasoning: 0,
    cost_total: null,
  }
  void resume.show(row)
}

/** 恢复成功 → 落到项目面（与 Agent 管理日志详情的去向一致） */
function emitResumed(): void {
  void router.push('/projects')
}

// ==================== 表格列（与 Agent 管理日志表格同构） ====================

/** 任务耗时（秒）：只算已完成的区间；进行中不按「此刻」估算（列表不随时间重算） */
function taskSeconds(task: TaskRecord): number | undefined {
  const started = task.started_at ? toDate(task.started_at) : null
  const completed = task.completed_at ? toDate(task.completed_at) : null
  if (!started || !completed) return undefined
  return (completed.getTime() - started.getTime()) / 1000
}

// ==================== 会话开关（队列卡片上的启动 / 自动应答） ====================

// 切换会话自动执行/自动应答开关
//
// 乐观更新本地状态即时反馈，失败回滚；后端 set-auto-mode 在自动执行
// 由关转开且会话空闲时立即调度队列（try_dispatch_next），由此实现在
// 当前任务页直接触发队列执行。
async function toggleSessionFlag(s: RunningSession, key: 'auto_execute' | 'auto_answer') {
  const prev = s[key]
  s[key] = !prev
  try {
    const result: any = await context.commands.execute('session.task.set-auto-mode', {
      session_id: s.session_id,
      auto_execute: s.auto_execute,
      auto_answer: s.auto_answer,
    })
    // 以后端返回的合并结果为准（未传字段保持原值，幂等回写避免闪烁）
    s.auto_execute = result?.auto_execute ?? s.auto_execute
    s.auto_answer = result?.auto_answer ?? s.auto_answer
  } catch (e) {
    console.error('[Session Center/task] Failed to set session mode:', e)
    s[key] = prev
    errorMessage.value = t('task.sessionFlagFailed')
  }
}

// ==================== 数据加载（Tab3 定时任务） ====================

async function loadJobs() {
  jobsLoading.value = true
  try {
    const result = await context.commands.execute('session.task.scheduled-list')
    jobs.value = (result?.jobs ?? []).map((j: any) => ({
      ...j,
      prompts: parsePrompts(j.prompts),
    }))
  } catch (e) {
    console.error('[Session Center/task] Failed to load scheduled jobs:', e)
  } finally {
    jobsLoading.value = false
  }
}

function parsePrompts(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

// workingDir 基名：兼容 Windows 反斜杠路径
function baseName(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function jobTargetLabel(job: ScheduledJob): string {
  const target = findTarget(job.project_id ?? '', job.agent_id ?? '')
  if (target) return targetLabel(target)
  const parts = [job.project_id, job.agent_id].filter(Boolean)
  return parts.length ? parts.join(' · ') : job.config_id || t('task.targetUnbound')
}

const utcPreview = computed(() => (formTriggerAt.value ? dateToUtc(formTriggerAt.value) : '-'))

// 重新设置面板的 UTC 预览（与新建表单同款提示）
const resetUtcPreview = computed(() =>
  resetTriggerAt.value ? dateToUtc(resetTriggerAt.value) : '-',
)

// 添加一条任务卡片（回车或点击按钮；空白忽略）
async function addPrompt() {
  const p = newPrompt.value.trim()
  if (!p) return
  formPrompts.value.push(p)
  newPrompt.value = ''
  // 清空后把输入框高度重置回单行
  await nextTick()
  autosizeTextarea(newPromptEl.value)
}

// 删除指定任务卡片
function removePrompt(index: number) {
  formPrompts.value.splice(index, 1)
}

async function submitJob() {
  // 任务内容为卡片列表，创建后按卡片顺序依次执行
  const prompts = formPrompts.value.map((p) => p.trim()).filter(Boolean)
  const target = formTarget.value
  if (!target || !formTriggerAt.value || prompts.length === 0) {
    errorMessage.value = t('task.scheduledFormInvalid')
    return
  }
  creatingJob.value = true
  errorMessage.value = ''
  try {
    const result = await context.commands.execute('session.task.scheduled-create', {
      name: formName.value.trim() || undefined,
      project_id: target.project_id,
      agent_id: target.agent_id,
      trigger_at: dateToUtc(formTriggerAt.value),
      prompts,
    })
    if (result?.job_id) {
      // 成功：收起表单并清空，列表刷新即为反馈
      formName.value = ''
      formProjectId.value = ''
      formAgentId.value = ''
      formTriggerAt.value = null
      formPrompts.value = []
      newPrompt.value = ''
      showForm.value = false
      await loadJobs()
    } else {
      errorMessage.value = t('task.scheduledCreateFailed')
    }
  } catch (e) {
    console.error('[Session Center/task] Failed to create scheduled job:', e)
    errorMessage.value = t('task.scheduledCreateFailed')
  } finally {
    creatingJob.value = false
  }
}

async function deleteJob(jobId: string) {
  errorMessage.value = ''
  try {
    await context.commands.execute('session.task.scheduled-delete', { job_id: jobId })
    await loadJobs()
  } catch (e) {
    console.error('[Session Center/task] Failed to delete scheduled job:', e)
    errorMessage.value = t('task.scheduledDeleteFailed')
  }
}

// 一键清空执行档案（仅 executed；missed/failed 需用户单独决定重置或删除）
async function clearFinished() {
  const executed = finishedJobs.value.filter((j) => j.status === 'executed')
  if (executed.length === 0) return
  errorMessage.value = ''
  try {
    for (const job of executed) {
      await context.commands.execute('session.task.scheduled-delete', { job_id: job.id })
    }
    await loadJobs()
  } catch (e) {
    console.error('[Session Center/task] Failed to clear executed jobs:', e)
    errorMessage.value = t('task.scheduledDeleteFailed')
  }
}

// ==================== 重新设置（missed / failed → pending） ====================

// 打开重置面板：默认预填当前时间（不改则重置后下一调度周期立即触发执行）
function startReset(job: ScheduledJob) {
  resettingId.value = job.id
  resetTriggerAt.value = new Date()
  errorMessage.value = ''
}

function cancelReset() {
  resettingId.value = null
  resetTriggerAt.value = null
}

async function resetJob(jobId: string) {
  if (!resetTriggerAt.value) {
    errorMessage.value = t('task.scheduledFormInvalid')
    return
  }
  errorMessage.value = ''
  try {
    await context.commands.execute('session.task.scheduled-reset', {
      job_id: jobId,
      trigger_at: dateToUtc(resetTriggerAt.value),
    })
    // 成功：关闭面板并刷新，任务回到 pending 重新参与调度
    cancelReset()
    await loadJobs()
  } catch (e) {
    console.error('[Session Center/task] Failed to reset scheduled job:', e)
    errorMessage.value = t('task.scheduledResetFailed')
  }
}

// ==================== 时间工具 ====================

// 后端时间均为 UTC "YYYY-MM-DD HH:MM:SS"，解析时补 Z 转本地时区显示
function toDate(isoStr: string): Date | null {
  if (!isoStr) return null
  const s = isoStr.includes('T') ? isoStr : isoStr.replace(' ', 'T')
  const hasZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(hasZone ? s : `${s}Z`)
  return isNaN(d.getTime()) ? null : d
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '-'
  const d = toDate(isoStr)
  if (!d) return isoStr
  // 跟随宿主当前语言（zh-CN / en），避免硬编码 zh-CN；
  // 数据层时间精确到秒（datetime('now')），展示同步到秒
  const locale = context.i18n.getI18n()?.global?.locale?.value ?? 'zh-CN'
  return d.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// 秒 → 可读时长（如 "5分钟 30秒" / "3h 20min"）
function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '-'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}${t('task.durationHours')} ${m}${t('task.durationMinutes')}`
  if (m > 0) return `${m}${t('task.durationMinutes')} ${s}${t('task.durationSeconds')}`
  return `${s}${t('task.durationSeconds')}`
}

function formatPercent(rate: number | undefined): string {
  if (rate === undefined) return '-'
  return `${(rate * 100).toFixed(1)}%`
}

// ==================== 事件与生命周期 ====================

let statusDisposable: { dispose(): void } | null = null
let queueDisposable: { dispose(): void } | null = null
let configQueueDisposable: { dispose(): void } | null = null
let scheduledDisposable: { dispose(): void } | null = null
let presetDisposable: { dispose(): void } | null = null
let modeDisposable: { dispose(): void } | null = null

onMounted(async () => {
  await Promise.all([
    refreshRecords(),
    loadJobs(),
    loadTargets(),
    loadRunningSessions(),
    loadConfigQueues(),
    loadPresets(),
  ])

  // 监听宿主深色模式切换（documentElement.dark class 变化）
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  // status/queue 变更刷新当前任务 + 任务记录；scheduled 变更刷新定时任务；preset 变更刷新预设区；
  // config-queue 变更刷新任务队列区（自动启动还可能产出新会话）；mode 变更同步会话开关状态
  statusDisposable = context.events.on('task:status-changed', onLiveChanged)
  queueDisposable = context.events.on('task:queue-changed', onLiveChanged)
  configQueueDisposable = context.events.on('task:config-queue-changed', onConfigQueueLiveChanged)
  scheduledDisposable = context.events.on('task:scheduled-changed', () => loadJobs())
  presetDisposable = context.events.on('task:preset-changed', () => {
    loadPresets()
    loadTargets()
  })
  modeDisposable = context.events.on('session:mode-changed', onModeChanged)
})

// 会话模式变更：同步对应会话的开关状态
function onModeChanged(data: any) {
  const sid = data?.session_id
  if (!sid) return
  const s = runningSessions.value.find((x) => x.session_id === sid)
  if (!s) return
  if (typeof data.auto_execute === 'boolean') s.auto_execute = data.auto_execute
  if (typeof data.auto_answer === 'boolean') s.auto_answer = data.auto_answer
}

onUnmounted(() => {
  if (filterDebounce) clearTimeout(filterDebounce)
  themeObserver?.disconnect()
  statusDisposable?.dispose()
  queueDisposable?.dispose()
  configQueueDisposable?.dispose()
  scheduledDisposable?.dispose()
  presetDisposable?.dispose()
  modeDisposable?.dispose()
})

// 任务状态/队列实时变更：任务记录（含统计）与当前任务 Tab 一起刷新
function onLiveChanged() {
  refreshRecords()
  loadRunningSessions()
  loadTargets()
  // 队列尺寸/内容可能随 queue 键广播变化（含队列 id / 目标占位键的更新/取消）
  loadConfigQueues()
}

// 任务队列变更（入队/启动/自动模式）：刷新任务队列区；自动启动可能产出新会话
function onConfigQueueLiveChanged() {
  loadConfigQueues()
  loadRunningSessions()
  loadTargets()
}
</script>

<template>
  <div class="h-full overflow-hidden flex flex-col bg-[var(--bg-page)]" data-testid="tasks-view">
    <!-- Header + Tab 切换 -->
    <div class="px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
      <h2 class="text-sm font-semibold text-[var(--text-primary)] mb-2">
        {{ t('task.historyTitle') }}
      </h2>
      <div class="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-hover)]">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex-1 h-8 rounded-md text-xs font-medium transition-colors duration-200"
          :class="
            activeTab === tab.key
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          "
          :aria-selected="activeTab === tab.key"
          :data-testid="`tasks-tab-${tab.key}`"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- Tab1 当前任务。page-swap 单独包一层：退场的绝对定位层需要以「Tab 内容区」为
         定位上下文，直接标在视图根上会从页头顶部（标题与 tab 条所在行）开始绘制。 -->
    <div class="page-swap flex-1 flex flex-col min-h-0">
      <Transition name="page">
        <div
          v-if="activeTab === 'current'"
          class="flex-1 flex flex-col min-h-0"
          data-testid="tasks-panel-current"
        >
          <!-- 滚动内容：创建任务 / 当前任务 / 执行任务 -->
          <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
            <!-- 创建新任务 -->
            <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2">
              <h3 class="text-xs font-semibold text-[var(--text-primary)]">
                {{ t('task.createTaskTitle') }}
              </h3>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.createTaskProject')
                  }}</label>
                  <Select
                    v-model="createProjectId"
                    :options="projectOptions"
                    size="sm"
                    data-testid="task-create-project"
                    @open="onTargetSelectFocus"
                    @update:model-value="createAgentId = ''"
                  />
                </div>
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.createTaskAgent')
                  }}</label>
                  <Select
                    v-model="createAgentId"
                    :options="createAgentOptions"
                    size="sm"
                    :disabled="!createProjectId"
                    data-testid="task-create-agent"
                    @open="onTargetSelectFocus"
                  />
                </div>
              </div>
              <div class="flex items-end gap-1.5">
                <textarea
                  :ref="(el) => (createPromptEl = el as HTMLTextAreaElement | null)"
                  v-model="createPrompt"
                  rows="1"
                  :class="textareaCls"
                  :placeholder="t('task.createTaskPromptPlaceholder')"
                  @input="autosizeTextarea($event.target)"
                  @keydown="submitOnEnter(createTask)($event)"
                />
                <button
                  class="flex-shrink-0 h-8 px-3 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-primary-contrast)] text-xs font-medium transition-opacity duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="creatingTask || !createPrompt.trim()"
                  @click="createTask"
                >
                  {{
                    createTarget && !createAsPreset
                      ? t('task.createTaskSubmit')
                      : t('task.saveAsPreset')
                  }}
                </button>
              </div>
              <!-- 目标模式：可直接投递（无活跃运行则等待）或保存为预设 -->
              <label
                v-if="createTarget"
                class="inline-flex items-center gap-1.5 text-[calc(11px*var(--ui-scale))] text-[var(--text-secondary)] cursor-pointer"
              >
                <input
                  v-model="createAsPreset"
                  type="checkbox"
                  class="accent-[var(--color-primary)]"
                />
                {{ t('task.saveAsPresetTarget') }}
              </label>
              <p
                v-if="createTarget && !createAsPreset && !createTarget.active_session_id"
                class="text-[calc(11px*var(--ui-scale))] text-[var(--color-warning-ink)]"
              >
                {{ t('task.waitingRunHint') }}
              </p>
              <p
                v-else-if="!createTarget"
                class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]"
              >
                {{ t('task.createTaskPresetHint') }}
              </p>
              <p v-if="createError" class="text-xs text-[var(--color-danger-ink)] break-words">
                {{ createError }}
              </p>
            </div>

            <!-- 等待运行的任务：目标（项目 × agent）暂无活跃运行，任务已落库不会丢 -->
            <div
              v-if="pendingTargets.length > 0"
              class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2"
            >
              <h3 class="text-xs font-semibold text-[var(--text-primary)]">
                {{ t('task.pendingTargetsTitle') }}
              </h3>
              <div
                v-for="target in pendingTargets"
                :key="`${target.project_id}:${target.agent_id}`"
                class="rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] p-2.5 space-y-1"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="text-xs font-medium text-[var(--text-primary)] truncate flex-1 min-w-0"
                  >
                    {{ targetLabel(target) }}
                  </span>
                  <span class="text-xs text-[var(--color-warning-ink)] flex-shrink-0">
                    {{ t('task.waitingRun') }}
                  </span>
                  <span class="text-xs text-[var(--text-secondary)] flex-shrink-0">
                    {{ t('task.queueCount', { count: target.pending_count }) }}
                  </span>
                </div>
                <div
                  v-for="item in target.pending_tasks ?? []"
                  :key="item.id"
                  class="flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--bg-card)]"
                >
                  <span class="text-xs text-[var(--text-tertiary)] w-5 text-right flex-shrink-0">
                    #{{ item.position }}
                  </span>
                  <span class="text-sm text-[var(--text-primary)] truncate flex-1">
                    {{ item.prompt }}
                  </span>
                  <button
                    class="flex-shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-light)] transition-colors duration-200"
                    :title="t('task.delete')"
                    data-testid="pending-task-remove"
                    @click="removePendingTask(target, item)"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
                  {{ t('task.waitingRunHint') }}
                </p>
              </div>
              <p v-if="pendingError" class="text-xs text-[var(--color-danger-ink)] break-words">
                {{ pendingError }}
              </p>
            </div>

            <!-- 任务队列（按配置分组的未绑定会话批次：启动/自动模式时才建会话执行） -->
            <div
              v-if="configQueues.length > 0"
              class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2"
            >
              <h3 class="text-xs font-semibold text-[var(--text-primary)]">
                {{ t('task.configQueueTitle') }}
              </h3>
              <div class="space-y-2.5">
                <div
                  v-for="q in configQueues"
                  :key="q.id"
                  class="rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] p-3 space-y-1.5"
                >
                  <!-- 执行会话（配置名） + 自动任务数 -->
                  <div class="flex items-center gap-2">
                    <span
                      class="text-xs font-medium text-[var(--text-primary)] truncate flex-1 min-w-0"
                    >
                      {{ t('task.createNewSessionOption', { name: queueLabel(q) }) }}
                    </span>
                    <span class="text-xs text-[var(--text-secondary)] flex-shrink-0">
                      {{ t('task.queueCount', { count: q.tasks.length }) }}
                    </span>
                  </div>
                  <!-- 自动任务列表（未执行任务支持行内编辑） -->
                  <div v-if="q.tasks.length > 0" class="space-y-1">
                    <div
                      v-for="item in q.tasks"
                      :key="item.id"
                      class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--bg-card)]"
                    >
                      <!-- 编辑模式：自动增高输入框 + 保存/取消（回车保存，Shift+回车换行，Esc 取消） -->
                      <template v-if="editingTaskId === item.id && editingTaskScope === q.id">
                        <textarea
                          :ref="(el) => autosizeTextarea(el as HTMLTextAreaElement | null)"
                          v-model="editingTaskText"
                          rows="1"
                          :class="textareaCls"
                          :placeholder="item.prompt"
                          @input="autosizeTextarea($event.target)"
                          @keydown="submitOnEnter(saveEditTask)($event)"
                          @keydown.esc="cancelEditTask"
                        />
                        <button
                          class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors duration-200"
                          :title="t('task.save')"
                          @click="saveEditTask"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </button>
                        <button
                          class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                          :title="t('task.cancel')"
                          @click="cancelEditTask"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </template>
                      <!-- 常规模式：位置 + prompt + 编辑 -->
                      <template v-else>
                        <span
                          class="text-xs text-[var(--text-tertiary)] w-5 text-right flex-shrink-0"
                          >#{{ item.position }}</span
                        >
                        <span class="text-sm text-[var(--text-primary)] truncate flex-1">{{
                          item.prompt
                        }}</span>
                        <button
                          class="flex-shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                          :title="t('task.edit')"
                          @click="startEditTask(q.id, item)"
                        >
                          <svg
                            class="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                            />
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                            />
                          </svg>
                        </button>
                      </template>
                    </div>
                  </div>
                  <!-- 启动 + 自动模式（ready 态控制；启动后迁移到会话卡片） -->
                  <div class="flex items-center gap-4 pt-1">
                    <button
                      class="inline-flex items-center gap-1 flex-shrink-0 h-7 px-2.5 rounded-[6px] text-xs font-medium transition-opacity duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      :class="
                        q.tasks.length > 0 && startingQueueId !== q.id
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-contrast)] hover:opacity-90'
                          : 'bg-[var(--border)] text-[var(--text-tertiary)]'
                      "
                      :disabled="q.tasks.length === 0 || startingQueueId !== ''"
                      :title="
                        q.tasks.length === 0
                          ? t('task.queueStartEmptyHint')
                          : t('task.queueStartHint')
                      "
                      @click="startConfigQueue(q.id)"
                    >
                      {{ startingQueueId === q.id ? t('task.loading') : t('task.queueStart') }}
                    </button>
                    <button
                      class="inline-flex items-center gap-1.5"
                      :title="t('task.queueAutoModeHint')"
                      @click="toggleConfigQueueAutoMode(q)"
                    >
                      <span
                        class="relative w-8 h-4 rounded-full transition-colors duration-200"
                        :class="
                          q.auto_mode ? 'bg-[var(--color-primary)]' : 'bg-[var(--border-strong)]'
                        "
                      >
                        <span
                          class="absolute top-[2px] w-3 h-3 rounded-full transition-[left,background-color] duration-200"
                          :class="
                            q.auto_mode
                              ? 'left-[18px] bg-[var(--color-primary-contrast)]'
                              : 'left-[2px] bg-[var(--text-tertiary)]'
                          "
                        ></span>
                      </span>
                      <span
                        class="text-xs transition-colors duration-200"
                        :class="
                          q.auto_mode
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)]'
                        "
                      >
                        {{ t('task.queueAutoMode') }}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
              <p v-if="configQueueError" class="text-xs text-[var(--color-danger-ink)] break-words">
                {{ configQueueError }}
              </p>
            </div>

            <!-- 预设任务（常显：只要存在预设就展示，不随会话选择隐藏） -->
            <div
              v-if="presets.length > 0"
              class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2"
            >
              <h3 class="text-xs font-semibold text-[var(--text-primary)]">
                {{ t('task.presetTitle') }} ({{ presets.length }})
              </h3>
              <!-- 预设目标：预设自带项目 + agent 时优先用自带目标；未绑定的用这里回退 -->
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.presetTargetProject')
                  }}</label>
                  <Select
                    v-model="presetProjectId"
                    :options="projectOptions"
                    size="sm"
                    data-testid="task-preset-project"
                    @open="onTargetSelectFocus"
                    @update:model-value="presetAgentId = ''"
                  />
                </div>
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.presetTargetAgent')
                  }}</label>
                  <Select
                    v-model="presetAgentId"
                    :options="presetAgentOptions"
                    size="sm"
                    :disabled="!presetProjectId"
                    data-testid="task-preset-agent"
                    @open="onTargetSelectFocus"
                  />
                </div>
              </div>
              <div class="space-y-1">
                <div
                  v-for="p in presets"
                  :key="p.id"
                  class="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-hover)]"
                >
                  <!-- 编辑模式：自动增高输入框 + 保存/取消（回车保存，Shift+回车换行，Esc 取消） -->
                  <template v-if="editingPresetId === p.id">
                    <div class="flex-1 min-w-0 space-y-1.5">
                      <div class="grid grid-cols-2 gap-1.5">
                        <Select
                          v-model="editingPresetProjectId"
                          :options="projectOptions"
                          size="sm"
                          @update:model-value="editingPresetAgentId = ''"
                        />
                        <Select
                          v-model="editingPresetAgentId"
                          :options="editingPresetAgentOptions"
                          size="sm"
                          :disabled="!editingPresetProjectId"
                        />
                      </div>
                      <textarea
                        :ref="(el) => autosizeTextarea(el)"
                        v-model="editingPresetText"
                        rows="1"
                        :class="textareaCls"
                        :placeholder="p.prompt"
                        @input="autosizeTextarea($event.target)"
                        @keydown="submitOnEnter(saveEditPreset)($event)"
                        @keydown.esc="cancelEditPreset"
                      />
                    </div>
                    <button
                      class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors duration-200"
                      :title="t('task.save')"
                      @click="saveEditPreset"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </button>
                    <button
                      class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                      :title="t('task.cancel')"
                      @click="cancelEditPreset"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </template>
                  <!-- 常规模式：内容 + 加入队列 / 编辑 / 删除 -->
                  <template v-else>
                    <div class="flex-1 min-w-0">
                      <span class="block text-sm text-[var(--text-primary)] truncate">{{
                        p.prompt
                      }}</span>
                      <span
                        class="block text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] truncate"
                      >
                        {{ presetTargetLabel(p) }}
                      </span>
                    </div>
                    <button
                      class="inline-flex items-center gap-1 flex-shrink-0 h-7 px-2.5 rounded-[6px] text-xs font-medium transition-opacity duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      :class="
                        presetTargetOf(p) || presetTarget
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-contrast)] hover:opacity-90'
                          : 'bg-[var(--border)] text-[var(--text-tertiary)]'
                      "
                      :disabled="!(presetTargetOf(p) || presetTarget)"
                      :title="
                        presetTargetOf(p) || presetTarget
                          ? t('task.addToQueue')
                          : t('task.presetTargetHint')
                      "
                      @click="addPresetToQueue(p.id)"
                    >
                      {{ t('task.addToQueue') }}
                    </button>
                    <button
                      class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                      :title="t('task.edit')"
                      @click="startEditPreset(p)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                        />
                      </svg>
                    </button>
                    <button
                      class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-light)] transition-colors duration-200"
                      :title="t('task.delete')"
                      @click="deletePreset(p.id)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                        />
                      </svg>
                    </button>
                  </template>
                </div>
              </div>
              <p
                v-if="!presetTarget && presets.some((p) => !presetTargetOf(p))"
                class="text-xs text-[var(--color-danger-ink)] break-words"
              >
                {{ t('task.presetTargetHint') }}
              </p>
              <p v-if="presetError" class="text-xs text-[var(--color-danger-ink)] break-words">
                {{ presetError }}
              </p>
            </div>

            <!-- 当前任务（执行中的任务） -->
            <div v-if="activeTasks.length > 0">
              <h3 class="text-xs font-medium text-[var(--text-tertiary)] mb-2">
                {{ t('task.currentTaskTitle') }}
              </h3>
              <div class="space-y-1.5">
                <div
                  v-for="s in activeTasks"
                  :key="s.session_id"
                  class="rounded-lg border border-[color-mix(in_srgb,var(--color-info)_35%,transparent)] dark:border-[var(--color-info)] bg-[var(--color-info-light)] dark:bg-[var(--color-info-light)] p-3"
                >
                  <div class="flex items-center gap-2 mb-1">
                    <div
                      class="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                      :class="statusDot[s.task_status] || 'bg-[var(--color-info)]'"
                    ></div>
                    <span
                      class="text-xs font-medium flex-shrink-0"
                      :class="statusColor[s.task_status] || 'text-[var(--color-info-ink)]'"
                    >
                      {{ statusLabel[s.task_status] || s.task_status }}
                    </span>
                    <span class="text-xs text-[var(--text-tertiary)] truncate flex-1 min-w-0">{{
                      sessionLabel(s)
                    }}</span>
                    <span
                      v-if="s.queue_count > 0"
                      class="text-xs text-[var(--text-secondary)] flex-shrink-0"
                    >
                      {{ t('task.queueCount', { count: s.queue_count }) }}
                    </span>
                  </div>
                  <p class="text-sm text-[var(--text-primary)] break-words">
                    {{ s.description || '-' }}
                  </p>
                  <p class="text-xs text-[var(--text-tertiary)] mt-1">
                    {{ formatTime(s.started_at) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 执行任务（各会话待执行队列） -->
            <div v-if="executingSessions.length > 0">
              <h3 class="text-xs font-medium text-[var(--text-tertiary)] mb-2">
                {{ t('task.executingTaskTitle') }}
              </h3>
              <div class="space-y-2.5">
                <div v-for="s in executingSessions" :key="s.session_id">
                  <p class="text-xs text-[var(--text-tertiary)] mb-1">
                    {{ sessionLabel(s) }} · {{ t('task.queueCount', { count: s.queue.length }) }}
                  </p>
                  <!-- 队列卡片头部：启动（自动执行）/ 自动应答开关；开启自动执行后队列立即调度 -->
                  <div
                    class="flex items-center gap-4 px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border)] mb-1.5"
                  >
                    <button
                      class="inline-flex items-center gap-1.5"
                      :title="t('task.autoExecuteHint')"
                      @click="toggleSessionFlag(s, 'auto_execute')"
                    >
                      <span
                        class="relative w-8 h-4 rounded-full transition-colors duration-200"
                        :class="
                          s.auto_execute ? 'bg-[var(--color-primary)]' : 'bg-[var(--border-strong)]'
                        "
                      >
                        <span
                          class="absolute top-[2px] w-3 h-3 rounded-full transition-[left,background-color] duration-200"
                          :class="
                            s.auto_execute
                              ? 'left-[18px] bg-[var(--color-primary-contrast)]'
                              : 'left-[2px] bg-[var(--text-tertiary)]'
                          "
                        ></span>
                      </span>
                      <span
                        class="text-xs transition-colors duration-200"
                        :class="
                          s.auto_execute
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)]'
                        "
                      >
                        {{ t('task.autoExecute') }}
                      </span>
                    </button>
                    <button
                      class="inline-flex items-center gap-1.5"
                      :title="t('task.autoAnswerHint')"
                      @click="toggleSessionFlag(s, 'auto_answer')"
                    >
                      <span
                        class="relative w-8 h-4 rounded-full transition-colors duration-200"
                        :class="
                          s.auto_answer ? 'bg-[var(--color-primary)]' : 'bg-[var(--border-strong)]'
                        "
                      >
                        <span
                          class="absolute top-[2px] w-3 h-3 rounded-full transition-[left,background-color] duration-200"
                          :class="
                            s.auto_answer
                              ? 'left-[18px] bg-[var(--color-primary-contrast)]'
                              : 'left-[2px] bg-[var(--text-tertiary)]'
                          "
                        ></span>
                      </span>
                      <span
                        class="text-xs transition-colors duration-200"
                        :class="
                          s.auto_answer
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)]'
                        "
                      >
                        {{ t('task.autoAnswer') }}
                      </span>
                    </button>
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="item in s.queue"
                      :key="item.id"
                      class="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-hover)] text-sm"
                    >
                      <!-- 未执行（pending）任务支持行内编辑，作用域 = 会话 id -->
                      <template
                        v-if="editingTaskId === item.id && editingTaskScope === s.session_id"
                      >
                        <textarea
                          :ref="(el) => autosizeTextarea(el as HTMLTextAreaElement | null)"
                          v-model="editingTaskText"
                          rows="1"
                          :class="textareaCls"
                          :placeholder="item.prompt"
                          @input="autosizeTextarea($event.target)"
                          @keydown="submitOnEnter(saveEditTask)($event)"
                          @keydown.esc="cancelEditTask"
                        />
                        <button
                          class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors duration-200"
                          :title="t('task.save')"
                          @click="saveEditTask"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </button>
                        <button
                          class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                          :title="t('task.cancel')"
                          @click="cancelEditTask"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </template>
                      <template v-else>
                        <span
                          class="text-xs text-[var(--text-tertiary)] w-5 text-right flex-shrink-0"
                          >#{{ item.position }}</span
                        >
                        <span class="text-[var(--text-primary)] truncate flex-1">{{
                          item.prompt
                        }}</span>
                        <button
                          class="flex-shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                          :title="t('task.edit')"
                          @click="startEditTask(s.session_id, item)"
                        >
                          <svg
                            class="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                            />
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                            />
                          </svg>
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 加载中 -->
            <div v-if="currentLoading" class="flex justify-center py-4">
              <span class="text-sm text-[var(--text-tertiary)]">{{ t('task.loading') }}</span>
            </div>

            <!-- 空状态：无运行会话且无预设任务时展示（有预设时由预设区替代） -->
            <div
              v-if="!currentLoading && runningSessions.length === 0 && presets.length === 0"
              class="flex flex-col items-center justify-center py-12"
            >
              <svg
                class="w-12 h-12 text-[var(--text-tertiary)] mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <p class="text-sm text-[var(--text-tertiary)]">{{ t('task.noRunningSessions') }}</p>
              <p class="text-xs text-[var(--text-tertiary)] mt-1">
                {{ t('task.noRunningSessionsHint') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Tab2 任务日志：一级表格（与 Agent 管理日志表格同构）⇄ 二级详情 -->
        <div
          v-else-if="activeTab === 'records'"
          class="flex-1 flex flex-col min-h-0"
          data-testid="tasks-panel-records"
        >
          <!-- ==================== 一级：筛选 + 分页表格 ==================== -->
          <template v-if="!openedTask">
            <!-- 筛选条（条件与分页语义未变，只是表格换了皮） -->
            <div class="px-4 pt-3 pb-3 flex-shrink-0 space-y-2">
              <div class="grid grid-cols-3 gap-1.5 items-start">
                <Select
                  v-model="filterStatus"
                  :options="filterStatusOptions"
                  size="sm"
                  :placeholder="t('task.filterStatus')"
                  @update:model-value="onFilterChanged"
                />
                <Select
                  v-model="filterAgent"
                  :options="filterAgentOptions"
                  size="sm"
                  :placeholder="t('task.filterAgent')"
                  @update:model-value="onFilterChanged"
                />
                <Select
                  v-model="filterSource"
                  :options="filterSourceOptions"
                  size="sm"
                  :placeholder="t('task.filterSource')"
                  @update:model-value="onFilterChanged"
                />
              </div>
              <div class="grid grid-cols-2 gap-1.5">
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.filterSince')
                  }}</label>
                  <Datepicker
                    v-model="filterSince"
                    :format="dateFormat"
                    :locale="dateLocale"
                    :dark="isDark"
                    :clearable="true"
                    :enable-time-picker="true"
                    :select-text="dpSelectText"
                    :cancel-text="dpCancelText"
                    :now-button-label="dpNowLabel"
                    :teleport="'body'"
                    :placeholder="t('task.filterSince')"
                    data-testid="task-filter-since"
                    @update:model-value="onFilterChangedDebounced"
                  />
                </div>
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                    t('task.filterUntil')
                  }}</label>
                  <Datepicker
                    v-model="filterUntil"
                    :format="dateFormat"
                    :locale="dateLocale"
                    :dark="isDark"
                    :clearable="true"
                    :enable-time-picker="true"
                    :select-text="dpSelectText"
                    :cancel-text="dpCancelText"
                    :now-button-label="dpNowLabel"
                    :teleport="'body'"
                    :placeholder="t('task.filterUntil')"
                    data-testid="task-filter-until"
                    @update:model-value="onFilterChangedDebounced"
                  />
                </div>
              </div>
              <div class="flex justify-end">
                <button
                  class="text-xs text-[var(--color-primary)] hover:underline transition-colors duration-200"
                  @click="resetFilters"
                >
                  {{ t('task.filterReset') }}
                </button>
              </div>
            </div>

            <!-- 分页表格：Agent | 任务 | 项目 | 开始时间 | 时长 | Tokens
                 （列轨 / 表头与滚动容器 / 分页器结构与 Agent 管理日志表格同一份样式，
                 见 agents/hub-styles.css 的 `.ah-lg-*`） -->
            <div class="ah-card ah-lg-table mx-4 mb-3">
              <div class="ah-lg-table-scroll">
                <div class="ah-lg-table-head">
                  <span>{{ t('hub.lg.col.agent') }}</span>
                  <span>{{ t('task.log.colTask') }}</span>
                  <span>{{ t('hub.lg.col.project') }}</span>
                  <span class="ah-lg-col-time">{{ t('hub.lg.col.started') }}</span>
                  <span class="ah-lg-col-dur">{{ t('hub.lg.col.duration') }}</span>
                  <span class="ah-lg-col-tokens">{{ t('hub.lg.col.tokens') }}</span>
                  <span class="ah-lg-col-go"></span>
                </div>

                <div class="ah-lg-table-rows">
                  <div v-if="loading" class="ah-st-empty" data-testid="task-log-list-loading">
                    {{ t('task.loading') }}
                  </div>
                  <div
                    v-else-if="tasks.length === 0"
                    class="ah-st-empty"
                    data-testid="task-log-empty"
                  >
                    <p>{{ t('task.emptyHistory') }}</p>
                    <p class="text-xs text-[var(--text-tertiary)] mt-1">
                      {{ t('task.emptyHistoryHint') }}
                    </p>
                  </div>
                  <div
                    v-for="task in tasks"
                    :key="task.id"
                    class="ah-lg-row"
                    role="button"
                    tabindex="0"
                    :title="`${t('task.log.open')} · ${statusLabel[task.status] || task.status}`"
                    data-testid="task-log-row"
                    @click="openTaskLog(task)"
                    @keydown.enter="openTaskLog(task)"
                  >
                    <div class="ah-lg-cell-agent">
                      <AgentIcon :adapter="task.agent || 'unknown'" :size="16" />
                      <span class="ah-lg-cell-agent-name">{{ task.agent || '-' }}</span>
                    </div>
                    <div class="ah-lg-cell-title" :title="task.description || task.session_id">
                      <span
                        class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 mr-1.5"
                        :class="statusDot[task.status] || 'bg-[var(--text-tertiary)]'"
                        aria-hidden="true"
                      ></span>
                      {{ task.description || task.session_id }}
                    </div>
                    <div class="ah-lg-cell-sub" :title="task.working_dir || ''">
                      {{ abbreviateProject(task.working_dir, '') }}
                    </div>
                    <div class="ah-lg-col-time ah-mono">
                      {{ formatTime(task.started_at || task.created_at) }}
                    </div>
                    <div class="ah-lg-col-dur ah-mono">{{ formatDuration(taskSeconds(task)) }}</div>
                    <div class="ah-lg-col-tokens ah-mono">
                      {{ formatTokens((task.input_tokens || 0) + (task.output_tokens || 0)) }}
                    </div>
                    <div class="ah-lg-col-go">›</div>
                  </div>
                </div>
              </div>

              <div class="ah-lg-pager">
                <span class="ah-lg-pager-info">
                  {{ t('task.paginationRange', { from: pageFrom, to: pageTo, total }) }}
                </span>
                <span v-if="hasPrev || hasNext" class="ah-speed-actions-btns">
                  <button
                    type="button"
                    class="ah-btn ah-btn-ghost ah-btn-sm"
                    :disabled="!hasPrev || loading"
                    @click="prevPage"
                  >
                    ‹ {{ t('task.paginationPrev') }}
                  </button>
                  <button
                    type="button"
                    class="ah-btn ah-btn-ghost ah-btn-sm"
                    :disabled="!hasNext || loading"
                    @click="nextPage"
                  >
                    {{ t('task.paginationNext') }} ›
                  </button>
                </span>
              </div>
            </div>
          </template>

          <!-- ==================== 二级：任务日志详情 ====================
               头卡 + 页签 + 转写内容面。与 Agent 管理日志详情同构；差异只在头卡
               字段（任务描述 / 状态 / 来源 / 各时间点）与「未索引」出路。 -->
          <template v-else>
            <div class="ah-lg-detail px-4 py-3">
              <div class="ah-card ah-lg-detail-head">
                <div class="ah-lg-detail-head-row">
                  <button
                    type="button"
                    class="ah-btn ah-btn-ghost ah-btn-sm ah-lg-detail-back"
                    data-testid="task-log-back"
                    @click="closeTaskLog"
                  >
                    ← {{ t('task.log.back') }}
                  </button>
                  <AgentIcon :adapter="openedTask.agent || 'unknown'" :size="16" />
                  <span class="ah-lg-detail-title">{{
                    openedTask.description || openedTask.session_id
                  }}</span>
                  <span v-if="openedTask.agent" class="ah-cli-tag ok">{{ openedTask.agent }}</span>
                  <span class="ah-lg-detail-tabs" role="tablist">
                    <button
                      type="button"
                      class="ah-lg-tab"
                      :class="{ active: logTab === 'chat' }"
                      role="tab"
                      :aria-selected="logTab === 'chat'"
                      data-testid="task-log-tab-chat"
                      @click="logTab = 'chat'"
                    >
                      {{ t('hub.lg.detail.tabChat') }}
                    </button>
                    <button
                      type="button"
                      class="ah-lg-tab"
                      :class="{ active: logTab === 'raw' }"
                      role="tab"
                      :aria-selected="logTab === 'raw'"
                      data-testid="task-log-tab-raw"
                      @click="logTab = 'raw'"
                    >
                      {{ t('hub.lg.detail.tabRaw') }}
                    </button>
                  </span>
                  <!-- 恢复会话：解析出 CLI 会话 id 即可用（不依赖日志索引） -->
                  <button
                    type="button"
                    class="ah-btn ah-btn-primary ah-btn-sm ah-lg-detail-resume"
                    data-testid="task-log-resume"
                    :disabled="!canResumeTask"
                    :title="resumeTaskTip"
                    @click="resumeTask"
                  >
                    {{ t('hub.lg.resume.open') }}
                  </button>
                </div>
                <div class="ah-lg-head-src ah-mono" :title="openedTask.working_dir || ''">
                  {{ openedTask.working_dir || t('hub.lg.noSource') }}
                </div>
                <div class="ah-lg-head-meta ah-mono">
                  <span>{{ statusLabel[openedTask.status] || openedTask.status }}</span>
                  <span v-if="openedTask.source">
                    {{ sourceLabel[openedTask.source] || openedTask.source }}
                  </span>
                  <span
                    >↑ {{ formatTokens(openedTask.input_tokens) }} ↓
                    {{ formatTokens(openedTask.output_tokens) }}</span
                  >
                  <span>{{ t('task.log.created') }} {{ formatTime(openedTask.created_at) }}</span>
                  <span>{{ t('task.log.started') }} {{ formatTime(openedTask.started_at) }}</span>
                  <span v-if="openedTask.completed_at"
                    >{{ t('task.log.completed') }} {{ formatTime(openedTask.completed_at) }}</span
                  >
                </div>
                <div v-if="openedTask.exit_reason" class="ah-lg-warn" data-testid="task-log-exit">
                  {{ openedTask.exit_reason }}
                </div>
                <div v-if="logDetail?.log?.eventsTruncated" class="ah-lg-warn">
                  {{ t('hub.lg.eventsTruncated') }}
                </div>
                <div v-if="logDetail?.log?.rawTruncated" class="ah-lg-warn">
                  {{ t('hub.lg.rawTruncated') }}
                </div>
              </div>

              <!-- 取数中 -->
              <div v-if="logLoading" class="ah-card ah-lg-events" data-testid="task-log-loading">
                <div class="ah-st-empty">{{ t('task.log.loading') }}</div>
              </div>
              <!-- 命令失败（真正的异常；可分类的「读不到」走下面的 reason） -->
              <div v-else-if="logError" class="ah-card ah-lg-events" data-testid="task-log-error">
                <div class="ah-st-empty">{{ logError }}</div>
              </div>
              <!-- 分类原因：没 CLI 会话 id / 未索引 / 读不出来，各给对应出路 -->
              <div
                v-else-if="logDetail && logDetail.reason"
                class="ah-card ah-lg-events"
                data-testid="task-log-reason"
              >
                <div class="ah-st-empty">
                  <p>{{ reasonText }}</p>
                  <p
                    v-if="logDetail.reason === 'not-indexed'"
                    class="text-xs text-[var(--text-tertiary)] mt-2"
                  >
                    {{ t('task.log.notIndexedHint') }}
                  </p>
                  <div
                    v-if="logDetail.reason === 'not-indexed'"
                    class="flex items-center gap-2 mt-3"
                  >
                    <button
                      type="button"
                      class="ah-btn ah-btn-primary ah-btn-sm"
                      :disabled="usageScanning"
                      data-testid="task-log-scan"
                      @click="scanUsageAndRetry"
                    >
                      {{ usageScanning ? t('task.log.scanning') : t('task.log.scan') }}
                    </button>
                    <button
                      type="button"
                      class="ah-btn ah-btn-ghost ah-btn-sm"
                      :disabled="usageScanning"
                      data-testid="task-log-retry"
                      @click="loadTaskLog"
                    >
                      {{ t('task.log.retry') }}
                    </button>
                  </div>
                </div>
              </div>
              <!-- 转写内容面（任务记录 / 原始 JSONL）：与 Agent 管理日志详情共用 -->
              <SessionTranscript
                v-else-if="logDetail?.log"
                :session-key="openedTask.id"
                :tab="logTab"
                :events="logDetail.log.events"
                :raw="logDetail.log.raw"
                :empty-text="t('hub.lg.noEvents')"
                :no-raw-text="t('hub.lg.noRaw')"
                @update:tab="logTab = $event"
              />
            </div>
          </template>
        </div>

        <!-- Tab3 定时任务 -->
        <div
          v-else-if="activeTab === 'scheduled'"
          class="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          data-testid="tasks-panel-scheduled"
        >
          <!-- 新建/收起 -->
          <button
            class="w-full h-8 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-primary-contrast)] text-xs font-medium transition-opacity duration-200 hover:opacity-90"
            @click="showForm = !showForm"
          >
            {{ showForm ? t('task.cancel') : t('task.scheduledNew') }}
          </button>

          <!-- 新建表单 -->
          <div
            v-if="showForm"
            class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2.5"
          >
            <div>
              <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                t('task.scheduledName')
              }}</label>
              <input v-model="formName" type="text" :class="controlCls" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                  t('task.scheduledProject')
                }}</label>
                <Select
                  v-model="formProjectId"
                  :options="projectOptions"
                  size="sm"
                  data-testid="task-scheduled-project"
                  @open="onTargetSelectFocus"
                  @update:model-value="formAgentId = ''"
                />
              </div>
              <div>
                <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                  t('task.scheduledAgent')
                }}</label>
                <Select
                  v-model="formAgentId"
                  :options="formAgentOptions"
                  size="sm"
                  :disabled="!formProjectId"
                  data-testid="task-scheduled-agent"
                  @open="onTargetSelectFocus"
                />
              </div>
            </div>
            <p
              v-if="formTarget && !formTarget.active_session_id"
              class="text-[calc(11px*var(--ui-scale))] text-[var(--color-warning-ink)]"
            >
              {{ t('task.scheduledAutoStartHint') }}
            </p>
            <div>
              <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                t('task.scheduledTriggerAt')
              }}</label>
              <Datepicker
                v-model="formTriggerAt"
                :format="dateFormat"
                :locale="dateLocale"
                :dark="isDark"
                :clearable="true"
                :enable-time-picker="true"
                :select-text="dpSelectText"
                :cancel-text="dpCancelText"
                :now-button-label="dpNowLabel"
                :teleport="'body'"
                :placeholder="t('task.scheduledTriggerAt')"
              />
              <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mt-1">
                {{ t('task.scheduledUtcHint', { time: utcPreview }) }}
              </p>
            </div>
            <div>
              <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                t('task.scheduledPrompts')
              }}</label>
              <!-- 任务卡片：一条任务一个卡片，支持逐条删除（与队列弹窗交互一致） -->
              <div v-if="formPrompts.length > 0" class="space-y-1 mb-2">
                <div
                  v-for="(p, idx) in formPrompts"
                  :key="idx"
                  class="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-hover)]"
                >
                  <span class="text-xs text-[var(--text-tertiary)] w-5 text-right flex-shrink-0"
                    >#{{ idx + 1 }}</span
                  >
                  <span class="flex-1 min-w-0 text-sm text-[var(--text-primary)] break-words">{{
                    p
                  }}</span>
                  <button
                    class="flex-shrink-0 w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-light)] transition-colors duration-200"
                    :title="t('task.delete')"
                    @click="removePrompt(idx)"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <!-- 添加任务：输入后回车或点击按钮生成一张卡片（自动增高，最多 10 行） -->
              <div class="flex items-end gap-1.5">
                <textarea
                  :ref="(el) => (newPromptEl = el as HTMLTextAreaElement | null)"
                  v-model="newPrompt"
                  rows="1"
                  :class="textareaCls"
                  :placeholder="t('task.scheduledPromptPlaceholder')"
                  @input="autosizeTextarea($event.target)"
                  @keydown="submitOnEnter(addPrompt)($event)"
                />
                <button
                  class="flex-shrink-0 h-8 px-3 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-primary-contrast)] text-xs font-medium transition-opacity duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="!newPrompt.trim()"
                  @click="addPrompt"
                >
                  {{ t('task.add') }}
                </button>
              </div>
              <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mt-1">
                {{ t('task.scheduledPromptsHint') }}
              </p>
            </div>
            <button
              class="w-full h-8 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-primary-contrast)] text-xs font-medium transition-opacity duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="creatingJob"
              @click="submitJob"
            >
              {{ t('task.scheduledCreate') }}
            </button>
          </div>

          <!-- 错误提示 -->
          <div
            v-if="errorMessage"
            class="rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-light)] px-3 py-2 text-xs text-[var(--color-danger-ink)] break-words"
          >
            {{ errorMessage }}
          </div>

          <!-- 空状态 -->
          <div
            v-if="!jobsLoading && jobs.length === 0"
            class="flex flex-col items-center justify-center py-12"
          >
            <svg
              class="w-12 h-12 text-[var(--text-tertiary)] mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p class="text-sm text-[var(--text-tertiary)]">{{ t('task.scheduledEmpty') }}</p>
            <p class="text-xs text-[var(--text-tertiary)] mt-1">
              {{ t('task.scheduledEmptyHint') }}
            </p>
          </div>

          <!-- 任务列表：进行中在前，历史在后（单循环 + 区段头） -->
          <div v-else class="space-y-2">
            <template
              v-for="item in renderedJobItems"
              :key="item.header ? `header-${item.group}` : item.job?.id"
            >
              <!-- 区段头：进行中（纯文本）；历史（可折叠 + 一键清空执行档案） -->
              <div v-if="item.header" class="flex items-center justify-between px-1 pt-1">
                <button
                  v-if="item.group === 'finished'"
                  class="inline-flex items-center gap-1 h-6 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-200"
                  @click="finishedCollapsed = !finishedCollapsed"
                >
                  <svg
                    class="w-3.5 h-3.5 transition-transform duration-200"
                    :class="{ 'rotate-90': !finishedCollapsed }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  {{ t('task.scheduledSectionFinished') }} ({{ finishedJobs.length }})
                </button>
                <span
                  v-else
                  class="inline-flex items-center h-6 text-xs font-medium text-[var(--text-secondary)]"
                >
                  {{ t('task.scheduledSectionActive') }} ({{ activeJobs.length }})
                </span>
                <button
                  v-if="item.group === 'finished' && executedCount > 0"
                  class="inline-flex items-center gap-1 h-6 px-2 rounded-[6px] text-xs text-[var(--text-tertiary)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-light)] transition-colors duration-200"
                  :title="t('task.scheduledClearFinished')"
                  @click="clearFinished"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  {{ t('task.scheduledClearFinished') }}
                </button>
              </div>

              <!-- 任务卡片 -->
              <div v-else class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div class="flex items-start gap-2">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-[var(--text-primary)] font-medium truncate">
                      {{ item.job?.name || '-' }}
                    </p>
                    <p class="text-xs text-[var(--text-secondary)] mt-0.5">
                      {{ t('task.scheduledTriggerAt') }}:
                      {{ formatTime(item.job?.trigger_at ?? null) }}
                    </p>
                    <p class="text-xs text-[var(--text-secondary)] mt-0.5">
                      {{ t('task.scheduledTarget') }}:
                      {{ item.job ? jobTargetLabel(item.job) : '-' }}
                    </p>
                  </div>
                  <span class="flex-shrink-0" :class="scheduledStatusBadge(item.job?.status ?? '')">
                    {{ scheduledStatusLabel[item.job?.status ?? ''] || item.job?.status }}
                  </span>
                </div>
                <div v-if="item.job?.prompts.length" class="mt-2 space-y-0.5">
                  <p
                    v-for="(p, idx) in item.job?.prompts"
                    :key="idx"
                    class="text-xs text-[var(--text-secondary)] truncate"
                  >
                    {{ idx + 1 }}. {{ p }}
                  </p>
                </div>
                <p
                  v-if="item.job?.error"
                  class="text-xs text-[var(--color-danger-ink)] mt-1.5 break-words"
                >
                  {{ t('task.scheduledError') }}
                </p>

                <!-- 操作区：pending 可删除；missed/failed 可删除或重新设置（重置回 pending 重新调度）；executed 可删除（清档） -->
                <div
                  v-if="
                    ['pending', 'missed', 'failed', 'executed'].includes(item.job?.status ?? '')
                  "
                  class="flex justify-end gap-1 mt-2"
                >
                  <button
                    v-if="
                      item.job && item.job?.status !== 'pending' && item.job?.status !== 'executed'
                    "
                    class="inline-flex items-center gap-1 h-6 px-2 rounded-[6px] text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors duration-200"
                    :title="t('task.scheduledReset')"
                    @click="item.job && startReset(item.job)"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 4v5h5M20 20v-5h-5M4.1 9a8 8 0 0115.4-1M19.9 15a8 8 0 01-15.4 1"
                      />
                    </svg>
                    {{ t('task.scheduledReset') }}
                  </button>
                  <button
                    class="inline-flex items-center gap-1 h-6 px-2 rounded-[6px] text-xs text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-light)] transition-colors duration-200"
                    :title="t('task.delete')"
                    @click="deleteJob(item.job?.id ?? '')"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    {{ t('task.delete') }}
                  </button>
                </div>

                <!-- 重新设置面板：选择新触发时间（默认当前时间），确认后回到 pending 重新调度 -->
                <div
                  v-if="resettingId === item.job?.id"
                  class="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] p-2.5 space-y-2"
                >
                  <div>
                    <label class="block text-xs text-[var(--text-secondary)] mb-1">{{
                      t('task.scheduledTriggerAt')
                    }}</label>
                    <Datepicker
                      v-model="resetTriggerAt"
                      :format="dateFormat"
                      :locale="dateLocale"
                      :dark="isDark"
                      :clearable="false"
                      :enable-time-picker="true"
                      :select-text="dpSelectText"
                      :cancel-text="dpCancelText"
                      :now-button-label="dpNowLabel"
                      :teleport="'body'"
                      :placeholder="t('task.scheduledTriggerAt')"
                    />
                    <p class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)] mt-1">
                      {{ t('task.scheduledResetHint') }}
                      {{ t('task.scheduledUtcHint', { time: resetUtcPreview }) }}
                    </p>
                  </div>
                  <div class="flex gap-1.5">
                    <button
                      class="flex-1 h-7 rounded-[6px] bg-[var(--color-primary)] text-[var(--color-primary-contrast)] text-xs font-medium transition-opacity duration-200 hover:opacity-90"
                      @click="resetJob(item.job?.id)"
                    >
                      {{ t('task.confirm') }}
                    </button>
                    <button
                      class="flex-1 h-7 rounded-[6px] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors duration-200"
                      @click="cancelReset"
                    >
                      {{ t('task.cancel') }}
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Tab4 统计 -->
        <div v-else class="flex-1 overflow-y-auto px-4 py-3" data-testid="tasks-panel-stats">
          <!-- 加载中 -->
          <div v-if="!stats" class="flex justify-center py-8">
            <span class="text-sm text-[var(--text-tertiary)]">{{ t('task.loading') }}</span>
          </div>

          <!-- 统计卡片 -->
          <div v-else class="space-y-3">
            <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-[var(--text-secondary)]">{{
                  t('task.statsTitle')
                }}</span>
                <span class="text-sm font-semibold text-[var(--text-primary)]"
                  >{{ t('task.statsTotal') }}: {{ stats.total }}</span
                >
              </div>

              <!-- 状态分布 -->
              <div v-if="statusStatsList.length" class="flex flex-wrap gap-1.5 mt-2">
                <span
                  v-for="s in statusStatsList"
                  :key="s.key"
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[calc(11px*var(--ui-scale))] bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :class="statusDot[s.key]"></span>
                  {{ s.label }} {{ s.count }}
                </span>
              </div>
              <div v-else class="text-xs text-[var(--text-tertiary)] mt-2">-</div>

              <!-- 核心指标 -->
              <div class="grid grid-cols-2 gap-2 mt-3">
                <div class="rounded-md bg-[var(--bg-hover)] px-3 py-2">
                  <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
                    {{ t('task.statsCompleted') }}
                  </div>
                  <div class="text-base font-semibold text-[var(--text-primary)] mt-0.5">
                    {{ stats.completed }}
                  </div>
                </div>
                <div class="rounded-md bg-[var(--bg-hover)] px-3 py-2">
                  <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
                    {{ t('task.statsTerminal') }}
                  </div>
                  <div class="text-base font-semibold text-[var(--text-primary)] mt-0.5">
                    {{ stats.terminal }}
                  </div>
                </div>
                <div class="rounded-md bg-[var(--bg-hover)] px-3 py-2">
                  <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
                    {{ t('task.statsSuccessRate') }}
                  </div>
                  <div class="text-base font-semibold text-[var(--text-primary)] mt-0.5">
                    {{ formatPercent(stats.success_rate) }}
                  </div>
                </div>
                <div class="rounded-md bg-[var(--bg-hover)] px-3 py-2">
                  <div class="text-[calc(11px*var(--ui-scale))] text-[var(--text-tertiary)]">
                    {{ t('task.statsAvgDuration') }}
                  </div>
                  <div class="text-base font-semibold text-[var(--text-primary)] mt-0.5">
                    {{ formatDuration(stats.avg_duration_seconds) }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 无数据提示 -->
            <div v-if="stats.total === 0" class="flex flex-col items-center justify-center py-10">
              <svg
                class="w-12 h-12 text-[var(--text-tertiary)] mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055zM20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                />
              </svg>
              <p class="text-sm text-[var(--text-tertiary)]">{{ t('task.emptyHistory') }}</p>
              <p class="text-xs text-[var(--text-tertiary)] mt-1">
                {{ t('task.emptyHistoryHint') }}
              </p>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 恢复会话弹窗（Teleport 到 body；复用 Agent 管理的恢复链） -->
    <ResumeSessionDialog :resume="resume" @resumed="emitResumed" />
  </div>
</template>

<style scoped>
/*
 * Tab 切换过渡已收归宿主页面过渡体系（src/style.css 的 .page-* / .page-swap）：
 * 名字恒为 `page`，时长/缓动/位移幅度走 --motion-page-* token，效果变体由
 * <html data-page-fx> 选（全端唯一切换点 = 宿主 src/utils/pageTransition.ts）。
 * 本文件不再自带 .tab-fade-* —— 原先此处与 SessionCenterView / DeviceCenterView
 * 同名不同参（进场 0.26s + scale(0.985) vs 0.16s + 4px），同一应用内切 Tab 手感
 * 都不一致，正是「同一份页面过渡散落多处必然漂移」的实例。
 */
/*
 * 加载浮层淡入淡出
 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/*
 * 任务日志翻页/筛选切换：逐条从左向右横移插入。
 * 旧项不定义 leave 过渡（瞬时移除，避免与新项重叠造成跳动），
 * 仅新项按索引错峰（--enter-delay）从左侧 translateX 滑入并淡入。
 * 仅动画 opacity + transform（GPU 友好），不触发布局属性变更。
 */
.task-list-leave-active {
  display: none;
}
.task-list-enter-active {
  transition:
    opacity 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1);
  transition-delay: var(--enter-delay, 0ms);
  will-change: opacity, transform;
}
.task-list-enter-from {
  opacity: 0;
  transform: translateX(-16px);
}
</style>
