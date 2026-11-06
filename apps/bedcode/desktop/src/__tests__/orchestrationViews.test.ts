import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import i18n from '@/i18n'

const { pushMock, execute, toastError, openTerminal } = vi.hoisted(() => ({
  pushMock: vi.fn(async () => {}),
  execute: vi.fn(),
  toastError: vi.fn(),
  openTerminal: vi.fn(async () => true),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
  useRoute: () => ({
    params: { id: 'o-1' },
    path: '/orchestrations/o-1',
    fullPath: '/orchestrations/o-1',
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: toastError },
}))

import OrchestrationListView from '@/views/orchestration/OrchestrationListView.vue'
import OrchestrationDetailView from '@/views/orchestration/OrchestrationDetailView.vue'
import OrchestrationTimeline from '@/components/orchestration/OrchestrationTimeline.vue'
import PlanEditor from '@/components/orchestration/PlanEditor.vue'

const meta = {
  statuses: ['draft', 'awaiting-approval', 'running', 'paused', 'completed', 'failed'],
  nodeStatuses: ['pending', 'ready', 'dispatching', 'running', 'succeeded', 'failed'],
  roles: ['planner', 'coder', 'reviewer', 'observer', 'custom'],
  acceptanceTypes: ['none', 'command', 'verdict'],
  reasonCodes: ['approval-required', 'scope-violation'],
  planErrorCodes: ['invalid-write-scope'],
  eventKinds: ['created', 'approved', 'started'],
  agents: [
    { id: 'pi', displayName: 'Pi', ready: true },
    { id: 'opencode', displayName: 'OpenCode', ready: false },
  ],
  agentProfiles: [
    {
      id: 'ap-frontend',
      name: '前端实现',
      cli: 'pi',
      model: 'anthropic/claude-sonnet-4.5',
      thinkingLevel: 'high',
      tags: ['frontend'],
      specialties: ['Vue'],
      description: '负责前端实现',
      canOrchestrate: false,
      enabled: true,
      ready: true,
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    },
    {
      id: 'ap-reviewer',
      name: '独立评审',
      cli: 'opencode',
      model: null,
      thinkingLevel: null,
      tags: [],
      specialties: ['评审'],
      description: '只做只读评审',
      canOrchestrate: false,
      enabled: true,
      ready: true,
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    },
    {
      id: 'ap-orchestrator',
      name: '编排',
      cli: 'pi',
      model: null,
      thinkingLevel: null,
      tags: [],
      specialties: ['编排'],
      description: '负责编排',
      canOrchestrate: true,
      enabled: true,
      ready: true,
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    },
  ],
}

const plan = {
  version: 2,
  title: '编排',
  goal: '目标',
  maxParallel: 2,
  nodes: [
    {
      key: 'n1',
      title: '实现',
      role: 'coder',
      agentRef: 'ap-frontend',
      agent: {
        profileId: 'ap-frontend',
        name: '前端实现',
        cli: 'pi',
        model: 'anthropic/claude-sonnet-4.5',
        thinkingLevel: 'high',
      },
      matchReason: '前端实现负责这个节点',
      prompt: 'do it',
      dependsOn: [],
      writeScope: ['src'],
      acceptance: { type: 'none' as const },
      maxAttempts: 2,
    },
    {
      key: 'n2',
      title: '评审',
      role: 'reviewer',
      agentRef: 'ap-reviewer',
      agent: {
        profileId: 'ap-reviewer',
        name: '独立评审',
        cli: 'opencode',
        model: null,
        thinkingLevel: null,
      },
      matchReason: '独立评审负责只读复核',
      prompt: 'review',
      dependsOn: ['n1'],
      writeScope: [],
      acceptance: { type: 'verdict' as const },
      maxAttempts: 1,
    },
  ],
}

function view(status: string) {
  return {
    orchestration: {
      id: 'o-1',
      projectId: 'p1',
      projectName: '项目',
      title: '编排',
      goal: '目标',
      mode: 'manual',
      requireApproval: true,
      orchestratorAgentId: null,
      status,
      planRev: 1,
      approved: false,
      maxParallel: 2,
      budget: { maxWallSeconds: 7200, maxDispatches: 3 },
      plannerRunId: null,
      plannerAgent: null,
      planError: null,
      plannerOutput: null,
      failureReason: null,
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
      startedAt: null,
      endedAt: null,
    },
    plan,
    nodes: plan.nodes.map((node, index) => ({
      ...node,
      agentId: node.agent?.cli ?? '',
      status: index === 0 ? 'pending' : 'pending',
      attempt: 0,
      runId: null,
      retryable: true,
      failureReason: null,
      dispatchedAt: null,
      startedAt: null,
      endedAt: null,
    })),
    actions: {
      orchestration: [
        { kind: 'approve', enabled: true, reason: null },
        { kind: 'start', enabled: false, reason: 'approval-required' },
        { kind: 'edit-plan', enabled: true, reason: null },
      ],
      nodes: [],
    },
    evidence: [],
    eventSeq: 2,
  }
}

function makeContext(): PluginContext {
  const translate = (key: string, params?: Record<string, unknown>) => {
    if (!params) return key
    return `${key}(${Object.entries(params)
      .map(([name, value]) => `${name}=${value}`)
      .join(',')})`
  }
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t: translate, getI18n: () => ({ global: { t: translate } }) },
    commands: { execute },
    session: {
      openTerminal,
      closeTerminal: async () => {},
      isTerminalOpen: () => false,
      predictTerminalSize: async () => ({ cols: 120, rows: 30 }),
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  } as unknown as PluginContext
}

