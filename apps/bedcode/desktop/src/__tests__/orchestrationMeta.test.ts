import { describe, it, expect } from 'vitest'
import { messages } from '../i18n'
import { STATUS_TONE } from '@/composables/orchestration/types'

/**
 * 词表 completeness（DESIGN §10.3）：`orchestration.meta` 返回的每一项都必须有
 * zh/en 文案。词表真源在 Rust 枚举；本测试按同一设计清单锁 UI 覆盖，缺一项即红。
 */
const STATUSES = [
  'draft',
  'planning',
  'awaiting-approval',
  'running',
  'pausing',
  'paused',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
  'budget-exhausted',
]
const NODE_STATUSES = [
  'pending',
  'ready',
  'dispatching',
  'running',
  'awaiting-input',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
  'blocked',
]
const ROLES = ['planner', 'coder', 'reviewer', 'observer', 'custom']
const ACCEPTANCE_TYPES = ['none', 'command', 'verdict']
const REASON_CODES = [
  'agent-unsupported',
  'agent-not-ready',
  'agent-profile-failed',
  'auto-start-failed',
  'project-not-git',
  'working-tree-dirty',
  'project-trust-required',
  'bridge-offline',
  'run-start-failed',
  'send-failed',
  'dispatch-unknown',
  'status-unknown',
  'task-timeout',
  'agent-interrupted',
  'permission-waiting',
  'scope-violation',
  'acceptance-failed',
  'evidence-missing',
  'plan-invalid',
  'planner-failed',
  'planner-invalid-json',
  'quota-wait',
  'budget-exceeded',
  'deadlock-suspected',
  'approval-required',
  'dependency-failed',
  'node-failed',
  'run-ended',
  'not-retryable',
  'attempts-exhausted',
]
const PLAN_ERROR_CODES = [
  'unsupported-version',
  'invalid-node-count',
  'invalid-max-parallel',
  'invalid-node-key',
  'duplicate-node-key',
  'invalid-max-attempts',
  'invalid-write-scope',
  'invalid-acceptance-command',
  'invalid-acceptance-timeout',
  'command-not-allowed',
  'invalid-acceptance-cwd',
  'readonly-role-write-scope',
  'readonly-role-acceptance',
  'self-dependency',
  'unknown-dependency',
  'dependency-cycle',
  'agent-unsupported',
  'unknown-agent',
  'agent-disabled',
  'planner-invalid-json',
]
const EVENT_KINDS = [
  'created',
  'plan_saved',
  'plan_invalid',
  'planned',
  'approved',
  'started',
  'pausing',
  'paused',
  'resumed',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
  'budget_exhausted',
  'node_ready',
  'dispatched',
  'node_running',
  'awaiting_input',
  'verifying',
  'node_succeeded',
  'node_failed',
  'node_cancelled',
  'node_skipped',
  'node_blocked',
  'retried',
  'note',
]
const ACTION_KINDS = [
  'approve',
  'start',
  'pause',
  'resume',
  'cancel',
  'retry-node',
  'skip-node',
  'replan',
  'edit-plan',
]

function assertKeys(prefix: string, values: string[]) {
  for (const value of values) {
    const key = `${prefix}.${value}` as keyof (typeof messages)['zh-CN']
    expect(messages['zh-CN'][key], `zh missing ${key}`).toBeTruthy()
    expect(messages['en'][key], `en missing ${key}`).toBeTruthy()
  }
}

describe('编排词表 completeness', () => {
  it('状态 / 节点状态 / 角色 / 验收类型 / reason / 计划错误 / 事件 / 动作全部有 zh+en 文案', () => {
    assertKeys('orchestration.status', STATUSES)
    assertKeys('orchestration.nodeStatus', NODE_STATUSES)
    assertKeys('orchestration.role', ROLES)
    assertKeys('orchestration.acceptanceType', ACCEPTANCE_TYPES)
    assertKeys('orchestration.reason', REASON_CODES)
    assertKeys('orchestration.planError', PLAN_ERROR_CODES)
    assertKeys('orchestration.event', EVENT_KINDS)
    assertKeys('orchestration.action', ACTION_KINDS)
  })

  it('状态色映射覆盖编排与节点两套词表', () => {
    for (const status of [...STATUSES, ...NODE_STATUSES]) {
      expect(STATUS_TONE[status], `missing tone for ${status}`).toBeTruthy()
    }
  })
})
