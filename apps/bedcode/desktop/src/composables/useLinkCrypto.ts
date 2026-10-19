/**
 * 链路加密配置（设置归属修正 2026-10-19：自宿主设置页迁入本应用）
 *
 * 归属理由：加密哪些通道（HTTP 载荷 / WS 终端 / WS 事件）取决于终端的业务数据面，
 * 是 bedcode 的业务设置项（B1/B5），不归宿主外壳。
 *
 * 数据面仍是宿主的平台原语（加密引擎在宿主 / server-core，不在应用）：
 * - `get_traffic_encryption_config` / `set_traffic_encryption_config`（配置域）
 * - `get_link_crypto_fingerprint`（本机 Kd 指纹，供双端人工核对）
 * 应用经宿主注入的 `env.invoke`（宿主面命令，非插件命令）调用，权限面不变。
 *
 * 字段名与 Rust LinkCryptoConfig 的 serde 序列化一致（snake_case；
 * deny_unknown_fields 拒绝 camelCase 拼写）。
 */

import { ref, type Ref } from 'vue'

/** 链路加密配置域（镜像 server/link_crypto.rs LinkCryptoConfig） */
export interface LinkCryptoConfig {
  /** 主开关：false 时过滤器不注册，全服务明文（与现状一致） */
  enabled: boolean
  /** HTTP REST 载荷加解密 */
  encrypt_http: boolean
  /** WS 终端通道帧加解密 */
  encrypt_ws_terminal: boolean
  /** WS 事件通道帧加解密 */
  encrypt_ws_event: boolean
  /** 服务端对未协商的老客户端放行明文；false 时非环回未协商请求一律拒绝 */
  allow_plaintext_fallback: boolean
}

/** 宿主面命令通道（AppMountEnv.invoke 的形状） */
export type HostInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

export interface LinkCryptoHandle {
  /** 配置响应式快照；null = 尚未从后端加载 */
  config: Ref<LinkCryptoConfig | null>
  /** 本机 Kd 指纹（SHA-256 前 16 hex）；null = 未加载 / 懒初始化失败 */
  fingerprint: Ref<string | null>
  /** 从后端拉取配置与指纹（幂等，可安全重复调用） */
  load: () => Promise<void>
  /** 保存配置：先持久化成功再热更新快照，失败上抛由调用方提示 */
  save: (next: LinkCryptoConfig) => Promise<void>
}

export function useLinkCryptoConfig(invoke: HostInvoke | null | undefined): LinkCryptoHandle {
  const config = ref<LinkCryptoConfig | null>(null)
  const fingerprint = ref<string | null>(null)
  /** 加载中标记（防止 onMounted 与手动刷新竞态重复请求） */
  let loading: Promise<void> | null = null

  async function load(): Promise<void> {
    if (!invoke) return
    if (loading) return loading
    loading = (async () => {
      try {
        config.value = await invoke<LinkCryptoConfig>('get_traffic_encryption_config')
        fingerprint.value = await invoke<string>('get_link_crypto_fingerprint')
      } finally {
        loading = null
      }
    })()
    return loading
  }

  async function save(next: LinkCryptoConfig): Promise<void> {
    if (!invoke) throw new Error('link crypto command channel unavailable')
    await invoke('set_traffic_encryption_config', { config: next })
    config.value = next
  }

  return { config, fingerprint, load, save }
}
