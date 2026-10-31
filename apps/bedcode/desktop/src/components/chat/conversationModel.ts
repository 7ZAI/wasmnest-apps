/**
 * 对话面渲染模型（纯函数：账本事件 → 行模型，ADR 0004 / issue #23 M3）
 *
 * 输入是 `run.events` 的归一事件（12 类 kind），输出是对话面可直接渲染的行
 * 序列与两条派生状态。展示规则全部落在模型里，组件只做渲染——Seam 3 的
 * 行为断言因此可以不挂组件直接打在模型上。
 *
 * 三条合并规则（与后端账本语义对齐，`run/events/mod.rs` 模块头）：
 * - **行身份稳定**：行的 key 与位置由「第一次出现」的事件决定；同 seq 的
 *   原地更新（流式正文 / 工具进度）刷新行内容但不移动、不新增行。
 * - **工具状态机**：`tool.call`（pending/running）与 `tool.result` 按 `callId`
 *   合并成一张卡，状态 pending→running→done/error；result 先到（镜像乱序）
 *   就先落一张已完成卡，后到的 call 补头不回退状态。
 * - **meta 槽**：`session.meta` 在账本里是三个身份（meta:session / meta:model
 *   / meta:usage），各带自己知道的字段——按 seq 顺序逐字段合并，null/空串
 *   不覆盖已有值（半截 meta 不得覆盖完整 meta）。
 *
 * `status` 与 `session.meta` 不是对话行：前者驱动执行状态指示（最新一条），
 * 后者汇入头部 meta；其余 kind 各成一行，未知 kind 丢弃（后端已计数，
 * 前端不再渲染占位）。
 */
import { renderMarkdown } from '@/agents/utils/markdown'

/** 账本事件（与 `useRunEvents.RunEvent` 同形；此处不 import 以保持本模块零依赖） */
export interface LedgerEvent {
  seq: number
  at: string
  kind: string
  payload: Record<string, unknown>
  source: string
}

/** 工具卡状态（pending→running→done/error） */
export type ToolCardState = 'pending' | 'running' | 'done' | 'error'

/** agent 执行状态（`status` 事件；界面据此显示指示，不进时间线） */
export type AgentRunState = 'idle' | 'busy' | 'retrying' | 'error'

export interface PlanItem {
  text: string
  status: string
}

export interface ToolRow {
  type: 'tool'
  key: string
  seq: number
  at: string
  callId: string
  name: string
  args: Record<string, unknown> | null
  state: ToolCardState
  output: string
  error: string
  exitCode: number | null
  source: string
}

export interface PermissionRow {
  type: 'permission'
  key: string
  seq: number
  at: string
  requestId: string
  tool: string
  input: unknown
  /** 已回执的决定（null = 仍在等待；M3 只读展示，不提供按钮） */
  decision: string | null
  decidedBy: string | null
  source: string
}

export type ConversationRow =
  | { type: 'user'; key: string; seq: number; at: string; text: string; source: string }
  | {
      type: 'text'
      key: string
      seq: number
      at: string
      text: string
      html: string
      streaming: boolean
      source: string
    }
  | {
      type: 'thinking'
      key: string
      seq: number
      at: string
      text: string
      redacted: boolean
      source: string
    }
  | ToolRow
  | { type: 'patch'; key: string; seq: number; at: string; files: string[]; diff: string; source: string }
  | { type: 'plan'; key: string; seq: number; at: string; items: PlanItem[]; source: string }
  | PermissionRow
  | { type: 'error'; key: string; seq: number; at: string; code: string; message: string; source: string }

export interface ConversationMeta {
  agentSessionId: string | null
  title: string | null
  model: string | null
  tokens: Record<string, number | null> | null
}

export interface ConversationModel {
  rows: ConversationRow[]
  agentState: AgentRunState | null
  meta: ConversationMeta
}

// ==================== payload 取值（形状不对就给安全缺省，不抛） ====================

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parsePlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asObject(item)
      if (!record) return null
      const text = asString(record.text)
      if (!text) return null
      return { text, status: asString(record.status, 'pending') }
    })
    .filter((item): item is PlanItem => item !== null)
}

// ==================== markdown 渲染（带界缓存） ====================

