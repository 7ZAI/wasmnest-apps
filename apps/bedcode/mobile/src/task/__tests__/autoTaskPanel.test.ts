/**
 * 自动任务面板（AutoTaskPanelHost）事件联动测试（2026-10-27 排查）
 *
 * 覆盖自动执行链路里「桌面端推进 → 移动端状态同步」的接线：
 *
 * | 契约 | 来源 | 规则 | 预期 |
 * |---|---|---|---|
 * | C-AP1 | 面板打开即拉队列（现有行为） | 可见性翻 true 触发 refresh | httpTaskQueueList/current/settings 各拉一次 |
 * | C-AP2 | 自动执行 dequeue/done 广播 | 面板可见时按事件刷新队列 | 事件后再次拉队列 |
 * | C-AP3 | done 广播带 task_id | 按队列项 id 匹配预设 → completed | 对应预设状态落 completed |
 * | C-AP4 | 会话轮换广播（action=rotate） | 队列项迁到新会话 | 预设 pendingSessionId 跟着改（防旧会话对账误判中断） |
 * | C-AP5 | 停止的会话 | 不能入队/切自动模式 | 输入与预设 chip 全部禁用 |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import AutoTaskPanelHost from '../components/AutoTaskPanelHost.vue'
import { autoTaskPanelVisible } from '../state'
import type { PresetTask } from '../../terminal/model'
import {
  installMockMobileApi,
  uninstallMockMobileApi,
  installFakeHost,
  uninstallFakeHost,
  type MockMobileApi,
} from '../../terminal/__tests__/testKit'

/** 面板消费的文案键（域内相对键 → 中文） */
const ZH: Record<string, string> = {
  title: '自动任务',
  clear: '清空',
  clearConfirm: '确定清空全部待执行任务？',
  confirm: '确认',
  cancel: '取消',
  addFromPreset: '从预设添加',
  inputPlaceholder: '输入指令添加到队列...',
  emptyQueue: '暂无自动任务',
  emptyHint: '开启自动执行后，队列中的任务将依次自动执行',
  addFailed: '添加任务失败',
  removeFailed: '删除任务失败',
  cancelTask: '取消任务',
  cancelTaskFailed: '取消失败',
  clearFailed: '清空队列失败',
  loadFailed: '加载任务队列失败',
  updateFailed: '保存失败',
  reorderFailed: '排序失败',
  modeFailed: '切换自动模式失败',
  idle: '空闲',
  inProgress: '执行中',
  asking: '等待输入',
  completed: '已完成',
  interrupted: '已中断',
  pending: '待执行',
  waiting: '等待下发',
  unused: '未使用',
  autoExecute: '自动执行',
  autoExecuteHint: '开启后，添加的任务将自动依次执行',
  autoAnswer: '自动应答',
  autoAnswerHint: '开启后，Agent 的提问将自动回答',
  moveUp: '上移',
  moveDown: '下移',
  edit: '编辑',
  editTitle: '编辑任务',
  editPlaceholder: '输入任务内容...',
  editHint: '支持多行内容',
  save: '保存',
  delete: '删除',
  loading: '加载中...',
}

const preset = (overrides: Partial<PresetTask> = {}): PresetTask => ({
  id: 'p1',
  content: '跑一遍单测',
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
  repeatable: true,
  status: 'executing',
  pendingTaskId: 'q1',
  pendingSessionId: 'sess-old',
  ...overrides,
})

