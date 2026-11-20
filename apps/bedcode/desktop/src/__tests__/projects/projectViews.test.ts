/**
 * 项目列表页 / 项目工作台行为契约（ADR 0003 / issue #23 M2）
 *
 * 只断言外部行为：界面渲染出什么、点下去发了哪条命令（入参是什么）、
 * 失败路径给出什么提示。不测 DOM 结构快照，不测内部方法。
 *
 * 覆盖：
 * - 列表页：卡片（名称 / 环境徽标 / 活跃运行数 / 最近活动）、空态、
 *   新建后跳转工作台、目录为空不发命令、重命名与移除；
 * - 工作台：运行列表（标题 / agent / 状态）、终端主面把运行投影给终端组件、
 *   选 agent 启动（入参）、停止运行、项目不存在空态、无运行空态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { taskModalSessionId, taskModalVisible } from '@/state'

const { pushMock, toastSuccess, toastInfo, toastError, storageGet, storageSet, openTerminal } =
  vi.hoisted(() => ({
    pushMock: vi.fn(async () => {}),
    toastSuccess: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
    storageGet: vi.fn(async () => undefined),
    storageSet: vi.fn(async () => {}),
    openTerminal: vi.fn(async () => true),
  }))

// 两个视图都只用 useRouter / useRoute（无 router-link），桩掉即可；
// 断言「创建后跳转到工作台」靠 push 的入参。
//
// 用 reactive 复刻真实 `useRoute()` 语义：它注入的是 router 的**全局**响应式
// currentRoute（所有组件共享同一份），供「工作台实例被 KeepAlive 缓存后，
// 全局路由已切到别的项目」的回归用例改写参数。
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive({
    params: { id: 'p-1' } as Record<string, string>,
    path: '/projects/p-1',
    fullPath: '/projects/p-1',
  })
  return {
    useRouter: () => ({ push: pushMock, replace: pushMock }),
    useRoute: () => route,
    // 仅测试可见：真实 vue-router 无此导出
    __route: route,
  }
})

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, info: toastInfo, error: toastError },
}))

// 宿主平台事实：项目表单按平台过滤执行环境（Linux 只有 linux）
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }))

// 语法高亮有独立用例（projectFileViewer.test.ts）；这里桩掉，避免整个工作台
// 用例为一次 shiki wasm 初始化买单
vi.mock('@/utils/codeHighlight', () => ({
  highlightFileContent: async () => ({ status: 'unsupported' }),
}))

import * as routerMock from 'vue-router'
import ProjectListView from '@/views/projects/ProjectListView.vue'
import ProjectWorkbenchView from '@/views/projects/ProjectWorkbenchView.vue'
import { PROJECT_GIT_LIMIT } from '@/composables/useProjectGit'

/** 全局响应式路由桩（真实 vue-router 注入 currentRoute 的语义） */
const routeMock = (
  routerMock as unknown as {
    __route: { params: Record<string, string>; path: string; fullPath: string }
  }
).__route

