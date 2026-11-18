/**
 * 宿主命令错误 → 可判定 / 可展示的文案 (Mobile)
 *
 * `commands.execute` 抛出的错误在两端宿主都常被包装成对象（移动端是
 * `{ code, request_id }`，真实原因只留在服务端登录的文案里）。直接
 * `String(e)` 会得到 `[object Object]`，于是：
 * - 按文案分流失效（`cancelled` 被当成 `failed` 弹错误提示）；
 * - 排障时日志里只剩一个没有原因的失败。
 *
 * 取值顺序：`message` → `error` → `toJSON` → `String(e)`。纯函数，无依赖。
 */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const rec = e as Record<string, unknown>
    for (const key of ['message', 'error', 'detail'] as const) {
      const value = rec[key]
      if (typeof value === 'string' && value.length > 0) return value
      // 宿主包装里 `error` 可能是嵌套对象（{ code, message }）
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>).message
        if (typeof nested === 'string' && nested.length > 0) return nested
      }
    }
    try {
      return JSON.stringify(e)
    } catch {
      // 循环引用等无法序列化的情形：落到下面的 String 分支
    }
  }
  return String(e)
}
