/**
 * 记忆管理单测（票 12 / spec §5.4）
 *
 * 用假 invoke 驱动 MemoryManager，覆盖：三态分类、收件箱确认 / 拒绝
 * （只走 set-status、不重写整行——拒绝不复活）、删除、清空（全部 / scope）、
 * 记忆与提取开关的默认值与落库值、会话摘要的存取键。
 */
import { describe, it, expect, vi } from 'vitest'
import { MemoryManager } from '@nest-shared/memory/manager'
import {
  ASSISTANT_MEMORY_CLEAR_COMMAND,
  ASSISTANT_MEMORY_DELETE_COMMAND,
  ASSISTANT_MEMORY_LIST_COMMAND,
  ASSISTANT_MEMORY_SET_STATUS_COMMAND,
  ASSISTANT_MEMORY_UPSERT_COMMAND,
  ASSISTANT_SETTINGS_GET_COMMAND,
  ASSISTANT_SETTINGS_SET_COMMAND,
  conversationSummaryKey,
  type MemoryFact,
} from '@nest-shared/types'

function fact(over: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'mem-1',
    scope: 'global',
    scopeRef: null,
    key: '饮食',
    value: '不吃香菜',
    sourceConversationId: 'nest-companion',
    sourceMessageId: null,
    status: 'pending',
    createdAt: '1',
    updatedAt: '1',
    ...over,
  }
}

interface Harness {
  manager: MemoryManager
  calls: Array<{ command: string; args?: Record<string, unknown> }>
  settings: Record<string, string>
}

function createHarness(facts: MemoryFact[] = []): Harness {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const settings: Record<string, string> = {}
  const invoke = vi.fn(async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args })
    switch (command) {
      case ASSISTANT_MEMORY_LIST_COMMAND:
        return { facts } as T
      case ASSISTANT_SETTINGS_GET_COMMAND: {
        const key = String(args?.key)
        return { value: settings[key] ?? null } as T
      }
      case ASSISTANT_SETTINGS_SET_COMMAND: {
        settings[String(args?.key)] = String(args?.value)
        return { ok: true } as T
      }
      case ASSISTANT_MEMORY_UPSERT_COMMAND:
        return { id: 'mem-new' } as T
      case ASSISTANT_MEMORY_CLEAR_COMMAND:
        return { ok: true, deleted: facts.length } as T
      default:
        return { ok: true } as T
    }
  })
  const manager = new MemoryManager({ invoke: invoke as never })
  return { manager, calls, settings }
}

describe('MemoryManager（票 12）', () => {
  it('listAll 按 status 分三态', async () => {
    const h = createHarness([
      fact({ id: 'a', status: 'confirmed' }),
      fact({ id: 'b', status: 'pending' }),
      fact({ id: 'c', status: 'rejected' }),
    ])
    const all = await h.manager.listAll()
    expect(all.confirmed.map((f) => f.id)).toEqual(['a'])
    expect(all.pending.map((f) => f.id)).toEqual(['b'])
    expect(all.rejected.map((f) => f.id)).toEqual(['c'])
    expect(h.calls[0].command).toBe(ASSISTANT_MEMORY_LIST_COMMAND)
  })

  it('upsert 缺省进 pending 收件箱，携带 nonce 与来源', async () => {
    const h = createHarness()
    const id = await h.manager.upsert({
      scope: 'global',
      key: '饮食',
      value: '不吃香菜',
      sourceConversationId: 'nest-companion',
    })
    expect(id).toBe('mem-new')
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_UPSERT_COMMAND)!
    expect(call.args).toMatchObject({
      scope: 'global',
      key: '饮食',
      value: '不吃香菜',
      status: 'pending',
      sourceConversationId: 'nest-companion',
    })
    expect(typeof call.args?.nonce).toBe('string')
    expect((call.args?.nonce as string).length).toBeGreaterThan(0)
  })

  it('确认只走 set-status，不重写整行（拒绝不复活的口径）', async () => {
    const h = createHarness()
    await h.manager.confirm('mem-1')
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_SET_STATUS_COMMAND)!
    expect(call.args).toEqual({ id: 'mem-1', status: 'confirmed' })
    expect(h.calls.some((c) => c.command === ASSISTANT_MEMORY_UPSERT_COMMAND)).toBe(false)
  })

  it('拒绝走 set-status 为 rejected', async () => {
    const h = createHarness()
    await h.manager.reject('mem-1')
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_SET_STATUS_COMMAND)!
    expect(call.args).toEqual({ id: 'mem-1', status: 'rejected' })
  })

  it('删除立即执行（「忘记这条」）', async () => {
    const h = createHarness()
    await h.manager.delete('mem-1')
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_DELETE_COMMAND)!
    expect(call.args).toEqual({ id: 'mem-1' })
  })

  it('清空全部记忆以 scope=* 执行并返回计数', async () => {
    const h = createHarness([fact({ id: 'a' }), fact({ id: 'b' })])
    const deleted = await h.manager.clearAll()
    expect(deleted).toBe(2)
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_CLEAR_COMMAND)!
    expect(call.args).toEqual({ scope: '*' })
  })

  it('按 scope 清空', async () => {
    const h = createHarness()
    await h.manager.clearScope('app')
    const call = h.calls.find((c) => c.command === ASSISTANT_MEMORY_CLEAR_COMMAND)!
    expect(call.args).toEqual({ scope: 'app' })
  })

  it('记忆开关：缺省开、关时落 0、开时落 1', async () => {
    const h = createHarness()
    // 缺省（无设置值）= 开
    expect(await h.manager.isMemoryEnabled()).toBe(true)
    await h.manager.setMemoryEnabled(false)
    expect(h.settings['memory.enabled']).toBe('0')
    expect(await h.manager.isMemoryEnabled()).toBe(false)
    await h.manager.setMemoryEnabled(true)
    expect(h.settings['memory.enabled']).toBe('1')
    expect(await h.manager.isMemoryEnabled()).toBe(true)
  })

  it('提取开关：缺省开、可关', async () => {
    const h = createHarness()
    expect(await h.manager.isExtractEnabled()).toBe(true)
    await h.manager.setExtractEnabled(false)
    expect(h.settings['memory.extractEnabled']).toBe('0')
    expect(await h.manager.isExtractEnabled()).toBe(false)
  })

  it('会话摘要按 conversation.summary:<id> 存取', async () => {
    const h = createHarness()
    expect(await h.manager.getSummary('nest-companion')).toBeNull()
    await h.manager.setSummary('nest-companion', '较早内容摘要')
    expect(h.settings[conversationSummaryKey('nest-companion')]).toBe('较早内容摘要')
    expect(await h.manager.getSummary('nest-companion')).toBe('较早内容摘要')
  })

  it('命令失败原样抛出（不静默吞错，fail-visible）', async () => {
    const calls: Array<{ command: string }> = []
    const manager = new MemoryManager({
      invoke: (async (command: string) => {
        calls.push({ command })
        throw new Error('保险库未解锁')
      }) as never,
    })
    await expect(manager.listAll()).rejects.toThrow('保险库未解锁')
  })
})
