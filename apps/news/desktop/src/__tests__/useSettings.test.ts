import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useSettings } from '../composables/useSettings'
import type { NewsSettings } from '../types'

const DISABLED_SETTINGS: NewsSettings = {
  aiEnabled: false,
  aiBaseUrl: '',
  aiModel: '',
  aiApiKeyTail: '',
  aiApiKeyLen: 0,
}

const SAVED_SETTINGS: NewsSettings = {
  aiEnabled: true,
  aiBaseUrl: 'https://api.openai.com',
  aiModel: 'gpt-4o-mini',
  aiApiKeyTail: 'abcd',
  aiApiKeyLen: 32,
}

function context(
  handler: (command: string, args?: Record<string, unknown>) => unknown,
): { context: PluginContext; calls: Array<{ command: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  const context = {
    i18n: { t: (key: string) => key, getI18n: () => ({}) },
    commands: {
      execute: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return handler(command, args)
      }),
    },
    events: { on: () => ({ dispose: () => {} }), emit: () => {} },
    storage: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      flush: async () => {},
    },
  } as unknown as PluginContext
  return { context, calls }
}

function baseHandler(overrides: Record<string, unknown> = {}) {
  return (command: string, args?: Record<string, unknown>): unknown => {
    if (command in overrides) {
      const value = overrides[command]
      return typeof value === 'function'
        ? (value as (args?: Record<string, unknown>) => unknown)(args)
        : value
    }
    if (command === 'news.list-sources') return { sources: [] }
    if (command === 'news.list-circles') return { circles: [] }
    if (command === 'news.list-credentials') return { credentials: [] }
    if (command === 'news.list-fetch-log') return { entries: [] }
    if (command === 'news.get-settings') return DISABLED_SETTINGS
    return {}
  }
}

describe('useSettings', () => {
  it('AI 默认关闭且没有已保存密钥', async () => {
    const { context: ctx } = context(baseHandler())
    const controller = useSettings(ctx)
    await controller.loadAll()
    expect(controller.settings.value?.aiEnabled).toBe(false)
    expect(controller.settings.value?.aiApiKeyLen).toBe(0)
  })

  it('已保存的密钥只回掩码字段，不含明文', async () => {
    const { context: ctx } = context(baseHandler({ 'news.get-settings': SAVED_SETTINGS }))
    const controller = useSettings(ctx)
    await controller.loadAll()
    const settings = controller.settings.value!
    expect(settings.aiApiKeyTail).toBe('abcd')
    expect(JSON.stringify(settings)).not.toContain('sk-')
  })

  it('保存设置时把空密钥视为「不修改」，不发送 aiApiKey 字段', async () => {
    const { context: ctx, calls } = context(baseHandler())
    const controller = useSettings(ctx)
    await controller.saveAi({
      aiEnabled: true,
      aiBaseUrl: ' https://api.openai.com ',
      aiModel: ' gpt-4o-mini ',
      aiApiKey: '',
    })
    const call = calls.find((entry) => entry.command === 'news.set-settings')
    expect(call?.args).toMatchObject({
      aiEnabled: true,
      aiBaseUrl: 'https://api.openai.com',
      aiModel: 'gpt-4o-mini',
    })
    expect(call?.args && 'aiApiKey' in call.args).toBe(false)
  })

  it('关闭状态下调用摘要命令由后端拦截（错误透传，不伪造结果）', async () => {
    const { context: ctx } = context(
      baseHandler({
        'news.ai-summarize': () => {
          throw new Error('ai.disabled: ai summary is disabled in settings')
        },
      }),
    )
    const controller = useSettings(ctx)
    await expect(controller.summarize(['i1'])).rejects.toThrow('ai.disabled')
    expect(controller.aiProgress.value).toBeNull()
  })

  it('批量摘要分片推进并累计结果', async () => {
    let call = 0
    const { context: ctx } = context(
      baseHandler({
        'news.ai-summarize': (args?: Record<string, unknown>) => {
          call += 1
          const ids = (args?.itemIds as string[]) ?? []
          return {
            results: ids.map((id) => ({ itemId: id, ok: true, summary: 'x' })),
            okCount: ids.length,
            failedCount: 0,
          }
        },
      }),
    )
    const controller = useSettings(ctx)
    const ids = Array.from({ length: 12 }, (_, index) => `i${index}`)
    const result = await controller.summarize(ids)
    expect(call).toBe(3)
    expect(result.okCount).toBe(12)
    expect(controller.aiProgress.value).toBeNull()
  })

  it('源表单提交把权重夹到设计域', async () => {
    const { context: ctx, calls } = context(baseHandler())
    const controller = useSettings(ctx)
    await controller.addSource({
      name: ' Feed ',
      kind: 'rss',
      url: ' https://example.com/feed ',
      circleId: null,
      weight: 9,
    })
    const call = calls.find((entry) => entry.command === 'news.add-source')
    expect(call?.args).toMatchObject({
      name: 'Feed',
      url: 'https://example.com/feed',
      weight: 2,
    })
  })

  it('自启状态不可读时显性标记，不猜开关', async () => {
    const { context: ctx } = context(baseHandler())
    const controller = useSettings(ctx)
    await controller.loadAutostart()
    expect(controller.autostart.value).toEqual({ readable: false, enabled: null })
  })

  it('宿主清单带 autostart 时按真实值展示', async () => {
    const { context: ctx } = context(baseHandler())
    const invokeHost = vi.fn(async () => [
      { id: 'com.wasmnest.news', autostart: true },
      { id: 'com.wasmnest.bedcode', autostart: false },
    ])
    const controller = useSettings(ctx, invokeHost as never)
    await controller.loadAutostart()
    expect(controller.autostart.value).toEqual({ readable: true, enabled: true })
  })
})
