/**
 * 隧道状态（T07）：设备页状态栏的数据源
 *
 * 只调用本插件命令面：
 * - `session.tunnel.prepare`（写通道配置 + 暴露本机 HTTP 面，幂等）→ 状态快照；
 * - `session.tunnel.status`（只读轮询）。
 *
 * 为什么先 prepare 再展示：没暴露过 HTTP 面时 `exposeRules = 0`，界面若直接说
 * 「外网可用」就是假标；prepare 是幂等的，页面进入时做一次即可（不重复建规则）。
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

export interface TunnelStatusState {
  status: Ref<TunnelStatusSnapshot | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  summary: ComputedRef<TunnelStatusSummary>
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

  async function run(command: string): Promise<void> {
    if (!env) {
      status.value = null
      error.value = 'tunnel status unavailable on this host'
      return
    }
    loading.value = true
    try {
      status.value = (await env.commands.execute(command, {})) as TunnelStatusSnapshot
      error.value = null
    } catch (e) {
      status.value = null
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  const summary = computed(() => deriveTunnelStatus(status.value, error.value))

  return {
    status,
    error,
    loading,
    summary,
    prepare: () => run('session.tunnel.prepare'),
    refresh: () => run('session.tunnel.status'),
  }
}
