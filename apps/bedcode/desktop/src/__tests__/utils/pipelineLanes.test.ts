import { describe, it, expect } from 'vitest'
import { pipelineLanes } from '@/utils/pipelineLanes'

const at = (second: number) => `2026-11-05T00:00:${String(second).padStart(2, '0')}Z`

describe('pipelineLanes（执行流水线）', () => {
  it('按状态事件切段，终态事件给结果', () => {
    const layout = pipelineLanes(
      [
        {
          key: 'n1',
          title: '实现',
          status: 'succeeded',
          attempt: 1,
          dispatchedAt: at(1),
          startedAt: at(2),
          endedAt: at(6),
        },
      ],
      [
        { seq: 1, kind: 'node_ready', nodeKey: 'n1', attempt: 1, at: at(1) },
        { seq: 2, kind: 'dispatched', nodeKey: 'n1', attempt: 1, at: at(1) },
        { seq: 3, kind: 'node_running', nodeKey: 'n1', attempt: 1, at: at(2) },
        { seq: 4, kind: 'verifying', nodeKey: 'n1', attempt: 1, at: at(4) },
        { seq: 5, kind: 'node_succeeded', nodeKey: 'n1', attempt: 1, at: at(6) },
      ],
      at(0),
      Date.parse(at(10)),
    )

    const lane = layout.lanes[0]
    expect(lane.result).toBe('succeeded')
    // node_ready 与 dispatched 同一秒：零长度段不绘制，只保留 dispatching 段
    expect(lane.segments.map((segment) => segment.stage)).toEqual([
      'dispatching',
      'running',
      'verifying',
    ])
    expect(lane.segments[0].endMs - lane.segments[0].startMs).toBe(1000)
    expect(layout.durationMs).toBe(10_000)
  })

  it('只取当前 attempt 的事件', () => {
    const layout = pipelineLanes(
      [{ key: 'n1', title: '实现', status: 'running', attempt: 2, dispatchedAt: at(5) }],
      [
        { seq: 1, kind: 'dispatched', nodeKey: 'n1', attempt: 1, at: at(1) },
        { seq: 2, kind: 'node_failed', nodeKey: 'n1', attempt: 1, at: at(3) },
        { seq: 3, kind: 'dispatched', nodeKey: 'n1', attempt: 2, at: at(5) },
        { seq: 4, kind: 'node_running', nodeKey: 'n1', attempt: 2, at: at(6) },
      ],
      at(0),
      Date.parse(at(8)),
    )
    const lane = layout.lanes[0]
    expect(lane.result).toBeNull()
    expect(lane.segments.map((segment) => segment.stage)).toEqual(['dispatching', 'running'])
    expect(lane.segments[1].endMs).toBe(Date.parse(at(8)))
  })

  it('无事件时回退到节点时间戳，零长度不产生段', () => {
    const layout = pipelineLanes(
      [
        {
          key: 'n1',
          title: '实现',
          status: 'dispatching',
          attempt: 1,
          dispatchedAt: at(3),
        },
      ],
      [],
      at(1),
      Date.parse(at(4)),
    )
    expect(layout.lanes[0].segments).toEqual([
      { stage: 'dispatching', startMs: Date.parse(at(3)), endMs: Date.parse(at(4)) },
    ])

    const empty = pipelineLanes([], [], at(1), Date.parse(at(2)))
    expect(empty.lanes).toEqual([])
    expect(empty.startMs).toBe(Date.parse(at(1)))
  })
})
