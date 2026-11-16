/**
 * 任务页三页签（预设任务 / 定时任务 / 任务记录）行为契约测试
 * （2026-10-16：工具箱改名「任务」+ 还原预设任务页签）
 *
 * 被测：`src/task/components/AutoTaskToolboxView.vue`（页签容器 + 面板停靠）
 * 与 `src/task/components/PresetTasksTab.vue`（预设任务页签的列表与执行分流）。
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-TT1 | 需求「tabs 顺序为 预设/定时/记录」 | tabs 数组即视觉顺序 | 三个页签按钮按此顺序渲染 |
 * | C-TT2 | 需求「增加 tabs 预设任务」 | 首屏落在预设任务页签 | 第 1 个按钮为激活态，且第 1 个面板为 --active |
 * | C-TT3 | `panelClass(index)` 分支 | 当前页居中、已过页停左、未到页停右 | 切到第 2 页签后三面板停靠态各归其位 |
 * | C-TT4 | 需求「还原原本的预设任务页面」 | 卡片取 SDK `getPresetTasks()` 真源渲染 | 每条任务渲染一行，行内含任务正文 |
 * | C-TT5 | 需求「还原功能」 | 无任务时给空态而非空白页 | 渲染 preset.noTasks |
 * | C-TT6 | `startExecuteFlow` 反例分支 | 未连接时不得执行 | 发 warning toast 且向 app 域发 open-connection，不调 executeTask |
 * | C-TT8 | 需求「预设任务不弹窗，直接显示在 tabs 页面上」 | 编辑表单（textarea + 添加/保存）常驻页签面板顶部，不走 TaskEditDialog 弹窗 | 挂载即渲染内联表单；输入内容点「添加」经 addTask 落库并清空；点卡片编辑载入任务内容并切按钮为「保存」 |
 *
 * 面板下标与 tabs 下标一一对应（`panelClass` 直接吃下标）：少补一个面板不会抛错，
 * 但会让页签切换时高亮落到别的面板上——故 C-TT3 断言的是三个面板各自的停靠类，
 * 而不是「至少有一个 active」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
/** 预设任务真源替身（2026-11-16 下沉后替换应用 store 模块，不再走宿主共享模块） */
const presetMock = vi.hoisted(() => ({ store: null as any }))
vi.mock('../presetApi', () => ({
  usePresetTasks: () => presetMock.store,
  bindPresetTasks: () => {},
  unbindPresetTasks: () => {},
}))

import AutoTaskToolboxView from '../components/AutoTaskToolboxView.vue'
import type { PresetTask } from '../../terminal/model'
import {
  installMockMobileApi,
  uninstallMockMobileApi,
  installFakeHost,
  uninstallFakeHost,
} from '../../terminal/__tests__/testKit'

/** 任务 i18n 文案表（与 `../i18n` 同步：域内相对键 → 中文） */
const ZH: Record<string, string> = {
  'tasks.tabs.preset': '预设任务',
  'tasks.tabs.scheduled': '定时任务',
  'tasks.tabs.history': '任务记录',
  'preset.noTasks': '暂无预设任务',
  'preset.emptyHint': '保存常用指令，一键发送到终端',
  'preset.noActiveSessions': '暂无运行中的会话',
  'preset.connectFirst': '请先连接桌面端',
  'preset.confirmExecute': '确认执行',
  'preset.execute': '执行',
  'preset.selectTarget': '选择执行目标',
  'preset.selectTargetHint': '选一个运行中的会话，或为该预设启动新会话',
  'preset.startNewSession': '启动新会话并执行',
  'preset.startNewSessionNeedsTarget': '该预设未绑定项目 / Agent，无法启动新会话',
  'preset.startNewSessionLocked': '该预设正在执行，不能再入队',
  'preset.startAndExecute': '启动并执行',
  'preset.willStartNewSession': '将启动新会话并把指令入队，由任务调度自动下发',
  'preset.willSendToTerminal': '指令将发送到所选会话的终端',
  'preset.sentToTerminal': '已发送到终端',
  'preset.newSessionStarted': '已启动新会话，任务已入队',
  'preset.newSessionFailed': '启动新会话失败',
  'preset.newSessionPartialFailed': '新会话已启动，但任务未能入队',
  'preset.delete': '删除',
  'toolbox.add': '添加',
  'toolbox.taskContent': '任务内容',
  'toolbox.editTask': '编辑预设任务',
  'toolbox.insertAiTemplate': 'Prompt模板',
  'toolbox.taskContentPlaceholder': '发送到终端的指令内容',
  'toolbox.selectProject': '选择工程目录',
  'common.button.save': '保存',
  cancel: '取消',
  delete: '删除',
}

