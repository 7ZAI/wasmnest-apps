/**
 * 终端显示设置 store（issue #19 第 4 项：从 inputAssistant 拆出）
 *
 * 为什么单独一个 store：`InputAssistantSettings` 此前同时承载「输入辅助」
 * （快捷键条数量 / 悬浮球 / 手势）与「终端显示」（字号 / 字间距 / 主题 /
 * 常驻工具栏 / 新手引导），成了终端设置的倾倒场。两者生命周期不同——显示
 * 设置由终端渲染消费，输入辅助由快捷键面板消费——混在一个 store 里导致
 * 任何一侧改动都要读整个 blob。
 *
 * 持久化兼容：新键 `terminal_display_settings`；首次加载时若新键缺失，从旧
 * blob `input_assistant_settings` 抽取显示字段并**一次性**迁移（写入新键即
 * 迁移完成标记）。旧 blob 里残留的显示字段自此不再被读写，由 inputAssistant
 * store 的 sanitize 在下一次保存时自然清掉。
 *
 * v1→v2 出厂默认升级沿用旧实现口径：旧版本键 < 2 时，`terminalTheme == null`
 * 视为 v1 出厂值（升级为 dark + 手动标记）、`headerToolbarItems == ['folder']`
 * 视为 v1 出厂值（补 settings 常驻）；v2 起 null / 精简工具栏是用户的合法选择，
 * 不得再覆盖。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { logger } from './host'

export interface TerminalDisplaySettings {
  /** 终端字体大小（10-24） */
  fontSize: number
  /** 终端字间距（px，0-4；0 = 不加，字间留白仅来自字体自身） */
  letterSpacing: number
  /** 终端主题名（dark/light/dracula 等），null = 跟随外观设置 */
  theme: string | null
  /** 用户是否手动指定了终端主题（false 时跟随外观设置） */
  isThemeUserSet: boolean
  /** 终端新手引导待展示：首次进入终端页自动弹出教程，展示后置 false */
  onboardingPending: boolean
  /** 终端 Header 常驻工具按钮 key 列表（其余收入溢出菜单） */
  headerToolbarItems: string[]
}

export const DEFAULT_TERMINAL_DISPLAY_SETTINGS: TerminalDisplaySettings = {
  fontSize: 12,
  letterSpacing: 0,
  theme: 'dark',
  isThemeUserSet: true,
  onboardingPending: true,
  headerToolbarItems: ['folder', 'settings'],
}

/** 新存档键（显示设置唯一真源） */
export const TERMINAL_DISPLAY_STORAGE_KEY = 'terminal_display_settings'
/** 旧存档：显示字段曾与输入辅助设置同住一个 blob（只读一次，用于迁移） */
const LEGACY_SETTINGS_KEY = 'input_assistant_settings'
const LEGACY_VERSION_KEY = 'input_assistant_settings_version'
/** 旧 store 的 v2 出厂默认版本（见文件头注） */
const LEGACY_V2 = 2

function pickStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.filter((v): v is string => typeof v === 'string')
  return items.length > 0 ? items : null
}

/** 从旧 blob 抽取显示字段（含 v1→v2 出厂默认升级） */
function fromLegacy(legacy: Record<string, unknown>): TerminalDisplaySettings {
  const legacyVersion = Number(localStorage.getItem(LEGACY_VERSION_KEY) ?? 0)

  let theme = typeof legacy.terminalTheme === 'string' ? legacy.terminalTheme : null
  let isThemeUserSet = legacy.isTerminalThemeUserSet === true
  let toolbar = pickStrings(legacy.headerToolbarItems) ?? [
    ...DEFAULT_TERMINAL_DISPLAY_SETTINGS.headerToolbarItems,
  ]

  if (legacyVersion < LEGACY_V2) {
    if (theme == null) {
      theme = DEFAULT_TERMINAL_DISPLAY_SETTINGS.theme
      isThemeUserSet = DEFAULT_TERMINAL_DISPLAY_SETTINGS.isThemeUserSet
    }
    if (toolbar.length === 1 && toolbar[0] === 'folder') {
      toolbar = [...DEFAULT_TERMINAL_DISPLAY_SETTINGS.headerToolbarItems]
    }
  }

  return {
    fontSize:
      typeof legacy.terminalFontSize === 'number'
        ? legacy.terminalFontSize
        : DEFAULT_TERMINAL_DISPLAY_SETTINGS.fontSize,
    letterSpacing:
      typeof legacy.terminalLetterSpacing === 'number'
        ? legacy.terminalLetterSpacing
        : DEFAULT_TERMINAL_DISPLAY_SETTINGS.letterSpacing,
    theme,
    isThemeUserSet,
    onboardingPending:
      typeof legacy.terminalOnboardingPending === 'boolean'
        ? legacy.terminalOnboardingPending
        : DEFAULT_TERMINAL_DISPLAY_SETTINGS.onboardingPending,
    headerToolbarItems: toolbar,
  }
}

export const useTerminalDisplayStore = defineStore('terminalDisplay', () => {
  const settings = ref<TerminalDisplaySettings>({ ...DEFAULT_TERMINAL_DISPLAY_SETTINGS })

  function persist() {
    localStorage.setItem(TERMINAL_DISPLAY_STORAGE_KEY, JSON.stringify(settings.value))
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(TERMINAL_DISPLAY_STORAGE_KEY)
      if (raw) {
        settings.value = { ...DEFAULT_TERMINAL_DISPLAY_SETTINGS, ...JSON.parse(raw) }
        return
      }

      // 首次启动本版本：从旧 blob 迁移显示字段（写入新键即迁移完成标记）
      const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY)
      if (!legacyRaw) return
      settings.value = fromLegacy(JSON.parse(legacyRaw) as Record<string, unknown>)
      persist()
    } catch (e) {
      logger.error('[terminalDisplay] Failed to load display settings:', e)
    }
  }

  function saveSettings(patch: Partial<TerminalDisplaySettings>) {
    settings.value = { ...settings.value, ...patch }
    persist()
  }

  function resetSettings() {
    settings.value = { ...DEFAULT_TERMINAL_DISPLAY_SETTINGS }
    persist()
  }

  // 初始化：与 inputAssistant 同口径，store 构造即加载
  loadFromStorage()

  return { settings, loadFromStorage, saveSettings, resetSettings }
})
