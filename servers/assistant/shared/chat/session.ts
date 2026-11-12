/**
 * Nest 对话会话编排（票 08 / spec §3.2、§5.2、§5.3）
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
 */
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message, TextContent } from '@earendil-works/pi-ai'
import { createNestAgent } from '../agent/agent'
import { buildSystemPrompt, type PromptLang } from '../prompt/system'
import { randomHex, NONCE_BYTES } from '../vault'
import {
  ASSISTANT_CONVERSATIONS_CREATE_COMMAND,
  ASSISTANT_CONVERSATIONS_LIST_COMMAND,
  ASSISTANT_CONVERSATIONS_RENAME_COMMAND,
  ASSISTANT_MESSAGES_APPEND_COMMAND,
  ASSISTANT_MESSAGES_LIST_COMMAND,
  ASSISTANT_PROVIDERS_LIST_COMMAND,
  ASSISTANT_VAULT_GET_SECRET_COMMAND,
  VAULT_STATUS_COMMAND,
  providerSecretKey,
  type AssistantInvoke,
  type ChatMessage,
  type ConversationRecord,
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
}

/** 本地生成的临时消息 id（未落库的流式卡） */
function localId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomHex(4)}`
}

export class NestChatSession {
  conversations: ConversationRecord[] = []
  currentId: string | null = null
  messages: ChatMessage[] = []
  streaming = false
  providers: ProviderRecord[] = []

  private agent: Agent | null = null
  private agentProviderId: string | null = null
  private lastSeq = 0
  private unsubscribeAgent: (() => void) | null = null
  private streamingMsgId: string | null = null
  private deps: ChatSessionDeps

  constructor(deps: ChatSessionDeps) {
    this.deps = deps
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
    try {
      const st = await this.deps.invoke<{ exists: boolean; unlocked: boolean }>(
        VAULT_STATUS_COMMAND,
      )
      return Boolean(st?.exists && st?.unlocked)
    } catch {
      return false
    }
  }

  /** 取 provider 密钥（按需从保险库解密；未设置 / 未解锁返回 null） */
  async getProviderKey(providerId: string): Promise<string | null> {
    try {
      const res = await this.deps.invoke<{ value: string }>(ASSISTANT_VAULT_GET_SECRET_COMMAND, {
        key: providerSecretKey(providerId),
      })
      return res?.value ?? null
    } catch {
      return null
    }
  }

  // ==================== 会话管理 ====================

  async refreshConversations(): Promise<ConversationRecord[]> {
    const res = await this.deps.invoke<{ conversations: ConversationRecord[] }>(
      ASSISTANT_CONVERSATIONS_LIST_COMMAND,
    )
    this.conversations = (res?.conversations ?? []).filter((c) => !c.archived)
    return this.conversations
  }

  async createConversation(kind: 'companion' | 'task' = 'companion'): Promise<string> {
    const res = await this.deps.invoke<{ id: string }>(ASSISTANT_CONVERSATIONS_CREATE_COMMAND, {
      kind,
      title: kind === 'task' ? 'Task' : 'New conversation',
      ts: Date.now().toString(),
    })
    const id = res?.id
    if (!id) throw new Error('创建会话失败：未返回会话 id')
    await this.refreshConversations()
    return id
  }

  /** 打开会话：加载历史消息并重建 agent transcript */
  async openConversation(id: string): Promise<void> {
    if (this.streaming) this.stop()
    this.currentId = id
    this.messages = []
    this.lastSeq = 0
    const conv = await this.deps.invoke<{ conversations: ConversationRecord[] }>(
      ASSISTANT_CONVERSATIONS_LIST_COMMAND,
    )
    const record = (conv?.conversations ?? []).find((c) => c.id === id)
    if (!record) throw new Error(`会话不存在：${id}`)

    const res = await this.deps.invoke<{ messages: MessageRecord[] }>(
      ASSISTANT_MESSAGES_LIST_COMMAND,
      { conversationId: id, limit: 100 },
    )
    const records = res?.messages ?? []
    for (const m of records) {
      this.messages.push(toChatMessage(m))
      if (m.seq > this.lastSeq) this.lastSeq = m.seq
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
    // provider 未变化且 agent 已存在 → 复用（保留 transcript）
    if (this.agent && this.agentProviderId === provider.id) {
      return this.agent
    }
    this.teardownAgent()
    const transcript = this.messages
      .filter((m) => m.status === 'done' || m.status === 'aborted')
      .map((m) => toPiMessage(m, provider))
    const agent = createNestAgent({
      invoke: this.deps.invoke,
      subscribe: this.deps.subscribe,
      systemPrompt: buildSystemPrompt(this.deps.lang),
      provider,
      log: (l, msg) => this.log(l, msg),
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
    await this.appendMessage(convId, 'user', content, {})

    // 首个用户消息自动标题
    const conv = this.conversations.find((c) => c.id === convId)
    if (conv && (conv.title === 'New conversation' || conv.title === 'Task')) {
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

/** 落库消息 → pi 消息（重建 transcript；M1 无工具，纯文本往返） */
function toPiMessage(m: ChatMessage, provider: ProviderRecord): Message {
  if (m.role === 'user') {
    return { role: 'user', content: m.content, timestamp: Date.parse(m.createdAt) || Date.now() }
  }
  const content: TextContent[] = [{ type: 'text', text: m.content }]
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
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
