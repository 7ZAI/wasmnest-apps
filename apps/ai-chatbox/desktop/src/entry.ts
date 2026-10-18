/**
 * AI Chatbox app 前端挂载入口（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 契约（与宿主 `src/composables/useAppMount.ts` 逐字同形）：`mountApp(root, env)`
 * 由宿主壳装载后挂载本 app 独立界面（ChatView 全屏面）。本包自带全部依赖
 * （无 __WASMNEST_SHARED__ 外部化），独立构建。
 */
import { createApp, type App as VueApp } from 'vue'
import ChatView from './components/ChatView.vue'
import i18n from './i18n'
import { createAppContext } from './appContext'
import './style.css'

// ==================== 挂载契约（宿主 useAppMount 同形声明） ====================

export interface AppMountEnv {
  appId: string
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
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

  const app = createApp(ChatView)
  app.use(i18n)
  app.provide('pluginContext', createAppContext(env))
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
      if (locale === 'en' || locale === 'zh-CN') i18n.global.locale.value = locale
    },
  }
}
