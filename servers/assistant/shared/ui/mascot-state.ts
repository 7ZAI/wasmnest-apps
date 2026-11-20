/**
 * 形象状态派生
 *
 * 只从界面已有的可观察状态推导，不引入新的后端状态。多个条件同时成立时按
 * 「锁定 → 错误 → 工具执行 → 流式 → 思考 → 空闲」取最需要被看见的一个。
 */

export type MascotState = 'idle' | 'thinking' | 'streaming' | 'tooling' | 'error' | 'locked'

export interface MascotInput {
  /** 保险库未解锁 / 应用未就绪 */
  locked?: boolean
  /** 用户可见错误文案 */
  error?: string | null
  /** 工具卡片状态集合 */
  toolStates?: ReadonlyArray<'running' | 'awaiting' | 'done' | 'error' | 'rejected' | 'stopped'>
  /** 正在接收模型增量 */
  streaming?: boolean
  /** 已发起请求、尚未收到第一个增量 */
  awaitingFirstToken?: boolean
}

export function deriveMascotState(input: MascotInput): MascotState {
  if (input.locked) return 'locked'
  if (input.error) return 'error'
  if (input.toolStates?.some((state) => state === 'running' || state === 'awaiting')) {
    return 'tooling'
  }
  if (input.streaming) return 'streaming'
  if (input.awaitingFirstToken) return 'thinking'
  return 'idle'
}