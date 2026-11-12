/**
 * 跨网邀请（v4，T23）— 生成 / 导入编排（桌面）
 *
 * 邀请只解决「两端共用哪台中继 + 哪个空间码」；nodeId / 长期密钥 / 票据都
 * 不在载荷里，导入后仍要经过首连确认。生成时若本机还没有空间码，先保存一个
 * 随机码再产出邀请——否则「生成邀请」会产出一张没有隔离键的废码。
 *
 * 编排与 UI 分离：命令面（get-my-device / set-settings）都在这里收敛，组件
 * 只渲染 `invite` / `busy` / `error`，双端各持一份同构实现（不跨应用 import）。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-desktop'
import { buildConnectionInvite, sameRelaySet, type ConnectionInvite } from '../utils/pairingLink'

/** 生成失败原因（界面按 key 取文案；不把命令原文当用户文案） */
export type InviteErrorKey = '' | 'relay-missing' | 'save-failed'

/** 本机当前 relay 读面（确认页做「离开当前空间 / 中心冲突」判定） */
export interface CurrentRelay {
  room: string
  source: 'center' | 'cache' | 'invite' | null
  addrs: string[]
  name: string
}

/** 生成空间码：`nest-<8 hex>`（4 字节随机；与核内 `[A-Za-z0-9_-]` 判据兼容） */
export function createRelayRoom(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return `nest-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function useConnectionInvite(context: PluginContext) {
  const current = ref<CurrentRelay | null>(null) as Ref<CurrentRelay | null>
  const invite = ref('')
  const busy = ref(false)
  const error = ref<InviteErrorKey>('')

  /** 读取本机 relay / 空间码（命令失败返回 null，由调用方显性提示） */
  async function loadCurrent(): Promise<CurrentRelay | null> {
    try {
      const r = await context.commands.execute('file-transfer.get-my-device', {})
      const view: CurrentRelay = {
        room: typeof r?.relayRoom === 'string' ? r.relayRoom : '',
        source:
          r?.relaySource === 'center' || r?.relaySource === 'cache' || r?.relaySource === 'invite'
            ? r.relaySource
            : null,
        addrs: Array.isArray(r?.relayAddrs)
          ? r.relayAddrs.filter((x: unknown): x is string => typeof x === 'string')
          : [],
        name: typeof r?.deviceName === 'string' ? r.deviceName : '',
      }
      current.value = view
      return view
    } catch (e) {
      console.error('[File Transfer] load current relay failed:', e)
      current.value = null
      return null
    }
  }

  /** 生成邀请：缺空间码时先生成并保存；relay 为空时显性失败（不产出废码） */
  async function generate(): Promise<string> {
    if (busy.value) return ''
    busy.value = true
    error.value = ''
    try {
      const view = await loadCurrent()
      if (!view || view.addrs.length === 0) {
        error.value = 'relay-missing'
        return ''
      }
      if (!view.room) {
        view.room = createRelayRoom()
        await context.commands.execute('file-transfer.set-settings', { relayRoom: view.room })
      }
      invite.value = buildConnectionInvite({
        room: view.room,
        relay: view.addrs,
        name: view.name,
      })
      return invite.value
    } catch (e) {
      error.value = 'save-failed'
      console.error('[File Transfer] generate invite failed:', e)
      return ''
    } finally {
      busy.value = false
    }
  }

  /** 轮换空间码并立即产出新邀请（旧邀请仍能进旧房间，但看不到本机） */
  async function rotateRoom(): Promise<string> {
    if (busy.value) return ''
    busy.value = true
    error.value = ''
    try {
      const view = current.value ?? (await loadCurrent())
      if (!view || view.addrs.length === 0) {
        error.value = 'relay-missing'
        return ''
      }
      const room = createRelayRoom()
      await context.commands.execute('file-transfer.set-settings', { relayRoom: room })
      view.room = room
      invite.value = buildConnectionInvite({
        room,
        relay: view.addrs,
        name: view.name,
      })
      return room
    } catch (e) {
      error.value = 'save-failed'
      console.error('[File Transfer] rotate relay room failed:', e)
      return ''
    } finally {
      busy.value = false
    }
  }

  /**
   * 应用邀请：写入 relay + 空间码，来源标 `invite`（中心明确未配置时允许生效）。
   * 返回 false 时 `error = save-failed`，调用方保持弹层并显性提示。
   */
  async function apply(target: ConnectionInvite): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    try {
      await context.commands.execute('file-transfer.set-settings', {
        relayAddrs: target.relay,
        relayRoom: target.room,
        relayOrigin: 'invite',
      })
      current.value = {
        room: target.room,
        source: 'invite',
        addrs: [...target.relay],
        name: current.value?.name ?? '',
      }
      return true
    } catch (e) {
      error.value = 'save-failed'
      console.error('[File Transfer] apply invite failed:', e)
      return false
    } finally {
      busy.value = false
    }
  }

  /**
   * 中心已配置且与邀请不同：P0 中心优先，自动发现不会工作。
   * 判定用「集合不同」而不是顺序不同，避免唯一的地址换序被误报冲突。
   */
  function isCenterConflict(target: ConnectionInvite): boolean {
    const view = current.value
    return (
      view?.source === 'center' && view.addrs.length > 0 && !sameRelaySet(view.addrs, target.relay)
    )
  }

  async function copy(): Promise<boolean> {
    if (!invite.value) return false
    try {
      await navigator.clipboard.writeText(invite.value)
      return true
    } catch (e) {
      console.error('[File Transfer] copy invite failed:', e)
      return false
    }
  }

  return {
    current,
    invite,
    busy,
    error,
    loadCurrent,
    generate,
    rotateRoom,
    apply,
    isCenterConflict,
    copy,
  }
}
