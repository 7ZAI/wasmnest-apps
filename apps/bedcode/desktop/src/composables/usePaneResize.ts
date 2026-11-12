/**
 * 分栏拖拽调宽（项目工作台三栏：运行列表 / 对话面 / 检查器）
 *
 * 三栏里中间是弹性列，两侧是固定像素宽——写死宽度在窄窗口下会把中间挤成一条缝，
 * 而不同用户对「运行列表多宽」「终端多宽」的偏好差别很大（终端尤其：宽度直接决定
 * 列数，进而决定换行）。所以两侧都做成可拖拽。
 *
 * 本模块只做「尺寸状态 + 交互 → 数值」的纯逻辑，不碰 DOM 结构：
 * - 拖拽走 **mouse 事件**（宿主 WebKitGTK 上已验证的通路；触屏另补一套 touch 事件），
 *   拖动期间锁全局光标与文本选择（否则拖动会选中一片文字）；
 * - 上限是**动态**的（由容器宽度算出——给中间列留最小宽度），所以 `max` 支持函数；
 * - 键盘可达：手柄聚焦后 ← / → 调 16px（Shift 加速 4 倍），双击复位默认宽度；
 * - 宽度按 key 记进 app KV，重进工作台沿用上次布局（写失败不影响交互）。
 *
 * 上下限的合并规则：`max < min`（容器已经窄到极限）时以 `min` 为准，宁可中间列被
 * 压缩也不让手柄失去可拖区间——否则用户会看到「拖不动」。
 */

import { computed, ref, type Ref } from 'vue'

/** 拖拽方向：`ltr` = 手柄在面板右侧（向右拖变宽）；`rtl` = 手柄在面板左侧（向左拖变宽） */
export type PaneDirection = 'ltr' | 'rtl'

/** 持久化端口（与 `context.storage` 同形的窄接口，测试可注入内存实现） */
export interface PaneSizeSource {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export interface PaneResizeOptions {
  /** 默认宽度（双击复位 / 首次进入） */
  initial: number
  /** 下限（px） */
  min: number
  /** 上限（px）；函数形态用于「随容器宽度变化」的动态上限 */
  max: number | (() => number)
  /** 手柄所在边；默认 `ltr` */
  direction?: PaneDirection
  /** 持久化 key；缺省 = 不持久化 */
  storageKey?: string
  storage?: PaneSizeSource
  /** 键盘步长（px），默认 16 */
  step?: number
}

/**
 * 把宽度夹进 [min, max]（max < min 时取 min）
 *
 * `max` 允许是 `Infinity`：容器还没量到宽度时上限未知，此时**不能夹**——早期版本
 * 把非有限值一律当 min 处理，结果初始宽度在首帧就被压到下限（实测三栏一进页面
 * 就是最窄）。只有 `NaN` 才是「没有上限信息」，退回 min。
 */
export function clampPaneWidth(value: number, min: number, max: number): number {
  const upper = Number.isNaN(max) ? min : Math.max(min, max)
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), upper)
}

/**
 * 拖拽位移 → 面板宽度
 *
 * `delta` 是手柄的横向位移（右为正）。手柄在面板右侧时宽度随位移增大，在左侧时相反。
 */
export function paneWidthFromDrag(
  startWidth: number,
  delta: number,
  direction: PaneDirection,
  min: number,
  max: number,
): number {
  const raw = direction === 'rtl' ? startWidth - delta : startWidth + delta
  return clampPaneWidth(raw, min, max)
}

/**
 * 键盘方向键 → 手柄位移
 *
 * 语义是「手柄跟着方向键走」：→ 让手柄右移。左侧面板随之变宽，右侧面板随之变窄。
 */
export function paneDeltaFromKey(key: string, direction: PaneDirection, step: number): number {
  if (key === 'ArrowLeft') return direction === 'rtl' ? step : -step
  if (key === 'ArrowRight') return direction === 'rtl' ? -step : step
  return 0
}

const PERSIST_DEBOUNCE_MS = 250

