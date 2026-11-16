/**
 * 「我的设备」— file-transfer 独立化的分享面（T21）
 *
 * 数据源 = 插件命令 `get-my-device`：宿主 `host-peer` 提供 nodeId / 可拨地址 /
 * relay 状态时返回 supported，否则显性 unsupported（**不伪造** nodeId / addrs）。
 * 本页桌面端**只读**；中心不可用时后端回退本机缓存并给出 `relayError`。
 * 拨号 / 预留仍在宿主。
 *
 * 本 composable 服务设置页「我的设备」区块（设备名 / 指纹）与「内网穿透」区块；
 * `link` / `canShare` 的 v3 配对载荷保留兼容（扫码添加入口已于 2026-11-16 下线，
 * 无界面消费方）。
 */
import { computed, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { buildRemotePeerLink } from '../utils/pairingLink'
import type { MyDeviceInfo } from '../types'

const EMPTY_INFO: MyDeviceInfo = {
  supported: false,
  reason: 'host-unsupported',
  capabilities: { nodeInfo: false, relayReservation: false },
  relayAddrs: [],
}

/** relay 来源词表（未知值不猜，按「无来源」处理） */
const RELAY_SOURCES = ['center', 'cache', 'invite', 'qr', 'sync'] as const

function normalizeRelaySource(value: unknown): MyDeviceInfo['relaySource'] {
  return typeof value === 'string' && (RELAY_SOURCES as readonly string[]).includes(value)
    ? (value as MyDeviceInfo['relaySource'])
    : undefined
}

export function useMyDevice(context: PluginContext) {
  const info = ref<MyDeviceInfo>({ ...EMPTY_INFO }) as Ref<MyDeviceInfo>
  const loading = ref(false)
  const loadError = ref(false)
  const savingRoom = ref(false)
  const roomError = ref('')
  const roomSaved = ref(false)

  /** 读取本机设备信息（宿主能力未就绪时也成功返回，`supported=false`） */
  async function load(): Promise<void> {
    loading.value = true
    loadError.value = false
    try {
      const r = await context.commands.execute('file-transfer.get-my-device', {})
      info.value = {
        supported: r?.supported === true,
        reason: typeof r?.reason === 'string' ? r.reason : null,
        capabilities: {
          nodeInfo: r?.capabilities?.nodeInfo === true,
          relayReservation: r?.capabilities?.relayReservation === true,
        },
        relayAddrs: Array.isArray(r?.relayAddrs)
          ? r.relayAddrs.filter((x: unknown): x is string => typeof x === 'string')
          : [],
        relayRoom: typeof r?.relayRoom === 'string' ? r.relayRoom : '',
        relaySource: normalizeRelaySource(r?.relaySource),
        relayOrigin: typeof r?.relayOrigin === 'string' ? r.relayOrigin : '',
        relaySyncedAt:
          typeof r?.relaySyncedAt === 'number' && Number.isFinite(r.relaySyncedAt)
            ? Math.max(0, Math.trunc(r.relaySyncedAt))
            : 0,
        wanPolicy: r?.wanPolicy === 'blocked' ? 'blocked' : 'allowed',
        relayError: typeof r?.relayError === 'string' ? r.relayError : null,
        nodeId: typeof r?.nodeId === 'string' ? r.nodeId : undefined,
        deviceName: typeof r?.deviceName === 'string' ? r.deviceName : undefined,
        addrs: Array.isArray(r?.addrs)
          ? r.addrs.filter((x: unknown): x is string => typeof x === 'string')
          : undefined,
        relayState: typeof r?.relayState === 'string' ? r.relayState : undefined,
      }
    } catch (e) {
      loadError.value = true
      console.error('[File Transfer] get-my-device failed:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 设备二维码载荷。任一前提不满足都返回空串（由界面显性说明原因），
   * 绝不把残缺二维码展示给用户。
   */
  const link = computed(() => {
    const data = info.value
    if (!data.supported || !data.nodeId || !data.addrs?.length) return ''
    try {
      return buildRemotePeerLink({
        nodeId: data.nodeId,
        addrs: data.addrs,
        deviceName: data.deviceName,
      })
    } catch (e) {
      console.error('[File Transfer] build device link failed:', e)
      return ''
    }
  })

  const canShare = computed(() => link.value !== '')

  /**
   * 保存中继会合空间码（桌面端 relay 地址真源在配置中心，本页只编辑房间隔离键）。
   * 空串 = 同一中继所有设备可见；非法值后端整批拒绝并上抛，前端不显示假成功。
   */
  async function saveRelayRoom(room: string): Promise<void> {
    savingRoom.value = true
    roomError.value = ''
    roomSaved.value = false
    try {
      await context.commands.execute('file-transfer.set-settings', {
        relayRoom: room.trim(),
      })
      await load()
      roomSaved.value = true
    } catch (e) {
      roomError.value = 'save-failed'
      console.error('[File Transfer] save relay room failed:', e)
      throw e
    } finally {
      savingRoom.value = false
    }
  }

  return {
    info,
    loading,
    loadError,
    link,
    canShare,
    savingRoom,
    roomError,
    roomSaved,
    load,
    saveRelayRoom,
  }
}
