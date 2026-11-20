/**
 * 桌面端界面偏好适配
 *
 * `appStorage` 已按 appId 隔离；这里只把读写失败包装成可观察的 warn，不阻断
 * 界面。偏好损坏时共享组件回落整页形态。
 */
import type { NestPrefsAdapter, NestPreferences } from '@nest-shared/ui/prefs'

const PREFS_KEY = 'nest.prefs'

interface StoragePort {
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  appStorageSet: (key: string, value: unknown) => Promise<void>
}

export function createDesktopPrefs(storage: StoragePort): NestPrefsAdapter {
  return {
    async read(): Promise<NestPreferences | null> {
      try {
        return (await storage.appStorageGet<NestPreferences>(PREFS_KEY)) ?? null
      } catch (error) {
        console.warn('[nest] 界面偏好读取失败：', error)
        return null
      }
    },
    async write(value: NestPreferences): Promise<void> {
      try {
        await storage.appStorageSet(PREFS_KEY, value)
      } catch (error) {
        console.warn('[nest] 界面偏好写入失败：', error)
      }
    },
  }
}