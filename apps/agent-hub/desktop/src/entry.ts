/**
 * Agent Hub app 前端挂载入口（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 契约（与宿主 `src/composables/useAppMount.ts` 逐字同形）：`mountApp(root, env)`
 * 由宿主壳装载后挂载本 app 独立界面（AgentHubView 全屏面）。本包自带全部依赖
 * （无 __WASMNEST_SHARED__ 外部化），独立构建。
 *
 * 与旧 lib 形态（activate(context) + registerSidebarPanel 贡献面）的差异：贡献面
 * 注册退役；视图经 inject('pluginContext') 取数的形态不变（appContext env 适配层）。
 */
import { createApp, type App as VueApp } from 'vue'
import AgentHubView from './components/AgentHubView.vue'
import PreviewCard from './preview/PreviewCard.vue'
import i18n from './i18n'
import { createAppContext } from './appContext'
import './style.css'
import './styles.css'
import datepickerCss from '@vuepic/vue-datepicker/dist/main.css?inline'
import { DATEPICKER_THEME_OVERRIDES } from './index-datepicker-theme'

// ==================== 挂载契约（宿主 useAppMount 同形声明） ====================

/** app 前端挂载环境（宿主注入；令牌/凭证已绑定本 app） */
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

/** app 前端挂载句柄 */
export interface AppMountHandle {
  unmount(): Promise<void>
  setRoute?(route: string): void
  setLocale?(locale: string): void
  setTheme?(theme: string): void
}

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

// ==================== 装载 ====================

let vueApp: VueApp | null = null

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  // 会话日志日期选择器样式（@vuepic/vue-datepicker + 宿主变量主题覆盖）：
  // 幂等注入一次（原 activate 期副作用，挂载包形态移到这里）
  if (!document.getElementById('agent-hub-datepicker-style')) {
    const dpStyleEl = document.createElement('style')
    dpStyleEl.id = 'agent-hub-datepicker-style'
    dpStyleEl.textContent = datepickerCss + DATEPICKER_THEME_OVERRIDES
    document.head.appendChild(dpStyleEl)
  }

  const app = createApp(AgentHubView)
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

// ==================== 多任务卡片预览（可选导出；宿主卡片缩略区挂载） ====================

/**
 * 多任务卡片只读预览面（宿主在卡片缩略区挂载；失败 / 超时宿主回退品牌卡）
 *
 * 与 `mountApp` 的差异：不建主实例（不 provide pluginContext、不注入全局 CSS、
 * 不挂 router / pinia / 通知），只画一张点时刻只读摘要。`mountPreview` **不等待
 * 预览数据**：组件先挂骨架 / 空态并立即返回句柄，取数在组件 onMounted 内异步完成
 * （宿主 3s 超时只覆盖本函数的 resolve，慢命令不得把整张卡打成 fallback）。
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
