/**
 * Auth Center 页面上下文（独立挂载包形态）
 *
 * 页面经 `inject('pluginContext')` 取数。本模块只做一次适配：命令 / 存储由宿主经
 * `AppMountEnv` 注入；翻译走本包自持的 i18n 实例（命名空间见 `i18n/index.ts`）。
 *
 * 本 app **不订阅宿主事件**（当前只读就位状态）：接入配对码 / 连接事件后在此加
 * `events` 通道，不要在各页面里直接 `listen`。
 */
import i18n, { MESSAGE_NAMESPACE } from './i18n'
import type { AppMountEnv } from './entry'

/** 页面注入的上下文（宿主注入面的窄适配） */
export interface AuthCenterContext {
  id: string
  /** 本 app 插件面命令（带宿主签发的调用凭证） */
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  i18n: {
    t(key: string, params?: Record<string, unknown>): string
  }
  /** 当前语言（宿主注入；`en` / `zh-CN`） */
  locale(): string
}

/** 创建 app 直连上下文（entry.ts mount 前调用，经 app.provide 全局注入） */
export function createAppContext(env: AppMountEnv): AuthCenterContext {
  return {
    id: env.appId,

    appInvoke: (command, ...args) => env.appInvoke(command, ...args),

    storage: {
      get: (key) => env.appStorageGet(key),
      set: (key, value) => env.appStorageSet(key, value),
      delete: (key) => env.appStorageDelete(key),
    },

    i18n: {
      t(key: string, params?: Record<string, unknown>): string {
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },

    locale: () => env.locale,
  }
}
