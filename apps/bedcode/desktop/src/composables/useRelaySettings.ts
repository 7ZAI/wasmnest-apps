/**
 * 中转地址的应用侧配置（T14）
 *
 * 归属：`relayAddrs` 是**应用配置**（§4.9 设置项），落在本 app 的插件 KV
 * `network.relay`。宿主不替应用保存产品语义；WAN 拨号 / 模式判定（T07 / T12 /
 * T09）从此键读取，不另造一份。
 *
 * 失败语义（fail-visible）：存储损坏时只报错、**不静默清除**——静默清掉等于
 * 用户丢了唯一的中继寻址信息（身份不在这里，清掉不会换 PeerId，但仍需重新导入）。
 */

import { ref, type Ref } from 'vue'
import type { AppMountEnv } from '@/entry'
import {
  resolvePeerIdentity,
  type RelayAccessMode,
  type RelayImport,
  type RelayImportSource,
  type RelayQuota,
} from '@/relay/relayImport'

/** 存储键：应用级网络配置（relay 地址不是秘密，可进插件 KV） */
export const RELAY_SETTINGS_STORAGE_KEY = 'network.relay'

/** 落盘形态（版本化：后续新增字段保持向后兼容） */
export interface StoredRelaySettings {
  version: 1
  /** §4.9 的 `relayAddrs`：WAN 拨号候选（已含 `/p2p/<peerId>`） */
  relayAddrs: string[]
  peerId: string
  /** 本地从 PeerId 复算的指纹（不存载荷自报值） */
  peerIdSha256: string
  accessMode: RelayAccessMode | null
  relayVersion: string | null
  controlProtocol: string | null
  quota: RelayQuota | null
  /** 导入时间（ISO 8601） */
  importedAt: string
  source: RelayImportSource
}

type RelayStorageEnv = Pick<AppMountEnv, 'appStorageGet' | 'appStorageSet' | 'appStorageDelete'>

export interface RelaySettingsState {
  /** 当前生效配置；null = 未导入 */
  config: Ref<StoredRelaySettings | null>
  /** 首次读取是否完成（区分「未导入」与「还没读」） */
  loaded: Ref<boolean>
  /** 存储内容无法解析（不自动清除，等用户重新导入或显式移除） */
  loadError: Ref<boolean>
  load: () => Promise<void>
  save: (imported: RelayImport) => Promise<StoredRelaySettings>
  clear: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function isAccessMode(value: unknown): value is RelayAccessMode {
  return value === 'open' || value === 'allowlist'
}

function isQuota(value: unknown): value is RelayQuota {
  if (!isRecord(value)) return false
  return (
    typeof value.maxCircuitBytes === 'number' &&
    Number.isSafeInteger(value.maxCircuitBytes) &&
    value.maxCircuitBytes >= 0 &&
    typeof value.maxCircuitDurationSecs === 'number' &&
    Number.isSafeInteger(value.maxCircuitDurationSecs) &&
    value.maxCircuitDurationSecs >= 0
  )
}

/**
 * 结构校验（存储内容不可信：可能是旧版本 / 手工改坏的 JSON）
 *
 * 只校验读取所需的最小面；PeerId 的密码学校验在导入时已做过，这里不做联网/
 * WebCrypto 复算（读取路径必须快且不产生异步失败）。
 */
export function parseStoredRelaySettings(value: unknown): StoredRelaySettings | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (!isStringArray(value.relayAddrs) || value.relayAddrs.length === 0) return null
  if (typeof value.peerId !== 'string' || !value.peerId) return null
  if (typeof value.peerIdSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.peerIdSha256)) {
    return null
  }
  if (value.accessMode !== null && !isAccessMode(value.accessMode)) return null
  if (value.relayVersion !== null && typeof value.relayVersion !== 'string') return null
  if (value.controlProtocol !== null && typeof value.controlProtocol !== 'string') return null
  if (value.quota !== null && !isQuota(value.quota)) return null
  if (typeof value.importedAt !== 'string' || !value.importedAt) return null
  if (value.source !== 'json' && value.source !== 'text') return null
  return {
    version: 1,
    relayAddrs: [...value.relayAddrs],
    peerId: value.peerId,
    peerIdSha256: value.peerIdSha256,
    accessMode: value.accessMode as RelayAccessMode | null,
    relayVersion: value.relayVersion as string | null,
    controlProtocol: value.controlProtocol as string | null,
    quota: (value.quota as RelayQuota | null) ?? null,
    importedAt: value.importedAt,
    source: value.source,
  }
}

/**
 * 中转配置读写（`env` 缺失 = 旧宿主 / 预览面，显性失败）
 */
export function useRelaySettings(env: RelayStorageEnv | null | undefined): RelaySettingsState {
  const config = ref<StoredRelaySettings | null>(null)
  const loaded = ref(false)
  const loadError = ref(false)

  async function load(): Promise<void> {
    if (!env) {
      loadError.value = true
      loaded.value = true
      return
    }
    const stored = await env.appStorageGet<unknown>(RELAY_SETTINGS_STORAGE_KEY)
    if (stored === undefined || stored === null) {
      config.value = null
      loadError.value = false
      loaded.value = true
      return
    }
    const parsed = parseStoredRelaySettings(stored)
    if (!parsed) {
      // 不自动清除：静默丢配置比报错更难排查
      config.value = null
      loadError.value = true
      loaded.value = true
      return
    }
    // 存储内容也可能被手工改过：身份指纹必须能从 PeerId 复算且一致，
    // 否则「已本地复算校验」就是假标。
    const identity = await resolvePeerIdentity(parsed.peerId)
    if (!identity || identity.fingerprint !== parsed.peerIdSha256) {
      config.value = null
      loadError.value = true
      loaded.value = true
      return
    }
    config.value = parsed
    loadError.value = false
    loaded.value = true
  }

  async function save(imported: RelayImport): Promise<StoredRelaySettings> {
    if (!env) throw new Error('relay storage unavailable on this host')
    const next: StoredRelaySettings = {
      version: 1,
      relayAddrs: [...imported.relayAddrs],
      peerId: imported.peerId,
      peerIdSha256: imported.peerIdSha256,
      accessMode: imported.accessMode,
      relayVersion: imported.relayVersion,
      controlProtocol: imported.controlProtocol,
      quota: imported.quota,
      importedAt: new Date().toISOString(),
      source: imported.source,
    }
    await env.appStorageSet(RELAY_SETTINGS_STORAGE_KEY, next)
    config.value = next
    loadError.value = false
    loaded.value = true
    return next
  }

  async function clear(): Promise<void> {
    if (!env) throw new Error('relay storage unavailable on this host')
    await env.appStorageDelete(RELAY_SETTINGS_STORAGE_KEY)
    config.value = null
    loadError.value = false
  }

  return { config, loaded, loadError, load, save, clear }
}
