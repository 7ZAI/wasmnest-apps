import { ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import {
  DEFAULT_SETTINGS,
  MAX_AUTO_SAVE_DEBOUNCE,
  MAX_FONT_SIZE,
  MIN_AUTO_SAVE_DEBOUNCE,
  MIN_FONT_SIZE,
  type AutoSaveMode,
  type DividerPosition,
  type FontFamily,
  type Locale,
  type NoteSettings,
  type ThemeMode,
} from '../types'

const AUTO_SAVE_MODES: AutoSaveMode[] = ['realtime', 'onBlur', 'manual']
const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const POSITIONS: DividerPosition[] = ['top', 'bottom', 'cursor']
const FONTS: FontFamily[] = ['monospace', 'sans-serif', 'serif']
const LOCALES: Locale[] = ['zh-CN', 'en']
const INTERVALS = [0, 1, 5, 10, 30]

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, n))
}

/** 归一化设置（非法 / 缺项一律回退默认值；与 Rust 侧深合并互补） */
export function normalizeSettings(raw: unknown): NoteSettings {
  const base = DEFAULT_SETTINGS
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const td = (r.timeDivider && typeof r.timeDivider === 'object' ? r.timeDivider : {}) as Record<
    string,
    unknown
  >

  return {
    autoSaveMode: pick(r.autoSaveMode, AUTO_SAVE_MODES, base.autoSaveMode),
    autoSaveDebounce: clamp(
      r.autoSaveDebounce,
      MIN_AUTO_SAVE_DEBOUNCE,
      MAX_AUTO_SAVE_DEBOUNCE,
      base.autoSaveDebounce,
    ),
    theme: pick(r.theme, THEMES, base.theme),
    fontSize: clamp(r.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, base.fontSize),
    fontFamily: pick(r.fontFamily, FONTS, base.fontFamily),
    language: pick(r.language, LOCALES, base.language),
    timeDivider: {
      enabled: typeof td.enabled === 'boolean' ? td.enabled : base.timeDivider.enabled,
      format:
        typeof td.format === 'string' && td.format.trim() !== ''
          ? td.format
          : base.timeDivider.format,
      position: pick(td.position, POSITIONS, base.timeDivider.position),
      triggerInterval:
        typeof td.triggerInterval === 'number' && INTERVALS.includes(td.triggerInterval)
          ? td.triggerInterval
          : base.timeDivider.triggerInterval,
    },
  }
}

/** 设置读写（Rust 侧持久化到 settings.json） */
export function useSettings(ctx: PluginContext) {
  const settings = ref<NoteSettings>(normalizeSettings(DEFAULT_SETTINGS))
  const loaded = ref(false)

  async function load(): Promise<void> {
    const raw = await ctx.commands.execute('lanbitou.read-settings')
    settings.value = normalizeSettings(raw)
    loaded.value = true
  }

  async function save(next: NoteSettings): Promise<void> {
    settings.value = normalizeSettings(next)
    await ctx.commands.execute('lanbitou.save-settings', { settings: settings.value })
  }

  return { settings, loaded, load, save }
}
