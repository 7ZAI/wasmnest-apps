/**
 * 快捷卡片入口意图（bedcode 自持的 key / payload 契约）
 * -----------------------------------------------------------------------------
 * 宿主壳首页的卡片点击是「启动并打开本应用」+ 一个**应用自定义**的入口意图；
 * 宿主不认识 `open-session` 也不读 `sessionId`（意图内容全归应用）。本模块是
 * 这份契约的唯一落点：卡片侧（`./activate`）产出意图，运行面侧（`../app/AppRoot`）
 * 消费意图，两边共用同一组常量与解析函数，避免字符串各写一份漂移。
 *
 * 入口目标 = 会话目录里**最近活跃的存活会话**（`latestLiveSession` 口径）：
 * 卡片是「现在有几个会话在跑」的读数，点进去就落在最近有动静的那个会话里；
 * 没有存活会话时返回 null（卡片本就不会注册，宿主按旧行为只打开应用）。
 */
import type { ShellSurfaceIntent } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { DirectorySession } from './sessionDirectory'
import { latestLiveSession } from './utils'

/** 「打开指定会话」意图键（AppRoot 只认这个键，其它键留给后续入口） */
export const SLOT_INTENT_OPEN_SESSION = 'open-session'

/** 意图载荷：目标会话 id（`sessionId` 即运行 id，同一 id 空间） */
export interface OpenSessionIntentPayload {
  sessionId: string
}

/** 卡片点击目标：最近活跃的存活会话；没有存活会话 → null（只打开应用） */
export function sessionSlotIntent(
  sessions: readonly DirectorySession[],
): ShellSurfaceIntent | null {
  const target = latestLiveSession(sessions)
  return target ? { key: SLOT_INTENT_OPEN_SESSION, payload: { sessionId: target.id } } : null
}

/**
 * 解析意图载荷里的会话 id
 *
 * 形状不对（非对象 / 缺字段 / 非字符串）返回空串，由调用方显性留痕后放弃——
 * 不猜 id、不拿第一个会话顶替。
 */
export function intentSessionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const value = (payload as Record<string, unknown>).sessionId
  return typeof value === 'string' ? value : ''
}