export function usePaneResize(options: PaneResizeOptions) {
  const { initial, min, direction = 'ltr', storageKey, storage, step = 16 } = options
  const maxOf = (): number => (typeof options.max === 'function' ? options.max() : options.max)

  const width = ref(clampPaneWidth(initial, min, maxOf()))
  const isResizing = ref(false)
  const maxWidth = computed(() => Math.max(min, maxOf()))

  /** 拖动期间要还原的 body 样式（同时只允许一个手柄在拖） */
  let restoreBody: (() => void) | null = null
  /** 当前拖动的解绑函数（组件在拖动中被卸载时由 dispose 调用，避免监听器悬空） */
  let detachDrag: (() => void) | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function schedulePersist(): void {
    if (!storageKey || !storage) return
    if (persistTimer !== null) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void storage.set(storageKey, Math.round(width.value)).catch(() => undefined)
    }, PERSIST_DEBOUNCE_MS)
  }

  function setWidth(next: number, persist = true): void {
    width.value = clampPaneWidth(next, min, maxOf())
    if (persist) schedulePersist()
  }

  /** 复位到默认宽度（双击手柄 / 布局被改乱后的逃生阀） */
  function reset(): void {
    setWidth(initial)
  }

  /** 首次进入时读回上次布局（缺省 / 脏数据 / 读失败一律落回默认宽度） */
  async function load(): Promise<void> {
    if (!storageKey || !storage) return
    try {
      const saved = await storage.get(storageKey)
      if (typeof saved === 'number' && Number.isFinite(saved)) {
        width.value = clampPaneWidth(saved, min, maxOf())
      }
    } catch {
      // 读不到不是错误：默认宽度可用
    }
  }

  function lockPointerChrome(): void {
    const body = document.body
    const previous = {
      cursor: body.style.cursor,
      userSelect: body.style.userSelect,
      overflow: body.style.overflow,
    }
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'
    restoreBody = () => {
      body.style.cursor = previous.cursor
      body.style.userSelect = previous.userSelect
      body.style.overflow = previous.overflow
      restoreBody = null
    }
  }

  /**
   * 开始拖动（鼠标 / 触屏共用同一套位移计算）
   *
   * **为什么不用 Pointer Events**：宿主是 WebKitGTK，PointerEvent 的 move 投递在
   * 部分版本上不可靠（拖动手柄后收到 pointerdown 却收不到 pointermove，表现为
   * 「手柄在、拖不动」）。本仓侧边栏的拖拽用的是 `mousedown` + `document` 上的
   * `mousemove/mouseup`，在真机长期可用——分栏沿用同一条已验证的通路，触屏再补
   * 一套 `touchstart/touchmove`（`preventDefault` 会抑制合成的 mousedown，不会双起）。
   */
  function startDrag(startX: number): void {
    isResizing.value = true
    lockPointerChrome()

    const startWidth = width.value
    const apply = (clientX: number): void => {
      width.value = paneWidthFromDrag(startWidth, clientX - startX, direction, min, maxOf())
    }
    const onMouseMove = (event: MouseEvent): void => apply(event.clientX)
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (touch) apply(touch.clientX)
    }
    const finish = (): void => {
      if (!isResizing.value) return
      isResizing.value = false
      restoreBody?.()
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', finish)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', finish)
      document.removeEventListener('touchcancel', finish)
      detachDrag = null
      schedulePersist()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', finish)
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', finish)
    document.addEventListener('touchcancel', finish)
    detachDrag = finish
  }

  /** 手柄 mousedown（左键） */
  function onResizeStart(event: MouseEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    startDrag(event.clientX)
  }

  /** 手柄 touchstart（平板 / 触屏笔记本） */
  function onResizeTouchStart(event: TouchEvent): void {
    const touch = event.touches[0]
    if (!touch) return
    event.preventDefault()
    startDrag(touch.clientX)
  }

  function onKeydown(event: KeyboardEvent): void {
    const stepPx = event.shiftKey ? step * 4 : step
    const delta = paneDeltaFromKey(event.key, direction, stepPx)
    if (delta !== 0) {
      event.preventDefault()
      setWidth(width.value + delta)
      return
    }
    // Home / End：一步到边界，省得连按四十下
    if (event.key === 'Home') {
      event.preventDefault()
      setWidth(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(maxOf())
    }
  }

  /** 容器尺寸变化后重新夹一次（窗口变窄时不能让固定列吃掉中间列） */
  function reconcile(): void {
    width.value = clampPaneWidth(width.value, min, maxOf())
  }

  function dispose(): void {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    detachDrag?.()
    restoreBody?.()
  }

  return {
    width,
    isResizing,
    minWidth: min,
    maxWidth,
    load,
    reset,
    reconcile,
    onResizeStart,
    onResizeTouchStart,
    onKeydown,
    dispose,
    /** 供 aria-valuenow 用（整数像素） */
    valueNow: computed(() => Math.round(width.value)),
  }
}

export type PaneResize = ReturnType<typeof usePaneResize>

export type PaneWidthRef = Ref<number>
