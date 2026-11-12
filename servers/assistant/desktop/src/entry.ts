/**
 * Nest 助手前端挂载入口（桌面挂载包形态 · 票 05 骨架）
 *
 * 契约（与宿主 `src/shell/mount/useAppMount.ts` 逐字同形）：`mountApp(root, env)`
 * 由宿主壳装载后挂载本 app 界面（当前为占位页）。本包自带全部依赖
 * （无 __WASMNEST_SHARED__ 外部化），独立构建。
 *
 * 骨架阶段只做两件事：渲染占位页 + 挂载后自动跑一次 `assistant.ping`，把
 * 「前端 appInvoke → 共享 crate 命令 → 宿主返回」链路状态显性呈现
 * （spec §2.4：失败点名原因，不静默假装可用）。真实对话 / 记忆 / 保险库界面
 * 随票 07–14 在共享核（`../shared/`）上续接。
 */
import { createApp, type App as VueApp } from 'vue'
import PlaceholderView from '@nest-shared/components/PlaceholderView.vue'
import i18n, { MESSAGE_NAMESPACE } from './i18n'
import {
  ASSISTANT_PING_COMMAND,
  type AssistantPingResult,
  type PlaceholderPingState,
} from '@nest-shared/types'
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

/** 占位页状态文案（i18n key 映射，带 app 命名空间前缀） */
function stateLabel(state: PlaceholderPingState): string {
  const key =
    state.status === 'ok'
      ? 'assistant.state.ok'
      : state.status === 'error'
        ? 'assistant.state.error'
        : state.status === 'running'
          ? 'assistant.state.running'
          : 'assistant.state.idle'
  return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`)
}

/** ping 结果行文案 */
function resultLabel(result: AssistantPingResult): string {
  return i18n.global.t(`${MESSAGE_NAMESPACE}.assistant.result`, { appId: result.appId })
}

let vueApp: VueApp | null = null

export async function mountApp(root: HTMLElement, env: AppMountEnv): Promise<AppMountHandle> {
  if (env.locale === 'en' || env.locale === 'zh-CN') {
    i18n.global.locale.value = env.locale
  }

  const app = createApp(PlaceholderView, {
    title: i18n.global.t(`${MESSAGE_NAMESPACE}.assistant.title`),
    subtitle: i18n.global.t(`${MESSAGE_NAMESPACE}.assistant.subtitle`),
    stateLabel,
    resultLabel,
    ping: () => env.appInvoke<AssistantPingResult>(ASSISTANT_PING_COMMAND),
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
