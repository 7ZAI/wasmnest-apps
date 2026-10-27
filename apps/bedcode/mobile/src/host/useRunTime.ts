import { ref, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'
import { formatRunTime } from './utils'

/**
 * 运行时间 composable（自旧宿主 `src/composables/useRunTime.ts` 迁入插件）
 *
 * 实时计算并显示会话运行时间，每秒更新一次；结束态显示 `--`。
 * 文案键 `hub.runTime*` 由本域自持（宿主 `common.time.*` 已在平台仓死键清理中退役），
 * `t` 由调用方注入（与 `formatLastConnected` 同口径）。
 */
export function useRunTime(
  startTime: () => string | undefined,
  isRunning: Ref<boolean> | ComputedRef<boolean> | (() => boolean),
  t: (key: string, params?: Record<string, unknown>) => string,
) {
  const runTime = ref('')
  let intervalId: ReturnType<typeof setInterval> | null = null

  function updateRunTime() {
    const start = startTime()
    if (!start) {
      runTime.value = '--'
      return
    }

    const diff = Math.floor((Date.now() - new Date(start).getTime()) / 1000)
    if (!Number.isFinite(diff)) {
      runTime.value = '--'
      return
    }
    runTime.value = formatRunTime(diff, t)
  }

  function startTimer() {
    if (intervalId) return
    updateRunTime()
    intervalId = setInterval(updateRunTime, 1000)
  }

  function stopTimer() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  onMounted(() => {
    // 支持 Ref、ComputedRef 或普通函数
    const running =
      'value' in isRunning ? (isRunning as Ref<boolean>).value : (isRunning as () => boolean)()
    if (running) {
      startTimer()
    } else {
      runTime.value = '--'
    }
  })

  onUnmounted(() => {
    stopTimer()
  })

  return { runTime }
}