/**
 * 流式正文每秒整段重渲，但历史行的文本不再变——按文本做记忆化，一次解析
 * 到处复用。上限 2000 条：超出整表清空（对话面单屏活跃行远小于该量级，
 * 清空只发生在超长会话的冷启动附近，代价可忽略）。
 */
const markdownCache = new Map<string, string>()
const MARKDOWN_CACHE_CAP = 2000

export function renderAssistantMarkdown(text: string): string {
  const cached = markdownCache.get(text)
  if (cached !== undefined) return cached
  const html = renderMarkdown(text)
  if (markdownCache.size >= MARKDOWN_CACHE_CAP) markdownCache.clear()
  markdownCache.set(text, html)
  return html
}

// ==================== 行构建 ====================

interface BuildContext {
  rows: ConversationRow[]
  /** callId → 工具行下标（状态机归并） */
  toolsByCallId: Map<string, number>
  /** requestId → 权限行下标（回执归并） */
  permissionsByRequestId: Map<string, number>
}

function upsertToolRow(context: BuildContext, event: LedgerEvent, payload: Record<string, unknown>): void {
  const callId = asString(payload.callId)
  if (!callId) return
  const state = asString(payload.status) === 'running' ? 'running' : 'pending'
  const existingIndex = context.toolsByCallId.get(callId)
  if (existingIndex === undefined) {
    context.toolsByCallId.set(callId, context.rows.length)
    context.rows.push({
      type: 'tool',
      key: `tool:${callId}`,
      seq: event.seq,
      at: event.at,
      callId,
      name: asString(payload.name, callId),
      args: asObject(payload.args),
      state,
      output: '',
      error: '',
      exitCode: null,
      source: event.source,
    })
    return
  }
  const row = context.rows[existingIndex]
  if (row.type !== 'tool') return
  // call 补头不回退状态：result 先到（镜像乱序）时已完成卡不该被打回 pending
  if (row.seq > event.seq || row.state === 'done' || row.state === 'error') return
  const name = asString(payload.name)
  if (name) row.name = name
  const args = asObject(payload.args)
  if (args) row.args = args
  row.state = state
}

function applyToolResult(context: BuildContext, event: LedgerEvent, payload: Record<string, unknown>): void {
  const callId = asString(payload.callId)
  if (!callId) return
  const error = asString(payload.error)
  const existingIndex = context.toolsByCallId.get(callId)
  if (existingIndex === undefined) {
    context.toolsByCallId.set(callId, context.rows.length)
    context.rows.push({
      type: 'tool',
      key: `tool:${callId}`,
      seq: event.seq,
      at: event.at,
      callId,
      name: callId,
      args: null,
      state: error ? 'error' : 'done',
      output: asString(payload.output),
      error,
      exitCode: asNumber(payload.exitCode),
      source: event.source,
    })
    return
  }
  const row = context.rows[existingIndex]
  if (row.type !== 'tool') return
  row.state = error ? 'error' : 'done'
  row.output = asString(payload.output)
  row.error = error
  row.exitCode = asNumber(payload.exitCode)
  row.source = event.source
}

function upsertPermissionRow(
  context: BuildContext,
  event: LedgerEvent,
  payload: Record<string, unknown>,
): void {
  const requestId = asString(payload.requestId)
  if (!requestId) return
  const existingIndex = context.permissionsByRequestId.get(requestId)
  if (existingIndex === undefined) {
    context.permissionsByRequestId.set(requestId, context.rows.length)
    // 回执先于请求（镜像乱序）时由本行自建：决定字段直接带上，不丢
    const decision = asString(payload.decision)
    context.rows.push({
      type: 'permission',
      key: `perm:${requestId}`,
      seq: event.seq,
      at: event.at,
      requestId,
      tool: asString(payload.tool),
      input: payload.input ?? null,
      decision: decision || null,
      decidedBy: decision ? asString(payload.by) || null : null,
      source: event.source,
    })
    return
  }
  const row = context.rows[existingIndex]
  if (row.type !== 'permission') return
  const decision = asString(payload.decision)
  if (decision) {
    row.decision = decision
    row.decidedBy = asString(payload.by) || null
  }
}

