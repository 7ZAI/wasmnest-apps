/**
 * Nest 对话会话编排（票 08 / 票 09 多会话 / spec §3.2、§5.2、§5.3）
 *
 * 双端同构的共享核：把 pi Agent、插件私有库（会话 / 消息密文落库）、
 * 宿主流事件、UI 消息卡四者接起来。端侧只提供 `invoke` / `subscribe`
 * 两个宿主适配，其余逻辑全部在此。
 *
 * 一次发送（spec §3.2）：
 * 1. 校验前置（默认 provider 存在、保险库已解锁），不满足点名缺什么；
 * 2. 用户消息密文落库（先落库再流式，崩溃不丢用户输入）；
 * 3. `agent.prompt()` → StreamFn 构建请求 → 宿主流式推送；
 * 4. `message_update` 增量渲染；`message_end` 按 stopReason 结算：
 *    成功 / 中止 → 助手消息落库；错误 → 错误卡可重试（不落库空消息）；
 * 5. 重试 = 移除失败的助手消息后 `agent.continue()`（不重放任何副作用，
 *    M1 无工具，副作用面为零）。
 *
 * 多会话（票 09）：默认长期陪伴会话（`DEFAULT_COMPANION_ID`，不可归档）+
 * 若干任务会话；冷启动按「最近 N 条 + 摘要」恢复上下文（N 与摘要阈值可配，
 * 默认值见 types.ts 常量，票内记录）；`resolveSummary` / `resolveMemoryContext`
 * 为上下文补全钩子，本票只留接口，注入实现归票 12 / 14。
 */
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message, TextContent } from '@earendil-works/pi-ai'
import { createNestAgent } from '../agent/agent'
import { buildSystemPrompt, type PromptLang } from '../prompt/system'
import { apiStyleToPiApi } from '../providers/styles'
import { randomHex, NONCE_BYTES } from '../vault'
import { buildCoreToolDescriptors } from '../tools/catalog'
import { buildToolRuntime } from '../tools/runtime'
import { buildMemoryToolDescriptors, type MemoryToolSource } from '../tools/memory-tools'
import {
  buildAppBaseDescriptors,
  buildAppInvokeDescriptorsFromSnapshot,
} from '../tools/app-tools'
import type { ToolDescriptor } from '../tools/types'
import { MemoryManager } from '../memory/manager'
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  formatMemoryContextBlock,
  parseExtractedFacts,
  parseSummary,
  selectMemoryForInjection,
} from '../memory/extract'
import type { ConfirmationDecision, ToolCardState, ToolRuntimeHandle } from '../tools/types'
import {
  ASSISTANT_CONVERSATIONS_ARCHIVE_COMMAND,
  ASSISTANT_CONVERSATIONS_CREATE_COMMAND,
  ASSISTANT_CONVERSATIONS_LIST_COMMAND,
  ASSISTANT_CONVERSATIONS_RENAME_COMMAND,
  ASSISTANT_MESSAGES_APPEND_COMMAND,
  ASSISTANT_MESSAGES_COUNT_COMMAND,
  ASSISTANT_MESSAGES_LIST_COMMAND,
  ASSISTANT_PROVIDERS_LIST_COMMAND,
  ASSISTANT_SETTINGS_GET_COMMAND,
  ASSISTANT_VAULT_GET_SECRET_COMMAND,
  CONTEXT_LIMIT_SETTING,
  DEFAULT_COMPANION_ID,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_SUMMARY_THRESHOLD,
  SUMMARY_THRESHOLD_SETTING,
  VAULT_STATUS_COMMAND,
  providerSecretKey,
  type AssistantInvoke,
  type AppInvokeBridge,
  type ChatMessage,
  type ConversationRecord,
  type MemoryFact,
  type MessageRecord,
  type ProviderRecord,
} from '../types'

/** 前置条件失败（无 provider / 保险库未解锁等）：点名缺什么，不静默 */
export class ChatPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatPreconditionError'
  }
}

export interface ChatSessionDeps {
  invoke: AssistantInvoke
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void
  lang: PromptLang
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
  /**
   * 会话摘要钩子（票 09 留接口，生成归票 12）：返回该会话的摘要文本，
   * 冷启动恢复上下文时置于最近 N 条消息之前；返回 null / 未提供则不用。
   */
  resolveSummary?: (conversationId: string) => Promise<string | null>
  /**
   * 跨会话共享记忆读取钩子（票 09 留接口，注入归票 14）：返回共享记忆
   * 的上下文文本，置于 transcript 最前；返回 null / 未提供则不用。
   */
  resolveMemoryContext?: () => Promise<string | null>
  /** 应用调用桥（宿主按 apps:control 注入；未注入 = 无应用工具能力） */
  apps?: AppInvokeBridge | null
}

