/**
 * Anthropic Messages API provider 适配（票 10 / spec §5.2、D17）
 *
 * 与 OpenAI 兼容路径**同形协议、自实现**（跨应用源码耦合禁止，spec §5.2）：
 * - 请求构建：pi 的 `Message[]` → Anthropic `/v1/messages` 形状
 *   （system 提取为顶层参数、连续同角色消息合并、tool_use / tool_result
 *   块映射、`stream: true`）；
 * - 流映射：Anthropic SSE（`event:` 字段携带事件类型）→ pi-ai 的
 *   `AssistantMessageEvent` 协议（`start` / `text_*` / `thinking_*` /
 *   `toolcall_*` / `done`）。
 *
 * 方言知识只住本模块；Rust 侧与宿主都不持有 Anthropic 语义（spec §3.1）。
 */
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  JsonValue,
  Message,
  TextContent,
  ToolCall,
} from '@earendil-works/pi-ai'
import type { ChatStreamRequest } from '../types'
import { StreamMapError } from './stream-error'

/** Anthropic Messages API 缺省 base（用户可配自定义 / 本地端点） */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
/** Anthropic API 版本头（协议要求） */
export const ANTHROPIC_VERSION = '2023-06-01'
/** 缺省 max_tokens（Anthropic 协议必填；M1 不开放高级参数面） */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

/** Anthropic messages 请求体（流式） */
export interface AnthropicMessagesBody {
  model: string
  max_tokens: number
  messages: Array<Record<string, unknown>>
  stream: true
  system?: string
}

/**
 * 拼接 messages URL：baseURL 可为 `https://api.anthropic.com`、带 `/v1`
 * 的端点或已含路径的完整端点（以 `/messages` 结尾时原样使用，不重复拼接）。
 */
