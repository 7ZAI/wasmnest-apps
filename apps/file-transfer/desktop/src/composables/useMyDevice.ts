/**
 * 「我的设备」— file-transfer 独立化的分享面（T21）
 *
 * 数据源 = 插件命令 `get-my-device`：宿主 `host-peer` 提供 nodeId / 可拨地址 /
 * relay 状态时返回 supported，否则显性 unsupported（**不伪造** nodeId / addrs）。
 * relay 地址真源是「内网穿透」配置中心（`com.wasmnest.net-config`），本页桌面端
 * **只读**；中心不可用时后端回退本机缓存并给出 `relayError`。
 * 拨号 / 预留仍在宿主。
 *
 * 链接规范见 `utils/pairingLink.ts`（v3，与「添加远程设备」解析端同一判据）。
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

export function useMyDevice(context: PluginContext) {
  const info = ref<MyDeviceInfo>({ ...EMPTY_INFO }) as Ref<MyDeviceInfo>
  const loading = ref(false)
  const loadError = ref(false)

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
        relaySource:
          r?.relaySource === 'center' || r?.relaySource === 'cache' ? r.relaySource : undefined,
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
   * 可分享连接串。任一前提不满足都返回空串（由界面显性说明原因），
   * 绝不把残缺链接展示给用户——对端粘贴后才失败是最难归因的形态。
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

  /** 复制连接串；剪贴板不可用返回 false（界面给显性失败文案） */
  async function copyLink(): Promise<boolean> {
    if (!link.value) return false
    try {
      await navigator.clipboard.writeText(link.value)
      return true
    } catch (e) {
      console.error('[File Transfer] copy device link failed:', e)
      return false
    }
  }

  return {
    info,
    loading,
    loadError,
    link,
    canShare,
    load,
    copyLink,
  }
}
