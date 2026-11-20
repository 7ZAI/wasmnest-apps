import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountApp, mountContract, type AppMountEnv } from '../entry'

const settings = {
  mode: 'auto',
  local: { enabled: true, modelId: 'small', language: 'auto' },
  remote: { enabled: false, endpoint: '', adapter: 'openai-compatible', model: 'whisper-1' },
}

function env(overrides: Record<string, unknown> = {}) {
  const appInvoke = vi.fn(async (command: string) => {
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
  })
  return {
    appId: 'com.wasmnest.speech',
    mountContract: '1',
    invoke: vi.fn(),
    appInvoke,
    appStorageGet: vi.fn(async () => undefined),
    locale: 'zh-CN',
    theme: 'light',
    initialRoute: '',
    ...overrides,
  } as unknown as AppMountEnv & { appInvoke: typeof appInvoke }
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

  it('shows honest unknown channel and empty model states after load', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const handle = await mountApp(root, env())
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(root.querySelector('[data-testid="speech-channel-local"]')?.textContent).toContain(
      '未探测',
    )
    const local = root.querySelector('[data-testid="speech-local"]')
    expect(local?.textContent).toContain('暂无可用模型')
    expect(local?.textContent).not.toContain('加载中')

    await handle.unmount()
    root.remove()
  })

  it('renders localized record headers and keeps error kinds addressable', async () => {
    const appInvoke = vi.fn(async (command: string) => {
      switch (command) {
        case 'speech.settings-get':
          return { settings, hasKey: false }
        case 'speech.models-list':
          return { models: [] }
        case 'speech.channels-probe':
          return { channels: [{ channel: 'local', available: true }] }
        case 'speech.records-list':
          return [
            {
              id: 'r1',
              createdAt: 1700000000000,
              channel: 'local',
              modelId: 'small',
              audioBytes: 1024,
              textChars: 12,
              elapsedMs: 2400,
              errorKind: 'model-not-installed',
            },
          ]
        default:
          return null
      }
    })
    const root = document.createElement('div')
    document.body.append(root)
    const handle = await mountApp(root, env({ appInvoke }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    const records = root.querySelector('[data-testid="speech-records"]')
    expect(records?.querySelector('table')).not.toBeNull()
    expect(records?.querySelector('th')?.getAttribute('scope')).toBe('col')
    expect(records?.textContent).toContain('时间')
    expect(records?.textContent).toContain('字节')
    expect(records?.textContent).toContain('model-not-installed')
    expect(records?.textContent).not.toContain('elapsed')

    await handle.unmount()
    root.remove()
  })

  it('surfaces validation errors and focuses the invalid endpoint', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const handle = await mountApp(root, env())
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    const remote = root.querySelector<HTMLInputElement>('[data-testid="speech-remote-enabled"]')
    if (!remote) throw new Error('remote switch missing')
    remote.checked = true
    remote.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    root
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    const error = root.querySelector('[data-testid="speech-form-error"]')
    expect(error?.textContent).toContain('识别端点')
    const endpoint = root.querySelector<HTMLInputElement>('[data-testid="speech-endpoint"]')
    expect(endpoint?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(endpoint)

    await handle.unmount()
    root.remove()
  })
})