/**
 * 工具运行时与确认单测（票 13 / spec §3.3、§5.6、§5.9）
 *
 * 用真实 pi Agent 循环（stub StreamFn 驱动 toolCall）证明四档风险与急停
 * 真的生效（不是 UI mock）：
 * - read 自动执行；write 暂停等批准；danger 两次确认（第二次带影响范围）；
 * - 拒绝 → isError toolResult，循环不中断，执行器不被调用；
 * - 急停 → 在途确认按拒绝结算，工具不执行；
 * - 风险只升不降（read 声明 + write 策略 → 按 write 确认）；
 * - 审计每调用一行，只落摘要不落原文。
 */
import { describe, it, expect, vi } from 'vitest'
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentTool, BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { buildToolRuntime } from '@nest-shared/tools/runtime'
import type { ToolDescriptor } from '@nest-shared/tools/types'

// ==================== 测试脚手架 ====================

interface AuditCall {
  command: string
  args: Record<string, unknown>
}

interface Harness {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  audits: AuditCall[]
  executed: string[]
}

function createHarness(): Harness {
  const audits: AuditCall[] = []
  const executed: string[] = []
  const invoke = async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (command === 'assistant.audit-record') {
      audits.push({ command, args: args ?? {} })
    }
    return { ok: true } as T
  }
  return { invoke, audits, executed }
}

/** 执行器：记录调用并返回固定文本 */
function recordingExecutor(h: Harness, label: string) {
  return async () => {
    h.executed.push(label)
    return { text: `${label} 完成` }
  }
}

function baseDescriptor(over: Partial<ToolDescriptor>): ToolDescriptor {
  return {
    name: 't',
    label: 'T',
    description: 'd',
    argsSchema: { type: 'object', properties: {} },
    risk: 'read',
    ...over,
  }
}

const MODEL = {
  id: 'm',
  name: 'm',
  api: 'openai-completions',
  provider: 'p',
  baseUrl: 'https://example.test/v1',
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  contextWindow: 1024,
  maxTokens: 256,
} as Model<any>

interface ScriptStep {
  toolCall?: { name: string; arguments: Record<string, unknown> }
  text?: string
}

/**
 * Stub StreamFn：按脚本逐轮返回 toolCall 或文本。
 * 第 N 次调用返回脚本第 N 步（超出则重复最后一步）。
 */
function stubStreamFn(script: ScriptStep[]) {
  let i = 0
  return (_model: unknown, _ctx: unknown) => {
    const step = script[Math.min(i, script.length - 1)]
    i++
    const stream = createAssistantMessageEventStream()
    const content: AssistantMessage['content'] = []
    let toolCallId = ''
    if (step.toolCall) {
      toolCallId = `tc-${i}`
      content.push({
        type: 'toolCall',
        id: toolCallId,
        name: step.toolCall.name,
        arguments: step.toolCall.arguments as never,
      })
    }
    if (step.text !== undefined) content.push({ type: 'text', text: step.text })
    const msg: AssistantMessage = {
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: 'p',
      model: 'm',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: step.toolCall ? 'toolUse' : 'stop',
      timestamp: Date.now(),
    }
    stream.push({ type: 'start', partial: msg })
    stream.push({ type: 'done', reason: msg.stopReason as 'stop' | 'toolUse', message: msg })
    stream.end(msg)
    return stream
  }
}

interface LoopHarness {
  h: Harness
  runtime: ReturnType<typeof buildToolRuntime>
  agent: Agent
  /** 等待下一轮确认出现并返回其请求 id */
  waitForConfirmation: () => Promise<{ id: string; stage: 1 | 2 }>
}

function createLoop(script: ScriptStep[], deps: { policyRisk?: ToolDescriptor['risk'] } = {}): LoopHarness {
  const h = createHarness()
  const runtime = buildToolRuntime({ invoke: h.invoke, policyRisk: deps.policyRisk, log: () => {} })
  runtime.register(
    baseDescriptor({
      name: 'time.now',
      label: '当前时间',
      risk: 'read',
      executor: async () => ({ text: '{"iso":"2026-11-13T00:00:00Z"}' }),
    }),
  )
  runtime.register(
    baseDescriptor({
      name: 'test.write',
      label: '测试写入',
      risk: 'write',
      executor: recordingExecutor(h, 'write'),
    }),
  )
  runtime.register(
    baseDescriptor({
      name: 'test.danger',
      label: '测试高危',
      risk: 'danger',
      impact: '将删除全部记忆',
      executor: recordingExecutor(h, 'danger'),
    }),
  )
  runtime.refresh()
  return withAgent(h, runtime, script)
}

