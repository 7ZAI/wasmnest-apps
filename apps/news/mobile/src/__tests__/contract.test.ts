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

  it('deactivate 不抛错（样式与注册表由宿主统一摘除）', async () => {
    const context = fakeContext()
    await activate(context)
    await expect(deactivate()).resolves.toBeUndefined()
  })
})
