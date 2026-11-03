/**
 * Lanbitou app 内直连上下文（独立挂载包形态）
 *
 * 页面经 `inject('pluginContext')` 取数；命令 / 存储由宿主经 AppMountEnv 注入
 * （useAppMount），本模块只做一次适配。`i18n.t` 按 `com.wasmnest.lanbitou.*`
 * 扁平命名空间补前缀（旧「运行期自动加插件 ID 前缀」的静态化）。
 */
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import type { AppMountEnv } from './entry'
import i18n, { MESSAGE_NAMESPACE } from './i18n'

/** 创建 app 直连上下文（entry.ts mount 前调用，经 app.provide 全局注入） */
export function createAppContext(env: AppMountEnv): PluginContext {
  const context = {
    id: env.appId,
    extensionPath: '',
    appUpdate: env.appUpdate,

    commands: {
      async execute(id: string, ...args: unknown[]): Promise<any> {
        return env.appInvoke(id, ...args)
      },
    },

    events: {
      on: () => ({ dispose() {} }),
      emit(): void {
        // Lanbitou 不使用应用事件总线
      },
    },

    storage: {
      async get<T = any>(key: string): Promise<T | undefined> {
        return env.appStorageGet<T>(key)
      },
      async set(key: string, value: any): Promise<void> {
        return env.appStorageSet(key, value)
      },
      async delete(key: string): Promise<void> {
        return env.appStorageDelete(key)
      },
      async flush(): Promise<void> {
        // 存储是即时写入的，flush 为 no-op
      },
    },

    i18n: {
      getI18n(): unknown {
        return i18n
      },
      t(key: string, params?: Record<string, unknown>): string {
        // 扁平 key 自带命名空间（旧「运行期自动加插件 ID 前缀」的静态化）
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },
  }

  return context as unknown as PluginContext
}
