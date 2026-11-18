/**
 * 执行流水线布局（纯函数，DESIGN §9.3）
 *
 * 每个节点一条泳道；段 = 相邻状态事件的区间。无事件的节点回退到节点自身的
 * 时间戳（dispatchedAt / startedAt → endedAt/now），保证「刚派发还没事件」也能画。
 */

export interface PipelineNode {
  key: string
  title: string
  status: string
  attempt: number
  dispatchedAt?: string | null
  startedAt?: string | null
  endedAt?: string | null
}

export interface PipelineEvent {
  seq: number
  kind: string
  nodeKey: string | null
  attempt: number | null
  at: string
}

export type PipelineStage = 'ready' | 'dispatching' | 'running' | 'awaiting-input' | 'verifying'

export interface PipelineSegment {
  stage: PipelineStage
  startMs: number
  endMs: number
}

export interface PipelineLane {
  nodeKey: string
  title: string
  status: string
  attempt: number
  segments: PipelineSegment[]
  result: string | null
  startMs: number
  endMs: number
}

export interface PipelineLayout {
  lanes: PipelineLane[]
  startMs: number
  endMs: number
  durationMs: number
}

const STAGE_EVENTS: Record<string, PipelineStage> = {
  node_ready: 'ready',
  dispatched: 'dispatching',
  node_running: 'running',
  awaiting_input: 'awaiting-input',
  verifying: 'verifying',
}

const TERMINAL_EVENTS = new Set(['node_succeeded', 'node_failed', 'node_cancelled', 'node_skipped'])

export function pipelineLanes(
  nodes: PipelineNode[],
  events: PipelineEvent[],
  startedAt: string | null | undefined,
  now: number = Date.now(),
): PipelineLayout {
  const started = parseTime(startedAt) ?? earliestEvent(events) ?? now
  const lanes = nodes.map((node) => laneFor(node, events, started, now))
  const endMs = Math.max(now, ...lanes.map((lane) => lane.endMs), started)
  return {
    lanes,
    startMs: started,
    endMs,
    durationMs: Math.max(0, endMs - started),
  }
}

function laneFor(
  node: PipelineNode,
  events: PipelineEvent[],
  started: number,
  now: number,
): PipelineLane {
  const nodeEvents = events
    .filter((event) => event.nodeKey === node.key)
    .filter((event) => event.attempt === null || event.attempt === node.attempt)
    .sort((a, b) => a.seq - b.seq)

  const segments: PipelineSegment[] = []
  let result: string | null = null
  let openStage: PipelineStage | null = null
  let openAt: number | null = null
  let lastTime = started

  for (const event of nodeEvents) {
    const at = parseTime(event.at)
    if (at === null) continue
    if (openStage !== null && openAt !== null && at > openAt) {
      segments.push({ stage: openStage, startMs: openAt, endMs: at })
    }
    lastTime = Math.max(lastTime, at)
    if (TERMINAL_EVENTS.has(event.kind)) {
      openStage = null
      openAt = null
      result = event.kind.replace('node_', '')
      continue
    }
    openStage = STAGE_EVENTS[event.kind] ?? openStage
    openAt = at
  }

  if (openStage !== null && openAt !== null) {
    const end = parseTime(node.endedAt) ?? now
    if (end > openAt) segments.push({ stage: openStage, startMs: openAt, endMs: end })
    lastTime = Math.max(lastTime, end)
  } else if (segments.length === 0) {
    const fallbackStart = parseTime(node.dispatchedAt) ?? parseTime(node.startedAt) ?? started
    const fallbackEnd = parseTime(node.endedAt) ?? now
    if (fallbackEnd > fallbackStart) {
      segments.push({
        stage: stageForStatus(node.status),
        startMs: fallbackStart,
        endMs: fallbackEnd,
      })
    }
    lastTime = Math.max(lastTime, fallbackEnd)
  } else {
    lastTime = Math.max(lastTime, parseTime(node.endedAt) ?? segments[segments.length - 1].endMs)
  }

  if (result === null && TERMINAL_STATUSES.has(node.status)) {
    result = node.status
  }

  return {
    nodeKey: node.key,
    title: node.title,
    status: node.status,
    attempt: node.attempt,
    segments,
    result,
    startMs: started,
    endMs: Math.max(lastTime, started),
  }
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'skipped'])

function stageForStatus(status: string): PipelineStage {
  switch (status) {
    case 'dispatching':
      return 'dispatching'
    case 'running':
      return 'running'
    case 'awaiting-input':
      return 'awaiting-input'
    case 'verifying':
      return 'verifying'
    default:
      return 'ready'
  }
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function earliestEvent(events: PipelineEvent[]): number | null {
  let earliest: number | null = null
  for (const event of events) {
    const at = parseTime(event.at)
    if (at === null) continue
    if (earliest === null || at < earliest) earliest = at
  }
  return earliest
}
