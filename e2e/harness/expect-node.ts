/**
 * 无浏览器断言 —— 真机单端（移动宿主）用例用
 *
 * ## 为什么不能直接用 `expect.ts`
 *
 * `expect.ts` 走 `expect-webdriverio`，它在断言时需要一个**活的 WebDriver 会话**
 * （`@wdio/globals` 的 `expect` 绑定浏览器实例）。真机单端用例没有 WebDriver 会话——
 * 手机侧由 `harness/mobile.ts` 经 CDP 直接驱动 WebView——直接 import 会在断言处抛
 * 「No browser instance registered」，把「断言失败」伪装成「用例环境坏了」。
 *
 * 故这里用 Node 内置 `assert` 实现同名同签名的两个原语：
 * - 失败信息带上下文（与 `expect.ts` 的 `{ [context]: actual }` 同构，一眼看出哪条出的问题）；
 * - 失败即抛错，mocha 判红（不吞异常、不静默通过）。
 */

import assert from 'node:assert/strict'

/** 带失败上下文的相等断言 */
export function expectEqual(actual: unknown, expected: unknown, context: string): void {
  assert.deepStrictEqual(
    actual,
    expected,
    `${context}\n  实际=${JSON.stringify(actual)}\n  期望=${JSON.stringify(expected)}`,
  )
}

/** 带失败上下文的「属于集合」断言 */
export function expectInSet(actual: unknown, allowed: unknown[], context: string): void {
  assert.ok(
    allowed.includes(actual),
    `${context}\n  实际=${JSON.stringify(actual)}\n  允许值=${JSON.stringify(allowed)}`,
  )
}