function mountView(component: unknown) {
  return mount(component as never, {
    global: {
      plugins: [i18n],
      provide: { pluginContext: makeContext() },
      stubs: { teleport: true },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockImplementation(async (command: string) => {
    switch (command) {
      case 'orchestration.meta':
        return meta
      case 'orchestration.list':
        return {
          orchestrations: [
            {
              id: 'o-1',
              projectId: 'p1',
              projectName: '项目',
              title: '编排',
              mode: 'manual',
              status: 'awaiting-approval',
              nodeCount: 2,
              succeededCount: 0,
              failedCount: 0,
              runningCount: 0,
              agents: ['pi', 'opencode'],
              updatedAt: '2026-11-05T00:00:00Z',
              startedAt: null,
              endedAt: null,
            },
          ],
        }
      case 'project.list':
        return { projects: [{ id: 'p1', name: '项目' }] }
      case 'orchestration.get':
        return view('awaiting-approval')
      case 'orchestration.events':
        return {
          events: [
            {
              seq: 1,
              kind: 'created',
              nodeKey: null,
              attempt: null,
              payload: {},
              at: '2026-11-05T00:00:00Z',
            },
            {
              seq: 2,
              kind: 'approved',
              nodeKey: null,
              attempt: null,
              payload: {},
              at: '2026-11-05T00:00:01Z',
            },
          ],
          nextSeq: 2,
        }
      case 'orchestration.create':
        return { id: 'o-2', status: 'draft' }
      case 'orchestration.approve':
      case 'orchestration.update-plan':
        return { id: 'o-1', status: 'awaiting-approval' }
      default:
        throw new Error(`unexpected command: ${command}`)
    }
  })
})

describe('OrchestrationListView', () => {
  it('渲染编排行：标题 / 状态 / 进度 / 参与者', async () => {
    const wrapper = mountView(OrchestrationListView)
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-list"]').exists()).toBe(true)
    const rows = wrapper.findAll('[data-testid="orchestration-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('编排')
    expect(rows[0].text()).toContain('成功 0/2')
    expect(rows[0].findAll('[data-testid="orchestration-row-agents"] svg')).toHaveLength(2)
    wrapper.unmount()
  })

  it('空态可见；新建后跳到详情', async () => {
    execute.mockImplementation(async (command: string) => {
      if (command === 'orchestration.meta') return meta
      if (command === 'project.list') return { projects: [{ id: 'p1', name: '项目' }] }
      if (command === 'orchestration.list') return { orchestrations: [] }
      if (command === 'orchestration.create') return { id: 'o-2', status: 'draft' }
      throw new Error(`unexpected command: ${command}`)
    })
    const wrapper = mountView(OrchestrationListView)
    await flushPromises()
    expect(wrapper.find('[data-testid="orchestration-empty"]').exists()).toBe(true)

    await wrapper.find('[data-testid="orchestration-create"]').trigger('click')
    await wrapper.find('[data-testid="orchestration-create-name"]').setValue('新编排')
    await wrapper.find('[data-testid="orchestration-create-goal"]').setValue('目标')
    await wrapper.find('[data-testid="orchestration-create-submit"]').trigger('click')
    await flushPromises()

    const created = execute.mock.calls.filter((call) => call[0] === 'orchestration.create')
    expect(created).toHaveLength(1)
    expect(created[0][1]).toMatchObject({
      projectId: 'p1',
      title: '新编排',
      goal: '目标',
      mode: 'manual',
    })
    expect(pushMock).toHaveBeenCalledWith('/orchestrations/o-2')
    wrapper.unmount()
  })
})

describe('OrchestrationDetailView', () => {
  it('渲染状态 / 动作 / 工作流 / 节点；批准按钮发命令', async () => {
    const wrapper = mountView(OrchestrationDetailView)
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-detail"]').exists()).toBe(true)
    expect(
      wrapper.find('[data-testid="orchestration-detail-status"]').attributes('data-status'),
    ).toBe('awaiting-approval')
    expect(wrapper.find('[data-testid="orchestration-workflow"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="orchestration-workflow-node"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="orchestration-plan-node"]')).toHaveLength(2)

    const approve = wrapper.find('[data-testid="orchestration-approve"]')
    expect(approve.attributes('disabled')).toBeUndefined()
    await approve.trigger('click')
    await flushPromises()
    expect(execute.mock.calls.some((call) => call[0] === 'orchestration.approve')).toBe(true)
    wrapper.unmount()
  })

  it('编辑计划保存走 update-plan；审阅者节点带 verdict 验收', async () => {
    const wrapper = mountView(OrchestrationDetailView)
    await flushPromises()

    expect(wrapper.find('[data-testid="orchestration-plan-editor"]').exists()).toBe(false)
    await wrapper.find('[data-testid="orchestration-edit-plan"]').trigger('click')
    expect(wrapper.find('[data-testid="orchestration-plan-editor"]').exists()).toBe(true)

    await wrapper.find('[data-testid="orchestration-plan-save"]').trigger('click')
    await flushPromises()
    const calls = execute.mock.calls.filter((call) => call[0] === 'orchestration.update-plan')
    expect(calls).toHaveLength(1)
    expect((calls[0][1] as { plan: { nodes: unknown[] } }).plan.nodes).toHaveLength(2)
    wrapper.unmount()
  })

  it('事件按 nextSeq 增量拉取，命中单页上限继续翻页合并（H8）', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      seq: index + 1,
      kind: 'note',
      nodeKey: null,
      attempt: null,
      payload: {},
      at: '2026-11-05T00:00:00Z',
    }))
    const latest = {
      seq: 501,
      kind: 'note',
      nodeKey: null,
      attempt: null,
      payload: {},
      at: '2026-11-05T00:00:01Z',
    }
    execute.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'orchestration.meta') return meta
      if (command === 'orchestration.get') return view('completed')
      if (command === 'orchestration.events') {
        const afterSeq = (args as { afterSeq?: number })?.afterSeq ?? 0
        return afterSeq === 0
          ? { events: firstPage, nextSeq: 500 }
          : { events: [latest], nextSeq: 501 }
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const wrapper = mountView(OrchestrationDetailView)
    await flushPromises()

    const calls = execute.mock.calls.filter(([command]) => command === 'orchestration.events')
    expect(calls[0][1]).toMatchObject({ afterSeq: 0, limit: 500 })
    expect(calls[1][1]).toMatchObject({ afterSeq: 500, limit: 500 })
    expect(wrapper.findComponent(OrchestrationTimeline).props('events')).toHaveLength(501)
    wrapper.unmount()
  })

  it('KeepAlive 切走后停止 1s 轮询，切回恢复取数（H7）', async () => {
    const Host = defineComponent({
      components: { OrchestrationDetailView },
      data: () => ({ show: true }),
      template: '<KeepAlive><OrchestrationDetailView v-if="show" /></KeepAlive>',
    })
    const wrapper = mount(Host, {
      global: {
        plugins: [i18n],
        provide: { pluginContext: makeContext() },
        stubs: { teleport: true },
      },
    })
    await flushPromises()

    const count = () =>
      execute.mock.calls.filter(([command]) => command === 'orchestration.get').length
    const before = count()

    await wrapper.setData({ show: false })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await flushPromises()
    expect(count()).toBe(before, 'deactivated view must not keep polling')

    await wrapper.setData({ show: true })
    await flushPromises()
    expect(count()).toBeGreaterThan(before, 'reactivated view must reload')
    wrapper.unmount()
  })
})

