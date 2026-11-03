/**
 * 链路加密状态（只读：宿主下限 + 本机指纹）
 *
 * 归位（按应用/端点加密策略 spec §6）：链路加密下限是**宿主安全策略**，只能由宿主
 * 设置页（经宿主凭证门 `set_traffic_encryption_config`）写；应用不再读写整机开关，
 * 只能在**自己的端点注册时**声明 `encryption: required | preferred | off`，由能力层
 * 按 `strictest(floor, endpoint)` 执行。
 *
 * 数据面（宿主只读命令，经 `env.invoke`）：
 * - `get_link_crypto_capabilities`：当前下限 / 是否支持 per-endpoint 策略 /
 *   本机身份指纹 / 可用密钥模型（旧宿主不返回本命令 = 无此能力，界面必须显性提示，
 *   不得假定已加密——spec §8 / 用户故事 24）；
 * - 不再调用 `get_traffic_encryption_config` 推演本应用端点是否加密：端点生效策略
 *   以宿主注册表为准，应用不做反推。
 */

import { ref, type Ref } from 'vue'

/** 端点/宿主下限策略（与能力仓 `EncryptionPolicy` 的 wire 字面量一致） */
export type EncryptionPolicy = 'off' | 'preferred' | 'required'

/** 镜像能力仓 `link_crypto::LinkCryptoCapabilities`（serde snake_case） */
export interface LinkCryptoCapabilities {
  /** 是否支持按端点声明加密策略（旧宿主缺此能力） */
  per_endpoint_policy: boolean
  /** 端点策略可取的全部取值（wire 字面量） */
  endpoint_policies: string[]
  /** 当前宿主下限 */
  floor: EncryptionPolicy
  /** 链路身份指纹（未初始化 = null，此时 required 端点注册会被拒绝） */
  identity_fingerprint: string | null
  /** 可用密钥模型 */
  key_models: string[]
}

/** 宿主面命令通道（AppMountEnv.invoke 的形状） */
export type HostInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

export interface LinkCryptoStatus {
  /** 能力 + 当前下限；null = 未加载 / 旧宿主不支持（界面显性提示） */
  capabilities: Ref<LinkCryptoCapabilities | null>
  /** 从后端拉取（幂等，可安全重复调用） */
  load: () => Promise<void>
}

export function useLinkCryptoStatus(invoke: HostInvoke | null | undefined): LinkCryptoStatus {
  const capabilities = ref<LinkCryptoCapabilities | null>(null)
  /** 加载中标记（防止 onMounted 与手动刷新竞态重复请求） */
  let loading: Promise<void> | null = null

  async function load(): Promise<void> {
    if (!invoke) return
    if (loading) return loading
    loading = (async () => {
      try {
        const caps = await invoke<LinkCryptoCapabilities>('get_link_crypto_capabilities')
        // 旧宿主 / mock 缺字段：保持 null，由界面显示「能力不可用」，不假装有下限
        if (!caps || typeof caps.floor !== 'string') return
        capabilities.value = caps
      } finally {
        loading = null
      }
    })()
    return loading
  }

  return { capabilities, load }
}