/** 宿主命令替身（默认空列表；新会话链路用例可注入 start-run 回执） */
type CommandHandler = (command: string, args?: any) => Promise<any>

/** 记录 toast 的宿主 dialogs 替身（events 替身供 useTaskHistory 建订阅） */
function makeContext(
  toasts: { message: string; type?: string }[],
  execute: CommandHandler = async () => ({ code: 0, message: 'ok' }),
): PluginContext {
  return {
    i18n: { t: (key: string) => ZH[key] ?? key },
    dialogs: {
      showToast: (message: string, type?: string) => toasts.push({ message, type }),
    },
    events: { on: () => ({ dispose() {} }) },
    commands: { execute: vi.fn(execute) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
  } as unknown as PluginContext
}

/** 预设执行链路里的断言面（直接发送 / 入队事件） */
interface PresetCalls {
  execute: string[]
  enqueued: { id: string; taskId: string; sessionId: string }[]
}

/** 预设入队判据：执行中不可再排 */
function canEnqueueStub(task: PresetTask): boolean {
  if (task.status === 'executing') return false
  return true
}

/** 预设任务真源替身（应用自持 store 的消费面） */
function installPresetTasks(tasks: PresetTask[], calls: PresetCalls) {
  presetMock.store = {
    tasks: ref(tasks),
    load: vi.fn(async () => {}),
    addTask: vi.fn(async () => {}),
    updateTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    executeTask: vi.fn(async (task: PresetTask) => {
      calls.execute.push(task.id)
    }),
    reconcileWithQueue: vi.fn(async () => {}),
    canEnqueue: vi.fn(canEnqueueStub),
    markEnqueued: vi.fn((id: string, taskId: string, sessionId: string) => {
      calls.enqueued.push({ id, taskId, sessionId })
    }),
  }
}

function presetTask(overrides: Partial<PresetTask> & { id: string }): PresetTask {
  return {
    content: '跑一遍单测',
    createdAt: '2026-10-16T08:00:00Z',
    updatedAt: '2026-10-16T08:00:00Z',
    status: 'unused',
    pendingTaskId: null,
    pendingSessionId: null,
    ...overrides,
  }
}

let toasts: { message: string; type?: string }[]
let execCalls: PresetCalls

beforeEach(() => {
  toasts = []
  execCalls = { execute: [], enqueued: [] }
  localStorage.removeItem('bedcode.preset-targets')
  installFakeHost()
  installMockMobileApi({ isConnected: false, isPaired: false })
  installPresetTasks([], execCalls)
})

afterEach(() => {
  uninstallFakeHost()
  uninstallMockMobileApi()
  // 弹窗经 Teleport 挂到 body：逐用例清场，避免上一条用例的弹窗内容污染断言
  document.body.innerHTML = ''
})

function mountView(context: PluginContext = makeContext(toasts)) {
  return mount(AutoTaskToolboxView, {
    global: { provide: { pluginContext: context } },
  })
}

describe('C-TT1/C-TT2 页签集合与首屏落点', () => {
  it('should_renderTabsInPresetScheduledHistoryOrder_when_viewMounted', () => {
    const wrapper = mountView()
    const labels = wrapper.findAll('.att-tab').map((b) => b.text())

    expect(labels).toEqual(['预设任务', '定时任务', '任务记录'])
  })

  it('should_activatePresetTabOnFirstScreen_when_viewMounted', () => {
    const wrapper = mountView()
    const tabs = wrapper.findAll('.att-tab')

    expect(tabs[0].classes()).toContain('att-tab-active')
    expect(tabs[1].classes()).not.toContain('att-tab-active')
    expect(tabs[2].classes()).not.toContain('att-tab-active')
    expect(wrapper.findAll('.att-tab-panel')[0].classes()).toContain('att-tab-panel--active')
  })
})

describe('C-TT3 面板停靠态随页签', () => {
  it('should_dockPanelsByIndex_when_switchedToSecondTab', async () => {
    const wrapper = mountView()
    await wrapper.findAll('.att-tab')[1].trigger('click')

    const panels = wrapper.findAll('.att-tab-panel')
    expect(panels).toHaveLength(3)
    expect(panels[0].classes()).toContain('att-tab-panel--left')
    expect(panels[1].classes()).toContain('att-tab-panel--active')
    expect(panels[2].classes()).toContain('att-tab-panel--right')
  })

  it('should_dockPanelsByIndex_when_switchedToThirdTab', async () => {
    const wrapper = mountView()
    await wrapper.findAll('.att-tab')[2].trigger('click')

    const panels = wrapper.findAll('.att-tab-panel')
    expect(panels[0].classes()).toContain('att-tab-panel--left')
    expect(panels[1].classes()).toContain('att-tab-panel--left')
    expect(panels[2].classes()).toContain('att-tab-panel--active')
  })
})

describe('C-TT4/C-TT5 预设任务列表与空态', () => {
  it('should_renderOneRowPerPresetTask_when_tasksExist', async () => {
    installPresetTasks(
      [presetTask({ id: 't1' }), presetTask({ id: 't2', content: '发布构建产物' })],
      execCalls,
    )
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('.preset-card')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('跑一遍单测')
    expect(rows[1].text()).toContain('发布构建产物')
  })

  it('should_showEmptyState_when_noPresetTasks', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.preset-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('暂无预设任务')
    // 反例防护：空态仍保留顶部常驻编辑表单（新增入口不靠弹窗）
    expect(wrapper.find('.content-input').exists()).toBe(true)
  })
})

