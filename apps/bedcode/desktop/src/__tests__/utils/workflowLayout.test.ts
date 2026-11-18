import { describe, it, expect } from 'vitest'
import { layoutWorkflow, GAP_X, NODE_HEIGHT, NODE_WIDTH, PADDING } from '@/utils/workflowLayout'

describe('layoutWorkflow（只读 DAG 布局）', () => {
  it('按最长依赖路径分层，同层按声明顺序', () => {
    const layout = layoutWorkflow({
      nodes: [
        { key: 'a', dependsOn: [] },
        { key: 'b', dependsOn: ['a'] },
        { key: 'c', dependsOn: ['a'] },
        { key: 'd', dependsOn: ['b', 'c'] },
      ],
    })
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]))
    expect(byKey.get('a')?.layer).toBe(0)
    expect(byKey.get('b')?.layer).toBe(1)
    expect(byKey.get('c')?.layer).toBe(1)
    expect(byKey.get('d')?.layer).toBe(2)
    expect(byKey.get('b')?.row).toBe(0)
    expect(byKey.get('c')?.row).toBe(1)
    expect(byKey.get('a')?.x).toBe(PADDING)
    expect(byKey.get('b')?.x).toBe(PADDING + NODE_WIDTH + GAP_X)
  })

  it('边集合与依赖一一对应，未知依赖不画边', () => {
    const layout = layoutWorkflow({
      nodes: [{ key: 'a' }, { key: 'b', dependsOn: ['a', 'ghost'] }],
    })
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]).toMatchObject({ from: 'a', to: 'b' })
    expect(layout.edges[0].path.startsWith('M ')).toBe(true)
  })

  it('画布尺寸按最大层数与同层最大行数计算', () => {
    const layout = layoutWorkflow({
      nodes: [{ key: 'a' }, { key: 'b', dependsOn: ['a'] }, { key: 'c', dependsOn: ['a'] }],
    })
    expect(layout.width).toBe(PADDING * 2 + 2 * NODE_WIDTH + GAP_X)
    expect(layout.height).toBe(PADDING * 2 + 2 * NODE_HEIGHT + 24)
  })

  it('空计划返回空布局；环不会死循环', () => {
    expect(layoutWorkflow(null)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
    const cyclic = layoutWorkflow({
      nodes: [
        { key: 'a', dependsOn: ['b'] },
        { key: 'b', dependsOn: ['a'] },
      ],
    })
    expect(cyclic.nodes).toHaveLength(2)
  })
})
