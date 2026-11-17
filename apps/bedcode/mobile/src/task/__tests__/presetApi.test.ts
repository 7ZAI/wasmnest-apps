/**
 * 预设任务真源（`src/task/presetApi.ts`，应用自持）契约锁
 *
 * 2026-11-16 下沉：宿主 `usePresetTasks` 共享模块删除后，真源改为插件私有 KV
 * （`context.storage`）+ 应用内状态机。本测试钉住：
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | C-PA1 | 存储真源 = 插件 KV | load 从 `context.storage` 读，不读宿主共享模块 |
 * | C-PA2 | 旧宿主 localStorage 一次性迁移 | KV 无数据 + 旧键有数据 → 导入、落 KV、删旧键 |
 * | C-PA3 | 入队判据去 repeatable | 仅 executing 锁定；completed/interrupted 可再入队 |
 * | C-PA4 | 执行经 HTTP 直连桌面 | `POST /api/sessions/{id}/input` + specialKey=enter，状态落 completed |
 * | C-PA5 | 新增即落 KV | addTask 后 KV 里能读到新任务 |
 * | C-PA6 | 设备擦除标记 | 宿主标记晚于本端记录 → 清空预设任务 |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import type { PresetTask } from '../../terminal/model'

const h = vi.hoisted(() => ({ httpRequest: vi.fn() }))

vi.mock('@binblink/wasmnest-plugin-sdk-mobile', () => ({
  getMobileApi: () => ({ httpRequest: h.httpRequest }),
}))

import {
  bindPresetTasks,
  unbindPresetTasks,
  usePresetTasks,
  load,
  addTask,
  executeTask,
  canEnqueue,
} from '../presetApi'

const STORAGE_KEY = 'preset-tasks'
const CLEARED_AT_KEY = 'wasmnest.data-cleared-at'

function makeTask(overrides: Partial<PresetTask> = {}): PresetTask {
  return {
    id: 'p1',
    content: '跑一遍单测',
    createdAt: '2026-11-16T08:00:00Z',
    updatedAt: '2026-11-16T08:00:00Z',
    status: 'unused',
    pendingTaskId: null,
    pendingSessionId: null,
    ...overrides,
  }
}

/** 插件 KV 替身（内存 Map）+ logger 替身 */
function makeContext() {
  const map = new Map<string, any>()
  const context = {
    storage: {
      get: vi.fn(async (key: string) => map.get(key)),
      set: vi.fn(async (key: string, value: any) => {
        map.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        map.delete(key)
      }),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
  } as unknown as PluginContext
  return { context, map }
}

let map: Map<string, any>

beforeEach(() => {
  localStorage.clear()
  h.httpRequest.mockReset()
  h.httpRequest.mockResolvedValue({ code: 0, message: 'ok' })
  const made = makeContext()
  map = made.map
  bindPresetTasks(made.context)
})

afterEach(() => {
  unbindPresetTasks()
  localStorage.clear()
})

describe('C-PA1 插件 KV 为真源', () => {
  it('should_loadTasksFromPluginStorage_whenKVHasRecords', async () => {
    map.set(STORAGE_KEY, [makeTask({ id: 'a' })])
    await load()
    expect(usePresetTasks().tasks.value.map((t) => t.id)).toEqual(['a'])
  })

  it('should_fillMissingFields_when_storedTaskIsLegacyShape', async () => {
    map.set(STORAGE_KEY, [{ id: 'a', content: '旧任务' }])
    await load()
    const [task] = usePresetTasks().tasks.value
    expect(task.status).toBe('unused')
    expect(task.pendingTaskId).toBeNull()
    expect(task.pendingSessionId).toBeNull()
  })
})

describe('C-PA2 旧宿主 localStorage 迁移', () => {
  it('should_importLegacyTasks_and_deleteLegacyKey_when_KVEmpty', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeTask({ id: 'legacy' })]))
    await load()
    expect(usePresetTasks().tasks.value.map((t) => t.id)).toEqual(['legacy'])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // 导入后立刻写回插件 KV（旧键不再是第二真源）
    expect((map.get(STORAGE_KEY) as PresetTask[]).map((t) => t.id)).toEqual(['legacy'])
  })

  it('should_preferPluginKV_when_bothSidesHaveData', async () => {
    map.set(STORAGE_KEY, [makeTask({ id: 'new' })])
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeTask({ id: 'legacy' })]))
    await load()
    expect(usePresetTasks().tasks.value.map((t) => t.id)).toEqual(['new'])
    // KV 有数据时不动旧键（留给用户手动清理，不静默删数据）
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })
})

