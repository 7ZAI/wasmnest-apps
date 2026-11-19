/**
 * Gemini provider 适配（票 10 / spec §5.2、D17）
 *
 * 与 OpenAI 兼容路径**同形协议、自实现**（跨应用源码耦合禁止，spec §5.2）：
 * - 请求构建：pi 的 `Message[]` → Gemini `streamGenerateContent`（`alt=sse`）
 *   形状（systemInstruction 顶层参数、contents 角色映射、连续同角色合并、
 *   functionCall / functionResponse 块映射）；
 * - 流映射：Gemini SSE（每条 data 是一个 GenerateContentResponse JSON，
 *   无 `event:` 字段）→ pi-ai 的 `AssistantMessageEvent` 协议
 *   （`start` / `text_*` / `thinking_*` / `toolcall_*` / `done`）。
 *
 * 方言知识只住本模块；Rust 侧与宿主都不持有 Gemini 语义（spec §3.1）。
 */
import type {
  AssistantMessage,
  AssistantMessageEvent,
  JsonValue,
  Message,
  TextContent,
  ToolCall,
} from '@earendil-works/pi-ai'
import type { ChatStreamRequest } from '../types'
import { StreamMapError } from './stream-error'

/** Gemini REST 缺省 base（用户可配自定义 / 本地端点） */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

/**
 * 拼接流式 URL：`<base>/v1beta/models/<model>:streamGenerateContent?alt=sse`。
 *
 * baseURL 可为缺省端点、`https://generativelanguage.googleapis.com/v1beta`
 * （不重复补 `/v1beta`）或已含 `:streamGenerateContent` 的完整端点
 * （原样使用，不重复拼接）。
 */
export function joinGeminiStreamUrl(baseUrl: string, model: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '') || GEMINI_DEFAULT_BASE_URL
  if (/:streamGenerateContent(\?|$)/i.test(trimmed)) return trimmed
  const modelsPath = /\/v1beta$/i.test(trimmed) ? '/models' : '/v1beta/models'
  return `${trimmed}${modelsPath}/${model}:streamGenerateContent?alt=sse`
}

/** 取消息内容块里的文本（M1 只读文本；图像块不参与文本拼接） */
function textOf(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
}

/**
 * pi `Message[]` → Gemini contents。
 *
 * system → 顶层 `systemInstruction`；user / assistant 映射为 contents 角色
 * （assistant → `model`）；连续同角色消息合并为一条（parts 追加）。
 * toolCall → `functionCall` part；toolResult → user 侧 `functionResponse` part。
 */
export function mapMessagesToGemini(messages: Message[]): {
  systemInstruction?: { parts: Array<{ text: string }> }
  contents: Array<Record<string, unknown>>
} {
  const systemTexts: string[] = []
  const contents: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemTexts.push(textOf(m.content))
      continue
    }
    if (m.role === 'toolResult') {
      const part = {
        functionResponse: {
          name: m.toolCallId,
          response: { result: textOf(m.content) },
        },
      }
      const last = contents[contents.length - 1]
      if (last && last.role === 'user') {
        if (!Array.isArray(last.parts)) last.parts = []
        ;(last.parts as unknown[]).push(part)
      } else {
        contents.push({ role: 'user', parts: [part] })
      }
      continue
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = []
      const texts = m.content.filter((b): b is TextContent => b.type === 'text')
      if (texts.length > 0) parts.push({ text: texts.map((b) => b.text).join('\n') })
      for (const b of m.content) {
        if (b.type === 'toolCall') {
          parts.push({ functionCall: { name: b.name, args: b.arguments ?? {} } })
        }
      }
      const role = 'model'
      const last = contents[contents.length - 1]
      if (last && last.role === role) {
        const lastParts = (last.parts as unknown[]) ?? []
        last.parts = [...lastParts, ...parts]
      } else {
        contents.push({ role, parts })
      }
    } else {
      const parts = [{ text: textOf(m.content) }]
      const role = 'user'
      const last = contents[contents.length - 1]
      if (last && last.role === role) {
        const lastParts = (last.parts as unknown[]) ?? []
        last.parts = [...lastParts, ...parts]
      } else {
        contents.push({ role, parts })
      }
    }
  }
  const out: { systemInstruction?: { parts: Array<{ text: string }> }; contents: Array<Record<string, unknown>> } = {
    contents,
  }
  const system = systemTexts.filter(Boolean).join('\n')
  if (system) out.systemInstruction = { parts: [{ text: system }] }
  return out
}

/** 构建流式请求（`host.http_fetch` raw 模式载荷） */
export function buildGeminiStreamRequest(opts: {
  apiKey: string
  baseUrl: string
  model: string
  messages: Message[]
  streamEvent: string
}): ChatStreamRequest {
  const mapped = mapMessagesToGemini(opts.messages)
  const body: Record<string, unknown> = {
    contents: mapped.contents,
  }
  if (mapped.systemInstruction) body.systemInstruction = mapped.systemInstruction
  return {
    method: 'POST',
    url: joinGeminiStreamUrl(opts.baseUrl, opts.model),
    headers: {
      'x-goog-api-key': opts.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    stream: true,
    streamEvent: opts.streamEvent,
  }
}

// ==================== 流映射（Gemini SSE → pi 事件） ====================

/** Gemini 流映射失败（非法 JSON / 形状不符） */
export class GeminiStreamError extends StreamMapError {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiStreamError'
  }
}

/** 内容块状态（按出现顺序紧凑跟踪） */
type GeminiBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; argsText: string }

/**
 * 有状态的 Gemini 流映射器。
 *
 * 输入：SSE `data` 行原文（每条是一个 GenerateContentResponse JSON；
 * `event` 参数忽略——Gemini 不使用 `event:` 字段）；输出：pi-ai
 * `AssistantMessageEvent` 协议事件。
 */
