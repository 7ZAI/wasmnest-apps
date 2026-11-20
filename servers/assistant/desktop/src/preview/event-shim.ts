/**
 * 预览环境的事件总线
 *
 * 在浏览器里替代 Tauri 事件通道：`listen` 注册回调，`emitLocalEvent` 把
 * 演示流推给同一份订阅者。真实宿主仍走 `@tauri-apps/api/event`，这里只服务
 * 本地渲染审查。
 */

type EventHandler = (event: { payload: unknown }) => void

const listeners = new Map<string, Set<EventHandler>>()

export function listen(event: string, handler: EventHandler): Promise<() => void> {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(handler)
  return Promise.resolve(() => {
    set?.delete(handler)
  })
}

export function emitLocalEvent(event: string, payload: unknown): void {
  const set = listeners.get(event)
  if (!set) return
  for (const handler of [...set]) handler({ payload })
}

export function listenerCount(event: string): number {
  return listeners.get(event)?.size ?? 0
}