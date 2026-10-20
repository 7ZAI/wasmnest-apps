/**
 * 运行监控取数（桌面）
 *
 * - 指标：插件面命令 `monitor.snapshot`（host-metrics，权限 `metrics:read`）；
 * - 状态 / 名称：宿主面命令 `plugin_list_loaded` 合并（当前运行态不在指标快照里）；
 * - 轮询 1s；同一时刻最多一个在飞请求（慢命令不堆叠）；`stop()` 清定时器。
 *
 * 失败语义（fail-visible）：指标命令失败 → `error` 非空且**不清空**旧数据
 * （页面显示过期标记）；宿主清单失败是软失败（仅告警，不影响指标展示）。
 */
import { computed, ref, shallowRef } from 'vue'
import type { MonitorAppContext } from '../appContext'
import {
  collectSystemSections,
  describeError,
  mergePluginRows,
  normalizeSnapshot,
  summarize,
} from '../utils/format'
import type { HostPluginInfo, MetricsSnapshot, PluginRow, SystemSection } from '../types'

export interface UseMonitorOptions {
  /** 轮询周期（毫秒；默认 1000） */
  intervalMs?: number
  /** 是否合并宿主 `plugin_list_loaded`（默认 true；移动端无此命令 → false） */
  withHostInfo?: boolean
  /** 是否显示 `task` 系统段（桌面 true；移动端按端裁剪 false） */
  includeTask?: boolean
}

export function useMonitor(
  context: Pick<MonitorAppContext, 'commands' | 'hostInvoke'>,
  options: UseMonitorOptions = {},
) {
  const intervalMs = options.intervalMs ?? 1000
  const withHostInfo = options.withHostInfo ?? true
  const includeTask = options.includeTask ?? true

  const snapshot = shallowRef<MetricsSnapshot | null>(null)
  const rows = ref<PluginRow[]>([])
  const systems = ref<SystemSection[]>([])
  const summary = computed(() =>
    snapshot.value
      ? summarize(snapshot.value)
      : { pluginCount: 0, callsTotal: 0, callsInFlight: 0, memoryPeakBytes: 0, trapsTotal: 0 },
  )
  const error = ref<string | null>(null)
  const hostInfoWarning = ref<string | null>(null)
  const loading = ref(false)
  const lastUpdated = ref<number | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null
  let inflight = false

  /** 宿主插件清单（失败软处理：返回 null，页面按 plugin_id 展示） */
  async function loadHostInfos(): Promise<HostPluginInfo[] | null> {
    if (!withHostInfo) return null
    try {
      const infos = await context.hostInvoke<HostPluginInfo[]>('plugin_list_loaded')
      if (!Array.isArray(infos)) throw new Error('plugin_list_loaded returned a non-array')
      hostInfoWarning.value = null
      return infos
    } catch (e) {
      hostInfoWarning.value = describeError(e)
      return null
    }
  }

  async function refresh(): Promise<void> {
    if (inflight) return
    inflight = true
    loading.value = true
    try {
      // 宿主清单失败已在 loadHostInfos 内消化；这里只有指标失败会 reject
      const [raw, infos] = await Promise.all([
        context.commands.execute('monitor.snapshot'),
        loadHostInfos(),
      ])
      const next = normalizeSnapshot(raw)
      snapshot.value = next
      rows.value = mergePluginRows(next, infos)
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

  /** 停止轮询（卸载 / 预览面用） */
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
    hostInfoWarning,
    loading,
    lastUpdated,
    refresh,
    start,
    stop,
  }
}
