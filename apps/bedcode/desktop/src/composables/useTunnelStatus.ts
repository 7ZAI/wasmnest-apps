/**
 * 隧道状态（T07 / T18）：设备页状态栏的数据源
 *
 * 只调用本插件命令面：
 * - `session.relay.config`（T18：取网络配置中心地址，`source` = center / cache）
 * - `session.tunnel.prepare`（写通道配置 + 暴露本机 HTTP 面，幂等）→ 状态快照；
 * - `session.tunnel.status`（只读轮询）。
 *
 * 为什么先 prepare 再展示：没暴露过 HTTP 面时 `exposeRules = 0`，界面若直接说
 * 「外网可用」就是假标；prepare 是幂等的，页面进入时做一次即可（不重复建规则）。
 *
 * **T18 地址来源**：prepare 显式带 `relayAddrs`（中心值）。中心不可用时后端用
 * 本地缓存兜底并把 `source=cache` / `centerError` 带回，界面据此显性提示——不能
 * 让「正在用过期缓存」看不出来。
 *
 * 失败语义：宿主无隧道面 / 命令失败 → `error` 非空、`status` 为 null，界面按
 * 「隧道不可用」显性呈现（不退化成「就绪」）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  deriveTunnelStatus,
  type TunnelStatusSnapshot,
  type TunnelStatusSummary,
} from '@/utils/tunnelStatus'

/** 只依赖命令通道（便于单测注入替身） */
export interface TunnelStatusEnv {
  commands: { execute: (name: string, args?: Record<string, unknown>) => Promise<unknown> }
}

/** `session.relay.config` 回执（T18；字段与 Rust `relay_center::relay_config_view` 对齐） */
export interface RelayConfigView {
  configured: boolean
  relayAddrs: string[]
  /** center = 中心值；cache = 中心不可用时的本地缓存 */
  source: 'center' | 'cache'
  /** 中心读取失败原因（source=cache 时非空） */
  centerError: string | null
  /** 业务 WAN 注册表开关（缺省 = true） */
  allowWan?: boolean
  config?: unknown
}

export interface TunnelStatusState {
  status: Ref<TunnelStatusSnapshot | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  summary: ComputedRef<TunnelStatusSummary>
  /** T18：本次 prepare 使用的地址来源（读不到 = null） */
  relay: Ref<RelayConfigView | null>
  /** T18：取中心配置失败的原因（后端已用缓存兜底时仍然记录） */
  relayError: Ref<string | null>
  /** 准备并读取（页面进入 / 手动刷新） */
  prepare: () => Promise<void>
  /** 只读读取（轮询；不写配置、不建规则） */
  refresh: () => Promise<void>
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  const text = String(e ?? '').trim()
  return text || 'tunnel status unavailable'
}

export function useTunnelStatus(env: TunnelStatusEnv | null | undefined): TunnelStatusState {
  const status = ref<TunnelStatusSnapshot | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const relay = ref<RelayConfigView | null>(null)
  const relayError = ref<string | null>(null)

  async function run(command: string, args: Record<string, unknown> = {}): Promise<void> {
    if (!env) {
      status.value = null
      error.value = 'tunnel status unavailable on this host'
      return
    }
    loading.value = true
    try {
      status.value = (await env.commands.execute(command, args)) as TunnelStatusSnapshot
      error.value = null
    } catch (e) {
      status.value = null
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 取中心配置并把地址显式传给 prepare。
   *
   * 取不到不阻断 prepare（后端会再试一次中心 + 缓存兜底）；这里只负责把
   * `source` / `centerError` 带到界面上。
   */
  async function relayArgs(): Promise<Record<string, unknown>> {
    if (!env) return {}
    try {
      const view = (await env.commands.execute('session.relay.config')) as RelayConfigView
      relay.value = view
      relayError.value = view.centerError
      return view.configured && view.relayAddrs.length > 0
        ? { relayAddrs: view.relayAddrs }
        : {}
    } catch (e) {
      relay.value = null
      relayError.value = errorMessage(e)
      return {}
    }
  }

  const summary = computed(() => deriveTunnelStatus(status.value, error.value))

  return {
    status,
    error,
    loading,
    summary,
    relay,
    relayError,
    prepare: async () => {
      const args = await relayArgs()
      await run('session.tunnel.prepare', args)
    },
    refresh: () => run('session.tunnel.status'),
  }
}
