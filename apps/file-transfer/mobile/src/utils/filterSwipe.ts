/**
 * 筛选段手势步进（Mobile 传输页）
 *
 * 传输页四段筛选（全部 / 发送 / 接收 / 历史）支持左右滑切换：手指左滑 = 下一段、
 * 右滑 = 上一段（与页签方向语义一致）。已在首段再右滑、或在尾段再左滑时返回 null，
 * 调用方据此把这次滑动交回一级页面翻页——「页内先切段，到边才翻页」。
 *
 * 纯函数、无 Vue 依赖：边界判定是本行为唯一真源，单测直接覆盖四种越界；
 * 顺序表由调用方传入（与分段控件渲染共用同一份 FILTERS，不另抄一份顺序）。
 */
export function nextFilterKey<T extends string>(
  order: readonly T[],
  current: T,
  dir: 'left' | 'right',
): T | null {
  const index = order.indexOf(current)
  if (index < 0) return null
  const nextIndex = index + (dir === 'left' ? 1 : -1)
  if (nextIndex < 0 || nextIndex >= order.length) return null
  return order[nextIndex] ?? null
}
