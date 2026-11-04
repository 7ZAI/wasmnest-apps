/**
 * 链路加密策略（按应用；2026-11-04 用户裁决）
 *
 * 策略属于应用：bedcode 在自己的设置页决定 `off / preferred / required`，覆盖本
 * 应用全部 HTTP / WS 端点（宿主按 plugin id 执行，不设整机下限、不提供宿主开关）。
 * 写入经挂载环境 `appLinkCryptoSet`（app 通道令牌已绑定本应用，只能改自己）。
 *
 * 数据面：
 * - `get_link_crypto_capabilities`（只读）：是否支持按应用策略 + 本机身份指纹；
 * - `appLinkCryptoGet` / `appLinkCryptoSet`（可选）：旧宿主不注入 = 无此能力，
 *   界面必须显性提示，不得假定已加密（fail-visible）。
 */

import { ref, type Ref } from 'vue'

/** 应用链路加密策略（与能力仓 `EncryptionPolicy` 的 wire 字面量一致） */
export type EncryptionPolicy = 'off' | 'preferred' | 'required'

/**
 * 镜像能力仓 `link_crypto::LinkCryptoCapabilities`（serde **camelCase**）
 *
 * 真源：`wasmnest-lib/wasmnest-server-core/src/link_crypto.rs` 的
 * `#[serde(rename_all = "camelCase")]`；宿主命令原样透传，不做键名转换。
 */
export interface LinkCryptoCapabilities {
  /** 是否支持按应用设置策略（旧宿主缺此字段） */
  appScopedPolicy: boolean
  /** 策略可取的全部取值（wire 字面量） */
  policies: string[]
  /** 链路身份指纹（未初始化 = null，此时 required 会被拒绝） */
  identityFingerprint: string | null
  /** 可用密钥模型 */
  keyModels: string[]
  /** WS 帧级链路加密是否可用（旧宿主 false：WS 升级期协商尚未接线） */
  wsSession: boolean
}

/** 宿主面命令通道（AppMountEnv.invoke 的形状） */
export type HostInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>

export interface LinkCryptoStatus {
  /** 能力快照；null = 未加载 / 旧宿主不支持 */
  capabilities: Ref<LinkCryptoCapabilities | null>
  /** 本应用当前策略（未设置 = off） */
  policy: Ref<EncryptionPolicy>
  /** 是否可读可写（能力 + 宿主注入的 own-token 方法都齐备） */
  supported: Ref<boolean>
  /** 从宿主拉取（幂等，可安全重复调用） */
  load: () => Promise<void>
  /** 写入本应用策略（失败不改变本地值，由调用方提示） */
  save: (next: EncryptionPolicy) => Promise<void>
}

interface HostBindings {
  getPolicy?: () => Promise<EncryptionPolicy>
  setPolicy?: (policy: EncryptionPolicy) => Promise<void>
}

export function useLinkCryptoStatus(
  invoke: HostInvoke | null | undefined,
  bindings: HostBindings,
): LinkCryptoStatus {
  const capabilities = ref<LinkCryptoCapabilities | null>(null)
  const policy = ref<EncryptionPolicy>('off')
  const supported = ref(false)
  /** 加载中标记（防止 onMounted 与手动刷新竞态重复请求） */
  let loading: Promise<void> | null = null

  async function load(): Promise<void> {
    if (!invoke) return
    if (loading) return loading
    loading = (async () => {
      try {
        const caps = await invoke<LinkCryptoCapabilities>('get_link_crypto_capabilities')
        if (!caps || caps.appScopedPolicy !== true) return
        capabilities.value = caps
        if (!bindings.getPolicy || !bindings.setPolicy) return
        const current = await bindings.getPolicy()
        policy.value = current === 'required' || current === 'preferred' ? current : 'off'
        supported.value = true
      } finally {
        loading = null
      }
    })()
    return loading
  }

  async function save(next: EncryptionPolicy): Promise<void> {
    if (!bindings.setPolicy) throw new Error('appLinkCryptoSet unavailable on this host')
    await bindings.setPolicy(next)
    policy.value = next
  }

  return { capabilities, policy, supported, load, save }
}
