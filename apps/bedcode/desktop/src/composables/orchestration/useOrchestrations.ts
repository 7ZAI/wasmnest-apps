/**
 * 编排取数 / 命令调用（DESIGN §7.10 / §7.13）
 *
 * 红线与其余域一致：只经 `context.commands.execute`，不直连网络 / 文件 / 导航。
 * 本模块不做文案映射——错误上抛，由视图经 `resolvePluginErrorText` 转提示。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type {
  EventsResponse,
  ListItemView,
  MetaView,
  OrchestrationStatus,
  OrchestrationView,
} from './types'
import type { Plan, PlanError, PlanMode } from '@/utils/orchestrationPlan'

export interface OrchestrationCreateInput {
  projectId: string
  title: string
  goal: string
  mode: PlanMode
  /** 自动模式必填：池里的编排 Agent */
  orchestratorAgentId?: string
  /** 自动计划完成后是否必须人工批准（默认 true） */
  requireApproval?: boolean
  plan?: Plan
}

/** 变更命令的最小回执（详情由 get 刷新） */
export interface OrchestrationReceipt {
  id: string
  status: OrchestrationStatus
  planError?: PlanError[] | null
}

export function useOrchestrations(context: PluginContext) {
  const execute = <T>(command: string, args: unknown): Promise<T> =>
    context.commands.execute(command, args) as Promise<T>

  return {
    meta: () => execute<MetaView>('orchestration.meta', {}),

    list: async (projectId?: string): Promise<ListItemView[]> => {
      const raw = await execute<{ orchestrations: ListItemView[] }>(
        'orchestration.list',
        projectId ? { projectId } : {},
      )
      return raw.orchestrations
    },

    get: (id: string) => execute<OrchestrationView>('orchestration.get', { id }),

    create: (input: OrchestrationCreateInput) =>
      execute<OrchestrationReceipt>('orchestration.create', input),

    updatePlan: (id: string, plan: Plan) =>
      execute<OrchestrationReceipt>('orchestration.update-plan', { id, plan }),

    approve: (id: string) => execute<OrchestrationReceipt>('orchestration.approve', { id }),

    plan: (id: string, agentProfileId?: string) =>
      execute<OrchestrationReceipt>(
        'orchestration.plan',
        agentProfileId ? { id, agentProfileId } : { id },
      ),

    start: (id: string) => execute<OrchestrationReceipt>('orchestration.start', { id }),

    pause: (id: string) => execute<OrchestrationReceipt>('orchestration.pause', { id }),

    resume: (id: string) => execute<OrchestrationReceipt>('orchestration.resume', { id }),

    cancel: (id: string) => execute<OrchestrationReceipt>('orchestration.cancel', { id }),

    retryNode: (id: string, nodeKey: string) =>
      execute<OrchestrationReceipt>('orchestration.retry-node', { id, nodeKey }),

    skipNode: (id: string, nodeKey: string) =>
      execute<OrchestrationReceipt>('orchestration.skip-node', { id, nodeKey }),

    events: (id: string, afterSeq = 0, limit?: number) =>
      execute<EventsResponse>('orchestration.events', {
        id,
        afterSeq,
        ...(limit ? { limit } : {}),
      }),
  }
}

export type OrchestrationsApi = ReturnType<typeof useOrchestrations>

/** reason code → app 域 i18n 相对 key（词表由 `meta.reasonCodes` 锁死） */
export function reasonKey(reason: string): string {
  return `orchestration.reason.${reason}`
}

/** 状态 → app 域 i18n 相对 key */
export function statusKey(status: string): string {
  return `orchestration.status.${status}`
}

/** 节点状态 → app 域 i18n 相对 key */
export function nodeStatusKey(status: string): string {
  return `orchestration.nodeStatus.${status}`
}

/** 错误文本里提取 reason code（后端约定 `<code>: <detail>`） */
export function parseReasonCode(message: string): string | null {
  const match = /^([a-z][a-z0-9-]*):/.exec(message.trim())
  return match ? match[1] : null
}
