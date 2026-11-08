/**
 * 链路加密策略（按应用；2026-11-04 用户裁决，2026-11-08 T07 收紧为固定档）
 *
 * 策略属于应用：写入经挂载环境 `appLinkCryptoSet`（app 通道令牌已绑定本应用，
 * 只能改自己），宿主按 plugin id 执行，不设整机下限、不提供宿主开关。
 *
 * **固定 `required`（T07 / spec 不变量 12·14）**：bedcode 不允许关闭链路加密，
 * 本模块是唯一写入口且只写 [`FORCED_ENCRYPTION_POLICY`]——宿主 wire 仍接受
 * `off` / `preferred`，但应用侧没有路径能写它们（`enforce()` 无入参）。宿主里
 * 残留的旧值（`off` / `preferred`）在能力齐备时于 `load()` 内自动收紧为
 * `required`，失败则留 `lastError` 由界面显性呈现（不静默当已生效）。
 *
 * **不静默降级（fail-visible）**：两种「强制加密无法真正生效」的情形不写库、
 * 也不宣称已加密——
 * - `identity-missing`：本机链路身份未初始化，`required` 会拒绝全部对端；
 * - `ws-unsupported`：旧宿主 WS 升级期协商未接线，`required` 覆盖不到 WS 端点
 *   （WS 仍明文，绝不能显示成已加密）。
 *
 * 数据面：
 * - `get_link_crypto_capabilities`（只读）：按应用策略能力 + 本机身份指纹 + WS 能力；
 * - `appLinkCryptoGet` / `appLinkCryptoSet`（可选）：旧宿主不注入 = 无此能力，
 *   界面必须显性提示（`supported=false`），不得假定已加密。
 */

import { computed, ref, type Ref } from 'vue'

/** 应用链路加密策略（与能力仓 `EncryptionPolicy` 的 wire 字面量一致） */
export type EncryptionPolicy = 'off' | 'preferred' | 'required'

/**
 * bedcode 固定档：本应用只允许强制加密（T07 / spec 不变量 12）。
 *
 * 导出常量而非在调用点写字面量，避免「另一处又写回 off」的漂移。
 */
export const FORCED_ENCRYPTION_POLICY = 'required' as const

/**
 * 强制加密无法真正生效的原因（只有这两种；能力缺失另有 `supported=false`）
 *
 * - `identity-missing`：链路身份未初始化 → `required` 会把全部非本机对端拒掉；
 * - `ws-unsupported`：宿主 WS 帧级加密未接线 → 强制档覆盖不到 WS，仍是明文。
 */
export type LinkCryptoBlockReason = 'identity-missing' | 'ws-unsupported'

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

/** 宿主注入的两个 own-token 方法（旧宿主不注入 = 不可用） */
export interface HostBindings {
  getPolicy?: () => Promise<EncryptionPolicy>
  setPolicy?: (policy: EncryptionPolicy) => Promise<void>
}

export interface LinkCryptoStatus {
  /** 能力快照；null = 未加载 / 旧宿主不支持 */
  capabilities: Ref<LinkCryptoCapabilities | null>
  /** 宿主记录的当前策略（**原样**归一：未知值按 `off` 处理，不粉饰成 required） */
  policy: Ref<EncryptionPolicy>
  /** 是否可读可写（能力 + 宿主注入的 own-token 方法都齐备） */
  supported: Ref<boolean>
  /** 强制加密是否**真正生效**（supported + 无 blocker + policy=required） */
  enforced: Ref<boolean>
  /** 无法强制生效的原因；null = 可强制（或尚未加载出结论） */
  blockReason: Ref<LinkCryptoBlockReason | null>
  /** 最近一次强制写入失败的原因（显性呈现；成功即清空） */
  lastError: Ref<string | null>
  /** 拉能力 + 当前策略，并在可强制时**自动收紧**为 required（幂等，可重复调用） */
  load: () => Promise<void>
  /** 唯一写入口：只写 `required`；不可强制时抛错（不静默跳过） */
  enforce: () => Promise<void>
}

/** 宿主返回值归一：只有 required/preferred 原样保留，其余一律 `off` */
function normalizePolicy(raw: unknown): EncryptionPolicy {
  return raw === 'required' || raw === 'preferred' ? raw : 'off'
}

/** 能力 → 阻塞原因（身份优先：身份缺失时 WS 缺失已无意义） */
function blockReasonOf(caps: LinkCryptoCapabilities): LinkCryptoBlockReason | null {
  if (!caps.identityFingerprint) return 'identity-missing'
  if (caps.wsSession !== true) return 'ws-unsupported'
  return null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useLinkCryptoStatus(
  invoke: HostInvoke | null | undefined,
  bindings: HostBindings,
): LinkCryptoStatus {
  const capabilities = ref<LinkCryptoCapabilities | null>(null)
  const policy = ref<EncryptionPolicy>('off')
  const supported = ref(false)
  const blockReason = ref<LinkCryptoBlockReason | null>(null)
  const lastError = ref<string | null>(null)
  /** 加载中标记（防止 onMounted 与手动刷新竞态重复请求） */
  let loading: Promise<void> | null = null

  const enforced = computed(
    () =>
      supported.value && blockReason.value === null && policy.value === FORCED_ENCRYPTION_POLICY,
  )

  /**
   * 唯一写入口：**只写 required**（配置层拒绝关闭）。
   *
   * 无入参是刻意的——调用点拿不到写 `off` / `preferred` 的能力。前置条件不满足
   * 一律抛错（不静默跳过）：未加载/旧宿主无能力、或 blocker 存在（写 required 会
   * 把全部对端拒掉，还会把数据面标成「已强制」）。
   */
  async function enforce(): Promise<void> {
    if (!bindings.setPolicy) {
      throw new Error('appLinkCryptoSet unavailable on this host')
    }
    if (!supported.value) {
      throw new Error('link crypto status unavailable on this host')
    }
    if (blockReason.value !== null) {
      throw new Error(`link encryption cannot be enforced: ${blockReason.value}`)
    }
    await bindings.setPolicy(FORCED_ENCRYPTION_POLICY)
    policy.value = FORCED_ENCRYPTION_POLICY
    lastError.value = null
  }

  async function load(): Promise<void> {
    if (!invoke) return
    if (loading) return loading
    loading = (async () => {
      try {
        const caps = await invoke<LinkCryptoCapabilities>('get_link_crypto_capabilities')
        if (!caps || caps.appScopedPolicy !== true) {
          // 旧宿主：无按应用策略面，保持 supported=false（界面显性提示，不假定已加密）
          return
        }
        capabilities.value = caps
        blockReason.value = blockReasonOf(caps)
        if (!bindings.getPolicy || !bindings.setPolicy) return

        policy.value = normalizePolicy(await bindings.getPolicy())
        supported.value = true

        // 自动收紧：本应用固定 required，宿主的旧值（off / preferred）就地改写。
        // 不可强制（blocker 非空）时不写库——留给界面显性说明。
        if (blockReason.value === null && policy.value !== FORCED_ENCRYPTION_POLICY) {
          try {
            await enforce()
          } catch (error) {
            // 写库失败不改变本地值：界面显示「未生效」与原因，不显示已生效假象
            lastError.value = errorText(error)
          }
        }
      } finally {
        loading = null
      }
    })()
    return loading
  }

  return { capabilities, policy, supported, enforced, blockReason, lastError, load, enforce }
}
