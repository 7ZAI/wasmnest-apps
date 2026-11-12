/**
 * 跨网邀请（v4，T23）— 生成 / 导入编排（移动端）
 *
 * 与桌面同构：邀请只承载 relay 端点 + 空间码 + 展示名；移动端没有配置中心，
 * 导入的地址直接作为本机缓存生效（`relayOrigin = invite`）。生成时缺空间码
 * 先保存随机码；旧邀请仍能进旧房间，但看不到轮换后的本机。
 */
import { ref, type Ref } from 'vue'
import type { PluginContext } from '@binblink/wasmnest-plugin-sdk-mobile'
import { buildConnectionInvite, sameRelaySet, type ConnectionInvite } from '../utils/pairingLink'

/** 生成失败原因（界面按 key 取文案；不把命令原文当用户文案） */
export type InviteErrorKey = '' | 'relay-missing' | 'save-failed'

/** 本机当前 relay 读面（确认页做「离开当前空间」判定） */
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

  /** 移动端没有配置中心，冲突分支不会成立；保留同构判据供未来接线 */
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

  /** 系统分享（Web Share API）；不支持或用户取消返回 false，由调用方回退复制 */
  async function share(): Promise<boolean> {
    if (!invite.value) return false
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>
    }
    if (typeof nav.share !== 'function') return false
    try {
      await nav.share({ text: invite.value })
      return true
    } catch {
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
    share,
  }
}
