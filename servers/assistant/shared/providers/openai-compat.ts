/**
 * OpenAI 兼容 provider 适配（票 08 / spec §5.2、D17）
 *
 * 与 ai-chatbox **同形协议、自实现**（跨应用源码耦合禁止，spec §5.2）：
 * - 请求构建：pi 的 `Message[]` → OpenAI `/chat/completions` 形状
 *   （system / user / assistant / tool 映射，`stream: true`）；
 * - 流映射：宿主 raw 模式的 SSE 文本 → pi-ai 的 `AssistantMessageEvent`
 *   协议（`start` / `text_*` / `thinking_*` / `toolcall_*` / `done`）。
 *
 * 方言知识只住本模块；Rust 侧与宿主都不持有 OpenAI 语义（spec §3.1）。
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

/** OpenAI 兼容 chat/completions 请求体（流式） */
export interface OpenAICompatChatBody {
  model: string
  messages: Array<Record<string, unknown>>
  stream: true
}

/** 宿主 raw 流里的单个 SSE data 行解析结果（OpenAI 兼容方言） */
export interface OpenAICompatStreamChunk {
  id?: string
  choices?: Array<{
    index?: number
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

// ==================== 请求构建 ====================

/**
 * 拼接 chat/completions URL：baseURL 可为 `https://api.openai.com/v1`、
 * 本地端点（`http://127.0.0.1:8000/v1`）或已含路径的完整端点
 * （以 `/chat/completions` 结尾时原样使用，不重复拼接）。
 */
export function joinChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

/** 取消息内容块里的文本（M1 只读文本；图像块不参与文本拼接） */
function textOf(content: string | Array<TextContent | ImageContent>): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/** pi `Message[]` → OpenAI messages（system / user / assistant / tool） */
export function mapMessagesToOpenAI(messages: Message[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: textOf(m.content) }
      case 'user':
        return { role: 'user', content: textOf(m.content) }
      case 'assistant': {
        const texts = m.content.filter((b): b is TextContent => b.type === 'text')
        const toolCalls = m.content.filter((b): b is ToolCall => b.type === 'toolCall')
        const out: Record<string, unknown> = { role: 'assistant' }
        if (texts.length > 0) {
          out.content = texts.map((b) => b.text).join('\n')
        } else if (toolCalls.length === 0) {
          out.content = ''
        } else {
          // 纯工具调用轮：content 置 null（OpenAI 协议要求）
          out.content = null
        }
        if (toolCalls.length > 0) {
          out.tool_calls = toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          }))
        }
        return out
      }
      case 'toolResult': {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: textOf(m.content),
        }
      }
    }
  })
}

/**
 * 构建流式请求（`host.http_fetch` raw 模式载荷）。
 *
 * `streamEvent` 必须等于 `assistant:stream:<streamId>`（Rust 精确匹配校验）。
 */
export function buildOpenAICompatChatRequest(opts: {
  apiKey: string
  baseUrl: string
  model: string
  messages: Message[]
  streamEvent: string
}): ChatStreamRequest {
  const body: OpenAICompatChatBody = {
    model: opts.model,
    messages: mapMessagesToOpenAI(opts.messages),
    stream: true,
  }
  return {
    method: 'POST',
    url: joinChatCompletionsUrl(opts.baseUrl),
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    stream: true,
    streamEvent: opts.streamEvent,
  }
}

// ==================== 流映射（SSE data → pi 事件） ====================

/**
 * 流映射失败（非法 JSON / 形状不符）：由 StreamFn 编码为协议 error 事件。
 * 继承共享基类 [`StreamMapError`]，StreamFn 三家方言统一捕获。
 */
export class OpenAICompatStreamError extends StreamMapError {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAICompatStreamError'
  }
}

interface TextBlockState {
  text: string
}

interface ThinkingBlockState {
  text: string
}

interface ToolCallState {
  id: string
  name: string
  /** 增量拼接的 arguments JSON 片段 */
  argsText: string
  /** 本工具调用在 content 里的下标（toolcall_start 的 contentIndex） */
  contentIndex: number
}

/**
 * 有状态的 OpenAI 兼容流映射器。
 *
 * 输入：SSE `data` 行原文（`[DONE]` 结束）；
 * 输出：pi-ai `AssistantMessageEvent` 协议事件（`start` 先于一切更新，
 * `done` 收尾，与 pi 的事件契约逐字对齐）。
 */
export class OpenAICompatStreamMapper {
  private started = false
  private textBlocks: TextBlockState[] = []
  private thinkingBlocks: ThinkingBlockState[] = []
  private toolCalls: ToolCallState[] = []
  private finishReason: 'stop' | 'length' | 'toolUse' | undefined
  private usage = { input: 0, output: 0, total: 0 }
  private responseId: string | undefined
  private timestamp = Date.now()

  constructor(
    private readonly provider: string,
    private readonly model: string,
  ) {}

  /** 处理一条 SSE data 行；返回要推送的协议事件（done 事件后映射器不再使用） */
  handleData(data: string): AssistantMessageEvent[] {
    if (data === '[DONE]') {
      return [this.finish('stop')]
    }
    let chunk: OpenAICompatStreamChunk
    try {
      chunk = JSON.parse(data) as OpenAICompatStreamChunk
    } catch {
      throw new OpenAICompatStreamError(`SSE data 不是合法 JSON: ${truncate(data)}`)
    }
    if (chunk.id) this.responseId = chunk.id
    if (chunk.usage) {
      this.usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
        total: chunk.usage.total_tokens ?? 0,
      }
    }
    const choice = chunk.choices?.[0]
    if (!choice) {
      // 无 choices 的 chunk（如纯 usage 帧）：不产生内容事件，但可更新 usage
      return []
    }