function withAgent(h: Harness, runtime: ReturnType<typeof buildToolRuntime>, script: ScriptStep[]): LoopHarness {
  const agent = new Agent({
    initialState: { systemPrompt: 's', model: MODEL, messages: [], tools: runtime.tools },
    streamFn: stubStreamFn(script) as never,
    beforeToolCall: runtime.beforeToolCall as never,
    toolExecution: 'sequential',
  })
  const waitForConfirmation = (): Promise<{ id: string; stage: 1 | 2 }> =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const check = () => {
        const entry = runtime.pendingConfirmations[runtime.pendingConfirmations.length - 1]
        if (entry) return resolve({ id: entry.request.id, stage: entry.request.stage })
        if (Date.now() - started > 3000) {
          reject(new Error('等待确认超时（3s）：beforeToolCall 未挂起确认'))
          return
        }
        window.setTimeout(check, 5)
      }
      check()
    })
  return { h, runtime, agent, waitForConfirmation }
}

function toolCallContext(name: string, args: unknown = {}): BeforeToolCallContext {
  return {
    assistantMessage: { role: 'assistant' } as never,
    toolCall: { type: 'toolCall', id: 'tc-x', name, arguments: args as Record<string, unknown> as never },
    args,
    context: { messages: [] } as never,
  }
}

// ==================== 用例 ====================