/** meta 逐字段合并：null / 空串 / 缺失不覆盖（半截快照不得覆盖完整 meta） */
function mergeMeta(current: ConversationMeta, payload: Record<string, unknown>): void {
  const agentSessionId = asString(payload.agentSessionId)
  if (agentSessionId) current.agentSessionId = agentSessionId
  const title = asString(payload.title)
  if (title) current.title = title
  const model = asString(payload.model)
  if (model) current.model = model
  const tokens = asObject(payload.tokens)
  if (tokens) {
    const merged: Record<string, number | null> = { ...(current.tokens ?? {}) }
    for (const [key, value] of Object.entries(tokens)) {
      const number = asNumber(value)
      if (number !== null) merged[key] = number
    }
    current.tokens = merged
  }
}

/**
 * 账本事件 → 对话面模型（按 seq 升序消费；输入顺序不保证时调用方先排好）
 *
 * 行的位置取「首次出现」的 seq（工具结果 / 权限回执不挪动已有行）；
 * `status` / `session.meta` 不产生行，分别汇入 agentState 与 meta。
 */
export function buildConversation(events: LedgerEvent[]): ConversationModel {
  const context: BuildContext = {
    rows: [],
    toolsByCallId: new Map(),
    permissionsByRequestId: new Map(),
  }
  const meta: ConversationMeta = {
    agentSessionId: null,
    title: null,
    model: null,
    tokens: null,
  }
  let agentState: AgentRunState | null = null

  for (const event of events) {
    const payload = asObject(event.payload) ?? {}
    switch (event.kind) {
      case 'user.message': {
        const text = asString(payload.text)
        if (!text.trim()) break
        context.rows.push({
          type: 'user',
          key: `user:${event.seq}`,
          seq: event.seq,
          at: event.at,
          text,
          source: event.source,
        })
        break
      }
      case 'assistant.text': {
        const text = asString(payload.text)
        if (!text.trim()) break
        context.rows.push({
          type: 'text',
          key: `text:${event.seq}`,
          seq: event.seq,
          at: event.at,
          text,
          html: renderAssistantMarkdown(text),
          streaming: payload.streaming === true,
          source: event.source,
        })
        break
      }
      case 'assistant.thinking': {
        const text = asString(payload.text)
        if (!text.trim()) break
        context.rows.push({
          type: 'thinking',
          key: `thinking:${event.seq}`,
          seq: event.seq,
          at: event.at,
          text,
          redacted: payload.redacted === true,
          source: event.source,
        })
        break
      }
      case 'tool.call':
        upsertToolRow(context, event, payload)
        break
      case 'tool.result':
        applyToolResult(context, event, payload)
        break
      case 'patch': {
        const files = Array.isArray(payload.files)
          ? payload.files.filter((file): file is string => typeof file === 'string' && !!file)
          : []
        const diff = asString(payload.diff)
        if (files.length === 0 && !diff.trim()) break
        context.rows.push({
          type: 'patch',
          key: `patch:${event.seq}`,
          seq: event.seq,
          at: event.at,
          files,
          diff,
          source: event.source,
        })
        break
      }
      case 'plan': {
        const items = parsePlanItems(payload.items)
        if (items.length === 0) break
        context.rows.push({
          type: 'plan',
          key: `plan:${event.seq}`,
          seq: event.seq,
          at: event.at,
          items,
          source: event.source,
        })
        break
      }
      case 'permission.request':
        upsertPermissionRow(context, event, payload)
        break
      case 'permission.replied': {
        // 回执可能先于请求行到达（镜像乱序）：照常落行，请求后到时归并补全
        upsertPermissionRow(context, event, payload)
        break
      }
      case 'error': {
        const message = asString(payload.message) || asString(payload.code)
        if (!message) break
        context.rows.push({
          type: 'error',
          key: `error:${event.seq}`,
          seq: event.seq,
          at: event.at,
          code: asString(payload.code),
          message,
          source: event.source,
        })
        break
      }
      case 'status': {
        const state = asString(payload.state)
        if (state === 'idle' || state === 'busy' || state === 'retrying' || state === 'error') {
          agentState = state
        }
        break
      }
      case 'session.meta':
        mergeMeta(meta, payload)
        break
      default:
        // 未知 kind：后端已丢弃计数，这里不渲染占位
        break
    }
  }

  return { rows: context.rows, agentState, meta }
}