export function joinAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '') || ANTHROPIC_DEFAULT_BASE_URL
  if (/\/messages$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1/messages`
}

/** 取消息内容块里的文本（M1 只读文本；图像块不参与文本拼接） */
function textOf(content: string | Array<TextContent | ImageContent>): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * pi `Message[]` → Anthropic messages。
 *
 * Anthropic 协议要求：system 是顶层参数；messages 必须 user / assistant
 * 交替——连续同角色消息合并为一条（内容以 `\n` 拼接）。toolResult 映射为
 * user 侧的 `tool_result` 块。
 */
export function mapMessagesToAnthropic(messages: Message[]): {
  system?: string
  messages: Array<Record<string, unknown>>
} {
  const systemParts: string[] = []
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(textOf(m.content))
      continue
    }
    if (m.role === 'toolResult') {
      // tool_result 走 user 角色；与相邻 user 合并由下方统一处理
      const block: Record<string, unknown> = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: textOf(m.content),
      }
      const last = out[out.length - 1]
      if (last && last.role === 'user') {
        if (Array.isArray(last.content)) (last.content as unknown[]).push(block)
        else last.content = [{ type: 'text', text: last.content as string }, block]
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    // user / assistant
    const role = m.role
    const last = out[out.length - 1]
    if (last && last.role === role) {
      // 连续同角色：合并内容
      const merged: unknown[] = Array.isArray(last.content)
        ? [...(last.content as unknown[])]
        : [{ type: 'text', text: String(last.content ?? '') }]
      if (role === 'assistant') {
        for (const b of m.content) {
          if (b.type === 'text') {
            merged.push({ type: 'text', text: b.text })
          } else if (b.type === 'toolCall') {
            merged.push({
              type: 'tool_use',
              id: b.id,
              name: b.name,
              input: b.arguments ?? {},
            })
          }
        }
      } else {
        merged.push({ type: 'text', text: textOf(m.content) })
      }
      last.content = merged
      continue
    }
    if (role === 'assistant') {
      const content: unknown[] = []
      const texts = m.content.filter((b): b is TextContent => b.type === 'text')
      if (texts.length > 0) content.push({ type: 'text', text: texts.map((b) => b.text).join('\n') })
      for (const b of m.content) {
        if (b.type === 'toolCall') {
          content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.arguments ?? {} })
        }
      }
      out.push({ role: 'assistant', content })
    } else {
      out.push({ role: 'user', content: [{ type: 'text', text: textOf(m.content) }] })
    }
  }
  const system = systemParts.filter(Boolean).join('\n')
  return system ? { system, messages: out } : { messages: out }
}

/** 构建流式请求（`host.http_fetch` raw 模式载荷） */
export function buildAnthropicMessagesRequest(opts: {
  apiKey: string
  baseUrl: string
  model: string
  messages: Message[]
  streamEvent: string
}): ChatStreamRequest {
  const mapped = mapMessagesToAnthropic(opts.messages)
  const body: AnthropicMessagesBody = {
    model: opts.model,
    max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: mapped.messages,
    stream: true,
  }
  if (mapped.system) body.system = mapped.system
  return {
    method: 'POST',
    url: joinAnthropicMessagesUrl(opts.baseUrl),
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    stream: true,
    streamEvent: opts.streamEvent,
  }
}

// ==================== 流映射（Anthropic SSE → pi 事件） ====================

/** Anthropic 流映射失败（非法 JSON / 形状不符 / error 事件） */
export class AnthropicStreamError extends StreamMapError {
  constructor(message: string) {
    super(message)
    this.name = 'AnthropicStreamError'
  }
}

/** 内容块状态（按 Anthropic 的 content_block index 跟踪） */
type AnthropicBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; argsText: string }

/**
 * 有状态的 Anthropic 流映射器。
 *
 * 输入：SSE `data` 行原文 + `event:` 字段（Anthropic 事件类型在 event 字段，
 * 不是 data 内容）；输出：pi-ai `AssistantMessageEvent` 协议事件。
 */
export class AnthropicStreamMapper {
  private started = false
  private blocks: AnthropicBlock[] = []
  private finishReason: 'stop' | 'length' | 'toolUse' | undefined
  private usage = { input: 0, output: 0 }
  private responseId: string | undefined
  private timestamp = Date.now()

  constructor(
    private readonly provider: string,
    private readonly model: string,
  ) {}

  /** 处理一条 SSE data 行（`event` 为 `event:` 字段值）；返回要推送的协议事件 */
  handleData(data: string, event?: string): AssistantMessageEvent[] {
    if (data === '[DONE]') {
      // Anthropic 正常以 message_stop 收尾；[DONE] 按兜底处理（代理兼容）
      return [this.finish('stop')]
    }
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AnthropicStreamError('Anthropic SSE data 不是对象 JSON')
      }
      payload = parsed as Record<string, unknown>
    } catch (e) {
      if (e instanceof AnthropicStreamError) throw e
      throw new AnthropicStreamError(`Anthropic SSE data 不是合法 JSON: ${truncate(data)}`)
    }

    const type = typeof event === 'string' && event ? event : String(payload.type ?? '')
    switch (type) {
      case 'message_start': {
        const msg = payload.message as { id?: string; usage?: { input_tokens?: number } } | undefined
        if (msg?.id) this.responseId = msg.id
        if (msg?.usage?.input_tokens != null) this.usage.input = msg.usage.input_tokens
        return this.ensureStarted()
      }
      case 'content_block_start': {
        const index = numberAt(payload, 'index')
        const block = payload.content_block as
          | { type?: string; id?: string; name?: string }
          | undefined
        const kind = block?.type
        if (kind === 'text') {
          this.blocks[index] = { kind: 'text', text: '' }
          return this.ensureStarted().concat(this.blockStartEvents(index))
        }
        if (kind === 'thinking') {
          this.blocks[index] = { kind: 'thinking', text: '' }
          return this.ensureStarted().concat(this.blockStartEvents(index))
        }
        if (kind === 'tool_use') {
          this.blocks[index] = {
            kind: 'tool',
            id: block?.id ?? `toolu_${index}`,
            name: block?.name ?? '',
            argsText: '',
          }
          return this.ensureStarted().concat(this.blockStartEvents(index))
        }
        // 未知块类型：忽略（不阻断流）
        return []
      }
      case 'content_block_delta': {
        const index = numberAt(payload, 'index')
        const delta = payload.delta as
          | { type?: string; text?: string; thinking?: string; partial_json?: string }
          | undefined
        const block = this.blocks[index]
        const events = this.ensureStarted()
        if (!block || !delta) return events
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && block.kind === 'text') {
          block.text += delta.text
          events.push({
            type: 'text_delta',
            contentIndex: this.blockIndex(index),
            delta: delta.text,
            partial: this.partial(),
          })
        } else if (
          delta.type === 'thinking_delta' &&
          typeof delta.thinking === 'string' &&
          block.kind === 'thinking'
        ) {
          block.text += delta.thinking
          events.push({
            type: 'thinking_delta',
            contentIndex: this.blockIndex(index),
            delta: delta.thinking,
            partial: this.partial(),
          })
        } else if (
          delta.type === 'input_json_delta' &&
          typeof delta.partial_json === 'string' &&
          block.kind === 'tool'
        ) {
          block.argsText += delta.partial_json
          events.push({
            type: 'toolcall_delta',
            contentIndex: this.blockIndex(index),
            delta: delta.partial_json,
            partial: this.partial(),
          })
        }
        return events
      }
      case 'content_block_stop':
        return []
      case 'message_delta': {
        const delta = payload.delta as { stop_reason?: string } | undefined
        const usage = payload.usage as { output_tokens?: number } | undefined
        if (usage?.output_tokens != null) this.usage.output = usage.output_tokens
        if (delta?.stop_reason) this.finishReason = mapAnthropicStopReason(delta.stop_reason)
        return []
      }
      case 'message_stop':
        return [this.finish('stop')]
      case 'ping':
        return []
      case 'error': {
        const err = payload.error as { message?: string } | undefined
        throw new AnthropicStreamError(`Anthropic 流错误：${err?.message ?? truncate(data)}`)
      }
      default:
        // 未知事件类型：忽略（协议演进不阻断）
        return []
    }
  }

  /** 流终止（message_stop / [DONE] / 宿主 done 帧）：结算末事件 */
  finish(fallbackReason: 'stop' | 'length' | 'toolUse'): AssistantMessageEvent {
    const reason = this.finishReason ?? fallbackReason
    const finalMessage = this.assemble(reason)
    if (!this.started) {
      return { type: 'done', reason, message: finalMessage }
    }
    const events: AssistantMessageEvent[] = []
    this.blocks.forEach((b, i) => {
      if (b.kind === 'thinking') {
        events.push({
          type: 'thinking_end',
          contentIndex: this.blockIndex(i),
          content: b.text,
          partial: this.partial(),
        })
      } else if (b.kind === 'text') {
        events.push({
          type: 'text_end',
          contentIndex: this.blockIndex(i),
          content: b.text,
          partial: this.partial(),
        })
      } else {
        events.push({
          type: 'toolcall_end',
          contentIndex: this.blockIndex(i),
          toolCall: {
            type: 'toolCall',
            id: b.id,
            name: b.name,
            arguments: parseToolArgs(b.argsText),
          } satisfies ToolCall,
          partial: this.partial(),
        })
      }
    })
    return { type: 'done', reason, message: finalMessage }
  }

  /** 首个内容事件前补 `start`（message_start 已发过则不再发） */
  private ensureStarted(): AssistantMessageEvent[] {
    if (this.started) return []
    this.started = true
    return [{ type: 'start', partial: this.partial() }]
  }

  /** content_block_start → 对应块的 *_start 事件 */
  private blockStartEvents(anthropicIndex: number): AssistantMessageEvent[] {
    const block = this.blocks[anthropicIndex]
    if (!block) return []
    const contentIndex = this.blockIndex(anthropicIndex)
    if (block.kind === 'text') return [{ type: 'text_start', contentIndex, partial: this.partial() }]
    if (block.kind === 'thinking') {
      return [{ type: 'thinking_start', contentIndex, partial: this.partial() }]
    }
    return [{ type: 'toolcall_start', contentIndex, partial: this.partial() }]
  }

  /** Anthropic content_block index → pi content 数组下标（跳过未创建块） */
  private blockIndex(anthropicIndex: number): number {
    let n = 0
    for (let i = 0; i < anthropicIndex; i++) {
      if (this.blocks[i]) n++
    }
    return n
  }

  private partial(): AssistantMessage {
    return this.assemble(this.finishReason ?? 'pending')
  }

  private assemble(stopReason: AssistantMessage['stopReason']): AssistantMessage {
    const content: AssistantMessage['content'] = []
    for (const b of this.blocks) {
      if (!b) continue
      if (b.kind === 'thinking') content.push({ type: 'thinking', thinking: b.text })
      else if (b.kind === 'text') content.push({ type: 'text', text: b.text })
      else {
        content.push({
          type: 'toolCall',
          id: b.id,
          name: b.name,
          arguments: parseToolArgs(b.argsText),
        })
      }
    }
    return {
      role: 'assistant',
      content,
      api: 'anthropic-messages',
      provider: this.provider,
      model: this.model,
      responseId: this.responseId,
      usage: {
        input: this.usage.input,
        output: this.usage.output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: this.usage.input + this.usage.output,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: this.timestamp,
    }
  }
}

/** Anthropic stop_reason → pi stopReason */
function mapAnthropicStopReason(raw: string): 'stop' | 'length' | 'toolUse' {
  switch (raw) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'toolUse'
    default:
      // end_turn / stop_sequence 等一律视为正常结束
      return 'stop'
  }
}

function numberAt(payload: Record<string, unknown>, key: string): number {
  const v = payload[key]
  return typeof v === 'number' ? v : 0
}

/** 工具调用参数：增量片段拼出的 JSON；解析失败给空对象（由 pi 校验拦截） */
function parseToolArgs(argsText: string): Record<string, JsonValue> {
  if (!argsText) return {}
  try {
    const parsed = JSON.parse(argsText)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, JsonValue>) : {}
  } catch {
    return {}
  }
}

function truncate(s: string, max = 120): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}
