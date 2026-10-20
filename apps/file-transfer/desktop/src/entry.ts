/**
 * File Transfer app 前端挂载入口（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 契约（与宿主 `src/composables/useAppMount.ts` 逐字同形）：`mountApp(root, env)`
 * 由宿主壳装载后挂载本 app 独立界面（AppRoot：FileTransferView 全屏面 + 首连
 * 确认弹窗 + 对等通知）。本包自带全部依赖（无 __WASMNEST_SHARED__ 外部化）。
 */
import { createApp, type App as VueApp } from 'vue'
import AppRoot from './AppRoot.vue'
import PreviewCard from './preview/PreviewCard.vue'
import i18n from './i18n'
import { createAppContext } from './appContext'
import { startPeerNotifications } from './notifications'
import './style.css'
import './styles.css'

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

// ==================== 预览契约（宿主 useAppMount 同形声明；2026-10-20 卡片预览） ====================

/** 应用预览环境（宿主注入；只读面） */
export interface AppPreviewEnv {
  appId: string
  /** 应用上次自报的内部路径；无记录 = undefined（应用自行回落落地页） */
  lastRoute?: string
  /** 本 app 插件面命令（与主界面同一令牌 / 权限；预览侧只读使用） */
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  /** 本 app 插件 KV 只读访问 */
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  locale: string
  theme: string
  platform?: string
}

/** 应用预览句柄 */
export interface AppPreviewHandle {
  unmount(): Promise<void>
}

/** entry.ts 可选导出；未导出 = 不支持预览 */
export type MountPreview = (root: HTMLElement, env: AppPreviewEnv) => Promise<AppPreviewHandle>

let vueApp: VueApp | null = null

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  const app = createApp(AppRoot)
  app.use(i18n)
  const appCtx = createAppContext(env)
  app.provide('pluginContext', appCtx)
  app.mount(root)
  vueApp = app

  // 对等连接上下线通知：对等链路是本插件的业务事实，通知随插件归属（原 activate 期副作用）
  let peerNotif: { dispose(): void } | null = null
  try {
    peerNotif = startPeerNotifications(appCtx)
  } catch (e) {
    console.warn('[File Transfer] peer notifications init failed:', e)
  }

  return {
    async unmount() {
      peerNotif?.dispose()
      peerNotif = null
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

/**
 * 多任务卡片只读预览面（宿主在卡片缩略区挂载；失败 / 超时宿主回退品牌卡）
 *
 * 只读、点时刻：PreviewCard 挂出骨架后立即返回句柄，数据在组件内异步取一次。
 * 不启动通知、不订阅事件、不换发令牌、不写存储；预览环境只含 appInvoke /
 * appStorageGet 读面（AppPreviewEnv）。
 */
export async function mountPreview(
  root: HTMLElement,
  env: AppPreviewEnv,
): Promise<AppPreviewHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') i18n.global.locale.value = env.locale
  const app = createApp(PreviewCard, { env })
  app.use(i18n)
  app.mount(root)
  return {
    async unmount() {
      app.unmount()
    },
  }
}
