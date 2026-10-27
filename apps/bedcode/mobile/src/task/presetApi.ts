/**
 * 宿主预设任务 composable 的唯一取用点
 *
 * SDK `getPresetTasks()` 返回的是宿主共享模块对象 `{ usePresetTasks }`，
 * 不是 composable 的返回值——必须再调用一次 `.usePresetTasks()` 才能拿到
 * tasks / addTask / executeTask 等成员。直接解构共享模块对象只会得到
 * undefined：终端「可执行任务」面板渲染时读 `tasks.length` 抛错打不开、
 * 预设执行/新增静默失败（2026-10-27 回归）。所有消费点统一走这里，
 * 形状契约由 `__tests__/presetApi.test.ts` 钉住。
 */
import type { Ref } from 'vue'
import { getPresetTasks } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { PresetTask } from '../terminal/model'

/** 宿主 usePresetTasks() 的消费面（形状真源：平台仓 wasmnest-mobile/src/composables/usePresetTasks.ts） */
export interface PresetTaskStore {
  tasks: Ref<PresetTask[]>
  load(): Promise<void>
  addTask(input: { content: string; repeatable?: boolean }): Promise<void>
  updateTask(task: PresetTask): Promise<void>
  deleteTask(id: string): Promise<void>
  sendTask(task: PresetTask, sessionId: string): Promise<void>
  executeTask(task: PresetTask, sessionId: string): Promise<void>
  reconcileWithQueue(sessionId: string): Promise<void>
  markEnqueued(id: string, taskId: string, sessionId: string): void
  markCompletedByTaskId(taskId: string): void
  markInterruptedByTaskId(taskId: string): void
  revertToUnusedByTaskId(taskId: string): void
  canEnqueue(task: PresetTask): boolean
  /** 手动落盘（宿主在每次状态/内容变更后自身已调用；跨会话改归属等直接改记录时用） */
  saveToStorage(): void
}

export function usePresetTasks(): PresetTaskStore {
  return getPresetTasks().usePresetTasks() as PresetTaskStore
}
