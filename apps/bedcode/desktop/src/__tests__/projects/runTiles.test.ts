/**
 * 拼屏纯逻辑（utils/runTiles）行为契约
 *
 * 覆盖真实会发生的组合：终态运行不铺、优先序换入、已删除 id 不占位、
 * 重复 id 去重、上限截断、剩余存活数提示、网格形状。
 */
import { describe, it, expect } from 'vitest'
import { MAX_RUN_TILES, hiddenLiveRunCount, pickTiledRuns, tileGridLayout } from '@/utils/runTiles'
import type { RunView } from '@/composables/useProjects'

function run(id: string, status = 'running'): RunView {
  return {
    id,
    projectId: 'p-1',
    configId: 'cfg-1',
    agentId: 'opencode',
    agentSessionId: null,
    title: null,
    name: id,
    status,
    model: null,
    createdAt: '2026-11-05T00:00:00Z',
    startedAt: '2026-11-05T00:00:01Z',
    stoppedAt: null,
    updatedAt: '2026-11-05T00:00:02Z',
    active: status !== 'stopped' && status !== 'error',
    truncated: false,
    bridgeSeenAt: null,
    bridgeConnected: false,
  }
}

describe('pickTiledRuns', () => {
  it('只铺存活运行：stopped / error 不进网格', () => {
    const runs = [run('a'), run('b', 'stopped'), run('c', 'error'), run('d', 'waitingInput')]
    expect(pickTiledRuns(runs).map((item) => item.id)).toEqual(['a', 'd'])
  })

  it('优先序在前，其余按列表序补齐（左栏点选换入）', () => {
    const runs = [run('a'), run('b'), run('c')]
    expect(pickTiledRuns(runs, ['c']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('优先序里的已删除 / 已结束 id 不占位，也不重复', () => {
    const runs = [run('a'), run('b', 'stopped')]
    expect(pickTiledRuns(runs, ['gone', 'b', 'a', 'a']).map((item) => item.id)).toEqual(['a'])
  })

  it(`最多 ${MAX_RUN_TILES} 格（默认上限）`, () => {
    const runs = ['a', 'b', 'c', 'd', 'e'].map((id) => run(id))
    expect(pickTiledRuns(runs)).toHaveLength(MAX_RUN_TILES)
    expect(pickTiledRuns(runs).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('优先序可以把第 5 条顶进网格（挤掉列表末尾）', () => {
    const runs = ['a', 'b', 'c', 'd', 'e'].map((id) => run(id))
    expect(pickTiledRuns(runs, ['e']).map((item) => item.id)).toEqual(['e', 'a', 'b', 'c'])
  })

  it('上限为 0 时返回空（防调用方传坏值铺出无限格）', () => {
    expect(pickTiledRuns([run('a')], [], 0)).toEqual([])
  })
})

describe('hiddenLiveRunCount', () => {
  it('只数存活运行：终态运行不算「还有 N 条」', () => {
    const runs = [run('a'), run('b'), run('c', 'stopped'), run('d', 'error')]
    expect(hiddenLiveRunCount(runs, pickTiledRuns(runs))).toBe(0)
  })

  it('超过上限时给出剩余数', () => {
    const runs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => run(id))
    expect(hiddenLiveRunCount(runs, pickTiledRuns(runs))).toBe(2)
  })
})

describe('tileGridLayout', () => {
  it('1 格整幅 / 2 格左右 / 4 格 2×2', () => {
    expect(tileGridLayout(1)).toEqual({ columns: 1, rows: 1, firstSpansRows: false })
    expect(tileGridLayout(2)).toEqual({ columns: 2, rows: 1, firstSpansRows: false })
    expect(tileGridLayout(4)).toEqual({ columns: 2, rows: 2, firstSpansRows: false })
  })

  it('3 格：左列整高（首格跨两行），右侧上下两格', () => {
    expect(tileGridLayout(3)).toEqual({ columns: 2, rows: 2, firstSpansRows: true })
  })

  it('0 / 越界格数不产出非法形状', () => {
    expect(tileGridLayout(0)).toEqual({ columns: 1, rows: 1, firstSpansRows: false })
    expect(tileGridLayout(9)).toEqual({ columns: 2, rows: 2, firstSpansRows: false })
  })
})
