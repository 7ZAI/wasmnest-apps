/**
 * 传输加密固定开启（穿透方案不变量 12）——设置读面契约测试
 *
 * 被测：`src/composables/useSettings.ts`。
 *
 * | 契约 | 规则 | 预期 |
 * |---|---|---|
 * | ENC-1 | 后端回执 `encryption:false`（旧库 / 旧宿主） | 前端不采信，恒为 `true`（无明文开关可展示） |
 * | ENC-2 | 不得暴露关闭入口 | 返回面没有 `setEncryption` |
 * | ENC-3 | 缺省值 | 首次加载前 `encryption` 即为 `true` |
 *
 * 面板结构（无关闭按钮 / 只读「始终加密」徽标）由真实宿主 E2E 用例锁定
 * （`e2e/specs/file-transfer.spec.ts`），此处不引入 SDK UI 依赖。
 */
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { useSettings } from '../composables/useSettings'

function makeContext(getSettings: unknown): PluginContext {
  const execute = vi.fn(async (command: string) =>
    command === 'file-transfer.get-settings' ? getSettings : undefined,
  )
  return {
    id: 'com.wasmnest.file-transfer',
    i18n: { t: (key: string) => key },
    commands: { execute },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    events: { on: vi.fn(() => ({ dispose: vi.fn() })), emit: vi.fn() },
  } as unknown as PluginContext
}

const wireSettings = {
  roots: [],
  policy_mode: 'ask',
  ask_timeout_sec: 60,
  download_dir: '',
  encryption: false,
  concurrency: 3,
}

describe('ENC-1 后端旧值不采信', () => {
  it('should_keepEncryptionOn_when_backendReportsDisabled', async () => {
    const api = useSettings(makeContext(wireSettings))
    await api.load()
    expect(api.settings.value.encryption).toBe(true)
  })
})

describe('ENC-2 无关闭入口', () => {
  it('should_notExposeDisableApi', () => {
    const api = useSettings(makeContext(wireSettings)) as unknown as Record<string, unknown>
    expect('setEncryption' in api).toBe(false)
  })
})

describe('ENC-3 缺省即加密', () => {
  it('should_defaultToEncryptionOn_beforeLoad', () => {
    const api = useSettings(makeContext(wireSettings))
    expect(api.settings.value.encryption).toBe(true)
  })
})
