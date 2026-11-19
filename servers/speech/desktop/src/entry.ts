/**
 * Speech 服务前端挂载入口（桌面挂载包形态）
 *
 * 契约与宿主 `useAppMount.ts` 同形：`mountApp(root, env)` 挂载服务页；
 * `mountPreview(root, env)` 提供只读卡片（L5 预览契约）。本页不是听写产品：
 * 只做配置、模型管理与诊断；真正的识别由其他应用经互调 API 使用。
 */
import { createApp } from 'vue'
import SpeechView from './views/SpeechView.vue'
import PreviewCard from './preview/PreviewCard.vue'
import i18n, { normalizeLocale } from './i18n'
import './style.css'

export const mountContract = '1'

export interface AppMountEnv {
  appId: string
  mountContract: string
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  appStorageSet?: (key: string, value: unknown) => Promise<void>
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

export interface AppPreviewEnv {
  appId: string
  lastRoute?: string
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  locale: string
  theme: string
  platform?: string
}

export interface AppPreviewHandle {
  unmount(): Promise<void>
}

function applyLocale(locale: string): void {
  i18n.global.locale.value = normalizeLocale(locale)
}

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  applyLocale(env.locale)
  const app = createApp(SpeechView)
  app.use(i18n)
  app.provide('speechEnv', env)
  app.provide('speechI18n', i18n)
  app.mount(root)
  return {
    async unmount() {
      app.unmount()
    },
    setRoute() {
      // 单页服务：没有内部路由
    },
    setLocale(locale: string) {
      applyLocale(locale)
    },
    setTheme() {
      // 主题由宿主在 documentElement 上切换；本包只消费宿主 token
    },
  }
}

export function mountPreview(root: HTMLElement, env: AppPreviewEnv): AppPreviewHandle {
  applyLocale(env.locale)
  const app = createApp(PreviewCard)
  app.use(i18n)
  app.provide('speechPreviewEnv', env)
  app.mount(root)
  return {
    async unmount() {
      app.unmount()
    },
  }
}