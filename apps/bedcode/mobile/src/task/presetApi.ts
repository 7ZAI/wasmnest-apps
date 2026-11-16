/**
 * 预设任务真源（应用自持）
 *
 * 2026-11-16 下沉：删除对平台仓 `getPresetTasks()`（宿主 `usePresetTasks` 共享模块）的
 * 依赖，预设任务的类型、状态机、存储、判定全部归本应用：
 *
 * - **存储**：插件私有 KV（`context.storage`，manifest 的 `storage` 权限），键
 *   `preset-tasks`。宿主不再持有 `localStorage['preset-tasks']` 这个业务键。
 * - **旧数据迁移**：插件 KV 无记录时，读宿主旧键（同一 WebView 的 localStorage）一次性
 *   导入并删除旧键；删除失败不阻断（下次仍按「KV 优先」读取，不会再覆盖新数据）。
 * - **设备擦除**：宿主「清除所有数据」会在 localStorage 落 `wasmnest.data-cleared-at`
 *   （设备级事实，非业务键）。本端记录已处理的标记，发现更新的标记即清空自己的 KV。
 * - **状态机**：`presetTaskState.ts` 本地纯函数，已删除「可重复 / 一次性」维度。
 * - **发送/执行**：经 `mobileApi.httpRequest` 直连桌面 `POST /api/sessions/{id}/input`
 *   （与终端域同一 HTTP 代理通道，JWT 由宿主代注），不再绕宿主 composable。
 *
 * 消费面（任务页 / 自动任务面板 / 终端任务选择器）只依赖本文件导出的
 * `usePresetTasks()`，形状由 `__tests__/presetApi.test.ts` 钉住。
 */

import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { getMobileApi } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { PresetTask } from '../terminal/model'
import { httpTaskQueueList } from './api'
import {
  enqueue,
  taskDone,
  manualExecute,
  queueItemRemoved,
  edit,
  reconcile,
  canEnqueue as canEnqueueState,
} from './presetTaskState'

/** 插件私有 KV 键（宿主 localStorage 同名旧键只用于一次性迁移） */
const STORAGE_KEY = 'preset-tasks'
/** 宿主「清除所有数据」落下的设备级标记（机制事实，不含业务语义） */
const HOST_CLEARED_AT_KEY = 'wasmnest.data-cleared-at'
/** 本端已处理到的擦除标记（防止每次启动重复清空） */
const ACKED_CLEARED_AT_KEY = 'preset.clearedAt'

/** 入队判定（纯函数，供 store 外的调用方直接使用） */
export const canEnqueue = canEnqueueState

let context: PluginContext | null = null
const tasks = ref<PresetTask[]>([])

/** 激活时绑定插件上下文（activateTaskDomain 调用） */
export function bindPresetTasks(ctx: PluginContext): void {
  context = ctx
}

/** 停用时解绑（模块级状态保留，下次激活重新 load） */
export function unbindPresetTasks(): void {
  context = null
  tasks.value = []
}

function requireContext(): PluginContext {
  if (!context) {
    throw new Error('[bedcode] preset store not bound: bindPresetTasks(context) must run in activate')
  }
  return context
}

/** 旧数据迁移：补齐执行状态字段（旧任务无属性，默认未使用） */
function migrateTask(t: Partial<PresetTask>): PresetTask {
  return {
    id: t.id ?? '',
    content: t.content ?? '',
    createdAt: t.createdAt ?? '',
    updatedAt: t.updatedAt ?? '',
    status: t.status ?? 'unused',
    pendingTaskId: t.pendingTaskId ?? null,
    pendingSessionId: t.pendingSessionId ?? null,
  }
}

/**
 * 从宿主旧 localStorage 键导入（只在插件 KV 无记录时尝试）
 *
 * 返回 null = 无旧数据；[] 也是有效结果（旧键存在但是空数组）。
 */
