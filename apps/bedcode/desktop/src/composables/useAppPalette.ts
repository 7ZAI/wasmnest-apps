/**
 * 应用主题色板（设置归属修正 2026-10-19）
 *
 * 色板是**本应用的产品外观**（B5 业务默认值 / 策略），不归宿主：宿主只掌握窗口
 * 深浅色（:root.dark），色板选择由应用设置页持有并落本 app 的 KV。
 *
 * 作用域：色板只写在应用根容器（App.vue 的 `.app-theme-root[data-palette]`），
 * 对应变量组在 style.css 里以该容器为选择器前缀——壳标题栏 / 系统页在容器外，
 * 不会被应用主题染色。宿主 `:root[data-palette]` 的全局色板机制因此不再使用。
 *
 * 数据面：宿主注入的 `pluginContext.storage`（plugin_storage_*，凭证已绑定本
 * app）；键名 `appearance.palette` 带域前缀，避免与应用其它 KV 键冲突。
 */

import { ref } from 'vue'
import { logger } from '@/utils/frontendLogger'

/** 可选色板（与 style.css 的 `.app-theme-root[data-palette='x']` 变量组一一对应） */
export const APP_PALETTES = ['warm', 'cool', 'forest', 'ocean', 'sunset', 'violet'] as const

export type AppPalette = (typeof APP_PALETTES)[number]

/** 默认色板 = 宿主 :root 的 warm 变量组（不额外覆盖） */
export const DEFAULT_PALETTE: AppPalette = 'warm'

/** KV 键（本应用自持） */
const STORAGE_KEY = 'appearance.palette'

/** 色板只影响应用根容器，且同一时刻只有一个应用实例 —— 模块级单例足够 */
const palette = ref<AppPalette>(DEFAULT_PALETTE)

/** 已加载标记（设置页重复挂载 / KeepAlive 不重复读 KV） */
let loaded = false

/** 宿主注入的 KV 通道（由 App.vue 首次调用时绑定） */
export interface PaletteStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

let storage: PaletteStorage | null = null

function isAppPalette(value: unknown): value is AppPalette {
  return typeof value === 'string' && (APP_PALETTES as readonly string[]).includes(value)
}

/** 绑定 KV 通道并从存储恢复色板（幂等；失败保持默认色板，不阻断挂载） */
export async function loadAppPalette(nextStorage: PaletteStorage): Promise<void> {
  storage = nextStorage
  if (loaded) return
  loaded = true
  try {
    const saved = await storage.get<string>(STORAGE_KEY)
    palette.value = isAppPalette(saved) ? saved : DEFAULT_PALETTE
  } catch (e) {
    logger.warn('[AppPalette] load failed, using default palette:', e)
  }
}

/**
 * 切换色板：先更新响应式状态（即时生效），再落 KV。
 *
 * 写失败不回滚界面——用户看到的就是当前会话的选择，下次启动回落到已存值；
 * 这里只记日志，由设置页文案提示保存失败（不产生「界面已换、存储未变」的静默
 * 状态伪装：日志与错误提示都可见）。
 */
export async function setAppPalette(value: AppPalette): Promise<void> {
  palette.value = value
  if (!storage) return
  try {
    await storage.set(STORAGE_KEY, value)
  } catch (e) {
    logger.error('[AppPalette] save failed:', e)
    throw e
  }
}

/** 应用色板状态（模块级单例；组件只读 ref，切换走 setAppPalette） */
export function useAppPalette(): { palette: typeof palette } {
  return { palette }
}
