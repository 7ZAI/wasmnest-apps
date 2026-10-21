/**
 * bedcode app 前端挂载入口（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 契约（与宿主 `src/composables/useAppMount.ts` 逐字同形；drift 锁钉住）：
 * - `mountApp(root, env)`：宿主装载本包后调用，在本包自己的 Vue 实例 / 内存
 *   路由 / stores / i18n 上渲染**独立应用界面**（旧侧边栏工作台形态）；
 * - `unmount` / `setRoute` / `setLocale`：宿主卸载与路由、语言同步通道。
 *
 * 本包自带 vue / pinia / vue-router / vue-i18n / vue-sonner / xterm 等全部依赖
 * （无 __WASMNEST_SHARED__ 外部化）——独立包自足，跨仓（三仓拆分）可独立构建。
 */

import { createApp, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import 'vue-sonner/style.css'
import '@xterm/xterm/css/xterm.css'
import '@vuepic/vue-datepicker/dist/main.css'
import './components/task-queue-modal.css'
import './styles/datepicker-theme.css'
import './style.css'
import App from './App.vue'
import PreviewCard from './preview/PreviewCard.vue'
import router from './router'
import i18n from './i18n'
import { initFrontendLogger, logger } from './utils/frontendLogger'
import { createAppContext } from './appContext'
import { useToast } from './composables/useToast'

// ==================== 挂载契约（宿主 useAppMount 同形声明） ====================

/**
 * 挂载契约版本（宿主 useAppMount 的 MOUNT_CONTRACT 同值）。
 * 只在 AppMountEnv / AppMountHandle 形状**破坏性**变更时 bump；新增可选字段不 bump。
 */
export const mountContract = '1'

/** app 前端挂载环境（宿主注入；令牌/凭证已绑定本 app） */
export interface AppMountEnv {
  appId: string
  /** 挂载契约版本（本包声明值；宿主装载时据此判定兼容性） */
  mountContract: string
  /** 宿主面命令（invoke 原样，无附加凭证）：get_app_settings 等 */
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  /** 插件面命令（plugin_invoke，本 app 通道令牌已绑定） */
  appInvoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  /** 本 app 插件 KV 存储（plugin_storage_*，宿主面凭证已绑定） */
  appStorageGet: <T = unknown>(key: string) => Promise<T | undefined>
  appStorageSet: (key: string, value: unknown) => Promise<void>
  appStorageDelete: (key: string) => Promise<void>
  /** 宿主面事实（挂载时快照；后续变更经 setLocale 通知） */
  locale: string
  theme: string
  platform?: string
  /** 宿主路由传入的应用初始路径（应用以内存路由消化） */
  initialRoute: string
  /**
   * 宿主面事件出口（可选）。当前两种事件：
   * - `'navigate'`（payload = 宿主任一已知路径字符串）：请求壳路由跳转；
   * - `'route'`（payload = `{ path: string }`）：应用**自报内部当前页**——应用跑内存
   *   路由，宿主 history 看不到它的内部跳转，壳据此记住「切回该应用时回到哪一页」。
   */
  onEvent?: (type: string, payload: unknown) => void
}

/** app 前端挂载句柄（宿主卸载 / 路由通知用） */
export interface AppMountHandle {
  unmount(): Promise<void>
  setRoute?(route: string): void
  setLocale?(locale: string): void
  setTheme?(theme: string): void
}

// ==================== 预览契约（宿主 useAppMount 同形声明；drift 锁 L5 钉住） ====================

/**
 * 应用预览环境（宿主注入；只读面）
 *
 * 与 {@link AppMountEnv} 的差异是**收窄**：无宿主面 `invoke`、无写 / 删存储、无
 * 事件出口（navigate / route）。预览是卡片里的旁路展示——不能请求宿主导航、
 * 不能写存储、不能上报路由；安全边界仍由 Rust 权限仲裁（预览没有新增权限）。
 */
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

/** 应用预览句柄（卸载卡片时宿主调用；与主实例生命周期独立） */
export interface AppPreviewHandle {
  unmount(): Promise<void>
}

/** entry.ts 可选导出；未导出 = 不支持预览 */
export type MountPreview = (root: HTMLElement, env: AppPreviewEnv) => Promise<AppPreviewHandle>

// ==================== 装载 ====================

let vueApp: VueApp | null = null

/**
 * 页面自报链路（宿主「多任务续接」的数据源）：
 * 宿主壳要记住「切回本应用时回到哪一页」——回主屏时挂载包被卸载，重开是一次全新
 * 挂载，只有宿主存着路径才能续接。本应用跑内存路由，宿主 history 看不到内部跳转，
 * 故每次导航后主动把 fullPath 上报给 `env.onEvent('route')`。
 *
 * 三个模块级句柄而不是闭包内局部变量，是为了避免 `afterEach` 越叠越多：路由是模块
 * 单例，若每次挂载都 `router.afterEach`，旧 handler 会一直持有已卸载实例的 env。
 * - `routerHooked`：afterEach 只挂一次；
 * - `routeReporter`：指向**当前**挂载实例的宿主事件出口（重新挂载即替换）；
 * - `routeReporting`：卸载时关掉——卸载路径会把路由推回落地页，那不是用户所在页，
 *   上报会覆盖刚刚记下的续接点。
 */
let routerHooked = false
let routeReporter: ((path: string) => void) | null = null
let routeReporting = false

/**
 * 挂载本 app 独立界面到宿主挂载槽元素
 *
 * 语言 / 主题由宿主注入（env.locale / setLocale）；命令 / 存储经 env 绑定本 app
 * 令牌与凭证。初始化失败（令牌未就绪等）→ 显性抛错，宿主挂载槽转错误面。
 */
export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  initFrontendLogger()

  // 语言：宿主面事实（host 设置 ui.language 的注入值）
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(i18n)

  // 全局异常处理：独立包自持（toast 不泄码；技术详情进日志）
  app.config.errorHandler = (err, _instance, info) => {
    logger.error(`[AppGlobalError] ${info || 'render'}:`, err)
    useToast().error(i18n.global.t('desktop.runtimeUnexpected'))
  }
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('[AppGlobalError] unhandledrejection:', event.reason)
    useToast().error(i18n.global.t('desktop.runtimeUnexpected'))
  })

  // app 直连上下文：页面经 inject('pluginContext') 消费（env 适配层）
  const appCtx = createAppContext(env)
  app.provide('pluginContext', appCtx)
  // 宿主面通道原样提供：业务设置里需要调宿主平台原语（链路加密配置 / 指纹）的
  // 组件经 inject('appEnv') 取 env.invoke —— 不经 pluginContext 转手，避免把宿主
  // 命令混进「本 app 命令通道」语义（appInvoke 是插件面，令牌已绑定本 app）
  app.provide('appEnv', env)

  // 页面自报：接管本次挂载的上报出口（说明见模块级句柄注释）
  routeReporter = (path) => env.onEvent?.('route', { path })
  routeReporting = true
  if (!routerHooked) {
    routerHooked = true
    router.afterEach((to) => {
      if (!routeReporting || !routeReporter) return
      routeReporter(to.fullPath)
    })
  }

  // 初始路由（宿主按路由目录传入；未传 / 非应用路径 → 应用默认落地 /sessions）
  const initial = env.initialRoute && env.initialRoute !== '/' ? env.initialRoute : '/sessions'
  if (initial !== '/sessions') {
    await router.push(initial).catch((e) => {
      // 未知子路径（如应用内已退役路由）：兜底 not-found 由路由表处理，不抛
      logger.warn(`[AppMount] initial route push failed: ${initial}`, e)
    })
  }

  app.mount(root)
  vueApp = app
  logger.log(`[AppMount] mounted (appId=${env.appId}, locale=${env.locale})`)

  return {
    async unmount() {
      routeReporting = false
      try {
        await router.push('/sessions').catch(() => undefined)
      } catch {
        // 卸载路径尽力而为
      }
      if (vueApp) {
        vueApp.unmount()
        vueApp = null
      }
      logger.log(`[AppMount] unmounted (appId=${env.appId})`)
    },
    setRoute(route: string) {
      if (!route || route === '/') return
      void router.push(route).catch((e) => {
        logger.warn(`[AppMount] setRoute failed: ${route}`, e)
      })
    },
    setLocale(locale: string) {
      if (locale === 'en' || locale === 'zh-CN') {
        i18n.global.locale.value = locale
      }
    },
  }
}

/**
 * 多任务卡片只读预览面（宿主在卡片缩略区挂载；失败 / 3s 超时宿主回退品牌卡）
 *
 * **不等待数据**：只创建并挂载 PreviewCard 实例（组件内先出骨架，`onMounted`
 * 里异步取一次数），立即返回 handle —— 慢命令不会把整张卡拖成宿主超时回退。
 *
 * 与主应用实例完全隔离：独立的 Vue 应用，不碰模块级 `vueApp` / 主 router /
 * 主 pinia / 路由上报句柄。当前前台应用的卡片也会挂预览，此时主实例仍在遮罩后
 * 运行——预览不得依赖任何模块级可变单例状态。
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