function importLegacyFromHostStorage(ctx: PluginContext): PresetTask[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    // 先删旧键再返回：删失败不影响本次导入，下次启动读 KV 已是真源
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      ctx.logger.warn(`[preset] legacy key remove failed: ${e instanceof Error ? e.message : e}`)
    }
    ctx.logger.info(`[preset] legacy host storage imported (${parsed.length} tasks)`)
    return (parsed as Partial<PresetTask>[]).map(migrateTask)
  } catch (e) {
    ctx.logger.warn(`[preset] legacy host storage import failed: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

/** 读宿主「清除所有数据」标记（设备级事实；读不到按未清空处理） */
function readHostClearedAt(): number | null {
  try {
    const raw = localStorage.getItem(HOST_CLEARED_AT_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

/**
 * 应用宿主擦除标记：标记晚于本端已处理值时清空预设任务
 *
 * 宿主擦除是「设备数据全清」，但插件 KV 在 SQLite（不在 localStorage 命名空间），
 * 宿主无法越权清业务数据——由本端在 load 时按标记自主清空。
 */
async function applyHostClearMarker(ctx: PluginContext, list: PresetTask[]): Promise<PresetTask[]> {
  const marker = readHostClearedAt()
  if (marker === null) return list
  let acked: number | null = null
  try {
    const stored = await ctx.storage.get<number>(ACKED_CLEARED_AT_KEY)
    acked = typeof stored === 'number' ? stored : null
  } catch (e) {
    ctx.logger.warn(`[preset] read clear marker failed: ${e instanceof Error ? e.message : e}`)
    return list
  }
  if (acked !== null && acked >= marker) return list
  try {
    await ctx.storage.set(ACKED_CLEARED_AT_KEY, marker)
  } catch (e) {
    ctx.logger.warn(`[preset] write clear marker failed: ${e instanceof Error ? e.message : e}`)
  }
  return []
}

/** 从插件 KV 加载到响应式状态（首次读不到时尝试宿主旧键迁移） */
export async function load(): Promise<void> {
  const ctx = requireContext()
  let list: PresetTask[] | null = null
  try {
    const stored = await ctx.storage.get<Partial<PresetTask>[]>(STORAGE_KEY)
    if (Array.isArray(stored)) list = stored.map(migrateTask)
  } catch (e) {
    // 存储面不可用：显性报错并保留空列表，不静默拿「空 = 没数据」冒充
    ctx.logger.error(`[preset] load from plugin storage failed: ${e instanceof Error ? e.message : e}`)
    tasks.value = []
    return
  }
  const imported = list === null
  if (list === null) list = importLegacyFromHostStorage(ctx) ?? []
  list = await applyHostClearMarker(ctx, list)
  tasks.value = list
  // 导入后立刻落盘到插件 KV，避免旧键残留成为第二真源
  if (imported && list.length > 0) saveToStorage()
}

/** 写入插件 KV（异步落盘；失败经 logger 显性记录） */
export function saveToStorage(): void {
  if (!context) return
  const ctx = context
  void ctx.storage.set(STORAGE_KEY, tasks.value).catch((e: unknown) => {
    ctx.logger.error(`[preset] save to plugin storage failed: ${e instanceof Error ? e.message : e}`)
  })
}

/** 添加预设任务 */
export async function addTask(input: { content: string }): Promise<void> {
  const now = new Date().toISOString()
  const task: PresetTask = {
    id: crypto.randomUUID(),
    content: input.content,
    createdAt: now,
    updatedAt: now,
    status: 'unused',
    pendingTaskId: null,
    pendingSessionId: null,
  }
  tasks.value.push(task)
  saveToStorage()
}

/** 更新预设任务；内容变化视为重新定义任务，执行状态重置为未使用 */
export async function updateTask(task: PresetTask): Promise<void> {
  const index = tasks.value.findIndex((t) => t.id === task.id)
  if (index === -1) return
  const prev = tasks.value[index]
  const contentChanged = prev.content !== task.content
  tasks.value[index] = migrateTask({
    ...task,
    // 内容变了 → 状态机 edit 语义（unused + 清除队列关联；仅改属性不重置）
    ...(contentChanged ? edit(prev) : {}),
    updatedAt: new Date().toISOString(),
  })
  saveToStorage()
}

/** 删除预设任务 */
export async function deleteTask(id: string): Promise<void> {
  tasks.value = tasks.value.filter((t) => t.id !== id)
  saveToStorage()
}

/** 直发终端输入（桌面 `POST /api/sessions/{id}/input`） */
async function postSessionInput(sessionId: string, data: string, specialKey?: string): Promise<void> {
  const result = await getMobileApi().httpRequest(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    body: { data, ...(specialKey ? { specialKey } : {}) },
  })
  if (result.code !== 0) throw new Error('mobile.toolbox.sendFailed')
}

/** 发送任务内容到终端（不按回车）——不改变执行状态（未真正执行） */
export async function sendTask(task: PresetTask, sessionId: string): Promise<void> {
  await postSessionInput(sessionId, task.content)
}

/** 执行任务内容到终端（按回车）；成功即本地标记已执行（manualExecute） */
export async function executeTask(task: PresetTask, sessionId: string): Promise<void> {
  await postSessionInput(sessionId, task.content, 'enter')
  const index = tasks.value.findIndex((t) => t.id === task.id)
  if (index !== -1) {
    tasks.value[index] = migrateTask({ ...tasks.value[index], ...manualExecute(tasks.value[index]) })
    saveToStorage()
  }
}

// ==================== 执行状态操作（任务页 / 自动任务面板调用） ====================

/** 入队成功：记录队列项 id 与会话，状态 → executing */
export function markEnqueued(id: string, taskId: string, sessionId: string): void {
  const index = tasks.value.findIndex((t) => t.id === id)
  if (index === -1) return
  tasks.value[index] = migrateTask({
    ...tasks.value[index],
    ...enqueue(tasks.value[index], taskId),
    pendingSessionId: sessionId,
  })
  saveToStorage()
}

/** 完成广播：按队列项 id 匹配预设，状态 → completed（不匹配忽略） */
export function markCompletedByTaskId(taskId: string): void {
  const index = tasks.value.findIndex((t) => t.pendingTaskId === taskId)
  if (index === -1) return
  tasks.value[index] = migrateTask({ ...tasks.value[index], ...taskDone(tasks.value[index], taskId) })
  saveToStorage()
}

/** 按队列项 id 落中断（桌面端超时取消/会话终止广播）：匹配预设 → interrupted（不匹配忽略） */
export function markInterruptedByTaskId(taskId: string): void {
  const index = tasks.value.findIndex((t) => t.pendingTaskId === taskId)
  if (index === -1) return
  tasks.value[index] = migrateTask({ ...tasks.value[index], ...reconcile(tasks.value[index]) })
  saveToStorage()
}

/** 队列项移除（面板删除/清空）：按队列项 id 回退未使用（不匹配忽略） */
export function revertToUnusedByTaskId(taskId: string): void {
  const index = tasks.value.findIndex((t) => t.pendingTaskId === taskId)
  if (index === -1) return
  tasks.value[index] = migrateTask({ ...tasks.value[index], ...queueItemRemoved(tasks.value[index], taskId) })
  saveToStorage()
}

/**
 * 对账：把「执行中且队列项已不在指定会话 pending 队列」的预设落为中断
 *
 * 仅判定 pendingSessionId === sessionId 的预设（防多会话误中断：入队到会话 A、
 * 打开面板时活动会话为 B 的任务保持执行中，等待其自身会话的对账/广播）。
 */
export async function reconcileWithQueue(sessionId: string): Promise<void> {
  if (!sessionId) return
  let result
  try {
    result = await httpTaskQueueList(sessionId)
  } catch {
    // 拉取失败不误判：保持现状，等待下次对账
    return
  }
  if (result.code !== 0) return
  const pendingIds = new Set((result.data?.tasks ?? []).map((q) => q.id))
  // 处理中的队列项（waiting/executing）不算丢失：桌面端返回 active_task，
  // 对账仅覆盖「已不在队列且未在处理中」的预设，避免任务执行中误落中断
  const activeId = result.data?.active_task?.id ?? null
  for (const task of tasks.value) {
    if (
      task.status === 'executing' &&
      task.pendingSessionId === sessionId &&
      task.pendingTaskId &&
      !pendingIds.has(task.pendingTaskId) &&
      task.pendingTaskId !== activeId
    ) {
      markInterrupted(task.id)
    }
  }
}

/** 按 id 落中断（任务页对账单条） */
export function markInterrupted(id: string): void {
  const index = tasks.value.findIndex((t) => t.id === id)
  if (index === -1) return
  tasks.value[index] = migrateTask({ ...tasks.value[index], ...reconcile(tasks.value[index]) })
  saveToStorage()
}

/** 预设任务 store 的消费面（任务页 / 自动任务面板 / 终端任务选择器共用） */
export interface PresetTaskStore {
  tasks: Ref<PresetTask[]>
  load(): Promise<void>
  addTask(input: { content: string }): Promise<void>
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
  /** 手动落盘（状态/内容变更后已自动调用；跨会话改归属等直接改记录时用） */
  saveToStorage(): void
}

export function usePresetTasks(): PresetTaskStore {
  return {
    tasks,
    load,
    addTask,
    updateTask,
    deleteTask,
    sendTask,
    executeTask,
    reconcileWithQueue,
    markEnqueued,
    markCompletedByTaskId,
    markInterruptedByTaskId,
    revertToUnusedByTaskId,
    canEnqueue: canEnqueueState,
    saveToStorage,
  }
}
