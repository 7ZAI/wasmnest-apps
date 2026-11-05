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
import { PROJECT_GIT_LIMIT } from '@/composables/useProjectGit'

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
      openTerminal,
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
  // clearAllMocks 只清调用记录，不清实现：storage 默认「读不到」每个用例都重设
  storageGet.mockImplementation(async () => undefined)
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
})
