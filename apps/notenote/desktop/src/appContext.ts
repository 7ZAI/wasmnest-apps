import type { Disposable, PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
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
    } catch (e) {
      console.error(`[AppEvents] Error in handler for ${event}:`, e)
    }
  })
}

function onEvent(event: string, handler: EventHandler): Disposable {
  const offMemory = onMemoryEvent(event, handler)
  return {
    dispose() {
      offMemory()
    },
  }
}

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
      async flush(): Promise<void> {},
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

  return context as unknown as PluginContext
}
