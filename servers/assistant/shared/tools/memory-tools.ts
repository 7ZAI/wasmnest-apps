/**
 * 记忆工具（票 14 / spec §5.6）
 *
 * - `memory.remember`（write，需确认）：把用户说的事写进待确认收件箱；
 * - `memory.recall`（read）：按 scope / 关键词取已确认事实；
 * - `memory.forget`（danger，二次确认）：删除指定事实或清空 scope。
 *
 * 执行器经 MemoryManager 落库；来源（会话 / 消息）由会话在装配时注入，
 * 保证每条记忆可追溯（spec §5.4）。工具结果不写进长期记忆（应用数据
 * 口径，见票 14 检查项）。
 */
import type { MemoryManager } from '../memory/manager'
import type { MemoryFact, MemoryScope } from '../types'
import type { ToolDescriptor } from './types'

/** 记忆工具装配的上下文（来源追溯用） */
export interface MemoryToolSource {
  /** 当前会话 id（remember 的来源会话） */
  conversationId: () => string | null
  /** 触发本轮的用户消息 id（remember 的来源消息） */
  sourceMessageId: () => string | null
}

/** `memory.remember`：写 pending 收件箱（用户确认后成为长期记忆） */
export function rememberDescriptor(manager: MemoryManager, source: MemoryToolSource): ToolDescriptor {
  return {
    name: 'memory.remember',
    label: '记住一件事',
    description:
      '把用户明确告知的事情写入记忆收件箱（待用户确认后才会成为长期记忆）。用于用户说「记住……」或明确表达希望 Nest 记住的偏好 / 个人信息。',
    argsSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '简短标签，如「饮食」「工作习惯」' },
        value: { type: 'string', description: '要记住的事实内容' },
        scope: {
          type: 'string',
          enum: ['global', 'conversation'],
          description: '作用域：global（跨会话，默认）或 conversation（仅本会话）',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    risk: 'write',
    impact: '将向记忆收件箱写入一条待确认条目；用户确认后成为长期记忆，影响后续对话的上下文。',
    async executor(args) {
      const a = (args ?? {}) as { key?: string; value?: string; scope?: string }
      const key = (a.key ?? '').trim()
      const value = (a.value ?? '').trim()
      if (!key || !value) {
        return { error: 'memory.remember 需要 key 与 value' }
      }
      const scope: MemoryScope = a.scope === 'conversation' ? 'conversation' : 'global'
      const convId = source.conversationId()
      const id = await manager.upsert({
        scope,
        scopeRef: scope === 'conversation' ? convId : null,
        key,
        value,
        status: 'pending',
        sourceConversationId: convId,
        sourceMessageId: source.sourceMessageId(),
      })
      return { text: `已写入记忆收件箱（待确认）：${key} —— ${value}（id: ${id}）` }
    },
  }
}

/** `memory.recall`：按 scope / 关键词取已确认事实 */
export function recallDescriptor(manager: MemoryManager): ToolDescriptor {
  return {
    name: 'memory.recall',
    label: '查询记忆',
    description:
      '按作用域与关键词检索已确认的长期记忆。当需要引用「我记得……」类信息时，必须先用本工具查询，不得凭印象编造。',
    argsSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['global', 'app', 'conversation'],
          description: '作用域过滤（可选）',
        },
        keyword: { type: 'string', description: '关键词过滤（匹配条目名与内容，可选）' },
        limit: { type: 'number', description: '最多返回条数（默认 10）' },
      },
      additionalProperties: false,
    },
    risk: 'read',
    async executor(args) {
      const a = (args ?? {}) as { scope?: string; keyword?: string; limit?: number }
      const scope = a.scope === 'global' || a.scope === 'app' || a.scope === 'conversation' ? a.scope : ''
      const keyword = (a.keyword ?? '').trim().toLowerCase()
      const limit = typeof a.limit === 'number' && a.limit > 0 ? Math.min(a.limit, 50) : 10

      const facts = await manager.list(scope, 'confirmed')
      const matched = keyword
        ? facts.filter((f) => (f.key + f.value).toLowerCase().includes(keyword))
        : facts
      if (matched.length === 0) {
        return { text: keyword ? `没有找到与「${a.keyword}」相关的已确认记忆。` : '没有已确认的记忆。' }
      }
      const lines = matched.slice(0, limit).map(
        (f) => `- ${f.key}：${f.value}（${f.scope}${f.scopeRef ? `/${f.scopeRef}` : ''}）`,
      )
      return { text: `找到 ${matched.length} 条记忆（显示前 ${lines.length} 条）：\n${lines.join('\n')}` }
    },
  }
}

/** `memory.forget`：删除指定事实或清空 scope（danger，二次确认） */
export function forgetDescriptor(manager: MemoryManager): ToolDescriptor {
  return {
    name: 'memory.forget',
    label: '忘记一件事',
    description:
      '删除指定的记忆条目，或清空某个作用域的全部记忆。仅在用户明确要求「忘记 / 别记住」时使用；需要二次确认。',
    argsSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的记忆条目 id（与 scope 二选一）' },
        scope: {
          type: 'string',
          enum: ['global', 'app', 'conversation'],
          description: '清空指定作用域的全部记忆（与 id 二选一）',
        },
      },
      additionalProperties: false,
    },
    risk: 'danger',
    impact: '将永久删除记忆条目或清空指定作用域的全部记忆，删除后不再参与检索与注入，且不可恢复。',
    async executor(args) {
      const a = (args ?? {}) as { id?: string; scope?: string }
      const id = (a.id ?? '').trim()
      const scope = a.scope === 'global' || a.scope === 'app' || a.scope === 'conversation' ? a.scope : ''
      if (id) {
        const fact = await manager.list('', '').then((all) => all.find((f) => f.id === id))
        await manager.delete(id)
        return { text: fact ? `已删除记忆：${fact.key}` : `已删除记忆（id: ${id}）` }
      }
      if (scope) {
        const deleted = await manager.clearScope(scope)
        return { text: `已清空 ${scope} 作用域的 ${deleted} 条记忆` }
      }
      return { error: 'memory.forget 需要 id 或 scope' }
    },
  }
}

/** 记忆工具三件套（会话装配用） */
export function buildMemoryToolDescriptors(
  manager: MemoryManager,
  source: MemoryToolSource,
): ToolDescriptor[] {
  return [rememberDescriptor(manager, source), recallDescriptor(manager), forgetDescriptor(manager)]
}

/** 供测试 / 展示：把 MemoryFact 列表格式化为可读文本 */
export function formatMemoryFacts(facts: MemoryFact[]): string {
  if (facts.length === 0) return '（无）'
  return facts.map((f) => `- ${f.key}：${f.value}`).join('\n')
}
