import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountApp, mountContract } from '../entry'

const settings = {
  mode: 'auto',
  local: { enabled: true, modelId: 'small', language: 'auto' },
  remote: { enabled: false, endpoint: '', adapter: 'openai-compatible', model: 'whisper-1' },
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    appId: 'com.wasmnest.speech',
    mountContract: '1',
    invoke: vi.fn(),
    appInvoke: vi.fn(async (command: string) => {
      switch (command) {
        case 'speech.settings-get':
          return { settings, hasKey: false }
        case 'speech.models-list':
          return { models: [] }
        case 'speech.channels-probe':
          return { channels: [] }
        case 'speech.records-list':
          return []
        default:
          return null
      }
    }),
    appStorageGet: vi.fn(async () => undefined),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '',
    ...overrides,
  } as never
}

describe('speech entry contract', () => {
  it('declares mount contract version 1', () => {
    expect(mountContract).toBe('1')
  })

  it('mounts the service page and loads settings', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const appEnv = env()
    const handle = await mountApp(root, appEnv)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(root.querySelector('[data-testid="speech-title"]')?.textContent).toContain('语音识别服务')
    expect(appEnv.appInvoke).toHaveBeenCalledWith('speech.settings-get')
    await handle.unmount()
    root.remove()
  })
})