function makeContext(): PluginContext {
  return {
    i18n: { t: (key: string) => ZH[key] ?? key },
    dialogs: { showToast: vi.fn() },
    events: { on: () => ({ dispose() {} }) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
  } as unknown as PluginContext
}

let api: MockMobileApi
let tasks: ReturnType<typeof ref<PresetTask[]>>
let httpRequest: ReturnType<typeof vi.fn>
let saveToStorage: ReturnType<typeof vi.fn>

beforeEach(() => {
  installFakeHost()
  httpRequest = vi.fn(async (path: string) => {
    if (path.includes('task-queue/list')) {
      return {
        code: 0,
        message: 'ok',
        data: { session_id: 'sess-1', tasks: [], queue_count: 0, active_task: null },
      }
    }
    if (path.includes('task-history/current')) {
      return { code: 0, message: 'ok', data: { session_id: 'sess-1', task: null } }
    }
    if (path.includes('session-settings')) {
      return { code: 0, message: 'ok', data: { session_id: 'sess-1', auto_execute: true, auto_answer: false } }
    }
    return { code: 0, message: 'ok' }
  })
  api = installMockMobileApi({ isConnected: true, isPaired: true, activeSessionId: 'sess-1', httpRequest })
  api.activeSessions.value = [{ id: 'sess-1', name: '构建机', status: 'running' }]

  tasks = ref([preset()])
  saveToStorage = vi.fn()
  const shared = ((window as any).__WASMNEST_SHARED__ ??= {})
  shared.presetTasks = {
    usePresetTasks: () => ({
      tasks,
      saveToStorage,
      load: vi.fn(async () => {}),
      addTask: vi.fn(async () => {}),
      updateTask: vi.fn(async () => {}),
      deleteTask: vi.fn(async () => {}),
      sendTask: vi.fn(async () => {}),
      executeTask: vi.fn(async () => {}),
      reconcileWithQueue: vi.fn(async () => {}),
      markEnqueued: vi.fn(),
      markCompletedByTaskId: vi.fn((taskId: string) => {
        const t = tasks.value.find((x) => x.pendingTaskId === taskId)
        if (t) {
          t.status = 'completed'
          t.pendingTaskId = null
        }
      }),
      markInterruptedByTaskId: vi.fn((taskId: string) => {
        const t = tasks.value.find((x) => x.pendingTaskId === taskId)
        if (t) t.status = 'interrupted'
      }),
      revertToUnusedByTaskId: vi.fn(),
      canEnqueue: () => true,
    }),
  }
  autoTaskPanelVisible.value = false
})

afterEach(() => {
  autoTaskPanelVisible.value = false
  uninstallFakeHost()
  uninstallMockMobileApi()
  delete (window as any).__WASMNEST_SHARED__?.presetTasks
  document.body.innerHTML = ''
})

async function mountPanel() {
  const wrapper = mount(AutoTaskPanelHost, {
    global: { provide: { pluginContext: makeContext() } },
  })
  // 面板初始隐藏；翻可见触发 refresh（watch 无 immediate）
  autoTaskPanelVisible.value = true
  await wrapper.vm.$nextTick()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('C-AP1 面板打开拉取队列', () => {
  it('should_loadQueueAndSettings_when_panelOpened', async () => {
    await mountPanel()
    const paths = httpRequest.mock.calls.map((c) => c[0] as string)
    expect(paths.some((p) => p.includes('task-queue/list'))).toBe(true)
    expect(paths.some((p) => p.includes('task-history/current'))).toBe(true)
    expect(paths.some((p) => p.includes('session-settings'))).toBe(true)
  })
})

describe('C-AP2 队列事件驱动面板刷新', () => {
  it('should_reloadQueue_when_dequeueBroadcastArrives', async () => {
    await mountPanel()
    const before = httpRequest.mock.calls.filter((c) => String(c[0]).includes('task-queue/list')).length

    window.dispatchEvent(
      new CustomEvent('wasmnest:task_queue_changed', {
        detail: { session_id: 'sess-1', queue_count: 1, action: 'dequeue', task_id: null, status: null },
      }),
    )
    await Promise.resolve()

    const after = httpRequest.mock.calls.filter((c) => String(c[0]).includes('task-queue/list')).length
    expect(after).toBeGreaterThan(before)
  })
})

describe('C-AP3 完成广播匹配预设', () => {
  it('should_markPresetCompleted_when_doneBroadcastWithTaskId', async () => {
    await mountPanel()
    window.dispatchEvent(
      new CustomEvent('wasmnest:task_queue_changed', {
        detail: { session_id: 'sess-1', queue_count: 0, action: 'done', task_id: 'q1', status: 'done' },
      }),
    )
    expect(tasks.value[0].status).toBe('completed')
  })
})

describe('C-AP4 轮换广播同步预设会话归属', () => {
  it('should_remapPendingSession_when_rotateBroadcastWithTaskId', async () => {
    await mountPanel()
    window.dispatchEvent(
      new CustomEvent('wasmnest:task_queue_changed', {
        detail: {
          session_id: 'sess-new',
          queue_count: 1,
          action: 'rotate',
          task_id: 'q1',
          status: 'waiting',
        },
      }),
    )
    expect(tasks.value[0].pendingSessionId).toBe('sess-new')
    expect(saveToStorage).toHaveBeenCalled()
  })
})

describe('C-AP5 停止会话不得入队', () => {
  it('should_disableInputs_when_activeSessionStopped', async () => {
    api.activeSessions.value = [{ id: 'sess-1', name: '构建机', status: 'stopped' }]
    const wrapper = await mountPanel()

    const input = wrapper.find('.atp-manual-input')
    expect(input.attributes('disabled')).toBeDefined()
    const addBtn = wrapper.find('.atp-add-btn')
    expect(addBtn.attributes('disabled')).toBeDefined()
    const chip = wrapper.find('.atp-preset-chip')
    expect(chip.attributes('disabled')).toBeDefined()
  })
})
