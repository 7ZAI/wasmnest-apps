/**
 * 业务 WAN 注册表读写
 *
 * 注册表是**策略**真源（按插件 id 的 allowWan），不是运行期端口 / 暴露规则——
 * 那些仍由各业务自己 `expose`。页面上的业务清单 = 宿主 `plugin_list_loaded`
 * 的运行态（补显示名）∪ 注册表里已有条目（即使该应用当前未安装，策略也要可见）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { NetConfigContext } from '@/appContext'
import type { HostPluginInfo, WanPolicy, WanPolicyEntry } from '@/types'

export const WAN_POLICY_COMMANDS = {
  get: 'net-config.wan-policy.get',
  set: 'net-config.wan-policy.set',
} as const

/** 注册表展示行 */
export interface WanPolicyRow {
  pluginId: string
  /** 宿主清单里的显示名；读不到时回落插件 id */
  name: string
  /** 是否为宿主已知应用（false = 只在策略里出现过） */
  known: boolean
  entry: WanPolicyEntry | null
}

/**
 * 行的**生效**外网开关（与后端 `relay_center::allow_wan_for` 同口径）：
 * 未登记 / 缺字段 = 允许（spec「未显式设置时 true」）。
 *
 * 界面的徽标、计数与首次切换都必须走这里——直接读 `entry?.allowWan` 会把
 * 「未登记」显示成「禁止」，与后端实际行为相反。
 */
export function effectiveAllowWan(entry: WanPolicyEntry | null): boolean {
  return entry?.allowWan ?? true
}

export interface WanPolicyState {
  policy: Ref<WanPolicy | null>
  rows: ComputedRef<WanPolicyRow[]>
  loadError: Ref<string | null>
  busy: Ref<boolean>
  load: () => Promise<void>
  set: (pluginId: string, allowWan: boolean) => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 服务型 wasm（L1/L2）没有「外网暴露」语义，不进业务注册表 */
function isServiceKind(kind: string | undefined): boolean {
  return kind === 'basic-service' || kind === 'internal-business'
}

export function useWanPolicy(context: NetConfigContext): WanPolicyState {
  const policy = ref<WanPolicy | null>(null)
  const hosts = ref<HostPluginInfo[]>([])
  const loadError = ref<string | null>(null)
  const busy = ref(false)

  const rows = computed<WanPolicyRow[]>(() => {
    const entries = policy.value?.apps ?? {}
    const byId = new Map<string, WanPolicyRow>()

    for (const info of hosts.value) {
      if (!info?.id || info.id === context.id) continue
      if (isServiceKind(info.kind)) continue
      byId.set(info.id, {
        pluginId: info.id,
        name: info.name || info.id,
        known: true,
        entry: entries[info.id] ?? null,
      })
    }
    // 注册表里已有、但当前未安装（或清单读不到）的业务也要可见
    for (const [pluginId, entry] of Object.entries(entries)) {
      if (byId.has(pluginId)) continue
      byId.set(pluginId, { pluginId, name: pluginId, known: false, entry })
    }
    return [...byId.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  })

  async function load(): Promise<void> {
    loadError.value = null
    try {
      const next = await context.appInvoke<WanPolicy>(WAN_POLICY_COMMANDS.get)
      if (!next || typeof next !== 'object' || typeof next.apps !== 'object') {
        throw new Error('unexpected payload from net-config.wan-policy.get')
      }
      policy.value = next
    } catch (error) {
      loadError.value = messageOf(error)
    }
    // 宿主清单只用于补名字：读不到不影响策略面（不把整张表打成不可用）
    try {
      const list = await context.hostInvoke<HostPluginInfo[]>('plugin_list_loaded')
      hosts.value = Array.isArray(list) ? list : []
    } catch {
      hosts.value = []
    }
  }

  async function set(pluginId: string, allowWan: boolean): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const next = await context.appInvoke<WanPolicy>(WAN_POLICY_COMMANDS.set, {
        pluginId,
        allowWan,
      })
      if (next && typeof next === 'object' && typeof next.apps === 'object') {
        policy.value = next
      }
      loadError.value = null
    } finally {
      busy.value = false
    }
  }

  return { policy, rows, loadError, busy, load, set }
}
