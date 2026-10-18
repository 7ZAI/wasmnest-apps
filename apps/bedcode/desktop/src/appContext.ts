/**
 * bedcode app 内直连上下文（独立挂载包形态；桌面 UI 宿主修正 2026-10-17）
 *
 * 背景：页面约 90 处 `inject('pluginContext')` 调用点（旧 PluginContext 同形，
 * 宿主前端下沉期零改写）。本次修正后 app 前端是**独立构建的挂载包**，命令 /
 * 存储 / 令牌全部由宿主经 AppMountEnv 注入（useAppMount），本模块只做一次
 * 适配：把 env 组装成页面既有的 context 形状，页面调用点仍零改写。
 *
 * 与旧 PluginContext 的差异（均为随机制退役的收窄）：
 * - `ui.*` 贡献面注册 / `http.*` 端点注册：删除（静态表替代）；
 * - 权限快速失败 / 激活态门禁：删除（仲裁在 Rust 侧照旧）；
 * - `i18n.t`：查本 app 自足实例的 `com.wasmnest.terminal-session.*` 命名空间；
 * - `commands.execute`：env.appInvoke（令牌已绑定本 app）；
 * - `storage`：env.appStorageGet/Set/Delete（凭证已绑定）。
 */

import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { listen } from '@tauri-apps/api/event'
import type { AppMountEnv } from './entry'
import { logger } from './utils/frontendLogger'
import i18n, { MESSAGE_NAMESPACE } from './i18n'
import { useSessionWindows } from './composables/useSessionWindows'
import { computeDesktopInitialTerminalSize, TERMINAL_WINDOW_WIDTH_RATIO } from './utils/terminalInitialSize'

// ==================== 事件面（Tauri listen 桥 + 内存总线）====================

type EventHandler = (...args: any[]) => void

/**
 * 内存事件总线（前端 → 前端）：Rust 侧 `app_handle.emit()` 的事件经 Tauri listen
 * 到达；前端 emit 的只走内存总线。事件名（`device:*` / `session:*` / `task:*`）
 * 与 wasm 侧发布面逐字一致。
 */
const memoryHandlers = new Map<string, Set<EventHandler>>()

function onMemoryEvent(event: string, handler: EventHandler): () => void {
  let set = memoryHandlers.get(event)
  if (!set) {
    set = new Set()
    memoryHandlers.set(event, set)
  }
  set.add(handler)
  return () => {
    memoryHandlers.get(event)?.delete(handler)
  }
}

function emitMemoryEvent(event: string, ...args: unknown[]): void {
  memoryHandlers.get(event)?.forEach((h) => {
    try {
      h(...args)
    } catch (e) {
      logger.error(`[AppEvents] Error in handler for ${event}:`, e)
    }
  })
}

/** 订阅事件：内存总线 + Tauri listen 双通道（与旧 context.events.on 同语义） */
function onEvent(event: string, handler: EventHandler): Disposable {
  const offMemory = onMemoryEvent(event, handler)
  let unlisten: (() => void) | null = null
  listen(event, (tauriEvent: { payload: unknown }) => {
    handler(tauriEvent.payload)
  })
    .then((fn) => {
      unlisten = fn
    })
    .catch((e) => {
      // Tauri API 不可用时（如测试环境）静默忽略，内存总线仍可用
      logger.warn(`[AppEvents] Tauri listen failed for ${event}:`, e)
    })
  return {
    dispose() {
      offMemory()
      unlisten?.()
    },
  }
}

// ==================== 终端窗口原语（宿主窗口事实，几何与测量留宿主）====================

const sessionWindows = useSessionWindows()

// ==================== 上下文组装 ====================

/**
 * 创建 app 直连上下文（entry.ts 在 mount 前调用一次，经 app.provide 全局注入）
 *
 * 形状与 SDK PluginContext 兼容（页面 inject 处的类型不断言）；未实现的面不挂
 * 字段，调用即显性 undefined 失败，不做静默兜底。
 */
export function createAppContext(env: AppMountEnv): PluginContext {
  const context = {
    id: env.appId,
    extensionPath: '',

    commands: {
      async execute(id: string, ...args: unknown[]): Promise<any> {
        // 无前端 handler 注册表：全部走本 app 命令通道（Rust 分派臂，令牌已绑定）
        return env.appInvoke(id, ...args)
      },
    },

    session: {
      async predictTerminalSize(): Promise<{ cols: number; rows: number } | null> {
        // 窗口几何与字体测量都在宿主（终端窗口本体留宿主）：终端字号 / 字间距
        // 是宿主设置（get_app_settings 宿主命令只读消费，app 不写宿主设置）
        try {
          const settings = (await env.invoke('get_app_settings')) as {
            ui?: { terminal_font_size?: number; terminal_letter_spacing?: number }
          }
          const ui = settings?.ui ?? {}
          return computeDesktopInitialTerminalSize(ui.terminal_font_size ?? 14, {
            widthRatio: TERMINAL_WINDOW_WIDTH_RATIO,
            letterSpacing: ui.terminal_letter_spacing ?? 0,
          })
        } catch (e) {
          logger.warn('[AppContext] predictTerminalSize settings read failed, using defaults:', e)
          return computeDesktopInitialTerminalSize(14, {
            widthRatio: TERMINAL_WINDOW_WIDTH_RATIO,
            letterSpacing: 0,
          })
        }
      },
      async openTerminal(target: { id: string; name: string }): Promise<boolean> {
        return sessionWindows.openTerminalWindow(target)
      },
      async closeTerminal(sessionId: string): Promise<void> {
        await sessionWindows.closeTerminalWindow(sessionId)
      },
      isTerminalOpen(sessionId: string): boolean {
        // 同步查询：调用方在打开窗口前决定是否显示就绪 loading
        return sessionWindows.hasTerminalWindow(sessionId)
      },
    },

    events: {
      on: onEvent,
      emit(event: string, ...args: unknown[]): void {
        emitMemoryEvent(event, ...args)
      },
    },

    storage: {
      async get<T = any>(key: string): Promise<T | undefined> {
        return env.appStorageGet<T>(key)
      },
      async set(key: string, value: any): Promise<void> {
        return env.appStorageSet(key, value)
      },
      async delete(key: string): Promise<void> {
        return env.appStorageDelete(key)
      },
      async flush(): Promise<void> {
        // 存储是即时写入的，flush 为 no-op
      },
    },

    i18n: {
      getI18n(): unknown {
        return i18n
      },
      t(key: string, params?: Record<string, unknown>): string {
        // D5：消息 key 自带命名空间（旧「运行期自动加插件 ID 前缀」的静态化）
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },
  }

  return context as unknown as PluginContext
}
