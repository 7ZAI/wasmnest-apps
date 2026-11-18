/**
 * 网络配置中心页面上下文（独立挂载包形态）
 *
 * 页面经 `inject('pluginContext')` 取数。命令 / 存储由宿主经 `AppMountEnv` 注入；
 * 翻译走本包自持的 i18n 实例（命名空间见 `i18n/index.ts`）。
 *
 * 宿主面命令（`plugin_list_loaded`，用于业务注册表补显示名）走 `hostInvoke`，
 * 与插件面 `appInvoke` 分开——前者不是本 app 的命令面。
 */
import i18n, { MESSAGE_NAMESPACE } from './i18n'
import type { AppMountEnv } from './entry'

/** 页面注入的上下文（宿主注入面的窄适配） */
export interface NetConfigContext {
  id: string
  /** 本 app 插件面命令（带宿主签发的调用凭证） */
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  /** 宿主面命令（只读；业务注册表等宿主事实） */
  hostInvoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  i18n: {
    t(key: string, params?: Record<string, unknown>): string
  }
  /** 当前语言（宿主注入；`en` / `zh-CN`） */
  locale(): string
}

/** 创建 app 直连上下文（entry.ts mount 前调用，经 app.provide 全局注入） */
export function createAppContext(env: AppMountEnv): NetConfigContext {
  return {
    id: env.appId,

    appInvoke: (command, ...args) => env.appInvoke(command, ...args),

    hostInvoke: (command, args) => env.invoke(command, args),

    i18n: {
      t(key: string, params?: Record<string, unknown>): string {
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },

    locale: () => env.locale,
  }
}
