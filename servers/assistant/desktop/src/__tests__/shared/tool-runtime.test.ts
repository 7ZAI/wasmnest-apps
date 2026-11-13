/**
 * 工具运行时单测（票 13 票面）
 *
 * 直接驱动 `createToolRuntime` 的两个钩子与 `AgentTool.execute`（真实执行体，
 * 不是 UI mock），覆盖：四档风险、只升不降、拒绝 / 失败返回 isError、
 * 急停后队列不再执行、审计只落摘要。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { AssistantInvoke } from '@nest-shared/types'
import {
  effectiveRisk,
  createToolRuntime,
  requiresConfirm,
  type ToolRuntime,
} from '@nest-shared/tools/runtime'
import { testDangerTool, testWriteTool, timeNowTool } from '@nest-shared/tools/builtin'
import type { ToolConfirmRequest, ToolSpec } from '@nest-shared/tools/types'

interface AuditCall {
  toolId: string
  appId: string | null
  command: string
  risk: string
  decision: string
  argsDigest: string | null
  resultDigest: string | null
  userVisible: boolean
  ts: string
}

function makeHarness(
  specs: ToolSpec[],
  options: { confirm?: (r: ToolConfirmRequest) => Promise<boolean> } = {},
) {
  const audits: AuditCall[] = []
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'assistant.audit-record') {
      audits.push(args as unknown as AuditCall)
      return { id: `aud-${audits.length}` }
    }
    throw new Error(`unexpected command: ${command}`)
  }) as unknown as AssistantInvoke

  const confirmCalls: ToolConfirmRequest[] = []
  const confirm = vi.fn(async (request: ToolConfirmRequest) => {
    confirmCalls.push(request)
    return options.confirm ? options.confirm(request) : true
  })

  const cards = new Map<string, Record<string, unknown>>()
  const auditErrors: string[] = []
  const runtime = createToolRuntime(specs, {
    invoke,
    confirm,
    onCard: (card) => cards.set(card.toolCallId, { ...card }),
    onAuditError: (message) => auditErrors.push(message),
  })
  return { runtime, audits, confirmCalls, confirm, cards, auditErrors }
}

function ctx(name: string, args: Record<string, unknown>, id = 'tc-1') {
  return {
    toolCall: { type: 'toolCall' as const, id, name, arguments: args as never },
    args,
    context: {} as never,
    assistantMessage: {} as never,
  }
}

async function runTool(
  runtime: ToolRuntime,
  name: string,
  args: Record<string, unknown>,
  id = 'tc-1',
  signal?: AbortSignal,
): Promise<AgentToolResult<unknown>> {
  const tool = runtime.tools.find((t) => t.name === name)
  if (!tool) throw new Error(`missing tool: ${name}`)
  return tool.execute(id, args, signal)
}

describe('effectiveRisk（只升不降）', () => {
  it('取声明档与策略下限的较高者', () => {
    expect(effectiveRisk('read', 'write')).toBe('write')
    expect(effectiveRisk('danger', 'read')).toBe('danger')
    expect(effectiveRisk('ui', undefined)).toBe('ui')
  })

  it('确认档位：read / ui 自动，write 一次，danger 两次', () => {
    expect(requiresConfirm('read')).toBe(false)
    expect(requiresConfirm('ui')).toBe(false)
    expect(requiresConfirm('write')).toBe(true)
    expect(requiresConfirm('danger')).toBe(true)
  })
})

describe('四档风险（真实执行体）', () => {
  it('read：time.now 自动执行，不打断，结果卡可见，审计 decision=auto', async () => {
    const now = () => 1_700_000_000_000
    const { runtime, confirm, cards, audits } = makeHarness([timeNowTool(now)])

    expect(await runtime.beforeToolCall(ctx('time.now', {}))).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()

    const result = await runTool(runtime, 'time.now', {})
    expect(result.isError).toBeUndefined()
    const data = JSON.parse((result.content[0] as { text: string }).text)
    expect(data.epochMs).toBe(now())
    expect(data.iso).toBe(new Date(now()).toISOString())

    await runtime.afterToolCall({
      ...ctx('time.now', {}),
      result,
      isError: false,
      toolCall: { type: 'toolCall', id: 'tc-1', name: 'time.now', arguments: {} },
    })

    expect(cards.get('tc-1')?.status).toBe('ok')
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ toolId: 'time.now', risk: 'read', decision: 'auto' })
    expect(audits[0].argsDigest).toMatch(/^[0-9a-f]{12}$/)
    expect(audits[0].resultDigest).toMatch(/^[0-9a-f]{12}$/)
  })

  it('ui：自动执行但卡片显示「正在打开」，审计 decision=auto', async () => {
    const openSpec: ToolSpec = {
      id: 'test.open',
      label: '打开应用',
      description: 'test ui tier',
      risk: 'ui',
      appId: 'com.example.target',
      command: 'app.open',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ opened: true }),
    }
    const { runtime, confirm, cards } = makeHarness([openSpec])

    expect(await runtime.beforeToolCall(ctx('test.open', {}))).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
    expect(cards.get('tc-1')).toMatchObject({ risk: 'ui', status: 'running', notice: 'opening' })
  })

  it('write：批准后执行，审计 decision=approved', async () => {
    const { runtime, confirmCalls, audits, cards } = makeHarness([testWriteTool()])

    expect(await runtime.beforeToolCall(ctx('test.echo', { text: 'hello' }))).toBeUndefined()
    expect(confirmCalls).toHaveLength(1)
    expect(confirmCalls[0]).toMatchObject({ risk: 'write', declaredRisk: 'write', stage: 1 })

    const result = await runTool(runtime, 'test.echo', { text: 'hello' })
    await runtime.afterToolCall({ ...ctx('test.echo', { text: 'hello' }), result, isError: false })

    expect(cards.get('tc-1')?.status).toBe('ok')
    expect(audits[0]).toMatchObject({ toolId: 'test.echo', risk: 'write', decision: 'approved' })
  })

  it('write：拒绝返回 block（isError toolResult 由 pi 生成），执行体不运行', async () => {
    const { runtime, audits, cards } = makeHarness([testWriteTool()], {
      confirm: async () => false,
    })

    const blocked = await runtime.beforeToolCall(ctx('test.echo', { text: 'nope' }))
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('拒绝')
    expect(cards.get('tc-1')).toMatchObject({ status: 'blocked' })
    expect(audits[0]).toMatchObject({ decision: 'rejected', resultDigest: null })
  })

  it('danger：两次确认，第二次展示影响范围；批准后执行', async () => {
    const { runtime, confirmCalls, audits } = makeHarness([testDangerTool()])

    expect(await runtime.beforeToolCall(ctx('test.danger', { scope: 'all' }))).toBeUndefined()
    expect(confirmCalls.map((c) => c.stage)).toEqual([1, 2])
    expect(confirmCalls[1].impact).toContain('all')

    const result = await runTool(runtime, 'test.danger', { scope: 'all' })
    await runtime.afterToolCall({ ...ctx('test.danger', { scope: 'all' }), result, isError: false })

    expect(audits[0]).toMatchObject({ risk: 'danger', decision: 'approved' })
  })

  it('danger：第二次取消 → 不执行，审计 rejected', async () => {
    let stage = 0
    const { runtime, audits } = makeHarness([testDangerTool()], {
      confirm: async () => {
        stage += 1
        return stage === 1
      },
    })

    const blocked = await runtime.beforeToolCall(ctx('test.danger', { scope: 'memory' }))
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('第二次')
    expect(audits[0]).toMatchObject({ decision: 'rejected', risk: 'danger' })
  })

  it('应用声明 read、助手策略要求确认 → 按更高档执行', async () => {
    const confirmCalls: ToolConfirmRequest[] = []
    const runtime = createToolRuntime([timeNowTool()], {
      invoke: (async (command: string) => {
        if (command === 'assistant.audit-record') return { id: 'aud-x' }
        throw new Error('unexpected')
      }) as unknown as AssistantInvoke,
      confirm: async (request) => {
        confirmCalls.push(request)
        return true
      },
      onCard: () => {},
      policy: { riskFloor: { 'time.now': 'write' } },
    })

    expect(await runtime.beforeToolCall(ctx('time.now', {}))).toBeUndefined()
    expect(confirmCalls).toHaveLength(1)
    expect(confirmCalls[0]).toMatchObject({ risk: 'write', declaredRisk: 'read' })
  })

  it('ui 档在 uiRequireConfirm 开启时提到 write（仍只升不降）', async () => {
    const openSpec: ToolSpec = {
      id: 'test.open',
      label: '打开应用',
      description: 'test ui tier',
      risk: 'ui',
      appId: null,
      command: 'app.open',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ opened: true }),
    }
    const { runtime, confirmCalls } = makeHarness([openSpec])
    const elevated = createToolRuntime([openSpec], {
      invoke: (async () => ({ id: 'a' })) as unknown as AssistantInvoke,
      confirm: async (request) => {
        confirmCalls.push(request)
        return true
      },
      onCard: () => {},
      policy: { uiRequireConfirm: true },
    })
    await elevated.beforeToolCall(ctx('test.open', {}))
    expect(confirmCalls[0]).toMatchObject({ risk: 'write', declaredRisk: 'ui' })
    expect(runtime).toBeDefined()
  })
})

describe('急停与失败语义', () => {
  it('halt 后：后续工具一律 block，审计 decision=stopped，执行体不运行', async () => {
    const { runtime, audits, cards } = makeHarness([timeNowTool()])
    runtime.halt()

    const blocked = await runtime.beforeToolCall(ctx('time.now', {}))
    expect(blocked?.block).toBe(true)
    expect(blocked?.reason).toContain('停止')
    expect(cards.get('tc-1')?.status).toBe('blocked')
    expect(audits[0]).toMatchObject({ decision: 'stopped', resultDigest: null })
  })

  it('等确认时 halt：立即按停止处理（队列中的工具不再执行）', async () => {
    const { runtime, audits, confirm } = makeHarness([testWriteTool()], {
      confirm: () => new Promise<boolean>(() => {}),
    })

    const pending = runtime.beforeToolCall(ctx('test.echo', { text: 'x' }))
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    runtime.halt()
    const blocked = await pending
    expect(blocked?.block).toBe(true)
    expect(audits[0]).toMatchObject({ decision: 'stopped' })
  })

  it('等确认时 abort：按停止处理', async () => {
    const { runtime, audits } = makeHarness([testWriteTool()], {
      confirm: () => new Promise<boolean>(() => {}),
    })
    const controller = new AbortController()
    const pending = runtime.beforeToolCall(ctx('test.echo', { text: 'x' }), controller.signal)
    controller.abort()
    const blocked = await pending
    expect(blocked?.block).toBe(true)
    expect(audits[0]).toMatchObject({ decision: 'stopped' })
  })

  it('执行失败返回 isError toolResult（不抛），审计 decision=error', async () => {
    const failing: ToolSpec = {
      id: 'test.fail',
      label: '失败工具',
      description: 'always throws',
      risk: 'read',
      appId: null,
      command: 'local:test.fail',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        throw new Error('boom')
      },
    }
    const { runtime, audits, cards } = makeHarness([failing])

    await runtime.beforeToolCall(ctx('test.fail', {}))
    const result = await runTool(runtime, 'test.fail', {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('boom')

    await runtime.afterToolCall({ ...ctx('test.fail', {}), result, isError: true })
    expect(cards.get('tc-1')?.status).toBe('error')
    expect(audits[0]).toMatchObject({ decision: 'error' })
  })

  it('审计写入失败：点名但不打断工具执行', async () => {
    const auditErrors: string[] = []
    const runtime = createToolRuntime([timeNowTool()], {
      invoke: (async (command: string) => {
        if (command === 'assistant.audit-record') throw new Error('db down')
        throw new Error(`unexpected ${command}`)
      }) as unknown as AssistantInvoke,
      confirm: async () => true,
      onCard: () => {},
      onAuditError: (message) => auditErrors.push(message),
    })

    expect(await runtime.beforeToolCall(ctx('time.now', {}))).toBeUndefined()
    expect(auditErrors.length).toBe(0) // read 档 before 不写审计
    const result = await runTool(runtime, 'time.now', {})
    await runtime.afterToolCall({ ...ctx('time.now', {}), result, isError: false })
    expect(auditErrors[0]).toContain('db down')
  })
})

describe('审计只落摘要', () => {
  it('参数 / 结果原文不出现在审计载荷里', async () => {
    const { runtime, audits } = makeHarness([testWriteTool()])
    const secret = 'my-secret-plaintext-42'

    await runtime.beforeToolCall(ctx('test.echo', { text: secret }))
    const result = await runTool(runtime, 'test.echo', { text: secret })
    await runtime.afterToolCall({
      ...ctx('test.echo', { text: secret }),
      result,
      isError: false,
    })

    const payload = JSON.stringify(audits)
    expect(payload).not.toContain(secret)
    expect(audits[0].argsDigest).toMatch(/^[0-9a-f]{12}$/)
    expect(audits[0].resultDigest).toMatch(/^[0-9a-f]{12}$/)
  })
})
