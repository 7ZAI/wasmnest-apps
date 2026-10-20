/**
 * 最小 WebSocket 客户端（RFC 6455 子集）——只为 CDP 服务
 *
 * ## 为什么自己写而不是引依赖
 *
 * 移动端 E2E 需要经 `adb forward` 后走 CDP（Chrome DevTools Protocol）读写 WebView DOM，
 * 而 CDP 只有 WebSocket 一种传输。仓里没有 `ws` 依赖，Node 20 也没有全局 `WebSocket`
 * （21 才默认开启）；为一条测试通道新增运行时依赖不划算，故在 harness 内实现**够用的**
 * 子集：文本帧、分片重组、ping/pong、close，不做扩展协商、不做压缩（CDP 默认不开压缩）。
 *
 * ## 边界
 *
 * - 只支持 `ws://`（CDP 由 adb forward 打到本机回环，无需 TLS）；
 * - 只处理文本帧（CDP 消息一律 JSON 文本）；
 * - 单帧上限 32 MiB（DOM dump / 截图走 adb，不经这里）。
 */

import { createHash, randomBytes } from 'node:crypto'
import { connect, type Socket } from 'node:net'

/** RFC 6455 握手固定 GUID */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 单条消息上限：防御性上限，正常 CDP 响应远小于此值 */
const MAX_PAYLOAD = 32 * 1024 * 1024

/** 连接已关闭（对端关闭 / 网络错误） */
export class WsClosedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WsClosedError'
  }
}

/** 编码一帧（客户端 → 服务端必须加掩码） */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4)
  const length = payload.length
  let header: Buffer

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }

  const masked = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i += 1) {
    masked[i] = payload[i]! ^ mask[i % 4]!
  }
  return Buffer.concat([header, mask, masked])
}

export class MinimalWebSocket {
  private buffer: Buffer
  private fragments: Buffer[] = []
  private textHandler: ((text: string) => void) | null = null
  private closeHandler: ((error?: Error) => void) | null = null
  /**
   * 握手响应与首帧可能同包到达（服务端一次性 write），而调用方要等 connect() resolve
   * 之后才能注册 handler。先到的文本必须排队，否则 CDP 的首批事件会静默丢失。
   */
  private pendingTexts: string[] = []
  private closed = false

  private constructor(
    private readonly socket: Socket,
    initial: Buffer,
  ) {
    this.buffer = initial
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    socket.on('close', () => this.finish(new WsClosedError('websocket closed by peer')))
    socket.on('error', (error: Error) => this.finish(error))
    if (this.buffer.length > 0) this.drain()
  }

