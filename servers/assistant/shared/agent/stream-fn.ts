/**
 * pi-agent-core 的 StreamFn（票 08 / spec §5.2）
 *
 * 契约（pi-agent-core 逐字）：
 * - **不抛异常、不返回 rejected promise**：所有失败（无 provider / 请求被拒 /
 *   网络失败 / 鉴权失败 / 流中断 / 用户中止）编码为协议事件——终止事件
 *   `{ type: 'error', reason: 'error' | 'aborted', error }`，error 消息带
 *   `stopReason` + `errorMessage`；
 * - 成功流以 `{ type: 'done', reason, message }` 收尾；
 * - 事件经 `createAssistantMessageEventStream()` 推送（pi-ai 工厂，
 *   `@earendil-works/pi-ai/utils/event-stream` 子路径，无 node: 依赖，
 *   spec 风险 #1）。
 *
 * 链路：构建 provider 请求（`shared/providers/`）→ `assistant.chat-stream`
 * → Rust 校验透传 → 宿主流式事件 `{ chunk, done }` → SSE 解析 → pi 事件。
 * 用户中止：监听 `options.signal`，立即停止推送并编码 aborted；宿主是否可断流
 * 不可知，取消后丢弃后续 chunk 并如实记录（spec 风险 #3）。
 */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import { SseParser } from '../providers/sse'
import {
  OpenAICompatStreamError,
  OpenAICompatStreamMapper,
  buildOpenAICompatChatRequest,
} from '../providers/openai-compat'
import {
  ASSISTANT_CHAT_STREAM_COMMAND,
  assistantStreamEvent,
  newStreamId,
  type AssistantInvoke,
  type ChatStreamEventPayload,
  type ProviderApiStyle,
} from '../types'

/** 零用量（provider 未回报 usage 时的兜底，不伪造计费） */
function zeroUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** 失败消息（协议 error 事件的 error 字段：stopReason + errorMessage） */
function failureMessage(
  model: Model<any>,
  reason: 'error' | 'aborted',
  errorMessage: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: reason,
    errorMessage,
    timestamp: Date.now(),
  }
}

/** 请求上下文（构建请求所需的 provider 信息；apiKey 按需从保险库取用） */
export interface RequestContext {
  apiStyle: ProviderApiStyle
  apiKey: string
  baseUrl: string
  model: string
}

