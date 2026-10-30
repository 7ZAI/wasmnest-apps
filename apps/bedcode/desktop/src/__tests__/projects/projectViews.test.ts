/**
 * 项目列表页 / 项目工作台行为契约（ADR 0003 / issue #23 M2）
 *
 * 只断言外部行为：界面渲染出什么、点下去发了哪条命令（入参是什么）、
 * 失败路径给出什么提示。不测 DOM 结构快照，不测内部方法。
 *
 * 覆盖：
 * - 列表页：卡片（名称 / 环境徽标 / 活跃运行数 / 最近活动）、空态、
 *   新建后跳转工作台、目录为空不发命令、重命名与移除；
 * - 工作台：运行列表（标题 / agent / 状态）、终端页签把运行投影给终端组件、
 *   选 agent 启动（入参）、停止运行、项目不存在空态、无运行空态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

const { pushMock, toastSuccess, toastInfo, toastError, storageGet, storageSet } = vi.hoisted(
  () => ({
    pushMock: vi.fn(async () => {}),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
    storageGet: vi.fn(async () => undefined),
    storageSet: vi.fn(async () => {}),
  }),
)

// 两个视图都只用 useRouter / useRoute（无 router-link），桩掉即可；
// 断言「创建后跳转到工作台」靠 push 的入参。
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
  useRoute: () => ({ params: { id: 'p-1' }, path: '/projects/p-1', fullPath: '/projects/p-1' }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, info: toastInfo, error: toastError },
}))

// 宿主平台事实：项目表单按平台过滤执行环境（Linux 只有 linux）
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }))

import ProjectListView from '@/views/projects/ProjectListView.vue'
import ProjectWorkbenchView from '@/views/projects/ProjectWorkbenchView.vue'

// ==================== 命令面桩 ====================

type Handler = (args: any) => unknown

const execute = vi.fn()
let routes: Record<string, Handler>

function projectRecord(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    environment: 'linux',
    wslDistro: null,
    workingDir: '/srv/app',
    name,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastOpenedAt: null,
    activeRuns: 0,
    runCount: 0,
    lastActivityAt: null,
    lastAgentId: null,
    ...overrides,
  }
}

function runRecord(id: string, status: string, active: boolean) {
  return {
    id,
    projectId: 'p-1',
    configId: 'cfg-1',
    agentId: 'opencode',
    agentSessionId: 'ses_abc',
    title: null,
    name: '支付重构',
    status,
    model: null,
    createdAt: '2026-10-29T00:00:00Z',
    startedAt: '2026-10-29T00:00:01Z',
    stoppedAt: null,
    updatedAt: '2026-10-29T00:00:09Z',
    active,
    truncated: false,
  }
}

function defaultRoutes(): Record<string, Handler> {
  return {
    'project.list': () => ({
      projects: [
        projectRecord('p-1', '支付重构', {
          activeRuns: 2,
          runCount: 5,
          lastAgentId: 'opencode',
          lastActivityAt: '2026-10-29T00:00:09Z',
        }),
      ],
    }),
    'project.get': () => projectRecord('p-1', '支付重构'),
    'project.create': () => ({ project: projectRecord('p-2', '新项目'), created: true }),
    'project.open': () => projectRecord('p-1', '支付重构'),
    'project.rename': () => projectRecord('p-1', '改名后'),
    'project.remove': () => ({ removed: true, runsRemoved: 0 }),
    'project.pick-dir': () => ({ picked: true, path: '/srv/picked' }),
    'run.list': () => ({ runs: [runRecord('r-1', 'running', true)] }),
    'run.start': () => ({ runId: 'r-new', name: '支付重构', configId: 'cfg-1' }),
    'agent.list-agents': () => ({
      agents: [{ id: 'opencode', displayName: 'OpenCode', binary: 'opencode' }],
    }),
    'agent.get-state': () => ({ state: { clis: { opencode: { status: 'ok' } } } }),
    'session.close': () => ({ stopped: true }),
  }
}

/** 终端组件替身：xterm / canvas 在 happy-dom 下不可用，只验「喂进来的会话是谁」 */
const TerminalStub = defineComponent({
  name: 'TerminalPreview',
  props: {
    session: { type: Object, default: null },
    showInput: { type: Boolean, default: true },
    showHeader: { type: Boolean, default: true },
  },
  template: '<div data-testid="terminal-stub" />',
})

