import { describe, it, expect } from 'vitest'
import { formatVaultError } from '@nest-shared/vault'

const t = (key: string): string =>
  ({
    'assistant.vault.errorRuntime': 'runtime',
    'assistant.vault.errorNotRunning': 'not-running',
    'assistant.vault.errorUnknown': 'unknown',
  })[key] ?? key

describe('formatVaultError（宿主错误信封 → 可读文案）', () => {
  it('Error 原样展示 message', () => {
    expect(formatVaultError(new Error('boom'), t)).toBe('boom')
  })

  it('字符串原样展示', () => {
    expect(formatVaultError('boom', t)).toBe('boom')
  })

  it('host.internal 信封展示运行时错误文案，不出现 [object Object]', () => {
    const text = formatVaultError({ code: 'host.internal', request_id: 'req-1' }, t)
    expect(text).toBe('runtime')
    expect(text).not.toContain('[object Object]')
  })

  it('host.plugin.not-activated 展示插件未运行文案', () => {
    expect(formatVaultError({ code: 'host.plugin.not-activated' }, t)).toBe('not-running')
  })

  it('params.message 优先于错误码', () => {
    expect(
      formatVaultError({ code: 'host.internal', params: { message: 'detail' } }, t),
    ).toBe('detail')
  })

  it('未知错误码保留 code 便于排查', () => {
    expect(formatVaultError({ code: 'host.x' }, t)).toBe('unknown: host.x')
  })
})