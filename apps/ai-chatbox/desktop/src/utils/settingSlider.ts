/**
 * 设置页滑块的几何换算（纯函数，供设置页组件与单测共用）
 *
 * 自绘滑块 = 轨道元素 + pointer/keyboard 事件。本模块只做「clientX → 值」与
 * 「值 → 填充比例」两步无副作用换算，组件只负责事件绑定与拖动状态。
 */

/** 按步进取整（消除 0.1 步进的浮点尾巴：1.6 仍是 1.6，不是 1.6000000000000001） */
export function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number((Math.round(value / step) * step).toFixed(decimals))
}

/**
 * pointer clientX → 轨道对应的值
 *
 * - 轨道宽度为 0（未布局 / 隐藏）时返回 fallback（当前值），不产生跳变；
 * - 比例夹取到 [0, 1]，再映射到 [min, max] 并按 step 取整。
 */
export function sliderValueFromClientX(
  clientX: number,
  rect: { left: number; width: number },
  min: number,
  max: number,
  step: number,
  fallback: number,
): number {
  if (rect.width <= 0) return fallback
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  return roundToStep(min + ratio * (max - min), step)
}

/** 值 → 轨道填充比例（CSS 百分比字符串，夹取到 [0%, 100%]） */
export function sliderFillPercent(value: number, min: number, max: number): string {
  const ratio = max === min ? 0 : (value - min) / (max - min)
  return `${Math.min(Math.max(ratio, 0), 1) * 100}%`
}
