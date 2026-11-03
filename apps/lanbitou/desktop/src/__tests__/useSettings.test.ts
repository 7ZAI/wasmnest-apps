import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../composables/useSettings'
import { DEFAULT_SETTINGS } from '../types'

describe('normalizeSettings', () => {
  it('缺项回退默认值', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('非法值回退默认值', () => {
    const settings = normalizeSettings({
      autoSaveMode: 'bogus',
      theme: 'neon',
      fontFamily: 'comic',
      language: 'fr',
      viewMode: 'bogus',
      timeDivider: { position: 'left', triggerInterval: 7, format: '   ' },
    })
    expect(settings.autoSaveMode).toBe('realtime')
    expect(settings.theme).toBe('system')
    expect(settings.fontFamily).toBe('monospace')
    expect(settings.language).toBe('zh-CN')
    expect(settings.viewMode).toBe('split')
    expect(settings.timeDivider.position).toBe('bottom')
    expect(settings.timeDivider.triggerInterval).toBe(5)
    expect(settings.timeDivider.format).toBe(DEFAULT_SETTINGS.timeDivider.format)
  })

  it('数值收敛到范围', () => {
    expect(normalizeSettings({ fontSize: 99 }).fontSize).toBe(24)
    expect(normalizeSettings({ fontSize: 2 }).fontSize).toBe(12)
    expect(normalizeSettings({ autoSaveDebounce: 1 }).autoSaveDebounce).toBe(100)
    expect(normalizeSettings({ autoSaveDebounce: 99_999 }).autoSaveDebounce).toBe(5000)
  })

  it('合法值原样保留', () => {
    const settings = normalizeSettings({
      autoSaveMode: 'onBlur',
      autoSaveDebounce: 800,
      theme: 'dark',
      fontSize: 18,
      fontFamily: 'serif',
      language: 'en',
      viewMode: 'preview',
      timeDivider: {
        enabled: false,
        format: '## {{date}}',
        position: 'cursor',
        triggerInterval: 15,
      },
    })
    expect(settings.autoSaveMode).toBe('onBlur')
    expect(settings.autoSaveDebounce).toBe(800)
    expect(settings.theme).toBe('dark')
    expect(settings.fontSize).toBe(18)
    expect(settings.fontFamily).toBe('serif')
    expect(settings.language).toBe('en')
    expect(settings.viewMode).toBe('preview')
    // 15 不在允许档位内 → 回退默认 5
    expect(settings.timeDivider.triggerInterval).toBe(5)
    expect(settings.timeDivider).toEqual({
      enabled: false,
      format: '## {{date}}',
      position: 'cursor',
      triggerInterval: 5,
    })
  })
})
