/**
 * 编排命令面 wire 形状（DESIGN §7.13）
 *
 * 与 Rust `orchestration::service` 的 JSON 输出逐字段对齐；前端不推导状态迁移，
 * 按钮可用性只读 `actions`。
 */
import type { AgentSnapshot, Plan, PlanError, PlanMode } from '@/utils/orchestrationPlan'

export type OrchestrationStatus =
  | 'draft'
  | 'planning'
  | 'awaiting-approval'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'budget-exhausted'

export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'dispatching'
  | 'running'
  | 'awaiting-input'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'blocked'

export type ActionKind =
  | 'approve'
  | 'start'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'retry-node'
  | 'skip-node'
  | 'replan'
  | 'edit-plan'

export interface ActionView {
  kind: ActionKind
  enabled: boolean
  reason: string | null
}

export interface NodeActionsView {
  nodeKey: string
  actions: ActionView[]
}

export interface ActionsView {
  orchestration: ActionView[]
  nodes: NodeActionsView[]
}

export interface AgentOption {
  id: string
  displayName: string
  ready: boolean
}

export interface MetaView {
  statuses: string[]
  nodeStatuses: string[]
  roles: string[]
  acceptanceTypes: string[]
  reasonCodes: string[]
  planErrorCodes: string[]
  eventKinds: string[]
  agents: AgentOption[]
  /** Agent 池（编排选人的唯一候选集） */
  agentProfiles: AgentProfileView[]
}

export interface ListItemView {
  id: string
  projectId: string
  projectName: string
  title: string
  mode: PlanMode
  status: OrchestrationStatus
  nodeCount: number
  succeededCount: number
  failedCount: number
  runningCount: number
  agents: string[]
  updatedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface NodeView {
  key: string
  title: string
  role: string
  /** 执行载体 CLI（图标 / 兼容面） */
  agentId: string
  /** 池成员 id */
  agentRef: string
  /** 派发快照 */
  agent: AgentSnapshot | null
  matchReason: string
  status: NodeStatus
  attempt: number
  maxAttempts: number
  dependsOn: string[]
  writeScope: string[]
  acceptance: Plan['nodes'][number]['acceptance']
  runId: string | null
  retryable: boolean
  failureReason: string | null
  dispatchedAt: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface EvidenceView {
  nodeKey: string
  attempt: number
  kind: 'diff' | 'command' | 'verdict' | 'note'
  payload: Record<string, unknown>
  at: string
}

export interface OrchestrationView {
  orchestration: {
    id: string
    projectId: string
    projectName: string
    title: string
    goal: string
    mode: PlanMode
    requireApproval: boolean
    orchestratorAgentId: string | null
    status: OrchestrationStatus
    planRev: number
    approved: boolean
    maxParallel: number
    budget: { maxWallSeconds: number; maxDispatches: number }
    plannerRunId: string | null
    plannerAgent: AgentSnapshot | null
    planError: PlanError[] | null
    plannerOutput: string | null
    failureReason: string | null
    createdAt: string
    updatedAt: string
    startedAt: string | null
    endedAt: string | null
  }
  plan: Plan | null
  nodes: NodeView[]
  actions: ActionsView
  evidence: EvidenceView[]
  eventSeq: number
}

export interface EventView {
  seq: number
  kind: string
  nodeKey: string | null
  attempt: number | null
  payload: Record<string, unknown>
  at: string
}

export interface EventsResponse {
  events: EventView[]
  nextSeq: number
}

export type OrchestrationStatusColor = 'neutral' | 'info' | 'success' | 'warn' | 'danger' | 'active'

/** 状态 → 视觉档（token class 的唯一映射；未知状态显式标 neutral 而不是崩溃） */
export const STATUS_TONE: Record<string, OrchestrationStatusColor> = {
  draft: 'neutral',
  planning: 'info',
  'awaiting-approval': 'warn',
  running: 'active',
  pausing: 'warn',
  paused: 'warn',
  cancelling: 'warn',
  cancelled: 'neutral',
  completed: 'success',
  failed: 'danger',
  'budget-exhausted': 'danger',
  pending: 'neutral',
  ready: 'info',
  dispatching: 'info',
  'awaiting-input': 'warn',
  verifying: 'info',
  succeeded: 'success',
  skipped: 'neutral',
  blocked: 'warn',
}

export function statusTone(status: string): OrchestrationStatusColor {
  return STATUS_TONE[status] ?? 'neutral'
}

/** 终态判据（列表刷新 / 轮询停止共用） */
export function isTerminalStatus(status: string): boolean {
  return ['cancelled', 'completed', 'failed', 'budget-exhausted'].includes(status)
}

// ==================== Agent 池（编排选人） ====================

/** 池成员：CLI + 模型/思考等级 + 编排匹配语义 */
export interface AgentProfile {
  id: string
  name: string
  cli: string
  model: string | null
  thinkingLevel: string | null
  tags: string[]
  specialties: string[]
  description: string
  canOrchestrate: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 列表视图：池成员 + CLI 就绪态 */
export interface AgentProfileView extends AgentProfile {
  ready: boolean
}

/** 创建 / 更新输入（id 与时间戳由后端持有） */
export interface AgentProfileInput {
  name: string
  cli: string
  model?: string | null
  thinkingLevel?: string | null
  tags: string[]
  specialties: string[]
  description: string
  canOrchestrate: boolean
  enabled: boolean
}

/** `agent.profile.options`：无运行时的模型 / 思考等级能力 */
export interface AgentProfileOptions {
  cli: string
  installed: boolean
  bridgeCapable: boolean
  models: { value: string; label: string; source: string }[]
  thinkingLevels: string[]
}