/** 会话事件订阅（工作台 mounted 时挂上；回归用例需要主动模拟一次广播） */
const eventHandlers = new Map<string, Set<(payload?: unknown) => void>>()

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
    'project.file-tree': () => ({
      children: [
        { name: 'src', nodeType: 'folder', path: 'src' },
        { name: 'README.md', nodeType: 'file', path: 'README.md' },
      ],
    }),
    'project.file-content': () => ({ content: '# hello', fileName: 'README.md' }),
    'project.git-log': () => ({
      isGitRepo: true,
      currentBranch: 'dev',
      truncated: false,
      commits: [
        {
          hash: 'aaaaaaa1111',
          shortHash: 'aaaaaaa',
          parents: ['bbbbbbb2222'],
          author: 'Alice',
          email: 'alice@example.com',
          date: '2026-10-29T00:00:00+08:00',
          refs: ['HEAD -> dev'],
          subject: 'feat: 提交图',
        },
        {
          hash: 'bbbbbbb2222',
          shortHash: 'bbbbbbb',
          parents: [],
          author: 'Bob',
          email: 'bob@example.com',
          date: '2026-10-28T00:00:00+08:00',
          refs: ['tag: v0.1.0'],
          subject: 'chore: 首个提交',
        },
      ],
    }),
    'run.list': () => ({ runs: [runRecord('r-1', 'running', true)] }),
    'run.start': () => ({ runId: 'r-new', name: '支付重构', configId: 'cfg-1' }),
    // 运行内 agent 控制：默认给一条「可切」的画像（模型 + 思考等级）。
    // runId 回显请求值：拼屏时每格都取自己的清单，不能用固定 r-1 串味。
    'run.agent.options': (args: { runId?: string }) => ({
      runId: args?.runId ?? 'r-1',
      agent: 'pi',
      current: { model: 'amd/x', thinkingLevel: 'high' },
      models: [
        { value: 'amd/x', label: 'amd/x', source: 'current' },
        { value: 'amd/y', label: 'amd/y', source: 'catalog' },
      ],
      thinkingLevels: ['low', 'high'],
      capabilities: {
        model: { supported: true, channel: 'bridge', reason: null, message: null },
        thinking: { supported: true, channel: 'bridge', reason: null, message: null },
      },
    }),
    'run.agent.set': (args: { runId?: string; model?: string; thinkingLevel?: string }) => ({
      runId: args?.runId ?? 'r-1',
      applied: { model: args?.model, thinkingLevel: args?.thinkingLevel },
    }),
    'session.task.running-sessions': () => ({ sessions: [] }),
    'agent.list-agents': () => ({
      agents: [{ id: 'opencode', displayName: 'OpenCode', binary: 'opencode' }],
    }),
    'agent.get-state': () => ({ state: { clis: { opencode: { status: 'ok' } } } }),
    'agent.detect': () => ({}),
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
      openTerminal,
      closeTerminal: async () => {},
      isTerminalOpen: () => false,
    },
    storage: { get: storageGet, set: storageSet, delete: async () => {} },
    events: {
      on: (event: string, handler: (payload?: unknown) => void) => {
        let set = eventHandlers.get(event)
        if (!set) {
          set = new Set()
          eventHandlers.set(event, set)
        }
        set.add(handler)
        return { dispose: () => set!.delete(handler) }
      },
      emit: () => {},
    },
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
  // clearAllMocks 只清调用记录，不清实现：storage 默认「读不到」每个用例都重设
  storageGet.mockImplementation(async () => undefined)
  eventHandlers.clear()
  // 全局路由回到默认项目（用例可能改写它，模拟「切到别的项目」）
  routeMock.params.id = 'p-1'
  routeMock.path = '/projects/p-1'
  routeMock.fullPath = '/projects/p-1'
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

  it('终态运行不进运行列表：默认只把存活运行喂给终端组件', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-dead', 'error', false), runRecord('r-live', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 运行卡片与 agent CLI 同生命周期：CLI 已退出（error / stopped）的卡片不渲染
    const items = wrapper.findAll('[data-testid="run-item"]')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-status')).toBe('running')
    expect(wrapper.find('[data-testid="run-terminal-ended"]').exists()).toBe(false)
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe(
      'r-live',
    )
  })

  it('选中运行退出后：卡片消失，主面留在该运行并提示已结束', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="run-item"]')).toHaveLength(1)

    // 用户在 CLI 里 exit → 会话终态 → 刷新后卡片消失（不自动跳别的运行）
    routes['run.list'] = () => ({ runs: [runRecord('r-1', 'stopped', false)] })
    await wrapper.get('[data-testid="workbench-refresh"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="run-item"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="run-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-terminal"]').exists()).toBe(false)
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(false)
    expect(wrapper.get('[data-testid="run-terminal-ended"]').text()).toContain(
      'project.terminal.runEnded',
    )
  })

  it('无运行：给空态与引导，主面提示先选运行；变更页签提示先选运行', async () => {
    routes['run.list'] = () => ({ runs: [] })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.find('[data-testid="run-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workbench-empty"]').exists()).toBe(true)
    // 默认文件页签不受「有无运行」影响：项目目录树照常可见
    expect(wrapper.find('[data-testid="inspector-files"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="project-file-tree"]').exists()).toBe(true)

    await wrapper.get('[data-testid="inspector-tab-changes"]').trigger('click')
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

  it('纯终端：不运行任何 agent，run.start 的 agentId 为空', async () => {
    routes['run.list'] = () => ({ runs: [runRecord('r-new', 'running', true)] })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="run-terminal-option"]').trigger('click')
    await flushPromises()

    expect(commandsTo('run.start')[0][1]).toMatchObject({ projectId: 'p-1', agentId: '' })
    expect(wrapper.find('[data-testid="run-terminal-option"]').exists()).toBe(false)
    wrapper.unmount()
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

  it('检查器默认文件页签：读项目目录树；切到变更页签保留占位（终端/事件页签仍退役）', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 默认页签 = 文件：进工作台即按项目 id 读根目录
    expect(commandsTo('project.file-tree')[0][1]).toMatchObject({ projectId: 'p-1' })
    expect(wrapper.get('[data-testid="inspector-tab-files"]').attributes('aria-selected')).toBe(
      'true',
    )
    const nodes = wrapper.findAll('[data-testid="file-tree-item"]')
    expect(nodes.map((node) => node.text())).toEqual(['src', 'README.md'])

    // 变更页签仍只是占位；文件面板保活但不显示
    await wrapper.get('[data-testid="inspector-tab-changes"]').trigger('click')
    expect(wrapper.get('[data-testid="inspector-tab-changes"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(wrapper.find('[data-testid="inspector-changes"]').exists()).toBe(true)
    // v-show 保活：文件面板还在 DOM，但已隐藏（展开态不丢）
    expect(wrapper.get('[data-testid="inspector-files"]').attributes('style') ?? '').toContain(
      'display: none',
    )

    // 已退役的终端 / 事件页签不得复燃；Git 是文件旁的新提交图入口
    expect(wrapper.find('[data-testid="inspector-tab-terminal"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="inspector-tab-events"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="inspector-tab-git"]').exists()).toBe(true)
    // Git 页签未打开：不该触发一次 git 进程
    expect(commandsTo('project.git-log')).toHaveLength(0)
    // 终端主面不受影响：仍渲染选中的运行
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-1')
  })

  it('主视图：默认终端，可切到工程文件；选择按项目记在 KV 并卸载终端', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    const switchGroup = wrapper.get('[data-testid="main-view-switch"]')
    expect(switchGroup.attributes('role')).toBe('tablist')
    expect(wrapper.get('[data-testid="main-view-terminal"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(wrapper.get('[data-testid="main-view-terminal"]').attributes('tabindex')).toBe('0')
    expect(wrapper.get('[data-testid="main-view-files"]').attributes('aria-selected')).toBe('false')
    expect(wrapper.find('[data-testid="main-panel-terminal"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="main-panel-files"]').attributes('style') ?? '').toContain(
      'display: none',
    )
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(true)

    await wrapper.get('[data-testid="main-view-files"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="main-view-files"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="main-panel-files"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="main-panel-terminal"]').exists()).toBe(false)
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(false)
    expect(storageSet).toHaveBeenCalledWith('project.workbench.mainView.p-1', 'files')

    await wrapper.get('[data-testid="main-view-files"]').trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()

    expect(wrapper.get('[data-testid="main-view-terminal"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(wrapper.get('[data-testid="main-panel-files"]').attributes('style') ?? '').toContain(
      'display: none',
    )
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(true)
  })

  it('工程文件：左树打开多个只读标签，重复打开复用，关闭后切到相邻标签', async () => {
    routes['project.file-tree'] = (args: any) =>
      args.dirPath === 'src'
        ? { children: [{ name: 'main.ts', nodeType: 'file', path: 'src/main.ts' }] }
        : {
            children: [
              { name: 'src', nodeType: 'folder', path: 'src' },
              { name: 'README.md', nodeType: 'file', path: 'README.md' },
            ],
          }
    routes['project.file-content'] = (args: any) => ({
      content: `// ${args.filePath}`,
      fileName: args.filePath.split('/').pop(),
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="main-view-files"]').trigger('click')
    await flushPromises()

    const workspace = wrapper.get('[data-testid="project-files-workspace"]')
    expect(workspace.isVisible()).toBe(true)
    expect(workspace.find('[data-testid="project-files-empty"]').exists()).toBe(true)

    const treeNode = (path: string) =>
      workspace
        .findAll('[data-testid="file-tree-item"]')
        .find((node) => node.attributes('data-path') === path)!

    await treeNode('src').trigger('click')
    await flushPromises()
    await treeNode('src/main.ts').trigger('click')
    await flushPromises()
    await treeNode('README.md').trigger('click')
    await flushPromises()

    expect(commandsTo('project.file-content').map((call) => call[1].filePath)).toEqual([
      'src/main.ts',
      'README.md',
    ])
    let tabs = wrapper.findAll('[data-testid="file-tab"]')
    expect(tabs.map((tab) => tab.attributes('data-path'))).toEqual(['src/main.ts', 'README.md'])
    expect(tabs[1].attributes('aria-selected')).toBe('true')

    const panels = wrapper.findAll('[data-testid="file-tab-panel"]')
    expect(panels[0].attributes('hidden')).toBe('')
    expect(panels[1].attributes('hidden')).toBeUndefined()
    expect(panels[1].get('[data-testid="project-file-tab-content"]').text()).toContain(
      '// README.md',
    )

    await treeNode('README.md').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="file-tab"]')).toHaveLength(2)
    expect(commandsTo('project.file-content')).toHaveLength(2)

    await wrapper.findAll('[data-testid="file-tab"]')[1].trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    tabs = wrapper.findAll('[data-testid="file-tab"]')
    expect(tabs[0].attributes('aria-selected')).toBe('true')

    await tabs[0].get('[data-testid="file-tab-close"]').trigger('click')
    await flushPromises()
    tabs = wrapper.findAll('[data-testid="file-tab"]')
    expect(tabs.map((tab) => tab.attributes('data-path'))).toEqual(['README.md'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
  })

  it('主视图偏好从 KV 读回 files：首屏直接进工程文件；读取失败显性给重试', async () => {
    storageGet.mockImplementation(async (key: string) =>
      key === 'project.workbench.mainView.p-1' ? 'files' : undefined,
    )
    routes['project.file-content'] = () => {
      throw new Error('read failed')
    }

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.get('[data-testid="main-view-files"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="main-panel-files"]').isVisible()).toBe(true)
    expect(wrapper.findComponent(TerminalStub).exists()).toBe(false)

    const workspace = wrapper.get('[data-testid="project-files-workspace"]')
    await workspace.findAll('[data-testid="file-tree-item"]')[1].trigger('click')
    await flushPromises()

    expect(commandsTo('project.file-content')).toHaveLength(1)
    expect(wrapper.find('[data-testid="project-file-tab-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="project-file-tab-retry"]').exists()).toBe(true)
  })

  it('Git 页签：打开才读提交图（项目 id + 上限），渲染分支 / 提交行 / 引用徽标', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="inspector-tab-git"]').trigger('click')
    await flushPromises()

    expect(commandsTo('project.git-log')[0][1]).toEqual({
      projectId: 'p-1',
      limit: PROJECT_GIT_LIMIT,
    })
    // 文件面板保活但不显示；Git 面板显示
    expect(wrapper.get('[data-testid="inspector-files"]').attributes('style') ?? '').toContain(
      'display: none',
    )
    expect(wrapper.get('[data-testid="inspector-git"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="git-branch"]').text()).toBe('dev')

    const rows = wrapper.findAll('[data-testid="git-commit-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('data-lane')).toBe('0')
    expect(rows[0].text()).toContain('dev')
    expect(rows[0].text()).toContain('feat: 提交图')
    expect(rows[0].text()).toContain('aaaaaaa')
    expect(rows[0].text()).toContain('Alice')
    expect(rows[1].text()).toContain('v0.1.0')

    // 再切走再回来：已加载不重取（滚动位置与数据都保活）
    await wrapper.get('[data-testid="inspector-tab-files"]').trigger('click')
    await wrapper.get('[data-testid="inspector-tab-git"]').trigger('click')
    await flushPromises()
    expect(commandsTo('project.git-log')).toHaveLength(1)
  })

  it('Git 页签：非仓库给引导空态；刷新按钮 force 重新取数', async () => {
    routes['project.git-log'] = () => ({
      isGitRepo: false,
      currentBranch: null,
      commits: [],
      truncated: false,
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="inspector-tab-git"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="git-not-repo"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="git-commit-row"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="git-error"]').exists()).toBe(false)

    // 刷新是显式重取（空态也要能重新探测「是否已初始化仓库」）
    await wrapper.get('[data-testid="git-refresh"]').trigger('click')
    await flushPromises()
    expect(commandsTo('project.git-log')).toHaveLength(2)
  })

  it('文件树：展开目录按 dirPath 懒加载；点文件打开只读查看器并按路径取内容', async () => {
    routes['project.file-tree'] = (args: any) =>
      args.dirPath === 'src'
        ? { children: [{ name: 'main.ts', nodeType: 'file', path: 'src/main.ts' }] }
        : { children: [{ name: 'src', nodeType: 'folder', path: 'src' }] }
    routes['project.file-content'] = () => ({
      content: 'console.log("hi")',
      fileName: 'main.ts',
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    const folder = wrapper.findAll('[data-testid="file-tree-item"]')[0]
    await folder.trigger('click')
    await flushPromises()

    expect(commandsTo('project.file-tree')[1][1]).toMatchObject({
      projectId: 'p-1',
      dirPath: 'src',
    })
    const items = wrapper.findAll('[data-testid="file-tree-item"]')
    expect(items.map((node) => node.text())).toEqual(['src', 'main.ts'])

    await items[1].trigger('click')
    await flushPromises()

    expect(commandsTo('project.file-content')[0][1]).toEqual({
      projectId: 'p-1',
      filePath: 'src/main.ts',
    })
    expect(wrapper.get('[data-testid="project-file-viewer-name"]').text()).toBe('main.ts')
    const viewer = wrapper.get('[data-testid="project-file-viewer"]')
    expect(viewer.text()).toContain('console.log("hi")')
  })

  it('右栏页签偏好从 KV 读回：上次停在变更就不读文件树（避免多余授权）', async () => {
    storageGet.mockImplementation(async (key: string) =>
      key === 'project.workbench.inspectorTab' ? 'changes' : undefined,
    )

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(storageGet).toHaveBeenCalledWith('project.workbench.inspectorTab')
    expect(wrapper.get('[data-testid="inspector-tab-changes"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(commandsTo('project.file-tree')).toHaveLength(0)

    // 用户主动切到文件页签才取数
    await wrapper.get('[data-testid="inspector-tab-files"]').trigger('click')
    await flushPromises()
    expect(commandsTo('project.file-tree')).toHaveLength(1)
    expect(storageSet).toHaveBeenCalledWith('project.workbench.inspectorTab', 'files')
  })

  it('右栏页签偏好读回 git：直接读提交图，不读文件树', async () => {
    storageGet.mockImplementation(async (key: string) =>
      key === 'project.workbench.inspectorTab' ? 'git' : undefined,
    )

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.get('[data-testid="inspector-tab-git"]').attributes('aria-selected')).toBe(
      'true',
    )
    expect(commandsTo('project.file-tree')).toHaveLength(0)
    expect(commandsTo('project.git-log')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="git-commit-row"]')).toHaveLength(2)
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

  it('只列探测确认已安装的 agent：未安装 / 无结论不进入启动清单', async () => {
    routes['agent.list-agents'] = () => ({
      agents: [
        { id: 'opencode', displayName: 'OpenCode', binary: 'opencode' },
        { id: 'gemini', displayName: 'Gemini CLI', binary: 'gemini' },
        { id: 'pi', displayName: 'Pi', binary: 'pi' },
      ],
    })
    routes['agent.get-state'] = () => ({
      state: {
        clis: {
          opencode: { status: 'ok' },
          gemini: { status: 'not-installed' },
          pi: { status: 'unknown' },
        },
      },
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="run-agent-opencode"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-agent-gemini"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="run-agent-pi"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="run-terminal-option"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('没有已安装 agent：空态给安装入口，终端仍可直接启动', async () => {
    routes['agent.list-agents'] = () => ({
      agents: [{ id: 'gemini', displayName: 'Gemini CLI', binary: 'gemini' }],
    })
    routes['agent.get-state'] = () => ({
      state: { clis: { gemini: { status: 'not-installed' } } },
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="run-agent-gemini"]').exists()).toBe(false)
    const install = wrapper.find('[data-testid="run-agent-install"]')
    expect(install.exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-terminal-option"]').exists()).toBe(true)

    await install.trigger('click')
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/agents')
    wrapper.unmount()
  })

  it('探测从未跑过（全 idle）：自动发起探测，事件回流后就地补出已装项', async () => {
    routes['agent.list-agents'] = () => ({
      agents: [{ id: 'opencode', displayName: 'OpenCode', binary: 'opencode' }],
    })
    routes['agent.get-state'] = () => ({ state: { clis: { opencode: { status: 'idle' } } } })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.find('[data-testid="run-new"]').trigger('click')
    await flushPromises()

    // 不能把「没检测过」定格成「没安装」
    expect(commandsTo('agent.detect')).toHaveLength(1)
    expect(wrapper.find('[data-testid="run-agent-opencode"]').exists()).toBe(false)

    for (const handler of eventHandlers.get('plugin:bedcode:detection') ?? []) {
      handler({ clis: { opencode: { status: 'ok' } }, seq: 2 })
    }
    await flushPromises()

    expect(wrapper.find('[data-testid="run-agent-opencode"]').exists()).toBe(true)
    wrapper.unmount()
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

  it('两侧面板可折叠：收起后不渲染面板与手柄，窄轨常驻且带 aria-expanded', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 展开态：面板 + 手柄都在，收起按钮报告 expanded
    expect(wrapper.find('[data-testid="pane-runs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="split-runs"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="run-collapse"]').attributes('aria-expanded')).toBe('true')

    // 收起运行列表：面板与手柄一起消失（手柄留着就是可拖的死区），窄轨接位
    await wrapper.get('[data-testid="run-collapse"]').trigger('click')
    expect(wrapper.find('[data-testid="pane-runs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="split-runs"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="pane-runs-rail"]').attributes('style')).toContain(
      'width: 36px',
    )
    expect(wrapper.get('[data-testid="run-collapse"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[data-testid="run-collapse"]').attributes('aria-controls')).toBe(
      'wb-pane-runs',
    )
    expect(storageSet).toHaveBeenCalledWith('project.workbench.runsCollapsed', true)

    // 再点同一个入口展开（窄轨是常态入口，不靠悬停出现）
    await wrapper.get('[data-testid="run-collapse"]').trigger('click')
    expect(wrapper.find('[data-testid="pane-runs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pane-runs-rail"]').exists()).toBe(false)
    expect(storageSet).toHaveBeenCalledWith('project.workbench.runsCollapsed', false)

    // 右侧同理：收起后终端只与两端窄轨/窗口边相邻
    await wrapper.get('[data-testid="inspector-collapse"]').trigger('click')
    expect(wrapper.find('[data-testid="pane-inspector"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="split-inspector"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pane-inspector-rail"]').exists()).toBe(true)
    expect(storageSet).toHaveBeenCalledWith('project.workbench.inspectorCollapsed', true)
  })

  it('折叠状态从 KV 读回：进页面即收起，不先闪一下展开态', async () => {
    storageGet.mockImplementation(async (key: string) =>
      key === 'project.workbench.inspectorCollapsed' ? true : undefined,
    )

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(storageGet).toHaveBeenCalledWith('project.workbench.inspectorCollapsed')
    expect(wrapper.find('[data-testid="pane-inspector"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pane-inspector-rail"]').exists()).toBe(true)
    // 另一侧不受牵连
    expect(wrapper.find('[data-testid="pane-runs"]').exists()).toBe(true)
  })

  it('收起一侧后另一侧上限按窄轨重算：能拖到比原上限更宽', async () => {
    // 容器宽度走 ResizeObserver 实测：桩成固定 1200px，两侧上限才是确定的数
    const observers: ((entries: { contentRect: { width: number } }[]) => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly callback: (entries: any[]) => void
        constructor(callback: (entries: any[]) => void) {
          this.callback = callback
          observers.push(callback)
        }
        observe(): void {
          this.callback([{ contentRect: { width: 1200 } }])
        }
        disconnect(): void {}
      },
    )

    try {
      const wrapper = mountView(ProjectWorkbenchView)
      await flushPromises()
      expect(observers.length).toBeGreaterThan(0)

      // 挂载期间组件会先用 el.clientWidth（happy-dom 为 0）覆盖一次，所以量宽回调
      // 要在那之后手动喂一次 1200px；clientWidth 同步设为同一值，避免回落
      const layout = wrapper.get('[data-testid="workbench-layout"]').element as HTMLElement
      Object.defineProperty(layout, 'clientWidth', { configurable: true, value: 1200 })
      for (const callback of observers) callback([{ contentRect: { width: 1200 } }])
      await flushPromises()

      const inspectorWidth = () =>
        Number(
          /width: (\d+)px/.exec(
            wrapper.get('[data-testid="pane-inspector"]').attributes('style') ?? '',
          )?.[1],
        )
      const pushWide = async () => {
        const handle = wrapper.get('[data-testid="split-inspector"]')
        for (let i = 0; i < 40; i += 1) {
          await handle.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
        }
      }

      // 1200 − 运行列表 256 − 终端最小 320 − 两只手柄 12 → 检查器最多 612
      await pushWide()
      expect(inspectorWidth()).toBe(612)

      // 收起运行列表（只占 36px 窄轨、也不再占手柄）→ 上限放宽到 838
      await wrapper.get('[data-testid="run-collapse"]').trigger('click')
      await pushWide()
      expect(inspectorWidth()).toBe(1200 - 36 - 320 - 6)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // ==================== 拼屏（多终端同屏，2026-11-05 用户裁决「按推荐」） ====================

  it('拼屏默认关闭：终端主面仍是单屏，开关 aria-pressed=false', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    const toggle = wrapper.get('[data-testid="run-tile-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[data-testid="run-terminal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-tiles"]').exists()).toBe(false)
  })

  it('拼屏：两条存活运行各一格，点格子换焦点，格子可独立开窗', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'running', true), runRecord('r-2', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="run-tile-toggle"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="run-terminal"]').exists()).toBe(false)
    const tiles = wrapper.findAll('[data-testid="run-tile"]')
    expect(tiles).toHaveLength(2)
    expect(tiles.map((tile) => tile.attributes('data-run-id'))).toEqual(['r-1', 'r-2'])
    // 每格一条真实 PTY：终端组件收到的是各自的运行投影
    expect(
      wrapper
        .findAllComponents(TerminalStub)
        .map((stub) => (stub.props('session') as { id: string }).id),
    ).toEqual(['r-1', 'r-2'])
    expect(tiles[0].attributes('data-active')).toBe('true')
    expect(tiles[1].attributes('data-active')).toBe('false')

    // 点第二格：焦点跟随（始终只有一格 active）
    await tiles[1].trigger('mousedown')
    await flushPromises()
    const after = wrapper.findAll('[data-testid="run-tile"]')
    expect(after[1].attributes('data-active')).toBe('true')
    expect(after[0].attributes('data-active')).toBe('false')

    // 格子自己的开窗按钮：开的是这一格的运行，不是当前焦点
    await after[0].get('[data-testid="run-tile-open"]').trigger('click')
    await flushPromises()
    expect(openTerminal).toHaveBeenCalledWith({ id: 'r-1', name: '支付重构' })
  })

  it('拼屏后运行控制下放到各格 header：主 header 不再显示焦点运行的模型 / 停止', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'running', true), runRecord('r-2', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 单屏：运行控制属于当前运行，挂在全局 header
    expect(wrapper.find('[data-testid="agent-model-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-stop"]').exists()).toBe(true)

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    // 拼屏：全局 header 只留全局动作；每条运行的模型 / 停止 / 开窗进各自格子
    expect(wrapper.find('[data-testid="agent-model-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="terminal-stop"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="run-open-window"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="terminal-tile-summary"]').text()).toContain(
      'project.terminal.tileMode',
    )
    const tiles = wrapper.findAll('[data-testid="run-tile"]')
    expect(tiles).toHaveLength(2)
    for (const tile of tiles) {
      expect(tile.find('[data-testid="run-tile-model"]').exists()).toBe(true)
      expect(tile.find('[data-testid="run-tile-thinking"]').exists()).toBe(true)
      expect(tile.find('[data-testid="run-tile-stop"]').exists()).toBe(true)
      expect(tile.find('[data-testid="run-tile-open"]').exists()).toBe(true)
    }
  })

  it('拼屏：每格模型下拉切的是该格运行，不是当前焦点运行', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'running', true), runRecord('r-2', 'running', true)],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    const models = wrapper
      .findAll('[data-testid="run-tile"]')
      .map((tile) => tile.get('[data-testid="run-tile-model"]'))
    expect(models).toHaveLength(2)
    expect(models.map((select) => (select.element as HTMLSelectElement).value)).toEqual([
      'amd/x',
      'amd/x',
    ])

    // 焦点仍在 r-1（第一格）；改第二格的模型必须落到 r-2
    await models[1].setValue('amd/y')
    await flushPromises()
    expect(commandsTo('run.agent.set')[0][1]).toEqual({ runId: 'r-2', model: 'amd/y' })
  })

  it('拼屏：任务入口按每格自己的 is_supported 显示', async () => {
    routes['run.list'] = () => ({
      runs: [runRecord('r-1', 'running', true), runRecord('r-2', 'running', true)],
    })
    routes['session.task.running-sessions'] = () => ({
      sessions: [{ session_id: 'r-2', is_supported: true }],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    const tiles = wrapper.findAll('[data-testid="run-tile"]')
    expect(tiles[0].find('[data-testid="run-tile-task"]').exists()).toBe(false)
    expect(tiles[1].find('[data-testid="run-tile-task"]').exists()).toBe(true)

    await tiles[1].get('[data-testid="run-tile-task"]').trigger('click')
    await flushPromises()
    expect(taskModalVisible.value).toBe(true)
    expect(taskModalSessionId.value).toBe('r-2')
    taskModalVisible.value = false
  })

  it('拼屏只铺存活运行：stopped / error 不进网格', async () => {
    routes['run.list'] = () => ({
      runs: [
        runRecord('r-1', 'running', true),
        runRecord('r-2', 'stopped', false),
        runRecord('r-3', 'error', false),
      ],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    const tiles = wrapper.findAll('[data-testid="run-tile"]')
    expect(tiles).toHaveLength(1)
    expect(tiles[0].attributes('data-run-id')).toBe('r-1')
  })

  it('拼屏：没有存活运行时给空态，不渲染空网格', async () => {
    routes['run.list'] = () => ({ runs: [runRecord('r-1', 'stopped', false)] })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="run-tiles-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-tile-grid"]').exists()).toBe(false)
  })

  it('拼屏：超过 4 条存活运行只铺 4 格并提示剩余数，点左栏可换入', async () => {
    routes['run.list'] = () => ({
      runs: ['r-1', 'r-2', 'r-3', 'r-4', 'r-5'].map((id) => runRecord(id, 'running', true)),
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="run-tile"]')).toHaveLength(4)
    expect(wrapper.get('[data-testid="run-tiles-hint"]').text()).toContain(
      'project.terminal.tileHidden(n=1)',
    )

    // 第 5 条点左栏：顶进可见区，挤掉列表末尾
    await wrapper.findAll('[data-testid="run-item"]')[4].trigger('click')
    await flushPromises()
    const ids = wrapper
      .findAll('[data-testid="run-tile"]')
      .map((tile) => tile.attributes('data-run-id'))
    expect(ids).toEqual(['r-5', 'r-1', 'r-2', 'r-3'])
    // 仍有 5 条存活、只铺 4 格：提示保持（换入的是 r-4 的位置，不是消灭未铺项）
    expect(wrapper.get('[data-testid="run-tiles-hint"]').text()).toContain(
      'project.terminal.tileHidden(n=1)',
    )
  })

  it('拼屏模式按项目持久化：切换写入，重进读回', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    expect(storageSet).toHaveBeenCalledWith('project.workbench.tileMode.p-1', true)

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    expect(storageSet).toHaveBeenCalledWith('project.workbench.tileMode.p-1', false)

    // 重进：存储里是 true 时直接落拼屏
    storageGet.mockImplementation(async (key: string) =>
      key === 'project.workbench.tileMode.p-1' ? true : undefined,
    )
    const reopened = mountView(ProjectWorkbenchView)
    await flushPromises()
    expect(reopened.get('[data-testid="run-tile-toggle"]').attributes('aria-pressed')).toBe('true')
    expect(reopened.findAll('[data-testid="run-tile"]')).toHaveLength(1)
  })

  it('终端 header 的模型 / 思考等级下拉：取 options 后按当前值渲染，切换走 run.agent.set', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(commandsTo('run.agent.options')[0][1]).toEqual({ runId: 'r-1' })

    const modelSelect = wrapper.get('[data-testid="agent-model-select"]')
    expect((modelSelect.element as HTMLSelectElement).value).toBe('amd/x')
    const thinkingSelect = wrapper.get('[data-testid="agent-thinking-select"]')
    expect((thinkingSelect.element as HTMLSelectElement).value).toBe('high')
    expect(thinkingSelect.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'low',
      'high',
    ])

    await modelSelect.setValue('amd/y')
    await flushPromises()
    expect(commandsTo('run.agent.set')[0][1]).toEqual({ runId: 'r-1', model: 'amd/y' })

    await thinkingSelect.setValue('low')
    await flushPromises()
    expect(commandsTo('run.agent.set')[1][1]).toEqual({ runId: 'r-1', thinkingLevel: 'low' })
  })

  it('能力不可用时下拉禁用，并把结构化 reason 放进 title（不静默隐藏）', async () => {
    routes['run.agent.options'] = () => ({
      runId: 'r-1',
      agent: 'codex',
      current: { model: 'gpt-6-astra', thinkingLevel: null },
      models: [{ value: 'gpt-6-astra', label: 'gpt-6-astra', source: 'current' }],
      thinkingLevels: ['low', 'high'],
      capabilities: {
        model: {
          supported: false,
          channel: 'pty',
          reason: 'codex-update-required',
          message: 'codex 0.164+ is required',
        },
        thinking: {
          supported: false,
          channel: 'pty',
          reason: 'codex-update-required',
          message: 'codex 0.164+ is required',
        },
      },
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    const modelSelect = wrapper.get('[data-testid="agent-model-select"]')
    expect(modelSelect.attributes('disabled')).toBeDefined()
    expect(modelSelect.attributes('title')).toBe('project.agent.reason.codexUpdateRequired')
    expect(
      wrapper.get('[data-testid="agent-thinking-select"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('task 队列入口：判据取后端 is_supported；点击把当前运行注入共享弹窗', async () => {
    routes['session.task.running-sessions'] = () => ({
      sessions: [{ session_id: 'r-1', is_supported: true }],
    })
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    const entry = wrapper.get('[data-testid="terminal-task-queue"]')
    await entry.trigger('click')
    await flushPromises()

    expect(taskModalVisible.value).toBe(true)
    expect(taskModalSessionId.value).toBe('r-1')
    taskModalVisible.value = false
  })

  it('header 的停止按钮：直接走 session.close（与左栏停止同一编排）', async () => {
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    await wrapper.get('[data-testid="terminal-stop"]').trigger('click')
    await flushPromises()

    expect(commandsTo('session.close')[0][1]).toEqual({ sessionId: 'r-1' })
  })

  // ==================== 跨项目隔离（KeepAlive 缓存下的实例归属） ====================

  /**
   * 回归：两个项目的终端显示一模一样
   *
   * 复现条件（真实链路）：AppLayout 用 KeepAlive 按 fullPath 缓存工作台，切到
   * 另一个项目只 deactivate、实例仍活着且订阅着全局会话事件；而 `useRoute()`
   * 注入的是**全局**响应式 currentRoute。若 projectId 实时读路由，切走后它已
   * 变成新项目 —— 新项目里创建会话触发 `session:created` 时，被缓存的旧实例
   * 会拿新项目 id 刷新自己，project / runs 被整体覆盖，回到旧项目时两个项目
   * 看到同一份运行与同一个终端。
   */
  it('被缓存的工作台只按自己的项目刷新：全局路由已切到别的项目也不串数据', async () => {
    routes['project.get'] = (args: { id: string }) =>
      args.id === 'p-2' ? projectRecord('p-2', '另一个项目') : projectRecord('p-1', '支付重构')
    routes['run.list'] = (args: { projectId: string }) =>
      args.projectId === 'p-2'
        ? { runs: [{ ...runRecord('r-p2', 'running', true), projectId: 'p-2' }] }
        : { runs: [runRecord('r-1', 'running', true)] }

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    expect(wrapper.text()).toContain('支付重构')

    // 用户进入另一个项目：本实例被缓存（不卸载），全局路由已变成 p-2
    routeMock.params.id = 'p-2'
    routeMock.path = '/projects/p-2'
    routeMock.fullPath = '/projects/p-2'

    // p-2 里新建运行 → 会话事件广播到所有存活实例（含本实例）
    for (const handler of eventHandlers.get('session:created') ?? []) handler({})
    await flushPromises()

    // 不得用别的项目 id 取数，画面仍是自己的项目与运行（终端不切到别人的运行）
    expect(commandsTo('project.get').filter((call) => call[1]?.id === 'p-2')).toHaveLength(0)
    expect(commandsTo('run.list').filter((call) => call[1]?.projectId === 'p-2')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('另一个项目')
    expect((wrapper.findComponent(TerminalStub).props('session') as { id: string }).id).toBe('r-1')
  })

  // ==================== 跨项目拼屏（多项目并线，2026-11-13） ====================

  /** 跨项目取数桩：不带 projectId = 全部项目（p-2 一条在前，p-1 一条；最新在前） */
  function crossProjectRoutes(): void {
    routes['project.list'] = () => ({
      projects: [projectRecord('p-1', '支付重构'), projectRecord('p-2', '另一个项目')],
    })
    routes['run.list'] = (args: { projectId?: string }) => {
      if (args?.projectId === 'p-2') {
        return { runs: [{ ...runRecord('r-p2', 'running', true), projectId: 'p-2' }] }
      }
      if (args?.projectId === 'p-1') return { runs: [runRecord('r-1', 'running', true)] }
      return {
        runs: [
          { ...runRecord('r-p2', 'running', true), projectId: 'p-2' },
          runRecord('r-1', 'running', true),
        ],
      }
    }
  }

  /** 最后一次某命令的入参（跨项目用例要断言「取数范围」而不是次数） */
  function lastArgs(id: string): unknown {
    const calls = commandsTo(id)
    return calls[calls.length - 1]?.[1]
  }

  it('跨项目拼屏：切「全部项目」后按无 projectId 取全量，运行行与格子标项目名', async () => {
    crossProjectRoutes()
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    // 单屏没有范围控件（单屏恒为本项目），首帧只取本项目
    expect(wrapper.find('[data-testid="run-tile-scope"]').exists()).toBe(false)
    expect(lastArgs('run.list')).toEqual({ projectId: 'p-1' })

    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    // 拼屏默认仍为本项目：不标项目名
    expect(wrapper.findAll('[data-testid="run-item-project"]')).toHaveLength(0)

    await wrapper.get('[data-testid="run-scope-all"]').trigger('click')
    await flushPromises()

    // 全量取数 = run.list 不带 projectId；项目名映射同时取回
    expect(lastArgs('run.list')).toEqual({})
    expect(commandsTo('project.list').length).toBeGreaterThan(0)

    // 左栏：两个项目的运行都在，且各标归属
    const items = wrapper.findAll('[data-testid="run-item"]')
    expect(items).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="run-item-project"]').map((node) => node.text())).toEqual([
      '另一个项目',
      '支付重构',
    ])

    // 拼屏：两格并线（各自一条真实运行），格子标题也标归属
    const tiles = wrapper.findAll('[data-testid="run-tile"]')
    expect(tiles).toHaveLength(2)
    expect(
      new Set(tiles.map((tile) => tile.get('[data-testid="run-tile-project"]').text())),
    ).toEqual(new Set(['支付重构', '另一个项目']))
  })

  it('跨项目拼屏：停止别的项目的运行后按全量范围刷新（列表不被打回本项目）', async () => {
    crossProjectRoutes()
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="run-scope-all"]').trigger('click')
    await flushPromises()

    const foreign = wrapper
      .findAll('[data-testid="run-item"]')
      .find((item) => item.text().includes('另一个项目'))
    expect(foreign).toBeTruthy()
    await foreign!.get('[data-testid="run-stop"]').trigger('click')
    await flushPromises()

    // 停的是归属 p-2 的运行；刷新仍按全量，当前项目统计只刷本项目
    expect(commandsTo('session.close')[0][1]).toEqual({ sessionId: 'r-p2' })
    expect(lastArgs('run.list')).toEqual({})
    expect(lastArgs('project.get')).toEqual({ id: 'p-1' })
  })

  it('跨项目拼屏：切回「本项目」后按 projectId 重新取数，项目标注消失', async () => {
    crossProjectRoutes()
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="run-scope-all"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="run-scope-project"]').trigger('click')
    await flushPromises()

    expect(lastArgs('run.list')).toEqual({ projectId: 'p-1' })
    expect(wrapper.findAll('[data-testid="run-item"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="run-item-project"]')).toHaveLength(0)
  })

  it('跨项目拼屏：范围按项目持久化，关掉拼屏回到本项目取数', async () => {
    crossProjectRoutes()
    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="run-scope-all"]').trigger('click')
    await flushPromises()

    expect(storageSet).toHaveBeenCalledWith('project.workbench.tileScope.p-1', 'all')

    // 关掉拼屏：范围控件消失，运行列表回到本项目（跨项目标注一并消失）
    await wrapper.get('[data-testid="run-tile-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="run-tile-scope"]').exists()).toBe(false)
    expect(lastArgs('run.list')).toEqual({ projectId: 'p-1' })
    expect(wrapper.findAll('[data-testid="run-item"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="run-item-project"]')).toHaveLength(0)
  })

  it('跨项目拼屏：范围偏好重进读回（存储 all + 拼屏 on → 直接铺全量）', async () => {
    crossProjectRoutes()
    storageGet.mockImplementation(async (key: string) => {
      if (key === 'project.workbench.tileMode.p-1') return true
      if (key === 'project.workbench.tileScope.p-1') return 'all'
      return undefined
    })

    const wrapper = mountView(ProjectWorkbenchView)
    await flushPromises()

    expect(wrapper.get('[data-testid="run-tile-toggle"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="run-scope-all"]').attributes('aria-pressed')).toBe('true')
    expect(lastArgs('run.list')).toEqual({})
    expect(wrapper.findAll('[data-testid="run-tile"]')).toHaveLength(2)
  })
})
