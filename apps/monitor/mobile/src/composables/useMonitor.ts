/**
 * 运行监控取数（移动端）
 *
 * - 指标：插件面命令 `monitor.snapshot`（host-metrics，权限 `metrics:read`）；
 * - 1s 轮询；同一时刻最多一个在飞请求；`stop()` 清定时器；
 * - 移动端没有宿主插件清单命令 → 不合并名称 / 运行态（只显示 plugin_id）；
 * - `task` 系统段按端裁剪（桌面宿主任务池不是移动端消费面）。
 *
 * 失败语义（fail-visible）：命令失败 → `error` 非空且**不清空**旧数据
 * （页面显示过期标记），不用空表冒充正常。
 */
import { computed, ref, shallowRef } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import {
  collectSystemSections,
  describeError,
  normalizeSnapshot,
  summarize,
  toRows,
} from '../utils/format'
import type { MetricsSnapshot, PluginMetricRow, SystemSection } from '../types'

export interface UseMonitorOptions {
  /** 轮询周期（毫秒；默认 1000） */
  intervalMs?: number
  /** 是否展示 `task` 系统段（移动端默认 false） */
  includeTask?: boolean
}

export function useMonitor(
  context: Pick<PluginContext, 'commands'>,
  options: UseMonitorOptions = {},
) {
  const intervalMs = options.intervalMs ?? 1000
  const includeTask = options.includeTask ?? false

  const snapshot = shallowRef<MetricsSnapshot | null>(null)
  const rows = ref<PluginMetricRow[]>([])
  const systems = ref<SystemSection[]>([])
  const summary = computed(() =>
    snapshot.value
      ? summarize(snapshot.value)
      : { pluginCount: 0, callsTotal: 0, callsInFlight: 0, memoryPeakBytes: 0, trapsTotal: 0 },
  )
  const error = ref<string | null>(null)
  const loading = ref(false)
  const lastUpdated = ref<number | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null
  let inflight = false

  async function refresh(): Promise<void> {
    if (inflight) return
    inflight = true
    loading.value = true
    try {
      const raw = await context.commands.execute('monitor.snapshot')
      const next = normalizeSnapshot(raw)
      snapshot.value = next
      rows.value = toRows(next)
      systems.value = collectSystemSections(next, { includeTask })
      error.value = null
      lastUpdated.value = Date.now()
    } catch (e) {
      // 保留旧快照与旧行：页面用 stale 标记提示「数据已过期」，不白屏
      error.value = describeError(e)
    } finally {
      loading.value = false
      inflight = false
    }
  }

  /** 启动轮询（幂等）：立即取一次，随后按周期刷新；页面隐藏时跳过刷新 */
  function start(): void {
    if (timer !== null) return
    void refresh()
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void refresh()
    }, intervalMs)
  }

  /** 停止轮询（卸载） */
  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    snapshot,
    rows,
    systems,
    summary,
    error,
    loading,
    lastUpdated,
    refresh,
    start,
    stop,
  }
}