describe('C-TT6 执行分流：未连接不得执行', () => {
  it('should_warnAndAskForConnection_when_executedWhileDisconnected', async () => {
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    await wrapper.find('.action-execute').trigger('click')

    expect(toasts).toEqual([{ message: '请先连接桌面端', type: 'warning' }])
    expect(execCalls.execute).toEqual([])
    expect(wrapper.emitted('open-connection')).toHaveLength(1)
  })
})

describe('C-TT7 执行分流：先选执行目标，再确认', () => {
  it('should_askTargetThenConfirm_when_connectedWithExactlyOneSession', async () => {
    // 单运行也不再直跳确认：目标弹层同时提供「运行中的会话」与「启动新会话」两条路
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = [{ id: 'session-aaaa1111', name: '构建机', status: 'running' }]
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    await wrapper.find('.action-execute').trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('选择执行目标')
    const sessionRows = document.body.querySelectorAll('[data-testid="mobile-preset-session-row"]')
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0].textContent).toContain('构建机')
    // 未绑定目标的预设：不提供启动新会话，只给原因
    expect(
      document.body.querySelector('[data-testid="mobile-preset-start-new-session"]'),
    ).toBeNull()
    expect(document.body.textContent).toContain('该预设未绑定项目 / Agent，无法启动新会话')
    expect(execCalls.execute).toEqual([])

    ;(sessionRows[0] as HTMLElement).click()
    await wrapper.vm.$nextTick()

    // 选完运行才进确认弹窗，尚未执行
    expect(document.body.textContent).toContain('指令将发送到所选会话的终端')
    expect(execCalls.execute).toEqual([])

    const confirmBtn = document.body.querySelector('[data-testid="mobile-preset-execute-confirm"]')
    expect(confirmBtn).toBeTruthy()
    ;(confirmBtn as HTMLElement).click()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(execCalls.execute).toEqual(['t1'])
    expect(toasts).toEqual([{ message: '已发送到终端', type: 'success' }])
  })

  it('should_askWhichSession_when_connectedWithMultipleSessions', async () => {
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = [
      { id: 'session-aaaa1111', name: '构建机', status: 'running' },
      { id: 'session-bbbb2222', name: '测试机', status: 'waitingInput' },
    ]
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    await wrapper.find('.action-execute').trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain('选择执行目标')
    expect(document.body.textContent).toContain('构建机')
    expect(document.body.textContent).toContain('测试机')
    // 反例防护：多会话时不得擅自挑第一个就发
    expect(execCalls.execute).toEqual([])
  })

  it('should_openTargetPickerWithoutStoppedSessions_when_onlyNonRunningSessionsExist', async () => {
    // `activeSessions` 含已停止会话（宿主全量保留）；对它们下发输入必失败，
    // 执行分流必须按运行态过滤，否则表现为「预设执行失败」且无有效提示
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = [
      { id: 'session-stopped1', name: '已停会话', status: 'stopped' },
      { id: 'session-error1', name: '出错会话', status: 'error' },
    ]
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    await wrapper.find('.action-execute').trigger('click')
    await wrapper.vm.$nextTick()

    // 不再 toast 拦死：弹层直接开（空列表 + 起新会话入口），否则无运行时就无路可走
    expect(document.body.textContent).toContain('选择执行目标')
    expect(document.body.textContent).toContain('暂无运行中的会话')
    expect(
      document.body.querySelectorAll('[data-testid="mobile-preset-session-row"]'),
    ).toHaveLength(0)
    expect(execCalls.execute).toEqual([])
    // 不得跳到确认弹窗（无有效目标）
    expect(document.body.textContent).not.toContain('指令将发送到所选会话的终端')
  })
})

