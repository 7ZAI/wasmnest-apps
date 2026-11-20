import { describe, expect, it } from 'vitest'
import zhCN from '../i18n/zh-CN'
import en from '../i18n/en'

describe('移动端 i18n key 完整性', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
  })
})