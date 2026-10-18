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
