/**
 * 预警调度（桌面）
 *
 * 把 `useMonitor` 的每次成功采样喂给纯引擎 `evaluateAlerts`，维护活动 / 已解除
 * 预警，并在 **open / escalate** 时经宿主投递一次系统通知（同一预警按
 * `cooldownMs` 抑制，单次评估最多发 `MAX_NOTIFY_PER_EVALUATION` 条，避免一屏
 * 插件同时越界时刷屏）。
 *
 * 失败语义：通知是**锦上添花**——投递失败只记 `notifyWarning`，绝不影响页内
 * 预警与指标；页内告警始终是权威面。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type {
  Alert,
  AlertLevel,
  AlertSettings,
  AlertTransition,
  PlatformTotals,
  PluginRow,
  ResolvedAlert,
  RuntimeSample,
} from '../types'
import {
  alertMessage,
  countAlerts,
  createAlertState,
  evaluateAlerts,
  severityRank,
  sortAlerts,
} from '../utils/alerts'
import { describeError } from '../utils/format'

/** 已解除列表保留条数（页面只做「刚刚恢复过什么」的提示，不做历史归档） */
const RESOLVED_LIMIT = 5

/** 单次评估最多发几条系统通知（其余仍在页内可见） */
const MAX_NOTIFY_PER_EVALUATION = 3

export interface AlertNotifyPayload {
  title: string
  body: string
  level: AlertLevel
  /** 规则 id（宿主日志 / 调试用；不参与投递） */
  rule: string
}

export interface UseAlertsOptions {
  totals: ComputedRef<PlatformTotals>
  rows: Ref<PluginRow[]>
  samples: Ref<RuntimeSample[]>
  lastUpdated: Ref<number | null>
  settings: Ref<AlertSettings>
  /** 设置是否已从 KV 读完（未读完不评估） */
  ready: Ref<boolean>
  t: (key: string, params?: Record<string, unknown>) => string
  nameOf: (id: string) => string
  /** 宿主通知投递（未注入 = 只做页内预警） */
  notify?: (payload: AlertNotifyPayload) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function useAlerts(options: UseAlertsOptions) {
  const { totals, rows, samples, lastUpdated, settings, ready, t, nameOf, notify } = options

  const active = ref<Alert[]>([])
  const resolved = ref<ResolvedAlert[]>([])
  const notifyWarning = ref<string | null>(null)
  const summary = computed(() => countAlerts(active.value))

  let state = createAlertState()
  /** 每个预警最后一次通知时间（跨解除保留，防止抖动时反复弹） */
  const notifiedAt = new Map<string, number>()
  let dispatching = false

  function pushResolved(alert: Alert, at: number): void {
    const next: ResolvedAlert = { ...alert, resolvedAt: at }
    resolved.value = [next, ...resolved.value.filter((item) => item.id !== next.id)].slice(
      0,
      RESOLVED_LIMIT,
    )
  }

  function reset(): void {
    state = createAlertState()
    active.value = []
    resolved.value = []
    notifiedAt.clear()
  }

  async function deliver(transition: AlertTransition, at: number): Promise<void> {
    if (!notify) return
    const text = alertMessage(transition.alert, { t, nameOf })
    const title = t('monitor.alerts.notifyTitle')
    const body = t('monitor.alerts.notifyBody', { title: text.title, detail: text.body })
    try {
      const response = await notify({
        title,
        body,
        level: transition.alert.level,
        rule: transition.alert.rule,
      })
      notifiedAt.set(transition.alert.id, at)
      if (isRecord(response) && response.delivered === false) {
        notifyWarning.value =
          response.reason === 'permission'
            ? t('monitor.alerts.notifyDenied')
            : t('monitor.alerts.notifyFailed', { reason: String(response.reason ?? '') })
      } else {
        notifyWarning.value = null
      }
    } catch (e) {
      // 宿主不支持 / 投递失败：保留页内告警，并把原因显性写到设置区
      notifyWarning.value = t('monitor.alerts.notifyFailed', { reason: describeError(e) })
    }
  }

  /** 通知派发：只认 open / escalate，按冷却与单轮上限收敛 */
  async function dispatch(transitions: AlertTransition[]): Promise<void> {
    if (dispatching) return
    if (!notify || !settings.value.enabled || !settings.value.notify) return
    const candidates = transitions
      .filter((tr) => tr.type === 'open' || tr.type === 'escalate')
      .filter((tr) => {
        const last = notifiedAt.get(tr.alert.id)
        return last === undefined || tr.at - last >= settings.value.cooldownMs
      })
      .sort((a, b) => severityRank(b.alert.level) - severityRank(a.alert.level))
      .slice(0, MAX_NOTIFY_PER_EVALUATION)
    if (candidates.length === 0) return
    dispatching = true
    try {
      for (const transition of candidates) {
        await deliver(transition, transition.at)
      }
    } finally {
      dispatching = false
    }
  }

  /** 评估一次（`now` 缺省用当前时钟；单测可直接注入） */
  function evaluate(now: number = Date.now()): void {
    if (!ready.value) return
    const result = evaluateAlerts(
      state,
      { now, totals: totals.value, rows: rows.value, samples: samples.value },
      settings.value,
    )
    state = result.state
    active.value = sortAlerts(
      Object.values(state.entries)
        .filter((entry) => entry.active)
        .map((entry) => entry.alert),
      rows.value,
    )
    for (const transition of result.transitions) {
      if (transition.type === 'resolve') pushResolved(transition.alert, transition.at)
    }
    void dispatch(result.transitions)
  }

  watch(lastUpdated, (value) => {
    if (value !== null) evaluate(value)
  })

  // 设置读完后再补评一次：首轮采样可能早于 KV 读取完成（ready 门挡住的那次）
  watch(ready, (value) => {
    if (value && lastUpdated.value !== null) evaluate(lastUpdated.value)
  })

  // 关掉总开关：页内立即清空，不保留幽灵告警
  watch(
    () => settings.value.enabled,
    (enabled) => {
      if (!enabled) {
        reset()
        notifyWarning.value = null
      }
    },
  )

  return { active, resolved, summary, notifyWarning, evaluate, reset }
}
