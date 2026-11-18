/**
 * 执行/发送按钮的长按切模式（issue #19）
 *
 * 语义与旧内联实现逐字一致：长按 400ms 在「执行（文本 + Enter）」与「发送
 * （只写入输入行）」之间切换一个**常驻**模式；本次按压到此结束，不触发动作。
 * 短按才执行当前模式的动作，置灰（无内容 / 会话不可用）时短按被门控，但长按
 * 仍可切模式（模式是偏好，先切好再输入是合理路径）。
 *
 * 从组件里抽出的价值：定时器 / 指针取消 / 滑动取消这套状态机可以独立单测，
 * 不必挂载整个 TerminalInputBar。
 */
import { ref } from 'vue'

/** 长按阈值：足够跟手不拖沓，同时为误触留出余量 */
export const EXECUTE_LONG_PRESS_MS = 400
/** 滑动取消长按（防误触）：位移距离阈值 */
export const EXECUTE_MOVE_CANCEL_SLOP_PX = 10

export interface UseExecuteButtonOptions {
  /** 当前是否允许短按触发（有内容且会话可用） */
  canSubmit: () => boolean
  /** 触觉反馈开关（跟随移动端设置） */
  vibrate: () => boolean
  /** 短按动作：由调用方按当前模式分发到 submit / execute */
  onShortPress: (sendMode: boolean) => void
  /** 模式切换回调（用于 toast 等可见反馈） */
  onModeChange?: (sendMode: boolean) => void
  longPressMs?: number
  moveCancelSlopPx?: number
}

export function useExecuteButton(options: UseExecuteButtonOptions) {
  const longPressMs = options.longPressMs ?? EXECUTE_LONG_PRESS_MS
  const slop = options.moveCancelSlopPx ?? EXECUTE_MOVE_CANCEL_SLOP_PX

  /** 常驻功能模式：false = 执行（默认），true = 发送 */
  const sendMode = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onPointerDown(e: PointerEvent) {
    // 捕获指针：手指滑出按钮仍能收到 pointerup/cancel，保证状态复位
    ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
    startX = e.clientX
    startY = e.clientY
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      sendMode.value = !sendMode.value
      if (options.vibrate() && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(30)
      }
      options.onModeChange?.(sendMode.value)
    }, longPressMs)
  }

  function onPointerMove(e: PointerEvent) {
    // 长按触发前移动超出阈值 → 取消切换（滑动即意图取消）
    if (!timer) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (dx * dx + dy * dy > slop * slop) clearTimer()
  }

  function onPointerUp() {
    if (!timer) return // 长按已切换：本次按压结束，不触发动作
    clearTimer()
    if (!options.canSubmit()) return // 置灰：仅长按可切换
    options.onShortPress(sendMode.value)
  }

  function onPointerCancel() {
    clearTimer()
  }

  return { sendMode, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
