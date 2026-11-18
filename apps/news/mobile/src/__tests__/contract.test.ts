import { describe, expect, it, vi } from 'vitest'
import { activate, deactivate } from '../index'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'

function fakeContext() {
  return {
    i18n: {
      registerMessages: vi.fn(),
      t: (key: string) => key,
    },
    ui: {
      registerSurface: vi.fn(),
      registerRoute: vi.fn(),
    },
    logger: { info: vi.fn() },
  } as unknown as PluginContext
}

describe('移动端 activate 契约', () => {
  it('注册两种语言、运行面与设置二级页', async () => {
    const context = fakeContext()

    await activate(context)

    expect(context.i18n.registerMessages).toHaveBeenCalledTimes(2)
    expect(context.ui.registerSurface).toHaveBeenCalledWith(
      expect.objectContaining({ accent: '#F59E0B' }),
    )
    expect(context.ui.registerRoute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'settings', header: true }),
    )
  })

  it('样式注入幂等：重复激活只保留一个 style 标签', async () => {
    await activate(fakeContext())
    await activate(fakeContext())

    expect(document.querySelectorAll('#news-plugin-style')).toHaveLength(1)
  })

  it('deactivate 不抛错（资源由宿主注册表统一摘除）', async () => {
    await activate(fakeContext())
    await expect(deactivate()).resolves.toBeUndefined()
  })
})