export class GeminiStreamMapper {
  private started = false
  private blocks: GeminiBlock[] = []
  private finishReason: 'stop' | 'length' | 'toolUse' | undefined
  private usage = { input: 0, output: 0, total: 0 }
  private responseId: string | undefined
  private timestamp = Date.now()

  constructor(
    private readonly provider: string,
    private readonly model: string,
  ) {}

  /** 处理一条 SSE data 行；返回要推送的协议事件 */
  handleData(data: string, _event?: string): AssistantMessageEvent[] {
    if (data === '[DONE]') {
      // Gemini 正常无 [DONE]（以流结束收尾）；代理若发则按兜底处理
      return [this.finish('stop')]
    }
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new GeminiStreamError('Gemini SSE data 不是对象 JSON')
      }
      payload = parsed as Record<string, unknown>
    } catch (e) {
      if (e instanceof GeminiStreamError) throw e
      throw new GeminiStreamError(`Gemini SSE data 不是合法 JSON: ${truncate(data)}`)
    }

    const events: AssistantMessageEvent[] = []
    if (payload.responseId) this.responseId = String(payload.responseId)
    const usage = payload.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined
    if (usage) {
      this.usage = {
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
        total: usage.totalTokenCount ?? 0,
      }
    }

    const candidate = (payload.candidates as Array<Record<string, unknown>> | undefined)?.[0]
    if (!candidate) {
      // 无候选（如纯 usage 帧）：不产生内容事件
      return events
    }

    const content = candidate.content as
      | { parts?: Array<Record<string, unknown>> }
      | undefined
    const parts = content?.parts ?? []
    for (const part of parts) {
      // 思考（thought 标记的思考模型输出）
      if (part.thought === true && typeof part.text === 'string') {
        const last = this.blocks[this.blocks.length - 1]
        const contentIndex = last?.kind === 'thinking' ? this.blocks.length - 1 : this.blocks.length
        if (last?.kind === 'thinking') {
          last.text += part.text
        } else {
          this.blocks.push({ kind: 'thinking', text: part.text })
          events.push(this.blockStartEvents(contentIndex))
        }
        events.push({
          type: 'thinking_delta',
          contentIndex,
          delta: part.text,
          partial: this.partial(),
        })
        continue
      }
      // 正文
      if (typeof part.text === 'string') {
        const last = this.blocks[this.blocks.length - 1]
        const contentIndex = last?.kind === 'text' ? this.blocks.length - 1 : this.blocks.length
        if (last?.kind === 'text') {
          last.text += part.text
        } else {
          this.blocks.push({ kind: 'text', text: part.text })
          events.push(this.blockStartEvents(contentIndex))
        }
        events.push({
          type: 'text_delta',
          contentIndex,
          delta: part.text,
          partial: this.partial(),
        })
        continue
      }
      // 函数调用：每个 functionCall part 是独立的工具调用（不并块）
      const fc = part.functionCall as { name?: string; args?: unknown } | undefined
      if (fc) {
        const block: Extract<GeminiBlock, { kind: 'tool' }> = {
          kind: 'tool',
          id: `call_${this.blocks.length}`,
          name: fc.name ?? '',
          argsText: '',
        }
        this.blocks.push(block)
        const idx = this.blocks.length - 1
        events.push(this.blockStartEvents(idx))
        const argsText = fc.args == null ? '' : JSON.stringify(fc.args)
        block.argsText += argsText
        if (argsText) {
          events.push({
            type: 'toolcall_delta',
            contentIndex: idx,
            delta: argsText,
            partial: this.partial(),
          })
        }
      }
    }

    const finishReason = candidate.finishReason as string | undefined
    if (finishReason) this.finishReason = mapGeminiFinishReason(finishReason)

    // start 事件：首个内容事件前补发
    if (events.length > 0) {
      return this.ensureStarted().concat(events)
    }
    return events
  }

  /** 流终止（宿主 done 帧）：结算末事件 */
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
          contentIndex: i,
          content: b.text,
          partial: this.partial(),
        })
      } else if (b.kind === 'text') {
        events.push({
          type: 'text_end',
          contentIndex: i,
          content: b.text,
          partial: this.partial(),
        })
      } else {
        events.push({
          type: 'toolcall_end',
          contentIndex: i,
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

  /** 首个内容事件前补 `start` */
  private ensureStarted(): AssistantMessageEvent[] {
    if (this.started) return []
    this.started = true
    return [{ type: 'start', partial: this.partial() }]
  }

  /** 新块 → 对应 *_start 事件（调用前块已入数组） */
  private blockStartEvents(index: number): AssistantMessageEvent {
    const block = this.blocks[index]
    if (block.kind === 'thinking') {
      return { type: 'thinking_start', contentIndex: index, partial: this.partial() }
    }
    if (block.kind === 'tool') {
      return { type: 'toolcall_start', contentIndex: index, partial: this.partial() }
    }
    return { type: 'text_start', contentIndex: index, partial: this.partial() }
  }

  private partial(): AssistantMessage {
    return this.assemble(this.finishReason ?? 'pending')
  }

  private assemble(stopReason: AssistantMessage['stopReason']): AssistantMessage {
    const content: AssistantMessage['content'] = []
    for (const b of this.blocks) {
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
      api: 'google-generative-ai',
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

/** Gemini finishReason → pi stopReason */
function mapGeminiFinishReason(raw: string): 'stop' | 'length' | 'toolUse' {
  switch (raw) {
    case 'MAX_TOKENS':
      return 'length'
    case 'TOOL_CALLS':
      return 'toolUse'
    default:
      // STOP / OTHER 等一律视为正常结束
      return 'stop'
  }
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
