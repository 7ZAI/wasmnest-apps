/**
 * 对端取消提示契约：插件 `plugin:file-transfer:peer-cancelled` → 前端 toast。
 *
 * 取消的**状态结算**由插件落库（reduce + flush，core 用例覆盖）；前端只负责
 * 把「对端已取消」变成用户可感的提示——这里锁住事件名与文案 key 的接线。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

vi.mock('vue-sonner', () => ({ toast: { info: vi.fn() } }))

import { toast } from 'vue-sonner'
import { useTasks } from '../composables/useTasks'

function makeContext(): {
  context: PluginContext
  fire: (event: string, payload?: unknown) => void
} {
  const handlers = new Map<string, Array<(payload?: unknown) => void>>()
  const context = {
    events: {
      on(event: string, handler: (payload?: unknown) => void): Disposable {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return {
          dispose() {
            handlers.set(
              event,
              (handlers.get(event) ?? []).filter((h) => h !== handler),
            )
          },
        }
      },
      emit: vi.fn(),
    },
    commands: { execute: vi.fn(async () => []) },
    i18n: { t: (key: string) => key },
  } as unknown as PluginContext
  return {
    context,
    fire(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload)
    },
  }
}

describe('对端取消提示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('收到 peer-cancelled 事件即 toast（文案 key = transfer.task.cancelledToast）', () => {
    const { context, fire } = makeContext()
    const tasks = useTasks(context)
    tasks.start()

    fire('plugin:file-transfer:peer-cancelled', { batchId: 'b-1', direction: 'send' })

    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith('transfer.task.cancelledToast')
    tasks.stop()
  })

  it('stop 后不再响应（监听已注销）', () => {
    const { context, fire } = makeContext()
    const tasks = useTasks(context)
    tasks.start()
    tasks.stop()

    fire('plugin:file-transfer:peer-cancelled', { batchId: 'b-1', direction: 'receive' })

    expect(toast.info).not.toHaveBeenCalled()
  })
})
