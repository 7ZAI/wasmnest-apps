/**
 * 跨网状态卡数据（T23 / P0-2）
 *
 * 读 `get-my-device` 的 relay 现状 + 宿主 `peer:relay-devices` envelope，
 * 经 `deriveRelayCard` 纯函数产出卡片模型。命令只在挂载 / 手动刷新 /
 * 配置导入后读取；发现状态本身由事件驱动。30s 心跳只刷新「状态是否过期」，
 * 不重发命令。
 */
import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { deriveRelayCard, type RelayCardModel, type RelayDiscovery } from './deviceState'
import { sameRelaySet } from '../utils/pairingLink'

/** relay 来源词表（未知值不猜，按「无来源」处理） */
const RELAY_SOURCES = ['center', 'cache', 'invite', 'qr', 'sync'] as const

function normalizeRelaySource(
  value: unknown,
): 'center' | 'cache' | 'invite' | 'qr' | 'sync' | null {
  return typeof value === 'string' && (RELAY_SOURCES as readonly string[]).includes(value)
    ? (value as 'center' | 'cache' | 'invite' | 'qr' | 'sync')
    : null
}

export function useRelayStatus(context: PluginContext, discovery: Ref<RelayDiscovery | null>) {
  const relayAddrs = ref<string[]>([])
  const relayCacheAddrs = ref<string[]>([])
  const relayRoom = ref('')
  const relayState = ref<string | undefined>(undefined)
  const relaySource = ref<'center' | 'cache' | 'invite' | 'qr' | 'sync' | null>(null)
  const relayOrigin = ref('')
  const nowMs = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  /** 读取本机 relay 现状（失败只留痕；状态卡按「未知」降级） */
  async function load(): Promise<void> {
    try {
      const r = await context.commands.execute('file-transfer.get-my-device', {})
      relayAddrs.value = Array.isArray(r?.relayAddrs)
        ? r.relayAddrs.filter((x: unknown): x is string => typeof x === 'string')
        : []
      relayCacheAddrs.value = Array.isArray(r?.relayCacheAddrs)
        ? r.relayCacheAddrs.filter((x: unknown): x is string => typeof x === 'string')
        : []
      relayRoom.value = typeof r?.relayRoom === 'string' ? r.relayRoom : ''
      relayState.value = typeof r?.relayState === 'string' ? r.relayState : undefined
      relaySource.value = normalizeRelaySource(r?.relaySource)
      relayOrigin.value = typeof r?.relayOrigin === 'string' ? r.relayOrigin : ''
    } catch (e) {
      console.error('[File Transfer] load relay status failed:', e)
    }
  }

  /** 中心已配置且与缓存不一致：自动发现不会工作（P0 中心优先） */
  const conflict = computed(
    () =>
      relaySource.value === 'center' &&
      ['invite', 'qr', 'sync'].includes(relayOrigin.value) &&
      relayCacheAddrs.value.length > 0 &&
      !sameRelaySet(relayAddrs.value, relayCacheAddrs.value),
  )

  const card = computed<RelayCardModel | null>(() =>
    deriveRelayCard({
      relayAddrs: relayAddrs.value,
      relayRoom: relayRoom.value,
      relayState: relayState.value,
      discovery: discovery.value,
      conflict: conflict.value,
      nowMs: nowMs.value,
    }),
  )

  onMounted(() => {
    void load()
    // 只驱动「状态可能过期」，不重发命令（避免轮询）
    timer = setInterval(() => {
      nowMs.value = Date.now()
    }, 30_000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
    timer = null
  })

  return { relayAddrs, relayRoom, relayState, relaySource, conflict, card, load }
}
