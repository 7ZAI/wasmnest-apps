/**
 * Nest 助手前端挂载入口（桌面挂载包形态 · 票 08 对话主链路）
 *
 * 契约（与宿主 `src/shell/mount/useAppMount.ts` 逐字同形）：`mountApp(root, env)`
 * 由宿主壳装载后挂载本 app 界面。本包自带全部依赖（无 __WASMNEST_SHARED__
 * 外部化），独立构建。
 *
 * 票 08 起挂载全屏会话页（ChatView）：保险库门（票 07 VaultView）→ 对话。
 * 端差异注入点只有两个：命令调用面 `env.appInvoke`、事件订阅面（桌面经
 * `@tauri-apps/api/event` 的 `listen` 订阅宿主流式事件 `assistant:stream:*`，
 * 与 ai-chatbox 同款先例）；其余逻辑全在共享核（D3 双端同构）。
 */
import { createApp, type App as VueApp } from 'vue'
import { listen } from '@tauri-apps/api/event'
import ChatView from '@nest-shared/components/ChatView.vue'
import i18n, { MESSAGE_NAMESPACE } from './i18n'
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
  /** 应用更新检查（宿主统一默认实现；appId 与宿主面凭证已绑定） */
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

/**
 * 桌面事件订阅适配：Tauri `listen` 订阅宿主事件通道。
 *
 * `listen` 返回 Promise<unlisten>：先注册回调（立即生效），句柄到达后保存，
 * 退订时调用。宿主流式事件（`assistant:stream:*`）由宿主 http 层按
 * `streamEvent` 名推送（egress.rs），本适配只做载荷透传。
 */
function createDesktopSubscribe(
  log: (level: 'info' | 'warn' | 'error', message: string) => void,
): (event: string, handler: (payload: unknown) => void) => () => void {
  return (event, handler) => {
    let unlisten: (() => void) | null = null
    let disposed = false
    listen(event, (tauriEvent: { payload: unknown }) => {
      handler(tauriEvent.payload)
    }).then(
      (fn) => {
        if (disposed) fn()
        else unlisten = fn
      },
      (e) => log('error', `[nest] 订阅事件失败 ${event}: ${String(e)}`),
    )
    return () => {
      disposed = true
      unlisten?.()
    }
  }
}

let vueApp: VueApp | null = null

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    const fn = (console[level] ?? console.log).bind(console)
    fn(`[nest] ${message}`)
  }

  const app = createApp(ChatView, {
    invoke: <T = unknown>(command: string, args?: Record<string, unknown>) =>
      env.appInvoke<T>(command, args),
    subscribe: createDesktopSubscribe(log),
    t: (key: string) => i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`),
    lang: env.locale === 'en' ? 'en' : 'zh-CN',
  })
  app.use(i18n)
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
