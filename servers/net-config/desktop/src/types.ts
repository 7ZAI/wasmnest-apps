/**
 * 网络配置中心的 wire 类型（与 Rust `model.rs` / `ops.rs` 逐字对齐）
 *
 * 这些形状是跨应用契约的一部分：`network.relay` 沿用 T14 落盘形态，消费方
 * （BedCode 前端 / 后端）按同一字段读取，不另造一份。
 */

/** 准入模式（只读提示：是否要另发 enrollment token） */
export type RelayAccessMode = 'open' | 'allowlist'

/** 导入来源：JSON / 文本（两种形态的字段校验强度不同） */
export type RelayImportSource = 'json' | 'text'

/** relay 配额 */
export interface RelayQuota {
  maxCircuitBytes: number
  maxCircuitDurationSecs: number
}

/** 落盘形态（`network.relay`，version 1） */
export interface StoredRelaySettings {
  version: 1
  /** WAN 拨号候选（已含 `/p2p/<peerId>`） */
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

/** `net-config.relay.get` / 互调 `relay-config` 的回执 */
export interface RelayConfigView {
  configured: boolean
  config: StoredRelaySettings | null
}

/** 单个业务的 WAN 策略 */
export interface WanPolicyEntry {
  allowWan: boolean
  note: string
  /** 最近一次更新时间（ISO 8601） */
  updatedAt: string
}

/** 业务 WAN 注册表（`network.wanPolicy`） */
export interface WanPolicy {
  version: 1
  apps: Record<string, WanPolicyEntry>
}

/** `net-config.status`（页面横幅 / 预览卡） */
export interface NetConfigStatus {
  configured: boolean
  relayAddrsCount: number
  relayError: string | null
  wanApps: number
  wanError: string | null
  version: string
}

/** 宿主 `plugin_list_loaded` 的最小投影（只在业务注册表里用于补名字） */
export interface HostPluginInfo {
  id: string
  name?: string
  version?: string
  kind?: string
  state?: string
}
