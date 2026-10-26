/**
 * Auth Center 前端挂载入口（桌面挂载包形态）
 *
 * 契约与宿主 `src/shell/mount/useAppMount.ts` 逐字同形：`mountApp(root, env)` 由
 * 宿主壳装载后挂载本服务页面。本包自带全部依赖（无 `__WASMNEST_SHARED__` 外部化），
 * 独立构建。
 */
import { createApp, type App as VueApp } from 'vue'
import AuthCenterView from './components/AuthCenterView.vue'
import PreviewCard from './preview/PreviewCard.vue'
import i18n from './i18n'
import { createAppContext } from './appContext'
import './style.css'

// ==================== 挂载契约（宿主 useAppMount 同形声明） ====================

/**
 * 挂载契约版本（宿主 useAppMount 的 MOUNT_CONTRACT 同值）。
 * 只在 AppMountEnv / AppMountHandle 形状**破坏性**变更时 bump；新增可选字段不 bump。
 */
export const mountContract = '1'

export interface AppMountEnv {
  appId: string
  /** 挂载契约版本（本包声明值；宿主装载时据此判定兼容性） */
  mountContract: string
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

// ==================== 预览契约（宿主 useAppMount 同形声明；drift 锁 L5 钉住） ====================

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

  const app = createApp(AuthCenterView)
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

/**
 * 多任务卡片只读预览面（宿主在卡片缩略区挂载；失败 / 超时宿主回退品牌卡）
 *
 * **不等待数据**：只创建并挂载 PreviewCard（组件内 `onMounted` 异步取一次状态），
 * 立即返回 handle —— 数据慢时不会把整张卡拖成宿主 3s 超时回退。预览实例与主应用
 * 完全隔离（独立 Vue 应用、不碰模块级 `vueApp`），**只读**：不写存储、不换发令牌。
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
