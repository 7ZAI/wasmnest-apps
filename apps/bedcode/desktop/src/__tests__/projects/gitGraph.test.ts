/**
 * Git 提交图布局契约（纯函数）
 *
 * 只断言外部行为：车道号、边的起止行、合并收拢、窗口截断时的悬空边。
 * 图形像素（SVG 路径）归组件，这里锁「拓扑表达是否正确」。
 */
import { describe, it, expect } from 'vitest'
import { layoutGitGraph } from '@/utils/gitGraph'
import type { GitCommit } from '@/composables/useProjectGit'

let seq = 0

function commit(hash: string, parents: string[] = []): GitCommit {
  seq += 1
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    author: 'Alice',
    email: 'alice@example.com',
    date: `2026-10-${String(seq).padStart(2, '0')}T10:00:00+08:00`,
    refs: [],
    subject: `commit ${hash}`,
  }
}

describe('layoutGitGraph', () => {
  it('线性历史：单车道、逐行首尾相接、中间行是 through', () => {
    const layout = layoutGitGraph([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')])

    expect(layout.laneCount).toBe(1)
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(layout.rows[0].outgoing).toHaveLength(1)
    expect(layout.rows[0].outgoing[0]).toMatchObject({ lane: 0, from: 0, to: 1 })
    expect(layout.rows[1].incoming.map((edge) => edge.lane)).toEqual([0])
    // 相邻提交之间的边不产生 through（既非起点也非终点的行才是穿过）
    expect(layout.rows[1].through).toEqual([])
    expect(layout.rows[1].outgoing.map((edge) => edge.lane)).toEqual([0])
    expect(layout.rows[2].incoming.map((edge) => edge.lane)).toEqual([0])
    expect(layout.rows[2].outgoing).toHaveLength(0)
  })

  it('分支合并：第二个父提交开新车道，合并点两条边汇入最低车道', () => {
    const layout = layoutGitGraph([
      commit('m', ['a', 'b']),
      commit('a', ['c']),
      commit('b', ['c']),
      commit('c'),
    ])

    expect(layout.laneCount).toBe(2)
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0])

    // 合并提交两条出边：第一父留本车道、第二父分叉到车道 1
    expect(layout.rows[0].outgoing.map((edge) => edge.lane)).toEqual([0, 1])
    // 合并点 c 从两条车道汇入（0 与 1），圆点取最低车道 0
    expect(layout.rows[3].lane).toBe(0)
    expect(layout.rows[3].incoming.map((edge) => edge.lane).sort()).toEqual([0, 1])
    // 分支行（b）穿过的车道是 0 与 1（a→c 穿过 + 自己→c 出边）
    expect(layout.rows[2].through.map((edge) => edge.lane)).toEqual([0])
  })

  it('复用等待中的车道：同一父提交不画两条重复线（合并点去重）', () => {
    const layout = layoutGitGraph([
      commit('m1', ['x', 'y']),
      commit('m2', ['x', 'y']),
      commit('x'),
      commit('y'),
    ])

    // m2 的 y 边复用 m1 已占用的车道 1，而不是再开一条
    expect(layout.rows[1].outgoing.map((edge) => edge.lane).sort()).toEqual([1, 2])
    // y 是两条边的终点：同车道同色的重复边只保留一条
    expect(layout.rows[3].incoming).toHaveLength(1)
    expect(layout.rows[3].incoming[0].lane).toBe(1)
    expect(layout.laneCount).toBe(3)
  })

  it('窗口截断：父提交不在列表里时边没有终点，线一直画到列表底', () => {
    const layout = layoutGitGraph([commit('tip', ['older']), commit('other')])

    expect(layout.rows[0].outgoing[0].to).toBe(-1)
    // 悬空边在后续行继续占用车道（视觉上提示「历史还有更早的」）
    expect(layout.rows[1].through.map((edge) => edge.lane)).toEqual([0])
    // 另一条独立分支不能再占用 0 车道
    expect(layout.rows[1].lane).toBe(1)
    expect(layout.laneCount).toBe(2)
  })

  it('颜色按边创建时分配：第一父继承提交颜色，第二父用新色', () => {
    const layout = layoutGitGraph([commit('m', ['a', 'b']), commit('a'), commit('b')])

    const [first, second] = layout.rows[0].outgoing
    expect(first.color).toBe(layout.rows[0].color)
    expect(second.color).not.toBe(first.color)
    expect(layout.rows[1].incoming[0].color).toBe(first.color)
    expect(layout.rows[2].incoming[0].color).toBe(second.color)
  })

  it('空列表：零车道、零行', () => {
    expect(layoutGitGraph([])).toEqual({ rows: [], laneCount: 0 })
  })
})
