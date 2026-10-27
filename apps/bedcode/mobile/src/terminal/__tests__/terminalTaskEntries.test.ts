/**
 * 终端域任务入口/执行接线测试（2026-10-27 回归）
 *
 * 覆盖两个用户可见故障的接线面：
 * 1. 「任务」工具栏打开可执行任务面板（showTaskPicker），「自动任务」工具栏打开
 *    自动任务队列面板（autoTaskPanelVisible）——后者此前没有任何入口，
 *    队列 / 自动执行开关在移动端不可达。
 * 2. 预设任务的「发送 / 执行」必须命中宿主 usePresetTasks 的实现（经
 *    `src/task/presetApi.ts`），而不是把共享模块对象当 composable 解构导致
 *    executeTask undefined → 静默失败 toast「发送失败」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { installFakeHost, uninstallFakeHost, installMockMobileApi, uninstallMockMobileApi } from './testKit'
import { useTerminalPanels } from '../composables/useTerminalPanels'
import { useTerminalInput } from '../composables/useTerminalInput'
import { autoTaskPanelVisible } from '../../task/state'
import type { TerminalKernelContext } from '../composables/terminalKernel'
import type { PresetTask } from '../model'

const TASK: PresetTask = {
  id: 'p1',
  content: '跑一遍单测',
  createdAt: '2026-10-27T08:00:00Z',
  updatedAt: '2026-10-27T08:00:00Z',
  repeatable: true,
  status: 'unused',
  pendingTaskId: null,
  pendingSessionId: null,
}

let hostPreset: {
  sendTask: ReturnType<typeof vi.fn>
  executeTask: ReturnType<typeof vi.fn>
}

function installPresetHost(): void {
  hostPreset = {
    sendTask: vi.fn(async () => {}),
    executeTask: vi.fn(async () => {}),
  }
  const shared = ((window as any).__WASMNEST_SHARED__ ??= {})
  shared.presetTasks = {
    usePresetTasks: () => ({
      tasks: ref([TASK]),
      ...hostPreset,
      load: vi.fn(async () => {}),
      addTask: vi.fn(async () => {}),
      updateTask: vi.fn(async () => {}),
      deleteTask: vi.fn(async () => {}),
      reconcileWithQueue: vi.fn(async () => {}),
      markEnqueued: vi.fn(),
      markCompletedByTaskId: vi.fn(),
      markInterruptedByTaskId: vi.fn(),
      revertToUnusedByTaskId: vi.fn(),
      canEnqueue: () => true,
    }),
  }
}

function makeKernelCtx(overrides: Partial<TerminalKernelContext> = {}): TerminalKernelContext {
  return {
    terminalRef: ref(null),
    getSessionId: () => 'sess-1',
    isConnected: () => true,
    isSessionActive: () => true,
    ...overrides,
  } as unknown as TerminalKernelContext
}

let fakeHost: ReturnType<typeof installFakeHost>

beforeEach(() => {
  setActivePinia(createPinia())
  fakeHost = installFakeHost()
  installMockMobileApi({ isConnected: true })
  installPresetHost()
  autoTaskPanelVisible.value = false
})

afterEach(() => {
  uninstallFakeHost()
  uninstallMockMobileApi()
  delete (window as any).__WASMNEST_SHARED__?.presetTasks
})

describe('工具栏任务入口', () => {
  it('should_open_task_picker_when_task_action', () => {
    const panels = useTerminalPanels({ refreshTerminal: () => {} })
    panels.handleToolbarAction('task')
    expect(panels.showTaskPicker.value).toBe(true)
    expect(autoTaskPanelVisible.value).toBe(false)
  })

  it('should_open_auto_task_panel_when_autoTask_action', () => {
    const panels = useTerminalPanels({ refreshTerminal: () => {} })
    panels.handleToolbarAction('autoTask')
    expect(autoTaskPanelVisible.value).toBe(true)
    expect(panels.showTaskPicker.value).toBe(false)
  })
})

describe('预设任务发送 / 执行', () => {
  it('should_call_host_executeTask_when_execute', async () => {
    const input = useTerminalInput(makeKernelCtx(), { sendInput: () => true, getConfigId: () => undefined })
    await input.onTaskExecute(TASK)
    expect(hostPreset.executeTask).toHaveBeenCalledWith(TASK, 'sess-1')
    expect(fakeHost.toasts).toEqual([])
  })

  it('should_call_host_sendTask_when_send', async () => {
    const input = useTerminalInput(makeKernelCtx(), { sendInput: () => true, getConfigId: () => undefined })
    await input.onTaskSend(TASK)
    expect(hostPreset.sendTask).toHaveBeenCalledWith(TASK, 'sess-1')
    expect(fakeHost.toasts).toEqual([])
  })

  it('should_toast_send_failed_when_host_rejects', async () => {
    hostPreset.executeTask.mockRejectedValueOnce(new Error('boom'))
    const input = useTerminalInput(makeKernelCtx(), { sendInput: () => true, getConfigId: () => undefined })
    await input.onTaskExecute(TASK)
    expect(fakeHost.toasts).toEqual([{ type: 'error', message: 'toolbox.sendFailed' }])
  })

  it('should_not_execute_when_session_inactive', async () => {
    const input = useTerminalInput(makeKernelCtx({ isSessionActive: () => false }), {
      sendInput: () => true,
      getConfigId: () => undefined,
    })
    await input.onTaskExecute(TASK)
    expect(hostPreset.executeTask).not.toHaveBeenCalled()
    expect(fakeHost.toasts).toEqual([{ type: 'error', message: 'connection.connectFailed' }])
  })
})
