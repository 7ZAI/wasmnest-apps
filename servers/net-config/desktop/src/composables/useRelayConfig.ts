/**
 * relay 配置读写（中心命令面）
 *
 * 写入只走本插件命令（`net-config.relay.save` / `.clear`），不在前端直写插件 KV：
 * 中心是配置的唯一真源，Rust 侧的结构校验必须与写入同一条路径，页面不能绕过。
 *
 * 失败语义（fail-visible）：读不到 / 解析失败 → `loadError` 上屏并保留原存储；
 * **不**把它降级成「未配置」——静默清空等于用户丢了唯一的中继寻址信息。
 */
import { ref, type Ref } from 'vue'
import type { NetConfigContext } from '@/appContext'
import { resolvePeerIdentity, type RelayImport } from '@/relay/relayImport'
import type { RelayConfigView, StoredRelaySettings } from '@/types'

/** 命令名（manifest `contributes.commands` 的真源字面量） */
export const RELAY_COMMANDS = {
  get: 'net-config.relay.get',
  save: 'net-config.relay.save',
  clear: 'net-config.relay.clear',
} as const

export interface RelayConfigState {
  config: Ref<StoredRelaySettings | null>
  /** 首次读取是否完成（区分「未配置」与「还没读」） */
  loaded: Ref<boolean>
  /** 读取 / 校验失败原因（null = 正常） */
  loadError: Ref<string | null>
  busy: Ref<boolean>
  load: () => Promise<void>
  save: (imported: RelayImport) => Promise<StoredRelaySettings>
  clear: () => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `RelayImport` → 落盘形态（`importedAt` 由中心在缺失时补，这里显式给当前时间） */
export function toStoredRelay(imported: RelayImport, now = new Date()): StoredRelaySettings {
  return {
    version: 1,
    relayAddrs: [...imported.relayAddrs],
    peerId: imported.peerId,
    peerIdSha256: imported.peerIdSha256,
    accessMode: imported.accessMode,
    relayVersion: imported.relayVersion,
    controlProtocol: imported.controlProtocol,
    quota: imported.quota,
    importedAt: now.toISOString(),
    source: imported.source,
  }
}

export function useRelayConfig(context: NetConfigContext): RelayConfigState {
  const config = ref<StoredRelaySettings | null>(null)
  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  const busy = ref(false)

  async function load(): Promise<void> {
    loadError.value = null
    try {
      const payload = await context.appInvoke<RelayConfigView>(RELAY_COMMANDS.get)
      if (!payload || typeof payload !== 'object' || typeof payload.configured !== 'boolean') {
        throw new Error('unexpected payload from net-config.relay.get')
      }
      const next = payload.config ?? null
      if (next) {
        // 存储内容也可能被手工改过：指纹必须能从 PeerId 本地复算且一致，
        // 否则「已本地复算校验」就是假标。
        const identity = await resolvePeerIdentity(next.peerId)
        if (!identity || identity.fingerprint !== next.peerIdSha256) {
          throw new Error('relay fingerprint does not match the stored PeerId')
        }
      }
      config.value = next
    } catch (error) {
      // 保留上一次成功数据（若有）并上屏原因，不清成空表
      loadError.value = messageOf(error)
    } finally {
      loaded.value = true
    }
  }

  async function save(imported: RelayImport): Promise<StoredRelaySettings> {
    if (busy.value) throw new Error('relay save already in flight')
    busy.value = true
    try {
      const saved = await context.appInvoke<StoredRelaySettings>(RELAY_COMMANDS.save, {
        config: toStoredRelay(imported),
      })
      config.value = saved
      loadError.value = null
      loaded.value = true
      return saved
    } finally {
      busy.value = false
    }
  }

  async function clear(): Promise<void> {
    if (busy.value) throw new Error('relay clear already in flight')
    busy.value = true
    try {
      await context.appInvoke(RELAY_COMMANDS.clear)
      config.value = null
      loadError.value = null
      loaded.value = true
    } finally {
      busy.value = false
    }
  }

  return { config, loaded, loadError, busy, load, save, clear }
}
