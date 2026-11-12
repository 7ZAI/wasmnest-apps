/**
 * 预设任务真源取用点（`src/task/presetApi.ts`）形状锁
 *
 * 2026-10-27 回归：终端任务面板打不开 / 预设执行失败——根因是调用方把 SDK
 * `getPresetTasks()` 的返回值（共享模块对象 `{ usePresetTasks }`）当成了
 * composable 本身解构，`tasks` / `executeTask` 全是 undefined。本测试用与
 * 宿主一致的真实形状（`{ usePresetTasks }`）钉住取用点：
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-PA1 | 共享模块对象只有 usePresetTasks | 直接解构 shared.presetTasks 拿不到 tasks（回归根因） |
 * | C-PA2 | 取用点必须调用 usePresetTasks() | tasks 是 ref、业务函数全部可见 |
 * | C-PA3 | 取用点透传宿主实现 | executeTask / sendTask 的调用参数与宿主收到的一致 |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { usePresetTasks } from '../presetApi'
import type { PresetTask } from '../../terminal/model'

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

let host: {
  tasks: Ref<PresetTask[]>
  executeTask: ReturnType<typeof vi.fn>
  sendTask: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  host = {
    tasks: ref([TASK]),
    executeTask: vi.fn(async () => {}),
    sendTask: vi.fn(async () => {}),
  }
  const shared = ((window as any).__WASMNEST_SHARED__ ??= {})
  shared.presetTasks = {
    usePresetTasks: () => ({
      ...host,
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
})

afterEach(() => {
  delete (window as any).__WASMNEST_SHARED__?.presetTasks
})

describe('C-PA1 共享模块形状（回归根因）', () => {
  it('should_not_expose_tasks_on_raw_shared_module_when_sdk_getPresetTasks_returns_module', () => {
    const raw = (window as any).__WASMNEST_SHARED__.presetTasks
    expect(typeof raw.usePresetTasks).toBe('function')
    expect(raw.tasks).toBeUndefined()
    expect(raw.executeTask).toBeUndefined()
  })
})

describe('C-PA2 取用点形状', () => {
  it('should_expose_full_store_when_usePresetTasks_called', () => {
    const store = usePresetTasks()
    expect(store.tasks.value).toEqual([TASK])
    for (const fn of [
      'load',
      'addTask',
      'updateTask',
      'deleteTask',
      'sendTask',
      'executeTask',
      'reconcileWithQueue',
      'markEnqueued',
      'markCompletedByTaskId',
      'markInterruptedByTaskId',
      'revertToUnusedByTaskId',
      'canEnqueue',
    ]) {
      expect(typeof (store as any)[fn], `${fn} 必须由取用点透出`).toBe('function')
    }
  })
})

describe('C-PA3 透传宿主实现', () => {
  it('should_forward_args_when_executeOrSend_called', async () => {
    const store = usePresetTasks()
    await store.executeTask(TASK, 'sess-1')
    await store.sendTask(TASK, 'sess-1')
    expect(host.executeTask).toHaveBeenCalledWith(TASK, 'sess-1')
    expect(host.sendTask).toHaveBeenCalledWith(TASK, 'sess-1')
  })
})
