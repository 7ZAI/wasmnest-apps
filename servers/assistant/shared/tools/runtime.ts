/**
 * 工具运行时（票 13 / spec §3.3、§5.6、§5.9）
 *
 * 职责：
 * - 把声明式工具目录装配成 pi `AgentTool`（parameters 直接用声明方
 *   JSON Schema；execute 走本地执行器或 `apps.invoke` 桥）；
 * - `beforeToolCall` 四档风险：read 自动、ui 自动 + 可见卡、write 内联
 *   批准、danger 二次确认（第二次展示影响范围）；风险只升不降；
 * - 确认挂起：write / danger 在 beforeToolCall 里等待 UI 决定，急停时
 *   以拒绝结算（停止后队列中未执行的工具不再执行）；
 * - 审计：每次调用一行（tool / app / command / risk / decision /
 *   参数与结果摘要），只落摘要不落原文（spec §6 日志红线）。
 *
 * 拒绝 / 执行失败不抛异常：被 block 的调用由 pi 循环合成 isError
 * toolResult，执行失败返回 isError: true 的 toolResult，循环不中断。
 */
import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import {
  requiresConfirmation,
  requiresSecondConfirmation,
  elevateRisk,
  type Risk,
} from './risk'
import type {
  ConfirmationDecision,
  ConfirmationRequest,
  ToolCardState,
  ToolDescriptor,
  ToolRuntimeDeps,
  ToolRuntimeHandle,
} from './types'

/** 参数摘要截断长度（卡片 / 确认卡只展示摘要，不铺全文） */
const ARGS_SUMMARY_LIMIT = 120

