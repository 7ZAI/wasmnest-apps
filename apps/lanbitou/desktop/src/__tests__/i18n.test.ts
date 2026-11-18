import { describe, expect, it } from 'vitest'
import en from '../i18n/en'
import zhCN from '../i18n/zh-CN'

describe('i18n 消息表', () => {
  it('zh-CN 与 en 键集合完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
  })

  it('没有空文案', () => {
    for (const [key, value] of Object.entries({ ...zhCN, ...en })) {
      expect(typeof value, `${key} 必须是字符串`).toBe('string')
      expect((value as string).trim(), `${key} 不能为空`).not.toBe('')
    }
  })

  it('占位符在两种语言中一致', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
      expect(placeholders(en[key]), `${key} 占位符不一致`).toEqual(placeholders(zhCN[key]))
    }
  })
})
