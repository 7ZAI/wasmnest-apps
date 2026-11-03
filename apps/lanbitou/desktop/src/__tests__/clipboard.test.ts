/**
 * 剪贴板命令面契约（迁移自 notenote 的同名测试）
 *
 * - C1 写：命令名 / 参数正确，空串也照常写入；
 * - C2 读：有文本返回原文，无内容归一为 null；
 * - C3 往返：写入后读取返回最后写入值；
 * - C4 失败上抛：宿主拒绝（权限 / 能力缺失）由调用方提示。
 */
import { describe, expect, it } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { readClipboard, writeClipboard } from '../clipboard'

interface Call {
  command: string
  args?: Record<string, unknown>
}

function makeContext(handler: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: Call[] = []
  const ctx = {
    commands: {
      execute: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return handler(command, args)
      },
    },
  } as unknown as PluginContext
  return { ctx, calls }
}

/** 带状态的内存剪贴板：读写走同一份文本，模拟宿主往返 */
function makeClipboardContext(initial: string | null = null) {
  let text = initial
  const { ctx, calls } = makeContext((command, args) => {
    if (command === 'lanbitou.clipboard-read') return { text }
    if (command === 'lanbitou.clipboard-write') {
      text = String(args?.text ?? '')
      return { written: true }
    }
    throw new Error(`unexpected command: ${command}`)
  })
  return { ctx, calls, text: () => text }
}

describe('writeClipboard', () => {
  it('调用正确命令并传 text 参数', async () => {
    const { ctx, calls } = makeClipboardContext()
    await writeClipboard(ctx, 'copied text')
    expect(calls).toEqual([{ command: 'lanbitou.clipboard-write', args: { text: 'copied text' } }])
  })

  it('空串是合法写入值', async () => {
    const { ctx, text } = makeClipboardContext()
    await writeClipboard(ctx, '')
    expect(text()).toBe('')
  })

  it('失败上抛（宿主拒绝不外吞）', async () => {
    const { ctx } = makeContext(() => {
      throw new Error('permission denied: clipboard:write')
    })
    await expect(writeClipboard(ctx, 'x')).rejects.toThrow('clipboard:write')
  })
})

describe('readClipboard', () => {
  it('无内容归一为 null', async () => {
    const { ctx } = makeClipboardContext(null)
    await expect(readClipboard(ctx)).resolves.toBeNull()
  })

  it('返回已写入的文本', async () => {
    const { ctx } = makeClipboardContext('hello from clipboard')
    await expect(readClipboard(ctx)).resolves.toBe('hello from clipboard')
  })

  it('失败上抛（能力缺失显性报错）', async () => {
    const { ctx } = makeContext(() => {
      throw new Error('clipboard capability unavailable')
    })
    await expect(readClipboard(ctx)).rejects.toThrow('capability unavailable')
  })
})

describe('读写往返', () => {
  it('写入后读取返回相同内容（含换行 / 特殊字符）', async () => {
    const { ctx } = makeClipboardContext()
    const multiline = '# Title\n\n- item 1\n- item 2\n\n```\ncode block\n```'
    await writeClipboard(ctx, multiline)
    await expect(readClipboard(ctx)).resolves.toBe(multiline)
  })

  it('多次写入后读取返回最后一次', async () => {
    const { ctx, text } = makeClipboardContext()
    await writeClipboard(ctx, 'first')
    await writeClipboard(ctx, 'second')
    await writeClipboard(ctx, 'third')
    await expect(readClipboard(ctx)).resolves.toBe('third')
    expect(text()).toBe('third')
  })
})
