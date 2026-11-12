/**
 * 编排 Plan 的 TS wire 类型与轻量解析（§7.1 / §7.13）
 *
 * 完整校验真源在 Rust `plan::validate`：前端只做形状解析，保证编辑器 / 工作流图
 * 拿到的是可渲染的结构；校验错误由 `orchestration.update-plan` 返回并逐条展示。
 */

export type PlanMode = 'manual' | 'auto'

export type Role = 'planner' | 'coder' | 'reviewer' | 'observer' | 'custom'

export type AcceptanceType = 'none' | 'command' | 'verdict'

export interface AcceptanceCommand {
  type: 'command'
  command: string[]
  cwd?: string | null
  timeoutSec?: number | null
}

export interface AcceptanceVerdict {
  type: 'verdict'
  timeoutSec?: number | null
}

export type Acceptance = { type: 'none' } | AcceptanceCommand | AcceptanceVerdict

/** 派发快照：池成员在计划保存 / 批准时的只读拷贝 */
export interface AgentSnapshot {
  profileId: string
  name: string
  cli: string
  model: string | null
  thinkingLevel: string | null
}

export interface PlanNode {
  key: string
  title: string
  role: Role
  /** 池成员 id（不是 CLI） */
  agentRef: string
  /** 服务端解析的快照；planner 输出不带 */
  agent?: AgentSnapshot | null
  /** 编排 Agent 的选人理由（手动计划可空） */
  matchReason: string
  prompt: string
  dependsOn: string[]
  writeScope: string[]
  acceptance: Acceptance
  maxAttempts: number
}

export interface Plan {
  version: number
  title: string
  goal: string
  maxParallel: number
  nodes: PlanNode[]
}

/** 计划校验错误（`PlanError`，code 是 `meta.planErrorCodes` 的成员） */
export interface PlanError {
  code: string
  nodeKey?: string | null
  message: string
}

/** 空计划（新建手动编排的起点；未被批准前不会执行） */
export function emptyPlan(title: string, goal: string): Plan {
  return {
    version: 2,
    title,
    goal,
    maxParallel: 2,
    nodes: [],
  }
}

export function emptyNode(key: string, agentRef = ''): PlanNode {
  return {
    key,
    title: '',
    role: 'coder',
    agentRef,
    agent: null,
    matchReason: '',
    prompt: '',
    dependsOn: [],
    writeScope: [],
    acceptance: { type: 'none' },
    maxAttempts: 1,
  }
}

/**
 * 形状解析：字段级检查失败即抛错（不做静默补全）。
 *
 * 与 Rust `Plan` 的 `deny_unknown_fields` 口径一致：这里只接受已知字段，
 * 未知字段忽略（前端不持有服务端 schema 演进的判断权）。
 */
export function parsePlan(value: unknown): Plan {
  const record = asRecord(value, 'plan')
  const nodes = record.nodes
  if (!Array.isArray(nodes)) throw new Error('plan.nodes must be an array')
  return {
    version: numberField(record, 'version'),
    title: stringField(record, 'title'),
    goal: stringField(record, 'goal'),
    maxParallel: numberField(record, 'maxParallel'),
    nodes: nodes.map((node, index) => parseNode(node, index)),
  }
}

function parseNode(value: unknown, index: number): PlanNode {
  const record = asRecord(value, `plan.nodes[${index}]`)
  const acceptance = asRecord(record.acceptance, `plan.nodes[${index}].acceptance`)
  const type = stringField(acceptance, 'type')
  const parsedAcceptance: Acceptance =
    type === 'command'
      ? {
          type: 'command',
          command: stringArray(acceptance.command, 'command'),
          cwd: optionalString(acceptance.cwd),
          timeoutSec: optionalNumber(acceptance.timeoutSec),
        }
      : type === 'verdict'
        ? { type: 'verdict', timeoutSec: optionalNumber(acceptance.timeoutSec) }
        : { type: 'none' }
  return {
    key: stringField(record, 'key'),
    title: stringField(record, 'title'),
    role: stringField(record, 'role') as Role,
    agentRef: stringField(record, 'agentRef'),
    agent: parseAgentSnapshot(record.agent),
    matchReason: optionalString(record.matchReason) ?? '',
    prompt: stringField(record, 'prompt'),
    dependsOn: record.dependsOn === undefined ? [] : stringArray(record.dependsOn, 'dependsOn'),
    writeScope: record.writeScope === undefined ? [] : stringArray(record.writeScope, 'writeScope'),
    acceptance: parsedAcceptance,
    maxAttempts: record.maxAttempts === undefined ? 1 : numberField(record, 'maxAttempts'),
  }
}

function parseAgentSnapshot(value: unknown): AgentSnapshot | null {
  if (value === undefined || value === null) return null
  const record = asRecord(value, 'plan.nodes[].agent')
  return {
    profileId: stringField(record, 'profileId'),
    name: stringField(record, 'name'),
    cli: stringField(record, 'cli'),
    model: optionalString(record.model) ?? null,
    thinkingLevel: optionalString(record.thinkingLevel) ?? null,
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${key} must be a string array`)
  }
  return value as string[]
}