/** 本地生成的临时消息 id（未落库的流式卡） */
function localId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomHex(4)}`
}

export class NestChatSession {
  conversations: ConversationRecord[] = []
  /** 已归档会话（不进默认列表，可查可恢复；票 09） */
  archivedConversations: ConversationRecord[] = []
  currentId: string | null = null
  messages: ChatMessage[] = []
  streaming = false
  providers: ProviderRecord[] = []
  /** 工具调用卡片（票 13；运行时持有，UI 只读 + 回确认决定） */
  toolCards: ToolCardState[] = []
  /** 本轮实际注入的记忆清单（票 14；UI 可展开查看「本次会带上这些记忆」） */
  currentMemoryFacts: MemoryFact[] = []
  /** 提取失败提示（票 14：不静默吞错，用户可见「本轮未提取记忆」） */
  memoryNotice = ''

  /** 下一条消息的序号（已加载历史之后；诊断 / 测试用） */
  get nextSeq(): number {
    return this.lastSeq + 1
  }

  private agent: Agent | null = null
  private agentProviderId: string | null = null
  private lastSeq = 0
  private unsubscribeAgent: (() => void) | null = null
  private streamingMsgId: string | null = null
  /** 当前 agent 使用的记忆上下文（复用判据之一，票 14） */
  private agentMemoryContext: string | null = null
  /** 当前会话的摘要文本（仅入 transcript，不进 UI 消息流；票 09） */
  private summaryText: string | null = null
  private deps: ChatSessionDeps
  /** 工具运行时（票 13；目录 = 核心本地工具 + 记忆工具 + 应用工具） */
  private runtime: ToolRuntimeHandle | null = null
  /** 基础工具目录（核心 + 记忆 + 应用基础件；应用 invoke 目录随桥刷新） */
  private baseDescriptors: ToolDescriptor[] = []
  /** 记忆管理（票 12；票 14 的记忆工具与注入复用） */
  private memoryManager: MemoryManager
  /** 本轮注入用的记忆上下文文本（构建 transcript 用） */
  private memoryContextText: string | null = null
  /** 最近一条用户消息（提取来源与关键词） */
  private lastUserText = ''
  private lastUserMessageId: string | null = null

  constructor(deps: ChatSessionDeps) {
    this.deps = deps
    this.memoryManager = new MemoryManager({ invoke: deps.invoke, log: (l, m) => this.log(l, m) })
    // 工具运行时随会话创建：基础目录（核心本地工具 + 记忆工具（票 14）
    // + 应用基础件（票 15））先行注册；app.invoke.* 目录随桥快照刷新。
    // 卡片数组在 ChatView 侧包响应式。
    this.runtime = buildToolRuntime({
      invoke: deps.invoke,
      apps: deps.apps ?? null,
      log: (l, msg) => this.log(l, msg),
    })
    const memorySource: MemoryToolSource = {
      conversationId: () => this.currentId,
      sourceMessageId: () => this.lastUserMessageId,
    }
    this.baseDescriptors = [
      ...buildCoreToolDescriptors(),
      ...buildMemoryToolDescriptors(this.memoryManager, memorySource),
      ...buildAppBaseDescriptors(deps.apps ?? null),
    ]
    for (const descriptor of this.baseDescriptors) {
      this.runtime.register(descriptor)
    }
    this.runtime.refresh()
    this.toolCards = this.runtime.cards
  }

  /**
   * 刷新应用工具目录（票 15）：拉桥目录快照，重建 `app.invoke.<toolId>`
   * 工具。桥缺失 / 拉取失败时只保留基础件（app.list 等仍会显性报错），
   * 不静默。ensureAgent 每次构建前调用，应用目录变化在下次发送生效。
   */
  async refreshAppTools(): Promise<void> {
    const apps = this.deps.apps
    let invokeDescriptors: ToolDescriptor[] = []
    if (apps) {
      try {
        const snapshot = await apps.list()
        invokeDescriptors = buildAppInvokeDescriptorsFromSnapshot(apps, snapshot)
      } catch (e) {
        this.log('warn', `[nest] 拉取应用工具目录失败，本会话不注册应用工具：${errMsg(e)}`)
      }
    }
    this.runtime?.replaceCatalog([...this.baseDescriptors, ...invokeDescriptors])
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message)
  }

  // ==================== 供应商 / 保险库 ====================

  async refreshProviders(): Promise<ProviderRecord[]> {
    const res = await this.deps.invoke<{ providers: ProviderRecord[] }>(
      ASSISTANT_PROVIDERS_LIST_COMMAND,
    )
    this.providers = res?.providers ?? []
    return this.providers
  }

  /** 默认 provider（无默认时取第一个） */
  defaultProvider(): ProviderRecord | null {
    return this.providers.find((p) => p.isDefault) ?? this.providers[0] ?? null
  }

  async vaultUnlocked(): Promise<boolean> {
    // 不吞错：状态查询失败（未建库 / 通道异常）必须向上点名，
    // 否则会被下游伪装成「没有可用的 provider」（spec §2.4）
    const st = await this.deps.invoke<{ exists: boolean; unlocked: boolean }>(
      VAULT_STATUS_COMMAND,
    )
    return Boolean(st?.exists && st?.unlocked)
  }

  /**
   * 取 provider 密钥（按需从保险库解密）。
   *
   * 返回 null 只表示「保险库已解锁但没有这条密钥」；未解锁 / 通道失败一律抛出，
   * 由调用方按实际原因点名（不把「锁着」误报成「没设置」）。
   */
  async getProviderKey(providerId: string): Promise<string | null> {
    const res = await this.deps.invoke<{ value: string }>(ASSISTANT_VAULT_GET_SECRET_COMMAND, {
      key: providerSecretKey(providerId),
    })
    return res?.value ?? null
  }

  // ==================== 会话管理（票 09 多会话） ====================

  /** 读设置值（无值返回 null；失败不静默，交由调用方点名） */
  async getSetting(key: string): Promise<string | null> {
    const res = await this.deps.invoke<{ value: string | null }>(ASSISTANT_SETTINGS_GET_COMMAND, {
      key,
    })
    return res?.value ?? null
  }

  /** 冷启动上下文恢复的最近消息条数（可配，默认 DEFAULT_CONTEXT_LIMIT，票内记录） */
  async contextLimit(): Promise<number> {
    const raw = await this.getSetting(CONTEXT_LIMIT_SETTING)
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_LIMIT
  }

  /** 摘要注入阈值（可配，默认 DEFAULT_SUMMARY_THRESHOLD，票内记录）：总消息数超过它才需要摘要补上下文 */
  async summaryThreshold(): Promise<number> {
    const raw = await this.getSetting(SUMMARY_THRESHOLD_SETTING)
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUMMARY_THRESHOLD
  }

  /** 会话消息总数（只读计数；摘要阈值判定用） */
  async messagesCount(conversationId: string): Promise<number> {
    const res = await this.deps.invoke<{ count: number }>(ASSISTANT_MESSAGES_COUNT_COMMAND, {
      conversationId,
    })
    return res?.count ?? 0
  }

  /**
   * 默认长期陪伴会话存在性双保险（票 09）：Rust 激活时已幂等建立；
   * 前端在列表刷新后核对，缺失则按固定 id 补建（数据被清空等场景）。
   */
  async ensureDefaultCompanion(): Promise<void> {
    const all = await this.deps.invoke<{ conversations: ConversationRecord[] }>(
      ASSISTANT_CONVERSATIONS_LIST_COMMAND,
    )
    const list = all?.conversations ?? []
    const existing = list.find((c) => c.id === DEFAULT_COMPANION_ID)
    if (existing) {
      if (existing.archived) {
        // 自愈：守卫之外的脏数据（如手工改库）恢复为未归档
        await this.archiveConversation(DEFAULT_COMPANION_ID, false)
      }
      return
    }
    await this.deps.invoke(ASSISTANT_CONVERSATIONS_CREATE_COMMAND, {
      id: DEFAULT_COMPANION_ID,
      kind: 'companion',
      title: '长期陪伴',
      ts: Date.now().toString(),
    })
    this.log('info', `[nest] 默认陪伴会话已建立（${DEFAULT_COMPANION_ID}）`)
  }

  /** 刷新会话列表：活跃列表与归档列表一次查询分出（归档不进默认列表） */
  async refreshConversations(): Promise<ConversationRecord[]> {
    const res = await this.deps.invoke<{ conversations: ConversationRecord[] }>(
      ASSISTANT_CONVERSATIONS_LIST_COMMAND,
    )
    const all = res?.conversations ?? []
    this.conversations = all.filter((c) => !c.archived)
    this.archivedConversations = all.filter((c) => c.archived)
    return this.conversations
  }

  async createConversation(
    kind: 'companion' | 'task' = 'companion',
    title?: string,
  ): Promise<string> {
    const res = await this.deps.invoke<{ id: string }>(ASSISTANT_CONVERSATIONS_CREATE_COMMAND, {
      kind,
      title: title ?? (kind === 'task' ? 'Task' : 'New conversation'),
      ts: Date.now().toString(),
    })
    const id = res?.id
    if (!id) throw new Error('创建会话失败：未返回会话 id')
    await this.refreshConversations()
    return id
  }

  /** 改名（用户可改标题；首条消息自动命名另见 send） */
  async renameConversation(id: string, title: string): Promise<void> {
    await this.deps.invoke(ASSISTANT_CONVERSATIONS_RENAME_COMMAND, { id, title })
    await this.refreshConversations()
  }

  /** 归档 / 恢复（默认陪伴会话的守卫在 Rust 侧，拒绝错误原样上交不静默） */
  async archiveConversation(id: string, archived = true): Promise<void> {
    await this.deps.invoke(ASSISTANT_CONVERSATIONS_ARCHIVE_COMMAND, { id, archived })
    await this.refreshConversations()
  }

  /** 打开会话：加载最近 N 条 + 摘要恢复上下文并重建 agent transcript */
  async openConversation(id: string): Promise<void> {
    if (this.streaming) this.stop()
    // 切会话必须换 agent：agent 的 transcript 属于上一个会话，复用会把旧会话
    // 上下文带进新会话（票 09 多会话隔离；spec §5.2「重建时按最近 N 条恢复」）。
    this.teardownAgent()
    this.currentId = id
    // 就地清空而不是换数组：消息数组被端侧包了 reactive 代理，换数组会让
    // 已建立的响应式绑定指向旧数组（切会话后历史 / 流式增量不刷新）。
    this.messages.splice(0, this.messages.length)
    this.lastSeq = 0
    this.summaryText = null
    const conv = await this.deps.invoke<{ conversations: ConversationRecord[] }>(
      ASSISTANT_CONVERSATIONS_LIST_COMMAND,
    )
    const record = (conv?.conversations ?? []).find((c) => c.id === id)
    if (!record) throw new Error(`会话不存在：${id}`)

    // 冷启动上下文恢复：最近 N 条（N 可配，默认见 DEFAULT_CONTEXT_LIMIT）
    const limit = await this.contextLimit()
    const res = await this.deps.invoke<{ messages: MessageRecord[] }>(
      ASSISTANT_MESSAGES_LIST_COMMAND,
      { conversationId: id, limit },
    )
    const records = res?.messages ?? []
    for (const m of records) {
      this.messages.push(toChatMessage(m))
      if (m.seq > this.lastSeq) this.lastSeq = m.seq
    }

    // 摘要钩子（票 09 留接口）：总消息数超过阈值才请求摘要；
    // 摘要文本只入 transcript，不进 UI 消息流。有自定义钩子用钩子，
    // 否则用内置实现（票 14：生成 + 落库）。
    const total = await this.messagesCount(id)
    if (total > (await this.summaryThreshold())) {
      try {
        this.summaryText = this.deps.resolveSummary
          ? await this.deps.resolveSummary(id)
          : await this.resolveSummaryImpl(id)
      } catch (e) {
        // 摘要缺失不阻断看历史，点名后继续（fail-visible 降级）
        this.log('warn', `[nest] 会话摘要读取失败，按无摘要恢复：${errMsg(e)}`)
        this.summaryText = null
      }
    }

    await this.refreshConversations()
    try {
      await this.ensureAgent()
    } catch (e) {
      // 无 provider 不阻断看历史：发送时再前置检查并点名
      this.log('warn', `[nest] 会话已打开，但 agent 未就绪：${errMsg(e)}`)
    }
  }

  // ==================== Agent ====================

  /** 创建 / 重建当前会话的 agent（切换会话或 provider 变化时） */
  private async ensureAgent(): Promise<Agent> {
    const provider = this.defaultProvider()
    if (!provider) {
      this.agent = null
      this.agentProviderId = null
      return Promise.reject(new ChatPreconditionError('尚未配置供应商：请先在设置中添加'))
    }
    // 票 15：构建前刷新应用工具目录（app.invoke.* 随桥快照重建）
    await this.refreshAppTools()
    // 跨会话共享记忆（票 14 内置实现，或测试 / 定制钩子）：异步预取，缺失不阻断
    let memoryContext: string | null = null
    try {
      memoryContext = this.deps.resolveMemoryContext
        ? await this.deps.resolveMemoryContext()
        : await this.resolveMemoryContext()
    } catch (e) {
      this.log('warn', `[nest] 共享记忆读取失败，本会话不注入：${errMsg(e)}`)
      memoryContext = null
    }
    // provider 未变化且 agent 已存在且记忆上下文未变 → 复用（保留 transcript）
    if (this.agent && this.agentProviderId === provider.id && this.agentMemoryContext === memoryContext) {
      return this.agent
    }
    this.teardownAgent()
    const transcript = buildTranscriptMessages(
      this.messages.filter((m) => m.status === 'done' || m.status === 'aborted'),
      provider,
      this.summaryText,
      memoryContext,
    )
    const agent = createNestAgent({
      invoke: this.deps.invoke,
      subscribe: this.deps.subscribe,
      systemPrompt: buildSystemPrompt(this.deps.lang),
      provider,
      log: (l, msg) => this.log(l, msg),
      tools: this.runtime?.tools ?? [],
      beforeToolCall: this.runtime?.beforeToolCall,
      resolveRequestContext: async (model) => {
        const p = this.providers.find((x) => x.id === model.provider)
        if (!p) return null
        const key = await this.getProviderKey(p.id)
        if (!key) return null
        return { apiStyle: p.apiStyle, apiKey: key, baseUrl: p.baseUrl, model: p.model }
      },
    })
    // 用历史消息重建 transcript（initialState.messages 赋值会拷贝数组）
    if (transcript.length > 0) {
      agent.state.messages = transcript
    }
    this.subscribeAgent(agent)
    this.agent = agent
    this.agentProviderId = provider.id
    this.agentMemoryContext = memoryContext
    return agent
  }

  /** 订阅 agent 生命周期事件 → UI 消息卡 */
  private subscribeAgent(agent: Agent): void {
    this.unsubscribeAgent = agent.subscribe((event: AgentEvent) => {
      void this.onAgentEvent(agent, event)
    })
  }

  private teardownAgent(): void {
    this.unsubscribeAgent?.()
    this.unsubscribeAgent = null
    this.agent = null
    this.agentProviderId = null
    this.streamingMsgId = null
    // 票 13：换会话 / 销毁时清空工具卡片（运行时重置，下次调用重新建卡）
    this.runtime?.reset()
    this.toolCards = this.runtime?.cards ?? []
  }

  private async onAgentEvent(agent: Agent, event: AgentEvent): Promise<void> {
    switch (event.type) {
      case 'message_start': {
        const msg = event.message
        if (msg.role !== 'assistant') return
        this.streaming = true
        this.streamingMsgId = localId('assistant')
        this.messages.push({
          id: this.streamingMsgId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          createdAt: new Date().toISOString(),
        })
        break
      }
      case 'message_update': {
        if (!this.streamingMsgId) return
        const ev = event.assistantMessageEvent
        const target = this.messages.find((m) => m.id === this.streamingMsgId)
        if (!target) return
        if (ev.type === 'text_delta') {
          target.content += ev.delta
        } else if (ev.type === 'thinking_delta') {
          target.thinking = (target.thinking ?? '') + ev.delta
        }
        break
      }
      case 'message_end': {
        if (event.message.role !== 'assistant') break
        await this.onMessageEnd(agent, event.message)
        break
      }
      case 'agent_end': {
        // 票 14：本轮结束后轻量提取（只从用户消息提取；默认开、可关；
        // 失败不阻断主流程，用户可见「本轮未提取记忆」）
        void this.runMemoryExtractionAfterTurn()
        break
      }
      default:
        break
    }
  }

  private async onMessageEnd(agent: Agent, message: AssistantMessage): Promise<void> {
    const target = this.messages.find((m) => m.id === this.streamingMsgId)
    this.streaming = false
    this.streamingMsgId = null
    if (!target) return

    const stopReason = message.stopReason
    const text = extractText(message)
    const model = message.model

    if (stopReason === 'error') {
      // 错误卡：不落库空消息；用户可见原因，可重试
      target.status = 'error'
      target.errorMessage = message.errorMessage ?? '请求失败，请重试'
      target.content = text
      this.log('error', `[nest] 对话错误：${target.errorMessage}`)
      return
    }

    if (stopReason === 'aborted') {
      // 中止：落库已生成的部分内容（不丢用户已看到的东西）
      target.status = 'aborted'
      target.errorMessage = '已停止生成'
      target.content = text
      target.model = model
      await this.persistAssistant(text, { stopReason, aborted: true, model })
      return
    }

    // 成功（stop / length / toolUse）
    target.status = 'done'
    target.content = text
    target.model = model
    await this.persistAssistant(text, { stopReason, model })
    await this.refreshConversations()
  }

  // ==================== 发送 / 停止 / 重试 ====================

  /** 发送一条用户消息；前置不满足抛 ChatPreconditionError */
  async send(text: string): Promise<void> {
    const content = text.trim()
    if (!content) return
    if (this.streaming) return

    // 前置：默认 provider + 保险库解锁
    const provider = this.defaultProvider()
    if (!provider) throw new ChatPreconditionError('尚未配置供应商：请先在设置中添加')
    if (!(await this.vaultUnlocked())) throw new ChatPreconditionError('保险库未解锁：请先解锁')
    const key = await this.getProviderKey(provider.id)
    if (!key) throw new ChatPreconditionError(`供应商「${provider.name}」尚未设置密钥`)

    // 当前会话（没有则建）
    if (!this.currentId) {
      this.currentId = await this.createConversation('companion')
    }
    const convId = this.currentId

    // 用户消息先落库
    const userMsg: ChatMessage = {
      id: localId('user'),
      role: 'user',
      content,
      status: 'done',
      createdAt: new Date().toISOString(),
    }
    this.messages.push(userMsg)
    this.lastSeq += 1
    // 票 14：记录提取来源（用户消息），并刷新本轮记忆注入选择
    this.lastUserText = content
    this.lastUserMessageId = userMsg.id
    await this.refreshMemoryContext()
    await this.appendMessage(convId, 'user', content, {})

    // 首个用户消息自动标题（仅创建期默认标题可被替换）
    const conv = this.conversations.find((c) => c.id === convId)
    if (conv && isCreationTitle(conv.title)) {
      await this.deps.invoke(ASSISTANT_CONVERSATIONS_RENAME_COMMAND, {
        id: convId,
        title: content.slice(0, 20),
      }).catch(() => {})
      await this.refreshConversations()
    }

    // 起 agent 并发送
    const agent = await this.ensureAgent()
    await agent.prompt(content)
  }

  /** 停止当前生成（agent.abort；StreamFn 编码 aborted） */
  stop(): void {
    if (this.agent && this.streaming) {
      this.log('warn', '[nest] 用户停止生成（宿主可能仍在后台读取流）')
      this.agent.abort()
    }
    // 票 13：急停结算在途确认——停止后队列中未执行的工具不再执行
    this.runtime?.abortPending('已停止，未执行')
  }

  /** UI 回工具确认决定（批准 / 拒绝；write 一轮，danger 两轮） */
  resolveToolConfirmation(id: string, decision: ConfirmationDecision): void {
    this.runtime?.resolveConfirmation(id, decision)
  }

  // ==================== 记忆注入与提取（票 14） ====================

  /**
   * 刷新本轮注入用的记忆选择（spec §5.4）。
   *
   * 记忆关闭 → 不注入；否则按 token 预算在已确认事实里取舍
   *（scope + 关键词命中 + 最近使用），结果写入 currentMemoryFacts 供 UI
   *展开查看「本次会带上这些记忆」。读取失败不阻断对话，点名后降级。
   */
  async refreshMemoryContext(): Promise<void> {
    try {
      if (!(await this.memoryManager.isMemoryEnabled())) {
        this.currentMemoryFacts = []
        this.memoryContextText = null
        return
      }
      const facts = await this.memoryManager.list('', 'confirmed')
      const selection = selectMemoryForInjection(facts, this.lastUserText)
      this.currentMemoryFacts = selection.facts
      this.memoryContextText = selection.text || null
    } catch (e) {
      this.log('warn', `[nest] 记忆上下文读取失败，本轮不注入：${errMsg(e)}`)
      this.currentMemoryFacts = []
      this.memoryContextText = null
    }
  }

  /** 跨会话共享记忆读取（ensureAgent 注入用；返回注入块文本或 null） */
  async resolveMemoryContext(): Promise<string | null> {
    await this.refreshMemoryContext()
    if (!this.memoryContextText) return null
    return formatMemoryContextBlock(this.memoryContextText)
  }

  /**
   * 会话摘要（票 09 钩子的内置实现）：先查已存摘要；总消息数超过阈值
   * 才生成（模型调用），落库后返回。只入 transcript，不进 UI 消息流。
   */
  async resolveSummaryImpl(conversationId: string): Promise<string | null> {
    const saved = await this.memoryManager.getSummary(conversationId)
    if (saved) return saved
    const total = await this.messagesCount(conversationId)
    if (total <= (await this.summaryThreshold())) return null
    const limit = await this.contextLimit()
    const res = await this.deps.invoke<{ messages: MessageRecord[] }>(ASSISTANT_MESSAGES_LIST_COMMAND, {
      conversationId,
      limit: Math.min(Math.max(total, limit), 200),
    })
    const all = res?.messages ?? []
    // messages-list 按 seq 升序返回最近 N 条；较早部分 = 去掉最近 N 条
    const older = all.slice(0, Math.max(0, all.length - limit))
    if (older.length === 0) return null
    const transcript = older
      .map((m) => `${m.role === 'user' ? '用户' : 'Nest'}：${m.content}`)
      .join('\n')
    const raw = await this.runMemoryModelCall(
      buildSummarySystemPrompt(this.deps.lang),
      buildSummaryUserPrompt(transcript),
    )
    const summary = parseSummary(raw)
    await this.memoryManager.setSummary(conversationId, summary)
    return summary
  }

  /**
   * 记忆类模型调用（提取 / 摘要共用）：复用对话流式管线（一次性 agent，
   * 无工具），返回模型最终文本。失败抛错，由调用方决定降级口径。
   */
  private async runMemoryModelCall(systemPrompt: string, userPrompt: string): Promise<string> {
    const provider = this.defaultProvider()
    if (!provider) throw new ChatPreconditionError('尚未配置供应商：请先在设置中添加')
    const key = await this.getProviderKey(provider.id)
    if (!key) throw new ChatPreconditionError(`供应商「${provider.name}」尚未设置密钥`)
    const agent = createNestAgent({
      invoke: this.deps.invoke,
      subscribe: this.deps.subscribe,
      systemPrompt,
      provider,
      log: (l, msg) => this.log(l, msg),
      resolveRequestContext: async (model) => {
        const p = this.providers.find((x) => x.id === model.provider)
        if (!p) return null
        const k = await this.getProviderKey(p.id)
        if (!k) return null
        return { apiStyle: p.apiStyle, apiKey: k, baseUrl: p.baseUrl, model: p.model }
      },
    })
    let text = ''
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        text = extractText(event.message)
      }
    })
    try {
      await agent.prompt(userPrompt)
      await agent.waitForIdle()
    } finally {
      unsubscribe()
      agent.abort()
    }
    if (!text.trim()) throw new Error('模型未返回内容')
    return text
  }

  /**
   * 每轮结束后的轻量提取（票 14）：开关缺一不执行；只从用户消息提取，
   * 结果进 pending 收件箱（带来源）；失败设用户可见提示，不阻断对话。
   */
  private async runMemoryExtractionAfterTurn(): Promise<void> {
    try {
      if (!(await this.memoryManager.isMemoryEnabled()) || !(await this.memoryManager.isExtractEnabled())) {
        return
      }
      if (!this.currentId || !this.lastUserText) return
      if (!this.defaultProvider()) return
      const text = await this.runMemoryModelCall(
        buildExtractionSystemPrompt(this.deps.lang),
        buildExtractionUserPrompt(this.lastUserText),
      )
      const facts = parseExtractedFacts(text)
      for (const f of facts) {
        await this.memoryManager.upsert({
          scope: 'global',
          key: f.key,
          value: f.value,
          status: 'pending',
          sourceConversationId: this.currentId,
          sourceMessageId: this.lastUserMessageId,
        })
      }
      if (facts.length > 0) {
        this.log('info', `[nest] 记忆提取：${facts.length} 条进入收件箱`)
      }
    } catch (e) {
      this.memoryNotice = this.deps.lang === 'en' ? 'Memory was not extracted this turn.' : '本轮未提取记忆'
      this.log('warn', `[nest] 记忆提取失败：${errMsg(e)}`)
    }
  }

  /** 重试上一次失败的请求：移除失败助手消息后 continue（不重放副作用） */
  async retry(): Promise<void> {
    if (this.streaming || !this.agent) return
    // 移除末尾的失败助手消息（UI + transcript）
    const last = this.messages[this.messages.length - 1]
    if (!last || last.role !== 'assistant' || last.status !== 'error') return
    this.messages.pop()
    const msgs = this.agent.state.messages
    const failedIdx = [...msgs].reverse().findIndex(
      (m) => m.role === 'assistant' && (m.stopReason === 'error' || m.stopReason === 'aborted'),
    )
    if (failedIdx !== -1) {
      const idx = msgs.length - 1 - failedIdx
      this.agent.state.messages = msgs.slice(0, idx)
    }
    this.log('info', '[nest] 用户手动重试（不重放已发生的副作用）')
    await this.agent.continue()
  }

  /** 销毁（切换会话 / 卸载） */
  dispose(): void {
    if (this.streaming) this.stop()
    this.teardownAgent()
    // 票 14：清记忆 UI 状态（注入清单 / 提取提示 / 来源）
    this.currentMemoryFacts = []
    this.memoryContextText = null
    this.memoryNotice = ''
    this.lastUserText = ''
    this.lastUserMessageId = null
    this.agentMemoryContext = null
  }

  // ==================== 落库 ====================

  private async appendMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.invoke(ASSISTANT_MESSAGES_APPEND_COMMAND, {
      conversationId,
      seq: this.lastSeq,
      role,
      content,
      nonce: randomHex(NONCE_BYTES),
      ts: Date.now().toString(),
      meta: JSON.stringify(meta),
    })
  }

  private async persistAssistant(
    content: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    if (!this.currentId) return
    this.lastSeq += 1
    await this.appendMessage(this.currentId, 'assistant', content, meta)
  }
}

// ==================== 映射 ====================

/**
 * 创建会话时的默认标题字面量（双语言）；首条用户消息到达时据此自动命名。
 * 标题是落库数据，自动命名只认这些创建期字面量，避免误改用户自设标题。
 */
const CREATION_TITLE_LITERALS = ['新会话', 'New conversation', '任务', 'Task']

/** 是否为创建期默认标题（可被首条用户消息替换） */
export function isCreationTitle(title: string): boolean {
  return CREATION_TITLE_LITERALS.includes(title)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function toChatMessage(m: MessageRecord): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    status: 'done',
    model: typeof m.meta?.model === 'string' ? m.meta.model : undefined,
    createdAt: m.createdAt,
  }
}

/**
 * 冷启动 transcript 构建（票 09；导出供单测直接覆盖）
 *
 * 顺序：跨会话共享记忆（钩子）→ 会话摘要 → 最近 N 条消息。
 * 记忆 / 摘要都以 user 角色的上下文块置前，模型自然把其当作背景而非新输入。
 */
export function buildTranscriptMessages(
  messages: ChatMessage[],
  provider: ProviderRecord,
  summary: string | null,
  memoryContext: string | null,
): Message[] {
  const out: Message[] = []
  if (memoryContext) {
    out.push({
      role: 'user',
      content: `【长期记忆】以下是跨会话共享的记忆背景，供参考：
${memoryContext}`,
      timestamp: Date.now(),
    })
  }
  if (summary) {
    out.push({
      role: 'user',
      content: `【会话摘要】以下是本会话较早内容的摘要，用于延续上下文：
${summary}`,
      timestamp: Date.now(),
    })
  }
  for (const m of messages) {
    if (m.status !== 'done' && m.status !== 'aborted') continue
    out.push(toPiMessage(m, provider))
  }
  return out
}

/** 落库消息 → pi 消息（重建 transcript；M1 无工具，纯文本往返） */
function toPiMessage(m: ChatMessage, provider: ProviderRecord): Message {
  if (m.role === 'user') {
    return { role: 'user', content: m.content, timestamp: Date.parse(m.createdAt) || Date.now() }
  }
  const content: TextContent[] = [{ type: 'text', text: m.content }]
  return {
    role: 'assistant',
    content,
    api: apiStyleToPiApi(provider.apiStyle),
    provider: provider.id,
    model: provider.model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: m.status === 'aborted' ? 'aborted' : 'stop',
    timestamp: Date.parse(m.createdAt) || Date.now(),
  }
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('')
}
