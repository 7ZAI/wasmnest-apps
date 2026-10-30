/**
 * 分栏拖拽调宽（usePaneResize）行为契约
 *
 * 只测外部行为：给定拖拽位移 / 按键 / 存量宽度，得到什么宽度；持久化与复位是否发生。
 * 纯函数部分单独覆盖边界（尤其是「上限未知时不能把宽度压到下限」这条回归）。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  clampPaneWidth,
  paneDeltaFromKey,
  paneWidthFromDrag,
  usePaneResize,
} from '@/composables/usePaneResize'

describe('clampPaneWidth（宽度夹取）', () => {
  it('区间内原样返回', () => {
    expect(clampPaneWidth(256, 200, 500)).toBe(256)
  })

  it('低于下限取下限、高于上限取上限', () => {
    expect(clampPaneWidth(120, 200, 500)).toBe(200)
    expect(clampPaneWidth(900, 200, 500)).toBe(500)
  })

  it('上限未知（Infinity）时不夹——否则首帧就把宽度压到下限', () => {
    expect(clampPaneWidth(256, 200, Number.POSITIVE_INFINITY)).toBe(256)
  })

  it('上限是 NaN（无有效信息）时退回下限', () => {
    expect(clampPaneWidth(256, 200, Number.NaN)).toBe(200)
  })

  it('max < min（容器窄到极限）以 min 为准，保证手柄仍有可拖区间', () => {
    expect(clampPaneWidth(300, 320, 200)).toBe(320)
  })

  it('非有限宽度退回下限', () => {
    expect(clampPaneWidth(Number.NaN, 200, 500)).toBe(200)
  })
})

describe('paneWidthFromDrag（拖拽位移 → 宽度）', () => {
  it('面板在左（手柄在右）：向右拖变宽', () => {
    expect(paneWidthFromDrag(256, 40, 'ltr', 200, 500)).toBe(296)
    expect(paneWidthFromDrag(256, -40, 'ltr', 200, 500)).toBe(216)
  })

  it('面板在右（手柄在左）：向左拖变宽', () => {
    expect(paneWidthFromDrag(420, -40, 'rtl', 320, 760)).toBe(460)
    expect(paneWidthFromDrag(420, 40, 'rtl', 320, 760)).toBe(380)
  })

  it('拖过头夹在边界内', () => {
    expect(paneWidthFromDrag(256, -999, 'ltr', 200, 500)).toBe(200)
    expect(paneWidthFromDrag(420, -999, 'rtl', 320, 760)).toBe(760)
  })
})

describe('paneDeltaFromKey（方向键 → 手柄位移）', () => {
  it('左侧面板：→ 变宽、← 变窄', () => {
    expect(paneDeltaFromKey('ArrowRight', 'ltr', 16)).toBe(16)
    expect(paneDeltaFromKey('ArrowLeft', 'ltr', 16)).toBe(-16)
  })

  it('右侧面板：← 变宽、→ 变窄（手柄跟着方向键走）', () => {
    expect(paneDeltaFromKey('ArrowLeft', 'rtl', 16)).toBe(16)
    expect(paneDeltaFromKey('ArrowRight', 'rtl', 16)).toBe(-16)
  })

  it('其它键不产生位移', () => {
    expect(paneDeltaFromKey('Enter', 'ltr', 16)).toBe(0)
  })
})

// ==================== composable ====================

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    data,
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      data[key] = value
    }),
  }
}

function mouseDown(clientX: number) {
  return new MouseEvent('mousedown', { clientX, button: 0 })
}

describe('usePaneResize（拖拽 / 键盘 / 复位 / 持久化）', () => {
  it('默认宽度取 initial，并按 min/max 夹取', () => {
    const pane = usePaneResize({ initial: 256, min: 200, max: 500 })
    expect(pane.width.value).toBe(256)

    const clamped = usePaneResize({ initial: 100, min: 200, max: 500 })
    expect(clamped.width.value).toBe(200)
  })

  it('拖拽过程中宽度跟随位移，松手后锁光标还原并持久化', async () => {
    const storage = memoryStorage()
    const pane = usePaneResize({
      initial: 420,
      min: 320,
      max: 760,
      direction: 'rtl',
      storageKey: 'w',
      storage,
    })

    pane.onResizeStart(mouseDown(800))
    expect(pane.isResizing.value).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }))
    expect(pane.width.value).toBe(520)

    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(pane.isResizing.value).toBe(false)
    expect(document.body.style.cursor).toBe('')

    // 持久化是防抖的：等一拍
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(storage.set).toHaveBeenCalledWith('w', 520)
  })

  it('双击复位：回到 initial（且不越过上下限）', () => {
    const pane = usePaneResize({ initial: 420, min: 320, max: 760, direction: 'rtl' })
    pane.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    expect(pane.width.value).toBe(484)

    pane.reset()
    expect(pane.width.value).toBe(420)
  })

  it('键盘：←/→ 步进、Shift 加速、Home/End 到边界', () => {
    const pane = usePaneResize({ initial: 256, min: 200, max: 500 })

    pane.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(pane.width.value).toBe(272)

    pane.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }))
    expect(pane.width.value).toBe(208)

    pane.onKeydown(new KeyboardEvent('keydown', { key: 'End' }))
    expect(pane.width.value).toBe(500)

    pane.onKeydown(new KeyboardEvent('keydown', { key: 'Home' }))
    expect(pane.width.value).toBe(200)
  })

  it('读回上次宽度；脏数据 / 读失败落回默认值', async () => {
    const storage = memoryStorage({ w: 512 })
    const pane = usePaneResize({
      initial: 256,
      min: 200,
      max: 640,
      storageKey: 'w',
      storage,
    })
    await pane.load()
    expect(pane.width.value).toBe(512)

    const broken = {
      get: vi.fn(async () => {
        throw new Error('boom')
      }),
      set: vi.fn(async () => {}),
    }
    const fallback = usePaneResize({
      initial: 256,
      min: 200,
      max: 640,
      storageKey: 'w',
      storage: broken,
    })
    await fallback.load()
    expect(fallback.width.value).toBe(256)

    const dirty = memoryStorage({ w: 'wide' })
    const dirtyPane = usePaneResize({
      initial: 256,
      min: 200,
      max: 640,
      storageKey: 'w',
      storage: dirty,
    })
    await dirtyPane.load()
    expect(dirtyPane.width.value).toBe(256)
  })

  it('容器变窄后 reconcile 把宽度收回上限内', () => {
    let max = Number.POSITIVE_INFINITY
    const pane = usePaneResize({ initial: 420, min: 320, max: () => max })
    expect(pane.width.value).toBe(420)

    max = 352
    pane.reconcile()
    expect(pane.width.value).toBe(352)
  })
})
