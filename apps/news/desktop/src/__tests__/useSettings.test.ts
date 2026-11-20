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
  readerEnabled: true,
}

const SAVED_SETTINGS: NewsSettings = {
  aiEnabled: true,
  aiBaseUrl: 'https://api.openai.com',
  aiModel: 'gpt-4o-mini',
  aiApiKeyTail: 'abcd',
  aiApiKeyLen: 32,
  readerEnabled: true,
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
    if (command === 'news.reader-stats') {
      return { cachedCount: 0, cachedBytes: 0, archivedCount: 0, archivedBytes: 0 }
    }
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

  it('设置读取失败不拖垮其余数据，并暴露可见错误', async () => {
    const { context: ctx } = context(
      baseHandler({
        'news.get-settings': () => {
          throw new Error('storage.failed: db closed')
        },
        'news.list-circles': () => ({ circles: [{ id: 'c1', name: 'C', weight: 1 }] }),
      }),
    )
    const controller = useSettings(ctx)
    await controller.loadAll()
    expect(controller.error.value).toContain('storage.failed')
    expect(controller.settings.value).toBeNull()
    expect(controller.circles.value).toHaveLength(1)
    expect(controller.loading.value).toBe(false)
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

  it('阅读开关只发送 readerEnabled', async () => {
    const { context: ctx, calls } = context(baseHandler())
    const controller = useSettings(ctx)
    await controller.saveReaderEnabled(true)
    const call = calls.find((entry) => entry.command === 'news.set-settings')
    expect(call?.args).toEqual({ readerEnabled: true })
  })

  it('清除阅读缓存按 mode 调用并刷新用量', async () => {
    let statsCalls = 0
    const { context: ctx, calls } = context(
      baseHandler({
        'news.reader-stats': () => {
          statsCalls += 1
          return { cachedCount: 0, cachedBytes: 0, archivedCount: 0, archivedBytes: 0 }
        },
        'news.clear-reader-cache': (args?: Record<string, unknown>) => ({
          removed: args?.mode === 'all' ? 2 : 1,
          bytes: 10,
        }),
      }),
    )
    const controller = useSettings(ctx)
    const result = await controller.clearReaderCache('all')
    expect(result).toEqual({ removed: 2, bytes: 10 })
    expect(calls.find((entry) => entry.command === 'news.clear-reader-cache')?.args).toEqual({
      mode: 'all',
    })
    expect(statsCalls).toBeGreaterThan(0)
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