  /** 建立连接（握手 + 校验 Sec-WebSocket-Accept） */
  static connect(url: string, timeoutMs = 10_000): Promise<MinimalWebSocket> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'ws:') {
      return Promise.reject(new Error(`仅支持 ws://（收到 ${parsed.protocol}//）：${url}`))
    }
    const host = parsed.hostname
    const port = Number(parsed.port || 80)
    const path = `${parsed.pathname}${parsed.search}`
    const key = randomBytes(16).toString('base64')

    return new Promise((resolve, reject) => {
      const socket = connect({ host, port })
      const chunks: Buffer[] = []
      let settled = false

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(error)
      }

      const timer = setTimeout(() => fail(new Error(`websocket 握手超时（${timeoutMs}ms）：${url}`)), timeoutMs)

      socket.once('error', fail)
      socket.once('connect', () => {
        socket.write(
          [
            `GET ${path} HTTP/1.1`,
            `Host: ${host}:${port}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n'),
        )
      })

      const onData = (chunk: Buffer) => {
        chunks.push(chunk)
        const all = Buffer.concat(chunks)
        const headEnd = all.indexOf('\r\n\r\n')
        if (headEnd < 0) return

        socket.off('data', onData)
        socket.off('error', fail)
        const header = all.subarray(0, headEnd).toString('latin1')
        const statusLine = header.split('\r\n')[0] ?? ''

        if (!/^HTTP\/1\.1 101/i.test(statusLine)) {
          fail(new Error(`websocket 升级被拒：${statusLine}`))
          return
        }
        const expected = createHash('sha1')
          .update(key + WS_GUID)
          .digest('base64')
        if (!header.toLowerCase().includes(`sec-websocket-accept: ${expected.toLowerCase()}`)) {
          fail(new Error('websocket 握手校验失败：Sec-WebSocket-Accept 不匹配'))
          return
        }

        settled = true
        clearTimeout(timer)
        resolve(new MinimalWebSocket(socket, all.subarray(headEnd + 4)))
      }

      socket.on('data', onData)
    })
  }

  /** 订阅文本消息（CDP 的 JSON 帧）；注册前排队的消息会立即补发 */
  onText(handler: (text: string) => void): void {
    this.textHandler = handler
    for (const text of this.pendingTexts.splice(0)) handler(text)
  }

  /** 订阅关闭（正常关闭给 `WsClosedError`，异常给原始错误） */
  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler
  }

  /** 发送一条文本消息 */
  sendText(text: string): void {
    if (this.closed) throw new WsClosedError('websocket 已关闭，无法发送')
    this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
  }

  /** 主动关闭（先发 close 帧，再关 socket） */
  close(): void {
    if (this.closed) return
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)))
    } catch {
      /* 走关闭路径，忽略写失败 */
    }
    this.socket.end()
    this.finish(new WsClosedError('websocket closed locally'))
  }

  private finish(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.closeHandler?.(error)
  }

  /** 按帧边界消费缓冲区（可能一次 data 里有多帧 / 半帧） */
  private drain(): void {
    while (true) {
      if (this.buffer.length < 2) return

      const b0 = this.buffer[0]!
      const b1 = this.buffer[1]!
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let length = b1 & 0x7f
      let offset = 2

      if (length === 126) {
        if (this.buffer.length < 4) return
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        const big = this.buffer.readBigUInt64BE(2)
        if (big > BigInt(MAX_PAYLOAD)) {
          this.socket.destroy()
          this.finish(new Error(`websocket 帧过大：${big} 字节`))
          return
        }
        length = Number(big)
        offset = 10
      }

      if (length > MAX_PAYLOAD) {
        this.socket.destroy()
        this.finish(new Error(`websocket 帧过大：${length} 字节`))
        return
      }

      let maskKey: Buffer | null = null
      if (masked) {
        if (this.buffer.length < offset + 4) return
        maskKey = this.buffer.subarray(offset, offset + 4)
        offset += 4
      }

      if (this.buffer.length < offset + length) return

      let payload = this.buffer.subarray(offset, offset + length)
      if (maskKey) {
        const unmasked = Buffer.allocUnsafe(length)
        for (let i = 0; i < length; i += 1) {
          unmasked[i] = payload[i]! ^ maskKey[i % 4]!
        }
        payload = unmasked
      }
      this.buffer = this.buffer.subarray(offset + length)

      this.handleFrame(fin, opcode, payload)
      if (this.closed) return
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) {
      // close：回一个 close 帧后按正常关闭处理（不当作错误）
      try {
        this.socket.write(encodeFrame(0x8, Buffer.alloc(0)))
      } catch {
        /* 忽略 */
      }
      this.socket.end()
      this.finish(new WsClosedError('websocket closed by peer'))
      return
    }
    if (opcode === 0x9) {
      // ping → pong（CDP 不主动 ping，但代理/驱动可能发）
      try {
        this.socket.write(encodeFrame(0xa, payload))
      } catch {
        /* 忽略 */
      }
      return
    }
    if (opcode === 0xa) return

    // 文本帧（0x1）或续帧（0x0）
    if (opcode === 0x1) this.fragments = []
    if (opcode !== 0x0 && opcode !== 0x1) return

    this.fragments.push(Buffer.from(payload))
    if (!fin) return

    const text = Buffer.concat(this.fragments).toString('utf8')
    this.fragments = []
    if (this.textHandler) this.textHandler(text)
    else this.pendingTexts.push(text)
  }
}
