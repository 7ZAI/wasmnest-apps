/**
 * 工具运行时（票 13 / spec §5.6、§5.9）
 *
 * 把「工具声明」装配成 pi 的 `AgentTool`，并用 pi 的两个钩子实现确认与审计：
 *
 * - `beforeToolCall`（参数校验之后、执行之前）：决定档位、必要时停下来等用户
 *   确认；拒绝 / 急停**返回 block**（pi 把它转成 isError toolResult，模型能看懂，
 *   循环继续）；这里也负责「停止后队列中的工具不再执行」。
 * - `afterToolCall`（执行结束、事件发出之前）：写审计（摘要，不含原文）并更新
 *   工具卡；不覆盖工具结果。
 *
 * 风险只升不降：`effectiveRisk` 取「声明档」与「策略下限」的较大值；`ui` 档在
 * `uiRequireConfirm` 开启时提到 `write`。
 *
 * 已知边界：pi 在参数 schema 校验失败时**不会**进入 `beforeToolCall`，这类调用
 * 会由 pi 直接产出错误 toolResult（模型可见），但不会进审计——审计覆盖的是
 * 「通过校验、进入运行时」的调用。
 */
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import type { AssistantInvoke } from '../types'
import { auditDigest, recordAudit } from './audit'
import { TOOL_RESULT_TEXT_LIMIT } from './builtin'
import {
  RISK_ORDER,
  type ToolCallCard,
  type ToolConfirmRequest,
  type ToolDecision,
  type ToolPolicy,
  type ToolRisk,
  type ToolSpec,
} from './types'

/** 运行时依赖（UI 确认 / 卡片回调由会话实现，便于单测注入） */
export interface ToolRuntimeOptions {
  invoke: AssistantInvoke
  /** 等用户批准；danger 档会收到两次（stage 1 → stage 2） */
  confirm: (request: ToolConfirmRequest) => Promise<boolean>
  /** 工具卡更新（按 toolCallId 原地 upsert） */
  onCard: (card: ToolCallCard) => void
  policy?: ToolPolicy
  /** 审计写入失败：点名后继续对话（不静默吞） */
  onAuditError?: (message: string) => void
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  now?: () => number
  /** 摘要实现（测试注入；缺省 WebCrypto sha256） */
  digest?: (value: unknown) => Promise<string>
}

export interface ToolRuntime {
  /** 交给 pi 的工具定义（parameters 原样透传声明方 schema） */
  readonly tools: AgentTool<any>[]
  beforeToolCall: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>
  afterToolCall: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>
  /** 急停：拒绝等待中的确认，后续进入的工具一律 block（队列里的不再执行） */
  halt(): void
  /** 恢复（新会话 / 重新开始生成时） */
  reset(): void
  readonly stopped: boolean
}

/** 实际执行档：取声明档与策略下限的较高者（只升不降） */
export function effectiveRisk(declared: ToolRisk, floor?: ToolRisk): ToolRisk {
  if (!floor) return declared
  return RISK_ORDER[floor] > RISK_ORDER[declared] ? floor : declared
}

/** 需要中断确认的档位（read / ui 自动；write 一次；danger 两次） */
export function requiresConfirm(risk: ToolRisk): boolean {
  return risk === 'write' || risk === 'danger'
}

/** 工具结果转文本（字符串原样；其余 JSON 缩进；超限截断并明示） */
function resultText(value: unknown): string {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value ?? null, null, 2) ?? 'null'
    } catch {
      text = String(value)
    }
  }
  if (text.length <= TOOL_RESULT_TEXT_LIMIT) return text
  return `${text.slice(0, TOOL_RESULT_TEXT_LIMIT)}\n…（工具结果超过 ${TOOL_RESULT_TEXT_LIMIT} 字符，已截断）`
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 一次执行中的调用状态（before 记录，after 结算） */
interface CallState {
  spec: ToolSpec
  risk: ToolRisk
  argsDigest: string | null
}

/**
 * 创建工具运行时。
 *
 * @param specs 工具声明（本地工具 + 测试工具；应用工具归票 15 接入）
 */
