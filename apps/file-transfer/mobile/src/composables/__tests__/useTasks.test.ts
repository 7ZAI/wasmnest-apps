/**
 * 传输任务速率聚合（移动端）
 *
 * 覆盖接收方向速率链路：wire `rateBps` → ReceivingTask → totalSpeed。接收快照是
 * 独立事件流（receiving-changed），与发送（tasks-changed）各自整表替换，两侧都要
 * 参与总速率重算，否则手机接收时底部摘要条恒为 0 B/s。
 */
import { describe, it, expect, vi } from 'vitest'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { useTasks } from '../useTasks'

type Handler = (payload: unknown) => void

function makeContext(): {
  context: PluginContext
  handlers: Map<string, Handler>
} {
  const handlers = new Map<string, Handler>()
  const context = {
    commands: { execute: vi.fn(async () => []) },
    events: {
      on: vi.fn((name: string, cb: Handler): Disposable => {
        handlers.set(name, cb)
        return { dispose: () => handlers.delete(name) }
      }),
    },
    i18n: { t: (key: string) => key },
    dialogs: { showToast: vi.fn(), showConfirm: vi.fn(async () => true) },
    notifications: { notify: vi.fn(async () => {}) },
  }
  return { context: context as unknown as PluginContext, handlers }
}

/** 注释：start() 内的初始快照是异步命令，dispatch 事件前先让出微任务队列 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function wireSend(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    batchId: 'send-1',
    direction: 'send',
    status: 'running',
    files: [{ path: 'a.bin', size: 1000 }],
    totalBytes: 1000,
    transferredBytes: 400,
    rateBps: 100,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  }
}

function wireReceiving(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    batchId: 'recv-1',
    direction: 'receive',
    status: 'running',
    files: [{ path: 'b.bin', size: 2000 }],
    totalBytes: 2000,
    transferredBytes: 500,
    rateBps: 300,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  }
}

describe('useTasks 速率聚合（移动端）', () => {
  it('should_mapReceivingRateBpsIntoModelAndTotalSpeed', async () => {
    const { context, handlers } = makeContext()
    const tasks = useTasks(context)
    tasks.start()
    await flush()

    handlers.get('plugin:file-transfer:receiving-changed')!([wireReceiving()])

    expect(tasks.receivingTasks.value[0].rateBps).toBe(300)
    expect(tasks.totalSpeed.value).toBe(300)
  })

  it('should_sumSendAndReceiveRatesAcrossIndependentSnapshots', async () => {
    const { context, handlers } = makeContext()
    const tasks = useTasks(context)
    tasks.start()
    await flush()

    handlers.get('plugin:file-transfer:tasks-changed')!([wireSend()])
    handlers.get('plugin:file-transfer:receiving-changed')!([wireReceiving()])

    expect(tasks.totalSpeed.value).toBe(400)

    // 发送侧快照更新不应抹掉接收侧已计入的速率
    handlers.get('plugin:file-transfer:tasks-changed')!([wireSend({ rateBps: 150 })])
    expect(tasks.totalSpeed.value).toBe(450)
  })

  it('should_ignoreNonTransferringReceivingBatches', async () => {
    const { context, handlers } = makeContext()
    const tasks = useTasks(context)
    tasks.start()
    await flush()

    handlers.get('plugin:file-transfer:receiving-changed')!([
      wireReceiving({ status: 'paused', rateBps: 800 }),
    ])

    expect(tasks.receivingTasks.value[0].state).toBe('paused')
    expect(tasks.totalSpeed.value).toBe(0)
  })

  it('should_clearTotalSpeedOnStop', async () => {
    const { context, handlers } = makeContext()
    const tasks = useTasks(context)
    tasks.start()
    await flush()

    handlers.get('plugin:file-transfer:receiving-changed')!([wireReceiving()])
    expect(tasks.totalSpeed.value).toBe(300)

    tasks.stop()
    expect(tasks.totalSpeed.value).toBe(0)
  })
})