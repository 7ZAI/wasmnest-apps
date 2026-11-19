/**
 * 记忆工具单测（票 14 / spec §5.6）
 *
 * 用真实 MemoryManager（假 invoke 驱动）装配 remember / recall / forget
 * 三个工具描述符，覆盖：
 * - remember 写 pending 收件箱 + 来源（会话 / 消息）；缺参数报错；
 * - recall 按 scope / 关键词过滤已确认事实，无命中点名；
 * - forget 按 id 删除 / 按 scope 清空；缺参数报错；
 * - 风险档位：remember=write、recall=read、forget=danger（确认 UX 的输入）。
 */
import { describe, it, expect, vi } from 'vitest'
import { MemoryManager } from '@nest-shared/memory/manager'
import {
  buildMemoryToolDescriptors,
  type MemoryToolSource,
} from '@nest-shared/tools/memory-tools'
import type { MemoryFact } from '@nest-shared/types'

function fact(over: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'f1',
    scope: 'global',
    scopeRef: null,
    key: '饮食',
    value: '不吃香菜',
    sourceConversationId: 'nest-companion',
    sourceMessageId: null,
    status: 'confirmed',
    createdAt: '1',
    updatedAt: '1',
    ...over,
  }
}

interface Harness {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  calls: Array<{ command: string; args?: Record<string, unknown> }>
  settings: Record<string, string>
  /** 当前存储内容（数组会被重新赋值，用 getter 取最新引用） */
  getFacts: () => MemoryFact[]
}

function createHarness(facts: MemoryFact[] = []): Harness {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const settings: Record<string, string> = {}
  const state = { facts }
  const invoke = vi.fn(async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args })
    switch (command) {
      case 'assistant.memory-list': {
        const scope = String(args?.scope ?? '')
        const status = String(args?.status ?? '')
        const filtered = state.facts.filter(
          (f) => (!scope || f.scope === scope) && (!status || f.status === status),
        )
        return { facts: filtered } as T
      }
      case 'assistant.memory-set-status': {
        const id = String(args?.id)
        const status = String(args?.status) as MemoryFact['status']
        state.facts = state.facts.map((f) => (f.id === id ? { ...f, status } : f))
        return { ok: true, updated: true } as T
      }
      case 'assistant.memory-upsert': {
        const id = String(args?.id ?? `mem-${calls.length}`)
        const created: MemoryFact = {
          id,
          scope: String(args?.scope) as MemoryFact['scope'],
          scopeRef: (args?.scopeRef as string) ?? null,
          key: String(args?.key),
          value: String(args?.value),
          sourceConversationId: (args?.sourceConversationId as string) ?? null,
          sourceMessageId: (args?.sourceMessageId as string) ?? null,
          status: String(args?.status ?? 'pending') as MemoryFact['status'],
          createdAt: '1',
          updatedAt: '1',
        }
        state.facts = [...state.facts.filter((f) => f.id !== id), created]
        return { ok: true, id } as T
      }
      case 'assistant.memory-delete': {
        const id = String(args?.id)
        state.facts = state.facts.filter((f) => f.id !== id)
        return { ok: true, deleted: true } as T
      }
      case 'assistant.memory-clear': {
        const scope = String(args?.scope)
        if (scope === '*') state.facts = []
        else state.facts = state.facts.filter((f) => f.scope !== scope)
        return { ok: true, deleted: 1 } as T
      }
      case 'assistant.settings-get':
        return { value: settings[String(args?.key)] ?? null } as T
      case 'assistant.settings-set':
        settings[String(args?.key)] = String(args?.value)
        return { ok: true } as T
      default:
        return { ok: true } as T
    }
  })
  return { invoke: invoke as <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>, calls, settings, getFacts: () => state.facts }
}

function buildTools(h: Harness, source?: Partial<MemoryToolSource>) {
  const manager = new MemoryManager({ invoke: h.invoke as never })
  const fullSource: MemoryToolSource = {
    conversationId: () => 'nest-companion',
    sourceMessageId: () => 'user-msg-1',
    ...source,
  }
  return buildMemoryToolDescriptors(manager, fullSource)
}

const [remember, recall, forget] = buildTools(createHarness())

