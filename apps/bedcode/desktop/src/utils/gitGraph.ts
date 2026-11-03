/**
 * Git 提交图布局（纯函数，无 DOM / 无 Vue）
 *
 * 输入是 `project.git-log` 返回的提交列表——**必须按拓扑序**（子提交先于父提交，
 * 后端用 `git log --topo-order` 保证）。输出逐行的车道号与三类连线：
 *
 * - `incoming`：从上方汇入本行提交的边（含主车道，以及分支合并时的其它车道）；
 * - `outgoing`：从本行提交向下离开的边（第一父提交留在原车道，其余父提交分叉）；
 * - `through`：既不以本行为起点也不以本行为终点、只是穿过的边。
 *
 * 车道分配规则（与常见 git 图形同构）：
 * 1. 每条边占用一个车道直到它的目标提交（父提交）出现；
 * 2. 车道等待的提交出现时，所有等待它的车道在该行收拢，最低车道作为提交所在车道；
 * 3. 第一父提交继承本车道；额外父提交优先复用已在等待它的车道（避免同一父提交
 *    画成两条线），否则取最小空闲车道；
 * 4. 父提交不在当前窗口（`--max-count` 截断）时，边没有终点，线画到列表底部为止
 *    ——这是「历史还没完」的显式提示，不伪造一个不存在的提交。
 *
 * 颜色按边在创建时分配（循环使用有限色板）；合并进来的边保留自己的颜色，
 * 于是同一条分支线在滚动时颜色稳定，而不是随车道号跳变。
 */
import type { GitCommit } from '@/composables/useProjectGit'

/** 色板槽位数（与 ProjectGitGraph 的 --git-graph-c* 变量数量一致） */
export const GIT_GRAPH_PALETTE_SIZE = 8

/** 一条图边：从 `from` 行出发，落到 `to` 行（-1 = 父提交在窗口外） */
export interface GitGraphEdge {
  /** 稳定 id（SVG key） */
  id: number
  /** 边占用的车道（整条边恒定） */
  lane: number
  /** 子提交所在行（边起点） */
  from: number
  /** 父提交所在行（边终点；-1 = 不在当前窗口） */
  to: number
  /** 色板槽位 */
  color: number
}

export interface GitGraphRow {
  commit: GitCommit
  /** 提交圆点所在车道 */
  lane: number
  /** 提交圆点颜色（= 主线边的颜色） */
  color: number
  incoming: GitGraphEdge[]
  outgoing: GitGraphEdge[]
  through: GitGraphEdge[]
}

export interface GitGraphLayout {
  rows: GitGraphRow[]
  /** 用到的车道总数（每行图列宽按它算，保证滚动时对齐） */
  laneCount: number
}

interface LaneState {
  /** 该车道正在等待的父提交 hash */
  target: string
  color: number
}

/** 同车道同色的重复边只画一次（复用车道 / 合并收拢时会产生同形边） */
function dedupeEdges(edges: GitGraphEdge[]): GitGraphEdge[] {
  const seen = new Set<string>()
  return edges.filter((edge) => {
    const key = `${edge.lane}:${edge.color}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function layoutGitGraph(commits: GitCommit[]): GitGraphLayout {
  const rowOfHash = new Map<string, number>()
  commits.forEach((commit, row) => rowOfHash.set(commit.hash, row))

  /** 车道表：null = 空闲；等待中的车道保存目标父提交 */
  const active: (LaneState | null)[] = []
  const edges: GitGraphEdge[] = []
  const laneOfRow: number[] = []
  const colorOfRow: number[] = []
  let nextColor = 0
  let nextEdgeId = 0

  const takeColor = (): number => nextColor++ % GIT_GRAPH_PALETTE_SIZE
  /** 最小空闲车道；都在用时向右扩展 */
  const firstFreeLane = (): number => {
    const index = active.indexOf(null)
    if (index >= 0) return index
    active.push(null)
    return active.length - 1
  }

  commits.forEach((commit, row) => {
    // 1) 收拢所有等待本提交的车道：最低者为提交所在车道，其余边在本行汇入
    const matches: number[] = []
    for (let lane = 0; lane < active.length; lane += 1) {
      if (active[lane]?.target === commit.hash) matches.push(lane)
    }

    let lane: number
    let color: number
    if (matches.length > 0) {
      lane = matches[0]
      color = active[lane]?.color ?? takeColor()
      for (const matched of matches) active[matched] = null
    } else {
      // 分支顶端（没有子提交指过来）：占用一条空闲车道，分配新颜色
      lane = firstFreeLane()
      color = takeColor()
    }
    laneOfRow[row] = lane
    colorOfRow[row] = color

    // 2) 为每个父提交铺边：第一父继承本车道，其余父分叉 / 复用等待车道
    commit.parents.forEach((parent, parentIndex) => {
      let targetLane: number
      if (parentIndex === 0) {
        targetLane = lane
        active[targetLane] = { target: parent, color }
      } else {
        const existing = active.findIndex((state) => state?.target === parent)
        if (existing >= 0) {
          targetLane = existing
        } else {
          targetLane = firstFreeLane()
          active[targetLane] = { target: parent, color: takeColor() }
        }
      }
      const target = active[targetLane]
      edges.push({
        id: nextEdgeId++,
        lane: targetLane,
        from: row,
        to: rowOfHash.get(parent) ?? -1,
        color: target?.color ?? color,
      })
    })

    // 3) 根提交：车道归还
    if (commit.parents.length === 0) active[lane] = null
  })

  const rows: GitGraphRow[] = commits.map((commit, row) => ({
    commit,
    lane: laneOfRow[row],
    color: colorOfRow[row],
    incoming: [],
    outgoing: [],
    through: [],
  }))

  let laneCount = 0
  for (const lane of laneOfRow) laneCount = Math.max(laneCount, lane + 1)

  for (const edge of edges) {
    laneCount = Math.max(laneCount, edge.lane + 1)
    rows[edge.from]?.outgoing.push(edge)
    if (edge.to >= 0 && edge.to < rows.length) {
      rows[edge.to].incoming.push(edge)
    }
    const end = edge.to >= 0 ? edge.to : rows.length
    for (let row = edge.from + 1; row < end; row += 1) {
      rows[row].through.push(edge)
    }
  }

  for (const row of rows) {
    row.incoming = dedupeEdges(row.incoming)
    row.outgoing = dedupeEdges(row.outgoing)
    row.through = dedupeEdges(row.through)
  }

  return { rows, laneCount }
}
