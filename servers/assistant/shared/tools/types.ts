/**
 * 工具运行时类型（票 13 / spec §3.3、§5.6、§5.9）
 *
 * 工具目录由「声明式描述符」驱动：`AgentTool.parameters` 直接使用声明方
 * 给出的 JSON Schema；`execute` 走本应用命令或 `apps.invoke`（桥）。
 * 确认与审计状态由 ToolRuntime 持有，UI 只读状态 + 回决定。
 */
import type { AgentTool, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { AppInvokeBridge } from '../types'
import type { Risk } from './risk'

/** 本地执行器结果：text 为模型可读结果，error 非空表示失败 */
export interface ExecutorResult {
  text?: string
  error?: string
}

/** 工具描述符（共享核侧形状，与平台 SDK 的 AssistantToolDescriptor 同构）。
 *
 * 本地工具（time / system / memory）用 `executor` 直接执行；应用工具
 * （app.invoke.* / monitor.*）用 `appToolId` 声明目标，运行时经
 * `apps.invoke` 调桥（风险按目标应用声明，spec §5.6）。
 */
export interface ToolDescriptor {
  /** pi 工具名（模型可见；应用工具为 `app.invoke.<toolId>`） */
  name: string
  /** UI 显示名 */
  label: string
  description: string
  /** 参数 JSON Schema（object；与 pi AgentTool.parameters 同形） */
  argsSchema: Record<string, unknown>
  risk: Risk
  /** 本地执行器（内存 / 时间 / 系统信息等）；error 非空 = 执行失败 */
  executor?: (args: unknown, signal?: AbortSignal) => Promise<ExecutorResult>
  /** 应用侧工具 id（app.invoke.<toolId> 的目标；executor 缺省时必填） */
  appToolId?: string
  /** 目标应用 id（审计与卡片展示用） */
  appId?: string
  /** 危险操作的影响范围说明（danger 二次确认时展示） */
  impact?: string
}

/** 确认请求（write / danger 暂停时发给 UI；运行时自持挂起，UI 只回决定） */
export interface ConfirmationRequest {
  /** 确认 id（UI 回决定的键） */
  id: string
  toolName: string
  label: string
  risk: Risk
  argsSummary: string
  /** danger 第二次确认展示的影响范围 */
  impact?: string
  /** 第几轮确认（danger = 2） */
  stage: 1 | 2
}

export type ConfirmationDecision = 'approve' | 'reject'

/** 工具调用卡片（UI 状态，随会话持有） */
export interface ToolCardState {
  id: string
  name: string
  label: string
  risk: Risk
  appId?: string
  argsSummary: string
  state: 'running' | 'awaiting' | 'done' | 'error' | 'rejected' | 'stopped'
  resultSummary?: string
  errorMessage?: string
  /** 待确认（write 一轮 / danger 两轮） */
  confirmation?: { stage: 1 | 2; impact?: string }
}

/** 确认提供方：UI 决定 write / danger 的放行（急停时由会话以 reject 结算） */
export type ConfirmationProvider = (req: ConfirmationRequest) => Promise<ConfirmationDecision>

export interface ToolRuntimeDeps {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  /** 应用调用桥（未注入 = 无应用工具能力，调用显性降级） */
  apps?: AppInvokeBridge | null
  /** 助手侧风险策略（只升不降；缺省 = 按声明） */
  policyRisk?: Risk
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** 运行时装配产物 */
export interface ToolRuntimeHandle {
  /** 当前 AgentTool 列表（随目录刷新重建） */
  tools: AgentTool<any>[]
  /** pi beforeToolCall 钩子（四档风险 + 确认 + 急停） */
  beforeToolCall: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>
  /** 按目录刷新工具列表（应用工具目录变化时） */
  refresh: () => void
  /** 注册 / 替换一个工具描述符（按 name 去重） */
  register: (descriptor: ToolDescriptor) => void
  /** 用一组描述符整体替换目录（应用工具目录刷新用） */
  replaceCatalog: (descriptors: ToolDescriptor[]) => void
  /** 卡片状态（UI 只读） */
  cards: ToolCardState[]
  /** 当前待确认项（UI 渲染确认卡） */
  pendingConfirmations: Array<{ request: ConfirmationRequest; card: ToolCardState }>
  /** UI 回决定 */
  resolveConfirmation: (id: string, decision: ConfirmationDecision) => void
  /** 急停结算：把在途确认按拒绝结算（停止后不再执行队列中的工具） */
  abortPending: (reason: string) => void
  /** 重置运行态与卡片（换会话 / 销毁） */
  reset: () => void
}
