/**
 * terminalDisplay store（issue #19 从 inputAssistant 拆出的终端显示设置）
 *
 * 覆盖：出厂默认、保存/重启恢复、旧 blob（`input_assistant_settings`）一次性
 * 迁移、v1→v2 出厂默认升级口径、显式「跟随外观」不被覆盖、重置。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  DEFAULT_TERMINAL_DISPLAY_SETTINGS,
  TERMINAL_DISPLAY_STORAGE_KEY,
  useTerminalDisplayStore,
} from '../displaySettings'

const LEGACY_SETTINGS_KEY = 'input_assistant_settings'
const LEGACY_VERSION_KEY = 'input_assistant_settings_version'

function newStore() {
  return useTerminalDisplayStore()
}

describe('terminalDisplay store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('无存档时给出出厂默认，且不写空存档', () => {
    const store = newStore()
    expect(store.settings).toEqual(DEFAULT_TERMINAL_DISPLAY_SETTINGS)
    expect(localStorage.getItem(TERMINAL_DISPLAY_STORAGE_KEY)).toBeNull()
  })

  it('saveSettings 合并并持久化；新 store 实例恢复', () => {
    const store = newStore()
    store.saveSettings({ fontSize: 16, letterSpacing: 2, theme: 'dracula', isThemeUserSet: true })

    expect(store.settings.fontSize).toBe(16)
    expect(store.settings.theme).toBe('dracula')
    const saved = JSON.parse(localStorage.getItem(TERMINAL_DISPLAY_STORAGE_KEY)!)
    expect(saved.fontSize).toBe(16)
    expect(saved.letterSpacing).toBe(2)

    setActivePinia(createPinia())
    const restored = newStore()
    expect(restored.settings.fontSize).toBe(16)
    expect(restored.settings.theme).toBe('dracula')
  })

  it('首次启动从旧 blob 迁移显示字段并写新键（输入辅助字段不被带入）', () => {
    localStorage.setItem(LEGACY_VERSION_KEY, '2')
    localStorage.setItem(
      LEGACY_SETTINGS_KEY,
      JSON.stringify({
        size: 56,
        quickBarCount: 8,
        floatingBall: true,
        terminalFontSize: 15,
        terminalLetterSpacing: 1,
        terminalTheme: 'light',
        isTerminalThemeUserSet: true,
        terminalOnboardingPending: false,
        headerToolbarItems: ['folder', 'task'],
      }),
    )

    const store = newStore()
    expect(store.settings).toEqual({
      fontSize: 15,
      letterSpacing: 1,
      theme: 'light',
      isThemeUserSet: true,
      onboardingPending: false,
      headerToolbarItems: ['folder', 'task'],
    })

    // 迁移结果落盘：新键即迁移完成标记
    const migrated = JSON.parse(localStorage.getItem(TERMINAL_DISPLAY_STORAGE_KEY)!)
    expect(migrated.fontSize).toBe(15)
    expect(migrated.quickBarCount).toBeUndefined()
    expect(migrated.size).toBeUndefined()
  })

  it('v1 存档一次性升级：null 主题 → dark + 手动标记、[folder] → 补 settings 常驻', () => {
    localStorage.setItem(
      LEGACY_SETTINGS_KEY,
      JSON.stringify({
        terminalTheme: null,
        isTerminalThemeUserSet: false,
        headerToolbarItems: ['folder'],
        terminalFontSize: 12,
      }),
    )

    const store = newStore()
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.isThemeUserSet).toBe(true)
    expect(store.settings.headerToolbarItems).toEqual(['folder', 'settings'])
  })

  it('v2 起显式「跟随外观」与精简工具栏不再被升级覆盖', () => {
    localStorage.setItem(LEGACY_VERSION_KEY, '2')
    localStorage.setItem(
      LEGACY_SETTINGS_KEY,
      JSON.stringify({
        terminalTheme: null,
        isTerminalThemeUserSet: false,
        headerToolbarItems: ['folder'],
      }),
    )

    const store = newStore()
    expect(store.settings.theme).toBeNull()
    expect(store.settings.isThemeUserSet).toBe(false)
    expect(store.settings.headerToolbarItems).toEqual(['folder'])
  })

  it('旧存档缺字段时按默认值回退（字间距/引导）', () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ terminalFontSize: 14 }))

    const store = newStore()
    expect(store.settings.fontSize).toBe(14)
    expect(store.settings.letterSpacing).toBe(0)
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.onboardingPending).toBe(true)
  })

  it('迁移只发生一次：新键存在后不再读旧 blob', () => {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ terminalFontSize: 20 }))
    const first = newStore()
    expect(first.settings.fontSize).toBe(20)

    // 旧 blob 后续被改（例如旧版本回写）不影响已迁移的新键
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify({ terminalFontSize: 10 }))
    setActivePinia(createPinia())
    const second = newStore()
    expect(second.settings.fontSize).toBe(20)
  })

  it('resetSettings 恢复默认并持久化', () => {
    const store = newStore()
    store.saveSettings({ fontSize: 22, theme: 'light', onboardingPending: false })
    store.resetSettings()
    expect(store.settings).toEqual(DEFAULT_TERMINAL_DISPLAY_SETTINGS)
    const saved = JSON.parse(localStorage.getItem(TERMINAL_DISPLAY_STORAGE_KEY)!)
    expect(saved.fontSize).toBe(DEFAULT_TERMINAL_DISPLAY_SETTINGS.fontSize)
  })
})
