/**
 * Nest 助手移动端 activate / deactivate 契约单测（票 05 骨架最小用例）
 */
import { describe, it, expect, vi } from 'vitest'
import { activate, deactivate } from '../index'
import AssistantSurface from '../components/AssistantSurface.vue'
import { messages } from '../i18n'

function makePluginContext() {
  const registerMessages = vi.fn()
  const registerSurface = vi.fn()
  const info = vi.fn()
  const context = {
    id: 'com.wasmnest.assistant',
    i18n: { registerMessages, t: vi.fn((key: string) => key) },
    ui: { registerSurface },
    logger: { info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  return { context, registerMessages, registerSurface, info }
}

describe('移动端 activate / deactivate 契约（票 05 骨架）', () => {
  it('注册 zh-CN / en 文案后注册运行面；deactivate 落日志', async () => {
    const { context, registerMessages, registerSurface, info } = makePluginContext()

    await activate(context as never)

    expect(registerMessages).toHaveBeenCalledTimes(2)
    const locales = registerMessages.mock.calls.map(([locale]) => locale)
    expect(locales.sort()).toEqual(['en', 'zh-CN'])
    expect(registerMessages).toHaveBeenCalledWith('zh-CN', messages['zh-CN'])

    expect(registerSurface).toHaveBeenCalledTimes(1)
    expect(registerSurface.mock.calls[0][0]).toMatchObject({ component: AssistantSurface })

    expect(info).toHaveBeenCalled()

    await deactivate()
    expect(info).toHaveBeenCalledTimes(2)
  })
})
