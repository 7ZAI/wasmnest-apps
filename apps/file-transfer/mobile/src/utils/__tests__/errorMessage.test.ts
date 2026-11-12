/**
 * errorMessage 单测
 *
 * 覆盖三种宿主错误形态：字符串、移动端包装对象（`{ code, request_id }` 与
 * 带 `message` 的形态）、以及无法序列化的循环引用。
 */
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../errorMessage'

describe('errorMessage', () => {
  it('字符串原样返回', () => {
    expect(errorMessage('cancelled')).toBe('cancelled')
  })

  it('Error 取 message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('包装对象取 message（cancelled 分流依赖它）', () => {
    expect(errorMessage({ code: 'host.internal', message: 'cancelled' })).toBe('cancelled')
  })

  it('嵌套 error 对象取内层 message', () => {
    expect(errorMessage({ error: { code: 'x', message: 'not supported' } })).toBe('not supported')
  })

  it('只有 code 时退化为可读 JSON（不返回 [object Object]）', () => {
    const text = errorMessage({ code: 'host.internal', request_id: 'abc' })
    expect(text).not.toBe('[object Object]')
    expect(text).toContain('host.internal')
    expect(text).toContain('abc')
  })

  it('循环引用不抛异常', () => {
    const cyclic: Record<string, unknown> = { code: 'host.internal' }
    cyclic.self = cyclic
    expect(() => errorMessage(cyclic)).not.toThrow()
    expect(errorMessage(cyclic)).toBe('[object Object]')
  })
})