describe('C-PA3 入队判据（repeatable 已退役）', () => {
  it('should_lockOnlyExecuting_when_statusDiffers', () => {
    expect(canEnqueue(makeTask({ status: 'executing' }))).toBe(false)
    expect(canEnqueue(makeTask({ status: 'unused' }))).toBe(true)
    expect(canEnqueue(makeTask({ status: 'completed' }))).toBe(true)
    expect(canEnqueue(makeTask({ status: 'interrupted' }))).toBe(true)
  })

  it('should_ignoreLegacyRepeatableField_when_oldDataStillCarriesIt', () => {
    const legacy = { ...makeTask({ status: 'completed' }), repeatable: false } as PresetTask
    expect(canEnqueue(legacy)).toBe(true)
  })
})

describe('C-PA4 执行直连桌面 HTTP', () => {
  it('should_postSessionInputWithEnter_andMarkCompleted', async () => {
    map.set(STORAGE_KEY, [makeTask({ id: 'p1' })])
    await load()
    const task = usePresetTasks().tasks.value[0]
    await executeTask(task, 'sess-1')
    expect(h.httpRequest).toHaveBeenCalledWith('/api/sessions/sess-1/input', {
      method: 'POST',
      body: { data: '跑一遍单测', specialKey: 'enter' },
    })
    expect(usePresetTasks().tasks.value[0].status).toBe('completed')
    expect((map.get(STORAGE_KEY) as PresetTask[])[0].status).toBe('completed')
  })

  it('should_throwAndKeepStatus_when_serverRejects', async () => {
    map.set(STORAGE_KEY, [makeTask({ id: 'p1' })])
    await load()
    h.httpRequest.mockResolvedValueOnce({ code: 400, message: 'boom' })
    await expect(executeTask(usePresetTasks().tasks.value[0], 'sess-1')).rejects.toThrow(
      'mobile.toolbox.sendFailed',
    )
    expect(usePresetTasks().tasks.value[0].status).toBe('unused')
  })
})

describe('C-PA5 新增落 KV', () => {
  it('should_persistNewTask_when_addTaskCalled', async () => {
    await load()
    await addTask({ content: '新预设' })
    const stored = map.get(STORAGE_KEY) as PresetTask[]
    expect(stored).toHaveLength(1)
    expect(stored[0].content).toBe('新预设')
    expect(stored[0].status).toBe('unused')
  })
})

describe('C-PA6 设备擦除标记', () => {
  it('should_clearTasks_when_hostMarkerIsNewerThanAcked', async () => {
    map.set(STORAGE_KEY, [makeTask({ id: 'a' })])
    localStorage.setItem(CLEARED_AT_KEY, String(Date.now()))
    await load()
    expect(usePresetTasks().tasks.value).toEqual([])
  })

  it('should_keepTasks_when_hostMarkerAlreadyAcked', async () => {
    const marker = Date.now()
    map.set(STORAGE_KEY, [makeTask({ id: 'a' })])
    map.set('preset.clearedAt', marker)
    localStorage.setItem(CLEARED_AT_KEY, String(marker))
    await load()
    expect(usePresetTasks().tasks.value.map((t) => t.id)).toEqual(['a'])
  })
})
