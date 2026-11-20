import { describe, expect, it } from 'vitest'
import zhCN from '../../i18n/zh-CN'
import en from '../../i18n/en'

describe('i18n key 完整性', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    const zhKeys = Object.keys(zhCN).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('文案值非空', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(typeof value, key).toBe('string')
      expect(value.trim().length, key).toBeGreaterThan(0)
    }
  })
})