/** 摘要：sha256 hex + 长度（不落原文，spec §6） */
async function digestOf(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex} (${text.length}B)`
}

function argsSummary(args: unknown): string {
  try {
    const text = JSON.stringify(args ?? {})
    return text.length > ARGS_SUMMARY_LIMIT ? `${text.slice(0, ARGS_SUMMARY_LIMIT)}…` : text
  } catch {
    return String(args)
  }
}

class ToolRuntime implements ToolRuntimeHandle {
  cards: ToolCardState[] = []
  pendingConfirmations: Array<{ request: ConfirmationRequest; card: ToolCardState }> = []
  tools: AgentTool<any>[] = []

  private deps: ToolRuntimeDeps
  private descriptors = new Map<string, ToolDescriptor>()
  private confirmations = new Map<string, (decision: ConfirmationDecision) => void>()
  private confirmationCounter = 0
  private stopped = false

  constructor(deps: ToolRuntimeDeps) {
    this.deps = deps
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message)
  }

  // ==================== 目录 ====================

  /** 注册 / 替换一个工具描述符（按 name 去重） */
  register(descriptor: ToolDescriptor): void {
    this.descriptors.set(descriptor.name, descriptor)
  }

  /** 用一组描述符整体替换目录（应用工具目录刷新用） */
  replaceCatalog(descriptors: ToolDescriptor[]): void {
    this.descriptors.clear()
    for (const d of descriptors) this.register(d)
    this.refresh()
  }

  /** 重建 AgentTool 列表（目录变化后调用；会话侧把新列表挂到 agent.state.tools） */
  refresh(): void {
    this.tools = [...this.descriptors.values()].map((d) => this.toAgentTool(d))
  }

  private toAgentTool(d: ToolDescriptor): AgentTool<any> {
    return {
      name: d.name,
      label: d.label,
      description: d.description,
      parameters: d.argsSchema,
      execute: async (toolCallId, params, signal) =>
        this.executeDescriptor(d, toolCallId, params, signal),
    }
  }

  // ==================== beforeToolCall（四档风险） ====================

  beforeToolCall = async (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const toolCall = context.toolCall
    const descriptor = this.descriptors.get(toolCall.name)
    const argsSummaryText = argsSummary(context.args)

    if (!descriptor) {
      // 未声明工具：点名缺什么，不静默（spec §2.4）
      return {
        block: true,
        reason: `工具未声明：${toolCall.name}（该工具未在助手目录中注册，无法执行）`,
      }
    }

    const risk = elevateRisk(descriptor.risk, this.deps.policyRisk)
    const card = this.ensureCard(toolCall.id, descriptor, argsSummaryText, risk)

    // 急停：在途确认与未执行工具一律不执行
    if (this.stopped || signal?.aborted) {
      this.markCard(card, 'stopped', '已停止，未执行')
      return { block: true, reason: '用户已停止，工具未执行' }
    }

    // read / ui：自动放行（卡片已可见；ui 的「正在打开」在执行卡上呈现）
    if (!requiresConfirmation(risk)) {
      return undefined
    }

    // write / danger：暂停等待用户确认
    const first = await this.requestConfirmation(card, descriptor, risk, argsSummaryText, 1)
    // 急停可能在等待期间发生：结算为停止，不按拒绝处理
    if (this.stopped) {
      this.markCard(card, 'stopped', '已停止，未执行')
      return { block: true, reason: '用户已停止，工具未执行' }
    }
    if (first === 'reject') {
      this.markCard(card, 'rejected', '用户拒绝执行')
      await this.recordAudit(descriptor, risk, 'denied', context.args, null)
      return { block: true, reason: `用户拒绝了 ${descriptor.label} 的执行` }
    }

    if (requiresSecondConfirmation(risk)) {
      const second = await this.requestConfirmation(card, descriptor, risk, argsSummaryText, 2)
      if (this.stopped) {
        this.markCard(card, 'stopped', '已停止，未执行')
        return { block: true, reason: '用户已停止，工具未执行' }
      }
      if (second === 'reject') {
        this.markCard(card, 'rejected', '用户在二次确认中拒绝')
        await this.recordAudit(descriptor, risk, 'denied', context.args, null)
        return { block: true, reason: `用户在二次确认中拒绝了 ${descriptor.label} 的执行` }
      }
    }

    this.markCard(card, 'running')
    // 放行的审计行在执行完成后记（带结果摘要，见 executeDescriptor）；
    // 此处不记，避免一次调用两行。批准后若因急停未执行，属罕见竞态，
    // 宿主 tracing 仍有同名事件兜底。
    return undefined
  }

  /** 确认挂起：建确认项 → 卡片进入 awaiting → 等 UI 回决定 */
  private requestConfirmation(
    card: ToolCardState,
    descriptor: ToolDescriptor,
    risk: Risk,
    argsText: string,
    stage: 1 | 2,
  ): Promise<ConfirmationDecision> {
    const id = `conf-${++this.confirmationCounter}`
    const request: ConfirmationRequest = {
      id,
      toolName: descriptor.name,
      label: descriptor.label,
      risk,
      argsSummary: argsText,
      impact: stage === 2 ? descriptor.impact : undefined,
      stage,
    }
    card.state = 'awaiting'
    card.confirmation = { stage, impact: request.impact }
    this.pendingConfirmations.push({ request, card })
    return new Promise<ConfirmationDecision>((resolve) => {
      this.confirmations.set(id, resolve)
    })
  }

  /** UI 回决定（批准 / 拒绝）；决定后清理确认项（避免陈旧条目被再次读到） */
  resolveConfirmation(id: string, decision: ConfirmationDecision): void {
    const resolve = this.confirmations.get(id)
    if (!resolve) return
    this.confirmations.delete(id)
    for (let i = this.pendingConfirmations.length - 1; i >= 0; i--) {
      if (this.pendingConfirmations[i].request.id === id) this.pendingConfirmations.splice(i, 1)
    }
    resolve(decision)
  }

  /** 急停结算：所有在途确认按拒绝结算，卡片标 stopped */
  abortPending(reason: string): void {
    this.stopped = true
    for (const [id, resolve] of this.confirmations) {
      this.confirmations.delete(id)
      resolve('reject')
    }
    for (const entry of this.pendingConfirmations) {
      entry.card.state = 'stopped'
      entry.card.confirmation = undefined
      entry.card.errorMessage = reason
    }
    this.pendingConfirmations.length = 0
    for (const card of this.cards) {
      if (card.state === 'awaiting' || card.state === 'running') {
        card.state = 'stopped'
        card.errorMessage = card.errorMessage ?? reason
      }
    }
  }

  /** 恢复运行态（新会话 / 重启运行时）：就地清空，保持数组身份（响应式包装持续有效） */
  reset(): void {
    this.stopped = false
    this.cards.length = 0
    this.pendingConfirmations.length = 0
    this.confirmations.clear()
  }

  private ensureCard(
    id: string,
    descriptor: ToolDescriptor,
    argsText: string,
    risk: Risk,
  ): ToolCardState {
    let card = this.cards.find((c) => c.id === id)
    if (!card) {
      card = {
        id,
        name: descriptor.name,
        label: descriptor.label,
        risk,
        appId: descriptor.appId,
        argsSummary: argsText,
        state: 'running',
      }
      this.cards.push(card)
    }
    return card
  }

  private markCard(card: ToolCardState, state: ToolCardState['state'], errorMessage?: string): void {
    card.state = state
    if (errorMessage !== undefined) card.errorMessage = errorMessage
    if (state !== 'awaiting') card.confirmation = undefined
  }

  // ==================== 执行 ====================

  private async executeDescriptor(
    descriptor: ToolDescriptor,
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) {
    const card = this.cards.find((c) => c.id === toolCallId)
    const fail = (message: string) => {
      if (card) this.markCard(card, 'error', message)
      return {
        content: [{ type: 'text' as const, text: message }],
        details: { error: message },
        isError: true,
      }
    }

    if (this.stopped || signal?.aborted) {
      return fail('已停止，工具未执行')
    }

    try {
      let text: string
      if (descriptor.executor) {
        const res = await descriptor.executor(params, signal)
        if (res.error) return fail(res.error)
        text = res.text ?? ''
      } else if (descriptor.appToolId && descriptor.appId) {
        if (!this.deps.apps) {
          // 桥缺失显性降级（不静默返回空，spec §2.4 / 票 15 口径）
          return fail(
            `应用调用桥不可用：当前端未注入 apps 桥（缺少 apps:control 权限或宿主不支持），无法调用 ${descriptor.appId} 的工具`,
          )
        }
        text = JSON.stringify(
          await this.deps.apps.invoke(descriptor.appId, descriptor.appToolId, params ?? {}),
        )
      } else {
        return fail(`工具 ${descriptor.name} 未配置执行器`)
      }

      if (card) {
        this.markCard(card, 'done')
        card.resultSummary =
          text.length > ARGS_SUMMARY_LIMIT ? `${text.slice(0, ARGS_SUMMARY_LIMIT)}…` : text
      }
      await this.recordAudit(descriptor, this.effectiveRisk(descriptor), 'allowed', params, text)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true },
      }
    } catch (e) {
      // 桥错误信封等原样上交为 isError toolResult（循环不中断）；
      // 审计仍落一行（用户已批准的调用，结果摘要记录失败原因）
      const message = e instanceof Error ? e.message : String(e)
      this.log('warn', `[nest] 工具 ${descriptor.name} 执行失败：${message}`)
      await this.recordAudit(descriptor, this.effectiveRisk(descriptor), 'allowed', params, message)
      return fail(message)
    }
  }

  private effectiveRisk(descriptor: ToolDescriptor): Risk {
    return elevateRisk(descriptor.risk, this.deps.policyRisk)
  }

  // ==================== 审计 ====================

  /**
   * 写一行审计（spec §5.6）：只收摘要字段。
   * 拒绝在 beforeToolCall 决定时记（resultDigest 缺省）；放行在执行完成后
   * 记（带结果摘要）——每次调用恰好一行。
   */
  private async recordAudit(
    descriptor: ToolDescriptor,
    risk: Risk,
    decision: 'allowed' | 'denied',
    args: unknown,
    resultText: string | null,
  ): Promise<void> {
    try {
      const argsDigest = await digestOf(JSON.stringify(args ?? {}))
      const resultDigest = resultText === null ? null : await digestOf(resultText)
      await this.deps.invoke('assistant.audit-record', {
        ts: Date.now().toString(),
        toolId: descriptor.name,
        appId: descriptor.appId ?? null,
        command: descriptor.appToolId ?? descriptor.name,
        risk,
        decision,
        argsDigest,
        resultDigest,
        userVisible: true,
      })
    } catch (e) {
      // 审计失败不阻断工具链，但必须点名（不静默吞错）
      this.log('error', `[nest] 审计写入失败（${descriptor.name}/${decision}）：${String(e)}`)
    }
  }
}

/** 创建工具运行时（票 13） */
export function buildToolRuntime(deps: ToolRuntimeDeps): ToolRuntimeHandle {
  return new ToolRuntime(deps)
}

export { argsSummary }
