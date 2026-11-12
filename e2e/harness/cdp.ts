/**
 * CDP（Chrome DevTools Protocol）会话 —— 移动端 WebView 的脚本控制面
 *
 * 移动端没有 `tauri-plugin-wdio`，WebDriver 也管不到 Android 上 Tauri 用的系统 WebView；
 * 但 wry 在 **debug 构建**下会调用 `WebView.setWebContentsDebuggingEnabled(true)`
 * （wry `android/main_pipe.rs` 的 `#[cfg(any(debug_assertions, feature = "devtools"))]` 分支，
 * Tauri 侧 `devtools.unwrap_or(true)`），因此 debug APK 一定能在
 * `/proc/net/unix` 里看到 `webview_devtools_remote_<pid>` 套接字。
 *
 * 这里的职责边界：
 * - 只做 JSON-RPC 请求/响应 + 事件缓冲，不实现任何设备操作（adb 在 `adb.ts`）；
 * - DOM 原语在 `mobile.ts` 组装（与 `driver.ts` 的桌面原语保持同形，便于对照阅读）。
 */

import { MinimalWebSocket } from './ws'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** 一条 CDP 事件（只保留最近若干条，失败现场用） */
export interface CdpEvent {
  method: string
  params: unknown
}

const MAX_BUFFERED_EVENTS = 200

export class CdpSession {
  private seq = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly events: CdpEvent[] = []
  private closedReason: Error | null = null

  private constructor(private readonly ws: MinimalWebSocket) {
    ws.onText((text) => this.dispatch(text))
    ws.onClose((error) => this.failAll(error ?? new Error('CDP 连接已关闭')))
  }

  /** 连接一条 WebSocket 调试地址并开启 Runtime 域 */
  static async open(wsUrl: string, timeoutMs = 15_000): Promise<CdpSession> {
    const ws = await MinimalWebSocket.connect(wsUrl, timeoutMs)
    const session = new CdpSession(ws)
    await session.request('Runtime.enable', {}, timeoutMs)
    return session
  }

  /** 发一条 CDP 命令；超时 / 连接断开会 reject（不静默返回 undefined） */
  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    if (this.closedReason) {
      return Promise.reject(this.closedReason)
    }
    this.seq += 1
    const id = this.seq
    const payload = JSON.stringify({ id, method, params })

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })

      try {
        this.ws.sendText(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** 最近的事件（Console / Page 等；失败时打印用） */
  recentEvents(): CdpEvent[] {
    return [...this.events]
  }

  /** 关闭会话（幂等） */
  close(): void {
    this.ws.close()
    this.failAll(new Error('CDP 会话已关闭'))
  }

  private dispatch(text: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string; data?: string }; method?: string; params?: unknown }
    try {
      message = JSON.parse(text)
    } catch {
      // 非 JSON 帧不符合 CDP 契约；记录下来而不是静默丢弃
      this.events.push({ method: 'parse-error', params: text.slice(0, 200) })
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        const detail = message.error.data ? `${message.error.message}（${message.error.data}）` : message.error.message
        pending.reject(new Error(`CDP 错误：${detail}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string') {
      this.events.push({ method: message.method, params: message.params })
      if (this.events.length > MAX_BUFFERED_EVENTS) {
        this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
      }
    }
  }

  private failAll(error: Error): void {
    if (!this.closedReason) this.closedReason = error
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(this.closedReason)
      this.pending.delete(id)
    }
  }
}