export interface StreamFnDeps {
  /** 命令调用（桌面 appInvoke / 移动 commands.execute 同形） */
  invoke: AssistantInvoke
  /**
   * 事件订阅（端差异点）：桌面 `@tauri-apps/api/event` listen、移动
   * `context.events.on`；返回退订函数。
   */
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void
  /**
   * 解析请求上下文：按 model.provider 找 provider 记录、按需从保险库取密钥。
   * 返回 null = 无可用 provider（编码为 error 事件，不抛）。
   */
  resolveRequestContext: (model: Model<any>) => Promise<RequestContext | null>
  /** 日志（可选；取消时如实记录「宿主可能仍在后台读取」） */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export function createStreamFn(deps: StreamFnDeps): StreamFn {
  return async (
    model,
    _context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> => {
    const stream = createAssistantMessageEventStream()
    const signal = options?.signal

    let finished = false
    let unsubscribe: (() => void) | null = null
    let onAbort: (() => void) | null = null

    const log = (level: 'info' | 'warn' | 'error', message: string) => {
      deps.log?.(level, message)
    }

    /** 编码失败事件并收尾（幂等） */
    const fail = (reason: 'error' | 'aborted', errorMessage: string) => {
      if (finished) return
      finished = true
      unsubscribe?.()
      unsubscribe = null
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      onAbort = null
      log(reason === 'aborted' ? 'warn' : 'error', `[nest] 流终止（${reason}）：${errorMessage}`)
      stream.push({ type: 'error', reason, error: failureMessage(model, reason, errorMessage) })
      stream.end()
    }

    /** 正常收尾（done 事件 + end） */
    const finishDone = (mapper: OpenAICompatStreamMapper) => {
      if (finished) return
      finished = true
      unsubscribe?.()
      unsubscribe = null
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      onAbort = null
      let doneEvent: AssistantMessageEvent
      try {
        doneEvent = mapper.finish('stop')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fail('error', `流收尾失败：${msg}`)
        return
      }
      if (doneEvent.type !== 'done') {
        fail('error', '流收尾未产出 done 事件')
        return
      }
      stream.push(doneEvent)
      stream.end(doneEvent.message)
    }

    // 用户中止：signal 在流任何阶段都可能置位
    if (signal?.aborted) {
      fail('aborted', '已停止生成')
      return stream
    }
    if (signal) {
      onAbort = () => fail('aborted', '已停止生成')
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      // 1. 请求上下文（provider + 密钥；无则点名缺什么）
      let ctx: RequestContext | null
      try {
        ctx = await deps.resolveRequestContext(model)
      } catch (e) {
        fail('error', `读取 provider 配置失败：${errMsg(e)}`)
        return stream
      }
      if (!ctx) {
        fail('error', '没有可用的 provider：请在设置里配置供应商并解锁保险库')
        return stream
      }

      // 2. 构建请求（方言在 providers/；未知方言点名）
      const streamId = newStreamId()
      const streamEvent = assistantStreamEvent(streamId)
      const request = buildProviderRequest({
        apiStyle: ctx.apiStyle,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        messages: _context.messages,
        streamEvent,
      })

      // 3. 提交流式命令（Rust 校验透传；被拒点名）
      let accepted: { streamId: string; streamEvent: string }
      try {
        accepted = await deps.invoke<{ streamId: string; streamEvent: string }>(
          ASSISTANT_CHAT_STREAM_COMMAND,
          { streamId, request },
        )
      } catch (e) {
        fail('error', `对话请求被拒绝：${errMsg(e)}`)
        return stream
      }
      const eventChannel = accepted?.streamEvent || streamEvent

      // 4. 订阅宿主流事件，逐 chunk 解析推送
      const parser = new SseParser()
      const mapper = new OpenAICompatStreamMapper(model.provider, ctx.model)

      unsubscribe = deps.subscribe(eventChannel, (payload) => {
        if (finished) return
        if (signal?.aborted) {
          fail('aborted', '已停止生成')
          return
        }
        const evt = payload as ChatStreamEventPayload
        if (!evt || typeof evt !== 'object') {
          fail('error', '流事件载荷形状非法')
          return
        }
        if (evt.done) {
          if (evt.error) {
            fail('error', evt.error)
          } else {
            // 宿主干净断流：残留缓冲尽力解析后收尾
            for (const e of parser.flush()) dispatchData(e.data)
            if (finished) return
            finishDone(mapper)
          }
          return
        }
        if (typeof evt.chunk !== 'string') {
          fail('error', '流 chunk 载荷形状非法')
          return
        }
        for (const sse of parser.push(evt.chunk)) {
          if (!dispatchData(sse.data)) return // dispatchData 内 fail 后 finished=true
        }
      })

      /** 处理一条 SSE data 行；返回 false 表示已终止（finished） */
      const dispatchData = (data: string): boolean => {
        if (finished) return false
        if (data === '') return true // 无数据行的事件：忽略
        try {
          if (data === '[DONE]') {
            finishDone(mapper)
            return false
          }
          const events = mapper.handleData(data)
          for (const e of events) stream.push(e)
          return true
        } catch (e) {
          if (e instanceof OpenAICompatStreamError) {
            fail('error', e.message)
          } else {
            fail('error', `流数据解析失败：${errMsg(e)}`)
          }
          return false
        }
      }

      // 流事件通道在宿主侧是后台推送：本函数返回后由事件驱动，直到 done/error
      return stream
    } catch (e) {
      // 兜底：StreamFn 契约不抛——任何意外都编码为 error 事件
      fail('error', `对话流异常：${errMsg(e)}`)
      return stream
    }
  }
}

/** 按方言分派请求构建（M1：OpenAI 兼容；票 10 在此扩 Anthropic / Gemini） */
function buildProviderRequest(opts: {
  apiStyle: ProviderApiStyle
  apiKey: string
  baseUrl: string
  model: string
  messages: unknown[]
  streamEvent: string
}): ReturnType<typeof buildOpenAICompatChatRequest> {
  switch (opts.apiStyle) {
    case 'openai-compatible':
      return buildOpenAICompatChatRequest({
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        messages: opts.messages as Parameters<typeof buildOpenAICompatChatRequest>[0]['messages'],
        streamEvent: opts.streamEvent,
      })
    default:
      throw new Error(`不支持的 provider 方言：${String(opts.apiStyle)}`)
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
