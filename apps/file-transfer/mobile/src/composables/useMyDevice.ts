/**
 * 「我的设备」— file-transfer 独立化的分享面（T21，移动端）
 *
 * 数据源 = 插件命令 `get-my-device`：宿主 `host-peer` 提供 nodeId / 可拨地址 /
 * relay 状态时返回 supported，否则显性 unsupported（**不伪造** nodeId / addrs）。
 * 本 composable 只做读面 + 链接拼装 + relay 端点保存；拨号 / 预留仍在宿主。
 *
 * 链接规范见 `utils/pairingLink.ts`（v3，与「添加远程设备」解析端同一判据）。
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
  async function saveRelayAddrs(addrs: string[]): Promise<void> {
    savingRelay.value = true
    clearRelayFeedback()
    try {
      await context.commands.execute('file-transfer.set-settings', { relayAddrs: addrs })
      info.value = { ...info.value, relayAddrs: [...addrs] }
      relaySaved.value = true
    } catch (e) {
      relayError.value = 'save-failed'
      console.error('[File Transfer] save relay addrs failed:', e)
      throw e
    } finally {
      savingRelay.value = false
    }
  }

  /** 复制连接串；移动 WebView 的 clipboard 可能不可用，失败返回 false */
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
    savingRelay,
    relayError,
    relaySaved,
    load,
    clearRelayFeedback,
    saveRelayAddrs,
    copyLink,
  }
}
