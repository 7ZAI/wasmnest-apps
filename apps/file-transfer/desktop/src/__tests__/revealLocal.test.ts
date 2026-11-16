/**
 * 「打开所在目录」失败可见性契约。
 *
 * 宿主原语 `host-platform.reveal-in-dir` 在路径不存在时显性失败（文件已被移动 /
 * 删除，或历史条目的落点与当前下载目录不一致）。前端若静默 catch，按钮就表现成
 * 「点了没反应」——本组锁住「失败必弹 toast（技术详情只进日志）/ 成功不打扰」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'vue-sonner'
import { revealLocalPath } from '../utils/revealLocal'

function makeContext(execute: (command: string, args: unknown) => Promise<unknown>) {
  return {
    commands: { execute },
    i18n: { t: (key: string) => key },
  } as unknown as Pick<PluginContext, 'commands' | 'i18n'>
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('revealLocalPath', () => {
  it('成功时按文件路径调用 reveal-in-dir，且不打扰用户', async () => {
    const execute = vi.fn().mockResolvedValue({ revealed: true })
    const ok = await revealLocalPath(makeContext(execute), '/home/u/Downloads/a.txt')

    expect(ok).toBe(true)
    expect(execute).toHaveBeenCalledWith('file-transfer.reveal-in-dir', {
      path: '/home/u/Downloads/a.txt',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('路径不存在时弹可见错误（文案走 i18n key，原文只进日志）', async () => {
    const execute = vi.fn().mockRejectedValue({
      code: 'host.internal',
      params: { plugin: 'com.wasmnest.file-transfer' },
    })
    const ok = await revealLocalPath(makeContext(execute), '/home/u/Downloads/missing.txt')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('transfer.history.openFolderFailed')
    // 技术详情（信封 / 原文）只落日志，不进用户文案
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('未配置下载目录（空路径）时同样弹可见提示，不发命令', async () => {
    const execute = vi.fn()
    const ok = await revealLocalPath(makeContext(execute), '')

    expect(ok).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('transfer.history.openFolderNoDir')
  })
})