export function createToolRuntime(specs: ToolSpec[], options: ToolRuntimeOptions): ToolRuntime {
  const byId = new Map(specs.map((s) => [s.id, s]))
  const calls = new Map<string, CallState>()
  const digest = options.digest ?? auditDigest
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})

  let stopped = false
  /** 等确认时急停的解锁器（halt 时置空并 resolve false） */
  let releasePendingConfirm: (() => void) | null = null

  /** 摘要失败不落假摘要：记 null 并点名 */
  async function safeDigest(value: unknown, what: string): Promise<string | null> {
    try {
      return await digest(value)
    } catch (e) {
      log('warn', `[nest] ${what}摘要计算失败，审计将记空摘要：${errMsg(e)}`)
      return null
    }
  }

  /** 写审计；失败点名但不打断对话 */
  async function writeAudit(input: {
    toolId: string
    appId: string | null
    command: string
    risk: ToolRisk
    decision: ToolDecision
    argsDigest: string | null
    resultDigest: string | null
  }): Promise<void> {
    try {
      await recordAudit(options.invoke, {
        ...input,
        userVisible: true,
        ts: String(now()),
      })
    } catch (e) {
      options.onAuditError?.(errMsg(e))
    }
  }

  function card(
    spec: ToolSpec,
    toolCallId: string,
    risk: ToolRisk,
    status: ToolCallCard['status'],
    extra: Partial<ToolCallCard> = {},
  ): ToolCallCard {
    return {
      toolCallId,
      toolId: spec.id,
      label: spec.label,
      appId: spec.appId,
      risk,
      status,
      notice: null,
      ...extra,
    }
  }

  /**
   * 等用户确认；急停 / abort 与确认竞速，任一先到即视为拒绝。
   * 返回 true 只代表「用户批准」，不代表工具执行成功。
   */
  async function confirmWithAbort(
    request: ToolConfirmRequest,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (stopped || signal?.aborted) return false
    const pending = new Promise<boolean>((resolve) => {
      releasePendingConfirm = () => resolve(false)
      Promise.resolve(options.confirm(request)).then(
        (approved) => {
          releasePendingConfirm = null
          resolve(approved)
        },
        (e) => {
          log('warn', `[nest] 确认 UI 异常，按拒绝处理：${errMsg(e)}`)
          releasePendingConfirm = null
          resolve(false)
        },
      )
    })
    if (!signal) return pending
    // 急停（abort）与用户点击竞速：abort 先到 = 拒绝；pending 先到以用户选择为准
    return new Promise<boolean>((resolve) => {
      const onAbort = () => resolve(false)
      signal.addEventListener('abort', onAbort, { once: true })
      void pending.then((ok) => {
        signal.removeEventListener('abort', onAbort)
        resolve(ok)
      })
    })
  }

  const tools: AgentTool<any>[] = specs.map((spec) => ({
    name: spec.id,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (toolCallId, params, signal) => {
      if (stopped || signal?.aborted) {
        const text = '已停止：本工具未执行'
        return { content: [{ type: 'text', text }], details: { stopped: true }, isError: true }
      }
      try {
        const out = await spec.execute((params ?? {}) as Record<string, unknown>, signal)
        return { content: [{ type: 'text', text: resultText(out) }], details: out }
      } catch (e) {
        // 失败返回 isError toolResult（不抛）：pi 的循环继续，模型能读到原因
        return {
          content: [{ type: 'text', text: `执行失败：${errMsg(e)}` }],
          details: { error: errMsg(e) },
          isError: true,
        }
      }
    },
  }))

  return {
    tools,

    get stopped(): boolean {
      return stopped
    },

    async beforeToolCall(context, signal) {
      const spec = byId.get(context.toolCall.name)
      if (!spec) {
        return {
          block: true,
          reason: `未知工具：${context.toolCall.name}（未在本会话注册，拒绝执行）`,
        }
      }

      const toolCallId = context.toolCall.id
      if (stopped || signal?.aborted) {
        options.onCard(
          card(spec, toolCallId, spec.risk, 'blocked', { errorMessage: '已停止：本工具未执行' }),
        )
        await writeAudit({
          toolId: spec.id,
          appId: spec.appId,
          command: spec.command,
          risk: spec.risk,
          decision: 'stopped',
          argsDigest: null,
          resultDigest: null,
        })
        return { block: true, reason: '已停止：本工具未执行' }
      }

      const declaredRisk = spec.risk
      let risk = effectiveRisk(declaredRisk, options.policy?.riskFloor?.[spec.id])
      if (risk === 'ui' && options.policy?.uiRequireConfirm) risk = 'write'

      const args = (context.args ?? {}) as Record<string, unknown>
      const argsDigest = await safeDigest(args, '参数')
      const impact =
        spec.impact?.(args) ??
        `将执行 ${spec.command}（${spec.appId ?? '本应用'}），此操作不可撤销。`

      options.onCard(
        card(spec, toolCallId, risk, risk === 'ui' ? 'running' : 'pending', {
          notice: risk === 'ui' ? 'opening' : null,
        }),
      )

      if (requiresConfirm(risk)) {
        const approved = await confirmWithAbort(
          {
            toolCallId,
            toolId: spec.id,
            label: spec.label,
            appId: spec.appId,
            risk,
            declaredRisk,
            argsDigest,
            impact,
            stage: 1,
          },
          signal,
        )
        if (!approved) {
          const decision: ToolDecision = stopped || signal?.aborted ? 'stopped' : 'rejected'
          const reason = decision === 'stopped' ? '已停止：本工具未执行' : '用户拒绝执行该工具'
          options.onCard(card(spec, toolCallId, risk, 'blocked', { errorMessage: reason }))
          await writeAudit({
            toolId: spec.id,
            appId: spec.appId,
            command: spec.command,
            risk,
            decision,
            argsDigest,
            resultDigest: null,
          })
          return { block: true, reason }
        }

        if (risk === 'danger') {
          const confirmed = await confirmWithAbort(
            {
              toolCallId,
              toolId: spec.id,
              label: spec.label,
              appId: spec.appId,
              risk,
              declaredRisk,
              argsDigest,
              impact,
              stage: 2,
            },
            signal,
          )
          if (!confirmed) {
            const decision: ToolDecision = stopped || signal?.aborted ? 'stopped' : 'rejected'
            const reason =
              decision === 'stopped'
                ? '已停止：本工具未执行'
                : '用户取消了危险操作的第二次确认，工具未执行'
            options.onCard(card(spec, toolCallId, risk, 'blocked', { errorMessage: reason }))
            await writeAudit({
              toolId: spec.id,
              appId: spec.appId,
              command: spec.command,
              risk,
              decision,
              argsDigest,
              resultDigest: null,
            })
            return { block: true, reason }
          }
        }
      }

      // 通过确认：记录状态，等 afterToolCall 结算（执行体由 pi 调用）。
      // 再查一次急停：确认期间用户点了停止，本工具也不得执行。
      if (stopped || signal?.aborted) {
        options.onCard(
          card(spec, toolCallId, risk, 'blocked', { errorMessage: '已停止：本工具未执行' }),
        )
        await writeAudit({
          toolId: spec.id,
          appId: spec.appId,
          command: spec.command,
          risk,
          decision: 'stopped',
          argsDigest,
          resultDigest: null,
        })
        return { block: true, reason: '已停止：本工具未执行' }
      }

      calls.set(toolCallId, { spec, risk, argsDigest })
      options.onCard(
        card(spec, toolCallId, risk, 'running', {
          notice: risk === 'ui' ? 'opening' : null,
        }),
      )
      return undefined
    },

    async afterToolCall(context) {
      const toolCallId = context.toolCall.id
      const state = calls.get(toolCallId)
      if (!state) return undefined
      calls.delete(toolCallId)

      const resultDigest = await safeDigest(context.result, '结果')
      const failed = context.isError
      const wasHalted = Boolean(
        (context.result as { details?: { stopped?: boolean } })?.details?.stopped,
      )
      const decision: ToolDecision = wasHalted
        ? 'stopped'
        : failed
          ? 'error'
          : state.risk === 'write' || state.risk === 'danger'
            ? 'approved'
            : 'auto'

      options.onCard(
        card(state.spec, toolCallId, state.risk, failed ? 'error' : 'ok', {
          errorMessage: failed ? firstText(context.result) : undefined,
        }),
      )

      await writeAudit({
        toolId: state.spec.id,
        appId: state.spec.appId,
        command: state.spec.command,
        risk: state.risk,
        decision,
        argsDigest: state.argsDigest,
        resultDigest,
      })
      return undefined
    },

    halt() {
      stopped = true
      releasePendingConfirm?.()
      releasePendingConfirm = null
    },

    reset() {
      stopped = false
      calls.clear()
      releasePendingConfirm = null
    },
  }
}

/** 取 toolResult 的第一段文本（失败原因给卡片；原文只在这一层内存里） */
function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content
  if (Array.isArray(content)) {
    const text = content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text
    if (text) return text
  }
  return '工具执行失败'
}
