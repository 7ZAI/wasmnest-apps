import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useExecuteButton } from '../composables/useExecuteButton'

function pointer(clientX = 0, clientY = 0): PointerEvent {
  return {
    pointerId: 1,
    clientX,
    clientY,
    currentTarget: { setPointerCapture: vi.fn() },
  } as unknown as PointerEvent
}

function setup(overrides: Partial<Parameters<typeof useExecuteButton>[0]> = {}) {
  const onShortPress = vi.fn()
  const onModeChange = vi.fn()
  const api = useExecuteButton({
    canSubmit: () => true,
    vibrate: () => true,
    onShortPress,
    onModeChange,
    ...overrides,
  })
  return { ...api, onShortPress, onModeChange }
}

describe('useExecuteButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('长按切换常驻模式并振动，松手不触发短按动作', () => {
    const b = setup()
    b.onPointerDown(pointer(10, 10))
    vi.advanceTimersByTime(400)
    expect(b.sendMode.value).toBe(true)
    expect(navigator.vibrate).toHaveBeenCalledWith(30)
    expect(b.onModeChange).toHaveBeenCalledWith(true)

    b.onPointerUp()
    expect(b.onShortPress).not.toHaveBeenCalled()
  })

  it('短按按当前模式触发一次动作', () => {
    const b = setup()
    b.onPointerDown(pointer())
    vi.advanceTimersByTime(100)
    b.onPointerUp()
    expect(b.onShortPress).toHaveBeenCalledWith(false)

    // 长按切到发送模式后再短按：动作模式随之变化
    b.onPointerDown(pointer())
    vi.advanceTimersByTime(400)
    b.onPointerUp()
    b.onPointerDown(pointer())
    vi.advanceTimersByTime(50)
    b.onPointerUp()
    expect(b.onShortPress).toHaveBeenLastCalledWith(true)
  })

  it('置灰（canSubmit=false）时短按被门控，长按仍可切模式', () => {
    const b = setup({ canSubmit: () => false })
    b.onPointerDown(pointer())
    vi.advanceTimersByTime(50)
    b.onPointerUp()
    expect(b.onShortPress).not.toHaveBeenCalled()

    b.onPointerDown(pointer())
    vi.advanceTimersByTime(400)
    expect(b.sendMode.value).toBe(true)
  })

  it('滑动超出阈值取消长按（不切模式、不触发动作）', () => {
    const b = setup()
    b.onPointerDown(pointer(0, 0))
    b.onPointerMove(pointer(40, 40))
    vi.advanceTimersByTime(400)
    expect(b.sendMode.value).toBe(false)
    b.onPointerUp()
    expect(b.onShortPress).not.toHaveBeenCalled()
  })

  it('pointercancel 清掉定时器，后续计时不再触发', () => {
    const b = setup()
    b.onPointerDown(pointer())
    b.onPointerCancel()
    vi.advanceTimersByTime(400)
    expect(b.sendMode.value).toBe(false)
  })

  it('振动开关关闭时不调用 navigator.vibrate', () => {
    const b = setup({ vibrate: () => false })
    b.onPointerDown(pointer())
    vi.advanceTimersByTime(400)
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })
})
