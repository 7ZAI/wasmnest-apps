/**
 * 终端新手引导步骤 i18n 完整性测试
 *
 * 防回归：组件引用的 titleKey/descKey/tryHintKey 必须在 zh-CN 与 en 两份
 * 语言文件中都存在（此前发生过步骤标题 key 漏加、真机渲染裸 key 的问题）。
 * key 定义在 config/terminalOnboardingSteps.ts（裸 key），落在本应用 domain 的
 * `terminal.*` 命名空间（2026-10-27：文案归 app 自持，不再读宿主 locales）。
 */
import { describe, it, expect } from 'vitest'
import { TERMINAL_ONBOARDING_STEPS } from '../config/onboardingSteps'
import { messagesEn, messagesZhCN } from '../i18n'

const catalogs = { 'zh-CN': messagesZhCN, en: messagesEn } as const

function resolve(catalog: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, catalog)
}

describe('terminal onboarding steps i18n completeness', () => {
  it('every step exposes non-empty required keys（targetSelector/titleKey/descKey）', () => {
    expect(TERMINAL_ONBOARDING_STEPS.length).toBeGreaterThanOrEqual(9)
    for (const step of TERMINAL_ONBOARDING_STEPS) {
      // 必填字段：非空字符串（toThrow 于空/缺 key 的步骤）
      expect(step.targetSelector, `${step.titleKey} targetSelector`).toBeTruthy()
      expect(step.titleKey, `titleKey`).toBeTruthy()
      expect(step.descKey, `descKey`).toBeTruthy()
      // 可选 tryHintKey：一旦声明必须是非空字符串（不允许空串占位）
      if (step.tryHintKey !== undefined) {
        expect(step.tryHintKey.length, `${step.titleKey} tryHintKey non-empty`).toBeGreaterThan(0)
      }
    }
  })

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`resolves all step keys in ${locale} under terminal.*`, () => {
      for (const step of TERMINAL_ONBOARDING_STEPS) {
        const keys = [step.titleKey, step.descKey]
        // tryHintKey 可选：声明了才要求 i18n 可解析（不静默放行缺失 key）
        if (step.tryHintKey) keys.push(step.tryHintKey)
        for (const key of keys) {
          const value = resolve(catalog, `terminal.${key}`)
          expect(value, `${locale}: terminal.${key} 缺失`).toBeDefined()
          expect(
            typeof value === 'string' && value.length > 0,
            `${locale}: terminal.${key} 非空`,
          ).toBe(true)
        }
      }
    })
  }
})