describe('记忆工具（票 14）', () => {
  it('风险档位：remember=write、recall=read、forget=danger', () => {
    expect(remember.risk).toBe('write')
    expect(recall.risk).toBe('read')
    expect(forget.risk).toBe('danger')
  })

  it('remember 写 pending 收件箱，带来源（会话 / 消息）', async () => {
    const h = createHarness()
    const [r] = buildTools(h)
    const res = await r.executor!({ key: '饮食', value: '不吃香菜' })
    expect(res.error).toBeUndefined()
    expect(res.text).toContain('收件箱')
    const upsert = h.calls.find((c) => c.command === 'assistant.memory-upsert')!
    expect(upsert.args).toMatchObject({
      key: '饮食',
      value: '不吃香菜',
      status: 'pending',
      scope: 'global',
      sourceConversationId: 'nest-companion',
      sourceMessageId: 'user-msg-1',
    })
  })

  it('remember 缺 key / value 显性报错', async () => {
    const [r] = buildTools(createHarness())
    const res = await r.executor!({ key: '', value: '' })
    expect(res.error).toBeTruthy()
    expect(res.error).toContain('key')
  })

  it('remember 支持 conversation 作用域并带 scopeRef', async () => {
    const h = createHarness()
    const [r] = buildTools(h)
    await r.executor!({ key: 'k', value: 'v', scope: 'conversation' })
    const upsert = h.calls.find((c) => c.command === 'assistant.memory-upsert')!
    expect(upsert.args).toMatchObject({ scope: 'conversation', scopeRef: 'nest-companion' })
  })

  it('recall 只返回已确认事实并按关键词过滤', async () => {
    const h = createHarness([
      fact({ id: 'a', key: '饮食', value: '不吃香菜' }),
      fact({ id: 'b', key: '工作', value: '远程办公' }),
      fact({ id: 'c', status: 'pending' }),
    ])
    const [, r] = buildTools(h)
    const res = await r.executor!({ keyword: '香菜' })
    expect(res.text).toContain('不吃香菜')
    expect(res.text).not.toContain('远程办公')
    expect(res.text).not.toContain('pending')
  })

  it('recall 无命中时点名（不静默返回空）', async () => {
    const [, r] = buildTools(createHarness([fact()]))
    const res = await r.executor!({ keyword: '不存在的关键词' })
    expect(res.text).toContain('没有找到')
  })

  it('recall 按 scope 过滤', async () => {
    const h = createHarness([
      fact({ id: 'a', scope: 'global' }),
      fact({ id: 'b', scope: 'app', scopeRef: 'monitor', key: '指标', value: '内存快照' }),
    ])
    const [, r] = buildTools(h)
    const res = await r.executor!({ scope: 'app' })
    expect(res.text).toContain('内存快照')
    expect(res.text).not.toContain('不吃香菜')
  })

  it('forget 按 id 删除', async () => {
    const h = createHarness([fact({ id: 'a' })])
    const [, , f] = buildTools(h)
    const res = await f.executor!({ id: 'a' })
    expect(res.error).toBeUndefined()
    expect(res.text).toContain('已删除')
    const del = h.calls.find((c) => c.command === 'assistant.memory-delete')!
    expect(del.args).toEqual({ id: 'a' })
  })

  it('forget 按 scope 清空', async () => {
    const h = createHarness([fact({ id: 'a' })])
    const [, , f] = buildTools(h)
    const res = await f.executor!({ scope: 'global' })
    expect(res.text).toContain('清空')
    const clear = h.calls.find((c) => c.command === 'assistant.memory-clear')!
    expect(clear.args).toEqual({ scope: 'global' })
  })

  it('forget 缺 id / scope 显性报错', async () => {
    const [, , f] = buildTools(createHarness())
    const res = await f.executor!({})
    expect(res.error).toBeTruthy()
    expect(res.error).toContain('id')
  })

  it('三件套工具名与描述齐全（模型可见面）', () => {
    expect(remember.name).toBe('memory.remember')
    expect(recall.name).toBe('memory.recall')
    expect(forget.name).toBe('memory.forget')
    for (const d of [remember, recall, forget]) {
      expect(d.label.length).toBeGreaterThan(0)
      expect(d.description.length).toBeGreaterThan(0)
      expect(d.argsSchema.type).toBe('object')
    }
  })

  it('端到端串：记住 → 收件箱 → 确认 → 新会话召回 → 删除后不召回（票 14）', async () => {
    const h = createHarness()
    // 会话 A：模型调用 remember（用户说「记住我不吃香菜」）
    const toolsA = buildTools(h)
    const rememberA = toolsA[0]
    const res = await rememberA.executor!({ key: '饮食', value: '不吃香菜' })
    expect(res.text).toContain('收件箱')
    // 收件箱出现：pending 状态可查
    const pending = h.getFacts().filter((f) => f.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].value).toBe('不吃香菜')

    // 用户在记忆页确认
    const managerA = new MemoryManager({ invoke: h.invoke as never })
    await managerA.confirm(pending[0].id)
    expect(h.getFacts().find((f) => f.id === pending[0].id)?.status).toBe('confirmed')

    // 会话 B（新 MemoryManager，同一存储）：召回命中
    const toolsB = buildTools(h)
    const recallB = toolsB[1]
    const recalled = await recallB.executor!({ keyword: '香菜' })
    expect(recalled.text).toContain('不吃香菜')

    // 删除后：新会话不再召回
    await managerA.delete(pending[0].id)
    const toolsC = buildTools(h)
    const recallC = toolsC[1]
    const after = await recallC.executor!({ keyword: '香菜' })
    expect(after.text).toContain('没有找到')
  })
})
