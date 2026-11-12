/**
 * SSE 解析器单测（票 08 票面要求：分片边界全覆盖）
 *
 * 覆盖：半包、多事件一包、心跳注释、CRLF、多 data 行、异常中断 flush、
 * [DONE] 透传。纯函数状态机，不依赖 DOM / 定时器。
 */
import { describe, it, expect } from 'vitest'
import { SseParser } from '@nest-shared/providers/sse'

describe('SseParser（票 08 分片边界）', () => {
  it('半包：不完整行留在缓冲，下一个 chunk 补齐后结算', () => {
    const p = new SseParser()
    expect(p.push('data: {"a":')).toEqual([])
    const events = p.push('1}\n\n')
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"a":1}')
  })

  it('多事件一包：一次 push 结算多个事件', () => {
    const p = new SseParser()
    const events = p.push('data: one\n\ndata: two\n\ndata: three\n\n')
    expect(events.map((e) => e.data)).toEqual(['one', 'two', 'three'])
  })

  it('心跳注释：`: ping` 块不产出事件', () => {
    const p = new SseParser()
    expect(p.push(': ping\n\n')).toEqual([])
    const events = p.push('data: real\n\n')
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('real')
  })

  it('CRLF：`\\r\\n` 行尾正确结算', () => {
    const p = new SseParser()
    const events = p.push('data: x\r\n\r\n')
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('x')
  })

  it('多 data 行：同事件内按行用换行拼接', () => {
    const p = new SseParser()
    const events = p.push('data: a\ndata: b\n\n')
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('a\nb')
  })

  it('data: 前导空格：`data: x` 与 `data: x` 等价', () => {
    const p = new SseParser()
    const events = p.push('data:no-space\n\ndata: space\n\n')
    expect(events.map((e) => e.data)).toEqual(['no-space', 'space'])
  })

  it('异常中断：flush 吐出残留缓冲（尽力解析，不丢末段）', () => {
    const p = new SseParser()
    expect(p.push('data: partial')).toEqual([])
    const events = p.flush()
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('partial')
  })

  it('flush 空缓冲返回空数组', () => {
    const p = new SseParser()
    expect(p.flush()).toEqual([])
  })

  it('跨 chunk 的半事件：两次 push 拼出完整事件', () => {
    const p = new SseParser()
    expect(p.push('event: mess')).toEqual([])
    const events = p.push('age\ndata: d\n\n')
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('message')
    expect(events[0].data).toBe('d')
    expect(p.push('')).toEqual([])
  })

  it('[DONE] 作为普通 data 行透传（语义由映射层处理）', () => {
    const p = new SseParser()
    const events = p.push('data: [DONE]\n\n')
    expect(events[0].data).toBe('[DONE]')
  })
})