describe('创建编排：自动模式', () => {
  it('显示编排 Agent 与人工批准开关', async () => {
    const wrapper = mountView(OrchestrationListView)
    await flushPromises()
    await wrapper.find('[data-testid="orchestration-create"]').trigger('click')
    await flushPromises()

    const vm = wrapper.vm as unknown as { createForm: { mode: string } }
    vm.createForm.mode = 'auto'
    await nextTick()

    expect(wrapper.find('[data-testid="orchestration-create-orchestrator"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="orchestration-create-approval"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('PlanEditor（轮询不覆盖用户输入）', () => {
  it('未编辑时跟随服务端计划；编辑中忽略轮询换对象', async () => {
    const wrapper = mount(PlanEditor, {
      props: { plan, agentProfiles: meta.agentProfiles, errors: [] },
      global: { plugins: [i18n] },
    })
    const titleInput = () => wrapper.findAll('input')[0]

    await wrapper.setProps({ plan: { ...plan, title: '服务端标题' } })
    expect((titleInput().element as HTMLInputElement).value).toBe('服务端标题')

    await titleInput().setValue('用户输入')
    await wrapper.setProps({ plan: { ...plan, title: '轮询标题' } })
    expect((titleInput().element as HTMLInputElement).value).toBe('用户输入')
    wrapper.unmount()
  })
})