/** i18n 桩：key 直返；带参数时把参数拼进 key（便于断言数量类文案） */
const t = (key: string, params?: Record<string, unknown>) => {
  if (!params || Object.keys(params).length === 0) return key
  const flat = Object.entries(params)
    .map(([name, value]) => `${name}=${value}`)
    .join(',')
  return `${key}(${flat})`
}

function makeContext(): PluginContext {
  return {
    id: 'com.wasmnest.bedcode',
    i18n: { t, getI18n: () => ({ global: { t } }) },
    commands: { execute },
    session: {
      predictTerminalSize: async () => ({ cols: 120, rows: 30 }),
      openTerminal: async () => true,
      closeTerminal: async () => {},
      isTerminalOpen: () => false,
    },
    storage: { get: storageGet, set: storageSet, delete: async () => {} },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
  } as unknown as PluginContext
}

function mountView(component: unknown) {
  return mount(component as never, {
    global: {
      provide: { pluginContext: makeContext() },
      // 弹窗走 <Teleport to="body">：stub 掉让内容留在组件树内可断言
      stubs: { teleport: true, TerminalPreview: TerminalStub },
    },
  })
}

const commandsTo = (id: string) => execute.mock.calls.filter((call) => call[0] === id)

beforeEach(() => {
  vi.clearAllMocks()
  routes = defaultRoutes()
  execute.mockImplementation(async (id: string, args: any) => {
    const handler = routes[id]
    if (!handler) throw new Error(`unexpected command: ${id}`)
    return handler(args)
  })
})

// ==================== 列表页 ====================

