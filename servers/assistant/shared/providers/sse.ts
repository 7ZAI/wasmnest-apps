/**
 * SSE 解析器（票 08 / spec §5.2）
 *
 * 宿主 http 流式走 **raw 模式**：逐网络 chunk 透传原始字节，SSE 语义由消费侧
 * 自行切分。本模块是共享核里唯一的 SSE 切分实现：把任意分片边界的文本流
 * （半包、多事件一包、心跳注释、异常中断）归一为完整事件序列。
 *
 * 协议要点（Server-Sent Events 规范子集）：
 * - 事件以空行分隔；一个事件可含多条 `data:` 行，按行用 `\n` 拼接；
 * - `event:` / `id:` 为可选字段；`:` 开头为注释（心跳），跳过；
 * - `data:` 行去掉一个前导空格后取值（`data:x` 与 `data: x` 等价）；
 * - 流异常中断时 `flush()` 把残留缓冲按「末事件」吐出，供调用方尽力解析。
 *
 * 纯函数式状态机，无 IO / 无定时器，双端同构，单测可覆盖全部边界。
 */

/** 一个完整 SSE 事件 */
export interface SseEvent {
  /** `data:` 行拼接结果（空串表示无数据行） */
  data: string
  /** `event:` 字段（缺省 undefined） */
  event?: string
  /** `id:` 字段（缺省 undefined） */
  id?: string
}

/** 解析过程中的行类型 */
type ParsedLine =
  | { kind: 'data'; value: string }
  | { kind: 'event'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'comment'; value: string }
  | { kind: 'blank' }

/** 解析单行（处理行内 `\r` 与 `data:` 前导空格） */
function parseLine(line: string): ParsedLine {
  if (line === '') return { kind: 'blank' }
  if (line.startsWith(':')) return { kind: 'comment', value: line.slice(1) }
  const colon = line.indexOf(':')
  if (colon === -1) {
    // 无冒号字段：整行是字段名，值为空（规范允许）
    return { kind: 'data', value: '' }
  }
  const field = line.slice(0, colon)
  let value = line.slice(colon + 1)
  if (value.startsWith(' ')) value = value.slice(1)
  if (field === 'data') return { kind: 'data', value }
  if (field === 'event') return { kind: 'event', value }
  if (field === 'id') return { kind: 'id', value }
  // 未知字段：忽略（规范：未知字段必须忽略）
  return { kind: 'comment', value }
}

export class SseParser {
  /** 跨 chunk 的残留缓冲（半包在这里补齐） */
  private buffer = ''

  /**
   * 推入一个原始文本 chunk，返回本次能凑出的完整事件。
   *
   * 分片边界完全由网络决定：一次 push 可能产出 0 个（半包）、1 个或多个事件。
   */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []
    // 事件以空行分隔：按行扫描，遇空行结算当前事件
    const lines = this.buffer.split('\n')
    // 最后一段可能是不完整行（没有换行符），留在缓冲里等下一个 chunk
    this.buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      const parsed = parseLine(line)
      if (parsed.kind === 'blank') {
        const ev = this.settle()
        if (ev) events.push(ev)
      } else {
        this.accumulate(parsed)
      }
    }
    return events
  }

  /**
   * 流终止时调用：把残留缓冲按末事件吐出。
   *
   * 残留含未结算的 data 行时返回该事件（尽力解析，不丢最后一段内容）；
   * 纯注释 / 空缓冲返回空数组。
   */
  flush(): SseEvent[] {
    if (this.buffer === '') return []
    const remaining = this.buffer
    this.buffer = ''
    // 末行可能无换行符：手动走一遍行解析（复用 accumulate + settle）
    const lines = remaining.split('\n')
    const events: SseEvent[] = []
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      const parsed = parseLine(line)
      if (parsed.kind === 'blank') {
        const ev = this.settle()
        if (ev) events.push(ev)
      } else {
        this.accumulate(parsed)
      }
    }
    const last = this.settle()
    if (last) events.push(last)
    return events
  }

  private dataLines: string[] = []
  private eventName: string | undefined
  private lastId: string | undefined

  private accumulate(line: ParsedLine): void {
    if (line.kind === 'data') this.dataLines.push(line.value)
    else if (line.kind === 'event') this.eventName = line.value
    else if (line.kind === 'id') this.lastId = line.value
    // comment / 未知字段：忽略
  }

  /** 结算当前事件（空行触发）；无数据行则不算完整事件（纯注释块） */
  private settle(): SseEvent | undefined {
    if (this.dataLines.length === 0) {
      this.eventName = undefined
      this.lastId = undefined
      return undefined
    }
    const ev: SseEvent = { data: this.dataLines.join('\n') }
    if (this.eventName !== undefined) ev.event = this.eventName
    if (this.lastId !== undefined) ev.id = this.lastId
    this.dataLines = []
    this.eventName = undefined
    this.lastId = undefined
    return ev
  }
}