    const events: AssistantMessageEvent[] = []
    if (!this.started) {
      this.started = true
      events.push({ type: 'start', partial: this.partial() })
    }

    const delta = choice.delta
    if (delta) {
      // 思考（reasoning_content / reasoning 两种方言都认）
      const thinking = delta.reasoning_content ?? delta.reasoning
      if (thinking) {
        if (this.thinkingBlocks.length === 0) {
          this.thinkingBlocks.push({ text: '' })
          events.push({
            type: 'thinking_start',
            contentIndex: 0,
            partial: this.partial(),
          })
        }
        const idx = this.thinkingBlocks.length - 1
        this.thinkingBlocks[idx].text += thinking
        events.push({
          type: 'thinking_delta',
          contentIndex: idx,
          delta: thinking,
          partial: this.partial(),
        })
      }

      // 正文
      if (delta.content) {
        if (this.textBlocks.length === 0) {
          this.textBlocks.push({ text: '' })
          events.push({ type: 'text_start', contentIndex: 0, partial: this.partial() })
        }
        const idx = this.textBlocks.length - 1
        this.textBlocks[idx].text += delta.content
        events.push({
          type: 'text_delta',
          contentIndex: idx,
          delta: delta.content,
          partial: this.partial(),
        })
      }

      // 工具调用（M1 无工具，映射器仍按协议完整支持，票 13 复用）
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0
          let state = this.toolCalls[index]
          if (!state) {
            state = {
              id: tc.id ?? `call_${index}`,
              name: tc.function?.name ?? '',
              argsText: '',
              contentIndex: this.textBlocks.length + this.thinkingBlocks.length + this.toolCalls.length,
            }
            this.toolCalls[index] = state
            events.push({
              type: 'toolcall_start',
              contentIndex: state.contentIndex,
              partial: this.partial(),
            })
          }
          if (tc.id) state.id = tc.id
          if (tc.function?.name) state.name = tc.function.name
          if (tc.function?.arguments) {
            state.argsText += tc.function.arguments
            events.push({
              type: 'toolcall_delta',
              contentIndex: state.contentIndex,
              delta: tc.function.arguments,
              partial: this.partial(),
            })
          }
        }
      }
    }

    if (choice.finish_reason) {
      this.finishReason = mapFinishReason(choice.finish_reason)
    }
    return events
  }

  /**
   * 流终止（`[DONE]` 或宿主 done 帧）：结算末事件。
   *
 * 已收到过 finish_reason 时按其收尾；否则按 stop（宿主干净断流视为正常结束）。
   */
  finish(fallbackReason: 'stop' | 'length' | 'toolUse'): AssistantMessageEvent {
    const reason = this.finishReason ?? fallbackReason
    const finalMessage = this.finalMessage(reason)
    if (!this.started) {
      // 一个内容事件都没收到：直接 done（空回复，不伪造 start）
      return { type: 'done', reason, message: finalMessage }
    }
    // 补全各块的 *_end 事件（若流在块中途被截断，end 仍按当前内容结算）
    const events: AssistantMessageEvent[] = []
    this.thinkingBlocks.forEach((b, i) => {
      events.push({ type: 'thinking_end', contentIndex: i, content: b.text, partial: this.partial() })
    })
    this.textBlocks.forEach((b, i) => {
      events.push({ type: 'text_end', contentIndex: i, content: b.text, partial: this.partial() })
    })
    this.toolCalls.forEach((tc) => {
      const args = parseToolArgs(tc.argsText)
      const toolCall: ToolCall = { type: 'toolCall', id: tc.id, name: tc.name, arguments: args }
      events.push({
        type: 'toolcall_end',
        contentIndex: tc.contentIndex,
        toolCall,
        partial: this.partial(),
      })
    })
    return { type: 'done', reason, message: finalMessage }
  }

  /** 当前 partial 消息（事件协议的 partial 字段：累积到此刻的响应） */
  private partial(): AssistantMessage {
    return this.assemble(this.finishReason ?? 'pending')
  }

  private finalMessage(reason: 'stop' | 'length' | 'toolUse'): AssistantMessage {
    return this.assemble(reason)
  }

  private assemble(stopReason: AssistantMessage['stopReason']): AssistantMessage {
    const content: AssistantMessage['content'] = []
    for (const b of this.thinkingBlocks) content.push({ type: 'thinking', thinking: b.text })
    for (const b of this.textBlocks) content.push({ type: 'text', text: b.text })
    for (const tc of this.toolCalls) {
      content.push({
        type: 'toolCall',
        id: tc.id,
        name: tc.name,
        arguments: parseToolArgs(tc.argsText),
      })
    }
    return {
      role: 'assistant',
      content,
      api: 'openai-completions',
      provider: this.provider,
      model: this.model,
      responseId: this.responseId,
      usage: {
        input: this.usage.input,
        output: this.usage.output,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: this.usage.total || this.usage.input + this.usage.output,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: this.timestamp,
    }
  }
}

function mapFinishReason(raw: string): 'stop' | 'length' | 'toolUse' {
  switch (raw) {
    case 'length':
      return 'length'
    case 'tool_calls':
    case 'function_call':
      return 'toolUse'
    default:
      return 'stop'
  }
}

/** 工具调用参数：增量片段拼出的 JSON；解析失败给空对象并留错（由 pi 校验拦截） */
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