describe('ProjectListView（项目列表）', () => {
  it('渲染项目卡：名称 / 环境徽标 / 活跃运行数 / 最近 agent', async () => {
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    expect(wrapper.find('[data-testid="projects-view"]').exists()).toBe(true)
    const cards = wrapper.findAll('[data-testid="project-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].text()).toContain('支付重构')
    expect(cards[0].text()).toContain('linux')
    expect(cards[0].text()).toContain('project.card.activeRuns(n=2)')
    expect(cards[0].text()).toContain('opencode')
    expect(cards[0].text()).toContain('/srv/app')
  })

  it('空态：无项目时给引导，不渲染空网格', async () => {
    routes['project.list'] = () => ({ projects: [] })
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    expect(wrapper.find('[data-testid="projects-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="project-card"]')).toHaveLength(0)
  })

  it('新建项目：提交目录后创建 + 跳进工作台', async () => {
    routes['project.create'] = () => ({ project: projectRecord('p-2', '新项目'), created: true })
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="projects-create"]').trigger('click')
    await wrapper.find('[data-testid="project-form-dir"] input').setValue('/srv/new-app')
    await wrapper.find('[data-testid="project-form-submit"]').trigger('click')
    await flushPromises()

    expect(commandsTo('project.create')[0][1]).toMatchObject({
      environment: 'linux',
      workingDir: '/srv/new-app',
    })
    expect(pushMock).toHaveBeenCalledWith('/projects/p-2')
    expect(toastSuccess).toHaveBeenCalledWith('project.toast.created')
  })

  it('重复目录：created=false 时提示「已带你过去」，同样进工作台', async () => {
    routes['project.create'] = () => ({ project: projectRecord('p-1', '支付重构'), created: false })
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="projects-create"]').trigger('click')
    await wrapper.find('[data-testid="project-form-dir"] input').setValue('/srv/app')
    await wrapper.find('[data-testid="project-form-submit"]').trigger('click')
    await flushPromises()

    expect(toastSuccess).toHaveBeenCalledWith('project.toast.existed')
    expect(pushMock).toHaveBeenCalledWith('/projects/p-1')
  })

  it('目录为空：内联提示且不发创建命令（不把空值送回去换通用错误）', async () => {
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="projects-create"]').trigger('click')
    await wrapper.find('[data-testid="project-form-submit"]').trigger('click')
    await flushPromises()

    expect(commandsTo('project.create')).toHaveLength(0)
    expect(wrapper.text()).toContain('project.form.required')
  })

  it('选择目录按钮把宿主返回的路径回填到输入框', async () => {
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="projects-create"]').trigger('click')
    await wrapper.find('[data-testid="project-form-browse"]').trigger('click')
    await flushPromises()

    expect(
      (wrapper.find('[data-testid="project-form-dir"] input').element as HTMLInputElement).value,
    ).toBe('/srv/picked')
  })

  it('重命名：只改展示名，成功后刷新列表', async () => {
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="project-rename"]').trigger('click')
    await wrapper.find('[data-testid="project-rename-input"] input').setValue('改名后')
    const save = wrapper.findAll('button').find((button) => button.text() === 'project.button.save')
    await save!.trigger('click')
    await flushPromises()

    expect(commandsTo('project.rename')[0][1]).toEqual({ id: 'p-1', name: '改名后' })
    expect(toastSuccess).toHaveBeenCalledWith('project.toast.renamed')
  })

  it('移除项目：确认后调 project.remove 并刷新', async () => {
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="project-remove"]').trigger('click')
    await wrapper.find('[data-testid="project-remove-confirm"]').trigger('click')
    await flushPromises()

    expect(commandsTo('project.remove')[0][1]).toEqual({ id: 'p-1' })
    expect(toastSuccess).toHaveBeenCalledWith('project.toast.removed')
  })

  it('移除失败（有活跃运行）：走错误提示，不提示成功', async () => {
    routes['project.remove'] = () => {
      throw new Error('project has 1 active run(s)')
    }
    const wrapper = mountView(ProjectListView)
    await flushPromises()

    await wrapper.find('[data-testid="project-remove"]').trigger('click')
    await wrapper.find('[data-testid="project-remove-confirm"]').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

// ==================== 工作台 ====================

describe('ProjectWorkbenchView（项目工作台）', () => {
  it('渲染运行列表：标题 / agent / 状态文案；终端页签默认把该运行喂给终端组件', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(commandsTo('run.list')[0][1]).toEqual({ projectId: 'p-1' })
    const items = wrapper.findAll('[data-testid="run-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].text()).toContain('支付重构')
    expect(items[0].text()).toContain('opencode')
    expect(items[0].text()).toContain('session.status.running')

    const terminal = wrapper.findComponent(TerminalStub)
    expect(terminal.exists()).toBe(true)
    expect((terminal.props('session') as { id: string }).id).toBe('r-1')
  })

  it('无运行：给空态与引导，检查器提示先选运行', async () => {
    routes['run.list'] = () => ({ runs: [] })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.find('[data-testid="run-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inspector-empty"]').exists()).toBe(true)
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(false)
  })

  it('项目不存在（被移除 / 深链写错）：显性空态，不渲染三栏', async () => {
    routes['project.get'] = () => null
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.find('[data-testid="project-not-found"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-item"]').exists()).toBe(false)
  })

  it('新建运行：选 agent → run.start 入参（项目 + agent），并选中新运行', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'stopped', false), runRecord('r-new', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="run-agent-opencode"]').trigger('click')
    await flushPromises()

    expect(commandsTo('run.start')[0][1]).toMatchObject({
      projectId: 'p-1',
      agentId: 'opencode',
    })
    expect(commandsTo('run.start')[0][1]).toMatchObject({ cols: 120, rows: 30 })
  })

  it('两条 running 运行来回切：终端组件每次收到的都是当前选中的运行', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'running', true), runRecord('r-2', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-1')

    await wrapper.findAll('[data-testid="run-item"]')[1].trigger('click')
    await flushPromises()
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-2')

    // 切回第一条：交换的是「同一条 PTY 的会话」，不是复用上一条的展示状态
    // （终端组件内部按 session.id 重挂的行为由 terminalPreview.test.ts 覆盖）
    await wrapper.findAll('[data-testid="run-item"]')[0].trigger('click')
    await flushPromises()
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-1')
  })

  it('停止运行：session.close（运行即会话投影）+ 关窗', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.find('[data-testid="run-stop"]').trigger('click')
    await flushPromises()

    expect(commandsTo('session.close')[0][1]).toEqual({ sessionId: 'r-1' })
  })

  it('检查器页签可切换：变更 / 事件是显性占位（M3 接入），切回终端仍渲染同一条运行', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.find('[data-testid="inspector-tab-changes"]').trigger('click')
    expect(wrapper.find('[data-testid="inspector-changes"]').exists()).toBe(true)
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(false)

    await wrapper.find('[data-testid="inspector-tab-events"]').trigger('click')
    expect(wrapper.find('[data-testid="inspector-events"]').exists()).toBe(true)

    await wrapper.find('[data-testid="inspector-tab-terminal"]').trigger('click')
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-1')
  })

  it('三栏宽度可调：默认宽度 + 键盘步进 + 双击复位（手柄是 separator，带 aria 值）', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 默认宽度 = 改动前写死的值（w-64 / w-[420px]），进页面不该先变一次形
    expect(wrapper.get('[data-testid="pane-runs"]').attributes('style')).toContain('width: 256px')
    expect(wrapper.get('[data-testid="pane-inspector"]').attributes('style')).toContain(
      'width: 420px',
    )

    const inspectorHandle = wrapper.get('[data-testid="split-inspector"]')
    expect(inspectorHandle.attributes('role')).toBe('separator')
    expect(inspectorHandle.attributes('aria-orientation')).toBe('vertical')
    expect(inspectorHandle.attributes('aria-valuenow')).toBe('420')
    expect(inspectorHandle.attributes('tabindex')).toBe('0')

    // 右侧面板：← 加宽（手柄跟着方向键走）
    await inspectorHandle.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('[data-testid="pane-inspector"]').attributes('style')).toContain(
      'width: 436px',
    )

    // 双击复位回默认宽度
    await inspectorHandle.trigger('dblclick')
    expect(wrapper.get('[data-testid="pane-inspector"]').attributes('style')).toContain(
      'width: 420px',
    )
  })

  it('未安装的 agent：点整行 = 去安装，不去撞注定失败的启动', async () => {
    routes['agent.list-agents'] = () => ({
      agents: [
        { id: 'opencode', displayName: 'OpenCode', binary: 'opencode' },
        { id: 'gemini', displayName: 'Gemini CLI', binary: 'gemini' },
      ],
    })
    routes['agent.get-state'] = () => ({
      state: { clis: { opencode: { status: 'ok' }, gemini: { status: 'not-installed' } } },
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="run-agent-gemini"]').trigger('click')
    await flushPromises()

    expect(commandsTo('run.start')).toHaveLength(0)
    expect(pushMock).toHaveBeenCalledWith('/agents')
  })

  it('三栏宽度记在本 app 的 KV：进入时读回、调整后写回', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 挂载时按 key 读回上次布局（读不到就落回默认宽度）
    expect(storageGet).toHaveBeenCalledWith('project.workbench.runsWidth')
    expect(storageGet).toHaveBeenCalledWith('project.workbench.inspectorWidth')

    await wrapper.get('[data-testid="split-runs"]').trigger('keydown', { key: 'ArrowRight' })

    // 写入是防抖的（拖拽期间每帧写一次会打爆存储）
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(storageSet).toHaveBeenCalledWith('project.workbench.runsWidth', 272)
  })
})