describe('工具运行时四档风险（票 13，真实循环）', () => {
  it('read 自动执行，不产生确认', async () => {
    const { runtime, agent } = createLoop([
      { toolCall: { name: 'time.now', arguments: {} } },
      { text: '时间已获取' },
    ])
    await agent.prompt('现在几点')
    await agent.waitForIdle()
    expect(runtime.cards).toHaveLength(1)
    expect(runtime.cards[0].state).toBe('done')
    expect(runtime.cards[0].name).toBe('time.now')
  })

  it('write 暂停等批准：批准后才执行', async () => {
    const { runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.write', arguments: { x: 1 } } },
      { text: '写入完成' },
    ])
    const run = agent.prompt('写入')
    const conf = await waitForConfirmation()
    expect(conf.stage).toBe(1)
    expect(runtime.cards[0].state).toBe('awaiting')
    runtime.resolveConfirmation(conf.id, 'approve')
    await run
    await agent.waitForIdle()
    expect(runtime.cards[0].state).toBe('done')
  })

  it('write 拒绝：不执行、卡片拒绝、循环不中断', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.write', arguments: {} } },
      { text: '好的，没有执行' },
    ])
    const run = agent.prompt('写入')
    const conf = await waitForConfirmation()
    runtime.resolveConfirmation(conf.id, 'reject')
    await run
    await agent.waitForIdle()
    expect(h.executed).toEqual([])
    expect(runtime.cards[0].state).toBe('rejected')
    // 循环继续：第二轮文本响应正常产出（message_end 正常结算）
    const texts = agent.state.messages.filter((m) => m.role === 'assistant')
    expect(texts.length).toBeGreaterThanOrEqual(1)
  })

  it('danger 两次确认：第二次带影响范围，两次都批准才执行', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.danger', arguments: {} } },
      { text: '已执行' },
    ])
    const run = agent.prompt('高危操作')
    const first = await waitForConfirmation()
    expect(first.stage).toBe(1)
    runtime.resolveConfirmation(first.id, 'approve')

    const second = await waitForConfirmation()
    expect(second.stage).toBe(2)
    const card = runtime.cards[0]
    expect(card.confirmation?.impact).toBe('将删除全部记忆')
    runtime.resolveConfirmation(second.id, 'approve')

    await run
    await agent.waitForIdle()
    expect(h.executed).toEqual(['danger'])
    expect(runtime.cards[0].state).toBe('done')
  })

  it('danger 第二次拒绝：不执行', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.danger', arguments: {} } },
      { text: '未执行' },
    ])
    const run = agent.prompt('高危操作')
    const first = await waitForConfirmation()
    runtime.resolveConfirmation(first.id, 'approve')
    const second = await waitForConfirmation()
    runtime.resolveConfirmation(second.id, 'reject')
    await run
    await agent.waitForIdle()
    expect(h.executed).toEqual([])
    expect(runtime.cards[0].state).toBe('rejected')
  })

  it('急停：在途确认按拒绝结算，工具不执行', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.write', arguments: {} } },
      { text: '不应到达' },
    ])
    const run = agent.prompt('写入')
    const conf = await waitForConfirmation()
    runtime.abortPending('已停止，未执行')
    await run
    await agent.waitForIdle()
    expect(h.executed).toEqual([])
    expect(runtime.cards[0].state).toBe('stopped')
    expect(runtime.pendingConfirmations).toHaveLength(0)
  })

  it('风险只升不降：read 声明 + write 策略 → 按 write 确认', async () => {
    const { runtime, agent, waitForConfirmation } = createLoop(
      [
        { toolCall: { name: 'time.now', arguments: {} } },
        { text: 'ok' },
      ],
      { policyRisk: 'write' },
    )
    const run = agent.prompt('现在几点')
    const conf = await waitForConfirmation()
    expect(conf.stage).toBe(1)
    // 升档后按 write 处理：拒绝结算
    runtime.resolveConfirmation(conf.id, 'reject')
    await run
    await agent.waitForIdle()
    expect(runtime.cards[0].state).toBe('rejected')
  })

  it('未声明工具：block 点名，不静默', async () => {
    const { h, runtime } = createLoop([{ text: 'x' }])
    const result = await runtime.beforeToolCall(toolCallContext('not.declared'))
    expect(result?.block).toBe(true)
    expect(result?.reason).toContain('not.declared')
    expect(h.executed).toEqual([])
  })

  it('审计：每次调用一行，只落摘要不落原文', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.write', arguments: { secret: '不应落原文' } } },
      { text: 'ok' },
    ])
    const run = agent.prompt('写入')
    const conf = await waitForConfirmation()
    runtime.resolveConfirmation(conf.id, 'approve')
    await run
    await agent.waitForIdle()

    expect(h.audits.length).toBe(1)
    const audit = h.audits[0].args
    expect(audit.decision).toBe('allowed')
    expect(audit.risk).toBe('write')
    expect(audit.toolId).toBe('test.write')
    const argsDigest = String(audit.argsDigest)
    expect(argsDigest).toMatch(/^sha256:/)
    // 原文不落：摘要串里不含原文
    expect(argsDigest).not.toContain('不应落原文')
  })

  it('审计：拒绝也留一行（decision=denied）', async () => {
    const { h, runtime, agent, waitForConfirmation } = createLoop([
      { toolCall: { name: 'test.write', arguments: {} } },
      { text: 'ok' },
    ])
    const run = agent.prompt('写入')
    const conf = await waitForConfirmation()
    runtime.resolveConfirmation(conf.id, 'reject')
    await run
    await agent.waitForIdle()
    expect(h.audits.length).toBe(1)
    expect(h.audits[0].args.decision).toBe('denied')
    expect(h.audits[0].args.resultDigest).toBeNull()
  })
})

describe('ToolRuntime 直接行为（票 13）', () => {
  it('refresh 后工具列表与目录一致', () => {
    const h = createHarness()
    const runtime = buildToolRuntime({ invoke: h.invoke })
    runtime.register(baseDescriptor({ name: 'a' }))
    runtime.register(baseDescriptor({ name: 'b' }))
    runtime.refresh()
    expect(runtime.tools.map((t: AgentTool<any>) => t.name)).toEqual(['a', 'b'])
  })

  it('replaceCatalog 整体替换并重建', () => {
    const h = createHarness()
    const runtime = buildToolRuntime({ invoke: h.invoke })
    runtime.register(baseDescriptor({ name: 'a' }))
    runtime.refresh()
    runtime.replaceCatalog([baseDescriptor({ name: 'c' })])
    expect(runtime.tools.map((t: AgentTool<any>) => t.name)).toEqual(['c'])
  })

  it('reset 就地清空，保持数组身份', () => {
    const h = createHarness()
    const runtime = buildToolRuntime({ invoke: h.invoke })
    const cards = runtime.cards
    runtime.cards.push({
      id: 'x', name: 'n', label: 'l', risk: 'read', argsSummary: '', state: 'done',
    })
    runtime.reset()
    expect(runtime.cards).toBe(cards)
    expect(runtime.cards).toHaveLength(0)
  })
})
