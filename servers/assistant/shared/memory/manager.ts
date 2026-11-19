/**
 * 记忆管理（票 12 / spec §5.3、§5.4）
 *
 * 双端同构的共享核：把「已确认事实 / 待确认收件箱 / 已拒绝」三态记忆与
 * 设置开关接到插件私有库命令面。UI（MemoryView）只吃本模块，不直连命令。
 *
 * 关键口径：
 * - 收件箱确认 / 拒绝走 `memory-set-status`（只改 status，其余字段不动）；
 *   拒绝过的条目不会被后续提取自动复活（提取总是写新行，spec §5.4）。
 * - 「清空全部记忆」由 UI 二次确认后调用；命令层只执行与计数。
 * - 记忆开关关闭后：不再写入、不再参与检索（注入侧见票 14），已有数据保留。
 * - 未解锁时正文不可见由 Rust 命令显性报错（沿用票 07 密文口径）。
 */
import { randomHex, NONCE_BYTES } from '../vault'
import {
  ASSISTANT_MEMORY_CLEAR_COMMAND,
  ASSISTANT_MEMORY_DELETE_COMMAND,
  ASSISTANT_MEMORY_LIST_COMMAND,
  ASSISTANT_MEMORY_SET_STATUS_COMMAND,
  ASSISTANT_MEMORY_UPSERT_COMMAND,
  ASSISTANT_SETTINGS_GET_COMMAND,
  ASSISTANT_SETTINGS_SET_COMMAND,
  MEMORY_ENABLED_SETTING,
  MEMORY_EXTRACT_SETTING,
  conversationSummaryKey,
  type AssistantInvoke,
  type MemoryFact,
  type MemoryScope,
  type MemoryStatus,
} from '../types'

export interface MemoryManagerDeps {
  invoke: AssistantInvoke
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** 布尔设置的落库值（与 Rust value_json 口径一致：原始字符串） */
function boolSettingValue(on: boolean): string {
  return on ? '1' : '0'
}

export class MemoryManager {
  private deps: MemoryManagerDeps

  constructor(deps: MemoryManagerDeps) {
    this.deps = deps
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message)
  }

  // ==================== 读 ====================

  /** 按 scope / status 过滤拉取（空串 = 不过滤；仅解锁后可读正文） */
  async list(scope: MemoryScope | '' = '', status: MemoryStatus | '' = ''): Promise<MemoryFact[]> {
    const res = await this.deps.invoke<{ facts: MemoryFact[] }>(ASSISTANT_MEMORY_LIST_COMMAND, {
      scope,
      status,
    })
    return res?.facts ?? []
  }

  /** 三视图一次性拉齐（管理页切换 tab 不重复请求） */
  async listAll(): Promise<{ confirmed: MemoryFact[]; pending: MemoryFact[]; rejected: MemoryFact[] }> {
    const res = await this.deps.invoke<{ facts: MemoryFact[] }>(ASSISTANT_MEMORY_LIST_COMMAND, {})
    const facts = res?.facts ?? []
    return {
      confirmed: facts.filter((f) => f.status === 'confirmed'),
      pending: facts.filter((f) => f.status === 'pending'),
      rejected: facts.filter((f) => f.status === 'rejected'),
    }
  }

  // ==================== 写 ====================

  /** 新增 / 编辑一条记忆（编辑传原 id 与原 status，只换 value） */
  async upsert(input: {
    id?: string
    scope: MemoryScope
    scopeRef?: string | null
    key: string
    value: string
    status?: MemoryStatus
    sourceConversationId?: string | null
    sourceMessageId?: string | null
  }): Promise<string> {
    const res = await this.deps.invoke<{ id: string }>(ASSISTANT_MEMORY_UPSERT_COMMAND, {
      ...(input.id ? { id: input.id } : {}),
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      key: input.key,
      value: input.value,
      nonce: randomHex(NONCE_BYTES),
      status: input.status ?? 'pending',
      ts: Date.now().toString(),
      sourceConversationId: input.sourceConversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    const id = res?.id
    if (!id) throw new Error('记忆写入失败：未返回 id')
    return id
  }

  /** 收件箱确认（pending → confirmed） */
  async confirm(id: string): Promise<void> {
    await this.deps.invoke(ASSISTANT_MEMORY_SET_STATUS_COMMAND, { id, status: 'confirmed' })
  }

  /** 收件箱拒绝（pending → rejected；不会被后续提取复活） */
  async reject(id: string): Promise<void> {
    await this.deps.invoke(ASSISTANT_MEMORY_SET_STATUS_COMMAND, { id, status: 'rejected' })
  }

  /** 「忘记这条」：立即删除 */
  async delete(id: string): Promise<void> {
    await this.deps.invoke(ASSISTANT_MEMORY_DELETE_COMMAND, { id })
  }

  /** 清空全部记忆（UI 二次确认后调用） */
  async clearAll(): Promise<number> {
    const res = await this.deps.invoke<{ deleted: number }>(ASSISTANT_MEMORY_CLEAR_COMMAND, {
      scope: '*',
    })
    return res?.deleted ?? 0
  }

  /** 按 scope 清空（forget 的 scope 级清空） */
  async clearScope(scope: MemoryScope): Promise<number> {
    const res = await this.deps.invoke<{ deleted: number }>(ASSISTANT_MEMORY_CLEAR_COMMAND, {
      scope,
    })
    return res?.deleted ?? 0
  }

  // ==================== 开关 ====================

  /** 记忆总开关（默认开）：关闭后不再写入、不再参与检索，数据保留 */
  async isMemoryEnabled(): Promise<boolean> {
    const raw = await this.getSetting(MEMORY_ENABLED_SETTING)
    return raw !== '0'
  }

  async setMemoryEnabled(on: boolean): Promise<void> {
    await this.setSetting(MEMORY_ENABLED_SETTING, boolSettingValue(on))
  }

  /** 每轮提取开关（默认开） */
  async isExtractEnabled(): Promise<boolean> {
    const raw = await this.getSetting(MEMORY_EXTRACT_SETTING)
    return raw !== '0'
  }

  async setExtractEnabled(on: boolean): Promise<void> {
    await this.setSetting(MEMORY_EXTRACT_SETTING, boolSettingValue(on))
  }

  // ==================== 会话摘要（票 09 钩子 / 票 12 存储） ====================

  /** 读会话摘要（无则 null；只入 transcript，不进 UI 消息流） */
  async getSummary(conversationId: string): Promise<string | null> {
    return this.getSetting(conversationSummaryKey(conversationId))
  }

  async setSummary(conversationId: string, text: string): Promise<void> {
    await this.setSetting(conversationSummaryKey(conversationId), text)
  }

  // ==================== 设置原语 ====================

  private async getSetting(key: string): Promise<string | null> {
    const res = await this.deps.invoke<{ value: string | null }>(ASSISTANT_SETTINGS_GET_COMMAND, {
      key,
    })
    return res?.value ?? null
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.deps.invoke(ASSISTANT_SETTINGS_SET_COMMAND, { key, value })
  }
}
