/**
 * 详情页 1s 轮询（DESIGN §9.3）
 *
 * - 页面隐藏（`document.hidden`）时暂停，恢复可见时立即补一拍；
 * - `load()` 返回 `true` = 编排已终态 / 不再需要刷新，轮询自行停止；
 * - 同一时刻最多一个在途请求（慢负载不堆叠）。
 */
import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

export interface OrchestrationPollingOptions {
  load: () => Promise<boolean>
  intervalMs?: number
}

export interface OrchestrationPolling {
  running: Ref<boolean>
  start: () => void
  stop: () => void
}

export function useOrchestrationPolling(
  options: OrchestrationPollingOptions,
): OrchestrationPolling {
  const intervalMs = options.intervalMs ?? 1000
  const running = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  const clearTimer = () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const schedule = () => {
    if (timer !== null || !running.value || typeof document === 'undefined') return
    if (document.hidden) return
    timer = setInterval(() => {
      void tick()
    }, intervalMs)
  }

  const tick = async () => {
    if (!running.value || inFlight) return
    if (typeof document !== 'undefined' && document.hidden) return
    inFlight = true
    try {
      const done = await options.load()
      if (done) stop()
    } catch {
      // 错误由页面提示；轮询继续（下一次可能恢复）
    } finally {
      inFlight = false
    }
  }

  const onVisibility = () => {
    if (document.hidden) clearTimer()
    else {
      schedule()
      void tick()
    }
  }

  const start = () => {
    if (running.value) return
    running.value = true
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    schedule()
    void tick()
  }

  const stop = () => {
    if (!running.value) return
    running.value = false
    clearTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return { running, start, stop }
}
