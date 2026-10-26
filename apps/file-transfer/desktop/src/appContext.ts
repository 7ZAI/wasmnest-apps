/**
 * File Transfer app 内直连上下文（独立挂载包形态；桌面 UI 宿主修正 2026-10-17）
 *
 * 页面经 `inject('pluginContext')` 取数（与旧 lib 形态同形，调用点零改写）；
 * 命令 / 存储 / 令牌由宿主经 AppMountEnv 注入（useAppMount），本模块只做一次
 * 适配。`i18n.t` 按 `com.wasmnest.file-transfer.*` 扁平命名空间补前缀（旧「运行期
 * 自动加插件 ID 前缀」的静态化）。
 */
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { listen } from '@tauri-apps/api/event'
import type { AppMountEnv } from './entry'
import i18n, { MESSAGE_NAMESPACE } from './i18n'

type EventHandler = (...args: any[]) => void

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
    } catch {
      // 单个 handler 抛错不阻断其余订阅者
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
    .catch(() => {
      // Tauri API 不可用时（如测试环境）静默忽略，内存总线仍可用
    })
  return {
    dispose() {
      offMemory()
      unlisten?.()
    },
  }
}

/** 创建 app 直连上下文（entry.ts mount 前调用，经 app.provide 全局注入） */
export function createAppContext(env: AppMountEnv): PluginContext {
  const context = {
    id: env.appId,
    extensionPath: '',

    commands: {
      async execute(id: string, ...args: unknown[]): Promise<any> {
        return env.appInvoke(id, ...args)
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
        // 扁平 key 自带命名空间（旧「运行期自动加插件 ID 前缀」的静态化）
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },
  }

  return context as unknown as PluginContext
}
