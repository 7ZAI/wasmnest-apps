/**
 * Monitor app 内直连上下文（独立挂载包形态）
 *
 * 页面经 `inject('pluginContext')` 取数；命令 / 存储由宿主经 AppMountEnv 注入，
 * 本模块只做一次适配。
 *
 * 额外暴露 `hostInvoke`：宿主面命令（env.invoke 白名单代理，ADR 0058 方案 A）。本 app 用它读取
 * `plugin_list_loaded` 把指标里的 plugin_id 补成「应用名 + 运行态」——
 * 当前运行态不在指标快照里（见 spec：不为它新增宿主业务状态）。
 */
import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { listen } from '@tauri-apps/api/event'
import type { AppMountEnv, MonitorPanelHandle } from './entry'
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

/** 订阅事件：内存总线 + Tauri listen 双通道（与 SDK PluginContext.events 同语义） */
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

/** Monitor 页面注入的上下文（= SDK PluginContext + 宿主面命令） */
export interface MonitorAppContext extends PluginContext {
  hostInvoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  /** 宿主注入的自定义监控面板装载器（未注入 = 宿主版本不支持） */
  mountMonitorPanel?: (
    root: HTMLElement,
    appId: string,
    panelId: string,
  ) => Promise<MonitorPanelHandle>
}

/** 创建 app 直连上下文（entry.ts mount 前调用，经 app.provide 全局注入） */
export function createAppContext(env: AppMountEnv): MonitorAppContext {
  const context = {
    id: env.appId,
    extensionPath: '',

    hostInvoke: env.invoke,
    mountMonitorPanel: env.mountMonitorPanel,

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
        return i18n.global.t(`${MESSAGE_NAMESPACE}.${key}`, params ?? {})
      },
    },
  }

  return context as unknown as MonitorAppContext
}
