import { describe, expect, it } from 'vitest'
import {
  buildPatch,
  DEFAULT_FORM,
  formFromSettings,
  validateForm,
  type SettingsForm,
} from '../composables/settingsForm'

function form(overrides: Partial<SettingsForm> = {}): SettingsForm {
  return { ...DEFAULT_FORM, ...overrides }
}

describe('speech settings form', () => {
  it('round-trips settings into the form without the key', () => {
    const settings = {
      mode: 'local-only' as const,
      local: { enabled: false, modelId: 'turbo', language: 'zh' },
      remote: {
        enabled: true,
        endpoint: 'https://api.example.com/v1/audio/transcriptions',
        adapter: 'openai-compatible',
        model: 'whisper-1',
      },
    }
    const next = formFromSettings(settings)
    expect(next.mode).toBe('local-only')
    expect(next.localModel).toBe('turbo')
    expect(next.apiKey).toBe('')
    expect(next.clearKey).toBe(false)
  })

  it('requires endpoint and key only when remote is enabled', () => {
    expect(validateForm(form(), false)).toBe(null)
    expect(validateForm(form({ remoteEnabled: true }), false)).toBe('endpointRequired')
    expect(
      validateForm(form({ remoteEnabled: true, endpoint: 'ftp://x' }), false),
    ).toBe('endpointInvalid')
    expect(
      validateForm(
        form({ remoteEnabled: true, endpoint: 'https://api.example.com/v1/audio/transcriptions' }),
        false,
      ),
    ).toBe('apiKeyRequired')
    expect(
      validateForm(
        form({ remoteEnabled: true, endpoint: 'https://api.example.com/v1/audio/transcriptions' }),
        true,
      ),
    ).toBe(null)
  })

  it('writes the key only when supplied or explicitly cleared', () => {
    const patch = buildPatch(form())
    expect('apiKey' in patch).toBe(false)
    expect(buildPatch(form({ apiKey: 'sk-1' })).apiKey).toBe('sk-1')
    expect(buildPatch(form({ clearKey: true })).apiKey).toBe('')
  })

  it('trims endpoint and model in the patch', () => {
    const patch = buildPatch(
      form({
        endpoint: '  https://api.example.com/v1/audio/transcriptions  ',
        remoteModel: '  whisper-1  ',
      }),
    )
    expect((patch.remote as { endpoint: string }).endpoint).toBe(
      'https://api.example.com/v1/audio/transcriptions',
    )
    expect((patch.remote as { model: string }).model).toBe('whisper-1')
  })
})