/** 记录新增/更新的预设任务真源替身（断言内联表单的保存路径） */
function installPresetTasksWithCalls(
  tasks: PresetTask[],
  calls: PresetCalls & { added: { content: string }[] },
) {
  presetMock.store = {
    tasks: ref(tasks),
    load: vi.fn(async () => {}),
    addTask: vi.fn(async (data: { content: string }) => {
      calls.added.push({ ...data })
    }),
    updateTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    executeTask: vi.fn(async () => {}),
    reconcileWithQueue: vi.fn(async () => {}),
    canEnqueue: vi.fn(canEnqueueStub),
    markEnqueued: vi.fn(),
  }
}

describe('C-TT8 编辑表单常驻页面顶部（不弹窗）', () => {
  it('should_showInlineEditor_when_mounted (no popup for add)', async () => {
    installPresetTasks([], execCalls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    // 编辑表单直接显示在页签面板内（非 Teleport 弹窗）
    const textarea = wrapper.find('.att-tab-body textarea.content-input')
    expect(textarea.exists()).toBe(true)
    expect(wrapper.find('.content-input').text()).toBe('')
    // 新增按钮是页面内的提交按钮，不是唤起弹窗的入口
    const addBtn = wrapper.findAll('.att-tab-body button').find((b) => b.text().includes('添加'))
    expect(addBtn).toBeTruthy()
    expect(addBtn!.element.closest('.att-tab-body')).toBeTruthy()
  })

  it('should_saveNewTask_viaInlineForm_when_clickAdd', async () => {
    const calls: PresetCalls & { added: { content: string }[] } = {
      execute: [],
      enqueued: [],
      added: [],
    }
    installPresetTasksWithCalls([], calls)
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    const textarea = wrapper.find('.content-input')
    await textarea.setValue('构建并上传安装包')
    await wrapper.vm.$nextTick()

    // 提交按钮随内容可用；点击后经 addTask 落库
    const addBtn = wrapper.findAll('.att-tab-body button').find((b) => b.text().includes('添加'))
    expect(addBtn!.attributes('disabled')).toBeUndefined()
    await addBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(calls.added).toEqual([{ content: '构建并上传安装包' }])
    // 保存成功后输入框清空并保留焦点（支持连续录入）
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
  })

  it('should_loadTaskIntoEditor_when_clickEdit (no popup for edit)', async () => {
    installPresetTasks(
      [presetTask({ id: 't1', content: '发布构建产物' })],
      execCalls,
    )
    const wrapper = mountView()
    await wrapper.vm.$nextTick()

    await wrapper.find('.action-edit').trigger('click')
    await wrapper.vm.$nextTick()

    // 内容载入顶部编辑区（仍在页签面板内，未弹窗）
    const textarea = wrapper.find('.content-input')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('发布构建产物')
    // 按钮切换为「保存」
    const saveBtn = wrapper.findAll('.att-tab-body button').find((b) => b.text().includes('保存'))
    expect(saveBtn).toBeTruthy()
  })
})
/**
 * C-TT9 启动新会话执行（B 口径：起运行 → 入队 → 开自动执行）
 *
 * 反例纪律：
 * - 不直写终端（`executeTask` 零调用）：agent CLI 刚 spawn 时写输入会丢字；
 * - 未绑定项目 × Agent 不得出现在入口（起会话必须有目标）；
 * - 起运行失败 → 不入队、不标执行中；
 * - 入队成功但开自动失败 → 回滚队列项 + 明说「新会话已启动但任务未入队」。
 */
describe('C-TT9 启动新会话执行', () => {
  const target = { projectId: 'proj-1', agentId: 'claude' }

  /** 项目 / agent 清单 + start-run 回执的命令替身（记录调用） */
  function installCommands(
    calls: { command: string; args?: any }[],
    startRunResult: any = { code: 0, message: 'ok', data: { runId: 'run-new', name: '支付重构' } },
    onStartRun?: () => void,
  ): CommandHandler {
    return async (command: string, args?: any) => {
      calls.push({ command, args })
      if (command === 'bedcode.start-run') {
        onStartRun?.()
        return startRunResult
      }
      if (command === 'bedcode.list-projects') {
        return {
          code: 0,
          message: 'ok',
          data: {
            projects: [
              {
                id: 'proj-1',
                name: '支付重构',
                workingDir: '/work/pay',
                environment: 'linux',
                createdAt: '',
                updatedAt: '',
                activeRuns: 0,
                runCount: 0,
                lastActivityAt: null,
                lastAgentId: null,
              },
            ],
          },
        }
      }
      if (command === 'bedcode.list-agents') {
        return {
          code: 0,
          message: 'ok',
          data: {
            agents: [{ id: 'claude', displayName: 'Claude', binary: 'claude', readiness: 'ready' }],
          },
        }
      }
      return { code: 0, message: 'ok' }
    }
  }

  /** 任务域 HTTP 替身：supported-agents / 队列入队 / 会话模式 */
  function installHttp(
    paths: { path: string; body?: any }[],
    overrides: { add?: any; mode?: any } = {},
  ) {
    return async (path: string, options?: any) => {
      paths.push({ path, body: options?.body })
      if (path.includes('supported-agents'))
        return { code: 0, message: 'ok', data: { agents: ['claude'] } }
      if (path.includes('task-queue/add')) {
        return overrides.add ?? { code: 0, message: 'ok', data: { task_id: 'q-1', position: 1 } }
      }
      if (path.includes('session-mode'))
        return overrides.mode ?? { code: 0, message: 'ok', data: {} }
      if (path.includes('task-queue/remove')) return { code: 0, message: 'ok' }
      return { code: 0, message: 'ok' }
    }
  }

  /** 让「命令 → 入队 → 开自动」的串行 await 链全部落定（微任务不够，跑宏任务） */
  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /** 点卡片执行键打开目标弹层（预设真源须在 mount 前装好） */
  async function openPicker(wrapper: ReturnType<typeof mountView>) {
    await wrapper.find('.action-execute').trigger('click')
    await wrapper.vm.$nextTick()
  }

  it('should_startRunThenEnqueue_when_boundTargetAndNoRunningSession', async () => {
    localStorage.setItem('bedcode.preset-targets', JSON.stringify({ t1: target }))
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = []
    const commands: { command: string; args?: any }[] = []
    const paths: { path: string; body?: any }[] = []
    api.httpRequest = installHttp(paths)
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView(makeContext(toasts, installCommands(commands)))

    await openPicker(wrapper)

    // 0 运行当时的旧行为是 toast 拦死；现在必须给出起新会话入口（带目标标签）
    expect(document.body.textContent).toContain('暂无运行中的会话')
    const startNew = document.body.querySelector('[data-testid="mobile-preset-start-new-session"]')
    expect(startNew).toBeTruthy()
    expect(startNew!.textContent).toContain('支付重构 · Claude')

    ;(startNew as HTMLElement).click()
    await wrapper.vm.$nextTick()

    // 确认弹窗说明是「起新会话 + 入队」，确认键文案独立
    expect(document.body.textContent).toContain('将启动新会话并把指令入队')
    expect(execCalls.execute).toEqual([])
    const confirmBtn = document.body.querySelector('[data-testid="mobile-preset-execute-confirm"]')
    expect(confirmBtn!.textContent).toContain('启动并执行')
    ;(confirmBtn as HTMLElement).click()
    await flushAsync()
    await wrapper.vm.$nextTick()

    const startCall = commands.find((c) => c.command === 'bedcode.start-run')
    expect(startCall?.args).toMatchObject({ projectId: 'proj-1', agentId: 'claude' })
    // 顺序：入队（auto 关，不触发下发）→ 开自动执行
    const addIndex = paths.findIndex((p) => p.path.includes('task-queue/add'))
    const modeIndex = paths.findIndex((p) => p.path.includes('session-mode'))
    expect(addIndex).toBeGreaterThanOrEqual(0)
    expect(modeIndex).toBeGreaterThan(addIndex)
    expect(paths[addIndex].body).toEqual({ session_id: 'run-new', prompt: '跑一遍单测' })
    expect(paths[modeIndex].body).toMatchObject({ session_id: 'run-new', auto_execute: true })
    // 不直写终端；预设按入队记账（完成/中断由广播与对账细化）
    expect(execCalls.execute).toEqual([])
    expect(execCalls.enqueued).toEqual([{ id: 't1', taskId: 'q-1', sessionId: 'run-new' }])
    expect(toasts).toEqual([{ message: '已启动新会话，任务已入队', type: 'success' }])
  })

  it('should_offerBothPaths_when_runningSessionExists', async () => {
    localStorage.setItem('bedcode.preset-targets', JSON.stringify({ t1: target }))
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = [
      { id: 'run-old', name: '旧运行', status: 'running', projectId: 'proj-1', agentId: 'claude' },
      // 同项目不同 agent 的运行不属于该目标，不得出现在候选里
      {
        id: 'run-other',
        name: '别的 Agent',
        status: 'running',
        projectId: 'proj-1',
        agentId: 'pi',
      },
    ]
    api.httpRequest = installHttp([])
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView(makeContext(toasts, installCommands([])))

    await openPicker(wrapper)

    const rows = document.body.querySelectorAll('[data-testid="mobile-preset-session-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('旧运行')
    expect(
      document.body.querySelector('[data-testid="mobile-preset-start-new-session"]'),
    ).toBeTruthy()
  })

  it('should_reportFailureAndSkipEnqueue_when_startRunFails', async () => {
    localStorage.setItem('bedcode.preset-targets', JSON.stringify({ t1: target }))
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = []
    const paths: { path: string; body?: any }[] = []
    api.httpRequest = installHttp(paths)
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView(
      makeContext(toasts, installCommands([], { code: 1002, message: 'claude not installed' })),
    )

    await openPicker(wrapper)
    ;(
      document.body.querySelector('[data-testid="mobile-preset-start-new-session"]') as HTMLElement
    ).click()
    await wrapper.vm.$nextTick()
    ;(
      document.body.querySelector('[data-testid="mobile-preset-execute-confirm"]') as HTMLElement
    ).click()
    await flushAsync()
    await wrapper.vm.$nextTick()

    expect(toasts).toEqual([{ message: '启动新会话失败: claude not installed', type: 'error' }])
    expect(paths.some((p) => p.path.includes('task-queue/add'))).toBe(false)
    expect(execCalls.enqueued).toEqual([])
  })

  it('should_rollbackQueueItem_when_enabledAutoModeFails', async () => {
    localStorage.setItem('bedcode.preset-targets', JSON.stringify({ t1: target }))
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = []
    const paths: { path: string; body?: any }[] = []
    api.httpRequest = installHttp(paths, {
      mode: { code: 1002, message: 'session mode failed' },
    })
    installPresetTasks([presetTask({ id: 't1' })], execCalls)
    const wrapper = mountView(makeContext(toasts, installCommands([])))

    await openPicker(wrapper)
    ;(
      document.body.querySelector('[data-testid="mobile-preset-start-new-session"]') as HTMLElement
    ).click()
    await wrapper.vm.$nextTick()
    ;(
      document.body.querySelector('[data-testid="mobile-preset-execute-confirm"]') as HTMLElement
    ).click()
    await flushAsync()
    await wrapper.vm.$nextTick()

    // 已入队项必须撤回：否则队列里挂着永不执行的任务，预设还会假装「执行中」
    const remove = paths.find((p) => p.path.includes('task-queue/remove'))
    expect(remove?.body).toEqual({ session_id: 'run-new', task_id: 'q-1' })
    expect(execCalls.enqueued).toEqual([])
    expect(toasts).toEqual([
      { message: '新会话已启动，但任务未能入队: session mode failed', type: 'error' },
    ])
  })

  it('should_disableStartNew_when_presetCannotEnqueue', async () => {
    localStorage.setItem('bedcode.preset-targets', JSON.stringify({ t1: target }))
    const api = installMockMobileApi({ isConnected: true, isPaired: true })
    api.activeSessions.value = []
    api.httpRequest = installHttp([])
    const commands: { command: string; args?: any }[] = []
    // 执行中 → 不可再入队
    installPresetTasks(
      [presetTask({ id: 't1', status: 'executing' })],
      execCalls,
    )
    const wrapper = mountView(makeContext(toasts, installCommands(commands)))

    await openPicker(wrapper)

    const startNew = document.body.querySelector(
      '[data-testid="mobile-preset-start-new-session"]',
    ) as HTMLButtonElement
    expect(startNew).toBeTruthy()
    expect(startNew.disabled).toBe(true)
    expect(document.body.textContent).toContain('该预设正在执行，不能再入队')

    startNew.click()
    await wrapper.vm.$nextTick()
    // 不弹确认、不起运行
    expect(document.body.textContent).not.toContain('将启动新会话并把指令入队')
    expect(commands.some((c) => c.command === 'bedcode.start-run')).toBe(false)
  })
})
