/**
 * 运行拼屏（多终端同屏）的纯逻辑
 *
 * 口径（2026-11-05 用户裁决「按推荐」）：
 * - 只铺**存活运行**（与「在独立窗口打开」同一判据 `isLiveRun`）：终态运行的 PTY
 *   已回收，铺进网格只会得到一个空壳；
 * - 最多 4 格：每格都是一条独立 xterm + 一路输出轮询，4 是 WebGL 上下文与轮询
 *   成本的可控上限；
 * - 顺序 = 最近聚焦优先（`priority`，左栏点选换入）→ 运行列表序（后端已按最新在前）；
 * - 超过 4 条不静默丢弃：调用方用 `hiddenLiveRunCount` 提示「还有 N 条」，点左栏换入。
 */

import { isLiveRun, type RunView } from '@/composables/useProjects'

/** 拼屏格数上限（WebGL 上下文 / 轮询成本的可控上限） */
export const MAX_RUN_TILES = 4

/**
 * 选出要铺开的运行：存活运行按「优先序 → 列表序」排，去重后截断到 `max`
 *
 * 纯函数（不读响应式状态）：排序输入即全部输入，便于覆盖「优先级里有已结束 /
 * 已删除的 id」「同一 id 重复」「超过上限」这些真实会发生的组合。
 */
export function pickTiledRuns(
  runs: RunView[],
  priority: readonly string[] = [],
  max: number = MAX_RUN_TILES,
): RunView[] {
  if (max <= 0) return []
  const live = runs.filter((run) => isLiveRun(run.status))
  const byId = new Map(live.map((run) => [run.id, run]))
  const picked: RunView[] = []
  const seen = new Set<string>()

  for (const id of priority) {
    if (picked.length >= max) break
    const run = byId.get(id)
    if (!run || seen.has(id)) continue
    picked.push(run)
    seen.add(id)
  }
  for (const run of live) {
    if (picked.length >= max) break
    if (seen.has(run.id)) continue
    picked.push(run)
    seen.add(run.id)
  }
  return picked
}

/** 未铺开的存活运行数（左栏提示用；终态运行不计入） */
export function hiddenLiveRunCount(runs: RunView[], tiled: readonly RunView[]): number {
  const liveCount = runs.filter((run) => isLiveRun(run.status)).length
  return Math.max(0, liveCount - tiled.length)
}

/** 网格形状（CSS grid 的列 / 行数，以及 3 格时首格是否跨两行） */
export interface TileGridLayout {
  columns: 1 | 2
  rows: 1 | 2
  /**
   * 3 格时首格跨两行：左列整高、右侧两格上下叠。
   * 2×2 里空一格会让第一格只占半高，焦点格反而更小；跨行让主格保持整列高度。
   */
  firstSpansRows: boolean
}

/**
 * 按格数给出网格形状
 *
 * 1 格 = 整幅；2 格 = 左右；3 格 = 左整列 + 右侧上下；4 格 = 2×2。
 * 0 格（空态）与超过 4 格（调用方已截断）都按 1 / 4 格处理，不产出非法形状。
 */
export function tileGridLayout(count: number): TileGridLayout {
  if (count <= 1) return { columns: 1, rows: 1, firstSpansRows: false }
  if (count === 2) return { columns: 2, rows: 1, firstSpansRows: false }
  if (count === 3) return { columns: 2, rows: 2, firstSpansRows: true }
  return { columns: 2, rows: 2, firstSpansRows: false }
}
