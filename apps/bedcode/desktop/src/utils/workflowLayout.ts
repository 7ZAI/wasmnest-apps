/**
 * 只读工作流图布局（纯函数，DESIGN §9.3）
 *
 * 分层 = 从根节点到该节点的最长依赖路径；同层按计划声明顺序。输出仅为坐标与
 * 边路径，组件不持有业务状态、不引入图形库。
 */

export interface LayoutInputNode {
  key: string
  dependsOn?: string[]
}

export interface WorkflowNodePosition {
  key: string
  layer: number
  row: number
  x: number
  y: number
  width: number
  height: number
}

export interface WorkflowEdge {
  from: string
  to: string
  path: string
}

export interface WorkflowLayout {
  nodes: WorkflowNodePosition[]
  edges: WorkflowEdge[]
  width: number
  height: number
}

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 64
export const GAP_X = 72
export const GAP_Y = 24
export const PADDING = 24

export function layoutWorkflow(plan: { nodes: LayoutInputNode[] } | null): WorkflowLayout {
  if (!plan || plan.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 }
  }

  const known = new Set(plan.nodes.map((node) => node.key))
  const layers = resolveLayers(plan.nodes, known)

  const byLayer = new Map<number, LayoutInputNode[]>()
  for (const node of plan.nodes) {
    const layer = layers.get(node.key) ?? 0
    const bucket = byLayer.get(layer) ?? []
    bucket.push(node)
    byLayer.set(layer, bucket)
  }

  const positions = new Map<string, WorkflowNodePosition>()
  const nodes: WorkflowNodePosition[] = []
  const layerNumbers = [...byLayer.keys()].sort((a, b) => a - b)
  for (const layer of layerNumbers) {
    const bucket = byLayer.get(layer) ?? []
    bucket.forEach((node, row) => {
      const position: WorkflowNodePosition = {
        key: node.key,
        layer,
        row,
        x: PADDING + layer * (NODE_WIDTH + GAP_X),
        y: PADDING + row * (NODE_HEIGHT + GAP_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }
      positions.set(node.key, position)
      nodes.push(position)
    })
  }

  const edges: WorkflowEdge[] = []
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn ?? []) {
      const from = positions.get(dependency)
      const to = positions.get(node.key)
      if (!from || !to) continue
      edges.push({
        from: dependency,
        to: node.key,
        path: edgePath(from, to),
      })
    }
  }

  const maxLayer = layerNumbers[layerNumbers.length - 1] ?? 0
  const maxRows = Math.max(...layerNumbers.map((layer) => (byLayer.get(layer) ?? []).length), 0)
  return {
    nodes,
    edges,
    width: PADDING * 2 + (maxLayer + 1) * NODE_WIDTH + maxLayer * GAP_X,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * GAP_Y,
  }
}

function resolveLayers(nodes: LayoutInputNode[], known: Set<string>): Map<string, number> {
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const byKey = new Map(nodes.map((node) => [node.key, node]))

  const layerOf = (key: string): number => {
    const cached = layers.get(key)
    if (cached !== undefined) return cached
    if (visiting.has(key)) return 0
    const node = byKey.get(key)
    if (!node) return 0
    visiting.add(key)
    let layer = 0
    for (const dependency of node.dependsOn ?? []) {
      if (!known.has(dependency)) continue
      layer = Math.max(layer, layerOf(dependency) + 1)
    }
    visiting.delete(key)
    layers.set(key, layer)
    return layer
  }

  for (const node of nodes) layerOf(node.key)
  return layers
}

function edgePath(from: WorkflowNodePosition, to: WorkflowNodePosition): string {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const control = Math.max(24, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`
}
