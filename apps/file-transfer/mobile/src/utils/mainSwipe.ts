/**
 * 一级页面（底栏）横滑的落点判定（Mobile）
 *
 * 手势本身由 FileTransferView 持有（触摸与 dev-shell 鼠标拖动共用一条路径），
 * 这里只回答「这次滑动落到哪」——把分支从组件里抽出来，边界行为可单测：
 *
 *   - 页内还有相邻页：切到相邻页（devices ⇄ browse ⇄ transfers）；
 *   - 最右端（transfers）再向左滑：前进到「设置」——设置是宿主二级页、
 *     不是第四张可滑页，因此不是 tab 而是 openPage，与点击底栏第四项同义；
 *   - 最左端（devices）再向右滑：没有上一页，什么都不做（返回 false 由调用方忽略）。
 *
 * 传输页内部的四段筛选（全部/发送/接收/历史）不在这里判定：它先由 TransfersTab
 * 自持的 stepFilter 消费，只有消费不掉（已到首/尾段）才会走到本函数。
 */
import type { MainTab } from '../types'

export type MainSwipeAction =
  /** 切到相邻一级页面 */
  | { type: 'tab'; tab: MainTab }
  /** 右端再向左滑：打开宿主设置二级页 */
  | { type: 'settings' }
  /** 已到最左端（或无相邻页）：本次滑动不产生任何导航 */
  | { type: 'none' }

export function resolveMainSwipe(
  order: readonly MainTab[],
  current: MainTab,
  dir: 'left' | 'right',
): MainSwipeAction {
  const index = order.indexOf(current)
  if (index < 0) return { type: 'none' }
  const next = index + (dir === 'left' ? 1 : -1)
  if (next >= 0 && next < order.length) return { type: 'tab', tab: order[next]! }
  // 越过右端 = 底栏第四项「设置」；以顺序表末位为准，不写死 'transfers'
  if (next >= order.length) return { type: 'settings' }
  return { type: 'none' }
}
