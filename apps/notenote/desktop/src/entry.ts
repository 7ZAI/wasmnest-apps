/**
 * notenote app 前端挂载入口（独立构建的挂载包）
 *
 * 契约：mountApp(root, env) → AppMountHandle
 */

import { createApp, type App as VueApp } from 'vue'
import './style.css'
import App from './App.vue'
import i18n, { MESSAGE_NAMESPACE } from './i18n'
import { createAppContext } from './appContext'

export const mountContract = '1'

export interface AppMountEnv {
  appId: string
  mountContract: string
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  appUpdate?: {
    check: () => Promise<{
      status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'incompatible' | 'error'
      latestVersion?: string
      currentVersion?: string
      reason?: { key: string; params?: Record<string, string> }
    }>
  }
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  appStorageSet: (key: string, value: unknown) => Promise<void>
  appStorageDelete: (key: string) => Promise<void>
  locale: string
  theme: string
  platform?: string
  initialRoute: string
  onEvent?: (type: string, payload: unknown) => void
}

export interface AppMountHandle {
  unmount(): Promise<void>
  setRoute?(route: string): void
  setLocale?(locale: string): void
  setTheme?(theme: string): void
}

let vueApp: VueApp | null = null

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  const app = createApp(App)
  app.use(i18n)

  const appCtx = createAppContext(env)
  app.provide('pluginContext', appCtx)
  app.provide('appEnv', env)

  app.mount(root)
  vueApp = app

  return {
    async unmount() {
      if (vueApp) {
        vueApp.unmount()
        vueApp = null
      }
    },
    setLocale(locale: string) {
      if (locale === 'en' || locale === 'zh-CN') {
        i18n.global.locale.value = locale
      }
    },
  }
}
