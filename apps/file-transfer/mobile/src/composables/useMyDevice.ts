/**
 * 「我的设备」— file-transfer 独立化的分享面（T21，移动端）
 *
 * 数据源 = 插件命令 `get-my-device`：宿主 `host-peer` 提供 nodeId / 可拨地址 /
 * relay 状态时返回 supported，否则显性 unsupported（**不伪造** nodeId / addrs）。
 * 本 composable 只做读面 + relay 端点保存；拨号 / 预留仍在宿主。
 *
 * 本 composable 服务设置页「我的设备」区块（设备名 / 指纹）与「内网穿透」区块；
 * `link` / `canShare` 的 v3 配对载荷保留兼容（扫码添加入口已于 2026-11-16 下线，
 * 无界面消费方）。
 */
import { computed, ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
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

  const savingRelay = ref(false)
  const relayError = ref('')
  const relaySaved = ref(false)

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

  /** 清除保存反馈（输入变化时调用，避免旧成功提示误导） */
  function clearRelayFeedback(): void {
    relaySaved.value = false
    relayError.value = ''
  }

  /**
   * 保存外网接入 relay 端点（T21）。空数组 = 清除（仅内网）。
   * 校验真源在核内 `normalize_relay_addrs`：非法地址整批拒绝并上抛，
   * 前端不吞错、不显示「已保存」假象。
   */
  async function saveRelayAddrs(addrs: string[], room?: string): Promise<void> {
    savingRelay.value = true
    clearRelayFeedback()
    try {
      const payload: Record<string, unknown> = { relayAddrs: addrs }
      // room 未传 = 只改地址（保持既有房间码）；传空串 = 显式清除隔离
      if (room !== undefined) payload.relayRoom = room
      await context.commands.execute('file-transfer.set-settings', payload)
      info.value = {
        ...info.value,
        relayAddrs: [...addrs],
        ...(room !== undefined ? { relayRoom: room } : {}),
      }
      relaySaved.value = true
    } catch (e) {
      relayError.value = 'save-failed'
      console.error('[File Transfer] save relay addrs failed:', e)
      throw e
    } finally {
      savingRelay.value = false
    }
  }

  return {
    info,
    loading,
    loadError,
    link,
    canShare,
    savingRelay,
    relayError,
    relaySaved,
    load,
    clearRelayFeedback,
    saveRelayAddrs,
  }
}
