import { expect } from '@wdio/globals'

/**
 * 带失败上下文的相等断言
 *
 * jest / expect-webdriverio 的 `expect(actual, message)` **不接受第二个参数**——它会被
 * 当成期望值，于是报 “Expect takes at most one argument”。想带上失败上下文，就把上下文
 * 折进被断言对象的键里：失败信息形如 `{ '分区标签 skills': false }`，一眼看出是哪条
 * 上下文出的问题。
 */
export function expectEqual(actual: unknown, expected: unknown, context: string): void {
  expect({ [context]: actual }).toEqual({ [context]: expected })
}

/** 带失败上下文的「属于集合」断言（同样不接受第二参数） */
export function expectInSet(actual: unknown, allowed: unknown[], context: string): void {
  // 不能把 actual/allowed 同时放进 received 与 expected 的同名键——那样两边恒等，
  // 断言永远通过。用 holds 显式表达「actual 属于 allowed」。
  expect({ [context]: actual, 允许值: allowed, holds: allowed.includes(actual) }).toEqual({
    [context]: actual,
    允许值: allowed,
    holds: true,
  })
}
